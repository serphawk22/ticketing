import { db } from './db';

const TICKETS_QUERY = `
  SELECT t.*, u.name AS created_by_name, a.name AS assigned_to_name,
    p.name AS project_name, p.key AS project_key, p.color AS project_color
  FROM tickets t
  JOIN users u ON u.id = t.created_by
  LEFT JOIN users a ON a.id = t.assigned_to
  LEFT JOIN projects p ON p.id = t.project_id
  ORDER BY t.id DESC
`;

export function getAllTickets() {
  return db.prepare(TICKETS_QUERY).all();
}

export function getDevelopers() {
  return db.prepare('SELECT id, name FROM users WHERE role = ?').all('developer');
}