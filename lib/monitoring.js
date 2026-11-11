import { db } from './db.js';
import { toKolkata, calculateDurationsBetween } from './businessHours.js';
import { loadScheduleContext } from './businessScheduleService.js';
import { resolveDateRange } from './dateFilters.js';
import { assertCanViewEmployee, assertCanViewProject, isAdminOrOwner, resolveUserScope } from './rbac.js';
import { getAttendanceReconciliation } from './reconciliation.js';
import { todayKolkataDate } from './workLedger.js';
import { toSafeEmployee } from './employees.js';

function num(v) {
  return Number(v || 0);
}

/**
 * Resolves explicit date boundaries `[fromDate, toDate]` (`YYYY-MM-DD`) in IST (`Asia/Kolkata`)
 * either from explicit params or preset (`this_week`, `this_month`, `last_30_days`, etc.).
 */
export function resolveMonitoringWindow({ from = null, to = null, preset = 'this_month' } = {}) {
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return {
      fromDate: from,
      toDate: to,
      startUtc: `${from} 00:00:00`,
      endUtc: `${to} 23:59:59`,
      preset: 'custom',
    };
  }
  const range = resolveDateRange(preset || 'this_month', from, to);
  if (range) {
    const startKd = toKolkata(range.startDate);
    const endKd = toKolkata(range.endDate);
    return {
      fromDate: startKd.toISOString().slice(0, 10),
      toDate: endKd.toISOString().slice(0, 10),
      startUtc: range.start,
      endUtc: range.end,
      preset: preset || 'this_month',
    };
  }
  const today = todayKolkataDate();
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 29);
  const defaultFrom = d.toISOString().slice(0, 10);
  return {
    fromDate: defaultFrom,
    toDate: today,
    startUtc: `${defaultFrom} 00:00:00`,
    endUtc: `${today} 23:59:59`,
    preset: 'last_30_days',
  };
}

/**
 * Loads effective stage visits for a set of ticket IDs (coalescing latest `ticket_stage_corrections`
 * over raw immutable `ticket_stage_history`, and computing live in-progress elapsed time for active stages).
 */
export async function getEffectiveStagesForTickets(ticketIds = []) {
  const cleanIds = [...new Set(ticketIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (cleanIds.length === 0) return [];

  const ph = cleanIds.map(() => '?').join(', ');
  const [histories, corrections, scheduleCtx] = await Promise.all([
    db
      .prepare(
        `SELECT tsh.*, ws.label AS stage_label
         FROM ticket_stage_history tsh
         LEFT JOIN workflow_stages ws ON ws.code = tsh.to_status
         WHERE tsh.ticket_id IN (${ph})
         ORDER BY tsh.ticket_id ASC, tsh.transition_seq ASC`
      )
      .all(...cleanIds),
    db
      .prepare(
        `SELECT *
         FROM ticket_stage_corrections
         WHERE ticket_id IN (${ph})
         ORDER BY stage_history_id ASC, correction_seq DESC`
      )
      .all(...cleanIds),
    loadScheduleContext(),
  ]);

  const latestCorrByHistory = new Map();
  for (const c of corrections) {
    const hid = Number(c.stage_history_id);
    if (!latestCorrByHistory.has(hid)) {
      latestCorrByHistory.set(hid, c);
    }
  }

  const now = new Date();
  return histories.map((h) => {
    const corr = latestCorrByHistory.get(Number(h.id)) || null;
    const status = corr ? corr.corrected_to_status : h.to_status;
    const entryAt = corr ? corr.corrected_entry_at : h.entry_at;
    const exitAt = corr ? corr.corrected_exit_at : h.exit_at;

    let calSec = corr ? corr.recalculated_calendar_seconds : h.calendar_seconds;
    let busSec = corr ? corr.recalculated_business_seconds : h.business_seconds;
    let precision = corr ? corr.duration_precision : h.duration_precision;

    if (exitAt == null || calSec == null || busSec == null) {
      const dur = calculateDurationsBetween(entryAt, exitAt || now, scheduleCtx);
      calSec = dur.calendarSeconds;
      busSec = dur.businessSeconds;
      precision = dur.durationPrecision;
    }

    return {
      historyId: Number(h.id),
      ticketId: Number(h.ticket_id),
      status,
      stageLabel: h.stage_label || status,
      entryAt,
      exitAt,
      isActive: exitAt == null,
      calendarSeconds: num(calSec),
      businessSeconds: num(busSec),
      durationPrecision: precision || 'verified',
      hasCorrection: Boolean(corr),
      correctionReason: corr?.reason || null,
    };
  });
}

function aggregateStagesByStageCode(effectiveStages) {
  const byStage = {};
  for (const st of effectiveStages) {
    if (!byStage[st.status]) {
      byStage[st.status] = {
        status: st.status,
        label: st.stageLabel || st.status,
        visitCount: 0,
        totalCalendarSeconds: 0,
        totalBusinessSeconds: 0,
        activeCount: 0,
        precisions: new Set(),
      };
    }
    const bucket = byStage[st.status];
    bucket.visitCount += 1;
    bucket.totalCalendarSeconds += st.calendarSeconds;
    bucket.totalBusinessSeconds += st.businessSeconds;
    if (st.isActive) bucket.activeCount += 1;
    bucket.precisions.add(st.durationPrecision);
  }

  return Object.values(byStage).map((b) => ({
    status: b.status,
    label: b.label,
    visitCount: b.visitCount,
    activeCount: b.activeCount,
    totalCalendarSeconds: b.totalCalendarSeconds,
    totalBusinessSeconds: b.totalBusinessSeconds,
    avgCalendarSeconds: b.visitCount > 0 ? Math.round(b.totalCalendarSeconds / b.visitCount) : 0,
    avgBusinessSeconds: b.visitCount > 0 ? Math.round(b.totalBusinessSeconds / b.visitCount) : 0,
    precisions: Array.from(b.precisions),
  }));
}

async function computeScopeAggregates({
  fromDate,
  toDate,
  allowedEmployeeIds = null,
  allowedProjectIds = null,
}) {
  const empFilter = Array.isArray(allowedEmployeeIds) ? [...new Set(allowedEmployeeIds.map(Number))] : null;
  const projFilter = Array.isArray(allowedProjectIds) ? [...new Set(allowedProjectIds.map(Number))] : null;

  // 1. Canonical employee_work_logs aggregation (single source of truth for effort!)
  let logWhere = 'WHERE ewl.work_date >= ? AND ewl.work_date <= ?';
  const logParams = [fromDate, toDate];

  if (empFilter) {
    if (empFilter.length === 0 && (!projFilter || projFilter.length === 0)) {
      return {
        totals: { totalLoggedMinutes: 0, ticketWorkMinutes: 0, companyActivityMinutes: 0, openTickets: 0, overdueTickets: 0, blockersCount: 0 },
        projectEffort: [],
        employeeEffort: [],
        categoryDistribution: [],
        stageBottlenecks: [],
        stuckTickets: [],
        recentBlockers: [],
      };
    }
    const parts = [];
    if (empFilter.length > 0) {
      parts.push(`ewl.employee_id IN (${empFilter.map(() => '?').join(', ')})`);
      logParams.push(...empFilter);
    }
    if (projFilter && projFilter.length > 0) {
      parts.push(`ewl.project_id IN (${projFilter.map(() => '?').join(', ')})`);
      logParams.push(...projFilter);
    }
    if (parts.length > 0) logWhere += ` AND (${parts.join(' OR ')})`;
  } else if (projFilter && projFilter.length > 0) {
    logWhere += ` AND ewl.project_id IN (${projFilter.map(() => '?').join(', ')})`;
    logParams.push(...projFilter);
  }

  const workLogs = await db
    .prepare(
      `SELECT ewl.*, e.name AS employee_name, e.department AS employee_department,
              p.name AS project_name, p.key AS project_key, p.color AS project_color,
              wc.label AS category_label, wc.counts_as_accounted
       FROM employee_work_logs ewl
       JOIN employees e ON e.id = ewl.employee_id
       LEFT JOIN projects p ON p.id = ewl.project_id
       LEFT JOIN work_categories wc ON wc.code = ewl.category_code
       ${logWhere}
       ORDER BY ewl.work_date DESC, ewl.id DESC`
    )
    .all(...logParams);

  let totalLoggedMinutes = 0;
  let ticketWorkMinutes = 0;
  let companyActivityMinutes = 0;
  const projMap = new Map();
  const empMap = new Map();
  const catMap = new Map();
  const recentBlockers = [];

  for (const row of workLogs) {
    const mins = num(row.duration_minutes);
    totalLoggedMinutes += mins;
    if (row.entry_type === 'ticket_work') ticketWorkMinutes += mins;
    else companyActivityMinutes += mins;

    if (row.project_id) {
      const pid = Number(row.project_id);
      const pEntry = projMap.get(pid) || {
        projectId: pid,
        projectName: row.project_name || `Project #${pid}`,
        projectKey: row.project_key || '',
        projectColor: row.project_color || '#0052cc',
        loggedMinutes: 0,
        contributorIds: new Set(),
      };
      pEntry.loggedMinutes += mins;
      pEntry.contributorIds.add(Number(row.employee_id));
      projMap.set(pid, pEntry);
    }

    const eid = Number(row.employee_id);
    const eEntry = empMap.get(eid) || {
      employeeId: eid,
      employeeName: row.employee_name,
      department: row.employee_department || '',
      totalMinutes: 0,
      ticketMinutes: 0,
      companyActivityMinutes: 0,
      projectIds: new Set(),
      blockerCount: 0,
    };
    eEntry.totalMinutes += mins;
    if (row.entry_type === 'ticket_work') eEntry.ticketMinutes += mins;
    else eEntry.companyActivityMinutes += mins;
    if (row.project_id) eEntry.projectIds.add(Number(row.project_id));
    if (row.blocker_text && String(row.blocker_text).trim() && mins > 0) {
      eEntry.blockerCount += 1;
      if (recentBlockers.length < 25) {
        recentBlockers.push({
          workDate: row.work_date,
          employeeId: eid,
          employeeName: row.employee_name,
          projectId: row.project_id ? Number(row.project_id) : null,
          projectName: row.project_name || '',
          ticketId: row.ticket_id ? Number(row.ticket_id) : null,
          blocker: row.blocker_text,
        });
      }
    }
    empMap.set(eid, eEntry);

    const cCode = row.category_code || 'development';
    const cEntry = catMap.get(cCode) || {
      code: cCode,
      label: row.category_label || cCode,
      minutes: 0,
    };
    cEntry.minutes += mins;
    catMap.set(cCode, cEntry);
  }

  // 2. Scoped tickets + effective stage dwell times
  let ticketSql = `
    SELECT t.id, t.title, t.status, t.priority, t.project_id, t.employee_id, t.due_date, t.updated_at,
           p.name AS project_name, p.key AS project_key, e.name AS employee_name
    FROM tickets t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN employees e ON e.id = t.employee_id
    WHERE COALESCE(t.archived, 0) = 0
  `;
  const tParams = [];
  if (empFilter || projFilter) {
    const parts = [];
    if (empFilter && empFilter.length > 0) {
      parts.push(`t.employee_id IN (${empFilter.map(() => '?').join(', ')})`);
      tParams.push(...empFilter);
    }
    if (projFilter && projFilter.length > 0) {
      parts.push(`t.project_id IN (${projFilter.map(() => '?').join(', ')})`);
      tParams.push(...projFilter);
    }
    if (parts.length > 0) ticketSql += ` AND (${parts.join(' OR ')})`;
  }
  const tickets = await db.prepare(ticketSql).all(...tParams);

  const today = todayKolkataDate();
  let openTickets = 0;
  let overdueTickets = 0;
  for (const t of tickets) {
    if (t.status !== 'closed') {
      openTickets += 1;
      if (t.due_date && String(t.due_date).slice(0, 10) < today) {
        overdueTickets += 1;
      }
    }
    if (t.project_id) {
      const pid = Number(t.project_id);
      const pEntry = projMap.get(pid) || {
        projectId: pid,
        projectName: t.project_name || `Project #${pid}`,
        projectKey: t.project_key || '',
        projectColor: '#0052cc',
        loggedMinutes: 0,
        contributorIds: new Set(),
      };
      pEntry.totalTickets = (pEntry.totalTickets || 0) + 1;
      if (t.status !== 'closed') {
        pEntry.openTickets = (pEntry.openTickets || 0) + 1;
        if (t.due_date && String(t.due_date).slice(0, 10) < today) {
          pEntry.overdueTickets = (pEntry.overdueTickets || 0) + 1;
        }
      } else {
        pEntry.closedTickets = (pEntry.closedTickets || 0) + 1;
      }
      projMap.set(pid, pEntry);
    }
  }

  const effectiveStages = await getEffectiveStagesForTickets(tickets.map((t) => t.id));
  const stageBottlenecks = aggregateStagesByStageCode(effectiveStages);

  const ticketLookup = new Map(tickets.map((t) => [Number(t.id), t]));
  const stuckTickets = effectiveStages
    .filter((s) => s.isActive && s.status !== 'closed' && s.calendarSeconds >= 48 * 3600)
    .sort((a, b) => b.calendarSeconds - a.calendarSeconds)
    .slice(0, 20)
    .map((s) => {
      const t = ticketLookup.get(s.ticketId);
      return {
        ticketId: s.ticketId,
        key: t?.project_key ? `${t.project_key}-${s.ticketId}` : `#${s.ticketId}`,
        title: t?.title || '',
        projectId: t?.project_id || null,
        projectName: t?.project_name || '',
        assigneeName: t?.employee_name || 'Unassigned',
        currentStage: s.status,
        calendarHours: Math.round((s.calendarSeconds / 3600) * 10) / 10,
        businessHours: Math.round((s.businessSeconds / 3600) * 10) / 10,
        durationPrecision: s.durationPrecision,
      };
    });

  const projectEffort = Array.from(projMap.values())
    .map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName,
      projectKey: p.projectKey,
      projectColor: p.projectColor,
      loggedMinutes: p.loggedMinutes,
      loggedHours: Math.round((p.loggedMinutes / 60) * 100) / 100,
      contributorCount: p.contributorIds.size,
      totalTickets: p.totalTickets || 0,
      openTickets: p.openTickets || 0,
      closedTickets: p.closedTickets || 0,
      overdueTickets: p.overdueTickets || 0,
    }))
    .sort((a, b) => b.loggedMinutes - a.loggedMinutes);

  const employeeEffort = Array.from(empMap.values())
    .map((e) => ({
      employeeId: e.employeeId,
      employeeName: e.employeeName,
      department: e.department,
      totalMinutes: e.totalMinutes,
      totalHours: Math.round((e.totalMinutes / 60) * 100) / 100,
      ticketMinutes: e.ticketMinutes,
      companyActivityMinutes: e.companyActivityMinutes,
      projectCount: e.projectIds.size,
      blockerCount: e.blockerCount,
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  const categoryDistribution = Array.from(catMap.values())
    .map((c) => ({
      code: c.code,
      label: c.label,
      minutes: c.minutes,
      sharePercent: totalLoggedMinutes > 0 ? Math.round((c.minutes / totalLoggedMinutes) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  return {
    totals: {
      totalLoggedMinutes,
      ticketWorkMinutes,
      companyActivityMinutes,
      openTickets,
      overdueTickets,
      blockersCount: recentBlockers.length,
    },
    projectEffort,
    employeeEffort,
    categoryDistribution,
    stageBottlenecks,
    stuckTickets,
    recentBlockers,
  };
}

/**
 * Executive Owner/Admin 360° Company Monitoring Overview.
 */
export async function getOwnerOverview({ user, from = null, to = null, preset = 'this_month' }) {
  if (!isAdminOrOwner(user)) {
    const err = new Error('Forbidden: Business Owner or Administrator access required.');
    err.statusCode = 403;
    throw err;
  }

  const win = resolveMonitoringWindow({ from, to, preset });
  const [agg, reconciliation, scheduleCtx, unmappedRow, activeEmpRow] = await Promise.all([
    computeScopeAggregates({ fromDate: win.fromDate, toDate: win.toDate }),
    getAttendanceReconciliation({ fromDate: win.fromDate, toDate: win.toDate }),
    loadScheduleContext(),
    db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM task_sheet_submissions s
         WHERE s.submitted_by IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM employee_work_logs ewl
             WHERE ewl.source_type IN ('task_sheet', 'admin_legacy_map', 'backfill')
               AND ewl.source_id = s.id
           )`
      )
      .get(),
    db.prepare("SELECT COUNT(*) AS cnt FROM employees WHERE active = 1 AND role != 'client'").get(),
  ]);

  return {
    window: win,
    companyTotals: {
      ...agg.totals,
      activeEmployeesCount: num(activeEmpRow?.cnt),
      activeProjectsCount: agg.projectEffort.length,
      unmappedLegacyCount: num(unmappedRow?.cnt),
    },
    projectEffort: agg.projectEffort,
    employeeDistribution: agg.employeeEffort,
    categoryDistribution: agg.categoryDistribution,
    stageBottlenecks: agg.stageBottlenecks,
    stuckTickets: agg.stuckTickets,
    recentBlockers: agg.recentBlockers,
    reconciliationSummary: reconciliation.summary,
    reconciliationAlerts: reconciliation.rows.filter((r) =>
      ['missing_task_sheet', 'large_unaccounted_gap', 'logged_without_attendance'].includes(r.reconciliationStatus)
    ).slice(0, 30),
    scheduleBaseline: {
      activeScheduleId: scheduleCtx.activeSchedule?.id || null,
      effectiveFrom: scheduleCtx.activeSchedule?.effective_from || null,
      sourceConfidence: scheduleCtx.activeSchedule?.source_confidence || 'provisional_inferred_from_settings',
      workingDays: scheduleCtx.activeSchedule?.working_days || '1,2,3,4,5,6',
      workStartTime: scheduleCtx.activeSchedule?.work_start_time || '09:00',
      workEndTime: scheduleCtx.activeSchedule?.work_end_time || '17:00',
    },
  };
}

/**
 * Manager 360° Team & Assigned Project Monitoring Overview (strict union isolation).
 */
export async function getManagerOverview({ user, from = null, to = null, preset = 'this_month' }) {
  const scope = await resolveUserScope(user);
  if (!scope.isManager && !scope.isAdmin) {
    const err = new Error('Forbidden: Manager or Administrator access required.');
    err.statusCode = 403;
    throw err;
  }

  const win = resolveMonitoringWindow({ from, to, preset });
  const empIds = scope.isAdmin ? null : Array.from(scope.scopedEmployeeIds);
  const projIds = scope.isAdmin ? null : Array.from(scope.scopedProjectIds);

  const [agg, reconciliation] = await Promise.all([
    computeScopeAggregates({
      fromDate: win.fromDate,
      toDate: win.toDate,
      allowedEmployeeIds: empIds,
      allowedProjectIds: projIds,
    }),
    getAttendanceReconciliation({
      employeeIds: empIds || [],
      fromDate: win.fromDate,
      toDate: win.toDate,
    }),
  ]);

  return {
    window: win,
    scopedEmployeeIds: empIds,
    scopedProjectIds: projIds,
    teamTotals: agg.totals,
    projectEffort: agg.projectEffort,
    employeeDistribution: agg.employeeEffort,
    categoryDistribution: agg.categoryDistribution,
    stageBottlenecks: agg.stageBottlenecks,
    stuckTickets: agg.stuckTickets,
    recentBlockers: agg.recentBlockers,
    reconciliationSummary: reconciliation.summary,
    reconciliationAlerts: reconciliation.rows.filter((r) =>
      ['missing_task_sheet', 'large_unaccounted_gap', 'logged_without_attendance'].includes(r.reconciliationStatus)
    ).slice(0, 30),
  };
}

/**
 * Individual Employee 360° Monitoring Detail (strictly RBAC-guarded via `assertCanViewEmployee`).
 */
export async function getEmployeeMonitoringDetail({ user, employeeId, from = null, to = null, preset = 'this_month' }) {
  const empId = Number(employeeId);
  const access = await assertCanViewEmployee(user, empId);
  if (!access.allowed) {
    const err = new Error(access.error || 'Forbidden');
    err.statusCode = access.status || 403;
    throw err;
  }

  const empRaw = await db
    .prepare(
      `SELECT e.*, mgr.name AS reporting_manager_name, d.name AS department_name
       FROM employees e
       LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.id = ?`
    )
    .get(empId);
  if (!empRaw) {
    const err = new Error('Employee not found.');
    err.statusCode = 404;
    throw err;
  }

  const win = resolveMonitoringWindow({ from, to, preset });

  const [logs, tickets, reconciliation] = await Promise.all([
    db
      .prepare(
        `SELECT ewl.*, p.name AS project_name, p.key AS project_key,
                t.title AS ticket_title, t.status AS ticket_status,
                wc.label AS category_label
         FROM employee_work_logs ewl
         LEFT JOIN projects p ON p.id = ewl.project_id
         LEFT JOIN tickets t ON t.id = ewl.ticket_id
         LEFT JOIN work_categories wc ON wc.code = ewl.category_code
         WHERE ewl.employee_id = ? AND ewl.work_date >= ? AND ewl.work_date <= ?
         ORDER BY ewl.work_date DESC, ewl.id DESC`
      )
      .all(empId, win.fromDate, win.toDate),
    db
      .prepare(
        `SELECT t.id, t.title, t.status, t.priority, t.due_date, p.name AS project_name, p.key AS project_key
         FROM tickets t
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE t.employee_id = ? AND COALESCE(t.archived, 0) = 0
         ORDER BY t.updated_at DESC`
      )
      .all(empId),
    getAttendanceReconciliation({
      employeeIds: [empId],
      fromDate: win.fromDate,
      toDate: win.toDate,
      includeEmptyWorkingDays: false,
    }),
  ]);

  let totalLoggedMinutes = 0;
  let ticketWorkMinutes = 0;
  let companyActivityMinutes = 0;
  const byProject = new Map();
  const byCategory = new Map();

  for (const l of logs) {
    const m = num(l.duration_minutes);
    totalLoggedMinutes += m;
    if (l.entry_type === 'ticket_work') ticketWorkMinutes += m;
    else companyActivityMinutes += m;

    const pKey = l.project_id ? String(l.project_id) : 'non_project';
    const pCur = byProject.get(pKey) || {
      projectId: l.project_id ? Number(l.project_id) : null,
      projectName: l.project_name || 'Company / Non-Project',
      projectKey: l.project_key || '',
      minutes: 0,
    };
    pCur.minutes += m;
    byProject.set(pKey, pCur);

    const cCode = l.category_code || 'development';
    const cCur = byCategory.get(cCode) || {
      code: cCode,
      label: l.category_label || cCode,
      minutes: 0,
    };
    cCur.minutes += m;
    byCategory.set(cCode, cCur);
  }

  return {
    window: win,
    employee: toSafeEmployee(empRaw),
    effortTotals: {
      totalLoggedMinutes,
      totalLoggedHours: Math.round((totalLoggedMinutes / 60) * 100) / 100,
      ticketWorkMinutes,
      companyActivityMinutes,
    },
    byProject: Array.from(byProject.values()).sort((a, b) => b.minutes - a.minutes),
    byCategory: Array.from(byCategory.values()).sort((a, b) => b.minutes - a.minutes),
    assignedTickets: tickets,
    workLogs: logs,
    reconciliation,
  };
}

/**
 * Project 360° Monitoring Detail (strictly RBAC-guarded via `assertCanViewProject`).
 */
export async function getProjectMonitoringDetail({ user, projectId, from = null, to = null, preset = 'this_month' }) {
  const pid = Number(projectId);
  const access = await assertCanViewProject(user, pid);
  if (!access.allowed) {
    const err = new Error(access.error || 'Forbidden');
    err.statusCode = access.status || 403;
    throw err;
  }

  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
  if (!project) {
    const err = new Error('Project not found.');
    err.statusCode = 404;
    throw err;
  }

  const win = resolveMonitoringWindow({ from, to, preset });

  const [members, tickets, projectLogs] = await Promise.all([
    db
      .prepare(
        `SELECT pm.*, e.name AS employee_name, e.email AS employee_email, e.department, e.title
         FROM project_members pm
         JOIN employees e ON e.id = pm.employee_id
         WHERE pm.project_id = ? AND pm.is_active = 1
         ORDER BY pm.project_role ASC, e.name COLLATE NOCASE`
      )
      .all(pid),
    db
      .prepare(
        `SELECT t.id, t.title, t.status, t.priority, t.type, t.due_date, t.employee_id, t.created_at, t.updated_at,
                e.name AS employee_name
         FROM tickets t
         LEFT JOIN employees e ON e.id = t.employee_id
         WHERE t.project_id = ? AND COALESCE(t.archived, 0) = 0
         ORDER BY t.id DESC`
      )
      .all(pid),
    db
      .prepare(
        `SELECT ewl.*, e.name AS employee_name, wc.label AS category_label
         FROM employee_work_logs ewl
         JOIN employees e ON e.id = ewl.employee_id
         LEFT JOIN work_categories wc ON wc.code = ewl.category_code
         WHERE ewl.project_id = ? AND ewl.work_date >= ? AND ewl.work_date <= ?
         ORDER BY ewl.work_date DESC, ewl.id DESC`
      )
      .all(pid, win.fromDate, win.toDate),
  ]);

  const effectiveStages = await getEffectiveStagesForTickets(tickets.map((t) => t.id));
  const stageBreakdown = aggregateStagesByStageCode(effectiveStages);

  let totalLoggedMinutes = 0;
  const byEmployee = new Map();
  const byTicket = new Map();
  const blockers = [];

  for (const l of projectLogs) {
    const mins = num(l.duration_minutes);
    totalLoggedMinutes += mins;

    const eid = Number(l.employee_id);
    const eCur = byEmployee.get(eid) || { employeeId: eid, employeeName: l.employee_name, minutes: 0 };
    eCur.minutes += mins;
    byEmployee.set(eid, eCur);

    if (l.ticket_id) {
      const tid = Number(l.ticket_id);
      byTicket.set(tid, (byTicket.get(tid) || 0) + mins);
    }
    if (l.blocker_text && String(l.blocker_text).trim() && mins > 0) {
      blockers.push({
        workDate: l.work_date,
        employeeId: eid,
        employeeName: l.employee_name,
        ticketId: l.ticket_id ? Number(l.ticket_id) : null,
        blocker: l.blocker_text,
      });
    }
  }

  const today = todayKolkataDate();
  const delayedTickets = tickets
    .filter((t) => t.status !== 'closed' && t.due_date && String(t.due_date).slice(0, 10) < today)
    .map((t) => ({
      ...t,
      key: `${project.key}-${t.id}`,
      loggedMinutes: byTicket.get(Number(t.id)) || 0,
    }));

  const ticketEffort = tickets.map((t) => ({
    id: Number(t.id),
    key: `${project.key}-${t.id}`,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assigneeName: t.employee_name || 'Unassigned',
    dueDate: t.due_date,
    loggedMinutes: byTicket.get(Number(t.id)) || 0,
  }));

  return {
    window: win,
    project,
    members,
    totals: {
      totalLoggedMinutes,
      totalLoggedHours: Math.round((totalLoggedMinutes / 60) * 100) / 100,
      totalTickets: tickets.length,
      openTickets: tickets.filter((t) => t.status !== 'closed').length,
      delayedTicketsCount: delayedTickets.length,
    },
    effortByEmployee: Array.from(byEmployee.values()).sort((a, b) => b.minutes - a.minutes),
    ticketEffort,
    stageBreakdown,
    delayedTickets,
    blockers,
  };
}
