import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import {
  TASK_STATES,
  createSubmission,
  listSubmissions,
  listSubmissionFacets,
} from '@/lib/taskSheet';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await getSession();

  const body = await request.json().catch(() => ({}));

  // The sheet is a shareable link, so POST accepts a signed-out visitor and
  // records them as an anonymous file. submitted_by is taken from the session
  // only, never from the body, whatever the name dropdown says: the name answer
  // is the person's own pick from the list, the way the external form was
  // answered, and the countersigning session is the one fact the server knows
  // for certain.
  const submittedBy = session ? session.user.id : null;
  const name = String(body.name ?? '').trim();
  const project = String(body.project ?? '').trim();
  const taskTitle = String(body.taskTitle ?? '').trim();
  const taskDescription = String(body.taskDescription ?? '').trim();
  const taskState = String(body.taskState ?? '').trim();
  const blocker = String(body.blocker ?? '').trim();
  const hoursWorked = Number(body.hoursWorked);

  if (!name) return NextResponse.json({ error: 'Please select your name.' }, { status: 400 });
  if (!project) {
    return NextResponse.json({ error: 'Please select a project.' }, { status: 400 });
  }
  if (!taskTitle) {
    return NextResponse.json({ error: 'Please enter a task title or number.' }, { status: 400 });
  }
  if (!taskDescription) {
    return NextResponse.json({ error: 'Please describe the task.' }, { status: 400 });
  }
  if (!Number.isFinite(hoursWorked) || hoursWorked <= 0) {
    return NextResponse.json(
      { error: 'Approximate hours worked must be a positive number.' },
      { status: 400 }
    );
  }
  if (!TASK_STATES.includes(taskState)) {
    return NextResponse.json({ error: 'Please choose a task state.' }, { status: 400 });
  }
  const selectedTickets = Array.isArray(body.selectedTickets) ? body.selectedTickets : [];

  // Validate per-ticket blockers if tickets were selected, or general blocker otherwise
  if (selectedTickets.length > 0) {
    for (const t of selectedTickets) {
      if (t.workState === 'not_completed' && !String(t.blocker ?? '').trim()) {
        return NextResponse.json(
          { error: `Please describe what is blocking #${t.key || t.id}.` },
          { status: 400 }
        );
      }
    }
  } else {
    if (taskState === 'not_completed' && !blocker) {
      return NextResponse.json(
        { error: 'Please describe what is blocking this task.' },
        { status: 400 }
      );
    }
  }

  let blockerText = null;
  if (selectedTickets.length > 0) {
    const blockers = selectedTickets
      .filter((t) => t.workState === 'not_completed' && t.blocker?.trim())
      .map((t) => `#${t.key}: ${t.blocker.trim()}`);
    if (blockers.length > 0) {
      blockerText = blockers.join('; ');
    } else if (taskState === 'not_completed') {
      blockerText = blocker || null;
    }
  } else {
    blockerText = taskState === 'not_completed' ? blocker : null;
  }

  // The ticket link is a convenience, so an id that does not resolve is dropped
  // rather than failing the whole sheet: an unlinked timesheet line still says
  // what was worked on.
  let linkedTicketId = null;

  if (selectedTickets.length > 0) {
    for (const t of selectedTickets) {
      const tid = Number(t.id);
      if (!Number.isInteger(tid) || tid <= 0) continue;
      const exists = await db
        .prepare('SELECT id, status, project_id FROM tickets WHERE id = ?')
        .get(tid);
      if (exists) {
        if (!linkedTicketId) linkedTicketId = tid;

        // When syncResolved is requested explicitly for this completed ticket:
        // update the ticket status to 'resolved'.
        if (t.workState === 'completed' && t.syncResolved === true) {
          if (exists.status !== 'resolved' && exists.status !== 'closed') {
            await db
              .prepare("UPDATE tickets SET status = 'resolved', updated_at = datetime('now') WHERE id = ?")
              .run(tid);

            const { logActivity } = await import('@/lib/ticketActivity');
            await logActivity(tid, submittedBy, 'status', exists.status, 'resolved');
          }
        }

        // Record time log against the ticket if submitted by a registered user
        if (submittedBy && hoursWorked > 0) {
          const seconds = Math.min(
            Math.round((hoursWorked / selectedTickets.length) * 3600),
            24 * 3600
          );
          await db
            .prepare(
              'INSERT INTO ticket_time_logs (ticket_id, user_id, seconds, note) VALUES (?, ?, ?, ?)'
            )
            .run(
              tid,
              submittedBy,
              seconds,
              `Task Sheet: ${t.title || taskTitle}${taskDescription ? ` — ${taskDescription}` : ''}`
            );
        }
      }
    }
  } else {
    const candidate = Number(body.linkedTicketId);
    if (Number.isInteger(candidate) && candidate > 0) {
      const exists = await db
        .prepare('SELECT id, status, project_id FROM tickets WHERE id = ?')
        .get(candidate);
      if (exists) {
        linkedTicketId = candidate;

        if (body.syncTicketStatus !== false && taskState === 'completed') {
          if (exists.status !== 'resolved' && exists.status !== 'closed') {
            await db
              .prepare("UPDATE tickets SET status = 'resolved', updated_at = datetime('now') WHERE id = ?")
              .run(linkedTicketId);

            const { logActivity } = await import('@/lib/ticketActivity');
            await logActivity(linkedTicketId, submittedBy, 'status', exists.status, 'resolved');
          }
        }

        if (submittedBy && hoursWorked > 0) {
          const seconds = Math.min(Math.round(hoursWorked * 3600), 24 * 3600);
          await db
            .prepare(
              'INSERT INTO ticket_time_logs (ticket_id, user_id, seconds, note) VALUES (?, ?, ?, ?)'
            )
            .run(
              linkedTicketId,
              submittedBy,
              seconds,
              `Task Sheet: ${taskTitle}${taskDescription ? ` — ${taskDescription}` : ''}`
            );
        }
      }
    }
  }

  const ticketsDetail =
    selectedTickets.length > 0 ? JSON.stringify(selectedTickets) : null;

  const submission = await createSubmission({
    submittedBy,
    name,
    project,
    hoursWorked,
    taskTitle,
    taskDescription,
    taskState,
    blocker: blockerText,
    linkedTicketId,
    ticketsDetail,
  });

  return NextResponse.json({ submission }, { status: 201 });
}

/** The history is a manager's view, so it is admin-only on both page and API. */
export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can read the task sheet history.' },
      { status: 403 }
    );
  }

  const params = new URL(request.url).searchParams;
  const submissions = await listSubmissions({
    name: params.get('name') || '',
    project: params.get('project') || '',
    from: params.get('from') || '',
    to: params.get('to') || '',
    limit: Number(params.get('limit')) || 500,
  });
  const facets = await listSubmissionFacets();

  return NextResponse.json({ submissions, ...facets });
}
