import { db } from './db.js';

/**
 * Validates whether assigning proposedManagerId as the manager for employeeId is valid.
 * Enforces two critical rules:
 * 1. Self-reporting is blocked.
 * 2. Circular reporting chains are blocked (e.g. A -> B -> C -> A).
 */
export async function validateManagerAssignment(employeeId, proposedManagerId) {
  const empId = Number(employeeId);
  const mgrId = proposedManagerId ? Number(proposedManagerId) : null;

  if (!mgrId) {
    // Setting manager to null / unassigned is always structurally valid
    return { valid: true };
  }

  if (empId === mgrId) {
    return { valid: false, error: 'An employee cannot report to themselves.' };
  }

  const manager = await db
    .prepare('SELECT id, name, reporting_manager_id, workspace_id FROM employees WHERE id = ?')
    .get(mgrId);

  if (!manager) {
    return { valid: false, error: 'The proposed reporting manager does not exist.' };
  }

  const employee = await db
    .prepare('SELECT id, name, workspace_id FROM employees WHERE id = ?')
    .get(empId);

  if (employee && manager.workspace_id && employee.workspace_id && manager.workspace_id !== employee.workspace_id) {
    return { valid: false, error: 'The reporting manager must belong to the same workspace.' };
  }

  // Cycle detection: walk upward from proposedManager. If we ever encounter empId, a cycle would form.
  let currentId = manager.reporting_manager_id;
  const visited = new Set([mgrId]);
  const cyclePath = [manager.name];

  while (currentId) {
    if (currentId === empId) {
      cyclePath.push(employee?.name || `Employee #${empId}`);
      return {
        valid: false,
        error: `Circular reporting relationship detected: ${cyclePath.join(' -> ')} -> ${manager.name}. An employee cannot report to someone in their own downstream reporting line.`,
      };
    }

    if (visited.has(currentId)) {
      // Existing cycle in historical data, stop traversal to prevent infinite loop
      break;
    }
    visited.add(currentId);

    const ancestor = await db
      .prepare('SELECT id, name, reporting_manager_id FROM employees WHERE id = ?')
      .get(currentId);

    if (!ancestor) break;
    cyclePath.unshift(ancestor.name);
    currentId = ancestor.reporting_manager_id;
  }

  return { valid: true };
}

/**
 * Returns direct reportees for a manager.
 */
export async function getDirectReportees(managerId, { activeOnly = true } = {}) {
  if (!managerId) return [];
  const where = ['e.reporting_manager_id = ?'];
  const params = [Number(managerId)];

  if (activeOnly) {
    where.push('e.active = 1');
  }

  const sql = `
    SELECT e.id, e.name, e.email, e.title, e.role, e.employment_status, e.active,
           d.name AS department_name, des.title AS designation_title,
           up.avatar_url
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN designations des ON des.id = e.designation_id
    LEFT JOIN user_profiles up ON up.user_id = e.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.name COLLATE NOCASE
  `;
  return db.prepare(sql).all(...params);
}

/**
 * Returns all indirect reportees (all descendants in reporting tree) for a manager.
 */
export async function getIndirectReportees(managerId, { activeOnly = true } = {}) {
  if (!managerId) return [];
  const direct = await getDirectReportees(managerId, { activeOnly });
  const allSubordinates = [];
  const queue = [...direct];
  const seen = new Set([Number(managerId)]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current.id)) continue;
    seen.add(current.id);

    allSubordinates.push(current);
    const children = await getDirectReportees(current.id, { activeOnly });
    for (const child of children) {
      if (!seen.has(child.id)) {
        queue.push(child);
      }
    }
  }

  return allSubordinates;
}

/**
 * Constructs the full organizational hierarchy / reporting tree for a workspace.
 */
export async function getReportingTree({ workspaceId = null } = {}) {
  const where = ['e.active = 1'];
  const params = [];

  if (workspaceId) {
    where.push('e.workspace_id = ?');
    params.push(Number(workspaceId));
  }

  const sql = `
    SELECT e.id, e.name, e.email, e.title, e.role, e.reporting_manager_id,
           e.department_id, e.designation_id, e.employment_status,
           d.name AS department_name, des.title AS designation_title,
           up.avatar_url
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN designations des ON des.id = e.designation_id
    LEFT JOIN user_profiles up ON up.user_id = e.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.name COLLATE NOCASE
  `;

  const rows = await db.prepare(sql).all(...params);
  const employeeMap = new Map();

  rows.forEach((row) => {
    employeeMap.set(row.id, {
      ...row,
      children: [],
    });
  });

  const roots = [];
  let maxDepth = 0;

  function calculateDepth(node, currentDepth = 1) {
    if (currentDepth > maxDepth) maxDepth = currentDepth;
    for (const child of node.children) {
      calculateDepth(child, currentDepth + 1);
    }
  }

  rows.forEach((row) => {
    const node = employeeMap.get(row.id);
    if (row.reporting_manager_id && employeeMap.has(row.reporting_manager_id)) {
      const parent = employeeMap.get(row.reporting_manager_id);
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  for (const root of roots) {
    calculateDepth(root, 1);
  }

  return {
    roots,
    totalEmployees: rows.length,
    maxDepth,
  };
}

/**
 * Returns the reporting chain for a specific employee:
 * - Upward managers chain up to top root
 * - Direct reportees
 * - Total downstream count
 */
export async function getEmployeeHierarchy(employeeId) {
  if (!employeeId) return null;
  const targetId = Number(employeeId);

  const employee = await db
    .prepare(`
      SELECT e.id, e.name, e.email, e.title, e.role, e.reporting_manager_id,
             e.department_id, e.designation_id, e.employment_status,
             d.name AS department_name, des.title AS designation_title
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN designations des ON des.id = e.designation_id
      WHERE e.id = ?
    `)
    .get(targetId);

  if (!employee) return null;

  // Upward chain
  const managersChain = [];
  let currentMgrId = employee.reporting_manager_id;
  const visited = new Set([targetId]);

  while (currentMgrId) {
    if (visited.has(currentMgrId)) break;
    visited.add(currentMgrId);

    const mgr = await db
      .prepare(`
        SELECT e.id, e.name, e.email, e.title, e.role, e.reporting_manager_id,
               d.name AS department_name, des.title AS designation_title
        FROM employees e
        LEFT JOIN departments d ON d.id = e.department_id
        LEFT JOIN designations des ON des.id = e.designation_id
        WHERE e.id = ?
      `)
      .get(currentMgrId);

    if (!mgr) break;
    managersChain.push(mgr);
    currentMgrId = mgr.reporting_manager_id;
  }

  const directReportees = await getDirectReportees(targetId);
  const allReportees = await getIndirectReportees(targetId);

  return {
    employee,
    managersChain,
    directReportees,
    totalDownstreamCount: allReportees.length,
  };
}

