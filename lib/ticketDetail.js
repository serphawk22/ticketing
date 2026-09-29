import { db } from './db';
import { getTicket } from './tickets';
import { getActivity } from './ticketActivity';
import { CHILD_RELATION } from './ticketMeta';

const COMMENTS_QUERY = `
  SELECT c.id, c.body, c.created_at, c.updated_at, c.author_id,
    u.name AS author_name
  FROM ticket_comments c
  JOIN users u ON u.id = c.author_id
  WHERE c.ticket_id = ?
  ORDER BY c.created_at ASC, c.id ASC
`;

const ATTACHMENTS_QUERY = `
  SELECT a.id, a.filename, a.content_type, a.size_bytes,
    a.created_at, a.uploaded_by, u.name AS uploaded_by_name
  FROM ticket_attachments a
  LEFT JOIN users u ON u.id = a.uploaded_by
  WHERE a.ticket_id = ?
  ORDER BY a.created_at ASC, a.id ASC
`;

const RELATIONS_QUERY = `
  SELECT r.id, r.related_ticket_id, r.relation_type, r.created_at,
    t.title, t.status, t.project_id, p.key AS project_key
  FROM ticket_relations r
  JOIN tickets t ON t.id = r.related_ticket_id
  LEFT JOIN projects p ON p.id = t.project_id
  WHERE r.ticket_id = ?
  ORDER BY r.id ASC
`;

// Child work items are the tickets this one is the parent of, so the link only
// has to exist in the parent -> child direction.
const CHILD_ITEMS_QUERY = `
  SELECT r.id AS relation_id, t.id, t.title, t.status, t.project_id,
    p.key AS project_key
  FROM ticket_relations r
  JOIN tickets t ON t.id = r.related_ticket_id
  LEFT JOIN projects p ON p.id = t.project_id
  WHERE r.ticket_id = ? AND r.relation_type = ?
  ORDER BY r.id ASC
`;

const WATCHERS_QUERY = `
  SELECT w.id, w.user_id, w.created_at, u.name AS user_name
  FROM ticket_watchers w
  JOIN users u ON u.id = w.user_id
  WHERE w.ticket_id = ?
  ORDER BY w.created_at ASC
`;

const TIME_LOGS_QUERY = `
  SELECT l.id, l.seconds, l.note, l.created_at, l.user_id, u.name AS user_name
  FROM ticket_time_logs l
  JOIN users u ON u.id = l.user_id
  WHERE l.ticket_id = ?
  ORDER BY l.created_at ASC, l.id ASC
`;

const TIME_TOTAL_QUERY = `
  SELECT COALESCE(SUM(seconds), 0) AS total FROM ticket_time_logs WHERE ticket_id = ?
`;

export async function getTicketDetail(ticketId) {
  const id = Number(ticketId);
  const ticket = await getTicket(id);
  if (!ticket) return null;

  const [activity, comments, attachments, relations, childItems, watchers, timeLogs, timeTotal] =
    await Promise.all([
      getActivity(id),
      db.prepare(COMMENTS_QUERY).all(id),
      db.prepare(ATTACHMENTS_QUERY).all(id),
      db.prepare(RELATIONS_QUERY).all(id),
      db.prepare(CHILD_ITEMS_QUERY).all(id, CHILD_RELATION),
      db.prepare(WATCHERS_QUERY).all(id),
      db.prepare(TIME_LOGS_QUERY).all(id),
      db.prepare(TIME_TOTAL_QUERY).get(id),
    ]);

  return {
    ticket,
    activity,
    comments,
    attachments,
    relations,
    childItems,
    watchers,
    timeLogs,
    loggedSeconds: Number(timeTotal?.total || 0),
  };
}

export async function getComments(ticketId) {
  return db.prepare(COMMENTS_QUERY).all(Number(ticketId));
}

export async function getAttachments(ticketId) {
  return db.prepare(ATTACHMENTS_QUERY).all(Number(ticketId));
}

export async function getRelations(ticketId) {
  return db.prepare(RELATIONS_QUERY).all(Number(ticketId));
}

export async function getWatchers(ticketId) {
  return db.prepare(WATCHERS_QUERY).all(Number(ticketId));
}

export async function getTimeLogs(ticketId) {
  return db.prepare(TIME_LOGS_QUERY).all(Number(ticketId));
}

export async function getLoggedSeconds(ticketId) {
  const row = await db.prepare(TIME_TOTAL_QUERY).get(Number(ticketId));
  return Number(row?.total || 0);
}
