import { db } from './db.js';
import { toKolkata } from './businessHours.js';
import { todayKolkataDate } from './workLedger.js';

function addDaysYmd(ymd, deltaDays) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function enumerateYmdRange(fromDate, toDate) {
  const out = [];
  let cur = fromDate;
  let guard = 0;
  while (cur <= toDate && guard < 366) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
    guard += 1;
  }
  return out;
}

function isSundayYmd(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.getUTCDay() === 0;
}

/**
 * Attendance vs Task Sheet Canonical Work Reconciliation Engine.
 * Cross-references `employee_attendance`, `employee_work_logs` (+ `work_categories`),
 * `employee_leave_requests`, and `company_holidays` per employee per IST date.
 * Never silently equates attendance minutes with logged effort.
 */
export async function getAttendanceReconciliation({
  employeeIds = null,
  fromDate = null,
  toDate = null,
  gapThresholdMinutes = 90,
  includeEmptyWorkingDays = false,
} = {}) {
  const today = todayKolkataDate();
  const cleanTo = /^\d{4}-\d{2}-\d{2}$/.test(String(toDate || '')) ? String(toDate) : today;
  const cleanFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(fromDate || ''))
    ? String(fromDate)
    : addDaysYmd(cleanTo, -13);

  const empFilterIds = Array.isArray(employeeIds)
    ? [...new Set(employeeIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : null;

  if (empFilterIds && empFilterIds.length === 0) {
    return {
      fromDate: cleanFrom,
      toDate: cleanTo,
      summary: {
        totalRows: 0,
        missingTaskSheetCount: 0,
        largeGapCount: 0,
        loggedWithoutAttendanceCount: 0,
        reconciledCount: 0,
        onLeaveOrHolidayCount: 0,
        totalAttendanceMinutes: 0,
        totalLoggedMinutes: 0,
        totalAccountedMinutes: 0,
      },
      rows: [],
    };
  }

  let empSql = "SELECT id, name, email, department, workspace_id FROM employees WHERE active = 1 AND role != 'client'";
  const empParams = [];
  if (empFilterIds) {
    const ph = empFilterIds.map(() => '?').join(', ');
    empSql += ` AND id IN (${ph})`;
    empParams.push(...empFilterIds);
  }
  empSql += ' ORDER BY name COLLATE NOCASE';
  const employees = await db.prepare(empSql).all(...empParams);

  if (employees.length === 0) {
    return {
      fromDate: cleanFrom,
      toDate: cleanTo,
      summary: {
        totalRows: 0,
        missingTaskSheetCount: 0,
        largeGapCount: 0,
        loggedWithoutAttendanceCount: 0,
        reconciledCount: 0,
        onLeaveOrHolidayCount: 0,
        totalAttendanceMinutes: 0,
        totalLoggedMinutes: 0,
        totalAccountedMinutes: 0,
      },
      rows: [],
    };
  }

  const targetIds = employees.map((e) => Number(e.id));
  const idPh = targetIds.map(() => '?').join(', ');

  const [attendanceRows, workLogRows, leaveRows, holidayRows] = await Promise.all([
    db
      .prepare(
        `SELECT employee_id, work_date, status, check_in_time, check_out_time,
                gross_duration_minutes, break_duration_minutes, net_duration_minutes
         FROM employee_attendance
         WHERE employee_id IN (${idPh}) AND work_date >= ? AND work_date <= ?`
      )
      .all(...targetIds, cleanFrom, cleanTo),
    db
      .prepare(
        `SELECT ewl.employee_id, ewl.work_date, ewl.entry_type, ewl.duration_minutes,
                COALESCE(wc.counts_as_accounted, 1) AS counts_as_accounted
         FROM employee_work_logs ewl
         LEFT JOIN work_categories wc ON wc.code = ewl.category_code
         WHERE ewl.employee_id IN (${idPh}) AND ewl.work_date >= ? AND ewl.work_date <= ?`
      )
      .all(...targetIds, cleanFrom, cleanTo),
    db
      .prepare(
        `SELECT employee_id, start_date, end_date, day_type, leave_type
         FROM employee_leave_requests
         WHERE employee_id IN (${idPh}) AND status = 'approved'
           AND end_date >= ? AND start_date <= ?`
      )
      .all(...targetIds, cleanFrom, cleanTo),
    db.prepare('SELECT holiday_date, is_recurring, name, workspace_id FROM company_holidays').all(),
  ]);

  const attMap = new Map();
  for (const r of attendanceRows) {
    attMap.set(`${r.employee_id}|${r.work_date}`, r);
  }

  const workMap = new Map();
  for (const w of workLogRows) {
    const key = `${w.employee_id}|${w.work_date}`;
    const cur = workMap.get(key) || {
      totalLoggedMinutes: 0,
      accountedLoggedMinutes: 0,
      ticketWorkMinutes: 0,
      companyActivityMinutes: 0,
    };
    const mins = Number(w.duration_minutes || 0);
    cur.totalLoggedMinutes += mins;
    if (Number(w.counts_as_accounted) === 1) {
      cur.accountedLoggedMinutes += mins;
    }
    if (w.entry_type === 'ticket_work') {
      cur.ticketWorkMinutes += mins;
    } else {
      cur.companyActivityMinutes += mins;
    }
    workMap.set(key, cur);
  }

  function findApprovedLeave(empId, ymd) {
    return leaveRows.find(
      (l) => Number(l.employee_id) === empId && l.start_date <= ymd && l.end_date >= ymd
    ) || null;
  }

  function findHoliday(ymd, workspaceId) {
    const mmDd = ymd.slice(5, 10);
    return holidayRows.find(
      (h) =>
        (h.workspace_id == null || Number(h.workspace_id) === Number(workspaceId)) &&
        (h.holiday_date === ymd || (Number(h.is_recurring) === 1 && h.holiday_date === mmDd))
    ) || null;
  }

  const dates = enumerateYmdRange(cleanFrom, cleanTo);
  const rows = [];
  const summary = {
    totalRows: 0,
    missingTaskSheetCount: 0,
    largeGapCount: 0,
    loggedWithoutAttendanceCount: 0,
    reconciledCount: 0,
    onLeaveOrHolidayCount: 0,
    totalAttendanceMinutes: 0,
    totalLoggedMinutes: 0,
    totalAccountedMinutes: 0,
  };

  for (const emp of employees) {
    const empId = Number(emp.id);
    for (const ymd of dates) {
      const att = attMap.get(`${empId}|${ymd}`) || null;
      const work = workMap.get(`${empId}|${ymd}`) || {
        totalLoggedMinutes: 0,
        accountedLoggedMinutes: 0,
        ticketWorkMinutes: 0,
        companyActivityMinutes: 0,
      };
      const leave = findApprovedLeave(empId, ymd);
      const holiday = findHoliday(ymd, emp.workspace_id);
      const sunday = isSundayYmd(ymd);

      const hasCheckedInAttendance =
        att != null &&
        ['present', 'late', 'half_day'].includes(att.status);
      const isExcusedAttendance =
        att != null &&
        ['on_leave', 'weekly_off', 'holiday'].includes(att.status);
      const hasExplicitExcusedSignal = Boolean(leave || holiday || isExcusedAttendance);
      const isExcusedDay = Boolean(hasExplicitExcusedSignal || sunday);

      if (!att && work.totalLoggedMinutes === 0 && !leave && !holiday && !includeEmptyWorkingDays) {
        continue;
      }

      const attendanceNetMinutes = att ? Number(att.net_duration_minutes || 0) : 0;
      const totalLoggedMinutes = Math.max(0, work.totalLoggedMinutes);
      const accountedLoggedMinutes = Math.max(0, work.accountedLoggedMinutes);
      const gapMinutes = attendanceNetMinutes - accountedLoggedMinutes;

      let reconciliationStatus = 'reconciled';
      if (isExcusedDay && !hasCheckedInAttendance && totalLoggedMinutes === 0) {
        reconciliationStatus = 'on_leave_or_holiday';
        summary.onLeaveOrHolidayCount += 1;
      } else if (!hasCheckedInAttendance && totalLoggedMinutes > 0) {
        reconciliationStatus = 'logged_without_attendance';
        summary.loggedWithoutAttendanceCount += 1;
      } else if (hasCheckedInAttendance && totalLoggedMinutes <= 0) {
        reconciliationStatus = 'missing_task_sheet';
        summary.missingTaskSheetCount += 1;
      } else if (hasCheckedInAttendance && totalLoggedMinutes > 0) {
        if (
          attendanceNetMinutes > 0 &&
          (gapMinutes >= gapThresholdMinutes ||
            Math.abs(attendanceNetMinutes - totalLoggedMinutes) >= Math.max(gapThresholdMinutes, 120))
        ) {
          reconciliationStatus = 'large_unaccounted_gap';
          summary.largeGapCount += 1;
        } else {
          reconciliationStatus = 'reconciled';
          summary.reconciledCount += 1;
        }
      } else {
        reconciliationStatus = 'absent_no_log';
      }

      summary.totalRows += 1;
      summary.totalAttendanceMinutes += attendanceNetMinutes;
      summary.totalLoggedMinutes += totalLoggedMinutes;
      summary.totalAccountedMinutes += accountedLoggedMinutes;

      rows.push({
        employeeId: empId,
        employeeName: emp.name,
        department: emp.department || '',
        workDate: ymd,
        attendanceStatus: att?.status || (leave ? 'on_leave' : holiday ? 'holiday' : sunday ? 'weekly_off' : 'no_record'),
        attendanceNetMinutes,
        totalLoggedMinutes,
        accountedLoggedMinutes,
        ticketWorkMinutes: Math.max(0, work.ticketWorkMinutes),
        companyActivityMinutes: Math.max(0, work.companyActivityMinutes),
        unaccountedGapMinutes: gapMinutes,
        reconciliationStatus,
        holidayName: holiday?.name || null,
        leaveType: leave?.leave_type || null,
      });
    }
  }

  // Sort most recent first, anomalies surfaced clearly
  rows.sort((a, b) => (a.workDate !== b.workDate ? b.workDate.localeCompare(a.workDate) : a.employeeName.localeCompare(b.employeeName)));

  return {
    fromDate: cleanFrom,
    toDate: cleanTo,
    summary,
    rows,
  };
}
