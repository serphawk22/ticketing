import { db } from './db.js';
import { toKolkata, calculateDurationsBetween } from './businessHours.js';
import { loadScheduleContext } from './businessScheduleService.js';
import { parseUtcDate as parseIstUtcDate, resolveDateRange } from './dateFilters.js';
import { assertCanViewEmployee, assertCanViewProject, isAdminOrOwner, isManager, resolveUserScope } from './rbac.js';
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
    const customRange = resolveDateRange({ preset: 'custom', startDate: from, endDate: to });
    return {
      fromDate: from,
      toDate: to,
      startUtc: `${from} 00:00:00`,
      endUtc: `${to} 23:59:59`,
      startMs: customRange?.startMs ?? null,
      endMs: customRange?.endMs ?? null,
      preset: 'custom',
    };
  }
  const range = resolveDateRange({ preset: preset || 'this_month', startDate: from || '', endDate: to || '' });
  if (range && range.startDate && range.endDate) {
    return {
      fromDate: range.startDate,
      toDate: range.endDate,
      startUtc: range.startIso ? range.startIso.slice(0, 19).replace('T', ' ') : `${range.startDate} 00:00:00`,
      endUtc: range.endIso ? range.endIso.slice(0, 19).replace('T', ' ') : `${range.endDate} 23:59:59`,
      startMs: range.startMs,
      endMs: range.endMs,
      preset: range.preset || preset || 'this_month',
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
    startMs: null,
    endMs: null,
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

function shiftIsoDate(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function toTimestampMs(value) {
  if (!value) return null;
  const d = parseIstUtcDate(value);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

function isTerminalStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'resolved' || normalized === 'closed';
}

function buildTicketRef(row) {
  const prefix = row.project_key || row.key || 'TM';
  const tid = Number(row.ticket_id ?? row.id);
  const key = `${prefix}-${tid}`;
  return {
    id: tid,
    key,
    title: row.title || '',
    status: row.status || 'open',
    priority: row.priority || 'medium',
    dueDate: row.due_date || null,
    projectId: row.project_id ? Number(row.project_id) : null,
    projectName: row.project_name || null,
  };
}

/**
 * Returns employee-wise daily (or filtered IST range) progress for Owner, Admin, and Manager dashboards.
 * Starts from all active in-scope employees so users with zero due/completed tickets still appear
 * alongside their ticket comments, daily employee notes, and general company activity updates.
 */
export async function getEmployeeDailyProgress({
  user,
  preset = 'today',
  from = null,
  to = null,
  date = null,
} = {}) {
  if (!user || (!isAdminOrOwner(user) && !isManager(user))) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  let resolved;
  const cleanDate = date ? String(date).trim() : '';
  const cleanFrom = from ? String(from).trim() : '';
  const cleanTo = to ? String(to).trim() : '';
  if (cleanDate && /^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    resolved = resolveDateRange({ preset: 'custom', startDate: cleanDate, endDate: cleanDate });
  } else if (cleanFrom && cleanTo && /^\d{4}-\d{2}-\d{2}$/.test(cleanFrom) && /^\d{4}-\d{2}-\d{2}$/.test(cleanTo)) {
    resolved = resolveDateRange({ preset: 'custom', startDate: cleanFrom, endDate: cleanTo });
  } else {
    resolved = resolveDateRange({ preset: preset || 'today', startDate: cleanFrom, endDate: cleanTo });
  }

  const fromDate = resolved?.startDate || todayKolkataDate();
  const toDate = resolved?.endDate || fromDate;
  const startMs = resolved?.startMs ?? toTimestampMs(`${fromDate}T00:00:00+05:30`);
  const endMs = resolved?.endMs ?? toTimestampMs(`${toDate}T23:59:59.999+05:30`);
  const bufStartIso = `${shiftIsoDate(fromDate, -2)}T00:00:00.000Z`;
  const bufEndIso = `${shiftIsoDate(toDate, 2)}T23:59:59.999Z`;

  const scope = await resolveUserScope(user);

  const rawEmployees = await db.prepare(
    `SELECT e.id, e.name, e.email, e.role, e.department, e.title, e.active, e.user_id,
            u.role AS user_role
     FROM employees e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE COALESCE(e.active, 1) = 1
       AND LOWER(COALESCE(u.role, e.role, 'employee')) != 'client'
       AND COALESCE(e.name, '') != 'Admin User'
     ORDER BY e.name ASC`,
  ).all();

  const employees = rawEmployees.filter((emp) => {
    if (scope.canViewAll) return true;
    return scope.scopedEmployeeIds ? scope.scopedEmployeeIds.has(Number(emp.id)) : false;
  });

  const scopedEmpIds = new Set(employees.map((e) => Number(e.id)));
  const userIdToEmpId = new Map();
  for (const emp of employees) {
    if (emp.user_id) {
      userIdToEmpId.set(Number(emp.user_id), Number(emp.id));
    }
  }

  if (employees.length === 0) {
    return {
      window: {
        preset: resolved?.preset || preset || 'today',
        timezone: 'Asia/Kolkata',
        fromDate,
        toDate,
        startMs,
        endMs,
        label: resolved?.label || fromDate,
      },
      summary: {
        totalEmployees: 0,
        employeesWithTickets: 0,
        employeesWithoutTickets: 0,
        totalDueCount: 0,
        totalCompletedCount: 0,
        totalTicketCommentsCount: 0,
        totalGeneralUpdatesCount: 0,
      },
      employees: [],
    };
  }

  const [dueOrCompletedTickets, terminalHistoryRows, commentRows, dailyNoteRows, workLogRows, taskSheetRows] =
    await Promise.all([
      db.prepare(
        `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.updated_at,
                t.employee_id, t.project_id, p.name AS project_name, p.key AS project_key
         FROM tickets t
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE COALESCE(t.archived, 0) = 0
           AND (
             (t.due_date >= ? AND t.due_date <= ?)
             OR (
               LOWER(COALESCE(t.status, '')) IN ('resolved', 'closed')
               AND t.updated_at >= ? AND t.updated_at <= ?
             )
           )
         ORDER BY t.due_date ASC, t.updated_at DESC, t.id DESC`,
      ).all(fromDate, toDate, bufStartIso, bufEndIso),
      db.prepare(
        `SELECT h.ticket_id, h.to_status AS stage_name, h.entry_at, h.changed_by AS changed_by_user_id,
                t.title, t.status, t.priority, t.due_date, t.employee_id, t.project_id,
                p.name AS project_name, p.key AS project_key
         FROM ticket_stage_history h
         JOIN tickets t ON t.id = h.ticket_id
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE COALESCE(t.archived, 0) = 0
           AND LOWER(COALESCE(h.to_status, '')) IN ('resolved', 'closed')
           AND h.entry_at >= ? AND h.entry_at <= ?
         ORDER BY h.entry_at DESC`,
      ).all(bufStartIso, bufEndIso),
      db.prepare(
        `SELECT c.id, c.ticket_id, c.author_id, c.body, c.created_at, c.updated_at,
                t.title, t.status, t.priority, t.due_date, t.employee_id AS ticket_employee_id,
                t.project_id, p.name AS project_name, p.key AS project_key
         FROM ticket_comments c
         JOIN tickets t ON t.id = c.ticket_id
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE COALESCE(t.archived, 0) = 0
           AND c.created_at >= ? AND c.created_at <= ?
         ORDER BY c.created_at DESC, c.id DESC`,
      ).all(bufStartIso, bufEndIso),
      db.prepare(
        `SELECT n.id, n.employee_id, n.user_id, n.work_date, n.ticket_id, n.category, n.body,
                n.created_at, n.updated_at,
                t.title, t.status, t.priority, t.due_date, t.project_id,
                p.name AS project_name, p.key AS project_key
         FROM daily_employee_notes n
         LEFT JOIN tickets t ON t.id = n.ticket_id
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE n.work_date >= ? AND n.work_date <= ?
         ORDER BY n.work_date DESC, n.created_at DESC, n.id DESC`,
      ).all(fromDate, toDate),
      db.prepare(
        `SELECT l.id, l.employee_id, l.user_id, l.work_date, l.entry_type, l.entry_kind,
                l.amendment_id, l.source_type, l.source_id, l.category_code,
                l.work_description, l.completed_work, l.pending_work, l.blocker_text,
                l.duration_minutes, l.created_at
         FROM employee_work_logs l
         WHERE l.work_date >= ? AND l.work_date <= ?
         ORDER BY l.work_date DESC, l.created_at DESC, l.id DESC`,
      ).all(fromDate, toDate),
      db.prepare(
        `SELECT ts.id, ts.employee_id, ts.work_date, ts.other_activities, ts.created_at
         FROM task_sheet_submissions ts
         WHERE ts.work_date >= ? AND ts.work_date <= ?
           AND COALESCE(TRIM(ts.other_activities), '') != ''
         ORDER BY ts.work_date DESC, ts.created_at DESC, ts.id DESC`,
      ).all(fromDate, toDate),
    ]);

  const byEmp = new Map();
  for (const emp of employees) {
    const safeEmp = toSafeEmployee(emp);
    byEmp.set(Number(emp.id), {
      employee: {
        ...safeEmp,
        designation: emp.title || safeEmp?.title || '',
        userId: emp.user_id ? Number(emp.user_id) : null,
      },
      dueTickets: [],
      completedTickets: [],
      ticketComments: [],
      generalActivities: [],
      dueTicketIds: new Set(),
      completedTicketIds: new Set(),
      latestActivityMs: null,
    });
  }

  function touchActivity(bucket, tsValue) {
    const ms = toTimestampMs(tsValue);
    if (ms !== null && (bucket.latestActivityMs === null || ms > bucket.latestActivityMs)) {
      bucket.latestActivityMs = ms;
    }
    return ms;
  }

  function canViewTicketInScope(projectId) {
    if (scope.canViewAll) return true;
    if (!projectId) return false;
    return scope.scopedProjectIds ? scope.scopedProjectIds.has(Number(projectId)) : false;
  }

  for (const row of dueOrCompletedTickets) {
    const empId = row.employee_id ? Number(row.employee_id) : null;
    if (!empId || !scopedEmpIds.has(empId)) continue;
    if (!canViewTicketInScope(row.project_id)) continue;
    const bucket = byEmp.get(empId);
    const ref = buildTicketRef(row);

    if (row.due_date && row.due_date >= fromDate && row.due_date <= toDate && !bucket.dueTicketIds.has(ref.id)) {
      bucket.dueTicketIds.add(ref.id);
      bucket.dueTickets.push(ref);
    }

    if (isTerminalStatus(row.status)) {
      const updatedMs = toTimestampMs(row.updated_at);
      if (updatedMs !== null && updatedMs >= startMs && updatedMs <= endMs && !bucket.completedTicketIds.has(ref.id)) {
        bucket.completedTicketIds.add(ref.id);
        bucket.completedTickets.push({ ...ref, completedAt: row.updated_at });
        touchActivity(bucket, row.updated_at);
      }
    }
  }

  for (const row of terminalHistoryRows) {
    const empId = row.employee_id ? Number(row.employee_id) : null;
    if (!empId || !scopedEmpIds.has(empId)) continue;
    if (!canViewTicketInScope(row.project_id)) continue;
    const entryMs = toTimestampMs(row.entry_at);
    if (entryMs === null || entryMs < startMs || entryMs > endMs) continue;
    const bucket = byEmp.get(empId);
    const tid = Number(row.ticket_id);
    if (!bucket.completedTicketIds.has(tid)) {
      bucket.completedTicketIds.add(tid);
      bucket.completedTickets.push({ ...buildTicketRef(row), completedAt: row.entry_at });
    }
    touchActivity(bucket, row.entry_at);
  }

  for (const row of commentRows) {
    const authorEmpId = row.author_id ? userIdToEmpId.get(Number(row.author_id)) : null;
    if (!authorEmpId || !scopedEmpIds.has(authorEmpId)) continue;
    if (!canViewTicketInScope(row.project_id)) continue;
    const createdMs = toTimestampMs(row.created_at);
    if (createdMs === null || createdMs < startMs || createdMs > endMs) continue;
    const bucket = byEmp.get(authorEmpId);
    touchActivity(bucket, row.created_at);
    bucket.ticketComments.push({
      id: `tc-${row.id}`,
      commentId: Number(row.id),
      sourceType: 'ticket_comment',
      isTicketRelated: true,
      label: 'Ticket-related',
      body: row.body || '',
      createdAt: row.created_at,
      createdMs,
      ticketId: Number(row.ticket_id),
      ticketKey: `${row.project_key || 'TM'}-${row.ticket_id}`,
      ticketTitle: row.title || '',
    });
  }

  for (const row of dailyNoteRows) {
    const empId = Number(row.employee_id);
    if (!scopedEmpIds.has(empId)) continue;
    const bucket = byEmp.get(empId);
    const createdMs = touchActivity(bucket, row.updated_at || row.created_at);

    if (row.ticket_id) {
      if (!canViewTicketInScope(row.project_id)) continue;
      bucket.ticketComments.push({
        id: `dn-${row.id}`,
        noteId: Number(row.id),
        sourceType: 'daily_note',
        isTicketRelated: true,
        label: 'Ticket-related',
        category: row.category || 'general',
        workDate: row.work_date,
        body: row.body || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdMs,
        ticketId: Number(row.ticket_id),
        ticketKey: `${row.project_key || 'TM'}-${row.ticket_id}`,
        ticketTitle: row.title || '',
      });
    } else {
      bucket.generalActivities.push({
        id: `dn-${row.id}`,
        noteId: Number(row.id),
        sourceType: 'daily_note',
        isTicketRelated: false,
        label: 'General / Non-ticket',
        category: row.category || 'general',
        workDate: row.work_date,
        body: row.body || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdMs,
      });
    }
  }

  const loggedTaskSheetIds = new Set();
  const reversedLogIds = new Set();
  for (const row of workLogRows) {
    if (row.source_type === 'task_sheet' && row.source_id) {
      loggedTaskSheetIds.add(Number(row.source_id));
    }
    if (row.amendment_id) {
      reversedLogIds.add(Number(row.amendment_id));
    }
  }

  for (const row of workLogRows) {
    if (row.entry_type !== 'company_activity') continue;
    if (row.entry_kind === 'reversal_adjustment') continue;
    if (Number(row.duration_minutes || 0) <= 0) continue;
    if (reversedLogIds.has(Number(row.id))) continue;

    const empId = Number(row.employee_id);
    if (!scopedEmpIds.has(empId)) continue;
    const bucket = byEmp.get(empId);
    const createdMs = touchActivity(bucket, row.created_at);
    const labelText = [row.work_description, row.completed_work].filter(Boolean).join(' — ');

    bucket.generalActivities.push({
      id: `wl-${row.id}`,
      workLogId: Number(row.id),
      sourceType: 'work_log',
      isTicketRelated: false,
      label: 'General / Non-ticket',
      category: row.category_code || 'company_activity',
      workDate: row.work_date,
      durationMinutes: Number(row.duration_minutes || 0),
      body: labelText || 'Company activity logged',
      createdAt: row.created_at,
      createdMs,
    });
  }

  for (const ts of taskSheetRows) {
    if (loggedTaskSheetIds.has(Number(ts.id))) continue;
    const empId = Number(ts.employee_id);
    if (!scopedEmpIds.has(empId)) continue;
    const bucket = byEmp.get(empId);
    const createdMs = touchActivity(bucket, ts.created_at);

    bucket.generalActivities.push({
      id: `ts-${ts.id}`,
      taskSheetId: Number(ts.id),
      sourceType: 'task_sheet_other',
      isTicketRelated: false,
      label: 'General / Non-ticket',
      category: 'other_activities',
      workDate: ts.work_date,
      body: ts.other_activities || '',
      createdAt: ts.created_at,
      createdMs,
    });
  }

  let employeesWithTickets = 0;
  let employeesWithoutTickets = 0;
  let totalDueCount = 0;
  let totalCompletedCount = 0;
  let totalTicketCommentsCount = 0;
  let totalGeneralUpdatesCount = 0;

  const resultEmployees = Array.from(byEmp.values()).map((b) => {
    b.ticketComments.sort((a, c) => (c.createdMs || 0) - (a.createdMs || 0));
    b.generalActivities.sort((a, c) => (c.createdMs || 0) - (a.createdMs || 0));
    const hasNoTicketsDueOrCompleted = b.dueTickets.length === 0 && b.completedTickets.length === 0;
    if (hasNoTicketsDueOrCompleted) {
      employeesWithoutTickets += 1;
    } else {
      employeesWithTickets += 1;
    }
    totalDueCount += b.dueTickets.length;
    totalCompletedCount += b.completedTickets.length;
    totalTicketCommentsCount += b.ticketComments.length;
    totalGeneralUpdatesCount += b.generalActivities.length;

    return {
      employee: b.employee,
      dueTickets: b.dueTickets,
      completedTickets: b.completedTickets,
      hasNoTicketsDueOrCompleted,
      emptyTicketNotice: hasNoTicketsDueOrCompleted ? 'No tasks due or completed today.' : null,
      ticketComments: b.ticketComments,
      generalActivities: b.generalActivities,
      latestActivityAt: b.latestActivityMs ? new Date(b.latestActivityMs).toISOString() : null,
    };
  });

  resultEmployees.sort((a, b) => {
    const aHas = a.ticketComments.length + a.generalActivities.length + a.dueTickets.length + a.completedTickets.length > 0 ? 1 : 0;
    const bHas = b.ticketComments.length + b.generalActivities.length + b.dueTickets.length + b.completedTickets.length > 0 ? 1 : 0;
    if (bHas !== aHas) return bHas - aHas;
    return String(a.employee?.name || '').localeCompare(String(b.employee?.name || ''));
  });

  return {
    window: {
      preset: resolved?.preset || preset || 'today',
      timezone: 'Asia/Kolkata',
      fromDate,
      toDate,
      startMs,
      endMs,
      label: resolved?.label || fromDate,
    },
    summary: {
      totalEmployees: resultEmployees.length,
      employeesWithTickets,
      employeesWithoutTickets,
      totalDueCount,
      totalCompletedCount,
      totalTicketCommentsCount,
      totalGeneralUpdatesCount,
    },
    employees: resultEmployees,
  };
}

