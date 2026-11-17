import { getProject } from './projects.js';

const TICKET_KEY = /^[A-Za-z]+-\d+$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CACHE_TTL_MS = 2 * 60 * 1000;
const activityCache = new Map();

/**
 * Custom error class for GitHub API responses and network conditions.
 * Categorizes errors with status, error code, and transient indicators.
 */
export class GitHubApiError extends Error {
  constructor(message, { status = 500, code = 'API_ERROR', isTransient = false, details = null } = {}) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.code = code;
    this.isTransient = isTransient;
    this.details = details;
  }
}

/**
 * Checks whether GITHUB_TOKEN is available in the server process environment.
 */
export function isGithubConfigured() {
  return Boolean(process.env.GITHUB_TOKEN?.trim());
}

/**
 * Validates and parses an 'owner/repo' string.
 * @param {string} value
 * @returns {{ owner: string, repo: string, fullName: string } | null}
 */
export function parseOwnerRepo(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    fullName: `${match[1]}/${match[2]}`,
  };
}

/**
 * Parses a GitHub Pull Request URL.
 * Matches: https://github.com/:owner/:repo/pull/:number
 * @param {string} url
 * @returns {{ owner: string, repo: string, pullNumber: number, canonicalUrl: string } | null}
 */
export function parsePullRequestUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  const match = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)\/?$/i.exec(trimmed);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  const pullNumber = parseInt(match[3], 10);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) return null;
  return {
    owner,
    repo,
    pullNumber,
    canonicalUrl: `https://github.com/${owner}/${repo}/pull/${pullNumber}`,
  };
}

/**
 * Parses comma- or whitespace-separated list of repos (e.g. "owner/a, owner/b").
 * Preserves legacy multi-repo parsing for backwards compatibility.
 */
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

export async function resolveGithubRepos(projectId) {
  if (projectId != null && Number.isInteger(Number(projectId))) {
    const project = await getProject(projectId);
    const fromProject = parseGithubRepos(project?.github_repo || '');
    if (fromProject.length) return fromProject;
  }
  return parseGithubRepos(process.env.GITHUB_REPOS || '');
}

/**
 * Low-level server-side GitHub REST API request wrapper with robust error classification.
 * Always run outside database transactions.
 */
export async function githubRequest(path, { method = 'GET', query, body, signal } = {}) {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new GitHubApiError('GITHUB_TOKEN is not configured on the server.', {
      status: 500,
      code: 'NOT_CONFIGURED',
      isTransient: false,
    });
  }

  const url = new URL(`https://api.github.com${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SerpHawk-Ticketing',
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
      next: { revalidate: 0 },
    });
  } catch (netErr) {
    throw new GitHubApiError(
      `GitHub API request failed: ${netErr.message || 'Network timeout or unreachable host.'}`,
      {
        status: 503,
        code: 'OUTAGE',
        isTransient: true,
        details: netErr,
      }
    );
  }

  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    throw new GitHubApiError(
      data.message || 'GitHub API authentication failed. Verify GITHUB_TOKEN.',
      { status: 401, code: 'AUTH_FAILED', isTransient: false }
    );
  }

  if (res.status === 403) {
    const rateRemaining = res.headers.get('x-ratelimit-remaining');
    const isRateLimit = rateRemaining === '0';
    const data = await res.json().catch(() => ({}));
    throw new GitHubApiError(
      data.message || (isRateLimit ? 'GitHub API rate limit exceeded.' : 'Forbidden: GITHUB_TOKEN lacks access to this repository.'),
      {
        status: 403,
        code: isRateLimit ? 'RATE_LIMITED' : 'FORBIDDEN',
        isTransient: isRateLimit,
      }
    );
  }

  if (res.status === 404) {
    const data = await res.json().catch(() => ({}));
    throw new GitHubApiError(
      data.message || 'Requested GitHub repository, branch, or pull request was not found or is private.',
      { status: 404, code: 'NOT_FOUND', isTransient: false }
    );
  }

  if (res.status >= 500) {
    const data = await res.json().catch(() => ({}));
    throw new GitHubApiError(
      data.message || `GitHub server error (${res.status}). Service may be experiencing an outage.`,
      { status: 502, code: 'OUTAGE', isTransient: true }
    );
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new GitHubApiError(data.message || `GitHub API error (${res.status}).`, {
      status: res.status,
      code: 'API_ERROR',
      isTransient: false,
    });
  }

  return res.json();
}

/**
 * Backward-compatible wrapper for existing internal search callers.
 */
async function githubGet(path, query) {
  return githubRequest(path, { method: 'GET', query });
}

/**
 * Verifies repository accessibility and returns canonical metadata.
 * @param {string} owner
 * @param {string} repo
 */
export async function verifyRepositoryAccess(owner, repo) {
  const cleanOwner = String(owner || '').trim();
  const cleanRepo = String(repo || '').trim();
  if (!cleanOwner || !cleanRepo) {
    throw new GitHubApiError('Repository owner and name are required.', {
      status: 400,
      code: 'INVALID_INPUT',
      isTransient: false,
    });
  }

  const data = await githubRequest(`/repos/${cleanOwner}/${cleanRepo}`);
  return {
    valid: true,
    id: data.id,
    owner: data.owner?.login || cleanOwner,
    repo: data.name || cleanRepo,
    fullName: data.full_name || `${cleanOwner}/${cleanRepo}`,
    isPrivate: Boolean(data.private),
    defaultBranch: data.default_branch || 'main',
    htmlUrl: data.html_url || `https://github.com/${cleanOwner}/${cleanRepo}`,
  };
}

/**
 * Verifies branch existence in a given repository.
 * Handles slashes safely via encodeURIComponent.
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 */
export async function verifyBranchExists(owner, repo, branch) {
  const cleanBranch = String(branch || '').trim();
  if (!cleanBranch) {
    throw new GitHubApiError('Branch name is required.', {
      status: 400,
      code: 'INVALID_INPUT',
      isTransient: false,
    });
  }

  const encodedBranch = encodeURIComponent(cleanBranch);
  const data = await githubRequest(`/repos/${owner}/${repo}/branches/${encodedBranch}`);
  return {
    valid: true,
    branch: data.name || cleanBranch,
    commitSha: data.commit?.sha || '',
  };
}

/**
 * Verifies and extracts metadata for a Pull Request.
 * Returns strict 3-state merged indicator:
 *   1 = Confirmed Merged
 *   0 = Confirmed Unmerged
 *   NULL = Unknown
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number|string} pullNumber
 */
export async function getAndVerifyPullRequest(owner, repo, pullNumber) {
  const num = parseInt(pullNumber, 10);
  if (!Number.isInteger(num) || num <= 0) {
    throw new GitHubApiError('Invalid pull request number.', {
      status: 400,
      code: 'INVALID_INPUT',
      isTransient: false,
    });
  }

  const data = await githubRequest(`/repos/${owner}/${repo}/pulls/${num}`);

  // 3-state merge determination:
  // merged: true -> 1 (Confirmed Merged)
  // merged: false -> 0 (Confirmed Unmerged)
  // undefined/null -> null (Unknown)
  let mergedState = null;
  if (data.merged === true) {
    mergedState = 1;
  } else if (data.merged === false) {
    mergedState = 0;
  }

  return {
    valid: true,
    number: data.number,
    title: data.title || '',
    url: data.html_url || `https://github.com/${owner}/${repo}/pull/${num}`,
    state: data.state || 'open', // 'open' or 'closed'
    merged: mergedState,
    mergedAt: data.merged_at || null,
    headRef: data.head?.ref || '',
    headSha: data.head?.sha || '',
    baseRef: data.base?.ref || '',
    user: data.user?.login || '',
  };
}

/**
 * Lists Pull Requests for a repository (useful for reusable PR selectors).
 * @param {string} owner
 * @param {string} repo
 * @param {{ state?: 'open'|'closed'|'all', page?: number, perPage?: number }} [opts]
 */
export async function listRepositoryPullRequests(owner, repo, { state = 'open', page = 1, perPage = 30 } = {}) {
  const data = await githubRequest(`/repos/${owner}/${repo}/pulls`, {
    query: {
      state,
      page: Math.max(1, parseInt(page, 10) || 1),
      per_page: Math.min(100, Math.max(1, parseInt(perPage, 10) || 30)),
    },
  });

  if (!Array.isArray(data)) return [];
  return data.map((item) => ({
    id: item.id,
    number: item.number,
    title: item.title || '',
    url: item.html_url,
    state: item.state,
    merged: item.merged_at ? 1 : (item.merged === true ? 1 : 0),
    headRef: item.head?.ref || '',
    baseRef: item.base?.ref || '',
    user: item.user?.login || '',
    updatedAt: item.updated_at,
  }));
}

// ---------------------------------------------------------------------------
// Existing Internal Activity Helpers (Preserved for TaskSheet compatibility)
// ---------------------------------------------------------------------------

function cacheKey(ticketKey, repos) {
  return `${ticketKey.toUpperCase()}::${repos.slice().sort().join(',')}`;
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

export async function fetchTicketGithubActivity(ticketKey, opts = {}) {
  const key = String(ticketKey || '').trim();
  if (!TICKET_KEY.test(key)) {
    const err = new Error('Ticket key must look like TM-594.');
    err.code = 'bad_key';
    throw err;
  }

  if (!isGithubConfigured()) {
    return {
      configured: false,
      ticketKey: key.toUpperCase(),
      repos: [],
      pulls: [],
      commits: [],
      message:
        'Add GITHUB_TOKEN to .env.local to load pull requests and commits for this task.',
    };
  }

  const repos = await resolveGithubRepos(opts.projectId);
  if (!repos.length) {
    return {
      configured: true,
      ticketKey: key.toUpperCase(),
      repos: [],
      pulls: [],
      commits: [],
      message:
        'No GitHub repos configured. Set a repo on the project (owner/name) or GITHUB_REPOS in .env.local.',
    };
  }

  const ck = cacheKey(key, repos);
  const cached = getCached(ck);
  if (cached) return cached;

  const scope = repoQualifier(repos);
  const needle = key.toUpperCase();

  const [prData, commitData] = await Promise.all([
    githubGet('/search/issues', {
      q: `${needle} is:pr ${scope}`,
      sort: 'updated',
      order: 'desc',
      per_page: 10,
    }),
    githubGet('/search/commits', {
      q: `${needle} ${scope}`,
      sort: 'committer-date',
      order: 'desc',
      per_page: 10,
    }),
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
