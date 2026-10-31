import { getReportExecutionData } from '../lib/analytics.js';
import { db } from '../lib/db.js';

console.log('================================================================');
console.log('STARTING REPORT FILTER COMBINATIONS & ISOLATION VERIFICATION');
console.log('================================================================');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

const currentUser = { id: 1, role: 'admin' };

async function runTests() {
  const employees = await db.prepare('SELECT id, user_id, name FROM employees').all();
  const projects = await db.prepare('SELECT id, name FROM projects').all();

  const devUser = employees.find((e) => e.name === 'Dev User') || employees[1];
  const adminUser = employees.find((e) => e.name === 'Admin User') || employees[0];
  const webProject = projects[0];

  console.log('\n--- Test Scenario 1: Isolated Employee Filter Across Diverse Sections ---');
  // Section 2: Time Tracking (#15)
  const ttAll = await getReportExecutionData({
    reportSlug: 'time-tracking',
    filters: { preset: 'this_month', projectId: 'all', employeeId: 'all', status: 'all', priority: 'all' },
    currentUser,
  });
  const ttAdmin = await getReportExecutionData({
    reportSlug: 'time-tracking',
    filters: { preset: 'this_month', projectId: 'all', employeeId: String(adminUser.id), status: 'all', priority: 'all' },
    currentUser,
  });
  assert(ttAdmin.rows.length > 0 && ttAdmin.rows.length <= ttAll.rows.length, `Time Tracking isolates employee rows (${ttAdmin.rows.length} of ${ttAll.rows.length})`);
  assert(ttAdmin.rows.every(r => r.assignee === adminUser.name || r.assignee === 'Admin User'), 'All rows match selected employee assignee');

  // Section 1: Employee Timesheet (#3)
  const tsAdmin = await getReportExecutionData({
    reportSlug: 'employee-timesheet',
    filters: { preset: 'this_month', projectId: 'all', employeeId: String(adminUser.id), status: 'all', priority: 'all' },
    currentUser,
  });
  assert(tsAdmin.rows.length > 0, `Employee Timesheet returns logged rows for employee (${tsAdmin.rows.length} entries)`);
  assert(tsAdmin.rows.every(r => r.user_name === adminUser.name || r.user_name === 'Admin User'), 'Employee Timesheet rows belong to selected employee');

  // Section 1: Employee Activity (#5)
  const eaAdmin = await getReportExecutionData({
    reportSlug: 'employee-activity',
    filters: { preset: 'this_month', projectId: 'all', employeeId: String(adminUser.id), status: 'all', priority: 'all' },
    currentUser,
  });
  assert(eaAdmin.rows.length > 0, `Employee Activity returns event rows for employee (${eaAdmin.rows.length} activities)`);

  // Section 2: Task Change History (#24)
  const tchAdmin = await getReportExecutionData({
    reportSlug: 'task-change-history',
    filters: { preset: 'this_month', projectId: 'all', employeeId: String(adminUser.id), status: 'all', priority: 'all' },
    currentUser,
  });
  assert(tchAdmin.rows.length > 0, `Task Change History returns event rows for employee (${tchAdmin.rows.length} activities)`);

  console.log('\n--- Test Scenario 2: Isolated Project Filter Without Time Log Wipeout ---');
  // Section 2: Time Tracking (#15) with Project 1
  const ttProj = await getReportExecutionData({
    reportSlug: 'time-tracking',
    filters: { preset: 'this_month', projectId: String(webProject.id), employeeId: 'all', status: 'all', priority: 'all' },
    currentUser,
  });
  assert(ttProj.rows.length > 0, `Time Tracking returns rows when project filter is applied (${ttProj.rows.length} tasks)`);
  assert(ttProj.rows.every(r => r.project === webProject.name), 'Time tracking rows belong exclusively to the selected project');

  // Section 2: Work Log (#16) with Project 1
  const wlProj = await getReportExecutionData({
    reportSlug: 'work-log',
    filters: { preset: 'this_month', projectId: String(webProject.id), employeeId: 'all', status: 'all', priority: 'all' },
    currentUser,
  });
  assert(wlProj.rows.length > 0, `Work Log preserves time logs when project filter is active (found ${wlProj.rows.length} entries, not 0)`);

  console.log('\n--- Test Scenario 3: Paired Multi-Filter (Employee + Project) ---');
  const ttEmpProj = await getReportExecutionData({
    reportSlug: 'time-tracking',
    filters: { preset: 'this_month', projectId: String(webProject.id), employeeId: String(adminUser.id), status: 'all', priority: 'all' },
    currentUser,
  });
  assert(ttEmpProj.rows.length > 0, `Employee + Project paired filter succeeds (${ttEmpProj.rows.length} rows)`);
  assert(
    ttEmpProj.rows.every(r => (r.assignee === adminUser.name || r.assignee === 'Admin User') && r.project === webProject.name),
    'Every returned row matches BOTH the selected employee and project'
  );

  console.log('\n--- Test Scenario 4: Triple Multi-Filter (Employee + Project + Priority) ---');
  const ttTriple = await getReportExecutionData({
    reportSlug: 'time-tracking',
    filters: { preset: 'this_month', projectId: String(webProject.id), employeeId: String(adminUser.id), status: 'all', priority: 'urgent' },
    currentUser,
  });
  assert(ttTriple.rows !== undefined, 'Triple filter executes cleanly');

  console.log('\n--- Test Scenario 5: Zero-Match Non-Existent Entity Filter ---');
  const ttNonExistent = await getReportExecutionData({
    reportSlug: 'time-tracking',
    filters: { preset: 'this_month', projectId: '999999', employeeId: 'all', status: 'all', priority: 'all' },
    currentUser,
  });
  assert(ttNonExistent.rows.length === 0, 'Filtering by non-existent project returns 0 rows cleanly without throwing');

  const empNonExistent = await getReportExecutionData({
    reportSlug: 'time-tracking',
    filters: { preset: 'this_month', projectId: 'all', employeeId: '999999', status: 'all', priority: 'all' },
    currentUser,
  });
  assert(empNonExistent.rows.length === 0, 'Filtering by non-existent employee returns 0 rows cleanly');

  console.log('\n--- Test Scenario 6: Reset / Clear Filter Verification ---');
  const ttReset = await getReportExecutionData({
    reportSlug: 'time-tracking',
    filters: { preset: 'this_month', projectId: 'all', employeeId: 'all', status: 'all', priority: 'all', search: '' },
    currentUser,
  });
  assert(ttReset.rows.length === ttAll.rows.length, `Resetting all filters restores original row count (${ttReset.rows.length} rows)`);

  console.log('\n--- Test Scenario 7: Domain-Specific Status Filtering ---');
  // Salary summary: payment status
  const ssPaid = await getReportExecutionData({
    reportSlug: 'salary-summary',
    filters: { preset: 'this_month', projectId: 'all', employeeId: 'all', department: 'all', status: 'paid' },
    currentUser,
  });
  assert(ssPaid.rows.every(r => r.payment_status.toLowerCase() === 'paid'), 'Salary summary filters by payroll status: paid');

  const ssPending = await getReportExecutionData({
    reportSlug: 'salary-summary',
    filters: { preset: 'this_month', projectId: 'all', employeeId: 'all', department: 'all', status: 'pending' },
    currentUser,
  });
  assert(ssPending.rows.every(r => r.payment_status.toLowerCase() === 'pending'), 'Salary summary filters by payroll status: pending');

  console.log('\n================================================================');
  console.log(`FILTER COMBINATION VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

