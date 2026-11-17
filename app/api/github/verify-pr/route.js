import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { getRepositoryById } from '@/lib/projectRepositories';
import { verifyTicketPullRequest, parsePullRequestUrl } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const rawPrUrl = String(body.pr_url || body.url || '').trim();

  if (!rawPrUrl) {
    return NextResponse.json(
      { error: 'GitHub Pull Request URL is required.' },
      { status: 400 }
    );
  }

  const parsed = parsePullRequestUrl(rawPrUrl);
  if (!parsed) {
    return NextResponse.json(
      { error: 'Invalid GitHub Pull Request URL. Expected format: https://github.com/:owner/:repo/pull/:number' },
      { status: 400 }
    );
  }

  let ticket = null;
  let repository = null;

  if (body.ticket_id) {
    ticket = await getTicket(Number(body.ticket_id));
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }
  }

  if (body.repository_id) {
    repository = await getRepositoryById(Number(body.repository_id));
  } else if (ticket?.repository_id) {
    repository = await getRepositoryById(ticket.repository_id);
  } else if (body.owner && body.repo) {
    repository = {
      github_owner: String(body.owner).trim(),
      github_repo: String(body.repo).trim(),
    };
  }

  try {
    const verifiedData = await verifyTicketPullRequest({
      ticket,
      prUrl: rawPrUrl,
      repository,
    });

    return NextResponse.json({
      verified: true,
      url: verifiedData.pr_url,
      number: verifiedData.github_pr_number,
      title: verifiedData.github_pr_title,
      state: verifiedData.github_pr_state,
      merged: verifiedData.github_pr_merged,
      headSha: verifiedData.github_pr_head_sha,
      baseBranch: verifiedData.github_pr_base_branch,
      lastVerifiedAt: verifiedData.github_pr_last_verified_at,
      mergedAt: verifiedData.pr_merged_at,
      branch: verifiedData.github_branch || null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        verified: false,
        error: err.message || 'Verification failed.',
        code: err.code || 'UNKNOWN_ERROR',
        isTransient: Boolean(err.isTransient),
      },
      { status: err.status || 400 }
    );
  }
}
