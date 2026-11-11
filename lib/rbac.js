import { db } from './db.js';
import { getIndirectReportees } from './reportingTree.js';

export const CANONICAL_ROLES = ['owner', 'admin', 'manager', 'employee', 'client'];
export const VALID_DIRECTORY_ROLES = ['owner', 'admin', 'manager', 'employee', 'developer', 'client'];
export const TEAM_ROLES = new Set(['owner', 'admin', 'manager', 'employee']);

/**
 * Normalizes legacy role values (`developer` -> `employee`) into canonical roles.
 */
export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'developer') return 'employee';
  return value || 'employee';
}

export function isOwner(user) {
  return normalizeRole(user?.role) === 'owner';
}

export function isAdminOrOwner(user) {
  const role = normalizeRole(user?.role);
  return role === 'owner' || role === 'admin';
}

export function isManager(user) {
  return normalizeRole(user?.role) === 'manager';
}

export function isClient(user) {
  return normalizeRole(user?.role) === 'client';
}

export function isTeamUser(user) {
  return TEAM_ROLES.has(normalizeRole(user?.role));
}

export function canRouteWork(user) {
  return isTeamUser(user);
}

/**
 * Enforces strict role governance:
 * - Only `owner` or `admin` can assign/modify roles.
 * - `admin` cannot elevate anyone to `owner` and cannot modify or demote an existing `owner`.
 * - Only `owner` can assign or change the `owner` tier.
 */
export function canAssignOrModifyRole({ actor, targetCurrentRole = null, targetNewRole = null }) {
  if (!actor || !isAdminOrOwner(actor)) {
    return {
      allowed: false,
      reason: 'Only Business Owners or Administrators can assign or modify user roles.',
    };
  }

  const actorRole = normalizeRole(actor.role);
  const currentNorm = targetCurrentRole ? normalizeRole(targetCurrentRole) : null;
  const nextNorm = targetNewRole ? normalizeRole(targetNewRole) : null;

  if (nextNorm && !CANONICAL_ROLES.includes(nextNorm)) {
    return {
      allowed: false,
      reason: 'Invalid role specified.',
    };
  }

  if (actorRole === 'admin') {
    if (currentNorm === 'owner') {
      return {
        allowed: false,
        reason: 'Administrators cannot modify or demote a Business Owner.',
      };
    }
    if (nextNorm === 'owner') {
      return {
        allowed: false,
        reason: 'Administrators cannot assign the Owner role.',
      };
    }
  }

  return { allowed: true, reason: null };
}

/**
 * Resolves the employees.id record corresponding to a logged-in user session.
 */
export async function getEmployeeIdForUser(user) {
  if (!user) return null;
  if (user.employee_id) return Number(user.employee_id);

  if (user.id) {
    const byUserId = await db
      .prepare('SELECT id FROM employees WHERE user_id = ?')
      .get(Number(user.id));
    if (byUserId?.id) return Number(byUserId.id);
  }

  if (user.email) {
    const cleanEmail = String(user.email).trim().toLowerCase();
    const byEmail = await db
      .prepare('SELECT id FROM employees WHERE LOWER(email) = ?')
      .get(cleanEmail);
    if (byEmail?.id) return Number(byEmail.id);
  }

  return null;
}

/**
 * Computes the deduplicated union of employees within a manager's scope:
 * 1. Direct & indirect reportees via reporting_manager_id hierarchy.
 * 2. Active project team members (`project_members.is_active = 1`) on any project
 *    where this manager is an active lead or manager.
 */
export async function getManagerScopedEmployeeIds(managerEmployeeId, { includeSelf = false } = {}) {
  const result = new Set();
  const mgrId = Number(managerEmployeeId);
  if (!Number.isInteger(mgrId) || mgrId <= 0) return result;

  if (includeSelf) {
    result.add(mgrId);
  }

  const reportees = await getIndirectReportees(mgrId, { activeOnly: true });
  for (const emp of reportees) {
    if (emp?.id) result.add(Number(emp.id));
  }

  const projectPeers = await db
    .prepare(
      `SELECT DISTINCT pm_member.employee_id
       FROM project_members pm_mgr
       JOIN project_members pm_member ON pm_member.project_id = pm_mgr.project_id
       JOIN employees e ON e.id = pm_member.employee_id
       WHERE pm_mgr.employee_id = ?
         AND pm_mgr.is_active = 1
         AND pm_mgr.project_role IN ('lead', 'manager')
         AND pm_member.is_active = 1
         AND e.active = 1`
    )
    .all(mgrId);

  for (const row of projectPeers) {
    if (row?.employee_id) result.add(Number(row.employee_id));
  }

  if (!includeSelf) {
    result.delete(mgrId);
  }

  return result;
}

/**
 * Computes the deduplicated union of projects within a manager's scope:
 * 1. Projects where manager is an active lead/manager in `project_members`.
 * 2. Projects where at least one reporting-hierarchy employee is an active member
 *    or holds an active (unarchived) assigned ticket.
 */
export async function getManagerScopedProjectIds(managerEmployeeId) {
  const result = new Set();
  const mgrId = Number(managerEmployeeId);
  if (!Number.isInteger(mgrId) || mgrId <= 0) return result;

  const directManaged = await db
    .prepare(
      `SELECT DISTINCT project_id
       FROM project_members
       WHERE employee_id = ?
         AND is_active = 1
         AND project_role IN ('lead', 'manager')`
    )
    .all(mgrId);

  for (const row of directManaged) {
    if (row?.project_id) result.add(Number(row.project_id));
  }

  const reportees = await getIndirectReportees(mgrId, { activeOnly: true });
  const reporteeIds = reportees.map((e) => Number(e.id)).filter((id) => Number.isInteger(id) && id > 0);
  if (reporteeIds.length > 0) {
    const placeholders = reporteeIds.map(() => '?').join(', ');
    const memberProjects = await db
      .prepare(
        `SELECT DISTINCT project_id
         FROM project_members
         WHERE employee_id IN (${placeholders})
           AND is_active = 1`
      )
      .all(...reporteeIds);
    for (const row of memberProjects) {
      if (row?.project_id) result.add(Number(row.project_id));
    }

    const ticketProjects = await db
      .prepare(
        `SELECT DISTINCT project_id
         FROM tickets
         WHERE employee_id IN (${placeholders})
           AND archived = 0
           AND project_id IS NOT NULL`
      )
      .all(...reporteeIds);
    for (const row of ticketProjects) {
      if (row?.project_id) result.add(Number(row.project_id));
    }
  }

  return result;
}

/**
 * Resolves full server-side RBAC scope for the current user.
 * Never trusts client-provided scope filters.
 */
export async function resolveUserScope(user) {
  if (!user) {
    return {
      role: 'anonymous',
      rawRole: 'anonymous',
      employeeId: null,
      isOwner: false,
      isAdmin: false,
      isAdminOrOwner: false,
      isManager: false,
      isEmployee: false,
      isClient: false,
      canViewAll: false,
      scopedEmployeeIds: new Set(),
      scopedProjectIds: new Set(),
    };
  }

  const role = normalizeRole(user.role);
  const employeeId = role === 'client' ? null : await getEmployeeIdForUser(user);

  if (role === 'owner' || role === 'admin') {
    return {
      role,
      rawRole: user.role,
      employeeId,
      isOwner: role === 'owner',
      isAdmin: role === 'admin',
      isAdminOrOwner: true,
      isManager: false,
      isEmployee: false,
      isClient: false,
      canViewAll: true,
      scopedEmployeeIds: null,
      scopedProjectIds: null,
    };
  }

  if (role === 'manager') {
    const scopedEmployeeIds = await getManagerScopedEmployeeIds(employeeId, { includeSelf: true });
    const scopedProjectIds = await getManagerScopedProjectIds(employeeId);
    return {
      role,
      rawRole: user.role,
      employeeId,
      isOwner: false,
      isAdmin: false,
      isAdminOrOwner: false,
      isManager: true,
      isEmployee: false,
      isClient: false,
      canViewAll: false,
      scopedEmployeeIds,
      scopedProjectIds,
    };
  }

  if (role === 'client') {
    const clientProjects = await db
      .prepare('SELECT id FROM projects WHERE client_id = ?')
      .all(Number(user.id));
    return {
      role,
      rawRole: user.role,
      employeeId: null,
      isOwner: false,
      isAdmin: false,
      isAdminOrOwner: false,
      isManager: false,
      isEmployee: false,
      isClient: true,
      canViewAll: false,
      scopedEmployeeIds: new Set(),
      scopedProjectIds: new Set(clientProjects.map((p) => Number(p.id))),
    };
  }

  // Canonical employee (or legacy developer)
  const scopedEmployeeIds = employeeId ? new Set([employeeId]) : new Set();
  const scopedProjectIds = new Set();
  if (employeeId) {
    const empProjects = await db
      .prepare(
        `SELECT DISTINCT project_id FROM project_members WHERE employee_id = ? AND is_active = 1
         UNION
         SELECT DISTINCT project_id FROM tickets WHERE employee_id = ? AND archived = 0 AND project_id IS NOT NULL`
      )
      .all(employeeId, employeeId);
    for (const row of empProjects) {
      if (row?.project_id) scopedProjectIds.add(Number(row.project_id));
    }
  }

  return {
    role: 'employee',
    rawRole: user.role,
    employeeId,
    isOwner: false,
    isAdmin: false,
    isAdminOrOwner: false,
    isManager: false,
    isEmployee: true,
    isClient: false,
    canViewAll: false,
    scopedEmployeeIds,
    scopedProjectIds,
  };
}

export async function assertCanViewEmployee(actor, targetEmployeeId) {
  const scope = await resolveUserScope(actor);
  const targetId = Number(targetEmployeeId);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return { allowed: false, scope, status: 400, error: 'Invalid employee ID.' };
  }
  if (scope.canViewAll) {
    return { allowed: true, scope };
  }
  if (scope.isClient) {
    return { allowed: false, scope, status: 403, error: 'Clients cannot view employee details.' };
  }
  if (scope.scopedEmployeeIds.has(targetId)) {
    return { allowed: true, scope };
  }
  return { allowed: false, scope, status: 403, error: 'Forbidden: employee is outside your monitoring scope.' };
}

export async function assertCanViewProject(actor, projectId) {
  const scope = await resolveUserScope(actor);
  const pid = Number(projectId);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { allowed: false, scope, status: 400, error: 'Invalid project ID.' };
  }
  if (scope.canViewAll) {
    return { allowed: true, scope };
  }
  if (scope.isClient) {
    const project = await db.prepare('SELECT client_id FROM projects WHERE id = ?').get(pid);
    if (project && Number(project.client_id) === Number(actor.id)) {
      return { allowed: true, scope };
    }
    return { allowed: false, scope, status: 403, error: 'Forbidden: project is outside your client scope.' };
  }
  if (scope.isManager) {
    if (scope.scopedProjectIds.has(pid)) {
      return { allowed: true, scope };
    }
    return { allowed: false, scope, status: 403, error: 'Forbidden: project is outside your management scope.' };
  }
  // Employee
  if (scope.scopedProjectIds.has(pid)) {
    return { allowed: true, scope };
  }
  return { allowed: false, scope, status: 403, error: 'Forbidden: project is not assigned to you.' };
}

export async function assertCanAccessTicket(actor, ticketOrId, { action = 'read' } = {}) {
  const scope = await resolveUserScope(actor);
  let ticket = ticketOrId;
  if (typeof ticketOrId === 'number' || typeof ticketOrId === 'string') {
    ticket = await db
      .prepare('SELECT id, project_id, employee_id, assigned_to, created_by, archived FROM tickets WHERE id = ?')
      .get(Number(ticketOrId));
  }
  if (!ticket) {
    return { allowed: false, scope, status: 404, error: 'Ticket not found.' };
  }

  if (scope.canViewAll) {
    return { allowed: true, scope, ticket };
  }

  if (scope.isClient) {
    const isCreator = Number(ticket.created_by) === Number(actor.id);
    if (!isCreator) {
      return { allowed: false, scope, status: 403, error: 'Forbidden: ticket is outside your client scope.' };
    }
    return { allowed: true, scope, ticket };
  }

  if (scope.isManager) {
    const inEmployees = ticket.employee_id != null && scope.scopedEmployeeIds.has(Number(ticket.employee_id));
    const inProjects = ticket.project_id != null && scope.scopedProjectIds.has(Number(ticket.project_id));
    const createdBySelf = Number(ticket.created_by) === Number(actor.id);
    const assignedUserSelf = Number(ticket.assigned_to) === Number(actor.id);
    if (inEmployees || inProjects || createdBySelf || assignedUserSelf) {
      return { allowed: true, scope, ticket };
    }
    return { allowed: false, scope, status: 403, error: 'Forbidden: ticket is outside your management scope.' };
  }

  // Team employees preserve board collaboration reads on team projects/tickets,
  // while write/delete actions still enforce route-level restrictions.
  if (action === 'delete') {
    return { allowed: false, scope, status: 403, error: 'Only Business Owners or Administrators can delete work items.' };
  }
  return { allowed: true, scope, ticket };
}
