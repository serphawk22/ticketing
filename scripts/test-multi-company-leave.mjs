import { db } from '../lib/db.js';
import {
  getOrganizationLeavePolicy,
  saveOrganizationLeaveCategory,
  ensureEmployeeLeaveBalances,
  getEmployeeLeaveBalances,
  submitLeaveRequest,
  syncEmployeeEmploymentTypeLeaveEligibility,
  addCompanyHoliday,
  getCompanyHolidays,
} from '../lib/attendance.js';
import { createEmployee, getEmployee, deleteEmployee } from '../lib/employees.js';

async function run() {
  console.log('--- STARTING MULTI-COMPANY LEAVE MANAGEMENT VERIFICATION ---');

  const adminUser = { id: 1, name: 'Admin', role: 'admin' };
  const createdEmployeeIds = [];

  try {
    // 1. Identify two test workspaces
    const wsRows = await db.prepare('SELECT id, name FROM workspaces ORDER BY id ASC').all();
    if (wsRows.length < 2) {
      console.log('Less than 2 workspaces found, creating a secondary workspace for test...');
      await db.prepare("INSERT INTO workspaces (key, name, color) VALUES ('TESTWS', 'Test Company B', '#0c66e4')").run();
    }
    const allWs = await db.prepare('SELECT id, name FROM workspaces ORDER BY id ASC').all();
    const wsA = allWs[0];
    const wsB = allWs[1];

    console.log(`Testing with Workspace A (ID: ${wsA.id}, Name: ${wsA.name}) and Workspace B (ID: ${wsB.id}, Name: ${wsB.name})`);

    // 2. Configure Workspace A: Casual Leave 7d (full_time only), Sick Leave 7d (all roles)
    await saveOrganizationLeaveCategory({
      workspaceId: wsA.id,
      code: 'casual',
      name: 'Casual Leave',
      annualAllowance: 7.0,
      eligibleEmploymentTypes: ['full_time'],
      isPaid: true,
      allowLopBeyondBalance: true,
      carryForwardEnabled: false,
      adminUser,
    });

    await saveOrganizationLeaveCategory({
      workspaceId: wsA.id,
      code: 'sick',
      name: 'Sick Leave',
      annualAllowance: 7.0,
      eligibleEmploymentTypes: ['full_time', 'part_time', 'intern', 'probation', 'freelancer'],
      isPaid: true,
      allowLopBeyondBalance: true,
      carryForwardEnabled: true,
      maxCarryForwardDays: 30,
      adminUser,
    });

    // 3. Configure Workspace B: Casual Leave 12d (full_time AND intern), Sick Leave 10d
    await saveOrganizationLeaveCategory({
      workspaceId: wsB.id,
      code: 'casual',
      name: 'Casual Leave',
      annualAllowance: 12.0,
      eligibleEmploymentTypes: ['full_time', 'intern'],
      isPaid: true,
      allowLopBeyondBalance: true,
      carryForwardEnabled: false,
      adminUser,
    });

    await saveOrganizationLeaveCategory({
      workspaceId: wsB.id,
      code: 'sick',
      name: 'Sick Leave',
      annualAllowance: 10.0,
      eligibleEmploymentTypes: ['full_time', 'part_time', 'intern', 'probation', 'freelancer'],
      isPaid: true,
      allowLopBeyondBalance: true,
      carryForwardEnabled: true,
      adminUser,
    });

    console.log('✓ Successfully configured distinct organization policies for Workspace A and B.');

    // 4. Create Employee 1: Full-Time in Workspace A
    const emp1 = await createEmployee({
      name: 'Test FTE WS-A',
      email: `test_fte_wsa_${Date.now()}@example.com`,
      role: 'developer',
      employment_type: 'full_time',
      workspace_id: wsA.id,
    });
    createdEmployeeIds.push(emp1.id);
    await ensureEmployeeLeaveBalances(emp1.id);

    const b1 = await getEmployeeLeaveBalances({ employeeId: emp1.id });
    if (b1.categories.casual.remainingBalance !== 7.0 || b1.categories.sick.remainingBalance !== 7.0) {
      throw new Error(`Emp1 in WS-A expected 7d CL & 7d SL, got CL: ${b1.categories.casual.remainingBalance}, SL: ${b1.categories.sick.remainingBalance}`);
    }
    console.log('✓ Employee 1 (Full-Time in WS-A) granted 7.0d CL and 7.0d SL.');

    // 5. Create Employee 2: Intern in Workspace A (Ineligible for CL in WS-A)
    const emp2 = await createEmployee({
      name: 'Test Intern WS-A',
      email: `test_intern_wsa_${Date.now()}@example.com`,
      role: 'developer',
      employment_type: 'intern',
      workspace_id: wsA.id,
    });
    createdEmployeeIds.push(emp2.id);
    await ensureEmployeeLeaveBalances(emp2.id);

    const b2 = await getEmployeeLeaveBalances({ employeeId: emp2.id });
    if (b2.categories.casual.isEligible !== false || b2.categories.sick.remainingBalance !== 7.0) {
      throw new Error(`Emp2 (Intern in WS-A) expected ineligible CL and 7d SL, got CL eligible: ${b2.categories.casual.isEligible}`);
    }
    console.log('✓ Employee 2 (Intern in WS-A) is correctly ineligible for CL and granted 7.0d SL.');

    // 6. Verify Backend Enforces Ineligibility on Leave Application
    let emp2Blocked = false;
    try {
      await submitLeaveRequest({
        employeeId: emp2.id,
        userId: 1,
        leaveType: 'casual',
        startDate: '2026-11-10',
        endDate: '2026-11-10',
        dayType: 'full_day',
        reason: 'Attempting CL as intern in WS-A',
      });
    } catch (e) {
      emp2Blocked = true;
      console.log(`✓ Backend correctly blocked ineligible leave request: "${e.message}"`);
    }
    if (!emp2Blocked) {
      throw new Error('Emp2 should have been blocked from applying for Casual Leave!');
    }

    // 7. Create Employee 3: Intern in Workspace B (Eligible for CL in WS-B, 12d allowance!)
    const emp3 = await createEmployee({
      name: 'Test Intern WS-B',
      email: `test_intern_wsb_${Date.now()}@example.com`,
      role: 'developer',
      employment_type: 'intern',
      workspace_id: wsB.id,
    });
    createdEmployeeIds.push(emp3.id);
    await ensureEmployeeLeaveBalances(emp3.id);

    const b3 = await getEmployeeLeaveBalances({ employeeId: emp3.id });
    if (b3.categories.casual.remainingBalance !== 12.0 || b3.categories.sick.remainingBalance !== 10.0) {
      throw new Error(`Emp3 in WS-B expected 12d CL & 10d SL, got CL: ${b3.categories.casual.remainingBalance}, SL: ${b3.categories.sick.remainingBalance}`);
    }
    console.log('✓ Employee 3 (Intern in WS-B) correctly eligible and granted 12.0d CL and 10.0d SL per WS-B policy!');

    // 8. Custom Category Support: Add "earned" leave in Workspace A
    await saveOrganizationLeaveCategory({
      workspaceId: wsA.id,
      code: 'earned',
      name: 'Earned Leave',
      annualAllowance: 15.0,
      eligibleEmploymentTypes: ['full_time'],
      isPaid: true,
      allowLopBeyondBalance: true,
      carryForwardEnabled: true,
      adminUser,
    });

    // Re-ensure balances for Emp 1 in WS-A
    await ensureEmployeeLeaveBalances(emp1.id);
    const b1AfterEarned = await getEmployeeLeaveBalances({ employeeId: emp1.id });
    if (!b1AfterEarned.categories.earned || b1AfterEarned.categories.earned.remainingBalance !== 15.0) {
      throw new Error(`Emp1 in WS-A expected 15d Earned Leave, got: ${b1AfterEarned.categories.earned?.remainingBalance}`);
    }
    console.log('✓ Custom category "Earned Leave" successfully configured and allocated 15.0d to Emp 1 in WS-A.');

    // Verify Emp 3 in WS-B does NOT have "earned" leave (Multi-company isolation)
    const b3Check = await getEmployeeLeaveBalances({ employeeId: emp3.id });
    if (b3Check.categories.earned) {
      throw new Error('Emp3 in WS-B should NOT have Earned Leave configured for WS-A!');
    }
    console.log('✓ Multi-company isolation verified: Workspace B does not inherit Workspace A custom categories.');

    // 9. Employment Type Transition & Idempotency: Transition Emp 2 in WS-A from intern to full_time
    console.log('Transitioning Emp 2 from intern to full_time in WS-A...');
    await syncEmployeeEmploymentTypeLeaveEligibility({
      employeeId: emp2.id,
      oldType: 'intern',
      newType: 'full_time',
      adminUser,
    });

    const b2AfterTransition = await getEmployeeLeaveBalances({ employeeId: emp2.id });
    if (b2AfterTransition.categories.casual.remainingBalance !== 7.0) {
      throw new Error(`Emp 2 after transition expected 7d CL, got: ${b2AfterTransition.categories.casual.remainingBalance}`);
    }
    if (b2AfterTransition.categories.sick.remainingBalance !== 7.0) {
      throw new Error(`Emp 2 after transition expected SL to stay 7d, got: ${b2AfterTransition.categories.sick.remainingBalance}`);
    }
    console.log('✓ Transition granted 7.0d CL and preserved existing 7.0d SL.');

    // Run transition again to test idempotency
    await syncEmployeeEmploymentTypeLeaveEligibility({
      employeeId: emp2.id,
      oldType: 'intern',
      newType: 'full_time',
      adminUser,
    });
    const b2Idempotent = await getEmployeeLeaveBalances({ employeeId: emp2.id });
    if (b2Idempotent.categories.casual.remainingBalance !== 7.0) {
      throw new Error(`Idempotency failure: Emp 2 CL became ${b2Idempotent.categories.casual.remainingBalance} after second run!`);
    }
    console.log('✓ Idempotency confirmed: Re-running transition did not duplicate leave.');

    // 10. Workspace Holidays
    const testHolDate = `2026-11-25`;
    await addCompanyHoliday({
      holidayDate: testHolDate,
      name: 'WS-A Special Founders Day',
      workspaceId: wsA.id,
      adminUser,
    });

    const wsAHolidays = await getCompanyHolidays({ workspaceId: wsA.id });
    const hasSpecial = wsAHolidays.some((h) => h.name === 'WS-A Special Founders Day');
    if (!hasSpecial) {
      throw new Error('Workspace A holiday was not found in getCompanyHolidays!');
    }
    console.log('✓ Workspace holiday added and verified.');

    console.log('\n======================================================');
    console.log('🎉 ALL MULTI-COMPANY LEAVE MANAGEMENT TESTS PASSED! 🎉');
    console.log('======================================================\n');
  } finally {
    // Clean up created test employees
    for (const id of createdEmployeeIds) {
      try {
        await deleteEmployee(id);
      } catch {
        // ignore
      }
    }
  }
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
