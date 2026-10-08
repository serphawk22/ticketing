import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getAllTickets, getTicket, getTicketsForClient } from '@/lib/tickets';
import { employeeExists, getEmployee } from '@/lib/employees';
import { notifyAssignment } from '@/lib/mail';

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_TYPES = ['task', 'bug', 'story', 'epic'];

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // A client account is scoped to its own requests. The team roles read the
  // whole board as before.
  const tickets =
    session.user.role === 'client'
      ? await getTicketsForClient(session.user.id)
      : await getAllTickets();

  return NextResponse.json({
    role: session.user.role,
    tickets,
  });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Routing the work -- naming an assignee or nesting it in the tree -- is a
  // team decision, so both team roles may take it. A requester still may not:
  // their values are dropped rather than trusted, and the ticket arrives for
  // triage.
  const canRoute = session.user.role === 'admin' || session.user.role === 'developer';

  const {
    title,
    description,
    priority = 'medium',
    type = 'task',
    project_id = null,
    employee_id = null,
    parent_id = null,
    due_date = null,
    start_date = null,
    labels = '',
    category = '',
  } = await request.json();

  // Anyone signed in may raise a ticket -- that is the whole point of the
  // raise-a-ticket panel. Only the team roles above may route it, so a
  // requester's values are dropped rather than trusted.
  const assignee = canRoute ? employee_id : null;
  const parent = canRoute ? parent_id : null;

  if (!title?.trim() || !description?.trim()) {
    return NextResponse.json({ error: 'Title and description are required.' }, { status: 400 });
  }

  if (!VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json({ error: 'Invalid priority.' }, { status: 400 });
  }

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid type.' }, { status: 400 });
  }

  // The calendar hands over a due date, and the timeline hands over both ends
  // of a drag, so the new ticket lands on the range the user drew. Stored as
  // bare YYYY-MM-DD strings, the same shape the PATCH route accepts.
  if (due_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(due_date).trim())) {
    return NextResponse.json({ error: 'Invalid due date.' }, { status: 400 });
  }
  if (start_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(start_date).trim())) {
    return NextResponse.json({ error: 'Invalid start date.' }, { status: 400 });
  }
  const due = due_date ? String(due_date).trim() : null;
  const start = start_date ? String(start_date).trim() : null;
  if (start && due && start > due) {
    return NextResponse.json(
      { error: 'Start date must be on or before the due date.' },
      { status: 400 }
    );
  }

  if (assignee && !await employeeExists(assignee)) {
    return NextResponse.json(
      { error: 'Employee not found or deactivated.' },
      { status: 400 }
    );
  }

  // Creating a child is a normal create that happens to name a parent. The
  // parent has to exist; a new ticket cannot yet be an ancestor of anything.
  if (parent && !(await getTicket(parent))) {
    return NextResponse.json({ error: 'Parent ticket not found.' }, { status: 400 });
  }

  const info = await db
    .prepare(
      `INSERT INTO tickets (title, description, priority, type, created_by, project_id, employee_id, parent_id, start_date, due_date, labels, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title.trim(),
      description.trim(),
      priority,
      type,
      session.user.id,
      project_id || null,
      // assignee/parent are the gated forms of employee_id/parent_id,
      // so a requester cannot self-assign or nest work by naming it directly.
      assignee || null,
      parent || null,
      start,
      due,
      String(labels || '').trim(),
      String(category || '').trim()
    );

  const ticket = await getTicket(info.lastInsertRowid);

  let notification = null;
  if (assignee) {
    const employee = await getEmployee(assignee);
    notification = await notifyAssignment({
      ticket,
      employee,
      actorName: session.user.name,
      trigger: 'assignment',
    });
  }

  return NextResponse.json({ ticket, notification }, { status: 201 });
}
