import assert from 'assert';
import { db } from '../lib/db.js';
import {
  getEmployeeLeaveBalances,
  submitLeaveRequest,
  syncEmployeeEmploymentTypeLeaveEligibility,
  getCompanyHolidays,
} from '../lib/attendance.js';
import { updateEmployee } from '../lib/employees.js';

let testsPassed = 0;
let testsFailed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    testsFailed++;
  }
}

async function run() {
  console.log('========================================================================');
  console.log('LEAVE ELIGIBILITY & AUTOMATIC ALLOCATION SUITE');
  console.log('========================================================================\n');

  // Setup test tracking for guaranteed cleanup
  const createdEmployeeIds = new Set();
  const createdUserIds = new Set();
  const createdLeaveRequestIds = new Set();

  const timestamp = Date.now();
  const testAdminUser = { id: 1, name: 'Admin User', role: 'admin' };

  async function createTestEmployee(empType, name) {
    const email = `test_${empType}_${timestamp}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const uInfo = await db.prepare(`
      INSERT INTO users (name, email, password, role)
      VALUES (?, ?, 'dummy_hash', 'developer')
    `).run(name, email);
    const userId = Number(uInfo.lastInsertRowid || uInfo.rows?.[0]?.id);

    const eInfo = await db.prepare(`
      INSERT INTO employees (name, email, role, department, active, joining_date, employment_type, user_id)
      VALUES (?, ?, 'developer', 'Engineering', 1, '2026-10-15', ?, ?)
    `).run(name, email, empType, userId);
    const employeeId = Number(eInfo.lastInsertRowid || eInfo.rows?.[0]?.id);

    createdUserIds.add(userId);
    createdEmployeeIds.add(employeeId);

    return { userId, employeeId, email, name, empType };
  }

  const configuredHolidays = await getCompanyHolidays();
  const expectedHolidaysCount = configuredHolidays.length;

  try {
  console.log('--- 1. Eligibility Tests by Employment Type ---');

  // 1. Full-Time Employee (FTE)
  await test('1. Full-Time Employee (FTE): eligible for 7.0d CL, 7.0d SL, and 13d Holidays', async () => {
    const emp = await createTestEmployee('full_time', 'Full Time Tester');
    const balances = await getEmployeeLeaveBalances({ employeeId: emp.employeeId });

    assert.strictEqual(balances.categories.casual.annualEntitlement, 7.0);
    assert.strictEqual(balances.categories.casual.remainingBalance, 7.0);
    assert.strictEqual(balances.categories.casual.isEligible, true);

    assert.strictEqual(balances.categories.sick.annualEntitlement, 7.0);
    assert.strictEqual(balances.categories.sick.remainingBalance, 7.0);
    assert.strictEqual(balances.categories.sick.isEligible, true);

    assert.strictEqual(balances.categories.holidays.totalEntitlement, expectedHolidaysCount);
  });

  // 2. Part-Time Employee
  await test('2. Part-Time Employee: ineligible for CL (0d), eligible for 7.0d SL & Holidays', async () => {
    const emp = await createTestEmployee('part_time', 'Part Time Tester');
    const balances = await getEmployeeLeaveBalances({ employeeId: emp.employeeId });

    assert.strictEqual(balances.categories.casual.annualEntitlement, 0.0);
    assert.strictEqual(balances.categories.casual.remainingBalance, 0.0);
    assert.strictEqual(balances.categories.casual.isEligible, false);

    assert.strictEqual(balances.categories.sick.annualEntitlement, 7.0);
    assert.strictEqual(balances.categories.sick.remainingBalance, 7.0);
    assert.strictEqual(balances.categories.sick.isEligible, true);

    assert.strictEqual(balances.categories.holidays.totalEntitlement, expectedHolidaysCount);
  });

  // 3. Intern
  await test('3. Intern: ineligible for CL (0d), eligible for 7.0d SL & Holidays', async () => {
    const emp = await createTestEmployee('intern', 'Intern Tester');
    const balances = await getEmployeeLeaveBalances({ employeeId: emp.employeeId });

    assert.strictEqual(balances.categories.casual.annualEntitlement, 0.0);
    assert.strictEqual(balances.categories.casual.remainingBalance, 0.0);
    assert.strictEqual(balances.categories.casual.isEligible, false);

    assert.strictEqual(balances.categories.sick.annualEntitlement, 7.0);
    assert.strictEqual(balances.categories.sick.remainingBalance, 7.0);
    assert.strictEqual(balances.categories.sick.isEligible, true);

    assert.strictEqual(balances.categories.holidays.totalEntitlement, expectedHolidaysCount);
  });

  // 4. Employee on Probation
  await test('4. Employee on Probation: ineligible for CL (0d), eligible for 7.0d SL & Holidays', async () => {
    const emp = await createTestEmployee('probation', 'Probation Tester');
    const balances = await getEmployeeLeaveBalances({ employeeId: emp.employeeId });

    assert.strictEqual(balances.categories.casual.annualEntitlement, 0.0);
    assert.strictEqual(balances.categories.casual.remainingBalance, 0.0);
    assert.strictEqual(balances.categories.casual.isEligible, false);

    assert.strictEqual(balances.categories.sick.annualEntitlement, 7.0);
    assert.strictEqual(balances.categories.sick.remainingBalance, 7.0);
    assert.strictEqual(balances.categories.sick.isEligible, true);

    assert.strictEqual(balances.categories.holidays.totalEntitlement, expectedHolidaysCount);
  });

  // 5. Freelancer
  await test('5. Freelancer: ineligible for CL (0d), eligible for 7.0d SL & Holidays', async () => {
    const emp = await createTestEmployee('freelancer', 'Freelancer Tester');
    const balances = await getEmployeeLeaveBalances({ employeeId: emp.employeeId });

    assert.strictEqual(balances.categories.casual.annualEntitlement, 0.0);
    assert.strictEqual(balances.categories.casual.remainingBalance, 0.0);
    assert.strictEqual(balances.categories.casual.isEligible, false);

    assert.strictEqual(balances.categories.sick.annualEntitlement, 7.0);
    assert.strictEqual(balances.categories.sick.remainingBalance, 7.0);
    assert.strictEqual(balances.categories.sick.isEligible, true);

    assert.strictEqual(balances.categories.holidays.totalEntitlement, expectedHolidaysCount);
  });

  console.log('\n--- 2. Leave Application Rejection for Ineligible Roles ---');

  // 6. Backend rejects CL request from ineligible role
  await test('6. Backend API blocks CL request from Intern with HTTP 400 error message', async () => {
    const emp = await createTestEmployee('intern', 'Intern Attempting CL');
    let errorCaught = false;
    try {
      await submitLeaveRequest({
        employeeId: emp.employeeId,
        userId: emp.userId,
        leaveType: 'casual',
        dayType: 'full_day',
        startDate: '2026-11-10',
        endDate: '2026-11-10',
        reason: 'Attempting casual leave as an intern',
      });
    } catch (err) {
      errorCaught = true;
      assert.strictEqual(err.message.includes('Casual Leave is only available to Full-Time Employees'), true);
    }
    assert.strictEqual(errorCaught, true);
  });

  // 7. Eligible to request Sick Leave
  await test('7. Intern CAN successfully apply for Sick Leave', async () => {
    const emp = await createTestEmployee('intern', 'Intern Requesting SL');
    const req = await submitLeaveRequest({
      employeeId: emp.employeeId,
      userId: emp.userId,
      leaveType: 'sick',
      dayType: 'full_day',
      startDate: '2026-11-10',
      endDate: '2026-11-10',
      reason: 'Doctor appointment for fever',
    });
    if (req?.id) createdLeaveRequestIds.add(req.id);
    assert.strictEqual(req.leave_type, 'sick');
    assert.strictEqual(req.status, 'pending');
  });

  console.log('\n--- 3. Automatic Casual Leave Allocation on Transition ---');

  // 8. Intern -> Full-Time Employee
  await test('8. Transition Intern -> Full-Time credits 7.0d Casual Leave with clear audit reason', async () => {
    const emp = await createTestEmployee('intern', 'Intern Becoming FTE');
    // Ensure initial balance has 0d CL
    let bal = await getEmployeeLeaveBalances({ employeeId: emp.employeeId });
    assert.strictEqual(bal.categories.casual.annualEntitlement, 0.0);

    // Update employment type to full_time
    await updateEmployee(emp.employeeId, { employment_type: 'full_time' });
    bal = await syncEmployeeEmploymentTypeLeaveEligibility({
      employeeId: emp.employeeId,
      oldType: 'intern',
      newType: 'full_time',
      adminUser: testAdminUser,
    });

    assert.strictEqual(bal.categories.casual.annualEntitlement, 7.0);
    assert.strictEqual(bal.categories.casual.remainingBalance, 7.0);
    assert.strictEqual(bal.categories.casual.isEligible, true);

    // Verify audit log row
    const auditRows = await db.prepare(`
      SELECT * FROM leave_balance_adjustments
      WHERE employee_id = ? AND leave_type = 'casual'
    `).all(emp.employeeId);
    assert.strictEqual(auditRows.length, 1);
    assert.strictEqual(auditRows[0].reason, 'Casual Leave entitlement granted after employment type changed to Full-Time Employee.');
    assert.strictEqual(Number(auditRows[0].delta), 7.0);
  });

  // 9. Repeated Admin Saves / Retries do NOT duplicate allocation
  await test('9. Idempotency: Repeated saves and retries do NOT credit duplicate Casual Leave', async () => {
    const emp = await createTestEmployee('probation', 'Probation Becoming FTE');
    await updateEmployee(emp.employeeId, { employment_type: 'full_time' });

    // Call transition 3 times
    for (let i = 0; i < 3; i++) {
      await syncEmployeeEmploymentTypeLeaveEligibility({
        employeeId: emp.employeeId,
        oldType: 'probation',
        newType: 'full_time',
        adminUser: testAdminUser,
      });
    }

    const bal = await getEmployeeLeaveBalances({ employeeId: emp.employeeId });
    assert.strictEqual(bal.categories.casual.annualEntitlement, 7.0, 'Annual entitlement must remain strictly 7.0');
    assert.strictEqual(bal.categories.casual.remainingBalance, 7.0, 'Remaining balance must remain strictly 7.0');

    const auditRows = await db.prepare(`
      SELECT * FROM leave_balance_adjustments
      WHERE employee_id = ? AND leave_type = 'casual'
    `).all(emp.employeeId);
    assert.strictEqual(auditRows.length, 1, 'Only one audit adjustment row must be created');
  });

  // 10. Freelancer -> Full-Time Employee
  await test('10. Freelancer -> Full-Time Employee transition allocates 7.0d and allows CL submission', async () => {
    const emp = await createTestEmployee('freelancer', 'Freelancer Becoming FTE');
    await updateEmployee(emp.employeeId, { employment_type: 'full_time' });
    await syncEmployeeEmploymentTypeLeaveEligibility({
      employeeId: emp.employeeId,
      oldType: 'freelancer',
      newType: 'full_time',
      adminUser: testAdminUser,
    });

    // Now employee can submit Casual Leave!
    const req = await submitLeaveRequest({
      employeeId: emp.employeeId,
      userId: emp.userId,
      leaveType: 'casual',
      dayType: 'full_day',
      startDate: '2026-11-12',
      endDate: '2026-11-12',
      reason: 'Personal family event',
    });
    if (req?.id) createdLeaveRequestIds.add(req.id);
    assert.strictEqual(req.leave_type, 'casual');
    assert.strictEqual(req.status, 'pending');
  });

  // 11. Full-Time to Non-FTE preserves existing Sick Leave and history
  await test('11. Transition Full-Time to Part-Time removes CL eligibility for new requests but preserves SL', async () => {
    const emp = await createTestEmployee('full_time', 'FTE Becoming Part-Time');
    // Change to part_time
    await updateEmployee(emp.employeeId, { employment_type: 'part_time' });
    const bal = await syncEmployeeEmploymentTypeLeaveEligibility({
      employeeId: emp.employeeId,
      oldType: 'full_time',
      newType: 'part_time',
      adminUser: testAdminUser,
    });

    assert.strictEqual(bal.categories.casual.isEligible, false);
    assert.strictEqual(bal.categories.sick.isEligible, true);
    assert.strictEqual(bal.categories.sick.annualEntitlement, 7.0);

    // Attempting to apply for Casual Leave now fails
    let errCaught = false;
    try {
      await submitLeaveRequest({
        employeeId: emp.employeeId,
        userId: emp.userId,
        leaveType: 'casual',
        dayType: 'full_day',
        startDate: '2026-11-15',
        endDate: '2026-11-15',
        reason: 'Should fail because now part time',
      });
    } catch (e) {
      errCaught = true;
      assert.strictEqual(e.message.includes('Casual Leave is only available to Full-Time Employees'), true);
    }
    assert.strictEqual(errCaught, true);
  });

  } finally {
    // Guaranteed isolation cleanup: delete all test data generated by THIS run
    for (const reqId of createdLeaveRequestIds) {
      await db.prepare('DELETE FROM employee_attendance WHERE leave_request_id = ?').run(reqId).catch(() => {});
      await db.prepare('DELETE FROM employee_leave_requests WHERE id = ?').run(reqId).catch(() => {});
    }
    for (const empId of createdEmployeeIds) {
      await db.prepare('DELETE FROM employee_attendance WHERE employee_id = ?').run(empId).catch(() => {});
      await db.prepare('DELETE FROM employee_leave_requests WHERE employee_id = ?').run(empId).catch(() => {});
      await db.prepare('DELETE FROM leave_balance_adjustments WHERE employee_id = ?').run(empId).catch(() => {});
      await db.prepare('DELETE FROM leave_balances WHERE employee_id = ?').run(empId).catch(() => {});
      await db.prepare('DELETE FROM employees WHERE id = ?').run(empId).catch(() => {});
    }
    for (const uId of createdUserIds) {
      await db.prepare('DELETE FROM users WHERE id = ?').run(uId).catch(() => {});
    }
  }

  console.log('\n========================================================================');
  console.log(`TEST RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('========================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
