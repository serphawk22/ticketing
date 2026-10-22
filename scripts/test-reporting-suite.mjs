import { db } from '../lib/db.js';
import { getAllSections, getAllReports, getReportsBySection, getReportBySlug } from '../lib/reportMasterCatalog.js';
import { getAdminDashboardSummary, getEmployeeDashboardSummary, getReportExecutionData } from '../lib/analytics.js';
import { resolveDateRange } from '../lib/dateFilters.js';
import { buildReportCsv, buildExcelXml } from '../lib/exportUtils.js';
import { runDueReportSchedules, checkAndSendExceptionAlerts, createReportSchedule } from '../lib/reportScheduler.js';
import { logAuditEvent, getAuditLogs } from '../lib/audit.js';

async function runTests() {
  console.log('=== STARTING SERP HAWK REPORTING & ANALYTICS TEST SUITE ===\n');

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

  // TEST 1: Catalogue Structure
  console.log('Test 1: Catalogue Structure & 7 Sections Validation');
  const sections = getAllSections();
  assert(sections.length === 7, `Expected 7 sections, got ${sections.length}`);

  const allReports = getAllReports();
  assert(allReports.length === 76, `Expected 76 catalogue reports, got ${allReports.length}`);

  const expectedSectionCounts = {
    'employee-and-workforce': 10,
    'ticket-and-task': 14,
    'project-and-client-delivery': 10,
    'salary-payroll-and-cost': 10,
    'productivity-and-performance': 10,
    'finance-and-startup-expense': 13,
    'management-risk-and-compliance': 9,
  };

  for (const [secSlug, count] of Object.entries(expectedSectionCounts)) {
    const secReports = getReportsBySection(secSlug);
    assert(secReports.length === count, `Section ${secSlug} has ${secReports.length} reports (expected ${count})`);
  }

  // TEST 2: Admin Dashboard Summary Execution
  console.log('\nTest 2: Admin Dashboard Summary Execution');
  const adminSummary = await getAdminDashboardSummary({ preset: 'this_month' });
  assert(adminSummary.kpis.totalTickets !== undefined, 'Admin dashboard returned totalTickets KPI');
  assert(adminSummary.projects.length >= 2, `Admin dashboard dynamically loaded ${adminSummary.projects.length} projects`);
  assert(adminSummary.charts.statusCounts.length === 3, 'Status distribution chart returned 3 categories');
  assert(adminSummary.charts.projectStats.length >= 2, 'Project progress stats calculated for all projects');

  // TEST 3: Employee Dashboard Summary Execution
  console.log('\nTest 3: Employee Dashboard Summary Execution');
  const devUser = await db.prepare("SELECT id FROM users WHERE role = 'developer' LIMIT 1").get();
  assert(devUser && devUser.id, 'Found test developer user');
  const devSummary = await getEmployeeDashboardSummary({ userId: devUser.id });
  assert(devSummary.kpis.assignedTotal !== undefined, 'Employee dashboard returned assignedTotal KPI');
  assert(Array.isArray(devSummary.sections.todo), 'Employee dashboard returned personal todo list');

  // TEST 4: Common Date Filters
  console.log('\nTest 4: Common Date Filters Computation');
  const todayRange = resolveDateRange({ preset: 'today' });
  assert(todayRange.startDate === todayRange.endDate, `Today range has same start and end: ${todayRange.startDate}`);

  const thisMonthRange = resolveDateRange({ preset: 'this_month' });
  assert(thisMonthRange.startDate.endsWith('-01'), `This month starts on 1st: ${thisMonthRange.startDate}`);

  const customRange = resolveDateRange({ preset: 'custom', startDate: '2026-01-01', endDate: '2026-03-31' });
  assert(customRange.startDate === '2026-01-01' && customRange.endDate === '2026-03-31', 'Custom range honors start and end');

  // TEST 5: Dynamic Project Inclusion (Mandatory requirement)
  console.log('\nTest 5: Dynamic Project Inclusion');
  const testKey = `DYN_${Date.now().toString().slice(-4)}`;
  const workspace = await db.prepare('SELECT id FROM workspaces LIMIT 1').get();
  const insertProj = await db.prepare(
    'INSERT INTO projects (key, name, description, color, workspace_id) VALUES (?, ?, ?, ?, ?)'
  ).run(testKey, `Dynamic Test Project ${testKey}`, 'Testing auto inclusion', '#36b37e', workspace.id);

  const dynamicProjectId = insertProj.lastInsertRowid;
  assert(dynamicProjectId > 0, `Created dynamic test project with ID ${dynamicProjectId} and Key ${testKey}`);

  // Query projects again and verify it immediately appears in project overview
  const refreshedAdminSummary = await getAdminDashboardSummary();
  const foundDynamic = refreshedAdminSummary.projects.some(p => p.id === dynamicProjectId);
  assert(foundDynamic, 'New project automatically appears in Admin Dashboard projects selector without code change');

  // Add a ticket to the dynamic project and verify reports aggregate it
  const adminUser = await db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  const insertTicket = await db.prepare(
    'INSERT INTO tickets (title, description, status, priority, created_by, project_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(`Task in ${testKey}`, 'Dynamic project verification task', 'open', 'high', adminUser.id, dynamicProjectId);
  assert(insertTicket.lastInsertRowid > 0, `Created ticket under dynamic project: ${insertTicket.lastInsertRowid}`);

  // Query project overview report and check ticket was counted
  const projOverviewData = await getReportExecutionData({
    reportSlug: 'project-overview',
    currentUser: { role: 'admin', id: adminUser.id },
  });
  const dynamicRow = projOverviewData.rows.find(r => r.project_key === testKey);
  assert(dynamicRow && dynamicRow.total_tickets === 1, `Dynamic project tickets reflected in Project Overview report: total_tickets = ${dynamicRow?.total_tickets}`);

  // Clean up test ticket and project
  await db.prepare('DELETE FROM tickets WHERE id = ?').run(insertTicket.lastInsertRowid);
  await db.prepare('DELETE FROM projects WHERE id = ?').run(dynamicProjectId);
  console.log('  ✓ Cleaned up temporary test project and ticket.');

  // TEST 6: Security and Role Permissions
  console.log('\nTest 6: Role-Based Access Control and Security');
  let developerBlockedFromSalary = false;
  try {
    await getReportExecutionData({
      reportSlug: 'salary-summary',
      currentUser: { role: 'developer', id: 2 },
    });
  } catch (err) {
    developerBlockedFromSalary = err.message.includes('Access denied');
  }
  assert(developerBlockedFromSalary, 'Developer is blocked from accessing Salary Summary report');

  let clientBlockedFromReports = false;
  try {
    await getReportExecutionData({
      reportSlug: 'task-summary',
      currentUser: { role: 'client', id: 11 },
    });
  } catch (err) {
    clientBlockedFromReports = err.message.includes('authorization') || err.message.includes('Client role');
  }
  assert(clientBlockedFromReports, 'Client is blocked from internal ticket reports');

  // TEST 7: Awaiting Data Sources & Empty States
  console.log('\nTest 7: Unavailable Data State Integrity');
  const attendanceReport = await getReportExecutionData({
    reportSlug: 'attendance',
    currentUser: { role: 'admin', id: 1 },
  });
  assert(attendanceReport.unavailableNotice !== undefined && attendanceReport.rows.length === 0, 'Attendance report returns honest empty state with documented boundary');

  const leaveReport = await getReportExecutionData({
    reportSlug: 'leave-and-holiday',
    currentUser: { role: 'admin', id: 1 },
  });
  assert(leaveReport.unavailableNotice !== undefined, 'Leave report returns honest empty state with documented boundary');

  // TEST 8: Export Utilities
  console.log('\nTest 8: Export Functionality (CSV & Excel XML)');
  const sampleColumns = [
    { key: 'key', label: 'Key' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
  ];
  const sampleRows = [
    { key: 'WEB-1', title: 'Test Export', status: 'open' },
    { key: 'WEB-2', title: 'Comma, and "quote" test', status: 'resolved' },
  ];
  const csvOut = buildReportCsv({
    title: 'Test Export Report',
    dateRangeLabel: 'This Month',
    columns: sampleColumns,
    rows: sampleRows,
  });
  assert(csvOut.startsWith('\uFEFF"Test Export Report"'), 'CSV export generates UTF-8 BOM and metadata header');
  assert(csvOut.includes('"Comma, and ""quote"" test"'), 'CSV export escapes quotes per RFC 4180');

  const excelXml = buildExcelXml({
    title: 'Test Excel Report',
    columns: sampleColumns,
    rows: sampleRows,
  });
  assert(excelXml.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'Excel XML starts with valid XML declaration');
  assert(excelXml.includes('<Worksheet ss:Name="Report">'), 'Excel XML generates spreadsheet worksheet');

  // TEST 9: Audit Trail
  console.log('\nTest 9: Audit Trail');
  await logAuditEvent({
    actorId: adminUser.id,
    actorName: 'Admin Tester',
    action: 'test_audit_event',
    entityType: 'report',
    entityId: 'test-123',
    details: { test: true },
  });
  const auditLogs = await getAuditLogs({ entityType: 'report', entityId: 'test-123' });
  assert(auditLogs.length > 0 && auditLogs[0].action === 'test_audit_event', 'Audit log event successfully written and retrieved');

  // TEST 10: Scheduled Reports & Exception Alerts
  console.log('\nTest 10: Scheduled Reports & Exception Alerts');
  const schedule = await createReportSchedule({
    name: 'Weekly Automation Test',
    reportSlug: 'task-summary',
    sectionSlug: 'ticket-and-task',
    frequency: 'weekly',
    recipients: 'admin@example.com',
    userId: adminUser.id,
  });
  assert(schedule && schedule.id, `Created test schedule with ID ${schedule.id}`);

  const scheduleRun = await runDueReportSchedules({ forceRunId: schedule.id });
  assert(scheduleRun.length > 0 && scheduleRun[0].status === 'success', 'Scheduled report executed successfully and recorded in outbox');

  const alertRun = await checkAndSendExceptionAlerts();
  assert(alertRun.alertSent !== undefined, 'Exception alert scanner ran successfully');

  // TEST 11: Role-Based Dashboard Access Selector Profiles
  console.log('\nTest 11: Role-Based Dashboard Access Selector Profiles');
  const { DASHBOARD_PROFILES, getProfileConfig, filterSectionsForProfile, isReportPermittedForProfile } = await import('../lib/roleDashboardConfig.js');
  assert(DASHBOARD_PROFILES.length === 4, `Expected exactly 4 dashboard profiles, got ${DASHBOARD_PROFILES.length}`);

  const adminProfile = getProfileConfig('admin');
  assert(adminProfile.allowedSectionSlugs.length === 7, 'Admin profile has all 7 sections allowed');

  const managerProfile = getProfileConfig('manager');
  assert(managerProfile.hideFinancials === true, 'Manager profile hides financials');
  assert(!managerProfile.allowedSectionSlugs.includes('salary-payroll-and-cost'), 'Manager profile strictly excludes salary/payroll');
  assert(!managerProfile.allowedSectionSlugs.includes('finance-and-startup-expense'), 'Manager profile strictly excludes finance/expenses');

  const hrProfile = getProfileConfig('hr');
  assert(hrProfile.hideFinancials === true, 'HR profile hides financials');
  assert(hrProfile.allowedSectionSlugs.includes('employee-and-workforce'), 'HR profile includes employee workforce');
  assert(!hrProfile.allowedSectionSlugs.includes('salary-payroll-and-cost'), 'HR profile excludes salary/payroll');

  const financeProfile = getProfileConfig('finance');
  assert(financeProfile.allowedSectionSlugs.includes('salary-payroll-and-cost'), 'Finance profile includes salary/payroll');
  assert(financeProfile.allowedSectionSlugs.includes('finance-and-startup-expense'), 'Finance profile includes finance/expenses');
  assert(!financeProfile.allowedSectionSlugs.includes('ticket-and-task'), 'Finance profile excludes technical ticket debugging');

  // Check new HR and Finance summary metrics in admin summary
  assert(Array.isArray(adminSummary.charts.deptEmployeeCounts), 'Admin summary contains deptEmployeeCounts for HR preview');
  assert(Array.isArray(adminSummary.charts.deptSalaryCounts), 'Admin summary contains deptSalaryCounts for Finance preview');
  assert(Array.isArray(adminSummary.charts.paymentStatusCounts), 'Admin summary contains paymentStatusCounts for Finance preview');
  assert(typeof adminSummary.kpis.totalProjectBudgets === 'number', 'Admin summary contains totalProjectBudgets for Finance preview');

  console.log(`\n=== TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});

