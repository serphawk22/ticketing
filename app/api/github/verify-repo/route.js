import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { parseOwnerRepo, verifyRepositoryAccess } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const rawRepo = String(body.repo || body.repository || '').trim();

  if (!rawRepo) {
    return NextResponse.json({ error: 'Repository name is required.' }, { status: 400 });
  }

  const parsed = parseOwnerRepo(rawRepo);
  if (!parsed) {
    return NextResponse.json(
      { error: 'Invalid repository format. Please enter as "owner/repo" or a GitHub repository URL.' },
      { status: 400 }
    );
  }

  try {
    const verifiedData = await verifyRepositoryAccess(parsed.owner, parsed.repo);
    return NextResponse.json({
      verified: true,
      owner: parsed.owner,
      repo: parsed.repo,
      fullName: `${parsed.owner}/${parsed.repo}`,
      url: verifiedData.html_url || `https://github.com/${parsed.owner}/${parsed.repo}`,
      defaultBranch: verifiedData.default_branch || 'main',
      isPrivate: Boolean(verifiedData.private),
      description: verifiedData.description || '',
    });
  } catch (err) {
    return NextResponse.json(
      {
        verified: false,
        owner: parsed.owner,
        repo: parsed.repo,
        fullName: `${parsed.owner}/${parsed.repo}`,
        error: err.message || 'Verification failed.',
        code: err.code || 'UNKNOWN_ERROR',
        isTransient: Boolean(err.isTransient),
      },
      { status: err.status === 404 ? 404 : 400 }
    );
  }
}
