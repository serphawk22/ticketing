import { db } from './db.js';
import { logAuditEvent } from './audit.js';

const DEPARTMENTS_SELECT = `
  SELECT d.*,
    w.name AS workspace_name,
    e.name AS head_name,
    e.email AS head_email,
    (SELECT COUNT(*) FROM employees emp WHERE emp.department_id = d.id AND emp.active = 1) AS employee_count,
    (SELECT COUNT(*) FROM designations des WHERE des.department_id = d.id AND des.active = 1) AS designation_count
  FROM departments d
  LEFT JOIN workspaces w ON w.id = d.workspace_id
  LEFT JOIN employees e ON e.id = d.head_employee_id
`;

const DESIGNATIONS_SELECT = `
  SELECT des.*,
    w.name AS workspace_name,
    dept.name AS department_name,
    dept.code AS department_code,
    (SELECT COUNT(*) FROM employees emp WHERE emp.designation_id = des.id AND emp.active = 1) AS employee_count
  FROM designations des
  LEFT JOIN workspaces w ON w.id = des.workspace_id
  LEFT JOIN departments dept ON dept.id = des.department_id
`;

function toDepartment(row) {
  if (!row) return null;
  return {
    ...row,
    active: Boolean(row.active),
    employee_count: Number(row.employee_count || 0),
    designation_count: Number(row.designation_count || 0),
  };
}

function toDesignation(row) {
  if (!row) return null;
  return {
    ...row,
    active: Boolean(row.active),
    employee_count: Number(row.employee_count || 0),
  };
}

export async function getDepartments({ workspaceId = null, activeOnly = false } = {}) {
  const where = [];
  const params = [];

  if (activeOnly) {
    where.push('d.active = 1');
  }
  if (workspaceId) {
    where.push('d.workspace_id = ?');
    params.push(Number(workspaceId));
  }

  const whereClause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const sql = `${DEPARTMENTS_SELECT}${whereClause} ORDER BY d.active DESC, d.name COLLATE NOCASE`;
  const rows = await db.prepare(sql).all(...params);
  return rows.map(toDepartment);
}

export async function getDepartment(id) {
  if (!id) return null;
  const row = await db.prepare(`${DEPARTMENTS_SELECT} WHERE d.id = ?`).get(Number(id));
  return toDepartment(row);
}

export async function getDepartmentByCode(code, workspaceId) {
  if (!code || !workspaceId) return null;
  const row = await db
    .prepare(`${DEPARTMENTS_SELECT} WHERE LOWER(d.code) = LOWER(?) AND d.workspace_id = ?`)
    .get(String(code).trim(), Number(workspaceId));
  return toDepartment(row);
}

export async function getDepartmentEmployees(departmentId, { activeOnly = true } = {}) {
  if (!departmentId) return [];
  const where = ['e.department_id = ?'];
  const params = [Number(departmentId)];

  if (activeOnly) {
    where.push('e.active = 1');
  }

  const sql = `
    SELECT e.id, e.name, e.email, e.title, e.role, e.employment_status, e.active,
           des.title AS designation_title, des.level AS designation_level
    FROM employees e
    LEFT JOIN designations des ON des.id = e.designation_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.name COLLATE NOCASE
  `;
  return db.prepare(sql).all(...params);
}

export async function createDepartment({
  workspaceId,
  name,
  code,
  description = '',
  headEmployeeId = null,
  actor = null,
}) {
  if (!name || !String(name).trim()) {
    throw new Error('Department name is required.');
  }
  if (!code || !String(code).trim()) {
    throw new Error('Department code is required.');
  }

  const cleanName = String(name).trim();
  const cleanCode = String(code).trim().toUpperCase();
  const cleanDesc = description ? String(description).trim() : '';

  let resolvedWorkspaceId = workspaceId ? Number(workspaceId) : null;
  if (!resolvedWorkspaceId) {
    const defaultWs = await db.prepare('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1').get();
    resolvedWorkspaceId = defaultWs?.id || null;
  }
  if (!resolvedWorkspaceId) {
    throw new Error('Valid workspace is required for department.');
  }

  // Check code uniqueness within workspace
  const existing = await getDepartmentByCode(cleanCode, resolvedWorkspaceId);
  if (existing) {
    throw new Error(`A department with code "${cleanCode}" already exists in this workspace.`);
  }

  let resolvedHeadId = headEmployeeId ? Number(headEmployeeId) : null;
  if (resolvedHeadId) {
    const headEmp = await db
      .prepare('SELECT id, workspace_id FROM employees WHERE id = ?')
      .get(resolvedHeadId);
    if (!headEmp) {
      throw new Error('Assigned head of department does not exist.');
    }
    if (headEmp.workspace_id && headEmp.workspace_id !== resolvedWorkspaceId) {
      throw new Error('Head of department must belong to the same workspace.');
    }
  }

  const res = await db.prepare(`
    INSERT INTO departments (workspace_id, name, code, description, head_employee_id, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(resolvedWorkspaceId, cleanName, cleanCode, cleanDesc, resolvedHeadId);

  const dept = await getDepartment(res.lastInsertRowid);

  await logAuditEvent({
    actorId: actor?.id || null,
    actorName: actor?.name || 'System',
    action: 'department.created',
    entityType: 'department',
    entityId: dept.id,
    details: { name: dept.name, code: dept.code, workspace_id: dept.workspace_id },
  });

  return dept;
}

export async function updateDepartment(id, fields = {}, actor = null) {
  const current = await getDepartment(id);
  if (!current) throw new Error('Department not found.');

  const name = fields.name !== undefined ? String(fields.name).trim() : current.name;
  const code = fields.code !== undefined ? String(fields.code).trim().toUpperCase() : current.code;
  const description = fields.description !== undefined ? String(fields.description).trim() : current.description;
  const active = fields.active !== undefined ? (fields.active ? 1 : 0) : (current.active ? 1 : 0);

  let headEmployeeId = current.head_employee_id;
  if (fields.head_employee_id !== undefined) {
    if (fields.head_employee_id === null || fields.head_employee_id === '') {
      headEmployeeId = null;
    } else {
      const candidateId = Number(fields.head_employee_id);
      const headEmp = await db.prepare('SELECT id, workspace_id FROM employees WHERE id = ?').get(candidateId);
      if (!headEmp) throw new Error('Assigned head of department does not exist.');
      if (headEmp.workspace_id && headEmp.workspace_id !== current.workspace_id) {
        throw new Error('Head of department must belong to the same workspace.');
      }
      headEmployeeId = candidateId;
    }
  }

  if (code !== current.code) {
    const existing = await getDepartmentByCode(code, current.workspace_id);
    if (existing && existing.id !== current.id) {
      throw new Error(`A department with code "${code}" already exists in this workspace.`);
    }
  }

  await db.prepare(`
    UPDATE departments
    SET name = ?, code = ?, description = ?, head_employee_id = ?, active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, code, description, headEmployeeId, active, Number(id));

  const updated = await getDepartment(id);

  await logAuditEvent({
    actorId: actor?.id || null,
    actorName: actor?.name || 'System',
    action: 'department.updated',
    entityType: 'department',
    entityId: id,
    details: { previous: current, updated },
  });

  return updated;
}

export async function deleteDepartment(id, actor = null) {
  const current = await getDepartment(id);
  if (!current) throw new Error('Department not found.');

  const empCountRow = await db
    .prepare('SELECT COUNT(*) AS c FROM employees WHERE department_id = ?')
    .get(Number(id));
  if (Number(empCountRow.c) > 0) {
    throw new Error(`Cannot delete department: ${empCountRow.c} employee(s) are currently assigned to it.`);
  }

  const desigCountRow = await db
    .prepare('SELECT COUNT(*) AS c FROM designations WHERE department_id = ?')
    .get(Number(id));
  if (Number(desigCountRow.c) > 0) {
    throw new Error(`Cannot delete department: ${desigCountRow.c} designation(s) are linked to it.`);
  }

  await db.prepare('DELETE FROM departments WHERE id = ?').run(Number(id));

  await logAuditEvent({
    actorId: actor?.id || null,
    actorName: actor?.name || 'System',
    action: 'department.deleted',
    entityType: 'department',
    entityId: id,
    details: { name: current.name, code: current.code },
  });

  return true;
}

// ---------------- DESIGNATIONS ----------------

export async function getDesignations({
  workspaceId = null,
  departmentId = null,
  activeOnly = false,
} = {}) {
  const where = [];
  const params = [];

  if (activeOnly) {
    where.push('des.active = 1');
  }
  if (workspaceId) {
    where.push('des.workspace_id = ?');
    params.push(Number(workspaceId));
  }
  if (departmentId) {
    where.push('des.department_id = ?');
    params.push(Number(departmentId));
  }

  const whereClause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const sql = `${DESIGNATIONS_SELECT}${whereClause} ORDER BY des.active DESC, des.title COLLATE NOCASE`;
  const rows = await db.prepare(sql).all(...params);
  return rows.map(toDesignation);
}

export async function getDesignation(id) {
  if (!id) return null;
  const row = await db.prepare(`${DESIGNATIONS_SELECT} WHERE des.id = ?`).get(Number(id));
  return toDesignation(row);
}

export async function getDesignationByCode(code, workspaceId) {
  if (!code || !workspaceId) return null;
  const row = await db
    .prepare(`${DESIGNATIONS_SELECT} WHERE LOWER(des.code) = LOWER(?) AND des.workspace_id = ?`)
    .get(String(code).trim(), Number(workspaceId));
  return toDesignation(row);
}

export async function createDesignation({
  workspaceId,
  departmentId,
  title,
  code,
  level = '',
  description = '',
  actor = null,
}) {
  if (!title || !String(title).trim()) throw new Error('Designation title is required.');
  if (!code || !String(code).trim()) throw new Error('Designation code is required.');
  if (!departmentId) throw new Error('Department is required for designation.');

  const dept = await getDepartment(departmentId);
  if (!dept) throw new Error('Selected department does not exist.');

  const cleanTitle = String(title).trim();
  const cleanCode = String(code).trim().toUpperCase();
  const cleanLevel = level ? String(level).trim() : '';
  const cleanDesc = description ? String(description).trim() : '';
  const resolvedWsId = workspaceId ? Number(workspaceId) : dept.workspace_id;

  if (dept.workspace_id !== resolvedWsId) {
    throw new Error('Department does not belong to the specified workspace.');
  }

  const existing = await getDesignationByCode(cleanCode, resolvedWsId);
  if (existing) {
    throw new Error(`A designation with code "${cleanCode}" already exists in this workspace.`);
  }

  const res = await db.prepare(`
    INSERT INTO designations (workspace_id, department_id, title, code, level, description, active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(resolvedWsId, dept.id, cleanTitle, cleanCode, cleanLevel, cleanDesc);

  const designation = await getDesignation(res.lastInsertRowid);

  await logAuditEvent({
    actorId: actor?.id || null,
    actorName: actor?.name || 'System',
    action: 'designation.created',
    entityType: 'designation',
    entityId: designation.id,
    details: { title: designation.title, code: designation.code, department_id: dept.id },
  });

  return designation;
}

export async function updateDesignation(id, fields = {}, actor = null) {
  const current = await getDesignation(id);
  if (!current) throw new Error('Designation not found.');

  const title = fields.title !== undefined ? String(fields.title).trim() : current.title;
  const code = fields.code !== undefined ? String(fields.code).trim().toUpperCase() : current.code;
  const level = fields.level !== undefined ? String(fields.level).trim() : current.level;
  const description = fields.description !== undefined ? String(fields.description).trim() : current.description;
  const active = fields.active !== undefined ? (fields.active ? 1 : 0) : (current.active ? 1 : 0);

  let departmentId = current.department_id;
  if (fields.department_id !== undefined && fields.department_id !== current.department_id) {
    const dept = await getDepartment(fields.department_id);
    if (!dept) throw new Error('Specified department does not exist.');
    if (dept.workspace_id !== current.workspace_id) {
      throw new Error('Department does not belong to the same workspace.');
    }
    departmentId = dept.id;
  }

  if (code !== current.code) {
    const existing = await getDesignationByCode(code, current.workspace_id);
    if (existing && existing.id !== current.id) {
      throw new Error(`A designation with code "${code}" already exists in this workspace.`);
    }
  }

  await db.prepare(`
    UPDATE designations
    SET department_id = ?, title = ?, code = ?, level = ?, description = ?, active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(departmentId, title, code, level, description, active, Number(id));

  const updated = await getDesignation(id);

  await logAuditEvent({
    actorId: actor?.id || null,
    actorName: actor?.name || 'System',
    action: 'designation.updated',
    entityType: 'designation',
    entityId: id,
    details: { previous: current, updated },
  });

  return updated;
}

export async function deleteDesignation(id, actor = null) {
  const current = await getDesignation(id);
  if (!current) throw new Error('Designation not found.');

  const countRow = await db
    .prepare('SELECT COUNT(*) AS c FROM employees WHERE designation_id = ?')
    .get(Number(id));
  if (Number(countRow.c) > 0) {
    throw new Error(`Cannot delete designation: ${countRow.c} employee(s) are currently assigned to it.`);
  }

  await db.prepare('DELETE FROM designations WHERE id = ?').run(Number(id));

  await logAuditEvent({
    actorId: actor?.id || null,
    actorName: actor?.name || 'System',
    action: 'designation.deleted',
    entityType: 'designation',
    entityId: id,
    details: { title: current.title, code: current.code },
  });

  return true;
}

