import { getProjectGithubAuth } from './projects';

const TICKET_KEY = /^[A-Za-z]+-\d+$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CACHE_TTL_MS = 2 * 60 * 1000;
const activityCache = new Map();

/**
 * GitHub activity for a work-item key (e.g. TM-594).
 *
 * Searches pull requests and commits whose title/body/message mention the
 * key, scoped to that project's github_repo and github_token.
 * GITHUB_TOKEN / GITHUB_REPOS in the environment are only a fallback when a
 * project has not set its own values.
 */

export function isPlausibleGithubToken(value) {
  const token = String(value ?? '').trim();
  return token.length >= 20 && token.length <= 500 && !/\s/.test(token);
}

export function parseGithubRepos(value) {
  if (!value || typeof value !== 'string') return [];
  const seen = new Set();
  const repos = [];
  for (const part of value.split(/[,\s]+/)) {
    const repo = part.trim();
    if (!repo || !REPO_RE.test(repo) || seen.has(repo.toLowerCase())) continue;
    seen.add(repo.toLowerCase());
    repos.push(repo);
  }
  return repos;
}

export async function resolveGithubAuth(projectId) {
  let projectRepo = '';
  let projectToken = '';
  if (projectId != null && Number.isInteger(Number(projectId))) {
    const row = await getProjectGithubAuth(projectId);
    projectRepo = row?.github_repo || '';
    projectToken = String(row?.github_token || '').trim();
  }

  const projectRepos = parseGithubRepos(projectRepo);
  const repos = projectRepos.length
    ? projectRepos
    : parseGithubRepos(process.env.GITHUB_REPOS || '');
  const token = projectToken || String(process.env.GITHUB_TOKEN || '').trim();

  return {
    repos,
    token,
    usingProjectToken: Boolean(projectToken),
    usingProjectRepos: projectRepos.length > 0,
  };
}

function tokenFingerprint(token) {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 31 + token.charCodeAt(i)) | 0;
  }
  return String(hash);
}

function cacheKey(ticketKey, repos, token) {
  return `${ticketKey.toUpperCase()}::${repos.slice().sort().join(',')}::${tokenFingerprint(token)}`;
}

function getCached(key) {
  const hit = activityCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    activityCache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key, value) {
  activityCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function githubGet(path, query, token) {
  if (!token) {
    const err = new Error('No GitHub token is set for this project.');
    err.code = 'not_configured';
    throw err;
  }

  const url = new URL(`https://api.github.com${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ticket-manager-task-sheet',
    },
    next: { revalidate: 0 },
  });

  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(
      body.message || 'GitHub rejected this project token. Check that it can read the repo.'
    );
    err.code = 'github_auth';
    throw err;
  }

  if (res.status === 422) {
    // Invalid search (empty repos, etc.) — treat as no results.
    return { total_count: 0, items: [] };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || `GitHub API error (${res.status}).`);
    err.code = 'github_error';
    throw err;
  }

  return res.json();
}

function repoQualifier(repos) {
  if (!repos.length) return '';
  if (repos.length === 1) return `repo:${repos[0]}`;
  return `(${repos.map((r) => `repo:${r}`).join(' OR ')})`;
}

function mapPull(item) {
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    state: item.pull_request?.merged_at
      ? 'merged'
      : item.state === 'closed'
        ? 'closed'
        : 'open',
    url: item.html_url,
    author: item.user?.login || '',
    updatedAt: item.updated_at,
    repo: item.repository_url
      ? item.repository_url.replace('https://api.github.com/repos/', '')
      : '',
  };
}

function mapCommit(item) {
  const sha = item.sha || '';
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: (item.commit?.message || '').split('\n')[0],
    url: item.html_url,
    author: item.author?.login || item.commit?.author?.name || '',
    date: item.commit?.author?.date || item.commit?.committer?.date || null,
    repo: item.repository?.full_name || '',
  };
}

/**
 * @param {string} ticketKey e.g. TM-594
 * @param {{ projectId?: number|null }} [opts]
 */
export async function fetchTicketGithubActivity(ticketKey, opts = {}) {
  const key = String(ticketKey || '').trim();
  if (!TICKET_KEY.test(key)) {
    const err = new Error('Ticket key must look like TM-594.');
    err.code = 'bad_key';
    throw err;
  }

  const auth = await resolveGithubAuth(opts.projectId);
  const { repos, token } = auth;

  if (!token) {
    return {
      configured: false,
      ticketKey: key.toUpperCase(),
      repos,
      pulls: [],
      commits: [],
      message:
        'Add a GitHub token on this project to load pull requests and commits.',
    };
  }

  if (!repos.length) {
    return {
      configured: true,
      ticketKey: key.toUpperCase(),
      repos: [],
      pulls: [],
      commits: [],
      message:
        'Add a GitHub repo on this project (owner/name) so activity can be searched.',
    };
  }

  const ck = cacheKey(key, repos, token);
  const cached = getCached(ck);
  if (cached) return cached;

  const scope = repoQualifier(repos);
  const needle = key.toUpperCase();

  const [prData, commitData] = await Promise.all([
    githubGet(
      '/search/issues',
      {
        q: `${needle} is:pr ${scope}`,
        sort: 'updated',
        order: 'desc',
        per_page: 10,
      },
      token
    ),
    githubGet(
      '/search/commits',
      {
        q: `${needle} ${scope}`,
        sort: 'committer-date',
        order: 'desc',
        per_page: 10,
      },
      token
    ),
  ]);

  const result = {
    configured: true,
    ticketKey: needle,
    repos,
    pulls: (prData.items || []).map(mapPull),
    commits: (commitData.items || []).map(mapCommit),
    message: null,
  };

  setCached(ck, result);
  return result;
}
