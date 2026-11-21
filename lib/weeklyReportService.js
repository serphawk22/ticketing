import { db } from './db.js';
import { todayKolkataDate } from './workLedger.js';
import { toKolkata, fromKolkata, parseUtcDate, BUSINESS_HOURS_CONFIG } from './businessHours.js';
import {
  isAdminOrOwner,
  isManager,
  isTeamUser,
  getEmployeeIdForUser,
  getManagerScopedEmployeeIds,
  getManagerScopedProjectIds,
} from './rbac.js';
import { cleanTicketText } from './aiDataAggregator.js';
import { ticketKey, STATUS_META, PRIORITY_META } from './ticketMeta.js';

export const IST_TIMEZONE = 'Asia/Kolkata';
const RUN_LEASE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes lease expiry for stale jobs

/**
 * Returns the exact Saturday 18:00 IST to Saturday 18:00 IST reporting period.
 * 18:00 IST = 12:30 UTC.
 * Half-open interval: [start, end) = exactly 168 hours.
 *
 * @param {Date|string|number} referenceDate
 * @returns {{ periodType: 'weekly_sat', start: string, end: string, timezone: string, startIstLabel: string, endIstLabel: string, durationHours: number }}
 */
export function getWeeklySaturdayPeriod(referenceDate = new Date()) {
  const ref = parseUtcDate(referenceDate) || new Date();
  const kd = toKolkata(ref);

  const dayOfWeek = kd.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const hours = kd.getUTCHours();
  const minutes = kd.getUTCMinutes();

  let daysBackToEnd = 0;
  if (dayOfWeek === 6) {
    // It is Saturday in IST
    if (hours > 18 || (hours === 18 && minutes >= 0)) {
      daysBackToEnd = 0;
    } else {
      daysBackToEnd = 7;
    }
  } else {
    // Sunday (0) to Friday (5)
    daysBackToEnd = (dayOfWeek + 1) % 7;
    if (daysBackToEnd === 0) daysBackToEnd = 7;
  }

  const endKolkataMs = Date.UTC(
    kd.getUTCFullYear(),
    kd.getUTCMonth(),
    kd.getUTCDate() - daysBackToEnd,
    18,
    0,
    0,
    0
  );

  const endUtc = fromKolkata(new Date(endKolkataMs));
  const startUtc = new Date(endUtc.getTime() - 7 * 24 * 3600 * 1000);

  const formatIstLabel = (d) => {
    const k = toKolkata(d);
    const yr = k.getUTCFullYear();
    const mo = String(k.getUTCMonth() + 1).padStart(2, '0');
    const da = String(k.getUTCDate()).padStart(2, '0');
    return `${yr}-${mo}-${da} 18:00 IST`;
  };

  return {
    periodType: 'weekly_sat',
    start: startUtc.toISOString(),
    end: endUtc.toISOString(),
    timezone: IST_TIMEZONE,
    startIstLabel: formatIstLabel(startUtc),
    endIstLabel: formatIstLabel(endUtc),
    durationHours: 168,
  };
}

/**
 * Returns the human-readable label and ISO timestamp for the upcoming Saturday 18:00 IST cycle.
 * Automatically shifts forward once the current Saturday 18:00 IST trigger passes.
 *
 * @param {Date|string|number} referenceDate
 * @returns {{ nextSaturdayLabel: string, nextSaturdayUtc: string }}
 */
export function getNextSaturdayExecution(referenceDate = new Date()) {
  const ref = parseUtcDate(referenceDate) || new Date();
  const kd = toKolkata(ref);
  const day = kd.getUTCDay();
  const hrs = kd.getUTCHours();

  let daysUntil = 0;
  if (day === 6) {
    if (hrs < 18) {
      daysUntil = 0; // Scheduled for later today at 18:00 IST
    } else {
      daysUntil = 7; // Current Saturday execution passed, next is in 7 days
    }
  } else {
    daysUntil = (6 - day + 7) % 7;
  }

  const nextSatMs = Date.UTC(
    kd.getUTCFullYear(),
    kd.getUTCMonth(),
    kd.getUTCDate() + daysUntil,
    18,
    0,
    0,
    0
  );
  const nextSatUtc = fromKolkata(new Date(nextSatMs));
  const k = toKolkata(nextSatUtc);
  const yr = k.getUTCFullYear();
  const mo = String(k.getUTCMonth() + 1).padStart(2, '0');
  const da = String(k.getUTCDate()).padStart(2, '0');

  return {
    nextSaturdayLabel: `${yr}-${mo}-${da} 18:00 IST`,
    nextSaturdayUtc: nextSatUtc.toISOString(),
  };
}

/**
 * Computes reporting period parameters for manual and scheduled generation.
 * All boundaries use strict half-open intervals [start, end).
 *
 * @param {'weekly_sat'|'last_7_days'|'current_month'|'custom'} periodType
 * @param {{ customStartDate?: string, customEndDate?: string, referenceDate?: Date }} options
 */
export function computeReportingPeriod(periodType = 'weekly_sat', { customStartDate, customEndDate, referenceDate = new Date() } = {}) {
  const ref = parseUtcDate(referenceDate) || new Date();

  if (periodType === 'weekly_sat') {
    return getWeeklySaturdayPeriod(ref);
  }

  if (periodType === 'last_7_days') {
    // 168 hours rolling window ending at referenceDate
    const endUtc = ref;
    const startUtc = new Date(endUtc.getTime() - 7 * 24 * 3600 * 1000);
    return {
      periodType: 'last_7_days',
      start: startUtc.toISOString(),
      end: endUtc.toISOString(),
      timezone: IST_TIMEZONE,
      startIstLabel: `${startUtc.toISOString().slice(0, 10)} (Rolling 7 Days)`,
      endIstLabel: `${endUtc.toISOString().slice(0, 10)}`,
      durationHours: 168,
    };
  }

  if (periodType === 'current_month') {
    const kd = toKolkata(ref);
    const monthStartKolkataMs = Date.UTC(kd.getUTCFullYear(), kd.getUTCMonth(), 1, 0, 0, 0, 0);
    const startUtc = fromKolkata(new Date(monthStartKolkataMs));
    const endUtc = ref;
    const diffHours = Math.round((endUtc.getTime() - startUtc.getTime()) / (3600 * 1000));
    return {
      periodType: 'current_month',
      start: startUtc.toISOString(),
      end: endUtc.toISOString(),
      timezone: IST_TIMEZONE,
      startIstLabel: `${startUtc.toISOString().slice(0, 7)}-01 00:00 IST`,
      endIstLabel: `${endUtc.toISOString().slice(0, 10)} (Current)`,
      durationHours: diffHours,
    };
  }

  if (periodType === 'custom') {
    if (!customStartDate || !customEndDate) {
      throw new Error('Custom date range requires both customStartDate and customEndDate (YYYY-MM-DD).');
    }
    const [sYr, sMo, sDa] = customStartDate.split('-').map(Number);
    const [eYr, eMo, eDa] = customEndDate.split('-').map(Number);
    if (!sYr || !sMo || !sDa || !eYr || !eMo || !eDa) {
      throw new Error('Invalid custom date format. Use YYYY-MM-DD.');
    }

    // Start at 00:00:00 IST on customStartDate
    const startKolkataMs = Date.UTC(sYr, sMo - 1, sDa, 0, 0, 0, 0);
    const startUtc = fromKolkata(new Date(startKolkataMs));

    // End at 00:00:00 IST on (customEndDate + 1 day) to inclusively cover customEndDate in half-open [start, end)
    const endKolkataMs = Date.UTC(eYr, eMo - 1, eDa + 1, 0, 0, 0, 0);
    const endUtc = fromKolkata(new Date(endKolkataMs));

    if (endUtc.getTime() <= startUtc.getTime()) {
      throw new Error('Custom end date must be on or after start date.');
    }

    const diffHours = Math.round((endUtc.getTime() - startUtc.getTime()) / (3600 * 1000));
    return {
      periodType: 'custom',
      start: startUtc.toISOString(),
      end: endUtc.toISOString(),
      timezone: IST_TIMEZONE,
      startIstLabel: `${customStartDate} 00:00 IST`,
      endIstLabel: `${customEndDate} 23:59:59 IST`,
      durationHours: diffHours,
    };
  }

  throw new Error(`Unsupported periodType: ${periodType}`);
}

/**
 * Resolves project and employee authorization scopes for report generation.
 * Strictly respects RBAC roles: Owner/Admin, Manager (scoped), Employee (self-only).
 */
export async function resolveReportScope(user, { projectScope = 'all', selectedProjectIds = [] } = {}) {
  if (!user) {
    throw new Error('Unauthorized: User session is required for report generation.');
  }

  const isFullAdmin = isAdminOrOwner(user);
  let allowedProjectIds = null; // null represents all projects
  let allowedEmployeeIds = null;

  if (isFullAdmin) {
    // Admins and Owners can request all, active, or any selected project
    if (projectScope === 'selected' && Array.isArray(selectedProjectIds) && selectedProjectIds.length > 0) {
      allowedProjectIds = new Set(selectedProjectIds.map(Number).filter((n) => Number.isInteger(n) && n > 0));
    }
  } else if (isManager(user)) {
    // Managers are strictly scoped to their authorized projects and reportees
    const mgrEmpId = await getEmployeeIdForUser(user);
    if (!mgrEmpId) {
      throw new Error('Forbidden: Manager employee profile could not be resolved.');
    }
    const scopedProjects = await getManagerScopedProjectIds(mgrEmpId);
    const scopedEmployees = await getManagerScopedEmployeeIds(mgrEmpId, { includeSelf: true });

    if (projectScope === 'selected' && Array.isArray(selectedProjectIds) && selectedProjectIds.length > 0) {
      const filtered = selectedProjectIds
        .map(Number)
        .filter((id) => Number.isInteger(id) && scopedProjects.has(id));
      allowedProjectIds = new Set(filtered);
    } else {
      allowedProjectIds = scopedProjects;
    }
    allowedEmployeeIds = scopedEmployees;
  } else {
    // Non-management employees cannot request company-wide or multi-project reports
    throw new Error('Forbidden: Only Owners, Administrators, and Managers can generate reports.');
  }

  const effectiveScope = isFullAdmin ? projectScope : 'selected';

  return {
    isFullAdmin,
    allowedProjectIds,
    allowedEmployeeIds,
    effectiveScope,
  };
}

/**
 * Collects and aggregates comprehensive company-wide and employee-scoped reporting data.
 * All DB operations are strictly read-only against existing business records.
 *
 * @param {{
 *   user: object,
 *   periodType?: 'weekly_sat'|'last_7_days'|'current_month'|'custom',
 *   customStartDate?: string,
 *   customEndDate?: string,
 *   projectScope?: 'all'|'active'|'selected',
 *   selectedProjectIds?: number[],
 *   referenceDate?: Date
 * }} options
 */
export async function collectWeeklyReportData({
  user,
  period: explicitPeriod,
  periodType = 'weekly_sat',
  customStartDate,
  customEndDate,
  projectScope = 'all',
  selectedProjectIds = [],
  referenceDate = new Date(),
}) {
  // 1. Resolve period boundaries [periodStart, periodEnd)
  const period = explicitPeriod || computeReportingPeriod(periodType, {
    customStartDate,
    customEndDate,
    referenceDate,
  });

  // 2. Resolve RBAC scope
  const scope = await resolveReportScope(user, {
    projectScope,
    selectedProjectIds,
  });

  const todayIso = todayKolkataDate();

  // 3. Fetch Projects
  let projectsSql = `
    SELECT p.id, p.key, p.name, p.description, p.color, p.workspace_id, p.client_id, p.target_end_date,
           u.name AS client_name,
           (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id AND COALESCE(t.archived, 0) = 0) AS active_ticket_count,
           (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id AND t.status IN ('open', 'in_progress') AND COALESCE(t.archived, 0) = 0) AS open_ticket_count
    FROM projects p
    LEFT JOIN users u ON u.id = p.client_id
  `;
  const allProjects = await db.prepare(projectsSql).all();

  const eligibleProjects = allProjects.filter((p) => {
    if (scope.allowedProjectIds !== null && !scope.allowedProjectIds.has(Number(p.id))) {
      return false;
    }
    if (projectScope === 'active') {
      // Active projects have open tickets or active ticket count > 0
      return Number(p.open_ticket_count) > 0 || Number(p.active_ticket_count) > 0;
    }
    return true;
  });

  const eligibleProjectIds = new Set(eligibleProjects.map((p) => Number(p.id)));

  // 4. Fetch Employees (including zero-assignment and inactive employees)
  let employeesSql = `
    SELECT e.id, e.name, e.email, e.secondary_email, e.role, e.department, e.title, e.active, e.user_id,
           u.email AS user_email
    FROM employees e
    LEFT JOIN users u ON u.id = e.user_id
    ORDER BY e.name COLLATE NOCASE
  `;
  const allEmployees = await db.prepare(employeesSql).all();

  const eligibleEmployees = allEmployees.filter((emp) => {
    if (scope.allowedEmployeeIds !== null && !scope.allowedEmployeeIds.has(Number(emp.id))) {
      return false;
    }
    return true;
  });

  const employeeMapById = new Map();
  for (const emp of allEmployees) {
    employeeMapById.set(Number(emp.id), emp);
  }

  // 5. Fetch Tickets (All tickets matching project scope)
  let ticketSql = `
    SELECT t.id, t.title, t.description, t.status, t.priority, t.type, t.category, t.resolution,
           t.due_date, t.initial_due_date, t.start_date, t.created_at, t.updated_at,
           t.project_id, t.employee_id, t.assigned_to, t.labels, t.archived, t.archived_at,
           p.key AS project_key, p.name AS project_name,
           e.name AS employee_name, e.department AS employee_department, e.title AS employee_title,
           u_assigned.name AS assigned_user_name,
           u_creator.name AS creator_name
    FROM tickets t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN employees e ON e.id = t.employee_id
    LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
    LEFT JOIN users u_creator ON u_creator.id = t.created_by
    WHERE 1=1
  `;
  const ticketRows = await db.prepare(ticketSql).all();

  // Filter tickets by eligible project scope
  const inScopeTickets = ticketRows.filter((t) => {
    if (t.project_id && !eligibleProjectIds.has(Number(t.project_id))) {
      return false;
    }
    return true;
  });

  const ticketMapById = new Map();
  for (const t of inScopeTickets) {
    ticketMapById.set(Number(t.id), t);
  }

  // 6. Fetch Ticket Relations (Dependencies & Blockers)
  const relationSql = `
    SELECT r.ticket_id, r.related_ticket_id, r.relation_type, r.created_at,
           t1.title AS ticket_title, t1.status AS ticket_status, t1.project_id AS t1_proj,
           t2.title AS related_title, t2.status AS related_status, t2.project_id AS t2_proj,
           p1.key AS p1_key, p2.key AS p2_key
    FROM ticket_relations r
    JOIN tickets t1 ON t1.id = r.ticket_id
    JOIN tickets t2 ON t2.id = r.related_ticket_id
    LEFT JOIN projects p1 ON p1.id = t1.project_id
    LEFT JOIN projects p2 ON p2.id = t2.project_id
    WHERE COALESCE(t1.archived, 0) = 0 AND COALESCE(t2.archived, 0) = 0
  `;
  let relationRows = [];
  try {
    relationRows = await db.prepare(relationSql).all();
  } catch (err) {
    console.warn('Warning: Could not fetch ticket relations:', err.message);
  }

  // Classify blockers
  const isOpenStatus = (s) => s === 'open' || s === 'in_progress';
  const activeBlockersByTicketId = new Map();
  for (const rel of relationRows) {
    if (rel.relation_type === 'blocks') {
      // rel.ticket_id blocks rel.related_ticket_id
      if (isOpenStatus(rel.ticket_status) && isOpenStatus(rel.related_status)) {
        if (!activeBlockersByTicketId.has(rel.related_ticket_id)) {
          activeBlockersByTicketId.set(rel.related_ticket_id, []);
        }
        activeBlockersByTicketId.get(rel.related_ticket_id).push({
          sourceTicketId: rel.ticket_id,
          sourceKey: `[${rel.p1_key || 'TM'}-${rel.ticket_id}]`,
          sourceTitle: rel.ticket_title,
          relationType: 'blocked_by',
          classification: 'Confirmed Active',
          reason: `Blocked by active dependency [${rel.p1_key || 'TM'}-${rel.ticket_id}] "${cleanTicketText(rel.ticket_title, 80)}"`,
        });
      }
    } else if (rel.relation_type === 'blocked_by' || rel.relation_type === 'is blocked by') {
      // rel.ticket_id is blocked by rel.related_ticket_id
      if (isOpenStatus(rel.ticket_status) && isOpenStatus(rel.related_status)) {
        if (!activeBlockersByTicketId.has(rel.ticket_id)) {
          activeBlockersByTicketId.set(rel.ticket_id, []);
        }
        activeBlockersByTicketId.get(rel.ticket_id).push({
          sourceTicketId: rel.related_ticket_id,
          sourceKey: `[${rel.p2_key || 'TM'}-${rel.related_ticket_id}]`,
          sourceTitle: rel.related_title,
          relationType: 'blocked_by',
          classification: 'Confirmed Active',
          reason: `Blocked by active dependency [${rel.p2_key || 'TM'}-${rel.related_ticket_id}] "${cleanTicketText(rel.related_title, 80)}"`,
        });
      }
    }
  }

  // 7. Fetch Activity History within reporting window [period.start, period.end)
  // Normalizes naive SQLite strings and ISO strings cleanly
  const activitySql = `
    SELECT a.id, a.ticket_id, a.actor_id, a.field, a.from_value, a.to_value, a.blocker, a.reason,
           a.employee_id, a.created_at,
           u.name AS actor_name, u.email AS actor_email,
           e.name AS employee_name
    FROM ticket_activity a
    LEFT JOIN users u ON u.id = a.actor_id
    LEFT JOIN employees e ON (e.id = a.employee_id OR (a.employee_id IS NULL AND (e.user_id = u.id OR LOWER(e.email) = LOWER(u.email))))
    WHERE a.created_at >= ? AND a.created_at < ?
    ORDER BY a.created_at ASC
  `;
  let activityRows = [];
  try {
    activityRows = await db.prepare(activitySql).all(period.start, period.end);
  } catch (err) {
    console.warn('Warning: Could not fetch ticket activity:', err.message);
  }

  // Filter activity to in-scope tickets
  const inScopeActivity = activityRows.filter((act) => ticketMapById.has(Number(act.ticket_id)));

  // Weekly activity metrics
  const weeklyCreatedTicketIds = new Set();
  const weeklyCompletedTicketIds = new Set();
  const weeklyReopenedTicketIds = new Set();
  const weeklyUpdatedTicketIds = new Set();
  const weeklyReassignedTicketIds = new Set();
  const weeklyBlockerActivity = [];
  const weeklyCompletionsByEmployee = new Map(); // employeeId -> count

  for (const act of inScopeActivity) {
    const tId = Number(act.ticket_id);
    weeklyUpdatedTicketIds.add(tId);

    if (act.field === 'created') {
      weeklyCreatedTicketIds.add(tId);
    } else if (act.field === 'status') {
      const fromClosed = act.from_value === 'resolved' || act.from_value === 'closed';
      const toClosed = act.to_value === 'resolved' || act.to_value === 'closed';

      if (!fromClosed && toClosed) {
        // Ticket completed during the week
        weeklyCompletedTicketIds.add(tId);

        // Completion Attribution
        let creditedEmpId = act.employee_id ? Number(act.employee_id) : null;
        if (!creditedEmpId && act.actor_id) {
          const matched = allEmployees.find(
            (e) => Number(e.user_id) === Number(act.actor_id) || (e.email && act.actor_email && e.email.toLowerCase() === act.actor_email.toLowerCase())
          );
          if (matched) creditedEmpId = Number(matched.id);
        }

        if (creditedEmpId) {
          weeklyCompletionsByEmployee.set(
            creditedEmpId,
            (weeklyCompletionsByEmployee.get(creditedEmpId) || 0) + 1
          );
        }
      } else if (fromClosed && !toClosed) {
        // Ticket reopened during the week
        weeklyReopenedTicketIds.add(tId);
      }
    } else if (act.field === 'assigned_to' || act.field === 'employee_id') {
      weeklyReassignedTicketIds.add(tId);
    }

    if (act.blocker) {
      weeklyBlockerActivity.push({
        ticketId: tId,
        date: act.created_at,
        actor: act.actor_name || 'Team Member',
        blocker: act.blocker,
        reason: act.reason,
        classification: 'Confirmed Active',
      });
    }
  }

  // Fallback creation detection: tickets created_at within window even if no 'created' activity row
  for (const t of inScopeTickets) {
    if (t.created_at >= period.start && t.created_at < period.end) {
      weeklyCreatedTicketIds.add(Number(t.id));
    }
  }

  // 8. Build Complete Ticket Register & Cumulative Metrics
  let totalCumulativeTickets = 0;
  let totalOpenTickets = 0;
  let totalClosedTickets = 0;
  const statusCounts = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
  const priorityCounts = { urgent: 0, high: 0, medium: 0, low: 0 };
  const overdueTickets = [];
  const blockedTickets = [];
  const completeTicketRegister = [];

  for (const t of inScopeTickets) {
    const isArchived = Boolean(Number(t.archived));
    if (isArchived) continue; // Unarchived active register

    totalCumulativeTickets += 1;
    const status = t.status || 'open';
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const isClosed = status === 'resolved' || status === 'closed';
    if (isClosed) {
      totalClosedTickets += 1;
    } else {
      totalOpenTickets += 1;
    }

    const priority = t.priority || 'medium';
    priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;

    const key = `[${t.project_key || 'TM'}-${t.id}]`;
    const isOverdue = t.due_date && t.due_date < todayIso && !isClosed;
    let daysOverdue = 0;
    if (isOverdue) {
      const dueMs = new Date(t.due_date).getTime();
      const todayMs = new Date(todayIso).getTime();
      daysOverdue = Math.max(1, Math.round((todayMs - dueMs) / (24 * 3600 * 1000)));
    }

    const hasBlockers = activeBlockersByTicketId.get(t.id) || [];
    const isBlocked = hasBlockers.length > 0;

    let blockerClassification = 'None';
    let blockerReason = '';
    if (isBlocked) {
      blockerClassification = hasBlockers[0].classification;
      blockerReason = hasBlockers.map((b) => b.reason).join('; ');
    }

    const item = {
      id: Number(t.id),
      key,
      title: t.title,
      project: t.project_name || 'General',
      projectId: t.project_id ? Number(t.project_id) : null,
      assignee: t.employee_name || t.assigned_user_name || 'Unassigned',
      employeeId: t.employee_id ? Number(t.employee_id) : null,
      creator: t.creator_name || 'System',
      status: STATUS_META[status]?.label || status,
      rawStatus: status,
      priority: PRIORITY_META[priority]?.label || priority,
      rawPriority: priority,
      type: t.type || 'task',
      category: t.category || 'General',
      createdDate: (t.created_at || '').slice(0, 10),
      dueDate: t.due_date || '',
      initialDueDate: t.initial_due_date || t.due_date || '',
      completedDate: isClosed ? (t.updated_at || '').slice(0, 10) : '',
      lastUpdated: (t.updated_at || '').slice(0, 10),
      isOverdue,
      daysOverdue,
      isBlocked,
      blockerClassification,
      blockerReason,
      recommendedAction: isBlocked
        ? 'Escalate dependency blocker'
        : isOverdue
          ? 'Review schedule with assignee'
          : 'Proceed with planned milestones',
    };

    completeTicketRegister.push(item);

    if (isOverdue || isBlocked) {
      if (isOverdue) overdueTickets.push(item);
      if (isBlocked) blockedTickets.push(item);
    }
  }

  const completionPercentage = totalCumulativeTickets > 0
    ? Math.round((totalClosedTickets / totalCumulativeTickets) * 100)
    : 0;

  // 9. Build Project Summary Breakdown
  const projectSummary = eligibleProjects.map((p) => {
    const pId = Number(p.id);
    const pTickets = completeTicketRegister.filter((t) => t.projectId === pId);
    const pTotal = pTickets.length;
    const pOpen = pTickets.filter((t) => t.rawStatus === 'open' || t.rawStatus === 'in_progress').length;
    const pClosed = pTickets.filter((t) => t.rawStatus === 'resolved' || t.rawStatus === 'closed').length;
    const pOverdue = pTickets.filter((t) => t.isOverdue).length;
    const pBlocked = pTickets.filter((t) => t.isBlocked).length;
    const pWeeklyCreated = Array.from(weeklyCreatedTicketIds).filter((id) => {
      const t = ticketMapById.get(id);
      return t && Number(t.project_id) === pId;
    }).length;
    const pWeeklyCompleted = Array.from(weeklyCompletedTicketIds).filter((id) => {
      const t = ticketMapById.get(id);
      return t && Number(t.project_id) === pId;
    }).length;
    const pCompletionRate = pTotal > 0 ? Math.round((pClosed / pTotal) * 100) : 0;

    return {
      id: pId,
      key: p.key,
      name: p.name,
      status: pOpen > 0 ? 'Active' : pTotal > 0 ? 'Completed' : 'Planned',
      totalTickets: pTotal,
      openTickets: pOpen,
      closedTickets: pClosed,
      overdueTickets: pOverdue,
      blockedTickets: pBlocked,
      weeklyCreated: pWeeklyCreated,
      weeklyCompleted: pWeeklyCompleted,
      completionPercentage: pCompletionRate,
      targetEndDate: p.target_end_date || 'None',
    };
  });

  // 10. Build Employee Summary Breakdown (Includes zero-assignment employees)
  const employeeSummary = eligibleEmployees.map((emp) => {
    const eId = Number(emp.id);
    const eTickets = completeTicketRegister.filter((t) => t.employeeId === eId);
    const eTotal = eTickets.length;
    const eOpen = eTickets.filter((t) => t.rawStatus === 'open' || t.rawStatus === 'in_progress').length;
    const eClosed = eTickets.filter((t) => t.rawStatus === 'resolved' || t.rawStatus === 'closed').length;
    const eOverdue = eTickets.filter((t) => t.isOverdue).length;
    const eBlocked = eTickets.filter((t) => t.isBlocked).length;
    const eWeeklyCompleted = weeklyCompletionsByEmployee.get(eId) || 0;

    return {
      id: eId,
      name: emp.name,
      email: emp.email || emp.user_email || '',
      department: emp.department || 'Engineering',
      title: emp.title || emp.role || 'Team Member',
      isActive: Boolean(Number(emp.active)),
      totalAssigned: eTotal,
      openTickets: eOpen,
      closedTickets: eClosed,
      overdueTickets: eOverdue,
      blockedTickets: eBlocked,
      weeklyCompleted: eWeeklyCompleted,
      workloadStatus: eTotal === 0 ? 'Available / Zero Assignment' : eOpen > 5 ? 'High Workload' : 'Normal',
    };
  });

  // 11. Compile Individual Scoped Employee Reports
  const employeeReports = new Map();
  for (const emp of eligibleEmployees) {
    const eId = Number(emp.id);
    const myTickets = completeTicketRegister.filter((t) => t.employeeId === eId);
    const myActive = myTickets.filter((t) => t.rawStatus === 'open' || t.rawStatus === 'in_progress');
    const myCompleted = myTickets.filter((t) => t.rawStatus === 'resolved' || t.rawStatus === 'closed');
    const myOverdue = myTickets.filter((t) => t.isOverdue);
    const myBlocked = myTickets.filter((t) => t.isBlocked);
    const myWeeklyCompleted = weeklyCompletionsByEmployee.get(eId) || 0;

    const myActivity = inScopeActivity.filter((act) => {
      const credited = act.employee_id ? Number(act.employee_id) === eId : false;
      const isAssigned = ticketMapById.get(Number(act.ticket_id))?.employee_id === eId;
      return credited || isAssigned;
    }).map((act) => {
      const t = ticketMapById.get(Number(act.ticket_id));
      return {
        timestamp: act.created_at,
        ticketKey: t ? `[${t.project_key || 'TM'}-${t.id}]` : `[#${act.ticket_id}]`,
        ticketTitle: t ? t.title : 'Ticket',
        field: act.field,
        fromValue: act.from_value,
        toValue: act.to_value,
        blocker: act.blocker,
      };
    });

    employeeReports.set(eId, {
      employee: {
        id: eId,
        name: emp.name,
        email: emp.email || emp.user_email || '',
        title: emp.title || emp.role || 'Team Member',
        department: emp.department || 'Engineering',
      },
      kpis: {
        totalAssigned: myTickets.length,
        openCount: myActive.length,
        completedCount: myCompleted.length,
        overdueCount: myOverdue.length,
        blockedCount: myBlocked.length,
        weeklyCompleted: myWeeklyCompleted,
      },
      activeTickets: myActive,
      completedTickets: myCompleted,
      overdueTickets: myOverdue,
      blockedTickets: myBlocked,
      recentActivity: myActivity,
    });
  }

  // 12. Compile Executive Summary & Return Aggregated Package
  const executiveSummary = {
    period,
    companyKPIs: {
      totalCumulativeTickets,
      totalOpenTickets,
      totalClosedTickets,
      completionPercentage,
      totalOverdueTickets: overdueTickets.length,
      totalBlockedTickets: blockedTickets.length,
      totalProjects: eligibleProjects.length,
      totalEmployees: eligibleEmployees.length,
      statusCounts,
      priorityCounts,
    },
    weeklyActivityKPIs: {
      weeklyCreatedCount: weeklyCreatedTicketIds.size,
      weeklyCompletedCount: weeklyCompletedTicketIds.size,
      weeklyReopenedCount: weeklyReopenedTicketIds.size,
      weeklyUpdatedCount: weeklyUpdatedTicketIds.size,
      weeklyReassignedCount: weeklyReassignedTicketIds.size,
    },
  };

  return {
    period,
    executiveSummary,
    projectSummary,
    employeeSummary,
    completeTicketRegister,
    blockersAndOverdue: Array.from(new Set([...overdueTickets, ...blockedTickets])),
    weeklyActivity: inScopeActivity.map((act) => {
      const t = ticketMapById.get(Number(act.ticket_id));
      return {
        id: act.id,
        timestamp: act.created_at,
        ticketId: act.ticket_id,
        ticketKey: t ? `[${t.project_key || 'TM'}-${t.id}]` : `[#${act.ticket_id}]`,
        ticketTitle: t ? t.title : '',
        project: t ? (t.project_name || 'General') : '',
        actor: act.actor_name || 'Team Member',
        field: act.field,
        fromValue: act.from_value,
        toValue: act.to_value,
        blocker: act.blocker,
        reason: act.reason,
      };
    }),
    employeeReports,
  };
}

/**
 * Acquires a non-overlapping execution lock for report generation.
 * Handles lease timeout recovery for stale jobs (> 20 mins old).
 */
export async function acquireRunLock({
  runToken,
  reportType,
  periodType,
  periodStart,
  periodEnd,
  projectScope = 'all',
  selectedProjectIds = [],
  requestedBy = null,
}) {
  const existing = await db
    .prepare('SELECT * FROM weekly_report_runs WHERE run_token = ?')
    .get(runToken);

  if (existing) {
    if (existing.status === 'completed') {
      return { acquired: false, run: existing, reason: 'completed' };
    }

    if (existing.status === 'running') {
      const parsedUpdated = parseUtcDate(existing.updated_at || existing.created_at);
      const updatedMs = parsedUpdated ? parsedUpdated.getTime() : 0;
      const nowMs = Date.now();
      const isStale = nowMs - updatedMs > RUN_LEASE_TIMEOUT_MS;

      if (!isStale) {
        return { acquired: false, run: existing, reason: 'in_progress' };
      }

      // Recover stale job
      console.warn(`[weeklyReportService] Recovering stale run ${existing.id} (token=${runToken})`);
      await db
        .prepare(
          `UPDATE weekly_report_runs
           SET status = 'running',
               error_message = 'Job timed out previously; recovered by scheduler',
               updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(existing.id);

      const recovered = await db
        .prepare('SELECT * FROM weekly_report_runs WHERE id = ?')
        .get(existing.id);
      return { acquired: true, run: recovered, reason: 'recovered' };
    }
  }

  // Insert fresh run row
  const selectedJson = JSON.stringify(selectedProjectIds || []);
  const res = await db
    .prepare(
      `INSERT INTO weekly_report_runs
        (run_token, report_type, period_type, period_start, period_end, timezone, project_scope, selected_project_ids, requested_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')`
    )
    .run(
      runToken,
      reportType,
      periodType,
      periodStart,
      periodEnd,
      IST_TIMEZONE,
      projectScope,
      selectedJson,
      requestedBy || null
    );

  const run = await db
    .prepare('SELECT * FROM weekly_report_runs WHERE id = ?')
    .get(res.lastInsertRowid);

  return { acquired: true, run, reason: 'created' };
}

/**
 * Updates atomic report execution status and metadata.
 */
export async function updateRunStatus(runId, {
  status,
  aiStatus,
  excelStatus,
  managementEmailStatus,
  employeeEmailStatus,
  summaryMetricsJson,
  aiInsightsJson,
  errorMessage,
  completed = false,
}) {
  const sets = ["updated_at = datetime('now')"];
  const params = [];

  if (status !== undefined) {
    sets.push('status = ?');
    params.push(status);
  }
  if (aiStatus !== undefined) {
    sets.push('ai_status = ?');
    params.push(aiStatus);
  }
  if (excelStatus !== undefined) {
    sets.push('excel_status = ?');
    params.push(excelStatus);
  }
  if (managementEmailStatus !== undefined) {
    sets.push('management_email_status = ?');
    params.push(managementEmailStatus);
  }
  if (employeeEmailStatus !== undefined) {
    sets.push('employee_email_status = ?');
    params.push(employeeEmailStatus);
  }
  if (summaryMetricsJson !== undefined) {
    sets.push('summary_metrics_json = ?');
    params.push(typeof summaryMetricsJson === 'string' ? summaryMetricsJson : JSON.stringify(summaryMetricsJson));
  }
  if (aiInsightsJson !== undefined) {
    sets.push('ai_insights_json = ?');
    params.push(typeof aiInsightsJson === 'string' ? aiInsightsJson : JSON.stringify(aiInsightsJson));
  }
  if (errorMessage !== undefined) {
    sets.push('error_message = ?');
    params.push(errorMessage);
  }
  if (completed) {
    sets.push("completed_at = datetime('now')");
  }

  params.push(runId);
  const sql = `UPDATE weekly_report_runs SET ${sets.join(', ')} WHERE id = ?`;
  await db.prepare(sql).run(...params);

  return db.prepare('SELECT * FROM weekly_report_runs WHERE id = ?').get(runId);
}

/**
 * Saves generated file metadata idempotently.
 */
export async function recordReportFile({
  runId,
  fileType,
  employeeId = null,
  employeeNameSnapshot = '',
  filename,
  storageKey,
  contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  fileSizeBytes = 0,
  status = 'generated',
  errorMessage = null,
}) {
  const info = await db
    .prepare(
      `INSERT INTO weekly_report_files
        (run_id, file_type, employee_id, employee_name_snapshot, filename, storage_key, content_type, file_size_bytes, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      runId,
      fileType,
      employeeId || null,
      employeeNameSnapshot || '',
      filename,
      storageKey,
      contentType,
      fileSizeBytes,
      status,
      errorMessage || null
    );

  return db.prepare('SELECT * FROM weekly_report_files WHERE id = ?').get(info.lastInsertRowid);
}

/**
 * Retrieves report run with files and delivery stats.
 */
export async function getReportRun(runId) {
  const run = await db.prepare('SELECT * FROM weekly_report_runs WHERE id = ?').get(runId);
  if (!run) return null;

  const files = await db
    .prepare('SELECT * FROM weekly_report_files WHERE run_id = ? ORDER BY id ASC')
    .all(runId);

  const deliveries = await db
    .prepare('SELECT * FROM weekly_report_deliveries WHERE run_id = ? ORDER BY id ASC')
    .all(runId);

  return {
    ...run,
    files,
    deliveries,
  };
}

/**
 * Lists report history with pagination.
 */
export async function listReportRuns({ limit = 20, offset = 0 } = {}) {
  const rows = await db
    .prepare(
      `SELECT r.*,
              u.name AS requested_by_name,
              (SELECT COUNT(*) FROM weekly_report_files f WHERE f.run_id = r.id) AS file_count,
              (SELECT COUNT(*) FROM weekly_report_deliveries d WHERE d.run_id = r.id) AS delivery_count,
              (SELECT COUNT(*) FROM weekly_report_deliveries d WHERE d.run_id = r.id AND d.delivery_status = 'accepted') AS delivery_accepted_count,
              (SELECT COUNT(*) FROM weekly_report_deliveries d WHERE d.run_id = r.id AND d.delivery_status = 'failed') AS delivery_failed_count
       FROM weekly_report_runs r
       LEFT JOIN users u ON u.id = r.requested_by
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(Number(limit) || 20, Number(offset) || 0);

  const totalRow = await db.prepare('SELECT COUNT(*) AS total FROM weekly_report_runs').get();

  return {
    runs: rows,
    total: totalRow?.total || 0,
    limit: Number(limit) || 20,
    offset: Number(offset) || 0,
  };
}
