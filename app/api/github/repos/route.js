import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isGithubConfigured, githubRequest } from '@/lib/github';

export const dynamic = 'force-dynamic';

let cachedRepos = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isGithubConfigured()) {
    return NextResponse.json({
      configured: false,
      repos: [],
      message: 'GITHUB_TOKEN is not configured in .env',
    });
  }

  const now = Date.now();
  if (cachedRepos && now < cacheExpiry) {
    return NextResponse.json({
      configured: true,
      repos: cachedRepos,
      cached: true,
    });
  }

  try {
    const raw = await githubRequest('/user/repos?per_page=100&sort=updated');
    if (!Array.isArray(raw)) {
      return NextResponse.json({
        configured: true,
        repos: [],
      });
    }

    const repos = raw.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      owner: r.owner?.login || '',
      name: r.name,
      isPrivate: Boolean(r.private),
      defaultBranch: r.default_branch || 'main',
      htmlUrl: r.html_url || `https://github.com/${r.full_name}`,
      description: r.description || '',
    }));

    cachedRepos = repos;
    cacheExpiry = now + CACHE_TTL_MS;

    return NextResponse.json({
      configured: true,
      repos,
      cached: false,
    });
  } catch (err) {
    console.error('Failed to fetch user repositories from GitHub API:', err);
    return NextResponse.json(
      {
        configured: true,
        repos: [],
        error: err.message || 'Failed to fetch repositories from GitHub API',
      },
      { status: 500 }
    );
  }
}
