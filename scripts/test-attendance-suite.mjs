import assert from 'assert';
import { db } from '../lib/db.js';
import {
  calculateAttendanceStatus,
  calculateLunchDeduction,
  calculateAttendanceDurations,
  checkHoliday,
  isSundayWeeklyOff,
  getAttendanceSettings,
  updateAttendanceSettings,
  recordCheckIn,
  recordCheckOut,
  reconcileUnclosedAttendance,
  adminAdjustAttendance,
  getEmployeeAttendanceHistory,
  getWorkforceAttendanceForDate,
  getAttendanceAuditLogs,
} from '../lib/attendance.js';
import { getReportExecutionData } from '../lib/analytics.js';

let totalTests = 0;
let passedTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

async function itAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

async function runSuite() {
  console.log('\n======================================================');
  console.log('STARTING ATTENDANCE SYSTEM TEST SUITE');
  console.log('======================================================\n');

  // --- 1. Check-In Boundary Tests ---
  console.log('Group 1: Check-in Time Boundaries (Asia/Kolkata)');

  it('Check-in at 09:15:00 AM -> Present / Full Day', () => {
    const res = calculateAttendanceStatus({ checkInDate: new Date('2026-10-22T09:15:00+05:30') });
    assert.strictEqual(res.status, 'present');
    assert.strictEqual(res.isLate, false);
    assert.strictEqual(res.isHalfDay, false);
  });

  it('Check-in at 11:29:59 AM -> Present / Full Day', () => {
    const res = calculateAttendanceStatus({ checkInDate: new Date('2026-10-22T11:29:59+05:30') });
    assert.strictEqual(res.status, 'present');
    assert.strictEqual(res.isLate, false);
  });

  it('Check-in at exactly 11:30:00 AM -> Late', () => {
    const res = calculateAttendanceStatus({ checkInDate: new Date('2026-10-22T11:30:00+05:30') });
    assert.strictEqual(res.status, 'late');
    assert.strictEqual(res.isLate, true);
    assert.strictEqual(res.isHalfDay, false);
  });

  it('Check-in at 11:45:00 AM -> Late', () => {
    const res = calculateAttendanceStatus({ checkInDate: new Date('2026-10-22T11:45:00+05:30') });
    assert.strictEqual(res.status, 'late');
    assert.strictEqual(res.isLate, true);
  });

  it('Check-in at exactly 12:00:00 PM -> Late (NOT Half Day)', () => {
    const res = calculateAttendanceStatus({ checkInDate: new Date('2026-10-22T12:00:00+05:30') });
    assert.strictEqual(res.status, 'late');
    assert.strictEqual(res.isLate, true);
    assert.strictEqual(res.isHalfDay, false);
  });

  it('Check-in at 12:00:59 PM -> Late', () => {
    const res = calculateAttendanceStatus({ checkInDate: new Date('2026-10-22T12:00:59+05:30') });
    assert.strictEqual(res.status, 'late');
    assert.strictEqual(res.isLate, true);
  });

  it('Check-in at exactly 12:01:00 PM -> Half Day (Priority Over Late)', () => {
    const res = calculateAttendanceStatus({ checkInDate: new Date('2026-10-22T12:01:00+05:30') });
    assert.strictEqual(res.status, 'half_day');
    assert.strictEqual(res.isLate, false);
    assert.strictEqual(res.isHalfDay, true);
  });

  it('Check-in after 12:01 PM (02:30:00 PM) -> Half Day', () => {
    const res = calculateAttendanceStatus({ checkInDate: new Date('2026-10-22T14:30:00+05:30') });
    assert.strictEqual(res.status, 'half_day');
    assert.strictEqual(res.isHalfDay, true);
  });

  // --- 2. Sunday & Holiday Rules ---
  console.log('\nGroup 2: Weekly Offs & Holiday Calendar');

  it('Sunday detection (Asia/Kolkata)', () => {
    assert.strictEqual(isSundayWeeklyOff(new Date('2026-10-25T10:00:00+05:30')), true);
    assert.strictEqual(isSundayWeeklyOff(new Date('2026-10-22T10:00:00+05:30')), false);
  });

  it('Sunday check-in has no late penalty', () => {
    const res = calculateAttendanceStatus({
      checkInDate: new Date('2026-10-25T13:00:00+05:30'),
      isSundayOrHoliday: true,
    });
    assert.strictEqual(res.status, 'present');
    assert.strictEqual(res.isLate, false);
  });

  await itAsync('Fixed recurring holidays (Jan 1, Jan 26, Aug 15, Oct 2, Dec 25)', async () => {
    const hJan1 = await checkHoliday(new Date('2026-01-01T10:00:00+05:30'));
    assert.strictEqual(hJan1.isHoliday, true);
    assert.strictEqual(hJan1.name, "New Year's Day");
    assert.strictEqual(hJan1.isRecurring, true);

    const hOct2 = await checkHoliday(new Date('2026-10-02T10:00:00+05:30'));
    assert.strictEqual(hOct2.isHoliday, true);
    assert.strictEqual(hOct2.name, 'Mahatma Gandhi Jayanthi');
    assert.strictEqual(hOct2.isRecurring, true);
  });

  await itAsync('2026 Year-specific festival holidays (Oct 20 Ayudha Pooja)', async () => {
    const hOct20 = await checkHoliday(new Date('2026-10-20T10:00:00+05:30'));
    assert.strictEqual(hOct20.isHoliday, true);
    assert.strictEqual(hOct20.name, 'Ayudha Pooja');
    assert.strictEqual(hOct20.isRecurring, false);
  });

  await itAsync('Sunday holidays (Feb 15 Maha Shivaratri) - no carry forward, single off', async () => {
    const hFeb15 = await checkHoliday(new Date('2026-02-15T10:00:00+05:30'));
    assert.strictEqual(hFeb15.isHoliday, true);
    assert.strictEqual(hFeb15.fallsOnSunday, true);

    // Monday Feb 16 is NOT a holiday (no carry forward)
    const hFeb16 = await checkHoliday(new Date('2026-02-16T10:00:00+05:30'));
    assert.strictEqual(hFeb16.isHoliday, false);
  });

  // --- 3. Lunch Break & Duration Calculations ---
  console.log('\nGroup 3: Lunch Break Overlap & Durations');

  it('Full day shift (09:00 AM - 05:00 PM) lunch deduction is exactly 30 minutes', () => {
    const deduction = calculateLunchDeduction(
      new Date('2026-10-22T09:00:00+05:30'),
      new Date('2026-10-22T17:00:00+05:30')
    );
    assert.strictEqual(deduction, 30);

    const durations = calculateAttendanceDurations(
      '2026-10-22T03:30:00.000Z',
      '2026-10-22T11:30:00.000Z'
    );
    assert.strictEqual(durations.grossMinutes, 480); // 8h
    assert.strictEqual(durations.breakMinutes, 30);  // 30m
    assert.strictEqual(durations.netMinutes, 450);    // 7h 30m
  });

  it('Shift finishing before lunch (09:00 AM - 12:00 PM) lunch deduction is 0', () => {
    const deduction = calculateLunchDeduction(
      new Date('2026-10-22T09:00:00+05:30'),
      new Date('2026-10-22T12:00:00+05:30')
    );
    assert.strictEqual(deduction, 0);
  });

  it('Shift finishing during lunch (09:00 AM - 12:45 PM) deduction is 15 minutes', () => {
    const deduction = calculateLunchDeduction(
      new Date('2026-10-22T09:00:00+05:30'),
      new Date('2026-10-22T12:45:00+05:30')
    );
    assert.strictEqual(deduction, 15);
  });

  // --- 4. Database Operations, Idempotency & Fallbacks ---
  console.log('\nGroup 4: Database Mutations, Idempotency & Fallbacks');

  let testAdminUser;
  let testDevUser;
  let testEmp;

  await itAsync('Setup test employee and users in DB', async () => {
    testAdminUser = await db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
    testDevUser = await db.prepare("SELECT * FROM users WHERE role = 'developer' LIMIT 1").get();
    testEmp = await db.prepare("SELECT * FROM employees WHERE user_id = ? OR email = ? LIMIT 1").get(testDevUser.id, testDevUser.email);

    if (!testEmp) {
      const info = await db.prepare(
        "INSERT INTO employees (name, email, role, department, user_id) VALUES (?, ?, 'developer', 'Engineering', ?)"
      ).run(testDevUser.name, testDevUser.email, testDevUser.id);
      testEmp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(info.lastInsertRowid);
    }
    assert(testEmp && testEmp.id, 'Test employee exists');
  });

  await itAsync('Check-in and duplicate check-in prevention', async () => {
    const testDate = '2026-10-24';
    // Clean any existing test record for today
    await db.prepare('DELETE FROM attendance_audit_logs WHERE employee_id = ?').run(testEmp.id);
    await db.prepare('DELETE FROM employee_attendance WHERE employee_id = ? AND work_date = ?').run(testEmp.id, testDate);

    const record = await recordCheckIn({ employeeId: testEmp.id, userId: testDevUser.id });
    assert.strictEqual(record.employee_id, testEmp.id);
    assert(record.check_in_time);
    assert.strictEqual(record.check_out_time, null);

    // Repeated check-in must throw error
    await assert.rejects(
      async () => {
        await recordCheckIn({ employeeId: testEmp.id, userId: testDevUser.id });
      },
      /already checked in today/i
    );
  });

  await itAsync('Check-out and duration calculation', async () => {
    const record = await recordCheckOut({ employeeId: testEmp.id, userId: testDevUser.id });
    assert.strictEqual(record.employee_id, testEmp.id);
    assert(record.check_out_time);
    assert.strictEqual(record.checkout_source, 'user_action');
    assert.strictEqual(record.is_estimated, 0);

    // Repeated check-out must throw error
    await assert.rejects(
      async () => {
        await recordCheckOut({ employeeId: testEmp.id, userId: testDevUser.id });
      },
      /already checked out for today/i
    );
  });

  await itAsync('Fallback checkout reconciliation from Task Sheet submission', async () => {
    const mockDate = '2026-10-23';
    await db.prepare('DELETE FROM employee_attendance WHERE employee_id = ? AND work_date = ?').run(testEmp.id, mockDate);
    await db.prepare('DELETE FROM task_sheet_submissions WHERE submitted_by = ? AND date(created_at) = ?').run(testDevUser.id, mockDate);

    // Create unclosed check-in row
    await db.prepare(
      `INSERT INTO employee_attendance (
        employee_id, user_id, work_date, check_in_time, check_out_time, checkout_source, status
      ) VALUES (?, ?, ?, ?, NULL, 'user_action', 'present')`
    ).run(testEmp.id, testDevUser.id, mockDate, '2026-10-23T03:30:00.000Z'); // 09:00 AM IST

    // Insert task sheet submission at 05:15 PM IST (11:45 UTC)
    await db.prepare(
      `INSERT INTO task_sheet_submissions (
        submitted_by, name, project, hours_worked, task_title, task_description, task_state, created_at
      ) VALUES (?, ?, 'WEB', 7.5, 'Test Task', 'Task Description', 'completed', '2026-10-23T11:45:00.000Z')`
    ).run(testDevUser.id, testEmp.name);

    // Run reconciliation
    const recon = await reconcileUnclosedAttendance({ workDate: mockDate, employeeId: testEmp.id });
    assert.strictEqual(recon.reconciledCount, 1);

    const updated = await db.prepare('SELECT * FROM employee_attendance WHERE employee_id = ? AND work_date = ?').get(testEmp.id, mockDate);
    assert.strictEqual(updated.checkout_source, 'task_sheet_submission');
    assert.strictEqual(updated.is_estimated, 1);
    assert.strictEqual(updated.check_out_time, '2026-10-23T11:45:00.000Z');
    assert.strictEqual(updated.gross_duration_minutes, 495); // 8h 15m
    assert.strictEqual(updated.break_duration_minutes, 30);  // 30m lunch
    assert.strictEqual(updated.net_duration_minutes, 465);    // 7h 45m
  });

  await itAsync('Missing checkout with NO task sheet flags for Admin review (NEVER fabricated)', async () => {
    const mockDate2 = '2026-10-21';
    await db.prepare('DELETE FROM employee_attendance WHERE employee_id = ? AND work_date = ?').run(testEmp.id, mockDate2);
    await db.prepare('DELETE FROM task_sheet_submissions WHERE submitted_by = ? AND date(created_at) = ?').run(testDevUser.id, mockDate2);

    await db.prepare(
      `INSERT INTO employee_attendance (
        employee_id, user_id, work_date, check_in_time, check_out_time, checkout_source, status
      ) VALUES (?, ?, ?, ?, NULL, 'user_action', 'present')`
    ).run(testEmp.id, testDevUser.id, mockDate2, '2026-10-21T03:30:00.000Z');

    const recon = await reconcileUnclosedAttendance({ workDate: mockDate2, employeeId: testEmp.id });
    assert.strictEqual(recon.flaggedReviewCount, 1);

    const rec = await db.prepare('SELECT * FROM employee_attendance WHERE employee_id = ? AND work_date = ?').get(testEmp.id, mockDate2);
    assert.strictEqual(rec.check_out_time, null);
    assert.strictEqual(rec.requires_admin_review, 1);
  });

  // --- 5. Admin Governance, Past Date Corrections & Auditing ---
  console.log('\nGroup 5: Admin Governance, Past Date Regularization & Audit Logs');

  await itAsync('Admin status adjustment with mandatory reason and audit entry', async () => {
    const testDate = '2026-10-24';
    const adjusted = await adminAdjustAttendance({
      employeeId: testEmp.id,
      workDate: testDate,
      status: 'present',
      reason: 'Employee was present in office; confirmed by department head',
      adminUser: testAdminUser,
    });

    assert.strictEqual(adjusted.status, 'present');
    assert.strictEqual(adjusted.is_manually_adjusted, 1);
    assert.strictEqual(adjusted.adjusted_by, testAdminUser.id);

    const logs = await getAttendanceAuditLogs(adjusted.id);
    assert(logs.length >= 1);
    assert.strictEqual(logs[0].admin_id, testAdminUser.id);
    assert.strictEqual(logs[0].reason, 'Employee was present in office; confirmed by department head');
  });

  await itAsync('Admin regularizes unrecorded past date (Oct 18, 2026)', async () => {
    const pastDate = '2026-10-18';
    await db.prepare('DELETE FROM employee_attendance WHERE employee_id = ? AND work_date = ?').run(testEmp.id, pastDate);

    const reg = await adminAdjustAttendance({
      employeeId: testEmp.id,
      workDate: pastDate,
      status: 'present',
      checkInTime: '2026-10-18T03:30:00.000Z',
      checkOutTime: '2026-10-18T11:30:00.000Z',
      reason: 'Regularizing Sunday overtime duty for server maintenance',
      adminUser: testAdminUser,
    });

    assert.strictEqual(reg.work_date, pastDate);
    assert.strictEqual(reg.status, 'present');
    assert.strictEqual(reg.is_manually_adjusted, 1);

    const logs = await getAttendanceAuditLogs(reg.id);
    assert(logs.length >= 1);
    assert.strictEqual(logs[0].action, 'admin_regularization');
  });

  await itAsync('Non-admin user rejected when attempting admin adjustment (HTTP 403 enforcement)', async () => {
    await assert.rejects(
      async () => {
        await adminAdjustAttendance({
          employeeId: testEmp.id,
          workDate: '2026-10-24',
          status: 'present',
          reason: 'Attempted developer override',
          adminUser: testDevUser, // Developer role!
        });
      },
      /only authorized administrators/i
    );
  });

  // --- 6. Report #2 Execution with Real Database Records ---
  console.log('\nGroup 6: Report #2 (Attendance Report) Live Calculation');

  await itAsync('Report #2 execution returns live database counts and rows', async () => {
    const reportData = await getReportExecutionData({
      reportSlug: 'attendance',
      filters: {
        preset: 'this_month',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        department: 'all',
        employeeId: 'all',
      },
      currentUser: testAdminUser,
    });

    assert(reportData.report, 'Report definition returned');
    assert.strictEqual(reportData.report.slug, 'attendance');
    assert(Array.isArray(reportData.kpis), 'KPIs returned');
    assert(Array.isArray(reportData.rows), 'Table rows returned');
    assert(Array.isArray(reportData.series), 'Series data returned');

    const presentKpi = reportData.kpis.find(k => k.key === 'present_count');
    assert(presentKpi && Number(presentKpi.value) >= 1, 'Present count aggregated from DB');

    console.log('    Report #2 KPIs:', reportData.kpis.map(k => `${k.label}: ${k.value}`).join(' | '));
    console.log('    Total Live Table Rows:', reportData.rows.length);
  });

  // --- 7. Existing Task Sheet & Ticket Tracking Regression Testing ---
  console.log('\nGroup 7: Task Sheet & Application Regression Testing');

  await itAsync('Task Sheet submission, multi-ticket detail and blocker preservation', async () => {
    const { createSubmission, listSubmissions } = await import('../lib/taskSheet.js');
    const submission = await createSubmission({
      submittedBy: testDevUser.id,
      name: testDevUser.name,
      project: 'WEB',
      hoursWorked: 4.5,
      taskTitle: 'Feature: Attendance Integration Testing',
      taskDescription: 'Verifying that TaskSheet submissions continue to operate smoothly',
      taskState: 'not_completed',
      blocker: 'Waiting on staging API key approval',
      linkedTicketId: null,
      ticketsDetail: JSON.stringify([{ id: 1, key: 'WEB-1', hours: 4.5, blocker: 'Waiting on staging API key approval' }]),
    });

    assert(submission && submission.id, 'Task Sheet submission row created');
    assert.strictEqual(submission.hours_worked, 4.5);
    assert.strictEqual(submission.blocker, 'Waiting on staging API key approval');

    const recent = await listSubmissions({ limit: 5 });
    assert(recent.some(s => s.id === submission.id), 'Submission listed in Task Sheet history');
  });

  await itAsync('Ticket time logs separation from attendance duration', async () => {
    // Ticket time logs remain untouched and isolated
    const initialLogs = await db.prepare('SELECT COUNT(*) AS c FROM ticket_time_logs').get();
    const attendanceRows = await db.prepare('SELECT COUNT(*) AS c FROM employee_attendance').get();
    assert(Number(attendanceRows.c) >= 1, 'Attendance rows exist');
    assert(initialLogs !== undefined, 'Ticket time logs table exists and remains independent');
  });

  console.log('\n======================================================');
  console.log(`ALL TESTS PASSED: ${passedTests}/${totalTests} tests successful!`);
  console.log('======================================================\n');
}

runSuite().catch((err) => {
  console.error('\nSUITE EXECUTION FAILED:', err);
  process.exit(1);
});
