import { db } from './db';

const TICKET_COLUMNS = `
  SELECT t.*, u.name AS created_by_name, a.name AS assigned_to_name,
    p.name AS project_name, p.key AS project_key, p.color AS project_color,
    e.name AS employee_name, e.email AS employee_email
  FROM tickets t
  JOIN users u ON u.id = t.created_by
  LEFT JOIN users a ON a.id = t.assigned_to
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN employees e ON e.id = t.employee_id
`;

const TICKET_BY_ID_QUERY = `${TICKET_COLUMNS} WHERE t.id = ?`;

// Archived rows are hidden from the working views, so the list, board and
// calendar all filter them out here rather than each remembering to. Anything
// that legitimately needs them -- the archived view, and a direct fetch by id
// -- asks separately.
const TICKETS_BY_PROJECT_QUERY = `${TICKET_COLUMNS}
  WHERE t.project_id = ? AND t.archived = 0
  ORDER BY t.id DESC
`;

const ALL_TICKETS_QUERY = `${TICKET_COLUMNS}
  WHERE t.archived = 0
  ORDER BY t.id DESC
`;

// Archived tickets, newest archive first, for the archived work items view.
const ARCHIVED_TICKETS_QUERY = `${TICKET_COLUMNS}
  WHERE t.archived = 1
  ORDER BY t.archived_at DESC, t.id DESC
`;

export async function getAllTickets() {
  return db.prepare(ALL_TICKETS_QUERY).all();
}

export async function getTicket(id) {
  return db.prepare(TICKET_BY_ID_QUERY).get(Number(id));
}

export async function getTicketsForProject(projectId) {
  return db.prepare(TICKETS_BY_PROJECT_QUERY).all(Number(projectId));
}

export async function getArchivedTickets() {
  return db.prepare(ARCHIVED_TICKETS_QUERY).all();
}

// What one person asked for, newest first. The raise-a-ticket panel lists this
// so the requester can see where their own requests landed, which is the only
// way back to a ticket they never got assigned.
const RAISED_TICKETS_QUERY = `${TICKET_COLUMNS}
  WHERE t.created_by = ? AND t.archived = 0
  ORDER BY t.id DESC
`;

export async function getTicketsRaisedBy(userId, limit = 8) {
  return db.prepare(`${RAISED_TICKETS_QUERY} LIMIT ?`).all(userId, Number(limit));
}

// Everything one client has asked for, which is all a client may ever read.
// Scoped by creator rather than by assignee, because a request is theirs from
// the moment they raise it -- it only leaves their view once it is archived.
const CLIENT_TICKETS_QUERY = `${TICKET_COLUMNS}
  WHERE t.created_by = ? AND t.archived = 0
  ORDER BY t.id DESC
`;

export async function getTicketsForClient(userId) {
  return db.prepare(CLIENT_TICKETS_QUERY).all(Number(userId));
}

// The admin triage queue: requests raised by client accounts that nobody has
// picked up yet. Once a ticket has an owner it stops being a request and
// becomes ordinary team work, so the sidebar only lists what still needs
// routing. The client name comes from the creator, not the assignee slot.
const CLIENT_REQUEST_QUEUE_QUERY = `${TICKET_COLUMNS}
  WHERE t.created_by IN (SELECT id FROM users WHERE role = 'client')
    AND t.archived = 0
    AND t.employee_id IS NULL
  ORDER BY
    CASE t.priority
      WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
      WHEN 'medium' THEN 2 ELSE 3
    END,
    t.id DESC
`;

export async function getClientRequestQueue() {
  return db.prepare(CLIENT_REQUEST_QUEUE_QUERY).all();
}

export async function getDevelopers() {
  return db.prepare('SELECT id, name FROM users WHERE role = ?').all('developer');
}

/**
 * Delete a ticket and everything hanging off it.
 *
 * Children are re-parented to the deleted ticket's own parent rather than
 * removed with it, so deleting a mid-tree ticket never silently takes a whole
 * branch with it. Every other dependent row goes, since leaving them would
 * either orphan the row or keep the attachment blobs alive with nothing
 * pointing at them.
 */
export async function deleteTicket(id) {
  const ticketId = Number(id);

  const attachments = await db
    .prepare('SELECT storage_key FROM ticket_attachments WHERE ticket_id = ?')
    .all(ticketId);

  await db.prepare('UPDATE tickets SET parent_id = ? WHERE parent_id = ?').run(
    (await getTicket(ticketId))?.parent_id ?? null,
    ticketId
  );

  // Relations point both ways, so a ticket can be named by somebody else's row.
  await db.prepare('DELETE FROM ticket_relations WHERE ticket_id = ? OR related_ticket_id = ?').run(ticketId, ticketId);

  // email_outbox references the ticket, so its rows have to go before the
  // ticket does or the foreign key rejects the delete in Postgres. The mail has
  // already been sent, so the log is history rather than pending work and there
  // is nothing left to process.
  await db.prepare('DELETE FROM email_outbox WHERE ticket_id = ?').run(ticketId);

  for (const table of [
    'ticket_activity',
    'ticket_comments',
    'ticket_attachments',
    'ticket_watchers',
    'ticket_time_logs',
    'ticket_votes',
    'ticket_web_links',
  ]) {
    await db.prepare(`DELETE FROM ${table} WHERE ticket_id = ?`).run(ticketId);
  }

  // Last on purpose: every reference is cleared first, so the only statement
  // that can still fail is this one, and failing it leaves the ticket intact
  // rather than half-removed.
  const info = await db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);
  return { rowCount: info.rowCount, attachments };
}

/** How many child work items sit under this one. */
export async function childTicketCount(id) {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM tickets WHERE parent_id = ?')
    .get(Number(id));
  return row?.c ?? 0;
}
