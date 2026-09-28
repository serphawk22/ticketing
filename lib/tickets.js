import { db } from './db';

const TICKETS_QUERY = `
  SELECT t.*, u.name AS created_by_name, a.name AS assigned_to_name,
    p.name AS project_name, p.key AS project_key, p.color AS project_color,
    e.name AS employee_name, e.email AS employee_email
  FROM tickets t
  JOIN users u ON u.id = t.created_by
  LEFT JOIN users a ON a.id = t.assigned_to
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN employees e ON e.id = t.employee_id
  ORDER BY t.id DESC
`;

const TICKET_BY_ID_QUERY = `
  SELECT t.*, u.name AS created_by_name, a.name AS assigned_to_name,
    p.name AS project_name, p.key AS project_key, p.color AS project_color,
    e.name AS employee_name, e.email AS employee_email
  FROM tickets t
  JOIN users u ON u.id = t.created_by
  LEFT JOIN users a ON a.id = t.assigned_to
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN employees e ON e.id = t.employee_id
  WHERE t.id = ?
`;

export async function getAllTickets() {
  return db.prepare(TICKETS_QUERY).all();
}

export async function getTicket(id) {
  return db.prepare(TICKET_BY_ID_QUERY).get(Number(id));
}

export async function getDevelopers() {
  return db.prepare('SELECT id, name FROM users WHERE role = ?').all('developer');
}