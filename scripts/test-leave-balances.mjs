import assert from 'assert';
import { db } from '../lib/db.js';
import {
  getFinancialYear,
  calculateNewJoinerProRata,
  getLeavePolicySettings,
  updateLeavePolicySettings,
  ensureEmployeeLeaveBalances,
  getEmployeeLeaveBalances,
  adminAdjustLeaveBalance,
  getLeaveBalanceAdjustments,
  performAnnualRollover,
  submitLeaveRequest,
  adminProcessLeaveRequest,
  cancelLeaveRequest,
} from '../lib/attendance.js';
import { calculateReportData } from '../lib/reportCalculators.js';

let passed = 0;
let totalTests = 0;

async function asyncTest(name, fn) {
  totalTests += 1;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log('========================================================================');
console.log('STARTING ENHANCED LEAVE BALANCES & POLICY ENGINE TEST SUITE');
console.log('========================================================================\n');

// Mock admin and employee objects
let adminUser;
let testEmpId;
let testUserId;
const createdEmpIds = new Set();
const createdUserIds = new Set();

async function run() {
  try {
  // Setup isolated test employee
  await asyncTest('Setup test fixtures for leave balance tests', async () => {
    adminUser = await db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
    let user = await db.prepare("SELECT * FROM users WHERE email = 'leavetest@example.com'").get();
    let emp = await db.prepare("SELECT * FROM employees WHERE email = 'leavetest@example.com'").get();

    if (!user) {
      const res = await db.prepare(
        "INSERT INTO users (name, email, password, role) VALUES ('Leave Test User', 'leavetest@example.com', 'password', 'developer')"
      ).run();
      user = { id: Number(res.lastInsertRowid || res.rows?.[0]?.id) };
    }
    if (!emp) {
      const res = await db.prepare(
        "INSERT INTO employees (user_id, name, email, department, employment_type, joining_date, role) VALUES (?, 'Leave Test User', 'leavetest@example.com', 'Engineering', 'full_time', '2026-04-01', 'developer')"
      ).run(user.id);
      emp = { id: Number(res.lastInsertRowid || res.rows?.[0]?.id) };
    }

    testUserId = Number(user.id);
    testEmpId = Number(emp.id);
    createdUserIds.add(testUserId);
    createdEmpIds.add(testEmpId);

    // Set joining_date to 2026-04-01 (start of FY) for baseline full entitlement tests
    await db.prepare("UPDATE employees SET joining_date = '2026-04-01', employment_type = 'full_time' WHERE id = ?").run(testEmpId);

    // Clean up any old leave test rows for this test employee
    await db.prepare('DELETE FROM attendance_audit_logs WHERE employee_id = ?').run(testEmpId);
    await db.prepare('DELETE FROM employee_attendance WHERE employee_id = ?').run(testEmpId);
    await db.prepare('DELETE FROM employee_leave_requests WHERE employee_id = ?').run(testEmpId);
    await db.prepare('DELETE FROM leave_balances WHERE employee_id = ?').run(testEmpId);
    await db.prepare('DELETE FROM leave_balance_adjustments WHERE employee_id = ?').run(testEmpId);

    assert.ok(testEmpId > 0);
  });

  // 1. Upfront Annual Entitlement & Zero Gradual Accrual
  await asyncTest('1. Upfront Entitlement: 7.0d CL & 7.0d SL granted immediately on 1 April without monthly accrual', async () => {
    const balances = await getEmployeeLeaveBalances({
      employeeId: testEmpId,
      dateInput: '2026-04-05', // 5 days after FY start
    });

    assert.strictEqual(balances.fiscalYear, '2026-2027');
    assert.strictEqual(balances.categories.casual.annualEntitlement, 7.0);
    assert.strictEqual(balances.categories.casual.accruedEntitlement, 7.0);
    assert.strictEqual(balances.categories.casual.remainingBalance, 7.0);
    assert.strictEqual(balances.categories.casual.carriedForward, 0.0);

    assert.strictEqual(balances.categories.sick.annualEntitlement, 7.0);
    assert.strictEqual(balances.categories.sick.accruedEntitlement, 7.0);
    assert.strictEqual(balances.categories.sick.remainingBalance, 7.0);

    // Company holidays are isolated
    assert.strictEqual(balances.categories.holidays.totalEntitlement >= 13, true);
  });

  // 2. Advance Leave without monthly deficit penalty
  await asyncTest('2. Advance Leave: Full 7.0d balance is usable in April without deficit penalty', async () => {
    const balances = await getEmployeeLeaveBalances({
      employeeId: testEmpId,
      dateInput: '2026-04-10',
    });
    // Entitlement is immediately available on day 1
    assert.strictEqual(balances.categories.casual.remainingBalance >= 7.0, true);
  });

  // 3. New Joiner Pro-Rata Entitlement (Day-Count vs Whole-Month)
  await asyncTest('3. New Joiner Pro-Rata: Day-count precision calculates pro-rata entitlement correctly', async () => {
    // Joining on 2026-10-01 (halfway through 365-day FY)
    const proRataDayCount = calculateNewJoinerProRata({
      joiningDate: '2026-10-01',
      fiscalYearStart: '2026-04-01',
      fiscalYearEnd: '2027-03-31',
      annualQuota: 7.0,
      method: 'day_count',
    });
    // ~182 days remaining out of 365 => 3.5 days
    assert.strictEqual(proRataDayCount, 3.5);

    // Joining on 2026-10-16 with whole_month (post-15th cut-off => November onwards = 5 months)
    const proRataWholeMonthPost15 = calculateNewJoinerProRata({
      joiningDate: '2026-10-16',
      fiscalYearStart: '2026-04-01',
      fiscalYearEnd: '2027-03-31',
      annualQuota: 7.0,
      method: 'whole_month',
    });
    // 5 months / 12 * 7.0 = 2.916 => rounded to 2.9d
    assert.strictEqual(proRataWholeMonthPost15, 2.9);

    // Joining on 2026-10-10 with whole_month (pre-15th cut-off => October onwards = 6 months)
    const proRataWholeMonthPre15 = calculateNewJoinerProRata({
      joiningDate: '2026-10-10',
      fiscalYearStart: '2026-04-01',
      fiscalYearEnd: '2027-03-31',
      annualQuota: 7.0,
      method: 'whole_month',
    });
    // 6 months / 12 * 7.0 = 3.5d
    assert.strictEqual(proRataWholeMonthPre15, 3.5);
  });

  // 3b. Flat 7.0d Entitlement for New Joiners
  await asyncTest('3b. Flat 7.0d Entitlement: New joiner joining mid-year receives full 7.0d CL and SL upfront without pro-rata', async () => {
    // Create new joiner joining mid-year in October
    const uniqueEmail = `midyear_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
    const newJoinerInfo = await db.prepare(`
      INSERT INTO employees (name, email, department, role, active, joining_date, employment_type)
      VALUES ('Mid-Year Joiner', ?, 'Engineering', 'developer', 1, '2026-10-15', 'full_time')
    `).run(uniqueEmail);
    const newJoinerId = Number(newJoinerInfo.lastInsertRowid || newJoinerInfo.rows?.[0]?.id);
    createdEmpIds.add(newJoinerId);

    const balances = await getEmployeeLeaveBalances({ employeeId: newJoinerId, dateInput: '2026-10-15' });
    assert.strictEqual(balances.categories.casual.annualEntitlement, 7.0, 'Casual leave must be full 7.0d');
    assert.strictEqual(balances.categories.sick.annualEntitlement, 7.0, 'Sick leave must be full 7.0d');
    assert.strictEqual(balances.categories.casual.remainingBalance, 7.0, 'Casual remaining must be full 7.0d');
    assert.strictEqual(balances.categories.sick.remainingBalance, 7.0, 'Sick remaining must be full 7.0d');
  });

  // 4. Prior Date Guard for Non-Sick Leave
  await asyncTest('4. Prior Date Guard: Non-sick leave cannot be applied for historical dates', async () => {
    let errorCaught = false;
    try {
      await submitLeaveRequest({
        employeeId: testEmpId,
        userId: testUserId,
        leaveType: 'casual',
        dayType: 'full_day',
        startDate: '2026-01-01', // Past date
        endDate: '2026-01-01',
        reason: 'Casual day off in the past',
      });
    } catch (err) {
      errorCaught = true;
      assert.strictEqual(err.message.includes('previous date'), true);
    }
    assert.strictEqual(errorCaught, true);
  });

  // 5. Post-facto Medical Sick Leave Allowed
  await asyncTest('5. Post-facto Sick Leave: Sick leave is permitted for past medical dates', async () => {
    // Sick leave should be accepted even if prior date
    const req = await submitLeaveRequest({
      employeeId: testEmpId,
      userId: testUserId,
      leaveType: 'sick',
      dayType: 'full_day',
      startDate: '2026-04-06', // Monday
      endDate: '2026-04-06',
      reason: 'High fever and medical consultation',
    });
    assert.ok(req.id > 0);
    assert.strictEqual(req.leave_type, 'sick');

    // Clean up
    await db.prepare('DELETE FROM employee_leave_requests WHERE id = ?').run(req.id);
  });

  // 6. Optional Leave Policy Gate
  await asyncTest('6. Optional Leave Gate: Blocked when disabled, allowed when configured', async () => {
    // 1. Ensure disabled
    await updateLeavePolicySettings({ optionalLeaveEnabled: false, adminUser });

    let errorCaught = false;
    try {
      await submitLeaveRequest({
        employeeId: testEmpId,
        userId: testUserId,
        leaveType: 'optional',
        dayType: 'full_day',
        startDate: '2026-11-10',
        endDate: '2026-11-10',
        reason: 'Optional festival leave',
      });
    } catch (err) {
      errorCaught = true;
      console.log('Test 6 caught err:', err.message);
      assert.strictEqual(err.message.includes('not enabled') || err.message.includes('disabled') || err.message.includes('Optional Leave'), true);
    }
    assert.strictEqual(errorCaught, true);

    // 2. Enable Optional Leave with 2.0 days
    await updateLeavePolicySettings({ optionalLeaveEnabled: true, optionalLeaveDays: 2.0, adminUser });
    const reqOpt = await submitLeaveRequest({
      employeeId: testEmpId,
      userId: testUserId,
      leaveType: 'optional',
      dayType: 'full_day',
      startDate: '2026-11-10',
      endDate: '2026-11-10',
      reason: 'Optional festival celebration',
    });
    assert.ok(reqOpt.id > 0);

    // Clean up request and restore disabled
    await db.prepare('DELETE FROM employee_leave_requests WHERE id = ?').run(reqOpt.id);
    await updateLeavePolicySettings({ optionalLeaveEnabled: false, optionalLeaveDays: 0.0, adminUser });
  });

  // 7. Leave Approval & Balance Formula Verification
  await asyncTest('7. Balance Formula: Approval of 2.0d Casual Leave correctly updates remaining balance to 5.0d', async () => {
    // Submit 2 days casual leave: 2026-11-16 (Mon) to 2026-11-17 (Tue)
    const req = await submitLeaveRequest({
      employeeId: testEmpId,
      userId: testUserId,
      leaveType: 'casual',
      dayType: 'full_day',
      startDate: '2026-11-16',
      endDate: '2026-11-17',
      reason: 'Personal family event',
    });

    // Approve the leave request
    const approved = await adminProcessLeaveRequest({
      requestId: req.id,
      action: 'approve',
      adminUser,
      reviewerNotes: 'Approved by SerpHawk Admin',
    });
    assert.strictEqual(approved.status, 'approved');
    assert.strictEqual(approved.paid_days, 2.0);
    assert.strictEqual(approved.lop_days, 0.0);

    // Verify balances: (7.0 annual + 0 CF + 0 Adj) - 2.0 approved = 5.0 remaining
    const balances = await getEmployeeLeaveBalances({
      employeeId: testEmpId,
      dateInput: '2026-11-20',
    });
    assert.strictEqual(balances.categories.casual.approvedDays, 2.0);
    assert.strictEqual(balances.categories.casual.remainingBalance, 5.0);
  });

  // 8. Cancellation of Approved Leave Restores Balance
  await asyncTest('8. Cancellation: Cancelling approved leave restores remaining balance from 5.0d back to 7.0d', async () => {
    const approvedReq = await db.prepare(
      "SELECT id FROM employee_leave_requests WHERE employee_id = ? AND leave_type = 'casual' AND status = 'approved' ORDER BY id DESC LIMIT 1"
    ).get(testEmpId);

    await cancelLeaveRequest({
      requestId: approvedReq.id,
      adminUser,
      cancelReason: 'Trip cancelled, returning to work',
    });

    const balances = await getEmployeeLeaveBalances({
      employeeId: testEmpId,
      dateInput: '2026-11-20',
    });
    assert.strictEqual(balances.categories.casual.approvedDays, 0.0);
    assert.strictEqual(balances.categories.casual.cancelledDays, 2.0);
    assert.strictEqual(balances.categories.casual.remainingBalance, 7.0);
  });

  // 9. Loss of Pay (LOP) Split Allocation across multi-day request
  await asyncTest('9. LOP Separation: Request exceeding balance splits paid days and LOP days with zero deduction from other categories', async () => {
    // First, set sick leave remaining balance to 2.0 days via admin adjustment
    await adminAdjustLeaveBalance({
      employeeId: testEmpId,
      fiscalYear: '2026-2027',
      leaveType: 'sick',
      adjustmentType: 'entitlement',
      newValue: 2.0,
      reason: 'Set initial SL entitlement to 2.0 for LOP split test',
      adminUser,
    });

    const initialBalances = await getEmployeeLeaveBalances({
      employeeId: testEmpId,
      dateInput: '2026-12-01',
    });
    assert.strictEqual(initialBalances.categories.sick.remainingBalance, 2.0);
    assert.strictEqual(initialBalances.categories.casual.remainingBalance, 7.0);

    // Submit 4-day sick leave: 2026-12-07 (Mon) to 2026-12-10 (Thu) = 4 working days
    const req = await submitLeaveRequest({
      employeeId: testEmpId,
      userId: testUserId,
      leaveType: 'sick',
      dayType: 'full_day',
      startDate: '2026-12-07',
      endDate: '2026-12-10',
      reason: 'Extended medical recovery',
    });
    assert.strictEqual(req.total_working_days, 4.0);

    // Admin explicitly authorizes 2.0 paid days and 2.0 LOP days
    const processed = await adminProcessLeaveRequest({
      requestId: req.id,
      action: 'approve',
      adminUser,
      reviewerNotes: 'Approved 2.0d paid + 2.0d Loss of Pay',
      authorizedPaidDays: 2.0,
      authorizedLopDays: 2.0,
    });

    assert.strictEqual(processed.status, 'approved');
    assert.strictEqual(processed.paid_days, 2.0);
    assert.strictEqual(processed.lop_days, 2.0);

    // Check Sick Leave balance: remaining becomes 0.0d
    const postBalances = await getEmployeeLeaveBalances({
      employeeId: testEmpId,
      dateInput: '2026-12-15',
    });
    assert.strictEqual(postBalances.categories.sick.approvedDays, 2.0);
    assert.strictEqual(postBalances.categories.sick.remainingBalance, 0.0);

    // Casual Leave balance MUST NOT BE TOUCHED
    assert.strictEqual(postBalances.categories.casual.remainingBalance, 7.0);

    // Inspect individual attendance records for the 4 dates
    const attRows = await db.prepare(
      'SELECT work_date, status, paid_leave_days, lop_days, is_lop FROM employee_attendance WHERE employee_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date'
    ).all(testEmpId, '2026-12-07', '2026-12-10');

    assert.strictEqual(attRows.length, 4);
    // First 2 days are paid leave
    assert.strictEqual(attRows[0].paid_leave_days, 1.0);
    assert.strictEqual(attRows[0].lop_days, 0.0);
    assert.strictEqual(attRows[0].is_lop, 0);

    assert.strictEqual(attRows[1].paid_leave_days, 1.0);
    assert.strictEqual(attRows[1].lop_days, 0.0);
    assert.strictEqual(attRows[1].is_lop, 0);

    // Last 2 days are LOP
    assert.strictEqual(attRows[2].paid_leave_days, 0.0);
    assert.strictEqual(attRows[2].lop_days, 1.0);
    assert.strictEqual(attRows[2].is_lop, 1);

    assert.strictEqual(attRows[3].paid_leave_days, 0.0);
    assert.strictEqual(attRows[3].lop_days, 1.0);
    assert.strictEqual(attRows[3].is_lop, 1);
  });

  // 10. Report #2 Reconciliation without Double-Counting
  await asyncTest('10. Report #2: Itemizes approved paid days (2.0) and LOP days (2.0) distinctly without double-counting', async () => {
    const reportDef = { slug: 'attendance', name: 'Employee Attendance & Punctuality Report' };
    const allEmployees = await db.prepare('SELECT * FROM employees').all();

    const reportData = await calculateReportData({
      reportDef,
      allEmployees,
      dateRange: { startDate: '2026-12-01', endDate: '2026-12-31' },
      appliedFilters: { department: 'all', employee_id: String(testEmpId), preset: 'custom' },
    });

    const leaveKpi = reportData.kpis.find((k) => k.key === 'approved_leaves_count');
    assert.strictEqual(leaveKpi.value, 2.0);

    // Verify employee rows in Report #2: 4 total leave records, 2 are LOP and 2 are paid
    const empRows = reportData.rows.filter((r) => r.employee_name === 'Leave Test User');
    const lopRows = empRows.filter((r) => r.status.includes('Loss of Pay') || r.status.includes('LOP'));
    const onLeaveRows = empRows.filter((r) => r.status.includes('On Leave'));

    assert.strictEqual(onLeaveRows.length, 4);
    assert.strictEqual(lopRows.length, 2);
  });

  // 11. Admin Balance Adjustment Validation & Audit Log
  await asyncTest('11. Balance Adjustment: Mandatory >=5 chars reason, records audit row', async () => {
    // Reason too short (< 5 chars)
    let shortReasonError = false;
    try {
      await adminAdjustLeaveBalance({
        employeeId: testEmpId,
        fiscalYear: '2026-2027',
        leaveType: 'sick',
        adjustmentType: 'balance_adjustment',
        newValue: 1.0,
        reason: 'bad', // < 5 chars
        adminUser,
      });
    } catch (err) {
      shortReasonError = true;
      assert.strictEqual(err.message.includes('mandatory reason of at least 5 characters'), true);
    }
    assert.strictEqual(shortReasonError, true);

    // Valid adjustment with 5+ chars reason
    await adminAdjustLeaveBalance({
      employeeId: testEmpId,
      fiscalYear: '2026-2027',
      leaveType: 'sick',
      adjustmentType: 'balance_adjustment',
      newValue: 3.0,
      reason: 'Compensatory sick leave credit for weekend maintenance',
      adminUser,
    });

    const audits = await getLeaveBalanceAdjustments({ employeeId: testEmpId });
    assert.ok(audits.length > 0);
    const latest = audits[0];
    assert.strictEqual(latest.leave_type, 'sick');
    assert.strictEqual(latest.new_value, 3.0);
    assert.strictEqual(latest.reason, 'Compensatory sick leave credit for weekend maintenance');
  });

  // 12. Idempotency & Duplicate Rejection on Balance Adjustment
  await asyncTest('12. Idempotency: SHA-256 duplicate adjustment is safely rejected', async () => {
    const uniqueKey = 'TEST-IDEMP-KEY-9999';

    // First run with custom key
    await adminAdjustLeaveBalance({
      employeeId: testEmpId,
      fiscalYear: '2026-2027',
      leaveType: 'casual',
      adjustmentType: 'balance_adjustment',
      newValue: 1.0,
      reason: 'Idempotency test adjustment credit',
      adminUser,
      idempotencyKey: uniqueKey,
    });

    // Second run with duplicate key must be rejected
    let duplicateRejected = false;
    try {
      await adminAdjustLeaveBalance({
        employeeId: testEmpId,
        fiscalYear: '2026-2027',
        leaveType: 'casual',
        adjustmentType: 'balance_adjustment',
        newValue: 1.0,
        reason: 'Idempotency test adjustment credit',
        adminUser,
        idempotencyKey: uniqueKey,
      });
    } catch (err) {
      duplicateRejected = true;
      assert.strictEqual(err.message.includes('Duplicate adjustment request'), true);
    }
    assert.strictEqual(duplicateRejected, true);
  });

  // 13. Optimistic Concurrency Control
  await asyncTest('13. Optimistic Concurrency: Throws 409 conflict when expectedPreviousValue does not match', async () => {
    let conflictCaught = false;
    try {
      await adminAdjustLeaveBalance({
        employeeId: testEmpId,
        fiscalYear: '2026-2027',
        leaveType: 'sick',
        adjustmentType: 'balance_adjustment',
        newValue: 5.0,
        reason: 'Optimistic lock conflict test',
        adminUser,
        expectedPreviousValue: 99.0, // Stale / incorrect expected value
      });
    } catch (err) {
      conflictCaught = true;
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.message.includes('Optimistic lock failure'), true);
    }
    assert.strictEqual(conflictCaught, true);
  });

  // 14. Historical Preceding FY Correction
  await asyncTest('14. Historical Correction: Restricted strictly to FY_{N-1}, safely updates closing SL & syncs current CF', async () => {
    // Current FY is 2026-2027. Preceding FY is 2025-2026.
    // 1. Setting up historical row for 2025-2026
    await db.prepare(`
      INSERT INTO leave_balances (
        employee_id, fiscal_year, leave_type, annual_entitlement, carried_forward, manual_adjustment
      ) VALUES (?, '2025-2026', 'sick', 7.0, 0.0, 0.0)
      ON CONFLICT (employee_id, fiscal_year, leave_type) DO UPDATE SET
        annual_entitlement = excluded.annual_entitlement,
        carried_forward = excluded.carried_forward,
        manual_adjustment = excluded.manual_adjustment
    `).run(testEmpId);

    // Apply historical correction to 2025-2026 carry_forward: setting it to 4.0d
    await adminAdjustLeaveBalance({
      employeeId: testEmpId,
      fiscalYear: '2025-2026',
      leaveType: 'sick',
      adjustmentType: 'historical_correction',
      newValue: 4.0, // Correcting CF of 2025-2026 to 4.0d
      reason: 'Prior financial year audit reconciliation',
      adminUser,
    });

    // Verify active year (2026-2027) carry-forward has safely synced
    const activeBalances = await getEmployeeLeaveBalances({
      employeeId: testEmpId,
      dateInput: '2026-07-01',
    });
    // Active SL carried-forward is now updated cleanly from the corrected closing balance
    assert.strictEqual(activeBalances.categories.sick.carriedForward > 0, true);
  });

  // 15. Attempting Historical Correction Older than FY_{N-1} Blocked
  await asyncTest('15. Historical Guard: Corrections for FY older than FY_{N-1} are strictly blocked', async () => {
    let olderBlocked = false;
    try {
      await adminAdjustLeaveBalance({
        employeeId: testEmpId,
        fiscalYear: '2024-2025', // 2 years back
        leaveType: 'sick',
        adjustmentType: 'historical_correction',
        newValue: 5.0,
        reason: 'Too old historical correction',
        adminUser,
      });
    } catch (err) {
      olderBlocked = true;
      assert.strictEqual(err.message.includes('restricted to the immediately preceding'), true);
    }
    assert.strictEqual(olderBlocked, true);
  });

  // 16. Annual Rollover & Strict Idempotency (Running 5x)
  await asyncTest('16. Rollover Idempotency: Executing 1 April rollover 5 consecutive times produces identical state', async () => {
    // Target rollover into next FY 2027-2028
    const targetFy = '2027-2028';

    // Run rollover 5 consecutive times
    let result1, result5;
    for (let i = 1; i <= 5; i++) {
      const res = await performAnnualRollover({ targetFiscalYear: targetFy, adminUser });
      if (i === 1) result1 = res;
      if (i === 5) result5 = res;
    }

    assert.ok(result1.employeesProcessed > 0, 'Rollover created/ensured rows on run 1');

    // Inspect employee leave balances for 2027-2028
    const rowCL = await db.prepare(
      "SELECT * FROM leave_balances WHERE employee_id = ? AND fiscal_year = ? AND leave_type = 'casual'"
    ).get(testEmpId, targetFy);

    const rowSL = await db.prepare(
      "SELECT * FROM leave_balances WHERE employee_id = ? AND fiscal_year = ? AND leave_type = 'sick'"
    ).get(testEmpId, targetFy);

    // 1. Casual Leave: strictly 0 carry-forward, exactly 7.0 annual entitlement
    assert.strictEqual(rowCL.carried_forward, 0.0);
    assert.strictEqual(rowCL.annual_entitlement, 7.0);

    // 2. Sick Leave: exactly 7.0 annual entitlement (not 7.0 * 5 = 35.0)
    assert.strictEqual(rowSL.annual_entitlement, 7.0);

    // 3. Confirm that running 5 times did not duplicate rows
    const allRows = await db.prepare(
      'SELECT COUNT(*) as c FROM leave_balances WHERE employee_id = ? AND fiscal_year = ?'
    ).get(testEmpId, targetFy);

    assert.strictEqual(allRows.c, 3); // exactly 3 rows: casual, sick, optional
  });

  } finally {
    // Guaranteed isolation cleanup: delete all test data generated by THIS run
    for (const empId of createdEmpIds) {
      await db.prepare('DELETE FROM employee_attendance WHERE employee_id = ?').run(empId).catch(() => {});
      await db.prepare('DELETE FROM employee_leave_requests WHERE employee_id = ?').run(empId).catch(() => {});
      await db.prepare('DELETE FROM leave_balance_adjustments WHERE employee_id = ?').run(empId).catch(() => {});
      await db.prepare('DELETE FROM leave_balances WHERE employee_id = ?').run(empId).catch(() => {});
      await db.prepare('DELETE FROM attendance_audit_logs WHERE employee_id = ?').run(empId).catch(() => {});
      await db.prepare('DELETE FROM employees WHERE id = ?').run(empId).catch(() => {});
    }
    for (const uId of createdUserIds) {
      await db.prepare('DELETE FROM users WHERE id = ?').run(uId).catch(() => {});
    }
  }

  console.log('\n========================================================================');
  console.log(`ALL TESTS PASSED! (${passed}/${totalTests})`);
  console.log('========================================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
