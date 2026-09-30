import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket, deleteTicket, childTicketCount } from '@/lib/tickets';
import { getProject } from '@/lib/projects';
import { ticketKey } from '@/lib/ticketMeta';
import { employeeExists, getEmployee } from '@/lib/employees';
import { notifyAssignment, notifyStatusChange } from '@/lib/mail';
import { logActivityChanges } from '@/lib/ticketActivity';
import { deleteAttachment } from '@/lib/storage';
import { wouldCreateCycle } from '@/lib/ticketTree';
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

  // Archiving is reversible by design, so anyone who can edit a ticket may do
  // it, and it only ever flips the flag. archived_at is cleared on restore so
  // the archived view does not keep showing a stale date.
  if (body.archived !== undefined) {
    edits.archived = body.archived ? 1 : 0;
    edits.archived_at = edits.archived
      ? new Date().toISOString().replace('T', ' ').slice(0, 19)
      : null;
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

  // archived_at and slack_channel are bookkeeping rather than a change to the
  // work item, and neither has a label in the activity feed, so they are
  // written but not logged. The archived flag itself is logged under
  // 'archived', which the feed does render.
  logged.delete('archived_at');
  logged.delete('slack_channel');
  if (edits.archived === Number(ticket.archived || 0)) {
    // Re-archiving something already archived is a no-op, so it does not belong
    // in the history either.
    logged.delete('archived');
  }

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

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Deletion is the counterpart of creation, which the POST route already
  // reserves for admins, so the two stay symmetrical.
  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can delete work items.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const ticket = await getTicket(id);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const children = await childTicketCount(ticket.id);
  const { attachments } = await deleteTicket(ticket.id);

  // Storage cleanup is best effort: the database rows are already gone, and a
  // failed object delete should not turn a completed delete into an error.
  await Promise.all(
    attachments.map((a) => deleteAttachment(a.storage_key).catch(() => {}))
  );

  return NextResponse.json({
    deleted: true,
    ticket: { id: ticket.id, title: ticket.title },
    // Children survive and are re-parented one level up, so the caller can say
    // so rather than implying the whole branch went with the parent.
    reparentedChildren: children,
  });
}
