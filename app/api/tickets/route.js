import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getAllTickets, getTicket } from '@/lib/tickets';
import { employeeExists, getEmployee } from '@/lib/employees';
import { notifyAssignment } from '@/lib/mail';

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_TYPES = ['task', 'bug', 'story', 'epic'];

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    role: session.user.role,
    tickets: await getAllTickets(),
  });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = session.user.role === 'admin';

  const {
    title,
    description,
    priority = 'medium',
    type = 'task',
    project_id = null,
    employee_id = null,
    parent_id = null,
    due_date = null,
    labels = '',
    category = '',
  } = await request.json();

  // Anyone signed in may raise a ticket -- that is the whole point of the
  // raise-a-ticket panel. What a requester may not do is route the work:
  // assigning it to a person or nesting it in the tree is a decision the team
  // makes, so those two fields are dropped rather than trusted and the ticket
  // arrives for triage.
  const assignee = isAdmin ? employee_id : null;
  const parent = isAdmin ? parent_id : null;

  if (!title?.trim() || !description?.trim()) {
    return NextResponse.json({ error: 'Title and description are required.' }, { status: 400 });
  }

  if (!VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json({ error: 'Invalid priority.' }, { status: 400 });
  }

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid type.' }, { status: 400 });
  }

  // The calendar can hand over a due date with the create, so the new ticket
  // lands on the day the user clicked rather than in the unscheduled list.
  // Stored as a bare YYYY-MM-DD, the same shape the PATCH route accepts.
  if (due_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(due_date).trim())) {
    return NextResponse.json({ error: 'Invalid due date.' }, { status: 400 });
  }
  const due = due_date ? String(due_date).trim() : null;

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
      `INSERT INTO tickets (title, description, priority, type, created_by, project_id, employee_id, parent_id, due_date, labels, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title.trim(),
      description.trim(),
      priority,
      type,
      session.user.id,
      project_id || null,
      assignee || null,
      parent || null,
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
