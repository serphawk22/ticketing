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
 * Check if a date falls on an official company holiday
 */
export async function checkHoliday(dateInput) {
  const kd = toKolkata(dateInput);
  if (!kd) return { isHoliday: false, name: null, fallsOnSunday: false };

  const isoDate = kd.toISOString().slice(0, 10);
  const mmDd = isoDate.slice(5, 10);
  const isSunday = kd.getUTCDay() === 0;

  const rows = await db
    .prepare(
      `SELECT * FROM company_holidays 
       WHERE holiday_date = ? OR (is_recurring = 1 AND holiday_date = ?)`
    )
    .all(isoDate, mmDd);

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
 * Fetch all official company holidays
 */
export async function getCompanyHolidays() {
  return db.prepare('SELECT * FROM company_holidays ORDER BY holiday_date ASC').all();
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
export async function calculateLeaveWorkingDays(startDate, endDate, dayType = 'full_day') {
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
    const holiday = await checkHoliday(cur);

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
 * Submit a new leave request (Employee Action)
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

  const validTypes = ['casual', 'sick', 'paid', 'unpaid', 'other'];
  if (!validTypes.includes(leaveType)) {
    throw new Error(`Invalid leave type "${leaveType}". Must be one of: ${validTypes.join(', ')}`);
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

  const calculation = await calculateLeaveWorkingDays(startDate, endDate, dayType);
  if (calculation.totalWorkingDays === 0) {
    throw new Error(
      'Selected date range contains no working days. All selected dates are Sundays or official company holidays.'
    );
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

  // Begin transaction
  await db.exec('BEGIN TRANSACTION;');
  try {
    for (const item of calculation.workingDates) {
      const dateStr = item.date;
      const conflict = conflictMap.get(dateStr);
      const resolution = conflict ? conflictResolutions[dateStr] : 'none';

      if (resolution === 'keep_attendance') {
        // Option 1: Keep Attendance & Exclude Date
        excludedDates.push(dateStr);
        remainingWorkingDays -= item.weight;

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

      if (resolution === 'convert_half_day') {
        // Option 2: Convert to Half-Day Leave
        approvedDates.push(dateStr);
        remainingWorkingDays -= 0.5; // reduced by half day

        if (conflict) {
          await db
            .prepare(
              `UPDATE employee_attendance
               SET status = 'half_day', leave_request_id = ?, leave_day_type = 'second_half',
                   is_manually_adjusted = 1, adjusted_by = ?, adjustment_reason = ?, updated_at = datetime('now')
               WHERE id = ?`
            )
            .run(request.id, adminUser.id, 'Converted to half-day leave with worked punches preserved', conflict.attendanceId);

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
                 notes = ?, updated_at = datetime('now')
             WHERE id = ?`
          )
          .run(
            request.day_type === 'full_day' ? 'on_leave' : 'half_day',
            request.id,
            request.day_type,
            `Approved ${getLeaveTypeLabel(request.leave_type)}: ${request.reason}`,
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
              leave_request_id, leave_day_type
            ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'leave_approval', 0, 0, 0, 0, ?, 'on_leave', 0, 0, ?, ?, ?)`
          )
          .run(
            request.employee_id,
            request.user_id,
            dateStr,
            settings.work_start_time,
            settings.work_end_time,
            request.day_type === 'full_day' ? 'on_leave' : 'half_day',
            `Approved ${getLeaveTypeLabel(request.leave_type)}: ${request.reason}`,
            request.id,
            request.day_type
          );
      }
    }

    // Final state of leave request:
    if (remainingWorkingDays <= 0) {
      await db
        .prepare(
          `UPDATE employee_leave_requests
           SET status = 'cancelled', total_working_days = 0, reviewed_by = ?,
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
        excludedDates.length > 0 ? `Excluded dates: ${excludedDates.join(', ')}` : '',
      ].filter(Boolean).join(' | ');

      await db
        .prepare(
          `UPDATE employee_leave_requests
           SET status = 'approved', total_working_days = ?, reviewed_by = ?,
               reviewer_notes = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(remainingWorkingDays, adminUser.id, notes || 'Approved by Admin', request.id);
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
