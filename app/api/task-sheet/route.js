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
  // A completed row has nothing blocked, so the answer is only recorded for
  // work that was left open, and there it is required: "not completed" without
  // a reason tells the reader nothing they could act on.
  const blockerText = taskState === 'not_completed' ? blocker : null;
  if (taskState === 'not_completed' && !blocker) {
    return NextResponse.json(
      { error: 'Please describe what is blocking this task.' },
      { status: 400 }
    );
  }

  // The ticket link is a convenience, so an id that does not resolve is dropped
  // rather than failing the whole sheet: an unlinked timesheet line still says
  // what was worked on.
  let linkedTicketId = null;
  const candidate = Number(body.linkedTicketId);
  if (Number.isInteger(candidate) && candidate > 0) {
    const exists = await db
      .prepare('SELECT id FROM tickets WHERE id = ?')
      .get(candidate);
    if (exists) linkedTicketId = candidate;
  }

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
