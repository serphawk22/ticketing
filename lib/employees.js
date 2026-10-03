import { db } from './db';

const EMPLOYEES_SELECT = `
  SELECT e.*,
    (SELECT COUNT(*) FROM tickets t WHERE t.employee_id = e.id) AS assigned_count,
    (SELECT COUNT(*) FROM tickets t
      WHERE t.employee_id = e.id AND t.status IN ('open', 'in_progress')) AS open_count,
    (SELECT u.id FROM users u WHERE u.email = e.email) AS user_id
  FROM employees e
`;

const ACTIVE_FIRST = ' ORDER BY e.active DESC, e.name COLLATE NOCASE';

// `active` is an INTEGER column, but the UI and the JSON contract both expect
// a real boolean, so every employee row is normalised on the way out.
function toEmployee(row) {
  return row ? { ...row, active: Boolean(row.active) } : row;
}

export async function getEmployees({ includeInactive = true } = {}) {
  const sql = includeInactive
    ? `${EMPLOYEES_SELECT}${ACTIVE_FIRST}`
    : `${EMPLOYEES_SELECT} WHERE e.active = 1${ACTIVE_FIRST}`;
  const rows = await db.prepare(sql).all();
  return rows.map(toEmployee);
}

export function getActiveEmployees() {
  return getEmployees({ includeInactive: false });
}

export async function getEmployee(id) {
  if (!id) return null;
  return toEmployee(
    await db.prepare(`${EMPLOYEES_SELECT} WHERE e.id = ?`).get(Number(id))
  );
}

export async function getEmployeeByEmail(email) {
  if (!email) return null;
  return toEmployee(
    await db.prepare(`${EMPLOYEES_SELECT} WHERE e.email = ?`).get(email)
  );
}

export async function getEmployeeByUserId(userId) {
  return toEmployee(
    await db
      .prepare(
        `${EMPLOYEES_SELECT}
         JOIN users u ON u.email = e.email
         WHERE u.id = ?`
      )
      .get(Number(userId))
  );
}

export async function employeeExists(id) {
  if (!id) return false;
  return Boolean(
    await db.prepare('SELECT 1 AS ok FROM employees WHERE id = ? AND active = 1').get(Number(id))
  );
}

export async function createEmployee({ name, email, role, department = '', title = '' }) {
  const info = await db
    .prepare(
      `INSERT INTO employees (name, email, role, department, title)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, email, role, department, title);

  return getEmployee(info.lastInsertRowid);
}

export async function updateEmployee(id, fields) {
  const current = await getEmployee(id);
  if (!current) return null;

  await db.prepare(
    `UPDATE employees
     SET name = ?, email = ?, role = ?, department = ?, title = ?,
         active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    fields.name,
    fields.email,
    fields.role,
    fields.department,
    fields.title,
    fields.active ? 1 : 0,
    Number(id)
  );

  return getEmployee(id);
}

export async function setEmployeeActive(id, active) {
  await db.prepare(
    "UPDATE employees SET active = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(active ? 1 : 0, Number(id));
  return getEmployee(id);
}

export async function deleteEmployee(id) {
  const info = await db.prepare('DELETE FROM employees WHERE id = ?').run(Number(id));
  return info.rowCount;
}

export async function employeeTicketCount(id) {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM tickets WHERE employee_id = ?')
    .get(Number(id));
  return row.c;
}

/**
 * Detaches an employee's tickets so nothing is left pointing at a row that no
 * longer exists. Both columns go: employee_id links to the directory entry and
 * assigned_to to the login account, and removing the employee removes both.
 *
 * Returns the number of tickets affected so the caller can say so out loud
 * instead of silently reassigning work.
 */
export async function unassignEmployeeTickets(id) {
  const info = await db
    .prepare(
      `UPDATE tickets
         SET employee_id = NULL, assigned_to = NULL
       WHERE employee_id = ? OR assigned_to = (
         SELECT u.id FROM users u WHERE u.email = (SELECT email FROM employees WHERE id = ?)
       )`
    )
    .run(Number(id), Number(id));

  return info.rowCount;
}
