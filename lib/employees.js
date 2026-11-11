import { db } from './db.js';
import { validateManagerAssignment } from './reportingTree.js';
import { isAdminOrOwner } from './rbac.js';

const EMPLOYEES_SELECT = `
  SELECT e.*,
    w.name AS workspace_name,
    d.name AS department_name,
    d.code AS department_code,
    des.title AS designation_title,
    des.level AS designation_level,
    mgr.name AS reporting_manager_name,
    mgr.email AS reporting_manager_email,
    (SELECT COUNT(*) FROM tickets t WHERE t.employee_id = e.id) AS assigned_count,
    (SELECT COUNT(*) FROM tickets t
      WHERE t.employee_id = e.id AND t.status IN ('open', 'in_progress')) AS open_count,
    COALESCE(e.user_id, (SELECT u.id FROM users u WHERE u.email = e.email)) AS user_id
  FROM employees e
  LEFT JOIN workspaces w ON w.id = e.workspace_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN designations des ON des.id = e.designation_id
  LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
`;

const ACTIVE_FIRST = ' ORDER BY e.active DESC, e.name COLLATE NOCASE';

// `active` is an INTEGER column, but the UI and the JSON contract both expect
// a real boolean, so every employee row is normalised on the way out.
function toEmployee(row) {
  return row ? { ...row, active: Boolean(row.active) } : row;
}

export async function getEmployees({
  includeInactive = true,
  workspaceId = null,
  departmentId = null,
  designationId = null,
  reportingManagerId = null,
  employmentStatus = null,
  search = null,
} = {}) {
  const conditions = [];
  const params = [];
  if (!includeInactive) {
    conditions.push('e.active = 1');
  }
  if (workspaceId) {
    conditions.push('e.workspace_id = ?');
    params.push(Number(workspaceId));
  }
  if (departmentId) {
    conditions.push('e.department_id = ?');
    params.push(Number(departmentId));
  }
  if (designationId) {
    conditions.push('e.designation_id = ?');
    params.push(Number(designationId));
  }
  if (reportingManagerId) {
    conditions.push('e.reporting_manager_id = ?');
    params.push(Number(reportingManagerId));
  }
  if (employmentStatus) {
    conditions.push('e.employment_status = ?');
    params.push(String(employmentStatus));
  }
  if (search && search.trim()) {
    conditions.push('(e.name LIKE ? OR e.email LIKE ? OR e.department LIKE ? OR e.title LIKE ?)');
    const term = `%${search.trim()}%`;
    params.push(term, term, term, term);
  }
  const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const sql = `${EMPLOYEES_SELECT}${whereClause}${ACTIVE_FIRST}`;
  const rows = await db.prepare(sql).all(...params);
  return rows.map(toEmployee);
}

export const listEmployees = getEmployees;

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

export function toSafeEmployee(employee, viewerOrIsAdmin = false, isSelf = false) {
  if (!employee) return null;
  let isAdmin = false;
  let selfMatch = Boolean(isSelf);
  if (typeof viewerOrIsAdmin === 'boolean') {
    isAdmin = viewerOrIsAdmin;
  } else if (viewerOrIsAdmin && typeof viewerOrIsAdmin === 'object') {
    isAdmin = isAdminOrOwner(viewerOrIsAdmin);
    if (viewerOrIsAdmin.id && employee.user_id && Number(viewerOrIsAdmin.id) === Number(employee.user_id)) {
      selfMatch = true;
    }
  }
  if (isAdmin || selfMatch) return employee;
  // Strip sensitive compensation and private contact information for non-administrators
  const {
    base_salary,
    salary_currency,
    last_payment_date,
    payment_status,
    current_address,
    permanent_address,
    emergency_contact_name,
    emergency_contact_relation,
    emergency_contact_phone,
    blood_group,
    dob,
    ...safe
  } = employee;
  return safe;
}

export async function createEmployee({
  name,
  email = null,
  secondary_email = null,
  role = 'developer',
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
  department_id = null,
  designation_id = null,
  reporting_manager_id = null,
  phone = '',
  dob = null,
  gender = '',
  current_address = '',
  permanent_address = '',
  emergency_contact_name = '',
  emergency_contact_relation = '',
  emergency_contact_phone = '',
  blood_group = '',
  employment_status = 'active',
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

  let resolvedDeptId = department_id ? Number(department_id) : null;
  let resolvedDesigId = designation_id ? Number(designation_id) : null;
  let resolvedMgrId = reporting_manager_id ? Number(reporting_manager_id) : null;
  let resolvedDeptName = department;
  let resolvedTitle = title;

  if (resolvedDeptId) {
    const deptRow = await db.prepare('SELECT name FROM departments WHERE id = ?').get(resolvedDeptId);
    if (deptRow && !resolvedDeptName) resolvedDeptName = deptRow.name;
  }
  if (resolvedDesigId) {
    const desigRow = await db.prepare('SELECT title FROM designations WHERE id = ?').get(resolvedDesigId);
    if (desigRow && !resolvedTitle) resolvedTitle = desigRow.title;
  }

  if (resolvedMgrId) {
    const mgrValidation = await validateManagerAssignment(null, resolvedMgrId);
    if (!mgrValidation.valid) {
      throw new Error(mgrValidation.error);
    }
  }

  const info = await db
    .prepare(
      `INSERT INTO employees (
        name, email, secondary_email, role, department, title,
        base_salary, salary_currency, last_payment_date, payment_status,
        user_id, employment_type, joining_date, workspace_id,
        department_id, designation_id, reporting_manager_id,
        phone, dob, gender, current_address, permanent_address,
        emergency_contact_name, emergency_contact_relation, emergency_contact_phone,
        blood_group, employment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      cleanEmail,
      cleanSecondaryEmail,
      role || 'developer',
      resolvedDeptName,
      resolvedTitle,
      salaryNum,
      salary_currency || 'USD',
      last_payment_date || null,
      payment_status || '',
      user_id ? Number(user_id) : null,
      employment_type || 'full_time',
      joining_date || new Date().toISOString().slice(0, 10),
      resolvedWorkspaceId,
      resolvedDeptId,
      resolvedDesigId,
      resolvedMgrId,
      phone ? String(phone).trim() : '',
      dob || null,
      gender ? String(gender).trim() : '',
      current_address ? String(current_address).trim() : '',
      permanent_address ? String(permanent_address).trim() : '',
      emergency_contact_name ? String(emergency_contact_name).trim() : '',
      emergency_contact_relation ? String(emergency_contact_relation).trim() : '',
      emergency_contact_phone ? String(emergency_contact_phone).trim() : '',
      blood_group ? String(blood_group).trim() : '',
      employment_status || 'active'
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
  let department = fields.department !== undefined ? fields.department : current.department;
  let title = fields.title !== undefined ? fields.title : current.title;

  let employment_status =
    fields.employment_status !== undefined
      ? fields.employment_status || 'active'
      : current.employment_status || 'active';

  let active = fields.active !== undefined ? (fields.active ? 1 : 0) : (current.active ? 1 : 0);
  if (fields.employment_status !== undefined && fields.active === undefined) {
    if (['resigned', 'terminated'].includes(employment_status)) {
      active = 0;
    } else if (['active', 'probation'].includes(employment_status)) {
      active = 1;
    }
  } else if (fields.active !== undefined && fields.employment_status === undefined) {
    if (!active && ['active', 'probation'].includes(employment_status)) {
      employment_status = 'terminated';
    } else if (active && ['resigned', 'terminated'].includes(employment_status)) {
      employment_status = 'active';
    }
  }

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

  const department_id =
    fields.department_id !== undefined
      ? fields.department_id ? Number(fields.department_id) : null
      : current.department_id;

  const designation_id =
    fields.designation_id !== undefined
      ? fields.designation_id ? Number(fields.designation_id) : null
      : current.designation_id;

  const reporting_manager_id =
    fields.reporting_manager_id !== undefined
      ? fields.reporting_manager_id ? Number(fields.reporting_manager_id) : null
      : current.reporting_manager_id;

  const phone = fields.phone !== undefined ? String(fields.phone).trim() : current.phone || '';
  const dob = fields.dob !== undefined ? fields.dob : current.dob;
  const gender = fields.gender !== undefined ? String(fields.gender).trim() : current.gender || '';
  const current_address =
    fields.current_address !== undefined ? String(fields.current_address).trim() : current.current_address || '';
  const permanent_address =
    fields.permanent_address !== undefined ? String(fields.permanent_address).trim() : current.permanent_address || '';
  const emergency_contact_name =
    fields.emergency_contact_name !== undefined
      ? String(fields.emergency_contact_name).trim()
      : current.emergency_contact_name || '';
  const emergency_contact_relation =
    fields.emergency_contact_relation !== undefined
      ? String(fields.emergency_contact_relation).trim()
      : current.emergency_contact_relation || '';
  const emergency_contact_phone =
    fields.emergency_contact_phone !== undefined
      ? String(fields.emergency_contact_phone).trim()
      : current.emergency_contact_phone || '';
  const blood_group =
    fields.blood_group !== undefined ? String(fields.blood_group).trim() : current.blood_group || '';

  if (fields.department_id !== undefined && fields.department_id) {
    const deptRow = await db.prepare('SELECT name FROM departments WHERE id = ?').get(department_id);
    if (deptRow && (!fields.department || fields.department === current.department)) {
      department = deptRow.name;
    }
  }

  if (fields.designation_id !== undefined && fields.designation_id) {
    const desigRow = await db.prepare('SELECT title FROM designations WHERE id = ?').get(designation_id);
    if (desigRow && (!fields.title || fields.title === current.title)) {
      title = desigRow.title;
    }
  }

  if (fields.reporting_manager_id !== undefined && reporting_manager_id !== current.reporting_manager_id) {
    const mgrValidation = await validateManagerAssignment(id, reporting_manager_id);
    if (!mgrValidation.valid) {
      throw new Error(mgrValidation.error);
    }
  }

  await db.prepare(
    `UPDATE employees
     SET name = ?, email = ?, secondary_email = ?, role = ?, department = ?, title = ?,
         active = ?, base_salary = ?, salary_currency = ?, last_payment_date = ?, payment_status = ?, user_id = ?,
         employment_type = ?, workspace_id = ?, department_id = ?, designation_id = ?, reporting_manager_id = ?,
         phone = ?, dob = ?, gender = ?, current_address = ?, permanent_address = ?,
         emergency_contact_name = ?, emergency_contact_relation = ?, emergency_contact_phone = ?,
         blood_group = ?, employment_status = ?, updated_at = datetime('now')
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
    department_id,
    designation_id,
    reporting_manager_id,
    phone,
    dob,
    gender,
    current_address,
    permanent_address,
    emergency_contact_name,
    emergency_contact_relation,
    emergency_contact_phone,
    blood_group,
    employment_status,
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
