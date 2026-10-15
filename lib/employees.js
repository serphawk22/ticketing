import { db } from './db.js';

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

export function toSafeEmployee(employee, isAdmin = false) {
  if (!employee) return null;
  if (isAdmin) return employee;
  // Strip sensitive compensation information for non-administrators
  const { base_salary, salary_currency, last_payment_date, payment_status, ...safe } = employee;
  return safe;
}

export async function createEmployee({
  name,
  email,
  role,
  department = '',
  title = '',
  base_salary = null,
  salary_currency = 'USD',
  last_payment_date = null,
  payment_status = '',
}) {
  const salaryNum =
    base_salary !== null && base_salary !== undefined && base_salary !== ''
      ? Number(base_salary)
      : null;

  const info = await db
    .prepare(
      `INSERT INTO employees (name, email, role, department, title, base_salary, salary_currency, last_payment_date, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      email,
      role,
      department,
      title,
      salaryNum,
      salary_currency || 'USD',
      last_payment_date || null,
      payment_status || ''
    );

  return getEmployee(info.lastInsertRowid);
}

export async function updateEmployee(id, fields) {
  const current = await getEmployee(id);
  if (!current) return null;

  const baseSalary =
    fields.base_salary !== undefined
      ? fields.base_salary !== null && fields.base_salary !== ''
        ? Number(fields.base_salary)
        : null
      : current.base_salary;

  const salaryCurrency =
    fields.salary_currency !== undefined
      ? fields.salary_currency || 'USD'
      : current.salary_currency || 'USD';

  const lastPaymentDate =
    fields.last_payment_date !== undefined
      ? fields.last_payment_date || null
      : current.last_payment_date;

  const paymentStatus =
    fields.payment_status !== undefined
      ? fields.payment_status || ''
      : current.payment_status;

  const name = fields.name !== undefined ? fields.name : current.name;
  const email = fields.email !== undefined ? fields.email : current.email;
  const role = fields.role !== undefined ? fields.role : current.role;
  const department = fields.department !== undefined ? fields.department : current.department;
  const title = fields.title !== undefined ? fields.title : current.title;
  const active = fields.active !== undefined ? (fields.active ? 1 : 0) : (current.active ? 1 : 0);

  await db.prepare(
    `UPDATE employees
     SET name = ?, email = ?, role = ?, department = ?, title = ?,
         active = ?, base_salary = ?, salary_currency = ?, last_payment_date = ?, payment_status = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    name,
    email,
    role,
    department,
    title,
    active,
    baseSalary,
    salaryCurrency,
    lastPaymentDate,
    paymentStatus,
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
