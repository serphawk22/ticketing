import { db } from './db';

const TICKETS_QUERY = `
  SELECT t.id, t.title, t.status, t.priority, t.type, t.category,
    t.created_at, t.updated_at, t.employee_id, t.estimate_seconds,
    e.name AS employee_name, p.key AS project_key
  FROM tickets t
  LEFT JOIN employees e ON e.id = t.employee_id
  LEFT JOIN projects p ON p.id = t.project_id
  WHERE t.project_id = ? AND t.archived = 0
  ORDER BY t.id DESC
`;

const EVENTS_QUERY = `
  SELECT a.id, a.ticket_id, a.from_value, a.to_value, a.created_at
  FROM ticket_activity a
  JOIN tickets t ON t.id = a.ticket_id
  WHERE t.project_id = ? AND t.archived = 0 AND a.field = 'status'
  ORDER BY a.created_at ASC, a.id ASC
`;

const TIME_QUERY = `
  SELECT l.ticket_id, SUM(l.seconds) AS seconds
  FROM ticket_time_logs l
  JOIN tickets t ON t.id = l.ticket_id
  WHERE t.project_id = ? AND t.archived = 0
  GROUP BY l.ticket_id
`;

function normalizeTicket(row) {
  return {
    id: Number(row.id),
    title: row.title || '',
    status: row.status,
    priority: row.priority,
    type: row.type || 'task',
    category: row.category || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    employee_id: row.employee_id == null ? null : Number(row.employee_id),
    employee_name: row.employee_name || '',
    estimate_seconds: Number(row.estimate_seconds) || 0,
    project_key: row.project_key || 'TM',
  };
}

/**
 * Everything a project report is computed from: open work items, the status
 * changes that move them, and the time logged against them.
 */
export async function getReportSource(projectId) {
  const id = Number(projectId);
  const [tickets, events, timeRows] = await Promise.all([
    db.prepare(TICKETS_QUERY).all(id),
    db.prepare(EVENTS_QUERY).all(id),
    db.prepare(TIME_QUERY).all(id),
  ]);

  const timeByTicket = {};
  for (const row of timeRows) {
    timeByTicket[Number(row.ticket_id)] = Number(row.seconds) || 0;
  }

  return {
    tickets: tickets.map(normalizeTicket),
    events: events.map((row) => ({
      id: Number(row.id),
      ticket_id: Number(row.ticket_id),
      from_value: row.from_value || '',
      to_value: row.to_value || '',
      created_at: row.created_at,
    })),
    timeByTicket,
  };
}
