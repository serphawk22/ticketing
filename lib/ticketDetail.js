import { db } from './db';
import { getTicket } from './tickets';
import { getActivity } from './ticketActivity';

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

// Links are shown from both sides. A row is matched when this ticket is either
// end of it, and the direction decides how it reads: an outgoing "blocks" is
// labelled "blocks" here, while an incoming one is labelled with the inverse,
// "is blocked by". Resolving the label from the mapped type rather than storing
// a mirrored row keeps the inverse out of the database. The two shapes are
// separate statements because the joined columns differ by direction.
const OUTGOING_RELATIONS_QUERY = `
  SELECT r.id AS relation_id, r.ticket_id, r.related_ticket_id,
    r.relation_type, r.created_at,
    t.id, t.title, t.status, t.type, t.project_id, t.employee_id,
    p.key AS project_key, e.name AS employee_name
  FROM ticket_relations r
  JOIN tickets t ON t.id = r.related_ticket_id
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN employees e ON e.id = t.employee_id
  WHERE r.ticket_id = ?
  ORDER BY r.id ASC
`;

const INCOMING_RELATIONS_QUERY = `
  SELECT r.id AS relation_id, r.ticket_id, r.related_ticket_id,
    r.relation_type, r.created_at,
    t.id, t.title, t.status, t.type, t.project_id, t.employee_id,
    p.key AS project_key, e.name AS employee_name
  FROM ticket_relations r
  JOIN tickets t ON t.id = r.ticket_id
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN employees e ON e.id = t.employee_id
  WHERE r.related_ticket_id = ?
  ORDER BY r.id ASC
`;

const VOTES_QUERY = `
  SELECT v.id, v.user_id, v.created_at, u.name AS user_name
  FROM ticket_votes v
  JOIN users u ON u.id = v.user_id
  WHERE v.ticket_id = ?
  ORDER BY v.created_at ASC, v.id ASC
`;

const WEB_LINKS_QUERY = `
  SELECT id, url, label, created_at
  FROM ticket_web_links
  WHERE ticket_id = ?
  ORDER BY id ASC
`;

// Child work items are the tickets that point at this one through
// tickets.parent_id, so the hierarchy only has to be correct in one direction.
const CHILD_ITEMS_QUERY = `
  SELECT t.id, t.title, t.status, t.type, t.project_id, t.employee_id, t.archived,
    p.key AS project_key, e.name AS employee_name
  FROM tickets t
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN employees e ON e.id = t.employee_id
  WHERE t.parent_id = ?
  ORDER BY t.id ASC
`;

// The chip at the top of a child ticket, so it can name and link to its parent.
const PARENT_QUERY = `
  SELECT t.id, t.title, t.status, t.type, t.project_id,
    p.key AS project_key
  FROM tickets t
  LEFT JOIN projects p ON p.id = t.project_id
  WHERE t.id = ?
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

  const [
    activity,
    comments,
    attachments,
    relations,
    childItems,
    parent,
    watchers,
    votes,
    webLinks,
    timeLogs,
    timeTotal,
  ] = await Promise.all([
    getActivity(id),
    db.prepare(COMMENTS_QUERY).all(id),
    db.prepare(ATTACHMENTS_QUERY).all(id),
    getRelations(id),
    db.prepare(CHILD_ITEMS_QUERY).all(id),
    ticket.parent_id == null ? null : db.prepare(PARENT_QUERY).get(ticket.parent_id),
    db.prepare(WATCHERS_QUERY).all(id),
    db.prepare(VOTES_QUERY).all(id),
    db.prepare(WEB_LINKS_QUERY).all(id),
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
    parent,
    watchers,
    votes,
    webLinks,
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

/**
 * Every link touching this ticket, from both directions.
 *
 * Each row carries a `direction` so the caller can render the inverse label
 * without re-deriving it, and points `relation_id` at the row that would be
 * deleted to remove the link. Removing an incoming row deletes the same
 * relation row, so the action is the same either way.
 */
export async function getRelations(ticketId) {
  const id = Number(ticketId);
  const [outgoing, incoming] = await Promise.all([
    db.prepare(OUTGOING_RELATIONS_QUERY).all(id),
    db.prepare(INCOMING_RELATIONS_QUERY).all(id),
  ]);

  return [
    ...outgoing.map((r) => ({ ...r, direction: 'outgoing' })),
    ...incoming.map((r) => ({ ...r, direction: 'incoming' })),
  ];
}

export async function getVotes(ticketId) {
  return db.prepare(VOTES_QUERY).all(Number(ticketId));
}

export async function getWebLinks(ticketId) {
  return db.prepare(WEB_LINKS_QUERY).all(Number(ticketId));
}

export async function getChildItems(ticketId) {
  return db.prepare(CHILD_ITEMS_QUERY).all(Number(ticketId));
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
