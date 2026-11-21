import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket, deleteTicket, childTicketCount, descendantTickets } from '@/lib/tickets';
import { getProject } from '@/lib/projects';
import { ticketKey } from '@/lib/ticketMeta';
import { employeeExists, getEmployee } from '@/lib/employees';
import { notifyAssignment, notifyStatusChange } from '@/lib/mail';
import { notifyTicketUpdated } from '@/lib/notifications';
import { deleteAttachment } from '@/lib/storage';
import { logActivityChanges, logDueDateChange, logRepositoryChange, logTicketClosure } from '@/lib/ticketActivity';
import { getRepositoryById, changeTicketRepository } from '@/lib/projectRepositories';
import { verifyTicketPullRequest, sanitizeGitHubErrorMessage } from '@/lib/github';
import { wouldCreateCycle } from '@/lib/ticketTree';
import { FIELD_META, PRIORITY_ORDER, STATUS_ORDER, TYPE_ORDER, INCLUSION_ORDER } from '@/lib/ticketMeta';
import { canRouteWork, isAdminOrOwner, assertCanChangeDueDate, assertCanViewProject, assertCanAccessTicket, assertCanCloseTicket } from '@/lib/rbac';
import { syncStageOnArchiveState, transitionTicketStatus } from '@/lib/ticketStageService';

const TEXT_FIELDS = ['title', 'description', 'labels', 'category', 'resolution', 'team'];
// Category and team are ordinary editable metadata for the team, but a
// requester only reads them: the sidebar hides them from clients, so the API
// refuses them too rather than trusting the UI.
const TEAM_ONLY_TEXT_FIELDS = ['category', 'team'];

function badValue(field, value) {
  return NextResponse.json({ error: `Invalid ${FIELD_META[field].label.toLowerCase()}.` }, { status: 400 });
}

function parseDate(value) {
  if (value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  return text;
}

function parseNumber(value, { integer = false } = {}) {
  if (value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  if (integer && !Number.isInteger(n)) return undefined;
  return n;
}

// 'No parent' for the empty case, so the activity log never shows a bare id.
async function keyOf(id) {
  if (id == null) return 'No parent';
  const t = await getTicket(id);
  return t ? ticketKey(t) : 'No parent';
}

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const body = await request.json();
  const initialStatus = ticket.status;
  const initialRepoId = ticket.repository_id != null ? Number(ticket.repository_id) : null;
  const initialPrUrl = (ticket.pr_url == null ? '' : String(ticket.pr_url)).trim();
  const isAdmin = isAdminOrOwner(session.user);
  // Routing the work -- naming an assignee -- is the same team decision at
  // edit time as it is at create time, so it answers to the same rule the POST
  // route applies: team roles may take it, a requester may not.
  const canRoute = canRouteWork(session.user);

  const edits = {};

  for (const field of TEXT_FIELDS) {
    if (body[field] === undefined) continue;
    if (!FIELD_META[field].open && !isAdmin) {
      return NextResponse.json(
        { error: `Only admins can edit ${FIELD_META[field].label.toLowerCase()}.` },
        { status: 403 }
      );
    }
    if (TEAM_ONLY_TEXT_FIELDS.includes(field) && session.user.role === 'client') {
      return NextResponse.json(
        { error: `Clients cannot edit ${FIELD_META[field].label.toLowerCase()}.` },
        { status: 403 }
      );
    }
    const value = String(body[field] ?? '').trim();
    if (field === 'title' && !value) {
      return NextResponse.json({ error: 'Title cannot be empty.' }, { status: 400 });
    }
    edits[field] = value;
  }

  if (body.status !== undefined) {
    if (!STATUS_ORDER.includes(body.status)) return badValue('status', body.status);
    edits.status = body.status;
  }

  if (body.priority !== undefined) {
    if (!PRIORITY_ORDER.includes(body.priority)) return badValue('priority', body.priority);
    edits.priority = body.priority;
  }

  if (body.type !== undefined) {
    if (!TYPE_ORDER.includes(body.type)) return badValue('type', body.type);
    edits.type = body.type;
  }

  let startDateVal = ticket.start_date;
  let dueDateVal = ticket.due_date;
  let dueDateChangeDetails = null;

  if (body.start_date !== undefined) {
    const value = parseDate(body.start_date);
    if (value === undefined) return badValue('start_date', body.start_date);
    edits.start_date = value;
    startDateVal = value;
  }

  if (body.due_date !== undefined) {
    const value = parseDate(body.due_date);
    if (value === undefined) return badValue('due_date', body.due_date);

    if ((value || null) !== (ticket.due_date || null)) {
      if (['resolved', 'closed'].includes(ticket.status)) {
        return NextResponse.json(
          { error: 'Cannot change the due date of a completed or closed ticket.' },
          { status: 400 }
        );
      }

      const dueAuth = await assertCanChangeDueDate(session.user, ticket);
      if (!dueAuth.allowed) {
        return NextResponse.json({ error: dueAuth.error }, { status: dueAuth.status || 403 });
      }

      const blockerText = String(body.blocker || '').trim();
      const reasonText = String(body.reason || body.delay_reason || '').trim();

      // Employees must provide mandatory blocker and delay reason
      if (!dueAuth.isElevated) {
        if (!blockerText || !reasonText) {
          return NextResponse.json(
            { error: 'Blocker description and reason for delay are mandatory when changing a due date.' },
            { status: 400 }
          );
        }
      }

      // Check concurrency collision if expected_due_date is provided
      if (body.expected_due_date !== undefined) {
        const expected = body.expected_due_date === null || body.expected_due_date === ''
          ? null
          : String(body.expected_due_date).trim();
        if ((ticket.due_date || null) !== expected) {
          return NextResponse.json(
            { error: 'The due date has been modified by another user. Please refresh and review the latest history.' },
            { status: 409 }
          );
        }
      }

      dueDateChangeDetails = {
        from: ticket.due_date || '',
        to: value || '',
        blocker: blockerText,
        reason: reasonText,
        employeeId: dueAuth.scope?.employeeId || null,
      };
      edits.due_date = value;
      dueDateVal = value;
    }
  }

  if (startDateVal && dueDateVal && startDateVal > dueDateVal) {
    return NextResponse.json(
      { error: 'Due date must be on or after the start date.' },
      { status: 400 }
    );
  }

  if (body.budget !== undefined) {
    if (!isAdmin) {
      return NextResponse.json({ error: 'Only admins can edit budget.' }, { status: 403 });
    }
    const value = parseNumber(body.budget);
    if (value === undefined) return badValue('budget', body.budget);
    edits.budget = value;
  }

  if (body.estimate_seconds !== undefined) {
    const value = parseNumber(body.estimate_seconds, { integer: true });
    if (value === undefined) return badValue('estimate_seconds', body.estimate_seconds);
    edits.estimate_seconds = value;
  }

  if (body.product_inclusion_status !== undefined) {
    if (session.user.role === 'client') {
      return NextResponse.json(
        { error: 'Clients are not authorized to change product inclusion status.' },
        { status: 403 }
      );
    }
    if (!INCLUSION_ORDER.includes(body.product_inclusion_status)) {
      return NextResponse.json(
        { error: 'Invalid product inclusion status. Allowed: pending_review, included, not_included.' },
        { status: 400 }
      );
    }
    edits.product_inclusion_status = body.product_inclusion_status;
  }

  if (body.product_inclusion_reference !== undefined) {
    if (session.user.role === 'client') {
      return NextResponse.json(
        { error: 'Clients are not authorized to change product inclusion reference.' },
        { status: 403 }
      );
    }
    edits.product_inclusion_reference = String(body.product_inclusion_reference ?? '').trim();
  }

  // Moving a ticket between projects is admin-only, matching the rule that only
  // admins create tickets: a project change moves work into someone else's
  // backlog, and their counts and dashboards follow it.
  if (body.project_id !== undefined) {
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Only admins can move work items between projects.' },
        { status: 403 }
      );
    }
    if (body.project_id === null || body.project_id === '') {
      edits.project_id = null;
    } else {
      const value = Number(body.project_id);
      if (!Number.isInteger(value)) return badValue('project', body.project_id);
      if (!(await getProject(value))) {
        return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
      }
      edits.project_id = value;
    }
  }

  let repoChangedAtomically = false;

  if (body.repository_id !== undefined) {
    if (body.repository_id === null || body.repository_id === '') {
      if (ticket.project_id) {
        return NextResponse.json(
          { error: 'Tickets belonging to a project must have a repository assigned.' },
          { status: 400 }
        );
      }
      edits.repository_id = null;
    } else {
      const newRepoId = Number(body.repository_id);
      if (!Number.isInteger(newRepoId) || newRepoId <= 0) {
        return NextResponse.json({ error: 'Invalid repository id.' }, { status: 400 });
      }

      const validSources = new Set(['board', 'list', 'detail', 'task_sheet', 'api', 'archive']);
      const transitionSource = validSources.has(body.source) ? body.source : 'detail';

      try {
        const repoResult = await changeTicketRepository({
          ticketId,
          newRepoId,
          reason: body.repository_change_reason || body.reason,
          actor: session.user,
          source: transitionSource,
        });
        repoChangedAtomically = repoResult.changed;
      } catch (repoErr) {
        return NextResponse.json(
          { error: repoErr.message },
          { status: repoErr.statusCode || 400 }
        );
      }
    }
  }

  let verifiedPrMetadata = null;

  if (body.pr_url !== undefined) {
    if (session.user.role === 'client') {
      return NextResponse.json(
        { error: 'Clients are not authorized to modify Pull Request references.' },
        { status: 403 }
      );
    }
    if (ticket.archived) {
      return NextResponse.json(
        { error: 'Cannot modify or remove Pull Request on an archived ticket.' },
        { status: 400 }
      );
    }
    if (ticket.status === 'closed') {
      return NextResponse.json(
        { error: 'Cannot modify or remove Pull Request references on a closed ticket.' },
        { status: 400 }
      );
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
    const ticketAuth = await assertCanAccessTicket(session.user, ticket, { action: 'write' });
    if (!ticketAuth.allowed) {
      return NextResponse.json(
        { error: ticketAuth.error || 'Forbidden.' },
        { status: 403 }
      );
    }

    const rawPr = body.pr_url === null ? '' : String(body.pr_url).trim();
    if (!rawPr) {
      // Explicitly clearing PR references
      edits.pr_url = '';
      edits.github_pr_number = null;
      edits.github_pr_title = '';
      edits.github_pr_state = '';
      edits.github_pr_merged = null;
      edits.github_pr_head_sha = '';
      edits.github_pr_base_branch = '';
      edits.github_pr_last_verified_at = null;
      edits.pr_merged_at = null;
      edits.github_branch = '';

      // Safeguard: A ticket must not remain in 'resolved' without a verified PR!
      // If currently in 'resolved' and status is not otherwise changing, atomically revert to 'in_progress'
      if (ticket.status === 'resolved' && edits.status === undefined) {
        edits.status = 'in_progress';
      }
    } else {
      const prMatch = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)\/?$/i.exec(rawPr);
      if (!prMatch) {
        return NextResponse.json(
          { error: 'Invalid GitHub Pull Request URL format. Expected: https://github.com/:owner/:repo/pull/:number' },
          { status: 400 }
        );
      }
      edits.pr_url = rawPr;
      edits.github_pr_number = parseInt(prMatch[3], 10);

      // Best effort live API verification if repository is assigned
      if (ticket.repository_id) {
        try {
          const repo = await getRepositoryById(ticket.repository_id);
          if (repo && (!ticket.project_id || Number(repo.project_id) === Number(ticket.project_id)) && repo.is_active) {
            verifiedPrMetadata = await verifyTicketPullRequest({ ticket, prUrl: rawPr, repository: repo }).catch(() => null);
          }
        } catch {}
      }
    }
  }

  let closureActivityDetails = null;

  // Transitioning to QA Testing ('resolved')
  if (edits.status === 'resolved') {
    const targetPrUrl = body.pr_url !== undefined ? body.pr_url : ticket.pr_url;
    const cleanTargetPrUrl = targetPrUrl ? String(targetPrUrl).trim() : '';

    if (cleanTargetPrUrl) {
      // Format check only
      const prMatch = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)\/?$/i.exec(cleanTargetPrUrl);
      if (!prMatch) {
        return NextResponse.json(
          { error: 'Invalid GitHub Pull Request URL format. Expected: https://github.com/:owner/:repo/pull/:number' },
          { status: 400 }
        );
      }
      edits.pr_url = cleanTargetPrUrl;
      edits.github_pr_number = parseInt(prMatch[3], 10);

      if (ticket.repository_id && !verifiedPrMetadata) {
        try {
          const repo = await getRepositoryById(ticket.repository_id);
          if (repo && (!ticket.project_id || Number(repo.project_id) === Number(ticket.project_id)) && repo.is_active) {
            verifiedPrMetadata = await verifyTicketPullRequest({ ticket, prUrl: cleanTargetPrUrl, repository: repo }).catch(() => null);
          }
        } catch {}
      }
    } else {
      // No PR URL provided -> require reason unless moved directly from board
      const qaReason = String(body.qa_reason || body.reason || body.closure_reason || '').trim();
      if (!qaReason && body.source !== 'board') {
        return NextResponse.json(
          { error: 'Please provide a reason for moving this ticket to QA Testing without a Pull Request.' },
          { status: 400 }
        );
      }
      if (qaReason) {
        closureActivityDetails = {
          reason: qaReason,
          blocker: 'QA without Pull Request',
          employeeId: session.user?.employee_id || null,
        };
      }
    }
  }

  // Closure handling when transitioning to 'closed'
  if (edits.status === 'closed') {
    const closeAuth = await assertCanCloseTicket(session.user, ticket);
    if (!closeAuth.allowed) {
      return NextResponse.json(
        { error: closeAuth.error || 'You are not authorized to close this ticket.' },
        { status: closeAuth.status || 403 }
      );
    }

    const targetPrUrl = body.pr_url !== undefined ? body.pr_url : ticket.pr_url;
    const cleanTargetPrUrl = targetPrUrl ? String(targetPrUrl).trim() : '';

    if (!cleanTargetPrUrl) {
      // Case A: Legacy ticket or ticket without a PR
      // Allow normal closure without GitHub verification
      const closureReason = String(body.closure_reason || body.reason || '').trim();
      if (closureReason) {
        closureActivityDetails = {
          reason: closureReason,
          blocker: 'Legacy ticket / No Pull Request linked',
          employeeId: closeAuth.scope?.employeeId || null,
        };
        if (body.resolution === undefined && edits.resolution === undefined) {
          edits.resolution = closureReason;
        }
      }
    } else {
      // Ticket has a PR URL -> Verify repository and perform fresh verification
      if (!ticket.repository_id) {
        const closureReason = String(body.closure_reason || body.reason || '').trim();
        if (!closureReason) {
          return NextResponse.json(
            { error: 'A repository must be assigned or a closure reason provided to close a ticket with an unlinked repository PR.' },
            { status: 400 }
          );
        }
        closureActivityDetails = {
          reason: closureReason,
          blocker: 'Ticket closed without assigned repository',
          employeeId: closeAuth.scope?.employeeId || null,
        };
        if (body.resolution === undefined && edits.resolution === undefined) {
          edits.resolution = closureReason;
        }
      } else {

      const repo = await getRepositoryById(ticket.repository_id);
      if (!repo) {
        return NextResponse.json({ error: 'Assigned repository does not exist.' }, { status: 400 });
      }
      if (ticket.project_id && Number(repo.project_id) !== Number(ticket.project_id)) {
        return NextResponse.json(
          { error: 'Assigned repository does not belong to the ticket project.' },
          { status: 400 }
        );
      }
      if (!repo.is_active) {
        return NextResponse.json(
          { error: 'The assigned repository is deactivated.' },
          { status: 400 }
        );
      }

      // Fresh GitHub API verification outside database transaction
      let prCheck = null;
      let checkError = null;

      try {
        prCheck = await verifyTicketPullRequest({ ticket, prUrl: cleanTargetPrUrl, repository: repo });
      } catch (err) {
        checkError = err;
      }

      if (prCheck) {
        verifiedPrMetadata = prCheck;
        const closureReason = String(body.closure_reason || body.reason || '').trim();

        if (prCheck.github_pr_merged === 1) {
          // Case B: Ticket with a verified, merged PR
          closureActivityDetails = {
            reason: closureReason,
            blocker: `Pull Request #${prCheck.github_pr_number} verified merged`,
            employeeId: closeAuth.scope?.employeeId || null,
          };
          if (closureReason && body.resolution === undefined && edits.resolution === undefined) {
            edits.resolution = closureReason;
          }
        } else if (prCheck.github_pr_merged === 0) {
          // Case C: Ticket with an unmerged PR
          // Mandatory closure reason required
          if (!closureReason) {
            return NextResponse.json(
              {
                error: 'Closure reason is required when closing a ticket with an unmerged Pull Request.',
                code: 'UNMERGED_PR_REASON_REQUIRED',
                prState: prCheck.github_pr_state,
                prMerged: 0,
              },
              { status: 400 }
            );
          }
          closureActivityDetails = {
            reason: closureReason,
            blocker: `Unmerged Pull Request #${prCheck.github_pr_number} (${prCheck.github_pr_state})`,
            employeeId: closeAuth.scope?.employeeId || null,
          };
          if (body.resolution === undefined && edits.resolution === undefined) {
            edits.resolution = closureReason;
          }
        } else {
          // Case D: Unknown merge status from GitHub payload
          if (!closureReason) {
            return NextResponse.json(
              {
                error: 'Closure reason is required when GitHub PR merge status is unknown.',
                code: 'UNKNOWN_PR_STATUS_REASON_REQUIRED',
                prState: prCheck.github_pr_state,
                prMerged: null,
              },
              { status: 400 }
            );
          }
          closureActivityDetails = {
            reason: closureReason,
            blocker: `PR #${prCheck.github_pr_number} Merge Status Unknown`,
            employeeId: closeAuth.scope?.employeeId || null,
          };
          if (body.resolution === undefined && edits.resolution === undefined) {
            edits.resolution = closureReason;
          }
        }
      } else {
        // If error is an invalid PR URL format, repository mismatch, or input error, reject directly
        if (
          checkError?.code === 'REPOSITORY_MISMATCH' ||
          checkError?.code === 'INVALID_PR_URL' ||
          checkError?.code === 'INVALID_INPUT' ||
          checkError?.code === 'REPOSITORY_REQUIRED' ||
          checkError?.code === 'PR_URL_REQUIRED'
        ) {
          return NextResponse.json(
            { error: checkError.message, code: checkError.code },
            { status: checkError.status || 400 }
          );
        }

        // Case D: Genuine GitHub API verification failed (outage, timeout, rate limit, auth error, 502/503)
        // Retain github_pr_merged as null / unknown
        const safeErrMsg = sanitizeGitHubErrorMessage(checkError);
        const closureReason = String(body.closure_reason || body.reason || '').trim();
        if (!closureReason) {
          return NextResponse.json(
            {
              error: `GitHub PR verification failed (${safeErrMsg}). A mandatory closure reason is required to close this ticket.`,
              code: 'UNKNOWN_PR_STATUS_REASON_REQUIRED',
              details: safeErrMsg,
            },
            { status: 400 }
          );
        }

        edits.github_pr_last_verified_at = new Date().toISOString();
        edits.github_pr_merged = null;

        closureActivityDetails = {
          reason: closureReason,
          blocker: `GitHub PR Verification Failed: ${safeErrMsg}`,
          employeeId: closeAuth.scope?.employeeId || null,
        };
        if (body.resolution === undefined && edits.resolution === undefined) {
          edits.resolution = closureReason;
        }
      }
      }
    }
  }

  if (verifiedPrMetadata) {
    edits.pr_url = verifiedPrMetadata.pr_url;
    edits.github_pr_number = verifiedPrMetadata.github_pr_number;
    edits.github_pr_title = verifiedPrMetadata.github_pr_title;
    edits.github_pr_state = verifiedPrMetadata.github_pr_state;
    edits.github_pr_merged = verifiedPrMetadata.github_pr_merged;
    edits.github_pr_head_sha = verifiedPrMetadata.github_pr_head_sha;
    edits.github_pr_base_branch = verifiedPrMetadata.github_pr_base_branch;
    edits.github_pr_last_verified_at = verifiedPrMetadata.github_pr_last_verified_at;
    edits.pr_merged_at = verifiedPrMetadata.pr_merged_at;
    edits.github_branch = verifiedPrMetadata.github_branch || '';
  }

  if (body.github_branch !== undefined && edits.github_branch === undefined) {
    edits.github_branch = String(body.github_branch ?? '').trim();
  }

  // Archiving is reversible by design, so anyone who can edit a ticket may do
  // it, and it only ever flips the flag. archived_at and archived_by are
  // cleared on restore so the archived view does not keep a stale date or name.
  if (body.archived !== undefined) {
    edits.archived = body.archived ? 1 : 0;
    edits.archived_at = edits.archived
      ? new Date().toISOString().replace('T', ' ').slice(0, 19)
      : null;
    edits.archived_by = edits.archived ? session.user.id : null;
  }

  if (body.slack_channel !== undefined) {
    const value = String(body.slack_channel ?? '').trim();
    if (value && !/^#?[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)) {
      return NextResponse.json(
        { error: 'Enter a channel name like #team-platform.' },
        { status: 400 }
      );
    }
    edits.slack_channel = value.replace(/^#/, '');
  }

  if (body.parent_id !== undefined) {
    if (body.parent_id === null || body.parent_id === '') {
      edits.parent_id = null;
    } else {
      const value = Number(body.parent_id);
      if (!Number.isInteger(value)) {
        return NextResponse.json({ error: 'Invalid parent.' }, { status: 400 });
      }
      if (value === ticketId) {
        return NextResponse.json(
          { error: 'A ticket cannot be its own parent.' },
          { status: 400 }
        );
      }
      if (!await getTicket(value)) {
        return NextResponse.json({ error: 'Parent ticket not found.' }, { status: 404 });
      }
      // Parenting is a tree, so a ticket may not move underneath one of its own
      // descendants: that would orphan the subtree in between.
      const loadParentId = async (id) => {
        const row = await db.prepare('SELECT parent_id FROM tickets WHERE id = ?').get(id);
        return row?.parent_id ?? null;
      };
      if (await wouldCreateCycle(loadParentId, ticketId, value)) {
        return NextResponse.json(
          { error: 'That would make a ticket its own ancestor.' },
          { status: 409 }
        );
      }
      edits.parent_id = value;
    }
  }

  if (body.employee_id !== undefined) {
    if (!canRoute) {
      return NextResponse.json(
        { error: 'Only the team can reassign tickets.' },
        { status: 403 }
      );
    }
    const value = body.employee_id === null || body.employee_id === '' ? null : Number(body.employee_id);
    if (value !== null && !Number.isInteger(value)) {
      return NextResponse.json({ error: 'Invalid assignee.' }, { status: 400 });
    }
    if (value !== null && !await employeeExists(value)) {
      return NextResponse.json(
        { error: 'Employee not found or deactivated.' },
        { status: 400 }
      );
    }
    // Clients raise work rather than take it. The pickers already hide them,
    // but the ids are guessable, so the rule is enforced here too.
    if (value !== null) {
      const target = await getEmployee(value);
      if (target?.role === 'client') {
        return NextResponse.json(
          { error: 'Tickets cannot be assigned to a client.' },
          { status: 400 }
        );
      }
    }
    edits.employee_id = value;
  }

  // Declared up here because the branch below fills it in before the edit
  // bookkeeping further down runs.
  let reporterName;

  if (body.created_by !== undefined) {
    // Reporter is who raised the work, keyed on the user rather than the
    // employee directory. Admin-only, like the assignee: both rewrite who a
    // ticket belongs to rather than what it says.
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Only admins can change the reporter.' },
        { status: 403 }
      );
    }
    const value = Number(body.created_by);
    if (!Number.isInteger(value)) {
      return NextResponse.json({ error: 'Invalid reporter.' }, { status: 400 });
    }
    const person = await db
      .prepare('SELECT id, name FROM users WHERE id = ?')
      .get(value);
    if (!person) {
      return NextResponse.json({ error: 'Reporter not found.' }, { status: 400 });
    }
    edits.created_by = value;
    // created_by_name is a join alias, not a column, so it must never reach
    // `edits` or it would end up in the UPDATE's SET list. The name is carried
    // separately for the activity log.
    reporterName = person.name;
  }

  const keys = Object.keys(edits);
  if (keys.length === 0) {
    if (repoChangedAtomically) {
      const updated = await getTicket(ticketId);
      return NextResponse.json({ ticket: updated });
    }
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const reassigning =
    edits.employee_id !== undefined &&
    Number(edits.employee_id || 0) !== Number(ticket.employee_id || 0);

  let nextEmployeeId = ticket.employee_id;
  const logged = new Set(keys);

  // archived_at and slack_channel are bookkeeping rather than a change to the
  // work item, and neither has a label in the activity feed, so they are
  // written but not logged. The archived flag itself is logged under
  // 'archived', which the feed does render.
  logged.delete('archived_at');
  logged.delete('archived_by');
  logged.delete('slack_channel');
  logged.delete('github_pr_number');
  logged.delete('github_pr_title');
  logged.delete('github_pr_state');
  logged.delete('github_pr_merged');
  logged.delete('github_pr_head_sha');
  logged.delete('github_pr_base_branch');
  logged.delete('github_pr_last_verified_at');
  logged.delete('pr_merged_at');
  logged.delete('github_branch');
  if (edits.archived !== undefined && edits.archived !== Number(ticket.archived || 0)) {
    // The column is 0/1. The feed reads "Active" and "Archived" instead, the
    // same way a parent change is logged as a key rather than an id.
    await logActivityChanges(
      ticketId,
      session.user.id,
      { archived: Number(ticket.archived) ? 'Archived' : 'Active' },
      { archived: edits.archived ? 'Archived' : 'Active' },
      ['archived']
    );
  }
  logged.delete('archived');

  // Moving an unassigned ticket into a status claims it for the actor, matching
  // the behaviour the board and list already had.
  const autoClaim =
    !reassigning &&
    edits.status !== undefined &&
    !ticket.employee_id &&
    Boolean(session.user.employee_id);

  if (reassigning) {
    nextEmployeeId = edits.employee_id || null;
  } else if (autoClaim) {
    nextEmployeeId = session.user.employee_id;
    logged.add('employee_id');
  }

  // [sql, value, hasBind] so a cleared field still binds NULL instead of being
  // dropped and shifting every later placeholder.
  const validSources = new Set(['board', 'list', 'detail', 'task_sheet', 'api', 'archive']);
  const transitionSource = validSources.has(body.source) ? body.source : 'api';

  if (edits.status !== undefined) {
    const extraUpdates = { ...edits };
    delete extraUpdates.status;
    if (autoClaim) extraUpdates.employee_id = nextEmployeeId || null;

    try {
      await transitionTicketStatus({
        ticketId,
        toStatus: edits.status,
        actor: session.user,
        source: transitionSource,
        idempotencyKey: body.idempotency_key || body.idempotencyKey || null,
        expectedCurrentStatus: body.expected_status || body.expectedStatus || initialStatus,
        expectedRepositoryId: body.expected_repository_id !== undefined ? Number(body.expected_repository_id) : initialRepoId,
        expectedPrUrl: body.expected_pr_url !== undefined ? body.expected_pr_url : initialPrUrl,
        extraUpdates,
        activity: closureActivityDetails
          ? {
              field: 'status',
              from_value: initialStatus,
              to_value: edits.status,
              blocker: closureActivityDetails.blocker,
              reason: closureActivityDetails.reason,
              employee_id: closureActivityDetails.employeeId,
            }
          : null,
      });
    } catch (transitionErr) {
      return NextResponse.json(
        { error: transitionErr.message || 'Status transition failed.' },
        { status: transitionErr.statusCode || 409 }
      );
    }
  } else {
    // Strict optimistic concurrency verification before non-status update
    const currentTicket = await db.prepare('SELECT status, repository_id, pr_url FROM tickets WHERE id = ?').get(ticketId);
    if (currentTicket) {
      if (initialStatus && currentTicket.status !== initialStatus) {
        return NextResponse.json(
          { error: `Ticket status changed concurrently (expected "${initialStatus}", found "${currentTicket.status}").` },
          { status: 409 }
        );
      }
      if (initialRepoId !== null && Number(currentTicket.repository_id || 0) !== Number(initialRepoId || 0)) {
        return NextResponse.json(
          { error: `Ticket repository changed concurrently (expected ID ${initialRepoId}, found ${currentTicket.repository_id}).` },
          { status: 409 }
        );
      }
      const curPr = (currentTicket.pr_url == null ? '' : String(currentTicket.pr_url)).trim();
      const expPr = body.expected_pr_url !== undefined
        ? (body.expected_pr_url == null ? '' : String(body.expected_pr_url)).trim()
        : initialPrUrl;
      if (curPr !== expPr) {
        return NextResponse.json(
          { error: `Ticket PR URL changed concurrently (expected "${expPr}", found "${curPr}").` },
          { status: 409 }
        );
      }
    }

    const pairs = keys.map((field) => [`${field} = ?`, edits[field], true]);
    if (autoClaim) pairs.push(['employee_id = ?', nextEmployeeId || null, true]);
    pairs.push(["updated_at = datetime('now')", null, false]);

    const assignments = pairs.map(([sql]) => sql);
    const values = pairs.filter(([, , binds]) => binds).map(([, value]) => value);
    values.push(ticketId);

    await db.prepare(`UPDATE tickets SET ${assignments.join(', ')} WHERE id = ?`).run(values);
  }

  if (edits.archived !== undefined && edits.archived !== Number(ticket.archived || 0)) {
    await syncStageOnArchiveState({ ticketId, archived: edits.archived, actor: session.user });
  }

  // Activity reads far better with ticket keys than with raw ids, so translate
  // the parent change on the way into the history. The stored column keeps the
  // id; only the human-facing log gets the pretty form.
  if (edits.parent_id !== undefined) {
    const [beforeParent, afterParent] = await Promise.all([
      keyOf(ticket.parent_id),
      keyOf(edits.parent_id),
    ]);
    await logActivityChanges(
      ticketId,
      session.user.id,
      { ...ticket, parent_id: beforeParent },
      { ...ticket, ...edits, parent_id: afterParent },
      ['parent_id']
    );
    logged.delete('parent_id');
  }

  // Same idea as the parent translation above: the column keeps an id, the
  // history keeps the name, because nobody wants to read "changed Reporter 4
  // to 11" in an activity feed.
  if (edits.created_by !== undefined) {
    await logActivityChanges(
      ticketId,
      session.user.id,
      { ...ticket, created_by: ticket.created_by_name },
      { ...ticket, created_by: reporterName },
      ['created_by']
    );
    logged.delete('created_by');
  }

  // Assignment is translated the same way, so a reassignment (or the auto-claim
  // that happens when an unassigned ticket moves into a status) reads
  // "changed Assignee Alice to Bob" rather than a pair of raw ids.
  if (
    logged.has('employee_id') &&
    Number(ticket.employee_id || 0) !== Number(nextEmployeeId || 0)
  ) {
    const nextEmployee = nextEmployeeId ? await getEmployee(nextEmployeeId) : null;
    await logActivityChanges(
      ticketId,
      session.user.id,
      { employee_id: ticket.employee_name || '' },
      { employee_id: nextEmployee?.name || '' },
      ['employee_id']
    );
    logged.delete('employee_id');
  }

  if (dueDateChangeDetails) {
    await logDueDateChange(
      ticketId,
      session.user.id,
      dueDateChangeDetails.from,
      dueDateChangeDetails.to,
      dueDateChangeDetails.blocker,
      dueDateChangeDetails.reason,
      dueDateChangeDetails.employeeId
    );
    logged.delete('due_date');
  }

  if (closureActivityDetails) {
    logged.delete('status');
  }

  await logActivityChanges(
    ticketId,
    session.user.id,
    ticket,
    { ...ticket, ...edits, employee_id: nextEmployeeId },
    [...logged]
  );

  const updated = await getTicket(ticketId);
  const notifications = [];

  // The in-app feed records every kind of change -- status, priority, due date,
  // resolution, assignment and a summary of the rest -- to every admin and
  // developer. The email sends below stay targeted at the assignee, so the two
  // layers have different audiences on purpose.
  //
  // Delivery is best-effort: it runs after the ticket row and the activity rows
  // are already committed, so a mailing or notification failure must not fail
  // the response. Activity logging above stays awaited and unguarded, so a real
  // logging error still surfaces instead of being swallowed here.
  try {
    await notifyTicketUpdated({
      before: ticket,
      after: updated,
      actorId: session.user.id,
      actorName: session.user.name,
      fields: Object.keys(edits),
      blocker: dueDateChangeDetails?.blocker || '',
    });

    if (reassigning && nextEmployeeId) {
      const employee = await getEmployee(nextEmployeeId);
      if (employee) {
        try {
          const { notifyTicketCreatedEmail } = await import('@/lib/mail');
          await notifyTicketCreatedEmail({
            ticket: updated,
            employee,
            actorName: session.user.name,
          });
        } catch (e) {
          console.error('Reassignment email failed:', e);
        }
      }
      const notification = await notifyAssignment({
        ticket: updated,
        employee,
        actorName: session.user.name,
        trigger: 'reassignment',
      });
      if (notification) notifications.push(notification);
    }

    if (edits.status !== undefined && updated.status === 'in_progress' && nextEmployeeId) {
      const employee = await getEmployee(nextEmployeeId);
      const isSelf = employee?.email === session.user.email;
      if (!isSelf && employee) {
        try {
          const { notifyStatusChange } = await import('@/lib/mail');
          const notification = await notifyStatusChange({
            ticket: updated,
            employee,
            actorName: session.user.name,
            status: updated.status,
          });
          if (notification) notifications.push(notification);
        } catch (e) {
          console.error('Status email failed:', e);
        }
      }
    }

    // Send update emails for other changes to current assignee
    if (updated.employee_id) {
      const assigneeEmp = await getEmployee(updated.employee_id);
      if (assigneeEmp && assigneeEmp.email && !reassigning) {
        const changes = [];
        if (edits.title !== undefined) changes.push({ label: 'Title', from: ticket.title, to: edits.title });
        if (edits.description !== undefined) changes.push({ label: 'Description', from: ticket.description ? '(updated)' : '(empty)', to: edits.description ? '(updated)' : '(empty)' });
        if (edits.status !== undefined) changes.push({ label: 'Status', from: ticket.status, to: edits.status });
        if (edits.priority !== undefined) changes.push({ label: 'Priority', from: ticket.priority, to: edits.priority });
        if (edits.type !== undefined) changes.push({ label: 'Issue type', from: ticket.type, to: edits.type });
        if (edits.start_date !== undefined) changes.push({ label: 'Start date', from: ticket.start_date || 'None', to: edits.start_date || 'None' });
        if (edits.due_date !== undefined) changes.push({ label: 'Due date', from: ticket.due_date || 'None', to: edits.due_date || 'None' });
        if (edits.category !== undefined) changes.push({ label: 'Category', from: ticket.category || 'None', to: edits.category || 'None' });
        if (edits.resolution !== undefined) changes.push({ label: 'Resolution', from: ticket.resolution || 'None', to: edits.resolution || 'None' });
        if (edits.labels !== undefined) changes.push({ label: 'Labels', from: ticket.labels || 'None', to: edits.labels || 'None' });
        if (changes.length > 0) {
          try {
            const { notifyTicketUpdatedEmail } = await import('@/lib/mail');
            await notifyTicketUpdatedEmail({
              ticket: updated,
              employee: assigneeEmp,
              actorName: session.user.name,
              changes,
            });
          } catch (e) {
            console.error('Update email failed:', e);
          }
        }
      }
    }
  } catch (err) {
    console.error('Ticket updated, but notifications failed:', err);
  }

  // Child work items are a separate choice. The dialog asks, and only a checked
  // box walks the branch. Descendants already in the target state are left
  // alone so a second archive does not rewrite their archived date.
  const affected = [updated];
  if (body.includeChildren && edits.archived !== undefined) {
    const want = edits.archived;
    const descendants = await descendantTickets(ticketId);
    for (const child of descendants) {
      if (child.archived === want) continue;
      await db
        .prepare(
          `UPDATE tickets
           SET archived = ?, archived_at = ?, archived_by = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run([want, edits.archived_at, edits.archived_by, child.id]);
      await syncStageOnArchiveState({ ticketId: child.id, archived: want, actor: session.user });
      await logActivityChanges(
        child.id,
        session.user.id,
        { archived: child.archived ? 'Archived' : 'Active' },
        { archived: want ? 'Archived' : 'Active' },
        ['archived']
      );
      const row = await getTicket(child.id);
      if (row) affected.push(row);
    }
  }

  return NextResponse.json({ ticket: updated, affected, notifications });
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Deletion is the counterpart of creation, which the POST route already
  // reserves for admins/owners, so the two stay symmetrical.
  if (!isAdminOrOwner(session.user)) {
    return NextResponse.json(
      { error: 'Only Business Owners or Administrators can delete work items.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const ticket = await getTicket(id);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const children = await childTicketCount(ticket.id);

  try {
    const { attachments } = await deleteTicket(ticket.id);

    // Storage cleanup is best effort: the database rows are already committed and gone,
    // and a failed object delete should not turn a completed delete into an error.
    if (Array.isArray(attachments) && attachments.length > 0) {
      await Promise.allSettled(
        attachments
          .filter((a) => a?.storage_key)
          .map((a) => deleteAttachment(a.storage_key).catch(() => {}))
      );
    }

    return NextResponse.json({
      deleted: true,
      ticket: { id: ticket.id, title: ticket.title },
      // Children survive and are re-parented one level up, so the caller can say
      // so rather than implying the whole branch went with the parent.
      reparentedChildren: children,
    });
  } catch (err) {
    console.error(`[API /api/tickets/[id]] DELETE error for ticket ${ticket.id}:`, err);
    return NextResponse.json(
      { error: err.message || 'Failed to delete ticket.' },
      { status: 500 }
    );
  }
}
