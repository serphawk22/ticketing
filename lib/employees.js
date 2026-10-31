import { db } from './db.js';

const EMPLOYEES_SELECT = `
  SELECT e.*,
    w.name AS workspace_name,
    (SELECT COUNT(*) FROM tickets t WHERE t.employee_id = e.id) AS assigned_count,
    (SELECT COUNT(*) FROM tickets t
      WHERE t.employee_id = e.id AND t.status IN ('open', 'in_progress')) AS open_count,
    COALESCE(e.user_id, (SELECT u.id FROM users u WHERE u.email = e.email)) AS user_id
  FROM employees e
  LEFT JOIN workspaces w ON w.id = e.workspace_id
`;

const ACTIVE_FIRST = ' ORDER BY e.active DESC, e.name COLLATE NOCASE';

// `active` is an INTEGER column, but the UI and the JSON contract both expect
// a real boolean, so every employee row is normalised on the way out.
function toEmployee(row) {
  return row ? { ...row, active: Boolean(row.active) } : row;
}

export async function getEmployees({ includeInactive = true, workspaceId = null } = {}) {
  const conditions = [];
  const params = [];
  if (!includeInactive) {
    conditions.push('e.active = 1');
  }
  if (workspaceId) {
    conditions.push('e.workspace_id = ?');
    params.push(Number(workspaceId));
  }
  const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const sql = `${EMPLOYEES_SELECT}${whereClause}${ACTIVE_FIRST}`;
  const rows = await db.prepare(sql).all(...params);
  return rows.map(toEmployee);
}

export function getActiveEmployees(options = {}) {
  return getEmployees({ ...options, includeInactive: false });
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
  if (!userId) return null;
  return toEmployee(
    await db
      .prepare(
        `${EMPLOYEES_SELECT}
         WHERE e.user_id = ? OR (e.user_id IS NULL AND e.email IS NOT NULL AND e.email = (SELECT email FROM users WHERE id = ?))`
      )
      .get(Number(userId), Number(userId))
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
  email = null,
  secondary_email = null,
  role,
  department = '',
  title = '',
  base_salary = null,
  salary_currency = 'USD',
  last_payment_date = null,
  payment_status = '',
  user_id = null,
  employment_type = 'full_time',
  joining_date = null,
  workspace_id = null,
}) {
  const salaryNum =
    base_salary !== null && base_salary !== undefined && base_salary !== ''
      ? Number(base_salary)
      : null;

  const cleanEmail = email ? String(email).trim().toLowerCase() : null;
  const cleanSecondaryEmail = secondary_email ? String(secondary_email).trim().toLowerCase() : null;

  let resolvedWorkspaceId = workspace_id ? Number(workspace_id) : null;
  if (!resolvedWorkspaceId) {
    const defaultWs = await db.prepare('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1').get();
    resolvedWorkspaceId = defaultWs?.id || null;
  }

  const info = await db
    .prepare(
      `INSERT INTO employees (name, email, secondary_email, role, department, title, base_salary, salary_currency, last_payment_date, payment_status, user_id, employment_type, joining_date, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      cleanEmail,
      cleanSecondaryEmail,
      role,
      department,
      title,
      salaryNum,
      salary_currency || 'USD',
      last_payment_date || null,
      payment_status || '',
      user_id ? Number(user_id) : null,
      employment_type || 'full_time',
      joining_date || new Date().toISOString().slice(0, 10),
      resolvedWorkspaceId
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
  const email =
    fields.email !== undefined
      ? fields.email ? String(fields.email).trim().toLowerCase() : null
      : current.email;
  const secondary_email =
    fields.secondary_email !== undefined
      ? fields.secondary_email ? String(fields.secondary_email).trim().toLowerCase() : null
      : current.secondary_email;
  const role = fields.role !== undefined ? fields.role : current.role;
  const department = fields.department !== undefined ? fields.department : current.department;
  const title = fields.title !== undefined ? fields.title : current.title;
  const active = fields.active !== undefined ? (fields.active ? 1 : 0) : (current.active ? 1 : 0);
  const userId =
    fields.user_id !== undefined
      ? fields.user_id ? Number(fields.user_id) : null
      : current.user_id;
  const employment_type =
    fields.employment_type !== undefined
      ? fields.employment_type || 'full_time'
      : current.employment_type || 'full_time';
  const workspace_id =
    fields.workspace_id !== undefined
      ? fields.workspace_id ? Number(fields.workspace_id) : null
      : current.workspace_id;

  await db.prepare(
    `UPDATE employees
     SET name = ?, email = ?, secondary_email = ?, role = ?, department = ?, title = ?,
         active = ?, base_salary = ?, salary_currency = ?, last_payment_date = ?, payment_status = ?, user_id = ?,
         employment_type = ?, workspace_id = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    name,
    email,
    secondary_email,
    role,
    department,
    title,
    active,
    baseSalary,
    salaryCurrency,
    lastPaymentDate,
    paymentStatus,
    userId,
    employment_type,
    workspace_id,
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
  return info.rowCount ?? info.changes ?? 0;
}

export async function employeeTicketCount(id) {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM tickets WHERE employee_id = ?')
    .get(Number(id));
  return row.c;
}

/**
 * Detaches an employee's tickets so nothing is left pointing at a row that no
 * longer exists. Unassigns both employee_id and assigned_to across any linked
 * user accounts or directory entries.
 *
 * Returns the number of tickets affected so the caller can report it.
 */
export async function unassignEmployeeTickets(id, userIds = []) {
  const empId = Number(id);
  const validUserIds = Array.isArray(userIds) ? userIds.filter(Boolean).map(Number) : [];

  let count = 0;
  const empRes = await db
    .prepare('UPDATE tickets SET employee_id = NULL WHERE employee_id = ?')
    .run(empId);
  count += (empRes.rowCount ?? empRes.changes ?? 0);

  if (validUserIds.length > 0) {
    for (const uid of validUserIds) {
      const uRes = await db
        .prepare('UPDATE tickets SET assigned_to = NULL WHERE assigned_to = ?')
        .run(uid);
      count += (uRes.rowCount ?? uRes.changes ?? 0);
    }
  } else {
    const uRes = await db
      .prepare(
        `UPDATE tickets SET assigned_to = NULL
         WHERE assigned_to IN (SELECT u.id FROM users u WHERE u.email = (SELECT email FROM employees WHERE id = ?))`
      )
      .run(empId);
    count += (uRes.rowCount ?? uRes.changes ?? 0);
  }

  return count;
}
