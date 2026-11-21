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
