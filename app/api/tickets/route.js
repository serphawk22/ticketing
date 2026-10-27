import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getAllTickets, getTicket, getTicketsForClient, getTicketsForProject } from '@/lib/tickets';
import { employeeExists, getEmployee } from '@/lib/employees';
import { notifyAssignment } from '@/lib/mail';
import { notifyTicketAssigned, notifyTicketCreated } from '@/lib/notifications';
import { logCreated } from '@/lib/ticketActivity';

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_TYPES = ['task', 'bug', 'story', 'epic'];

export async function GET(request) {
  const session = await requireAuth();
  const url = request ? new URL(request.url) : null;
  const projectIdParam = url?.searchParams.get('projectId');
  const projectId = projectIdParam ? Number(projectIdParam) : null;
  const excludeClosed = url?.searchParams.get('excludeClosed') === 'true' || url?.searchParams.get('excludeClosed') === '1';
  const userName = (url?.searchParams.get('userName') || url?.searchParams.get('user') || '').trim();

  // If unauthenticated but requesting project-specific tickets for the task sheet:
  if (!session) {
    if (projectId && Number.isInteger(projectId)) {
      let tickets = await getTicketsForProject(projectId);
      if (excludeClosed) {
        tickets = tickets.filter((t) => t.status !== 'closed');
      }
      if (userName) {
        tickets = tickets.filter(
          (t) => t.employee_name === userName || t.assigned_to_name === userName
        );
      }
      const safeTickets = tickets.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        type: t.type,
        project_id: t.project_id,
        project_name: t.project_name,
        project_key: t.project_key,
        employee_name: t.employee_name,
        assigned_to_name: t.assigned_to_name,
      }));
      return NextResponse.json({ tickets: safeTickets });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // A client account is scoped to its own requests. The team roles read the
  // whole board as before, or scoped by project if projectId is supplied.
  let tickets;
  if (session.user.role === 'client') {
    tickets = await getTicketsForClient(session.user.id);
    if (projectId && Number.isInteger(projectId)) {
      tickets = tickets.filter((t) => t.project_id === projectId);
    }
  } else if (projectId && Number.isInteger(projectId)) {
    tickets = await getTicketsForProject(projectId);
  } else {
    tickets = await getAllTickets();
  }

  if (excludeClosed) {
    tickets = tickets.filter((t) => t.status !== 'closed');
  }

  if (userName) {
    tickets = tickets.filter(
      (t) => t.employee_name === userName || t.assigned_to_name === userName
    );
  }

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

  // The history opens with the creation itself, so the timeline has a start
  // even before anything is edited.
  await logCreated(ticket.id, session.user.id);

  // Every admin and developer hears about the new ticket, regardless of who
  // raised it or which project it landed in. The assignment is its own event on
  // top, the same split the email layer makes.
  //
  // Best-effort for the same reason as above: the ticket row and its creation
  // activity row are committed, so a delivery failure must not turn the create
  // into a 500 and leave the client without its new ticket.
  let notification = null;
  try {
    await notifyTicketCreated({
      ticket,
      actorId: session.user.id,
      actorName: session.user.name,
    });

    if (assignee) {
      const employee = await getEmployee(assignee);
      notification = await notifyAssignment({
        ticket,
        employee,
        actorName: session.user.name,
        trigger: 'assignment',
      });
      await notifyTicketAssigned({
        ticket,
        actorId: session.user.id,
        actorName: session.user.name,
        employeeName: employee?.name,
        trigger: 'assignment',
      });
    }
  } catch (err) {
    console.error('Ticket created, but notifications failed:', err);
  }

  return NextResponse.json({ ticket, notification }, { status: 201 });
}
