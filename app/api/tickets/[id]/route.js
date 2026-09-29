import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { employeeExists, getEmployee } from '@/lib/employees';
import { notifyAssignment, notifyStatusChange } from '@/lib/mail';
import { logActivityChanges } from '@/lib/ticketActivity';
import { FIELD_META, PRIORITY_ORDER, STATUS_ORDER, TYPE_ORDER } from '@/lib/ticketMeta';

const TEXT_FIELDS = ['title', 'description', 'labels', 'category', 'team'];

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
  const isAdmin = session.user.role === 'admin';

  const edits = {};

  for (const field of TEXT_FIELDS) {
    if (body[field] === undefined) continue;
    if (!FIELD_META[field].open && !isAdmin) {
      return NextResponse.json(
        { error: `Only admins can edit ${FIELD_META[field].label.toLowerCase()}.` },
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
    if (!isAdmin) {
      return NextResponse.json({ error: 'Only admins can edit issue type.' }, { status: 403 });
    }
    if (!TYPE_ORDER.includes(body.type)) return badValue('type', body.type);
    edits.type = body.type;
  }

  for (const field of ['due_date', 'start_date']) {
    if (body[field] === undefined) continue;
    const value = parseDate(body[field]);
    if (value === undefined) return badValue(field, body[field]);
    edits[field] = value;
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

  if (body.employee_id !== undefined) {
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Only admins can reassign tickets.' },
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
    edits.employee_id = value;
  }

  const keys = Object.keys(edits);
  if (keys.length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const reassigning =
    edits.employee_id !== undefined &&
    Number(edits.employee_id || 0) !== Number(ticket.employee_id || 0);

  let nextEmployeeId = ticket.employee_id;
  const logged = new Set(keys);

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
  const pairs = keys.map((field) => [`${field} = ?`, edits[field], true]);
  if (autoClaim) pairs.push(['employee_id = ?', nextEmployeeId || null, true]);
  pairs.push(["updated_at = datetime('now')", null, false]);

  const assignments = pairs.map(([sql]) => sql);
  const values = pairs.filter(([, , binds]) => binds).map(([, value]) => value);
  values.push(ticketId);

  await db.prepare(`UPDATE tickets SET ${assignments.join(', ')} WHERE id = ?`).run(values);

  await logActivityChanges(
    ticketId,
    session.user.id,
    ticket,
    { ...ticket, ...edits, employee_id: nextEmployeeId },
    [...logged]
  );

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

  if (edits.status !== undefined && updated.status === 'in_progress' && nextEmployeeId) {
    const employee = await getEmployee(nextEmployeeId);
    const isSelf = employee?.email === session.user.email;
    if (!isSelf) {
      const notification = await notifyStatusChange({
        ticket: updated,
        employee,
        actorName: session.user.name,
        status: updated.status,
      });
      if (notification) notifications.push(notification);
    }
  }

  return NextResponse.json({ ticket: updated, notifications });
}
