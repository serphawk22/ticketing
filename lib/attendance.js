import crypto from 'crypto';
import { db } from './db.js';
import { toKolkata, parseUtcDate } from './businessHours.js';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  LEAVE_TYPES,
  getLeaveTypeLabel,
  getLeaveDayTypeLabel,
  formatMinutes,
  formatKolkataTime,
  calculateAttendanceStatus,
  calculateLunchDeduction,
  calculateAttendanceDurations,
} from './attendanceMeta.js';

export * from './attendanceMeta.js';

/**
 * Get current system attendance settings from the database
 */
export async function getAttendanceSettings() {
  try {
    const rows = await db.prepare('SELECT key, value FROM attendance_settings').all();
    const map = {};
    for (const r of rows) {
      map[r.key] = r.value;
    }
    return {
      work_start_time: map.work_start_time || DEFAULT_ATTENDANCE_SETTINGS.work_start_time,
      work_end_time: map.work_end_time || DEFAULT_ATTENDANCE_SETTINGS.work_end_time,
      lunch_start_time: map.lunch_start_time || DEFAULT_ATTENDANCE_SETTINGS.lunch_start_time,
      lunch_end_time: map.lunch_end_time || DEFAULT_ATTENDANCE_SETTINGS.lunch_end_time,
      grace_period_minutes: Number(map.grace_period_minutes) || DEFAULT_ATTENDANCE_SETTINGS.grace_period_minutes,
      max_grace_period_limit: Number(map.max_grace_period_limit) || DEFAULT_ATTENDANCE_SETTINGS.max_grace_period_limit,
      timezone: map.timezone || DEFAULT_ATTENDANCE_SETTINGS.timezone,
    };
  } catch (err) {
    return { ...DEFAULT_ATTENDANCE_SETTINGS };
  }
}

/**
 * Update attendance settings (Admin only)
 */
export async function updateAttendanceSettings({ settings, adminUserId }) {
  const current = await getAttendanceSettings();
  const next = { ...current, ...settings };

  const grace = Math.min(
    DEFAULT_ATTENDANCE_SETTINGS.max_grace_period_limit,
    Math.max(0, Number(next.grace_period_minutes) || 0)
  );

  const updates = [
    ['work_start_time', next.work_start_time],
    ['work_end_time', next.work_end_time],
    ['lunch_start_time', next.lunch_start_time],
    ['lunch_end_time', next.lunch_end_time],
    ['grace_period_minutes', String(grace)],
  ];

  for (const [key, value] of updates) {
    await db
      .prepare(
        `INSERT INTO attendance_settings (key, value, updated_at, updated_by)
         VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by`
      )
      .run(key, value, adminUserId || null);
  }

  return getAttendanceSettings();
}

/**
 * Check if a date falls on an official company holiday (optionally scoped to organization/workspace)
 */
export async function checkHoliday(dateInput, workspaceId = null) {
  const kd = toKolkata(dateInput);
  if (!kd) return { isHoliday: false, name: null, fallsOnSunday: false };

  const isoDate = kd.toISOString().slice(0, 10);
  const mmDd = isoDate.slice(5, 10);
  const isSunday = kd.getUTCDay() === 0;

  let query = `
    SELECT * FROM company_holidays 
    WHERE (holiday_date = ? OR (is_recurring = 1 AND holiday_date = ?))
  `;
  const params = [isoDate, mmDd];
  if (workspaceId != null) {
    query += ' AND (workspace_id = ? OR workspace_id IS NULL)';
    params.push(Number(workspaceId));
  }

  const rows = await db.prepare(query).all(...params);

  if (rows && rows.length > 0) {
    const h = rows[0];
    return {
      isHoliday: true,
      name: h.name,
      isRecurring: Boolean(h.is_recurring),
      fallsOnSunday: Boolean(h.falls_on_sunday || isSunday),
      holidayDate: isoDate,
    };
  }

  return { isHoliday: false, name: null, isRecurring: false, fallsOnSunday: isSunday };
}

/**
 * Check if date is Sunday Weekly Off in Asia/Kolkata
 */
export function isSundayWeeklyOff(dateInput) {
  const kd = toKolkata(dateInput);
  if (!kd) return false;
  return kd.getUTCDay() === 0;
}

/**
 * Fetch official company holidays (optionally filtered by workspace/company)
 */
export async function getCompanyHolidays(options = {}) {
  const wsId = typeof options === 'number' || typeof options === 'string'
    ? Number(options)
    : (options?.workspaceId != null ? Number(options.workspaceId) : null);

  if (wsId != null) {
    return db
      .prepare('SELECT * FROM company_holidays WHERE workspace_id = ? OR workspace_id IS NULL ORDER BY holiday_date ASC')
      .all(wsId);
  }
  return db.prepare('SELECT * FROM company_holidays ORDER BY holiday_date ASC').all();
}

/**
 * Add or update a company holiday
 */
export async function addCompanyHoliday({ holidayDate, name, isRecurring = 0, fallsOnSunday = 0, workspaceId = null, adminUser }) {
  if (!adminUser || adminUser.role !== 'admin') {
    throw new Error('Access denied. Only administrators can add company holidays.');
  }
  const wsId = workspaceId != null ? Number(workspaceId) : null;
  await db.prepare(`
    INSERT INTO company_holidays (holiday_date, name, is_recurring, falls_on_sunday, workspace_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(holiday_date) DO UPDATE SET
      name = excluded.name,
      is_recurring = excluded.is_recurring,
      falls_on_sunday = excluded.falls_on_sunday,
      workspace_id = excluded.workspace_id
  `).run(holidayDate.trim(), name.trim(), isRecurring ? 1 : 0, fallsOnSunday ? 1 : 0, wsId);

  return getCompanyHolidays({ workspaceId: wsId });
}

/**
 * Delete a company holiday
 */
export async function deleteCompanyHoliday({ id, workspaceId = null, adminUser }) {
  if (!adminUser || adminUser.role !== 'admin') {
    throw new Error('Access denied. Only administrators can delete company holidays.');
  }
  await db.prepare('DELETE FROM company_holidays WHERE id = ?').run(Number(id));
  return getCompanyHolidays({ workspaceId });
}

/**
 * Get today's attendance record for an employee
 */
export async function getTodayAttendance(employeeId) {
  if (!employeeId) return null;
  const todayStr = toKolkata(new Date()).toISOString().slice(0, 10);
  const record = await db
    .prepare(
      `SELECT a.*, lr.leave_type, lr.reason AS leave_reason, lr.day_type AS request_day_type
       FROM employee_attendance a
       LEFT JOIN employee_leave_requests lr ON lr.id = a.leave_request_id
       WHERE a.employee_id = ? AND a.work_date = ?`
    )
    .get(Number(employeeId), todayStr);

  return record || null;
}

/**
 * Record check-in using authoritative server timestamp (Asia/Kolkata)
 */
export async function recordCheckIn({ employeeId, userId }) {
  if (!employeeId || !userId) {
    throw new Error('Employee ID and User ID are required for check-in.');
  }

  const now = new Date();
  const workDate = toKolkata(now).toISOString().slice(0, 10);

  // Check if attendance record already exists for today
  const existing = await db
    .prepare('SELECT * FROM employee_attendance WHERE employee_id = ? AND work_date = ?')
    .get(Number(employeeId), workDate);

  if (existing) {
    // If an approved first-half leave exists and check_in_time is NULL, this is second-half arrival!
    if (existing.leave_day_type === 'first_half' && !existing.check_in_time) {
      const holidayInfo = await checkHoliday(now);
      const isSun = isSundayWeeklyOff(now);
      const isOffDay = isSun || holidayInfo.isHoliday;

      const evaluation = calculateAttendanceStatus({
        checkInDate: now,
        isSundayOrHoliday: isOffDay,
        leaveInfo: { dayType: 'first_half' },
      });

      const checkInIso = now.toISOString();

      await db
        .prepare(
          `UPDATE employee_attendance
           SET check_in_time = ?, checkout_source = 'user_action',
               status = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(checkInIso, evaluation.status, existing.id);

      return db.prepare('SELECT * FROM employee_attendance WHERE id = ?').get(existing.id);
    }

    if (existing.check_in_time) {
      throw new Error('You have already checked in today.');
    }

    if (existing.status === 'on_leave') {
      throw new Error('You are on approved full-day leave today. Please contact Admin if you wish to adjust your leave.');
    }
  }

  // Check if today has an approved second-half leave
  const approvedLeaveToday = await db
    .prepare(
      `SELECT * FROM employee_leave_requests
       WHERE employee_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?`
    )
    .get(Number(employeeId), workDate, workDate);

  const holidayInfo = await checkHoliday(now);
  const isSun = isSundayWeeklyOff(now);
  const isOffDay = isSun || holidayInfo.isHoliday;

  const leaveInfo = approvedLeaveToday ? { dayType: approvedLeaveToday.day_type } : null;

  const evaluation = calculateAttendanceStatus({
    checkInDate: now,
    isSundayOrHoliday: isOffDay,
    leaveInfo,
  });

  const checkInIso = now.toISOString();
  const settings = await getAttendanceSettings();

  const info = await db
    .prepare(
      `INSERT INTO employee_attendance (
        employee_id, user_id, work_date, scheduled_start_time, scheduled_end_time,
        check_in_time, check_out_time, checkout_source, is_estimated,
        gross_duration_minutes, break_duration_minutes, net_duration_minutes,
        status, original_status, is_manually_adjusted, requires_admin_review, notes,
        leave_request_id, leave_day_type
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'user_action', 0, 0, 0, 0, ?, ?, 0, 0, ?, ?, ?)`
    )
    .run(
      Number(employeeId),
      Number(userId),
      workDate,
      settings.work_start_time,
      settings.work_end_time,
      checkInIso,
      evaluation.status,
      evaluation.status,
      holidayInfo.isHoliday ? `Holiday: ${holidayInfo.name}` : isSun ? 'Sunday Weekly Off' : '',
      approvedLeaveToday ? approvedLeaveToday.id : null,
      approvedLeaveToday ? approvedLeaveToday.day_type : null
    );

  return db.prepare('SELECT * FROM employee_attendance WHERE id = ?').get(info.lastInsertRowid);
}

/**
 * Record check-out using authoritative server timestamp
 */
export async function recordCheckOut({ employeeId, userId }) {
  if (!employeeId || !userId) {
    throw new Error('Employee ID and User ID are required for check-out.');
  }

  const now = new Date();
  const workDate = toKolkata(now).toISOString().slice(0, 10);

  const existing = await db
    .prepare('SELECT * FROM employee_attendance WHERE employee_id = ? AND work_date = ?')
    .get(Number(employeeId), workDate);

  if (!existing || !existing.check_in_time) {
    throw new Error('Cannot check out before checking in.');
  }

  if (existing.check_out_time) {
    throw new Error('You have already checked out for today.');
  }

  const checkOutIso = now.toISOString();
  const durations = calculateAttendanceDurations(existing.check_in_time, checkOutIso);

  await db
    .prepare(
      `UPDATE employee_attendance
       SET check_out_time = ?, checkout_source = 'user_action', is_estimated = 0,
           gross_duration_minutes = ?, break_duration_minutes = ?, net_duration_minutes = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(
      checkOutIso,
      durations.grossMinutes,
      durations.breakMinutes,
      durations.netMinutes,
      existing.id
    );

  return db.prepare('SELECT * FROM employee_attendance WHERE id = ?').get(existing.id);
}

/**
 * Reconcile unclosed attendance records using latest Task Sheet submission timestamp.
 */
export async function reconcileFallbackAttendance() {
  const unclosed = await db
    .prepare(
      `SELECT a.* FROM employee_attendance a
       WHERE a.check_in_time IS NOT NULL AND a.check_out_time IS NULL
         AND a.work_date < date('now', '+05:30')`
    )
    .all();

  let reconciledCount = 0;
  let flaggedReviewCount = 0;

  for (const record of unclosed) {
    const submissions = await db
      .prepare(
        `SELECT created_at FROM task_sheet_submissions
         WHERE submitted_by = ? AND date(created_at, '+05:30') = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .all(record.user_id, record.work_date);

    if (submissions && submissions.length > 0) {
      const taskSheetTime = submissions[0].created_at;
      const inDate = parseUtcDate(record.check_in_time);
      const subDate = parseUtcDate(taskSheetTime);

      if (subDate && inDate && subDate.getTime() > inDate.getTime()) {
        const durations = calculateAttendanceDurations(record.check_in_time, taskSheetTime);
        await db
          .prepare(
            `UPDATE employee_attendance
             SET check_out_time = ?, checkout_source = 'task_sheet_submission', is_estimated = 1,
                 gross_duration_minutes = ?, break_duration_minutes = ?, net_duration_minutes = ?,
                 updated_at = datetime('now')
             WHERE id = ?`
          )
          .run(
            taskSheetTime,
            durations.grossMinutes,
            durations.breakMinutes,
            durations.netMinutes,
            record.id
          );
        reconciledCount += 1;
        continue;
      }
    }

    await db
      .prepare(
        `UPDATE employee_attendance
         SET requires_admin_review = 1,
             notes = COALESCE(notes, '') || ' [Missing checkout · Pending Admin review]',
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(record.id);
    flaggedReviewCount += 1;
  }

  return { reconciledCount, flaggedReviewCount };
}

export const reconcileUnclosedAttendance = reconcileFallbackAttendance;

/**
 * Admin correction and regularization for any date (past or present).
 */
export async function adminAdjustAttendance({
  attendanceId = null,
  employeeId,
  workDate,
  status,
  checkInTime = null,
  checkOutTime = null,
  reason,
  adminUser,
}) {
  if (!adminUser || adminUser.role !== 'admin') {
    throw new Error('Access denied. Only authorized administrators can modify attendance records.');
  }

  if (!reason || reason.trim().length < 5) {
    throw new Error('A valid reason of at least 5 characters is required for manual attendance adjustments.');
  }

  const validStatuses = ['present', 'late', 'half_day', 'absent', 'on_leave'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${validStatuses.join(', ')}`);
  }

  let record = null;
  if (attendanceId) {
    record = await db.prepare('SELECT * FROM employee_attendance WHERE id = ?').get(Number(attendanceId));
  } else if (employeeId && workDate) {
    record = await db
      .prepare('SELECT * FROM employee_attendance WHERE employee_id = ? AND work_date = ?')
      .get(Number(employeeId), workDate);
  }

  const adminName = adminUser.name || 'Admin';

  if (record) {
    const oldStatus = record.status;
    const oldCheckIn = record.check_in_time;
    const oldCheckOut = record.check_out_time;

    const newCheckIn = (checkInTime !== undefined && checkInTime !== null && checkInTime !== '')
      ? new Date(checkInTime).toISOString()
      : (status === 'on_leave' || status === 'absent' ? null : record.check_in_time);

    const newCheckOut = (checkOutTime !== undefined && checkOutTime !== null && checkOutTime !== '')
      ? new Date(checkOutTime).toISOString()
      : (status === 'on_leave' || status === 'absent' ? null : record.check_out_time);

    const durations = (newCheckIn && newCheckOut && status !== 'on_leave' && status !== 'absent')
      ? calculateAttendanceDurations(newCheckIn, newCheckOut)
      : { grossMinutes: 0, breakMinutes: 0, netMinutes: 0 };

    await db
      .prepare(
        `UPDATE employee_attendance
         SET status = ?,
             check_in_time = ?,
             check_out_time = ?,
             original_check_in_time = COALESCE(original_check_in_time, ?),
             original_check_out_time = COALESCE(original_check_out_time, ?),
             original_status = COALESCE(original_status, ?),
             checkout_source = 'admin_adjustment',
             gross_duration_minutes = ?,
             break_duration_minutes = ?,
             net_duration_minutes = ?,
             is_manually_adjusted = 1,
             adjusted_by = ?,
             adjustment_reason = ?,
             requires_admin_review = 0,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        status,
        newCheckIn,
        newCheckOut,
        oldCheckIn,
        oldCheckOut,
        oldStatus,
        durations.grossMinutes,
        durations.breakMinutes,
        durations.netMinutes,
        adminUser.id,
        reason.trim(),
        record.id
      );

    await db
      .prepare(
        `INSERT INTO attendance_audit_logs (
          attendance_id, employee_id, admin_id, admin_name, action,
          field_changed, old_value, new_value, reason
        ) VALUES (?, ?, ?, ?, 'admin_manual_correction', 'status_and_timings', ?, ?, ?)`
      )
      .run(
        record.id,
        record.employee_id,
        adminUser.id,
        adminName,
        JSON.stringify({ status: oldStatus, checkIn: oldCheckIn, checkOut: oldCheckOut }),
        JSON.stringify({ status, checkIn: newCheckIn, checkOut: newCheckOut }),
        reason.trim()
      );

    return db.prepare('SELECT * FROM employee_attendance WHERE id = ?').get(record.id);
  } else {
    if (!employeeId || !workDate) {
      throw new Error('Employee ID and Work Date are required to regularize unrecorded attendance.');
    }

    const emp = await db.prepare('SELECT id, user_id FROM employees WHERE id = ?').get(Number(employeeId));
    if (!emp) throw new Error('Employee not found.');

    const targetUserId = emp.user_id || adminUser.id;
    const settings = await getAttendanceSettings();

    const inIso = (status === 'on_leave' || status === 'absent')
      ? (checkInTime ? new Date(checkInTime).toISOString() : null)
      : (checkInTime ? new Date(checkInTime).toISOString() : new Date(`${workDate}T09:00:00+05:30`).toISOString());

    const outIso = (status === 'on_leave' || status === 'absent')
      ? (checkOutTime ? new Date(checkOutTime).toISOString() : null)
      : (checkOutTime ? new Date(checkOutTime).toISOString() : new Date(`${workDate}T17:00:00+05:30`).toISOString());

    const durations = (inIso && outIso && status !== 'on_leave' && status !== 'absent')
      ? calculateAttendanceDurations(inIso, outIso)
      : { grossMinutes: 0, breakMinutes: 0, netMinutes: 0 };

    const info = await db
      .prepare(
        `INSERT INTO employee_attendance (
          employee_id, user_id, work_date, scheduled_start_time, scheduled_end_time,
          check_in_time, check_out_time, checkout_source, is_estimated,
          gross_duration_minutes, break_duration_minutes, net_duration_minutes,
          status, original_status, is_manually_adjusted, adjusted_by, adjustment_reason,
          requires_admin_review, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'admin_adjustment', 0, ?, ?, ?, ?, 'unrecorded', 1, ?, ?, 0, ?)`
      )
      .run(
        emp.id,
        targetUserId,
        workDate,
        settings.work_start_time,
        settings.work_end_time,
        inIso,
        outIso,
        durations.grossMinutes,
        durations.breakMinutes,
        durations.netMinutes,
        status,
        adminUser.id,
        reason.trim(),
        `Regularized by Admin: ${reason.trim()}`
      );

    await db
      .prepare(
        `INSERT INTO attendance_audit_logs (
          attendance_id, employee_id, admin_id, admin_name, action,
          field_changed, old_value, new_value, reason
        ) VALUES (?, ?, ?, ?, 'admin_regularization', 'status', 'unrecorded', ?, ?)`
      )
      .run(
        info.lastInsertRowid,
        emp.id,
        adminUser.id,
        adminName,
        status,
        reason.trim()
      );

    return db.prepare('SELECT * FROM employee_attendance WHERE id = ?').get(info.lastInsertRowid);
  }
}

/**
 * Fetch personal attendance history for an employee within a date range
 */
export async function getEmployeeAttendanceHistory({
  employeeId,
  startDate,
  endDate,
}) {
  if (!employeeId) return { records: [], summary: {} };

  const records = await db
    .prepare(
      `SELECT a.*, lr.leave_type, lr.reason AS leave_reason, lr.day_type AS request_day_type
       FROM employee_attendance a
       LEFT JOIN employee_leave_requests lr ON lr.id = a.leave_request_id
       WHERE a.employee_id = ? AND a.work_date >= ? AND a.work_date <= ?
       ORDER BY a.work_date DESC`
    )
    .all(Number(employeeId), startDate, endDate);

  let presentCount = 0;
  let lateCount = 0;
  let halfDayCount = 0;
  let confirmedAbsentCount = 0;
  let onLeaveCount = 0;
  let totalNetMinutes = 0;

  for (const r of records) {
    if (r.status === 'present') presentCount += 1;
    else if (r.status === 'late') lateCount += 1;
    else if (r.status === 'half_day') halfDayCount += 1;
    else if (r.status === 'absent') confirmedAbsentCount += 1;
    else if (r.status === 'on_leave') {
      onLeaveCount += (r.leave_day_type === 'first_half' || r.leave_day_type === 'second_half' ? 0.5 : 1.0);
    }
    totalNetMinutes += Number(r.net_duration_minutes) || 0;
  }

  return {
    records,
    summary: {
      presentCount,
      lateCount,
      halfDayCount,
      confirmedAbsentCount,
      onLeaveCount,
      totalHours: (totalNetMinutes / 60).toFixed(1),
    },
  };
}

/**
 * Get workforce attendance roster for a specific date (Admin View)
 */
export async function getWorkforceAttendanceForDate({ workDate, department = 'all', search = '' }) {
  let empSql = 'SELECT id, name, email, department, title, active, created_at FROM employees WHERE 1=1';
  const params = [];

  if (department && department !== 'all') {
    empSql += ' AND department = ?';
    params.push(department);
  }
  if (search && search.trim()) {
    empSql += ' AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ?)';
    const term = `%${search.trim().toLowerCase()}%`;
    params.push(term, term);
  }
  empSql += ' ORDER BY active DESC, name ASC';

  const employees = await db.prepare(empSql).all(...params);
  const attendanceRows = await db
    .prepare(
      `SELECT a.*, lr.leave_type, lr.reason AS leave_reason, lr.day_type AS request_day_type
       FROM employee_attendance a
       LEFT JOIN employee_leave_requests lr ON lr.id = a.leave_request_id
       WHERE a.work_date = ?`
    )
    .all(workDate);

  const attMap = new Map();
  for (const a of attendanceRows) {
    attMap.set(Number(a.employee_id), a);
  }

  const holidayInfo = await checkHoliday(workDate);
  const isSun = isSundayWeeklyOff(workDate);
  const todayStr = toKolkata(new Date()).toISOString().slice(0, 10);
  const isPastDate = workDate < todayStr;

  const roster = [];
  let presentTotal = 0;
  let lateTotal = 0;
  let halfDayTotal = 0;
  let confirmedAbsentTotal = 0;
  let onLeaveTotal = 0;
  let unrecordedTotal = 0;

  for (const emp of employees) {
    const att = attMap.get(emp.id) || null;
    const empJoinDate = emp.created_at ? emp.created_at.slice(0, 10) : '2000-01-01';
    const isEmployedOnDate = empJoinDate <= workDate;

    let displayStatus = 'unrecorded';
    if (att) {
      displayStatus = att.status;
      if (att.status === 'present') presentTotal += 1;
      else if (att.status === 'late') lateTotal += 1;
      else if (att.status === 'half_day') halfDayTotal += 1;
      else if (att.status === 'absent') confirmedAbsentTotal += 1;
      else if (att.status === 'on_leave') onLeaveTotal += 1;
    } else if (!isEmployedOnDate) {
      displayStatus = 'not_employed';
    } else if (isSun) {
      displayStatus = 'weekly_off';
    } else if (holidayInfo.isHoliday) {
      displayStatus = 'holiday';
    } else if (isPastDate) {
      displayStatus = 'unrecorded';
      unrecordedTotal += 1;
    } else {
      displayStatus = 'not_checked_in';
    }

    roster.push({
      employee: emp,
      attendance: att,
      displayStatus,
      isEmployedOnDate,
      isHoliday: holidayInfo.isHoliday,
      holidayName: holidayInfo.name,
      isWeeklyOff: isSun,
    });
  }

  return {
    workDate,
    isSunday: isSun,
    holiday: holidayInfo,
    counts: {
      totalEmployees: employees.length,
      presentTotal,
      lateTotal,
      halfDayTotal,
      confirmedAbsentTotal,
      onLeaveTotal,
      unrecordedTotal,
    },
    roster,
  };
}

/**
 * Fetch audit logs for a specific attendance record
 */
export async function getAttendanceAuditLogs(attendanceId) {
  if (!attendanceId) return [];
  return db
    .prepare('SELECT * FROM attendance_audit_logs WHERE attendance_id = ? ORDER BY id DESC')
    .all(Number(attendanceId));
}

// =========================================================================
// LEAVE MANAGEMENT DOMAIN LOGIC
// =========================================================================

/**
 * Calculate actual working days for a requested leave date range.
 * Automatically excludes Sundays and company holidays from leave consumption.
 */
export async function calculateLeaveWorkingDays(startDate, endDate, dayType = 'full_day', workspaceId = null) {
  if (!startDate || !endDate) {
    throw new Error('Start date and End date are required.');
  }

  if (startDate > endDate) {
    throw new Error('Start date cannot be after end date.');
  }

  if ((dayType === 'first_half' || dayType === 'second_half') && startDate !== endDate) {
    throw new Error('Half-day leave requests must be for a single date.');
  }

  let cur = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  let totalWorkingDays = 0;
  const workingDates = [];
  const holidayDates = [];
  const sundayDates = [];

  while (cur.getTime() <= end.getTime()) {
    const dateStr = cur.toISOString().slice(0, 10);
    const dayOfWeek = cur.getUTCDay();
    const isSun = dayOfWeek === 0;
    const holiday = await checkHoliday(cur, workspaceId);

    if (isSun) {
      sundayDates.push({ date: dateStr });
    } else if (holiday.isHoliday) {
      holidayDates.push({ date: dateStr, name: holiday.name });
    } else {
      const weight = (dayType === 'first_half' || dayType === 'second_half') ? 0.5 : 1.0;
      totalWorkingDays += weight;
      workingDates.push({ date: dateStr, weight });
    }

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return {
    totalWorkingDays,
    workingDates,
    holidayDates,
    sundayDates,
  };
}

/**
 * Submit a new leave request (Employee Action, validated against Organization Leave Policy)
 */
export async function submitLeaveRequest({
  employeeId,
  userId,
  leaveType,
  dayType = 'full_day',
  startDate,
  endDate,
  reason,
}) {
  if (!employeeId || !userId) {
    throw new Error('Employee ID and User ID are required.');
  }

  const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(employeeId));
  if (!emp) {
    throw new Error(`Employee #${employeeId} not found.`);
  }

  const wsId = await resolveWorkspaceId(emp.workspace_id);
  const orgPolicy = await getOrganizationLeavePolicy(wsId);
  const empType = emp.employment_type || 'full_time';

  // Check category configuration in this organization
  const category = orgPolicy.categories.find(c => c.code === leaveType);
  if (!category) {
    if (leaveType !== 'unpaid' && leaveType !== 'other') {
      throw new Error(`Invalid or disabled leave type "${leaveType}".`);
    }
  } else {
    if (!category.is_active) {
      if (leaveType === 'optional') {
        throw new Error('Optional Leave is not currently enabled by company policy.');
      }
      throw new Error(`Leave category "${category.name}" is currently disabled by organization policy.`);
    }

    if (!category.eligible_employment_types.includes(empType)) {
      if (leaveType === 'casual') {
        throw new Error(`Casual Leave is only available to Full-Time Employees (FTEs). Employees with employment category "${empType}" are not eligible.`);
      }
      throw new Error(`${category.name} is not available to employment category "${empType}".`);
    }

    // Past date check
    const now = new Date();
    const todayStr = toKolkata(now).toISOString().slice(0, 10);
    const allowsPast = category.allow_past_dates || leaveType === 'sick';
    if (!allowsPast && startDate < todayStr) {
      if (leaveType === 'casual') {
        throw new Error('Except for Sick Leave, leave cannot be requested for a previous date.');
      }
      throw new Error(`Except where permitted, leave cannot be requested for a previous date.`);
    }

    // Advance notice check
    if (category.min_advance_days > 0) {
      const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
      const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
      const diffDays = Math.ceil((startMs - todayMs) / 86400000);
      if (diffDays < category.min_advance_days) {
        throw new Error(`${category.name} requires at least ${category.min_advance_days} days advance notice.`);
      }
    }

    // Half-day and multi-day checks
    if ((dayType === 'first_half' || dayType === 'second_half') && !category.allow_half_day) {
      throw new Error(`Half-day leave requests are not permitted for ${category.name}.`);
    }
    if (startDate !== endDate && !category.allow_multi_day) {
      throw new Error(`Multi-day leave requests are not permitted for ${category.name}.`);
    }
  }

  const validDayTypes = ['full_day', 'first_half', 'second_half'];
  if (!validDayTypes.includes(dayType)) {
    throw new Error(`Invalid day type "${dayType}".`);
  }

  if (!reason || reason.trim().length < 5) {
    throw new Error('A reason of at least 5 characters is required for leave requests.');
  }

  // Check overlapping active leave requests for this employee
  const existingOverlap = await db
    .prepare(
      `SELECT * FROM employee_leave_requests
       WHERE employee_id = ? AND status IN ('pending', 'approved')
         AND NOT (end_date < ? OR start_date > ?)`
    )
    .get(Number(employeeId), startDate, endDate);

  if (existingOverlap) {
    throw new Error(
      `You already have a ${existingOverlap.status} leave request (${existingOverlap.start_date} to ${existingOverlap.end_date}) overlapping the selected dates.`
    );
  }

  const calculation = await calculateLeaveWorkingDays(startDate, endDate, dayType, wsId);
  if (calculation.totalWorkingDays === 0) {
    throw new Error(
      'Selected date range contains no working days. All selected dates are Sundays or official company holidays.'
    );
  }

  // Check balance and LOP rules
  if (category && category.is_paid && !category.allow_lop_beyond_balance) {
    const balances = await getEmployeeLeaveBalances({ employeeId, dateInput: startDate });
    const rem = balances.categories[leaveType]?.remainingBalance ?? 0;
    if (calculation.totalWorkingDays > rem) {
      throw new Error(`Requested days (${calculation.totalWorkingDays}) exceed available ${category.name} balance (${rem} days) and LOP beyond balance is not permitted under organization policy.`);
    }
  }

  const info = await db
    .prepare(
      `INSERT INTO employee_leave_requests (
        employee_id, user_id, leave_type, day_type, start_date, end_date,
        total_working_days, reason, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(
      Number(employeeId),
      Number(userId),
      leaveType,
      dayType,
      startDate,
      endDate,
      calculation.totalWorkingDays,
      reason.trim()
    );

  return db.prepare('SELECT * FROM employee_leave_requests WHERE id = ?').get(info.lastInsertRowid);
}

/**
 * Detect existing attendance records and genuine punches on requested leave dates
 */
export async function detectLeaveConflicts({ employeeId, startDate, endDate }) {
  const records = await db
    .prepare(
      `SELECT * FROM employee_attendance
       WHERE employee_id = ? AND work_date >= ? AND work_date <= ?`
    )
    .all(Number(employeeId), startDate, endDate);

  const conflicts = [];
  for (const r of records) {
    if (r.check_in_time) {
      conflicts.push({
        date: r.work_date,
        attendanceId: r.id,
        status: r.status,
        checkInTime: r.check_in_time,
        checkOutTime: r.check_out_time,
        netDurationMinutes: r.net_duration_minutes,
      });
    }
  }

  return conflicts;
}

/**
 * Cancel a leave request.
 * Non-admins can only cancel their own pending requests.
 * Admins can cancel approved leaves with safe reversal.
 */
export async function cancelLeaveRequest({
  requestId,
  employeeId,
  adminUser = null,
  cancelReason = 'Cancelled by user',
}) {
  const request = await db
    .prepare('SELECT * FROM employee_leave_requests WHERE id = ?')
    .get(Number(requestId));

  if (!request) {
    throw new Error('Leave request not found.');
  }

  const isAdmin = Boolean(adminUser && adminUser.role === 'admin');

  // Authorization check
  if (!isAdmin) {
    if (Number(request.employee_id) !== Number(employeeId)) {
      throw new Error('Access denied. You can only cancel your own leave requests.');
    }
    if (request.status !== 'pending') {
      throw new Error(`Cannot cancel a leave request with status "${request.status}". Only pending requests can be cancelled by employees.`);
    }
  }

  if (request.status === 'cancelled') {
    return request;
  }

  // If approved leave is being cancelled by Admin, perform safe reversal
  if (request.status === 'approved') {
    const associatedAttendance = await db
      .prepare('SELECT * FROM employee_attendance WHERE leave_request_id = ?')
      .all(request.id);

    for (const att of associatedAttendance) {
      // If record has punches or was independently adjusted, flag for review instead of deleting
      if (att.check_in_time || att.is_manually_adjusted === 1) {
        await db
          .prepare(
            `UPDATE employee_attendance
             SET leave_request_id = NULL,
                 requires_admin_review = 1,
                 notes = COALESCE(notes, '') || ' [Leave cancelled · Retained due to recorded punches/edits]',
                 updated_at = datetime('now')
             WHERE id = ?`
          )
          .run(att.id);

        await db
          .prepare(
            `INSERT INTO attendance_audit_logs (
              attendance_id, employee_id, admin_id, admin_name, action,
              field_changed, old_value, new_value, reason
            ) VALUES (?, ?, ?, ?, 'leave_cancellation_reversal', 'leave_request_id', ?, NULL, ?)`
          )
          .run(
            att.id,
            request.employee_id,
            adminUser.id,
            adminUser.name || 'Admin',
            String(request.id),
            cancelReason
          );
      } else {
        // Pure synthetic leave record: cleanly remove
        await db.prepare('DELETE FROM attendance_audit_logs WHERE attendance_id = ?').run(att.id);
        await db.prepare('DELETE FROM employee_attendance WHERE id = ?').run(att.id);
      }
    }
  }

  await db
    .prepare(
      `UPDATE employee_leave_requests
       SET status = 'cancelled', reviewer_notes = COALESCE(reviewer_notes, '') || ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(` [Cancellation: ${cancelReason}]`, request.id);

  return db.prepare('SELECT * FROM employee_leave_requests WHERE id = ?').get(request.id);
}

/**
 * Process a leave request: Approve or Reject (Admin only, Transactional)
 */
export async function adminProcessLeaveRequest({
  requestId,
  action, // 'approve' | 'reject'
  adminUser,
  conflictResolutions = {}, // e.g. { '2026-10-24': 'keep_attendance' | 'convert_half_day' | 'override' }
  reviewerNotes = '',
  authorizedPaidDays = null,
  authorizedLopDays = null,
}) {
  if (!adminUser || adminUser.role !== 'admin') {
    throw new Error('Access denied. Only authorized administrators can approve or reject leave requests.');
  }

  if (action !== 'approve' && action !== 'reject') {
    throw new Error('Invalid action. Must be "approve" or "reject".');
  }

  const request = await db
    .prepare('SELECT * FROM employee_leave_requests WHERE id = ?')
    .get(Number(requestId));

  if (!request) {
    throw new Error('Leave request not found.');
  }

  if (request.status !== 'pending') {
    throw new Error(`Cannot process request. Current status is already "${request.status}".`);
  }

  const adminName = adminUser.name || 'Admin';

  if (action === 'reject') {
    await db
      .prepare(
        `UPDATE employee_leave_requests
         SET status = 'rejected', reviewed_by = ?, reviewer_notes = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(adminUser.id, reviewerNotes.trim() || 'Rejected by Admin', request.id);

    return db.prepare('SELECT * FROM employee_leave_requests WHERE id = ?').get(request.id);
  }

  // ACTION: APPROVE (Execute transactionally)
  const calculation = await calculateLeaveWorkingDays(request.start_date, request.end_date, request.day_type);
  const conflicts = await detectLeaveConflicts({
    employeeId: request.employee_id,
    startDate: request.start_date,
    endDate: request.end_date,
  });

  const conflictMap = new Map(conflicts.map((c) => [c.date, c]));

  // Check unaddressed conflicts
  for (const c of conflicts) {
    if (!conflictResolutions[c.date]) {
      throw new Error(`Attendance conflict detected on ${c.date}. Please specify a conflict resolution option for this date.`);
    }
  }

  let remainingWorkingDays = calculation.totalWorkingDays;
  const approvedDates = [];
  const excludedDates = [];

  // Calculate available balance to determine paid vs Loss of Pay (LOP) days
  let availBalance = 0;
  try {
    const balances = await getEmployeeLeaveBalances({
      employeeId: request.employee_id,
      dateInput: request.start_date,
    });
    availBalance = balances.categories[request.leave_type]?.remainingBalance ?? 0;
  } catch {
    availBalance = 0;
  }

  // Deduct excluded dates upfront from working days count
  for (const item of calculation.workingDates) {
    const dateStr = item.date;
    const conflict = conflictMap.get(dateStr);
    const resolution = conflict ? conflictResolutions[dateStr] : 'none';
    if (resolution === 'keep_attendance') {
      excludedDates.push(dateStr);
      remainingWorkingDays -= item.weight;
    } else if (resolution === 'convert_half_day') {
      remainingWorkingDays -= 0.5;
    }
  }

  let finalPaidDays = 0;
  let finalLopDays = 0;
  if (authorizedPaidDays !== undefined && authorizedPaidDays !== null) {
    finalPaidDays = Number(authorizedPaidDays);
    finalLopDays = Number(authorizedLopDays ?? Math.max(0, remainingWorkingDays - finalPaidDays));
  } else {
    finalPaidDays = Math.min(remainingWorkingDays, Math.max(0, availBalance));
    finalLopDays = Math.max(0, remainingWorkingDays - finalPaidDays);
  }

  let remainingPaidQuota = finalPaidDays;

  // Begin transaction
  await db.exec('BEGIN TRANSACTION;');
  try {
    for (const item of calculation.workingDates) {
      const dateStr = item.date;
      const conflict = conflictMap.get(dateStr);
      const resolution = conflict ? conflictResolutions[dateStr] : 'none';

      if (resolution === 'keep_attendance') {
        if (conflict) {
          await db
            .prepare(
              `INSERT INTO attendance_audit_logs (
                attendance_id, employee_id, admin_id, admin_name, action,
                field_changed, old_value, new_value, reason
              ) VALUES (?, ?, ?, ?, 'leave_conflict_keep_attendance', 'leave_exclusion', ?, ?, ?)`
            )
            .run(
              conflict.attendanceId,
              request.employee_id,
              adminUser.id,
              adminName,
              dateStr,
              'retained_actual_punches',
              reviewerNotes || 'Kept genuine attendance punches, excluded date from leave'
            );
        }
        continue;
      }

      let dateWeight = (resolution === 'convert_half_day' ? 0.5 : (request.day_type === 'full_day' ? 1.0 : 0.5));
      let datePaid = 0;
      let dateLop = 0;
      if (remainingPaidQuota >= dateWeight) {
        datePaid = dateWeight;
        dateLop = 0;
        remainingPaidQuota -= dateWeight;
      } else if (remainingPaidQuota > 0) {
        datePaid = remainingPaidQuota;
        dateLop = dateWeight - remainingPaidQuota;
        remainingPaidQuota = 0;
      } else {
        datePaid = 0;
        dateLop = dateWeight;
      }
      const dateIsLop = dateLop > 0 ? 1 : 0;

      if (resolution === 'convert_half_day') {
        // Option 2: Convert to Half-Day Leave
        approvedDates.push(dateStr);

        if (conflict) {
          await db
            .prepare(
              `UPDATE employee_attendance
               SET status = 'half_day', leave_request_id = ?, leave_day_type = 'second_half',
                   is_manually_adjusted = 1, adjusted_by = ?, adjustment_reason = ?,
                   paid_leave_days = ?, lop_days = ?, is_lop = ?, updated_at = datetime('now')
               WHERE id = ?`
            )
            .run(request.id, adminUser.id, 'Converted to half-day leave with worked punches preserved', datePaid, dateLop, dateIsLop, conflict.attendanceId);

          await db
            .prepare(
              `INSERT INTO attendance_audit_logs (
                attendance_id, employee_id, admin_id, admin_name, action,
                field_changed, old_value, new_value, reason
              ) VALUES (?, ?, ?, ?, 'leave_conflict_convert_half_day', 'status_and_leave', ?, 'half_day', ?)`
            )
            .run(
              conflict.attendanceId,
              request.employee_id,
              adminUser.id,
              adminName,
              conflict.status,
              reviewerNotes || 'Converted to half-day leave with worked punches preserved'
            );
        }
        continue;
      }

      // Option 3: Override (or clean date with no conflict)
      approvedDates.push(dateStr);

      const existingRecord = await db
        .prepare('SELECT * FROM employee_attendance WHERE employee_id = ? AND work_date = ?')
        .get(Number(request.employee_id), dateStr);

      const noteText = dateIsLop && datePaid > 0
        ? `Approved ${getLeaveTypeLabel(request.leave_type)} (${datePaid}d Paid + ${dateLop}d LOP): ${request.reason}`
        : dateIsLop
        ? `Approved ${getLeaveTypeLabel(request.leave_type)} (Loss of Pay): ${request.reason}`
        : `Approved ${getLeaveTypeLabel(request.leave_type)}: ${request.reason}`;

      if (existingRecord) {
        // Archive genuine punches into audit log if overriding
        if (existingRecord.check_in_time) {
          await db
            .prepare(
              `INSERT INTO attendance_audit_logs (
                attendance_id, employee_id, admin_id, admin_name, action,
                field_changed, old_value, new_value, reason
              ) VALUES (?, ?, ?, ?, 'leave_conflict_override', 'status_and_punches', ?, 'on_leave', ?)`
            )
            .run(
              existingRecord.id,
              request.employee_id,
              adminUser.id,
              adminName,
              JSON.stringify({
                checkIn: existingRecord.check_in_time,
                checkOut: existingRecord.check_out_time,
                status: existingRecord.status,
              }),
              reviewerNotes || 'Admin override: Marked on_leave despite prior punch'
            );
        }

        await db
          .prepare(
            `UPDATE employee_attendance
             SET status = ?, leave_request_id = ?, leave_day_type = ?,
                 check_in_time = NULL, check_out_time = NULL, checkout_source = 'leave_approval',
                 gross_duration_minutes = 0, break_duration_minutes = 0, net_duration_minutes = 0,
                 paid_leave_days = ?, lop_days = ?, is_lop = ?,
                 notes = ?, updated_at = datetime('now')
             WHERE id = ?`
          )
          .run(
            request.day_type === 'full_day' ? 'on_leave' : 'half_day',
            request.id,
            request.day_type,
            datePaid,
            dateLop,
            dateIsLop,
            noteText,
            existingRecord.id
          );
      } else {
        const settings = await getAttendanceSettings();
        await db
          .prepare(
            `INSERT INTO employee_attendance (
              employee_id, user_id, work_date, scheduled_start_time, scheduled_end_time,
              check_in_time, check_out_time, checkout_source, is_estimated,
              gross_duration_minutes, break_duration_minutes, net_duration_minutes,
              status, original_status, is_manually_adjusted, requires_admin_review, notes,
              leave_request_id, leave_day_type, paid_leave_days, lop_days, is_lop
            ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'leave_approval', 0, 0, 0, 0, ?, 'on_leave', 0, 0, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            request.employee_id,
            request.user_id,
            dateStr,
            settings.work_start_time,
            settings.work_end_time,
            request.day_type === 'full_day' ? 'on_leave' : 'half_day',
            noteText,
            request.id,
            request.day_type,
            datePaid,
            dateLop,
            dateIsLop
          );
      }
    }

    // Final state of leave request:
    if (remainingWorkingDays <= 0) {
      await db
        .prepare(
          `UPDATE employee_leave_requests
           SET status = 'cancelled', total_working_days = 0, paid_days = 0, lop_days = 0, reviewed_by = ?,
               reviewer_notes = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(
          adminUser.id,
          'All requested dates had active attendance; leave cancelled with 0 days deducted',
          request.id
        );
    } else {
      const notes = [
        reviewerNotes.trim(),
        finalLopDays > 0 ? `[Paid: ${finalPaidDays}d, Loss of Pay: ${finalLopDays}d]` : '',
        excludedDates.length > 0 ? `Excluded dates: ${excludedDates.join(', ')}` : '',
      ].filter(Boolean).join(' | ');

      await db
        .prepare(
          `UPDATE employee_leave_requests
           SET status = 'approved', total_working_days = ?, paid_days = ?, lop_days = ?, reviewed_by = ?,
               reviewer_notes = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(remainingWorkingDays, finalPaidDays, finalLopDays, adminUser.id, notes || 'Approved by Admin', request.id);
    }

    await db.exec('COMMIT;');
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }

  return db.prepare('SELECT * FROM employee_leave_requests WHERE id = ?').get(request.id);
}

/**
 * Fetch leave requests submitted by an employee
 */
export async function getEmployeeLeaveRequests(employeeId) {
  if (!employeeId) return [];
  return db
    .prepare(
      `SELECT r.*, u.name AS reviewer_name
       FROM employee_leave_requests r
       LEFT JOIN users u ON u.id = r.reviewed_by
       WHERE r.employee_id = ?
       ORDER BY r.id DESC`
    )
    .all(Number(employeeId));
}

/**
 * Fetch all leave requests (Admin View)
 */
export async function getAllLeaveRequests({ status = 'all', employeeId = null }) {
  let sql = `
    SELECT r.*, e.name AS employee_name, e.department, e.email AS employee_email, u.name AS reviewer_name
    FROM employee_leave_requests r
    JOIN employees e ON e.id = r.employee_id
    LEFT JOIN users u ON u.id = r.reviewed_by
    WHERE 1=1
  `;
  const params = [];

  if (status && status !== 'all') {
    sql += ' AND r.status = ?';
    params.push(status);
  }

  if (employeeId && employeeId !== 'all') {
    sql += ' AND r.employee_id = ?';
    params.push(Number(employeeId));
  }

  sql += ' ORDER BY CASE WHEN r.status = \'pending\' THEN 0 ELSE 1 END, r.id DESC';

  return db.prepare(sql).all(...params);
}

// =========================================================================
// LEAVE BALANCE ENGINE & FINANCIAL YEAR LIFECYCLE
// =========================================================================

/**
 * Get the company financial year for a given date.
 * Default start month is 4 (April), meaning April 1 to March 31.
 */
export async function getFinancialYear(dateInput = null, configuredStartMonth = null) {
  let startMonth = configuredStartMonth;
  if (!startMonth) {
    try {
      const setting = await db.prepare("SELECT value FROM attendance_settings WHERE key = 'fiscal_year_start_month'").get();
      startMonth = setting ? parseInt(setting.value, 10) : 4;
    } catch {
      startMonth = 4;
    }
  }
  if (!startMonth || isNaN(startMonth) || startMonth < 1 || startMonth > 12) {
    startMonth = 4;
  }

  const dateObj = dateInput ? new Date(`${dateInput}T12:00:00Z`) : toKolkata(new Date());
  const year = dateObj.getUTCFullYear();
  const month = dateObj.getUTCMonth() + 1; // 1-12

  let startYear, endYear;
  if (month >= startMonth) {
    startYear = year;
    endYear = year + 1;
  } else {
    startYear = year - 1;
    endYear = year;
  }

  const fiscalYear = `${startYear}-${endYear}`;
  const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  
  // Calculate endDate: last day of month prior to startMonth in endYear
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  return {
    fiscalYear,
    startYear,
    endYear,
    startMonth,
    startDate,
    endDate,
  };
}

/**
 * Calculate pro-rata upfront annual entitlement for a new joiner.
 * Configurable method: 'day_count' (default) or 'whole_month'.
 */
export function calculateNewJoinerProRata({
  joiningDate,
  fiscalYearStart,
  fiscalYearEnd,
  annualQuota = 7.0,
  method = 'day_count',
}) {
  if (!joiningDate || joiningDate <= fiscalYearStart) {
    return annualQuota;
  }
  if (joiningDate > fiscalYearEnd) {
    return 0.0;
  }

  if (method === 'whole_month') {
    const [jY, jM, jD] = joiningDate.split('-').map(Number);
    const [eY, eM] = fiscalYearEnd.split('-').map(Number);
    // Indian standard 15th-of-the-month cut-off
    const activeStartMonth = jD <= 15 ? jM : jM + 1;
    let activeMonths = (eY - jY) * 12 + (eM - activeStartMonth + 1);
    activeMonths = Math.max(0, Math.min(12, activeMonths));
    return Math.round(((activeMonths / 12) * annualQuota) * 10) / 10;
  }

  // Default: Day-Count Precision
  const joinMs = new Date(`${joiningDate}T00:00:00Z`).getTime();
  const startMs = new Date(`${fiscalYearStart}T00:00:00Z`).getTime();
  const endMs = new Date(`${fiscalYearEnd}T00:00:00Z`).getTime();

  const totalDaysInFy = Math.round((endMs - startMs) / 86400000) + 1;
  const remainingDays = Math.round((endMs - joinMs) / 86400000) + 1;

  if (remainingDays <= 0) return 0.0;
  const proRata = (remainingDays / totalDaysInFy) * annualQuota;
  return Math.round(proRata * 10) / 10;
}

/**
 * Initialize default leave categories for an organization/workspace if not already present
 */
export async function initWorkspaceDefaultCategories(workspaceId) {
  const wsId = Number(workspaceId);
  const defaultCategories = [
    {
      code: 'casual',
      name: 'Casual Leave (CL)',
      description: 'Standard annual casual leave for personal reasons.',
      allowance: 7.0,
      roles: JSON.stringify(['full_time']),
      is_paid: 1,
      allow_lop: 1,
      carry_forward: 0,
      max_cf: null,
      advance: 7,
      past_dates: 0,
      active: 1,
    },
    {
      code: 'sick',
      name: 'Sick Leave (SL)',
      description: 'Medical leave for personal illness or health emergencies.',
      allowance: 7.0,
      roles: JSON.stringify(['full_time', 'part_time', 'intern', 'probation', 'freelancer']),
      is_paid: 1,
      allow_lop: 1,
      carry_forward: 1,
      max_cf: null,
      advance: 0,
      past_dates: 1,
      active: 1,
    },
    {
      code: 'optional',
      name: 'Optional Leave',
      description: 'Floating or optional holiday leave configurable by company.',
      allowance: 0.0,
      roles: JSON.stringify(['full_time']),
      is_paid: 1,
      allow_lop: 0,
      carry_forward: 0,
      max_cf: null,
      advance: 0,
      past_dates: 0,
      active: 0,
    },
  ];

  for (const cat of defaultCategories) {
    await db.prepare(`
      INSERT INTO organization_leave_categories (
        workspace_id, code, name, description, annual_allowance, eligible_employment_types,
        is_paid, allow_lop_beyond_balance, carry_forward_enabled, max_carry_forward_days,
        min_advance_days, allow_past_dates, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (workspace_id, code) DO NOTHING
    `).run(
      wsId, cat.code, cat.name, cat.description, cat.allowance, cat.roles,
      cat.is_paid, cat.allow_lop, cat.carry_forward, cat.max_cf,
      cat.advance, cat.past_dates, cat.active
    );
  }
}

/**
 * Helper to safely resolve a valid workspace ID from the database
 */
export async function resolveWorkspaceId(wsId = null) {
  if (wsId != null && !isNaN(Number(wsId)) && Number(wsId) > 0) {
    const ws = await db.prepare('SELECT id FROM workspaces WHERE id = ?').get(Number(wsId));
    if (ws) return Number(ws.id);
  }
  const firstWs = await db.prepare('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1').get();
  return firstWs ? Number(firstWs.id) : 1;
}

/**
 * Retrieve comprehensive leave policy & categories for an organization/workspace
 */
export async function getOrganizationLeavePolicy(workspaceId = null) {
  const wsId = await resolveWorkspaceId(workspaceId);

  // Get or initialize organization leave policy
  let policy = await db.prepare('SELECT * FROM organization_leave_policies WHERE workspace_id = ?').get(wsId);
  if (!policy) {
    await db.prepare(`
      INSERT INTO organization_leave_policies (workspace_id, fiscal_year_start_month, new_joiner_prorata_method, allow_advance_leave, allow_negative_balance)
      VALUES (?, 4, 'none', 1, 0)
      ON CONFLICT(workspace_id) DO NOTHING
    `).run(wsId);
    policy = await db.prepare('SELECT * FROM organization_leave_policies WHERE workspace_id = ?').get(wsId);
  }

  // Ensure default categories exist
  let categories = await db.prepare('SELECT * FROM organization_leave_categories WHERE workspace_id = ? ORDER BY id ASC').all(wsId);
  if (!categories || categories.length === 0) {
    await initWorkspaceDefaultCategories(wsId);
    categories = await db.prepare('SELECT * FROM organization_leave_categories WHERE workspace_id = ? ORDER BY id ASC').all(wsId);
  }

  const parsedCategories = (categories || []).map((cat) => ({
    ...cat,
    eligible_employment_types: typeof cat.eligible_employment_types === 'string'
      ? (() => { try { return JSON.parse(cat.eligible_employment_types); } catch { return ['full_time']; } })()
      : (cat.eligible_employment_types || ['full_time']),
    annual_allowance: Number(cat.annual_allowance),
    is_paid: Boolean(cat.is_paid),
    allow_lop_beyond_balance: Boolean(cat.allow_lop_beyond_balance),
    carry_forward_enabled: Boolean(cat.carry_forward_enabled),
    max_carry_forward_days: cat.max_carry_forward_days != null ? Number(cat.max_carry_forward_days) : null,
    allow_half_day: Boolean(cat.allow_half_day),
    allow_multi_day: Boolean(cat.allow_multi_day),
    min_advance_days: Number(cat.min_advance_days || 0),
    allow_past_dates: Boolean(cat.allow_past_dates),
    requires_admin_approval: Boolean(cat.requires_admin_approval),
    is_active: Boolean(cat.is_active),
  }));

  const optCat = parsedCategories.find((c) => c.code === 'optional');

  return {
    workspace_id: wsId,
    fiscal_year_start_month: policy ? Number(policy.fiscal_year_start_month) : 4,
    new_joiner_prorata_method: policy?.new_joiner_prorata_method || 'none',
    allow_advance_leave: Boolean(policy?.allow_advance_leave ?? 1),
    allow_negative_balance: Boolean(policy?.allow_negative_balance ?? 0),
    categories: parsedCategories,
    // Backwards compatibility aliases
    optional_leave_enabled: optCat ? Boolean(optCat.is_active) : false,
    optional_leave_days: optCat ? Number(optCat.annual_allowance) : 0,
    optional_leave_rules: optCat ? String(optCat.description || '') : '',
  };
}

/**
 * Update organization leave policy settings (Admin Only)
 */
export async function updateOrganizationLeavePolicy({
  workspaceId,
  fiscalYearStartMonth = 4,
  newJoinerProrataMethod = 'none',
  allowAdvanceLeave = true,
  allowNegativeBalance = false,
  adminUser,
}) {
  if (!adminUser || adminUser.role !== 'admin') {
    throw new Error('Access denied. Only authorized administrators can update leave policy settings.');
  }

  const wsId = await resolveWorkspaceId(workspaceId);
  await db.prepare(`
    INSERT INTO organization_leave_policies (workspace_id, fiscal_year_start_month, new_joiner_prorata_method, allow_advance_leave, allow_negative_balance, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workspace_id) DO UPDATE SET
      fiscal_year_start_month = excluded.fiscal_year_start_month,
      new_joiner_prorata_method = excluded.new_joiner_prorata_method,
      allow_advance_leave = excluded.allow_advance_leave,
      allow_negative_balance = excluded.allow_negative_balance,
      updated_at = datetime('now')
  `).run(wsId, Number(fiscalYearStartMonth), String(newJoinerProrataMethod), allowAdvanceLeave ? 1 : 0, allowNegativeBalance ? 1 : 0);

  return getOrganizationLeavePolicy(wsId);
}

/**
 * Create or update a leave category for an organization (Admin Only)
 */
export async function saveOrganizationLeaveCategory({
  workspaceId,
  code,
  name,
  description = '',
  annualAllowance = 7.0,
  eligibleEmploymentTypes = ['full_time'],
  isPaid = true,
  allowLopBeyondBalance = true,
  carryForwardEnabled = false,
  maxCarryForwardDays = null,
  expiryRule = 'fiscal_year_end',
  allocationTiming = 'upfront',
  allowHalfDay = true,
  allowMultiDay = true,
  minAdvanceDays = 0,
  allowPastDates = undefined,
  requiresAdminApproval = true,
  isActive = true,
  adminUser,
}) {
  if (!adminUser || adminUser.role !== 'admin') {
    throw new Error('Access denied. Only authorized administrators can configure leave categories.');
  }

  const wsId = await resolveWorkspaceId(workspaceId);
  const normalizedCode = (code || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!normalizedCode) {
    throw new Error('Category code is required and must be alphanumeric.');
  }
  if (!name || name.trim().length === 0) {
    throw new Error('Category name is required.');
  }

  const allowPast = allowPastDates !== undefined ? Boolean(allowPastDates) : (normalizedCode === 'sick');
  const rolesJson = JSON.stringify(Array.isArray(eligibleEmploymentTypes) ? eligibleEmploymentTypes : ['full_time']);
  const allowanceNum = Math.max(0, parseFloat(annualAllowance) || 0);

  const existing = await db.prepare('SELECT id FROM organization_leave_categories WHERE workspace_id = ? AND code = ?').get(wsId, normalizedCode);

  if (existing) {
    await db.prepare(`
      UPDATE organization_leave_categories
      SET name = ?, description = ?, annual_allowance = ?, eligible_employment_types = ?,
          is_paid = ?, allow_lop_beyond_balance = ?, carry_forward_enabled = ?, max_carry_forward_days = ?,
          expiry_rule = ?, allocation_timing = ?, allow_half_day = ?, allow_multi_day = ?,
          min_advance_days = ?, allow_past_dates = ?, requires_admin_approval = ?, is_active = ?,
          updated_at = datetime('now')
      WHERE workspace_id = ? AND code = ?
    `).run(
      name.trim(), description.trim(), allowanceNum, rolesJson,
      isPaid ? 1 : 0, allowLopBeyondBalance ? 1 : 0, carryForwardEnabled ? 1 : 0, maxCarryForwardDays != null ? parseFloat(maxCarryForwardDays) : null,
      expiryRule, allocationTiming, allowHalfDay ? 1 : 0, allowMultiDay ? 1 : 0,
      parseInt(minAdvanceDays || 0, 10), allowPast ? 1 : 0, requiresAdminApproval ? 1 : 0, isActive ? 1 : 0,
      wsId, normalizedCode
    );
  } else {
    await db.prepare(`
      INSERT INTO organization_leave_categories (
        workspace_id, code, name, description, annual_allowance, eligible_employment_types,
        is_paid, allow_lop_beyond_balance, carry_forward_enabled, max_carry_forward_days,
        expiry_rule, allocation_timing, allow_half_day, allow_multi_day,
        min_advance_days, allow_past_dates, requires_admin_approval, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      wsId, normalizedCode, name.trim(), description.trim(), allowanceNum, rolesJson,
      isPaid ? 1 : 0, allowLopBeyondBalance ? 1 : 0, carryForwardEnabled ? 1 : 0, maxCarryForwardDays != null ? parseFloat(maxCarryForwardDays) : null,
      expiryRule, allocationTiming, allowHalfDay ? 1 : 0, allowMultiDay ? 1 : 0,
      parseInt(minAdvanceDays || 0, 10), allowPast ? 1 : 0, requiresAdminApproval ? 1 : 0, isActive ? 1 : 0
    );
  }

  return getOrganizationLeavePolicy(wsId);
}

/**
 * Delete or deactivate an organization leave category (Admin Only)
 */
export async function deleteOrganizationLeaveCategory({ workspaceId, code, adminUser }) {
  if (!adminUser || adminUser.role !== 'admin') {
    throw new Error('Access denied. Only authorized administrators can delete leave categories.');
  }
  const wsId = await resolveWorkspaceId(workspaceId);

  // Check if requests exist
  const hasRequests = await db.prepare(`
    SELECT 1 FROM employee_leave_requests elr
    JOIN employees e ON e.id = elr.employee_id
    WHERE e.workspace_id = ? AND elr.leave_type = ?
    LIMIT 1
  `).get(wsId, code);

  if (hasRequests) {
    // Preserve historical data: soft disable
    await db.prepare("UPDATE organization_leave_categories SET is_active = 0, updated_at = datetime('now') WHERE workspace_id = ? AND code = ?").run(wsId, code);
  } else {
    await db.prepare('DELETE FROM organization_leave_categories WHERE workspace_id = ? AND code = ?').run(wsId, code);
  }

  return getOrganizationLeavePolicy(wsId);
}

/**
 * Retrieve current leave policy settings (preserves backward compatibility)
 */
export async function getLeavePolicySettings(workspaceId = null) {
  return getOrganizationLeavePolicy(workspaceId);
}

/**
 * Update leave policy settings (Admin Only, preserves backward compatibility)
 */
export async function updateLeavePolicySettings({
  workspaceId = null,
  fiscalYearStartMonth = 4,
  optionalLeaveEnabled = false,
  optionalLeaveDays = 0,
  optionalLeaveRules = '',
  newJoinerProrataMethod = 'none',
  adminUser,
}) {
  if (!adminUser || adminUser.role !== 'admin') {
    throw new Error('Access denied. Only authorized administrators can update leave policy settings.');
  }

  const wsId = workspaceId != null ? Number(workspaceId) : 1;

  // Update attendance_settings global keys for backward compatibility
  const entries = [
    ['fiscal_year_start_month', String(fiscalYearStartMonth), 'Financial year start month'],
    ['optional_leave_enabled', optionalLeaveEnabled ? '1' : '0', 'Optional leave enabled'],
    ['optional_leave_days', String(optionalLeaveDays), 'Optional leave days'],
    ['optional_leave_rules', String(optionalLeaveRules), 'Optional leave rules'],
    ['new_joiner_prorata_method', String(newJoinerProrataMethod), 'New joiner pro-rata method'],
  ];

  for (const [key, value, desc] of entries) {
    await db.prepare(`
      INSERT INTO attendance_settings (key, value, description, updated_at, updated_by)
      VALUES (?, ?, ?, datetime('now'), ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by
    `).run(key, value, desc, adminUser.id);
  }

  // Update organization policy and optional category
  await updateOrganizationLeavePolicy({
    workspaceId: wsId,
    fiscalYearStartMonth,
    newJoinerProrataMethod,
    adminUser,
  });

  await saveOrganizationLeaveCategory({
    workspaceId: wsId,
    code: 'optional',
    name: 'Optional Leave',
    description: optionalLeaveRules,
    annualAllowance: optionalLeaveDays,
    eligibleEmploymentTypes: ['full_time'],
    isPaid: true,
    allowLopBeyondBalance: false,
    isActive: optionalLeaveEnabled,
    adminUser,
  });

  return getOrganizationLeavePolicy(wsId);
}

/**
 * Centralized Entitlement Allocation Service.
 * Ensures leave_balances records exist for an employee and fiscal year based on their organization's policy.
 */
export async function ensureEmployeeLeaveBalances(employeeId, targetFiscalYear = null) {
  const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(employeeId));
  if (!emp) {
    throw new Error(`Employee #${employeeId} not found.`);
  }

  const wsId = await resolveWorkspaceId(emp.workspace_id);
  const orgPolicy = await getOrganizationLeavePolicy(wsId);
  const fyInfo = targetFiscalYear
    ? await getFinancialYear(`${targetFiscalYear.split('-')[0]}-05-01`, orgPolicy.fiscal_year_start_month)
    : await getFinancialYear(null, orgPolicy.fiscal_year_start_month);

  const fy = targetFiscalYear || fyInfo.fiscalYear;
  const empType = emp.employment_type || 'full_time';

  const existing = await db
    .prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND fiscal_year = ?')
    .all(Number(employeeId), fy);

  const existingTypes = new Set(existing.map((r) => r.leave_type));

  for (const cat of orgPolicy.categories) {
    if (!cat.is_active) continue;

    if (!existingTypes.has(cat.code)) {
      const isEligible = cat.eligible_employment_types.includes(empType);
      const quota = isEligible ? cat.annual_allowance : 0.0;

      let carriedForward = 0.0;
      if (cat.carry_forward_enabled) {
        const prevStartYear = fyInfo.startYear - 1;
        const prevEndYear = fyInfo.endYear - 1;
        const prevFy = `${prevStartYear}-${prevEndYear}`;
        const prevRow = await db
          .prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND fiscal_year = ? AND leave_type = ?')
          .get(Number(employeeId), prevFy, cat.code);

        if (prevRow) {
          const prevFyDates = await getFinancialYear(`${prevStartYear}-05-01`, orgPolicy.fiscal_year_start_month);
          const prevApproved = await db.prepare(`
            SELECT COALESCE(SUM(paid_days), 0.0) as paid_sum
            FROM employee_leave_requests
            WHERE employee_id = ? AND leave_type = ? AND status = 'approved'
              AND start_date >= ? AND start_date <= ?
          `).get(Number(employeeId), cat.code, prevFyDates.startDate, prevFyDates.endDate);

          const closingBal = (prevRow.annual_entitlement + prevRow.carried_forward + prevRow.manual_adjustment) - Number(prevApproved.paid_sum);
          let rawCf = Math.max(0.0, Math.round(closingBal * 10) / 10);
          if (cat.max_carry_forward_days != null) {
            rawCf = Math.min(rawCf, cat.max_carry_forward_days);
          }
          carriedForward = rawCf;
        }
      }

      await db.prepare(`
        INSERT INTO leave_balances (
          employee_id, fiscal_year, leave_type, annual_entitlement, carried_forward, manual_adjustment, notes
        ) VALUES (?, ?, ?, ?, ?, 0.0, ?)
        ON CONFLICT(employee_id, fiscal_year, leave_type) DO NOTHING
      `).run(
        Number(employeeId),
        fy,
        cat.code,
        quota,
        carriedForward,
        isEligible ? `Standard ${cat.name} Entitlement` : `Not eligible for ${cat.name} (${empType})`
      );
    }
  }

  return db
    .prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND fiscal_year = ?')
    .all(Number(employeeId), fy);
}

/**
 * Fetch complete leave balances for an employee as of selected date.
 * Returns dynamic category cards based on the employee's organization leave policy.
 */
export async function getEmployeeLeaveBalances({ employeeId, dateInput = null, workspaceId = null }) {
  const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(employeeId));
  if (!emp) {
    throw new Error(`Employee #${employeeId} not found.`);
  }

  const wsId = await resolveWorkspaceId(workspaceId != null ? workspaceId : emp.workspace_id);
  const orgPolicy = await getOrganizationLeavePolicy(wsId);
  const fyInfo = await getFinancialYear(dateInput, orgPolicy.fiscal_year_start_month);
  const selectedDate = dateInput || toKolkata(new Date()).toISOString().slice(0, 10);

  await ensureEmployeeLeaveBalances(employeeId, fyInfo.fiscalYear);

  const balanceRows = await db
    .prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND fiscal_year = ?')
    .all(Number(employeeId), fyInfo.fiscalYear);

  const balanceMap = {};
  for (const r of balanceRows) {
    balanceMap[r.leave_type] = r;
  }

  // Fetch all leave requests in this financial year
  const requests = await db.prepare(`
    SELECT * FROM employee_leave_requests
    WHERE employee_id = ? AND start_date >= ? AND start_date <= ?
  `).all(Number(employeeId), fyInfo.startDate, fyInfo.endDate);

  // Fetch all attendance records in this financial year
  const attendanceRecords = await db.prepare(`
    SELECT * FROM employee_attendance
    WHERE employee_id = ? AND work_date >= ? AND work_date <= ?
  `).all(Number(employeeId), fyInfo.startDate, fyInfo.endDate);

  const empType = emp?.employment_type || 'full_time';

  function calculateCategorySummary(cat) {
    const code = typeof cat === 'string' ? cat : cat.code;
    const catConfig = typeof cat === 'string' ? orgPolicy.categories.find((c) => c.code === cat) : cat;
    const label = catConfig?.name || getLeaveTypeLabel(code);

    const row = balanceMap[code] || {
      annual_entitlement: 0.0,
      carried_forward: 0.0,
      manual_adjustment: 0.0,
    };

    const catRequests = requests.filter((r) => r.leave_type === code);
    let totalApplied = 0.0;
    let pendingDays = 0.0;
    let approvedDays = 0.0;
    let rejectedDays = 0.0;
    let cancelledDays = 0.0;
    let lopDays = 0.0;

    for (const r of catRequests) {
      if (r.status === 'pending') {
        pendingDays += Number(r.total_working_days);
        totalApplied += Number(r.total_working_days);
      } else if (r.status === 'approved') {
        approvedDays += Number(r.paid_days ?? r.total_working_days);
        lopDays += Number(r.lop_days ?? 0);
        totalApplied += Number(r.total_working_days);
      } else if (r.status === 'rejected') {
        rejectedDays += Number(r.total_working_days);
      } else if (r.status === 'cancelled') {
        cancelledDays += Number(r.total_working_days);
      }
    }

    let takenDays = 0.0;
    for (const a of attendanceRecords) {
      if (a.work_date <= selectedDate && (a.status === 'on_leave' || a.status === 'half_day')) {
        if (a.leave_request_id) {
          const req = catRequests.find((r) => r.id === a.leave_request_id);
          if (req && req.status === 'approved') {
            takenDays += Number(a.paid_leave_days ?? (a.leave_day_type === 'full_day' ? 1.0 : 0.5));
          }
        }
      }
    }

    const annualEntitlement = Number(row.annual_entitlement) || 0.0;
    const carriedForward = Number(row.carried_forward) || 0.0;
    const manualAdjustment = Number(row.manual_adjustment) || 0.0;

    const totalEffectiveQuota = Math.round((annualEntitlement + carriedForward + manualAdjustment) * 10) / 10;
    const rawRemaining = Math.round((totalEffectiveQuota - approvedDays) * 10) / 10;
    const isEligible = catConfig ? catConfig.eligible_employment_types.includes(empType) : true;
    const remainingBalance = isEligible ? Math.max(0.0, rawRemaining) : 0.0;

    return {
      leaveType: code,
      code,
      label,
      name: label,
      description: catConfig?.description || '',
      annualEntitlement: isEligible ? annualEntitlement : 0.0,
      accruedEntitlement: isEligible ? annualEntitlement : 0.0,
      carriedForward: isEligible ? carriedForward : 0.0,
      manualAdjustment: isEligible ? manualAdjustment : 0.0,
      totalEffectiveQuota: isEligible ? totalEffectiveQuota : 0.0,
      totalApplied: Math.round(totalApplied * 10) / 10,
      pendingDays: Math.round(pendingDays * 10) / 10,
      approvedDays: Math.round(approvedDays * 10) / 10,
      takenDays: Math.round(takenDays * 10) / 10,
      rejectedDays: Math.round(rejectedDays * 10) / 10,
      cancelledDays: Math.round(cancelledDays * 10) / 10,
      lopDays: Math.round(lopDays * 10) / 10,
      remainingBalance,
      isConfigured: catConfig ? Boolean(catConfig.is_active) : true,
      isEligible,
      isPaid: catConfig ? Boolean(catConfig.is_paid) : true,
      allowLopBeyondBalance: catConfig ? Boolean(catConfig.allow_lop_beyond_balance) : true,
      carryForwardEnabled: catConfig ? Boolean(catConfig.carry_forward_enabled) : false,
      allowHalfDay: catConfig ? Boolean(catConfig.allow_half_day) : true,
      allowMultiDay: catConfig ? Boolean(catConfig.allow_multi_day) : true,
      ineligibilityReason: !isEligible ? `${label} is not eligible for employment category "${empType}" under company policy.` : null,
    };
  }

  // Company Holidays Summary
  const holidays = await getCompanyHolidays({ workspaceId: wsId });
  const totalHolidaysCount = holidays.length;
  const elapsedHolidays = holidays.filter((h) => {
    const hDate = h.is_recurring ? `${fyInfo.startYear}-${h.holiday_date}` : h.holiday_date;
    return hDate <= selectedDate;
  });
  const upcomingHolidays = holidays.filter((h) => {
    const hDate = h.is_recurring ? `${fyInfo.startYear}-${h.holiday_date}` : h.holiday_date;
    return hDate > selectedDate;
  });

  const categories = {};
  for (const cat of orgPolicy.categories) {
    if (cat.is_active) {
      categories[cat.code] = calculateCategorySummary(cat);
    }
  }

  // Ensure default categories exist in map even if disabled, for UI backward compatibility
  if (!categories.casual) categories.casual = calculateCategorySummary('casual');
  if (!categories.sick) categories.sick = calculateCategorySummary('sick');
  if (!categories.optional) categories.optional = calculateCategorySummary('optional');

  categories.holidays = {
    totalEntitlement: totalHolidaysCount,
    totalConfigured: totalHolidaysCount,
    elapsedCount: elapsedHolidays.length,
    upcomingCount: upcomingHolidays.length,
    holidaysList: holidays,
  };

  return {
    employee: {
      id: emp.id,
      name: emp.name,
      email: emp.email,
      department: emp.department,
      employment_type: emp.employment_type || 'full_time',
      joining_date: emp.joining_date || emp.created_at.slice(0, 10),
      workspace_id: wsId,
    },
    workspaceId: wsId,
    fiscalYear: fyInfo.fiscalYear,
    fiscalYearStartDate: fyInfo.startDate,
    fiscalYearEndDate: fyInfo.endDate,
    selectedDate,
    categories,
  };
}

/**
 * Admin Balance Adjustment with mandatory audit log and SHA-256 idempotency.
 */
export async function adminAdjustLeaveBalance({
  employeeId,
  fiscalYear,
  leaveType,
  adjustmentType, // 'entitlement' | 'carry_forward' | 'balance_adjustment' | 'historical_correction'
  newValue,
  reason,
  adminUser,
  expectedPreviousValue = null,
  idempotencyKey = null,
}) {
  if (!adminUser || adminUser.role !== 'admin') {
    throw new Error('Access denied. Only authorized administrators can adjust leave balances.');
  }

  if (!reason || reason.trim().length < 5) {
    throw new Error('A mandatory reason of at least 5 characters is required for every leave balance adjustment.');
  }

  const emp = await db.prepare('SELECT workspace_id FROM employees WHERE id = ?').get(Number(employeeId));
  const wsId = await resolveWorkspaceId(emp?.workspace_id);
  const orgPolicy = await getOrganizationLeavePolicy(wsId);
  const knownCodes = orgPolicy.categories.map((c) => c.code);

  if (!knownCodes.includes(leaveType) && !['casual', 'sick', 'optional'].includes(leaveType)) {
    throw new Error(`Invalid leave type "${leaveType}".`);
  }

  const validAdjustments = ['entitlement', 'carry_forward', 'balance_adjustment', 'historical_correction'];
  if (!validAdjustments.includes(adjustmentType)) {
    throw new Error(`Invalid adjustment type "${adjustmentType}".`);
  }

  const numNewValue = parseFloat(newValue);
  if (isNaN(numNewValue)) {
    throw new Error('New value must be a valid number.');
  }

  // Generate deterministic SHA-256 idempotency key
  const normalizedReason = reason.trim().toLowerCase();
  const deterministicKey = idempotencyKey || crypto
    .createHash('sha256')
    .update(`${employeeId}::${fiscalYear}::${leaveType}::${adjustmentType}::${numNewValue}::${normalizedReason}`)
    .digest('hex');

  // Check if idempotency key was already executed
  const existingAudit = await db
    .prepare('SELECT id FROM leave_balance_adjustments WHERE idempotency_key = ?')
    .get(deterministicKey);

  if (existingAudit) {
    const err = new Error('Duplicate adjustment request: this exact correction has already been applied.');
    err.status = 409;
    throw err;
  }

  const policy = await getLeavePolicySettings();
  const currentFyInfo = await getFinancialYear(null, policy.fiscal_year_start_month);

  await db.exec('BEGIN TRANSACTION;');
  try {
    let prevValue = 0.0;
    let targetFy = fiscalYear;
    let appliedToFy = null;

    if (adjustmentType === 'historical_correction') {
      // Historical correction is strictly restricted to the immediately preceding financial year (FY_{N-1})
      const [curStartYear] = currentFyInfo.fiscalYear.split('-').map(Number);
      const expectedPrevFy = `${curStartYear - 1}-${curStartYear}`;

      if (fiscalYear !== expectedPrevFy) {
        throw new Error(
          `Direct historical corrections are restricted to the immediately preceding financial year (${expectedPrevFy}). For earlier years, apply a current-year manual balance adjustment with audit notes.`
        );
      }

      targetFy = fiscalYear;
      appliedToFy = currentFyInfo.fiscalYear;

      // Ensure historical row exists
      await ensureEmployeeLeaveBalances(employeeId, targetFy);
      const histRow = await db
        .prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND fiscal_year = ? AND leave_type = ?')
        .get(Number(employeeId), targetFy, leaveType);

      prevValue = Number(histRow?.carried_forward || 0.0);
      const delta = Math.round((numNewValue - prevValue) * 10) / 10;

      // Ensure active year row exists
      await ensureEmployeeLeaveBalances(employeeId, appliedToFy);

      if (leaveType === 'sick') {
        // Evaluate corrected closing Sick Leave of FY_{N-1}
        const histApproved = await db.prepare(`
          SELECT COALESCE(SUM(paid_days), 0.0) as paid_sum
          FROM employee_leave_requests
          WHERE employee_id = ? AND leave_type = 'sick' AND status = 'approved'
            AND start_date >= ? AND start_date <= ?
        `).get(Number(employeeId), `${curStartYear - 1}-04-01`, `${curStartYear}-03-31`);

        const correctedClosingSl = Math.max(
          0.0,
          Math.round(((histRow.annual_entitlement + numNewValue + histRow.manual_adjustment) - Number(histApproved.paid_sum)) * 10) / 10
        );

        // Update active year's carry-forward to the corrected closing balance
        await db.prepare(`
          UPDATE leave_balances
          SET carried_forward = ?, updated_at = datetime('now')
          WHERE employee_id = ? AND fiscal_year = ? AND leave_type = 'sick'
        `).run(correctedClosingSl, Number(employeeId), appliedToFy);
      }

      // Record audit row
      await db.prepare(`
        INSERT INTO leave_balance_adjustments (
          employee_id, admin_id, admin_name, fiscal_year, applied_to_fiscal_year,
          leave_type, adjustment_type, previous_value, new_value, delta,
          reason, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        Number(employeeId),
        adminUser.id,
        adminUser.name || 'Admin',
        targetFy,
        appliedToFy,
        leaveType,
        adjustmentType,
        prevValue,
        numNewValue,
        delta,
        reason.trim(),
        deterministicKey
      );

    } else {
      // Standard adjustment in target FY
      await ensureEmployeeLeaveBalances(employeeId, targetFy);
      const row = await db
        .prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND fiscal_year = ? AND leave_type = ?')
        .get(Number(employeeId), targetFy, leaveType);

      if (adjustmentType === 'entitlement') {
        prevValue = Number(row?.annual_entitlement || 0.0);
      } else if (adjustmentType === 'carry_forward') {
        prevValue = Number(row?.carried_forward || 0.0);
      } else {
        prevValue = Number(row?.manual_adjustment || 0.0);
      }

      // Optimistic state precondition check if requested
      if (expectedPreviousValue !== null && expectedPreviousValue !== undefined) {
        if (Math.abs(prevValue - Number(expectedPreviousValue)) > 0.001) {
          const err = new Error(`Optimistic lock failure: expected previous value ${expectedPreviousValue}, but current value is ${prevValue}.`);
          err.status = 409;
          throw err;
        }
      }

      const delta = Math.round((numNewValue - prevValue) * 10) / 10;

      let updateCol = 'manual_adjustment';
      if (adjustmentType === 'entitlement') updateCol = 'annual_entitlement';
      else if (adjustmentType === 'carry_forward') updateCol = 'carried_forward';

      await db.prepare(`
        UPDATE leave_balances
        SET ${updateCol} = ?, updated_at = datetime('now')
        WHERE employee_id = ? AND fiscal_year = ? AND leave_type = ?
      `).run(numNewValue, Number(employeeId), targetFy, leaveType);

      await db.prepare(`
        INSERT INTO leave_balance_adjustments (
          employee_id, admin_id, admin_name, fiscal_year, applied_to_fiscal_year,
          leave_type, adjustment_type, previous_value, new_value, delta,
          reason, idempotency_key
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        Number(employeeId),
        adminUser.id,
        adminUser.name || 'Admin',
        targetFy,
        leaveType,
        adjustmentType,
        prevValue,
        numNewValue,
        delta,
        reason.trim(),
        deterministicKey
      );
    }

    await db.exec('COMMIT;');
    return getEmployeeLeaveBalances({ employeeId, dateInput: null });
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Fetch all audit logs for leave balance adjustments
 */
export async function getLeaveBalanceAdjustments({ employeeId = null, fiscalYear = null }) {
  let sql = `
    SELECT a.*, e.name AS employee_name, e.department
    FROM leave_balance_adjustments a
    JOIN employees e ON e.id = a.employee_id
    WHERE 1=1
  `;
  const params = [];
  if (employeeId && employeeId !== 'all') {
    sql += ' AND a.employee_id = ?';
    params.push(Number(employeeId));
  }
  if (fiscalYear && fiscalYear !== 'all') {
    sql += ' AND (a.fiscal_year = ? OR a.applied_to_fiscal_year = ?)';
    params.push(fiscalYear, fiscalYear);
  }
  sql += ' ORDER BY a.id DESC';
  return db.prepare(sql).all(...params);
}

/**
 * Execute idempotent annual rollover for all active employees (or single employee).
 */
export async function performAnnualRollover({ employeeId = null, targetFiscalYear = null, adminUser = null } = {}) {
  const policy = await getLeavePolicySettings();
  const fyInfo = targetFiscalYear 
    ? await getFinancialYear(`${targetFiscalYear.split('-')[0]}-05-01`, policy.fiscal_year_start_month)
    : await getFinancialYear(null, policy.fiscal_year_start_month);

  const employees = employeeId
    ? [await db.prepare('SELECT id FROM employees WHERE id = ?').get(Number(employeeId))]
    : await db.prepare('SELECT id FROM employees WHERE active = 1').all();

  const results = [];
  for (const emp of employees) {
    if (!emp) continue;
    const balances = await ensureEmployeeLeaveBalances(emp.id, fyInfo.fiscalYear);
    results.push({ employeeId: emp.id, fiscalYear: fyInfo.fiscalYear, count: balances.length });
  }
  return {
    fiscalYear: fyInfo.fiscalYear,
    employeesProcessed: results.length,
    results,
  };
}

/**
 * Automatically synchronize leave eligibility and allocate entitlements
 * when an employee's employment type or organization/workspace transitions.
 */
export async function syncEmployeeEmploymentTypeLeaveEligibility({
  employeeId,
  oldType,
  newType,
  newWorkspaceId = null,
  adminUser = null,
}) {
  const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(employeeId));
  if (!emp) return;

  const wsId = await resolveWorkspaceId(newWorkspaceId != null ? newWorkspaceId : emp.workspace_id);

  // Ensure employee record reflects the new employment type and workspace
  if (emp.employment_type !== newType || (newWorkspaceId != null && emp.workspace_id !== wsId)) {
    await db.prepare("UPDATE employees SET employment_type = ?, workspace_id = ?, updated_at = datetime('now') WHERE id = ?").run(newType, wsId, Number(employeeId));
  }

  const orgPolicy = await getOrganizationLeavePolicy(wsId);
  const fyInfo = await getFinancialYear(null, orgPolicy.fiscal_year_start_month);
  const fy = fyInfo.fiscalYear;

  // Re-evaluate eligibility for all active categories
  for (const cat of orgPolicy.categories) {
    if (!cat.is_active) continue;

    const wasEligible = oldType ? cat.eligible_employment_types.includes(oldType) : false;
    const isNowEligible = cat.eligible_employment_types.includes(newType);

    if (isNowEligible && !wasEligible) {
      const existingRow = await db
        .prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND fiscal_year = ? AND leave_type = ?')
        .get(Number(employeeId), fy, cat.code);

      if (!existingRow || Number(existingRow.annual_entitlement) === 0) {
        const entitlement = cat.annual_allowance;
        const prevVal = existingRow ? Number(existingRow.annual_entitlement) : 0.0;
        const delta = entitlement - prevVal;

        const deterministicKey = cat.code === 'casual'
          ? crypto.createHash('sha256').update(`fte_cl_alloc:${employeeId}:${fy}:casual`).digest('hex')
          : crypto.createHash('sha256').update(`emp_alloc:${wsId}:${employeeId}:${fy}:${cat.code}`).digest('hex');

        const existingAdj = await db
          .prepare('SELECT id FROM leave_balance_adjustments WHERE idempotency_key = ?')
          .get(deterministicKey);

        if (!existingAdj) {
          const auditReason = cat.code === 'casual' && newType === 'full_time'
            ? 'Casual Leave entitlement granted after employment type changed to Full-Time Employee.'
            : `${cat.name} entitlement granted after employment type changed to ${newType}.`;

          if (!existingRow) {
            await db.prepare(`
              INSERT INTO leave_balances (
                employee_id, fiscal_year, leave_type, annual_entitlement, carried_forward, manual_adjustment, notes
              ) VALUES (?, ?, ?, ?, 0.0, 0.0, ?)
            `).run(Number(employeeId), fy, cat.code, entitlement, auditReason);
          } else {
            await db.prepare(`
              UPDATE leave_balances
              SET annual_entitlement = ?,
                  notes = ?,
                  updated_at = datetime('now')
              WHERE id = ?
            `).run(entitlement, auditReason, existingRow.id);
          }

          await db.prepare(`
            INSERT INTO leave_balance_adjustments (
              employee_id, admin_id, admin_name, fiscal_year,
              leave_type, adjustment_type, previous_value, new_value, delta,
              reason, idempotency_key, workspace_id
            ) VALUES (?, ?, ?, ?, ?, 'entitlement', ?, ?, ?, ?, ?, ?)
          `).run(
            Number(employeeId),
            adminUser?.id || null,
            adminUser?.name || 'Admin',
            fy,
            cat.code,
            prevVal,
            entitlement,
            delta,
            auditReason,
            deterministicKey,
            wsId
          );
        }
      }
    }
  }

  return getEmployeeLeaveBalances({ employeeId, dateInput: null, workspaceId: wsId });
}
