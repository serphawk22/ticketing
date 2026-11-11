import { db } from './db.js';
import { checkHoliday, isSundayWeeklyOff } from './attendance.js';
import { toKolkata } from './businessHours.js';
import { indiaToday } from './indiaDate.js';
import { getActiveEmployees } from './employees.js';
import { listSubmissions, submissionProjects } from './taskSheet.js';

const IST_TIME_ZONE = 'Asia/Kolkata';

/**
 * Normalizes any timestamp or date into an IST YYYY-MM-DD string
 */
export function extractIstDate(dateInput) {
  if (!dateInput) return '';
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    return dateInput.trim();
  }
  const kd = toKolkata(dateInput);
  if (!kd || Number.isNaN(kd.getTime())) {
    const raw = String(dateInput).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  }
  return kd.toISOString().slice(0, 10);
}

/**
 * Returns a human-friendly formatted label for an IST date
 */
export function formatIstDateLabel(dateStr, options = {}) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 6, 30)); // 12:00 PM IST
  const intlOpts = {
    timeZone: IST_TIME_ZONE,
  };
  if (options.weekday !== false) intlOpts.weekday = options.weekday || 'short';
  if (options.month !== false) intlOpts.month = options.month || 'short';
  if (options.day !== false) intlOpts.day = options.day || 'numeric';
  if (options.year) intlOpts.year = options.year;
  else if (options.year !== false) intlOpts.year = 'numeric';

  return new Intl.DateTimeFormat('en-IN', intlOpts).format(date);
}

/**
 * Computes the previous N working days prior to anchorDate.
 * Working days are Mon-Sat; Sundays and company holidays (from DB) are excluded.
 *
 * @param {string|Date} anchorDateInput - 'YYYY-MM-DD' or Date
 * @param {number} count - number of working days to look back (default 3)
 * @param {number|null} workspaceId - workspace scope for company holidays
 * @returns {Promise<Array<{ date: string, dayOfWeek: string, formatted: string }>>}
 */
export async function getPreviousWorkingDays(anchorDateInput, count = 3, workspaceId = null) {
  const anchorDateStr = extractIstDate(anchorDateInput) || indiaToday();
  const [y, m, d] = anchorDateStr.split('-').map(Number);
  let cur = new Date(Date.UTC(y, m - 1, d, 6, 30)); // 12:00 PM IST

  const result = [];
  let safetyLimit = 45; // Guard against extreme holiday gaps

  while (result.length < count && safetyLimit > 0) {
    safetyLimit--;
    cur = new Date(cur.getTime() - 24 * 60 * 60 * 1000);

    const isSun = isSundayWeeklyOff(cur);
    const holidayInfo = await checkHoliday(cur, workspaceId);

    if (!isSun && !holidayInfo.isHoliday) {
      const kd = toKolkata(cur);
      const iso = kd.toISOString().slice(0, 10);
      result.push({
        date: iso,
        dayOfWeek: formatIstDateLabel(iso, { weekday: 'short', month: false, day: false, year: false }),
        formatted: formatIstDateLabel(iso),
      });
    }
  }

  // Return chronological order: oldest to newest (e.g. Day-3, Day-2, Day-1)
  return result.reverse();
}

/**
 * Aggregates factual database metrics comparing today against the previous working days.
 *
 * @param {object} options
 * @param {string} [options.anchorDate] - Target date in YYYY-MM-DD (defaults to indiaToday)
 * @param {number} [options.lookbackDays=3] - Number of working days
 * @param {number|null} [options.workspaceId]
 */
export async function aggregateTaskSheetPulseMetrics({
  anchorDate = null,
  lookbackDays = 3,
  workspaceId = null,
} = {}) {
  const targetDate = extractIstDate(anchorDate) || indiaToday();
  const comparisonDays = await getPreviousWorkingDays(targetDate, lookbackDays, workspaceId);
  const comparisonDateList = comparisonDays.map((d) => d.date);
  const comparisonDateSet = new Set(comparisonDateList);

  // 1. Fetch active employees
  const activeEmployees = await getActiveEmployees();
  const activeNames = new Set(activeEmployees.map((e) => e.name).filter(Boolean));

  // 2. Fetch today's submissions
  const rawTodayRows = await listSubmissions({ from: targetDate, to: targetDate, limit: 1000 });
  const todayRows = rawTodayRows.filter(
    (r) => extractIstDate(r.created_at) === targetDate && activeNames.has(r.name)
  );

  // 3. Fetch comparison working days submissions
  let historicalRows = [];
  if (comparisonDateList.length > 0) {
    const minCompDate = comparisonDateList[0];
    const maxCompDate = comparisonDateList[comparisonDateList.length - 1];
    const rawRangeRows = await listSubmissions({ from: minCompDate, to: maxCompDate, limit: 2000 });
    historicalRows = rawRangeRows.filter((r) => {
      const d = extractIstDate(r.created_at);
      return comparisonDateSet.has(d) && activeNames.has(r.name);
    });
  }

  // 4. Compute Team Velocity & Participation
  const teamSize = activeEmployees.length;
  const todaySubmitters = new Set(todayRows.map((r) => r.name));
  const todayActiveCount = todaySubmitters.size;
  const submissionRate = teamSize > 0 ? Math.round((todayActiveCount / teamSize) * 100) : 0;

  // Average daily submitters across comparison working days
  const historicalSubmittersByDay = {};
  for (const date of comparisonDateList) historicalSubmittersByDay[date] = new Set();
  for (const r of historicalRows) {
    const d = extractIstDate(r.created_at);
    if (historicalSubmittersByDay[d]) historicalSubmittersByDay[d].add(r.name);
  }
  const histDayCounts = Object.values(historicalSubmittersByDay).map((s) => s.size);
  const histAvgSubmitters =
    histDayCounts.length > 0
      ? Number((histDayCounts.reduce((a, b) => a + b, 0) / histDayCounts.length).toFixed(1))
      : 0;

  // 5. Compute Hours
  const todayTotalHours = Number(
    todayRows.reduce((sum, r) => sum + (parseFloat(r.hours_worked) || 0), 0).toFixed(1)
  );
  const histTotalHours = Number(
    historicalRows.reduce((sum, r) => sum + (parseFloat(r.hours_worked) || 0), 0).toFixed(1)
  );
  const histDailyAvgHours =
    comparisonDateList.length > 0
      ? Number((histTotalHours / comparisonDateList.length).toFixed(1))
      : 0;

  const hoursDeltaPct =
    histDailyAvgHours > 0
      ? Math.round(((todayTotalHours - histDailyAvgHours) / histDailyAvgHours) * 100)
      : todayTotalHours > 0 ? 100 : 0;

  // 6. Compute Tasks & Completion Rates
  const todayCompleted = todayRows.filter((r) => r.task_state === 'completed').length;
  const todayOpen = todayRows.filter((r) => r.task_state === 'not_completed').length;
  const todayTotalTasks = todayCompleted + todayOpen;
  const todayCompletionRate =
    todayTotalTasks > 0 ? Math.round((todayCompleted / todayTotalTasks) * 100) : 0;

  const histCompleted = historicalRows.filter((r) => r.task_state === 'completed').length;
  const histOpen = historicalRows.filter((r) => r.task_state === 'not_completed').length;
  const histTotalTasks = histCompleted + histOpen;
  const histCompletionRate =
    histTotalTasks > 0 ? Math.round((histCompleted / histTotalTasks) * 100) : 0;
  const histDailyAvgCompleted =
    comparisonDateList.length > 0
      ? Number((histCompleted / comparisonDateList.length).toFixed(1))
      : 0;

  const tasksDeltaPct =
    histDailyAvgCompleted > 0
      ? Math.round(((todayCompleted - histDailyAvgCompleted) / histDailyAvgCompleted) * 100)
      : todayCompleted > 0 ? 100 : 0;

  // 7. Blocker Analysis
  const todayBlockers = [];
  for (const r of todayRows) {
    const blk = String(r.blocker || '').trim();
    if (blk && blk.toLowerCase() !== 'none' && blk.toLowerCase() !== 'nil' && blk !== '-') {
      todayBlockers.push({
        id: r.id,
        employeeName: r.name,
        blocker: blk,
        taskTitle: r.task_title || '',
        project: r.project || 'General',
      });
    }
  }

  const histBlockers = [];
  for (const r of historicalRows) {
    const blk = String(r.blocker || '').trim();
    if (blk && blk.toLowerCase() !== 'none' && blk.toLowerCase() !== 'nil' && blk !== '-') {
      histBlockers.push({
        id: r.id,
        date: extractIstDate(r.created_at),
        employeeName: r.name,
        blocker: blk,
        project: r.project || 'General',
      });
    }
  }

  // Detect recurring blockers (fuzzy or substring match in recent days)
  const recurringBlockers = [];
  for (const tb of todayBlockers) {
    const isRecurring = histBlockers.some(
      (hb) =>
        hb.employeeName === tb.employeeName ||
        hb.blocker.toLowerCase().includes(tb.blocker.toLowerCase().slice(0, 15)) ||
        tb.blocker.toLowerCase().includes(hb.blocker.toLowerCase().slice(0, 15))
    );
    if (isRecurring) {
      recurringBlockers.push(tb);
    }
  }

  // 8. Project Effort Redistribution
  const projectStats = {};
  function ensureProject(pName) {
    const clean = String(pName || 'General').trim() || 'General';
    if (!projectStats[clean]) {
      projectStats[clean] = {
        project: clean,
        todayHours: 0,
        todayTasks: 0,
        histTotalHours: 0,
        histDailyAvgHours: 0,
        deltaPct: 0,
        status: 'steady',
      };
    }
    return projectStats[clean];
  }

  for (const r of todayRows) {
    const projs = submissionProjects(r);
    const hrs = parseFloat(r.hours_worked) || 0;
    const splitHrs = projs.length > 0 ? hrs / projs.length : hrs;
    for (const p of projs.length > 0 ? projs : ['General']) {
      const ps = ensureProject(p);
      ps.todayHours = Number((ps.todayHours + splitHrs).toFixed(1));
      ps.todayTasks += 1;
    }
  }

  for (const r of historicalRows) {
    const projs = submissionProjects(r);
    const hrs = parseFloat(r.hours_worked) || 0;
    const splitHrs = projs.length > 0 ? hrs / projs.length : hrs;
    for (const p of projs.length > 0 ? projs : ['General']) {
      const ps = ensureProject(p);
      ps.histTotalHours = Number((ps.histTotalHours + splitHrs).toFixed(1));
    }
  }

  for (const ps of Object.values(projectStats)) {
    ps.histDailyAvgHours =
      comparisonDateList.length > 0
        ? Number((ps.histTotalHours / comparisonDateList.length).toFixed(1))
        : 0;

    if (ps.histDailyAvgHours > 0) {
      ps.deltaPct = Math.round(
        ((ps.todayHours - ps.histDailyAvgHours) / ps.histDailyAvgHours) * 100
      );
    } else {
      ps.deltaPct = ps.todayHours > 0 ? 100 : 0;
    }

    if (ps.todayHours === 0 && ps.histDailyAvgHours > 1) {
      ps.status = 'neglected';
    } else if (ps.deltaPct >= 30) {
      ps.status = 'increased_focus';
    } else if (ps.deltaPct <= -30) {
      ps.status = 'decreased_focus';
    } else {
      ps.status = 'steady';
    }
  }

  const projectDistribution = Object.values(projectStats).sort(
    (a, b) => b.todayHours - a.todayHours
  );

  // 9. Individual Employee Matrix
  const memberMatrix = activeEmployees.map((emp) => {
    const empTodayRows = todayRows.filter((r) => r.name === emp.name);
    const empHistRows = historicalRows.filter((r) => r.name === emp.name);

    const hasSubmitted = empTodayRows.length > 0;
    const todayHours = Number(
      empTodayRows.reduce((sum, r) => sum + (parseFloat(r.hours_worked) || 0), 0).toFixed(1)
    );
    const todayCompletedTasks = empTodayRows.filter((r) => r.task_state === 'completed').length;
    const todayOpenTasks = empTodayRows.filter((r) => r.task_state === 'not_completed').length;

    const empBlockers = [];
    for (const r of empTodayRows) {
      const b = String(r.blocker || '').trim();
      if (b && b.toLowerCase() !== 'none' && b.toLowerCase() !== 'nil' && b !== '-') {
        empBlockers.push(b);
      }
    }

    const histEmpTotalHours = empHistRows.reduce(
      (sum, r) => sum + (parseFloat(r.hours_worked) || 0),
      0
    );
    const histEmpCompletedTasks = empHistRows.filter((r) => r.task_state === 'completed').length;
    const histDaysSubmitted = new Set(empHistRows.map((r) => extractIstDate(r.created_at))).size;

    const histDailyAvgHours =
      comparisonDateList.length > 0
        ? Number((histEmpTotalHours / comparisonDateList.length).toFixed(1))
        : 0;
    const histDailyAvgCompleted =
      comparisonDateList.length > 0
        ? Number((histEmpCompletedTasks / comparisonDateList.length).toFixed(1))
        : 0;

    // Determine baseline status category
    let defaultStatus = 'Steady';
    if (!hasSubmitted) {
      defaultStatus = 'Pending Submission';
    } else if (todayHours === 0 && todayCompletedTasks === 0 && todayOpenTasks === 0) {
      defaultStatus = 'Under-reported / Incomplete';
    } else if (empBlockers.length > 0) {
      defaultStatus = 'Blocked / Needs Support';
    } else if (
      todayCompletedTasks >= 3 ||
      (histDailyAvgCompleted > 0 && todayCompletedTasks >= histDailyAvgCompleted * 1.3) ||
      todayHours >= 7.5
    ) {
      defaultStatus = 'High Velocity';
    } else {
      defaultStatus = 'Steady';
    }

    return {
      employeeId: emp.id,
      name: emp.name,
      email: emp.email,
      department: emp.department || emp.department_name || '',
      title: emp.title || emp.designation_title || '',
      hasSubmitted,
      todayHours,
      todayCompletedTasks,
      todayOpenTasks,
      todayBlockers: empBlockers,
      histDailyAvgHours,
      histDailyAvgCompleted,
      histDaysSubmitted,
      status: defaultStatus,
      tasksDetail: empTodayRows.map((r) => ({
        id: r.id,
        title: r.task_title,
        project: r.project,
        hours: r.hours_worked,
        state: r.task_state,
        blocker: r.blocker,
      })),
    };
  });

  // Sort: Blocked first, then High Velocity, then Steady, then Under-reported, then Pending
  const statusRank = {
    'Blocked / Needs Support': 1,
    'High Velocity': 2,
    Steady: 3,
    'Under-reported / Incomplete': 4,
    'Pending Submission': 5,
  };
  memberMatrix.sort((a, b) => (statusRank[a.status] || 9) - (statusRank[b.status] || 9));

  return {
    targetDate,
    targetDateFormatted: formatIstDateLabel(targetDate),
    lookbackDays: comparisonDateList.length,
    comparisonDays,
    teamSize,
    teamSummary: {
      submissionRate,
      todayActiveCount,
      histAvgSubmitters,
      todayTotalHours,
      histTotalHours,
      histDailyAvgHours,
      hoursDeltaPct,
      todayCompletedTasks: todayCompleted,
      todayOpenTasks: todayOpen,
      todayTotalTasks,
      todayCompletionRate,
      histCompletedTasks: histCompleted,
      histOpenTasks: histOpen,
      histTotalTasks,
      histCompletionRate,
      histDailyAvgCompleted,
      tasksDeltaPct,
      activeBlockersCount: todayBlockers.length,
      recurringBlockersCount: recurringBlockers.length,
    },
    todayBlockers,
    recurringBlockers,
    projectDistribution,
    memberMatrix,
  };
}
