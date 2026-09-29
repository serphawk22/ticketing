import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { employeeExists, getEmployee } from '@/lib/employees';
import { notifyAssignment, notifyStatusChange } from '@/lib/mail';

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const VALID_TYPES = ['task', 'bug', 'story', 'epic'];

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const { status, employee_id, type } = await request.json();
  const isAdmin = session.user.role === 'admin';

  if (status === undefined && employee_id === undefined && type === undefined) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }

  if (type !== undefined && !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid type.' }, { status: 400 });
  }

  const reassigning = employee_id !== undefined && Number(employee_id || 0) !== Number(ticket.employee_id || 0);

  if (reassigning && !isAdmin) {
    return NextResponse.json(
      { error: 'Only admins can reassign tickets.' },
      { status: 403 }
    );
  }

  // Editing fields other than status is admin-only, matching ticket creation.
  if ((type !== undefined || employee_id !== undefined) && !isAdmin) {
    return NextResponse.json(
      { error: 'Only admins can edit tickets.' },
      { status: 403 }
    );
  }

  if (reassigning && employee_id && !await employeeExists(employee_id)) {
    return NextResponse.json(
      { error: 'Employee not found or deactivated.' },
      { status: 400 }
    );
  }

  const nextStatus = status ?? ticket.status;
  const nextType = type ?? ticket.type ?? 'task';
  let nextEmployeeId = ticket.employee_id;

  if (reassigning) {
    nextEmployeeId = employee_id || null;
  } else if (status !== undefined && !ticket.employee_id && session.user.employee_id) {
    nextEmployeeId = session.user.employee_id;
  }

  await db.prepare(
    `UPDATE tickets
     SET status = ?, type = ?, employee_id = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(nextStatus, nextType, nextEmployeeId || null, ticketId);

  const updated = await getTicket(ticketId);
  const notifications = [];

  if (reassigning && nextEmployeeId) {
    const employee = await getEmployee(nextEmployeeId);
    const notification = await notifyAssignment({
      ticket: updated,
      employee,
      actorName: session.user.name,
      trigger: 'reassignment',
    });
    if (notification) notifications.push(notification);
  }

  if (status !== undefined && nextStatus === 'in_progress' && nextEmployeeId) {
    const employee = await getEmployee(nextEmployeeId);
    const isSelf = employee?.email === session.user.email;
    if (!isSelf) {
      const notification = await notifyStatusChange({
        ticket: updated,
        employee,
        actorName: session.user.name,
        status: nextStatus,
      });
      if (notification) notifications.push(notification);
    }
  }

  return NextResponse.json({ ticket: updated, notifications });
}
