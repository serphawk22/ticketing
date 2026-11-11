import { NextResponse, after } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getAllTickets, getTicket, getTicketsForClient, getTicketsForProject, getTicketsForEmployee } from '@/lib/tickets';
import { employeeExists, getEmployee } from '@/lib/employees';
import { notifyAssignment } from '@/lib/mail';
import { notifyTicketAssigned, notifyTicketCreated } from '@/lib/notifications';
import { logCreated } from '@/lib/ticketActivity';
import { canRouteWork, resolveUserScope } from '@/lib/rbac';
import { createTicketWithStage } from '@/lib/ticketStageService';
import { TASK_SHEET_SESSION_COOKIE, validateTaskSheetCookieSession } from '@/lib/taskSheetTokens';

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_TYPES = ['task', 'bug', 'story', 'epic'];

export async function GET(request) {
  const url = request ? new URL(request.url) : null;
  const projectIdParam = url?.searchParams.get('projectId');
  const projectId = projectIdParam ? Number(projectIdParam) : null;
  const excludeClosed = url?.searchParams.get('excludeClosed') === 'true' || url?.searchParams.get('excludeClosed') === '1';
  const userName = (url?.searchParams.get('userName') || url?.searchParams.get('user') || '').trim();
  const employeeIdParam = url?.searchParams.get('employee_id') ?? url?.searchParams.get('employeeId');

  const session = await requireAuth();
  if (!session) {
    // Allow strictly scoped reads for token-authenticated shared Task Sheet sessions when projectId is supplied
    const cookieStore = await cookies();
    const tsCookie = cookieStore.get(TASK_SHEET_SESSION_COOKIE)?.value || '';
    const tsSession = await validateTaskSheetCookieSession({ sessionCookieValue: tsCookie });
    if (!tsSession || !projectId || !Number.isInteger(projectId)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    let tickets = await getTicketsForProject(projectId);
    const empNameLower = tsSession.employee.name.toLowerCase();
    tickets = tickets.filter(
      (t) =>
        Number(t.employee_id) === tsSession.employee.id ||
        (t.employee_name && t.employee_name.toLowerCase() === empNameLower) ||
        (t.assigned_to_name && t.assigned_to_name.toLowerCase() === empNameLower) ||
        (tsSession.employee.user_id && Number(t.assigned_to) === Number(tsSession.employee.user_id))
    );
    if (excludeClosed) {
      tickets = tickets.filter((t) => t.status !== 'closed');
    }
    return NextResponse.json({ role: 'employee', tickets });
  }

  let employeeId = null;

  if (employeeIdParam !== null && employeeIdParam !== undefined && employeeIdParam !== '') {
    const parsed = Number(employeeIdParam);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json({ error: 'Invalid employee ID.' }, { status: 400 });
    }
    employeeId = parsed;
  }

  const scope = await resolveUserScope(session.user);

  // Clients see only tickets they raised; managers see scoped union; owners/admins/employees see board
  let tickets;
  if (scope.isClient) {
    tickets = await getTicketsForClient(session.user.id);
    if (projectId && Number.isInteger(projectId)) {
      tickets = tickets.filter((t) => t.project_id === projectId);
    }
  } else if (projectId && Number.isInteger(projectId)) {
    if (scope.isManager && !scope.scopedProjectIds.has(projectId)) {
      return NextResponse.json({ error: 'Forbidden: project is outside your management scope.' }, { status: 403 });
    }
    tickets = await getTicketsForProject(projectId);
  } else if (employeeId !== null) {
    if (scope.isManager && !scope.scopedEmployeeIds.has(employeeId)) {
      return NextResponse.json({ error: 'Forbidden: employee is outside your management scope.' }, { status: 403 });
    }
    tickets = await getTicketsForEmployee(employeeId);
  } else {
    tickets = await getAllTickets();
    if (scope.isManager) {
      tickets = tickets.filter(
        (t) =>
          (t.employee_id != null && scope.scopedEmployeeIds.has(Number(t.employee_id))) ||
          (t.project_id != null && scope.scopedProjectIds.has(Number(t.project_id))) ||
          Number(t.created_by) === Number(session.user.id) ||
          Number(t.assigned_to) === Number(session.user.id)
      );
    }
  }

  if (excludeClosed) {
    tickets = tickets.filter((t) => t.status !== 'closed');
  }

  if (userName) {
    tickets = tickets.filter(
      (t) => t.employee_name === userName || t.assigned_to_name === userName
    );
  }

  if (employeeId !== null) {
    tickets = tickets.filter((t) => Number(t.employee_id) === employeeId);
  }

  return NextResponse.json({
    role: session.user.role,
    tickets,
  });
}

async function sendCreationNotifications({ ticket, actorId, actorName, assignee }) {
  try {
    await notifyTicketCreated({ ticket, actorId, actorName });

    if (assignee) {
      const employee = await getEmployee(assignee);
      if (employee) {
        try {
          const { notifyTicketCreatedEmail } = await import('@/lib/mail');
          await notifyTicketCreatedEmail({ ticket, employee, actorName });
        } catch (e) {
          console.error('Ticket created email failed:', e);
        }
      }
      await notifyAssignment({
        ticket,
        employee,
        actorName,
        trigger: 'assignment',
      });
      await notifyTicketAssigned({
        ticket,
        actorId,
        actorName,
        employeeName: employee?.name,
        trigger: 'assignment',
      });
    }
  } catch (err) {
    console.error('Ticket created, but notifications failed:', err);
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Routing the work -- naming an assignee or nesting it in the tree -- is a
  // team decision, so both team roles may take it. A requester still may not:
  // their values are dropped rather than trusted, and the ticket arrives for
  // triage.
  const canRoute = canRouteWork(session.user);

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

  let resolvedProjectId = project_id || null;
  if (parent && !resolvedProjectId) {
    try {
      const parentTicket = await getTicket(parent);
      if (parentTicket?.project_id) {
        resolvedProjectId = parentTicket.project_id;
      }
    } catch {}
  }

  const created = await createTicketWithStage({
    title: title.trim(),
    description: description.trim(),
    priority,
    type,
    createdBy: session.user.id,
    projectId: resolvedProjectId || null,
    employeeId: assignee || null,
    parentId: parent || null,
    startDate: start,
    dueDate: due,
    labels: String(labels || '').trim(),
    category: String(category || '').trim(),
    source: 'create',
  });

  const ticket = await getTicket(created.id);

  // The history opens with the creation itself, so the timeline has a start
  // even before anything is edited.
  await logCreated(ticket.id, session.user.id);

  // Notifications and email fan out per recipient, and SMTP delivery can take
  // several seconds. The ticket row and its creation activity are already
  // committed, so run that best-effort work after the response so the creator
  // gets the new ticket immediately.
  after(() =>
    sendCreationNotifications({
      ticket,
      actorId: session.user.id,
      actorName: session.user.name,
      assignee,
    })
  );

  return NextResponse.json({ ticket }, { status: 201 });
}
