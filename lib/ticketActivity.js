import { db } from './db';

const INSERT = `
  INSERT INTO ticket_activity (ticket_id, actor_id, field, from_value, to_value)
  VALUES (?, ?, ?, ?, ?)
`;

export async function logActivity(ticketId, actorId, field, fromValue, toValue) {
  const from = fromValue == null ? '' : String(fromValue);
  const to = toValue == null ? '' : String(toValue);
  if (from === to) return;
  await db.prepare(INSERT).run(Number(ticketId), actorId || null, field, from, to);
}

export async function logActivityChanges(ticketId, actorId, before, after, fields) {
  for (const field of fields) {
    await logActivity(ticketId, actorId, field, before[field], after[field]);
  }
}

const ACTIVITY_QUERY = `
  SELECT a.id, a.field, a.from_value, a.to_value, a.created_at,
    u.name AS actor_name
  FROM ticket_activity a
  LEFT JOIN users u ON u.id = a.actor_id
  WHERE a.ticket_id = ?
  ORDER BY a.created_at DESC, a.id DESC
`;

export async function getActivity(ticketId) {
  return db.prepare(ACTIVITY_QUERY).all(Number(ticketId));
}
