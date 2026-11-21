import { db } from './db.js';

const INSERT = `
  INSERT INTO ticket_activity (ticket_id, actor_id, field, from_value, to_value)
  VALUES (?, ?, ?, ?, ?)
`;

const INSERT_DUE_DATE_CHANGE = `
  INSERT INTO ticket_activity (ticket_id, actor_id, field, from_value, to_value, blocker, reason, employee_id)
  VALUES (?, ?, 'due_date', ?, ?, ?, ?, ?)
`;

export async function logActivity(ticketId, actorId, field, fromValue, toValue) {
  const from = fromValue == null ? '' : String(fromValue);
  const to = toValue == null ? '' : String(toValue);
  if (from === to) return;
  await db.prepare(INSERT).run(Number(ticketId), actorId || null, field, from, to);
}

export async function logDueDateChange(ticketId, actorId, fromValue, toValue, blocker = '', reason = '', employeeId = null) {
  const from = fromValue == null ? '' : String(fromValue);
  const to = toValue == null ? '' : String(toValue);
  await db.prepare(INSERT_DUE_DATE_CHANGE).run(
    Number(ticketId),
    actorId || null,
    from,
    to,
    String(blocker || '').trim(),
    String(reason || '').trim(),
    employeeId ? Number(employeeId) : null
  );
}

export async function logRepositoryChange(ticketId, actorId, fromValue, toValue, reason = '', gitContext = '') {
  const from = fromValue == null ? '' : String(fromValue);
  const to = toValue == null ? '' : String(toValue);
  await db.prepare(`
    INSERT INTO ticket_activity (ticket_id, actor_id, field, from_value, to_value, blocker, reason)
    VALUES (?, ?, 'repository_id', ?, ?, ?, ?)
  `).run(
    Number(ticketId),
    actorId || null,
    from,
    to,
    gitContext ? String(gitContext).trim() : '',
    reason ? String(reason).trim() : ''
  );
}

export async function logTicketClosure(ticketId, actorId, fromValue, toValue, reason = '', verificationDetails = '', employeeId = null) {
  const from = fromValue == null ? '' : String(fromValue);
  const to = toValue == null ? '' : String(toValue);
  await db.prepare(`
    INSERT INTO ticket_activity (ticket_id, actor_id, field, from_value, to_value, blocker, reason, employee_id)
    VALUES (?, ?, 'status', ?, ?, ?, ?, ?)
  `).run(
    Number(ticketId),
    actorId || null,
    from,
    to,
    verificationDetails ? String(verificationDetails).trim() : '',
    reason ? String(reason).trim() : '',
    employeeId ? Number(employeeId) : null
  );
}

export async function logActivityChanges(ticketId, actorId, before, after, fields) {
  for (const field of fields) {
    await logActivity(ticketId, actorId, field, before[field], after[field]);
  }
}

// The birth of a ticket is the one event with no before/after pair, so it is
// written directly: logActivity's no-op guard would drop an empty-to-empty row.
export async function logCreated(ticketId, actorId) {
  await db.prepare(INSERT).run(Number(ticketId), actorId || null, 'created', '', '');
}

const ACTIVITY_QUERY = `
  SELECT a.id, a.field, a.from_value, a.to_value, a.created_at,
    COALESCE(a.blocker, '') AS blocker,
    COALESCE(a.reason, '') AS reason,
    a.employee_id,
    u.name AS actor_name,
    COALESCE(e.name, u.name) AS employee_name
  FROM ticket_activity a
  LEFT JOIN users u ON u.id = a.actor_id
  LEFT JOIN employees e ON (e.id = a.employee_id OR (a.employee_id IS NULL AND (e.user_id = u.id OR LOWER(e.email) = LOWER(u.email))))
  WHERE a.ticket_id = ?
  ORDER BY a.created_at DESC, a.id DESC
`;

export async function getActivity(ticketId) {
  return db.prepare(ACTIVITY_QUERY).all(Number(ticketId));
}
