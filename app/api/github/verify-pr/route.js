import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { getRepositoryById } from '@/lib/projectRepositories';
import { verifyTicketPullRequest, parsePullRequestUrl } from '@/lib/github';
import { assertCanViewProject, assertCanAccessTicket, isAdminOrOwner } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role === 'client') {
    return NextResponse.json(
      { error: 'Clients are not authorized to verify or modify technical Git references.' },
      { status: 403 }
    );
  }

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

    if (ticket.project_id) {
      const projAuth = await assertCanViewProject(session.user, ticket.project_id);
      if (!projAuth.allowed) {
        return NextResponse.json(
          { error: 'Forbidden: you do not have access to this project.' },
          { status: 403 }
        );
      }
    }

    const ticketAuth = await assertCanAccessTicket(session.user, ticket, { action: 'read' });
    if (!ticketAuth.allowed) {
      return NextResponse.json(
        { error: ticketAuth.error || 'Forbidden: you do not have access to this ticket.' },
        { status: 403 }
      );
    }

    if (ticket.archived) {
      return NextResponse.json(
        { error: 'Cannot verify Pull Request for an archived ticket.' },
        { status: 400 }
      );
    }

    if (ticket.status === 'closed') {
      return NextResponse.json(
        { error: 'Cannot modify or verify Pull Request references on a closed ticket.' },
        { status: 400 }
      );
    }

    if (!ticket.repository_id) {
      return NextResponse.json(
        { error: 'Ticket does not have an assigned repository.' },
        { status: 400 }
      );
    }

    const repo = await getRepositoryById(ticket.repository_id);
    if (!repo) {
      return NextResponse.json(
        { error: 'Assigned repository not found.' },
        { status: 400 }
      );
    }

    if (ticket.project_id && Number(repo.project_id) !== Number(ticket.project_id)) {
      return NextResponse.json(
        { error: 'Assigned repository does not belong to the ticket project.' },
        { status: 400 }
      );
    }

    if (!repo.is_active) {
      return NextResponse.json(
        { error: 'Assigned repository is deactivated and cannot accept Pull Requests.' },
        { status: 400 }
      );
    }

    repository = repo;
  }

  if (body.repository_id) {
    const repo = await getRepositoryById(Number(body.repository_id));
    if (!repo) {
      return NextResponse.json({ error: 'Repository not found.' }, { status: 404 });
    }

    if (repo.project_id) {
      const projAuth = await assertCanViewProject(session.user, repo.project_id);
      if (!projAuth.allowed) {
        return NextResponse.json(
          { error: 'Forbidden: you do not have access to this project.' },
          { status: 403 }
        );
      }
    }

    if (!repo.is_active) {
      return NextResponse.json(
        { error: 'Repository is deactivated and cannot be used for PR verification.' },
        { status: 400 }
      );
    }

    if (ticket && Number(repo.project_id) !== Number(ticket.project_id)) {
      return NextResponse.json(
        { error: 'Selected repository does not belong to the ticket project.' },
        { status: 400 }
      );
    }

    repository = repo;
  } else if (!ticket && body.owner && body.repo) {
    if (!isAdminOrOwner(session.user)) {
      return NextResponse.json(
        { error: 'A ticket_id or repository_id is required to verify Pull Requests.' },
        { status: 400 }
      );
    }
    repository = {
      github_owner: String(body.owner).trim(),
      github_repo: String(body.repo).trim(),
    };
  }

  if (!repository) {
    return NextResponse.json(
      { error: 'Repository context is required to verify a Pull Request.' },
      { status: 400 }
    );
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
