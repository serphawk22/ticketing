import { db } from '../lib/db.js';
import { getAllSections, getAllReports, getReportsBySection, getReportBySlug, MASTER_REPORTS } from '../lib/reportMasterCatalog.js';
import { getAdminDashboardSummary, getEmployeeDashboardSummary, getReportExecutionData } from '../lib/analytics.js';
import { resolveDateRange } from '../lib/dateFilters.js';
import { buildReportCsv, buildExcelXml } from '../lib/exportUtils.js';
import { DASHBOARD_PROFILES, getProfileConfig, filterSectionsForProfile } from '../lib/roleDashboardConfig.js';
import { runDueReportSchedules, checkAndSendExceptionAlerts, createReportSchedule } from '../lib/reportScheduler.js';
import { logAuditEvent, getAuditLogs } from '../lib/audit.js';

let passedCount = 0;
let failedCount = 0;
const defectsList = [];

function assert(condition, message, defectDetails = null) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedCount++;
    if (defectDetails) {
      defectsList.push({ message, ...defectDetails });
    }
  }
}

async function runComprehensiveAudit() {
  console.log('================================================================');
  console.log('STARTING SERP HAWK REPORTING & ANALYTICS DEEP ACCURACY AUDIT');
  console.log('================================================================\n');

  // 1. Audit Context & Baseline Users
  const adminUser = await db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  const devUser = await db.prepare("SELECT * FROM users WHERE role = 'developer' LIMIT 1").get();
  const clientUser = await db.prepare("SELECT * FROM users WHERE role = 'client' LIMIT 1").get();

  assert(adminUser != null, 'Admin user account exists in database');
  assert(devUser != null, 'Developer user account exists in database');
  assert(clientUser != null, 'Client user account exists in database');

  // ================================================================
  // TEST SUITE 1: Catalogue Alignment & Report Inventory (76 Reports)
  // ================================================================
  console.log('\n--- Test Suite 1: Catalogue Alignment & Report Inventory ---');
  const sections = getAllSections();
  assert(sections.length === 7, `Expected exactly 7 catalogue sections, got ${sections.length}`);
  assert(MASTER_REPORTS.length === 76, `Expected exactly 76 reports in master catalogue, got ${MASTER_REPORTS.length}`);

  const sectionCounts = {
    'employee-and-workforce': 10,
    'ticket-and-task': 14,
    'project-and-client-delivery': 10,
    'salary-payroll-and-cost': 10,
    'productivity-and-performance': 10,
    'finance-and-startup-expense': 13,
    'management-risk-and-compliance': 9,
  };

  for (const [secSlug, expCount] of Object.entries(sectionCounts)) {
    const list = getReportsBySection(secSlug);
    assert(list.length === expCount, `Section "${secSlug}" contains ${list.length} reports (expected ${expCount})`);
  }

  // Verify numbering jump: catalogue jumps from 67 to 77
  const ids = MASTER_REPORTS.map((r) => r.id);
  assert(ids.includes(67) && ids.includes(77), 'Catalogue preserves numbering jump between #67 and #77 per source PDF');
  for (let i = 68; i <= 76; i++) {
    assert(!ids.includes(i), `Number #${i} is correctly omitted per catalogue specification`);
  }

  // ================================================================
  // TEST SUITE 2: Execution & Output Verification of All 76 Reports
  // ================================================================
  console.log('\n--- Test Suite 2: Execution & Output Verification of All 76 Reports ---');
  let customCalculatedCount = 0;
  let honestUnavailableCount = 0;
  let unexpectedDefaultCount = 0;

  for (const reportDef of MASTER_REPORTS) {
    try {
      const data = await getReportExecutionData({
        reportSlug: reportDef.slug,
        filters: { preset: 'this_month' },
        currentUser: adminUser,
      });

      if (!reportDef.dataAvailable) {
        honestUnavailableCount++;
        assert(
          data.unavailableNotice && data.rows.length === 0,
          `Report #${reportDef.id} [${reportDef.slug}] returns honest unavailable state with documented boundary`
        );
      } else {
        const kpiKeys = (data.kpis || []).map((k) => k.key);
        const isFallback = kpiKeys.includes('total_records') && kpiKeys.includes('reporting_cadence');
        if (isFallback) {
          unexpectedDefaultCount++;
          assert(false, `Report #${reportDef.id} [${reportDef.slug}] is falling back to generic default!`, {
            slug: reportDef.slug,
            issue: 'Generic ticket fallback used instead of dedicated calculation',
          });
        } else {
          customCalculatedCount++;
          assert(
            data.kpis.length >= 2 && Array.isArray(data.columns) && Array.isArray(data.rows),
            `Report #${reportDef.id} [${reportDef.slug}] produces dedicated calculated KPIs (${data.kpis.length}) and columns (${data.columns.length})`
          );
        }
      }
    } catch (err) {
      assert(false, `Report #${reportDef.id} [${reportDef.slug}] execution error: ${err.message}`);
    }
  }

  assert(customCalculatedCount === 70, `Expected 70 live output-producing reports, got ${customCalculatedCount}`);
  assert(honestUnavailableCount === 6, `Expected 6 honest unavailable reports, got ${honestUnavailableCount}`);
  assert(unexpectedDefaultCount === 0, `Expected 0 generic default fallbacks, got ${unexpectedDefaultCount}`);

  // ================================================================
  // TEST SUITE 3: Mathematical Reconciliation with Database Records
  // ================================================================
  console.log('\n--- Test Suite 3: Mathematical Reconciliation with Database Records ---');

  // 1. Task Summary reconciliation
  const dbTickets = await db.prepare("SELECT * FROM tickets WHERE archived = 0").all();
  const dbOpen = dbTickets.filter((t) => t.status === 'open').length;
  const dbInProg = dbTickets.filter((t) => t.status === 'in_progress').length;
  const dbResolved = dbTickets.filter((t) => ['resolved', 'closed'].includes(t.status)).length;

  const taskSummaryData = await getReportExecutionData({
    reportSlug: 'task-summary',
    filters: { preset: 'this_month' },
    currentUser: adminUser,
  });

  const getKpiVal = (data, key) => data.kpis.find((k) => k.key === key)?.value;

  assert(getKpiVal(taskSummaryData, 'total_tickets') === dbTickets.length, `Task Summary total tickets matches DB (${dbTickets.length})`);
  assert(getKpiVal(taskSummaryData, 'open_tickets') === dbOpen, `Task Summary open tickets matches DB (${dbOpen})`);
  assert(getKpiVal(taskSummaryData, 'in_progress_tickets') === dbInProg, `Task Summary in-progress tickets matches DB (${dbInProg})`);
  assert(getKpiVal(taskSummaryData, 'resolved_tickets') === dbResolved, `Task Summary resolved tickets matches DB (${dbResolved})`);

  // 2. Employee Directory headcount reconciliation
  const dbEmployees = await db.prepare("SELECT * FROM employees").all();
  const dbActiveEmployees = dbEmployees.filter((e) => e.active === 1).length;
  const directoryData = await getReportExecutionData({
    reportSlug: 'employee-directory',
    filters: { preset: 'this_month' },
    currentUser: adminUser,
  });

  assert(getKpiVal(directoryData, 'total_employees') === dbEmployees.length, `Directory total headcount matches DB (${dbEmployees.length})`);
  assert(getKpiVal(directoryData, 'active_employees') === dbActiveEmployees, `Directory active headcount matches DB (${dbActiveEmployees})`);

  // 3. Salary Summary payroll reconciliation
  const dbSalaried = dbEmployees.filter((e) => e.role !== 'client');
  const dbPayrollSum = dbSalaried.reduce((sum, e) => sum + (Number(e.base_salary) || 0), 0);
  const salaryData = await getReportExecutionData({
    reportSlug: 'salary-summary',
    filters: { preset: 'this_month' },
    currentUser: adminUser,
  });

  const expectedPayrollFormatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(dbPayrollSum);
  assert(getKpiVal(salaryData, 'total_monthly_payroll') === expectedPayrollFormatted, `Salary Summary monthly payroll matches DB (${expectedPayrollFormatted})`);

  // 4. Overdue tasks reconciliation
  const todayStr = new Date().toISOString().slice(0, 10);
  const dbOverdue = dbTickets.filter((t) => !['resolved', 'closed'].includes(t.status) && t.due_date && t.due_date < todayStr).length;
  const overdueData = await getReportExecutionData({
    reportSlug: 'overdue-tasks',
    filters: { preset: 'this_month' },
    currentUser: adminUser,
  });
  assert(getKpiVal(overdueData, 'overdue_count') === dbOverdue, `Overdue tasks report count matches DB (${dbOverdue})`);

  // ================================================================
  // TEST SUITE 4: Date Filter Accuracy & UTC Boundary Testing
  // ================================================================
  console.log('\n--- Test Suite 4: Date Filter Accuracy & UTC Boundary Testing ---');

  const todayRange = resolveDateRange({ preset: 'today' });
  assert(todayRange.startDate === todayStr && todayRange.endDate === todayStr, `Today filter bounds match current date: ${todayStr}`);

  const monthRange = resolveDateRange({ preset: 'this_month' });
  assert(monthRange.startDate.endsWith('-01'), `Month range starts on 1st: ${monthRange.startDate}`);
  assert(monthRange.endMs >= monthRange.startMs, 'Month end is strictly greater than or equal to start');

  const customRange = resolveDateRange({ preset: 'custom', startDate: '2026-05-01', endDate: '2026-05-31' });
  assert(customRange.startDate === '2026-05-01' && customRange.endDate === '2026-05-31', 'Custom date range preserves explicit start and end dates');

  // Verify filter behavior with custom date range
  const emptyDateData = await getReportExecutionData({
    reportSlug: 'employee-timesheet',
    filters: { preset: 'custom', startDate: '2020-01-01', endDate: '2020-01-02' },
    currentUser: adminUser,
  });
  assert(emptyDateData.rows.length === 0, 'Date filter strictly excludes records outside selected custom date boundaries');

  // ================================================================
  // TEST SUITE 5: Dimension Filters (Project, Employee, Priority)
  // ================================================================
  console.log('\n--- Test Suite 5: Dimension Filters ---');

  const testProject = (await db.prepare('SELECT id, key FROM projects LIMIT 1').get());
  const projectFiltered = await getReportExecutionData({
    reportSlug: 'task-summary',
    filters: { projectId: String(testProject.id) },
    currentUser: adminUser,
  });
  const allMatchProject = projectFiltered.rows.every((r) => r.key.startsWith(testProject.key));
  assert(allMatchProject, `Project filter restricts task summary exclusively to project ${testProject.key}`);

  const priorityFiltered = await getReportExecutionData({
    reportSlug: 'task-summary',
    filters: { priority: 'urgent' },
    currentUser: adminUser,
  });
  const allMatchPriority = priorityFiltered.rows.every((r) => r.priority === 'urgent');
  assert(allMatchPriority, 'Priority filter restricts task summary exclusively to urgent tasks');

  // ================================================================
  // TEST SUITE 6: Dynamic Project Inclusion (Zero Hardcoding)
  // ================================================================
  console.log('\n--- Test Suite 6: Dynamic Project Inclusion ---');
  const dynKey = `AUD_${Math.floor(Math.random() * 9000 + 1000)}`;
  const insRes = await db
    .prepare("INSERT INTO projects (key, name, description, color) VALUES (?, ?, ?, ?)")
    .run(dynKey, `Audit Dynamic Project ${dynKey}`, 'Created for accuracy audit', '#6554c0');
  const dynProjId = insRes.lastInsertRowid;

  const tktRes = await db
    .prepare("INSERT INTO tickets (title, description, status, priority, type, created_by, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run('Dynamic Test Ticket', 'Test task', 'open', 'high', 'task', adminUser.id, dynProjId);
  const dynTicketId = tktRes.lastInsertRowid;

  // Check Admin Dashboard dynamic aggregation
  const adminDash = await getAdminDashboardSummary({ preset: 'this_month' });
  const projFound = adminDash.projects.some((p) => p.id === dynProjId);
  assert(projFound, `Newly added project (${dynKey}) dynamically appears in dashboard projects without code change`);

  // Check Project Overview report
  const projOverview = await getReportExecutionData({
    reportSlug: 'project-overview',
    filters: { preset: 'this_month' },
    currentUser: adminUser,
  });
  const reportRowFound = projOverview.rows.some((r) => r.project_key === dynKey);
  assert(reportRowFound, `Newly added project (${dynKey}) dynamically appears in Project Overview report`);

  // Clean up test data
  await db.prepare('DELETE FROM tickets WHERE id = ?').run(dynTicketId);
  await db.prepare('DELETE FROM projects WHERE id = ?').run(dynProjId);
  assert(true, 'Cleaned up temporary audit test records safely');

  // ================================================================
  // TEST SUITE 7: Role-Based Access Control (RBAC) & Security Checks
  // ================================================================
  console.log('\n--- Test Suite 7: Role-Based Access Control & Security ---');

  // Developer blocked from salary report
  let devSalaryBlocked = false;
  try {
    await getReportExecutionData({
      reportSlug: 'salary-summary',
      filters: { preset: 'this_month' },
      currentUser: devUser,
    });
  } catch (err) {
    devSalaryBlocked = err.message.includes('restricted to authorized administrators');
  }
  assert(devSalaryBlocked, 'Developer role is strictly forbidden from accessing Section 4 (Salary Summary)');

  // Developer blocked from financial expense report
  let devFinanceBlocked = false;
  try {
    await getReportExecutionData({
      reportSlug: 'expense',
      filters: { preset: 'this_month' },
      currentUser: devUser,
    });
  } catch (err) {
    devFinanceBlocked = err.message.includes('restricted to authorized administrators');
  }
  assert(devFinanceBlocked, 'Developer role is strictly forbidden from accessing Section 6 (Expense Report)');

  // Client blocked from internal operational reports
  let clientBlocked = false;
  try {
    await getReportExecutionData({
      reportSlug: 'task-summary',
      filters: { preset: 'this_month' },
      currentUser: clientUser,
    });
  } catch (err) {
    clientBlocked = err.message.includes('Client role does not have authorization');
  }
  assert(clientBlocked, 'Client role is strictly forbidden from accessing internal task reports');

  // ================================================================
  // TEST SUITE 8: Role-Based Dashboard Access Selector Profiles
  // ================================================================
  console.log('\n--- Test Suite 8: Role-Based Dashboard Access Selector Profiles ---');

  assert(DASHBOARD_PROFILES.length === 4, 'Exactly 4 preview profiles defined (Admin, Manager, HR, Finance)');

  const adminProfile = getProfileConfig('admin');
  assert(adminProfile.allowedSectionSlugs.length === 7, 'Admin profile has access to all 7 sections');

  const managerProfile = getProfileConfig('manager');
  assert(managerProfile.hideFinancials === true, 'Manager profile hides financial records');
  assert(!managerProfile.allowedSectionSlugs.includes('salary-payroll-and-cost'), 'Manager profile strictly excludes Section 4 (Salary)');
  assert(!managerProfile.allowedSectionSlugs.includes('finance-and-startup-expense'), 'Manager profile strictly excludes Section 6 (Finance)');

  const hrProfile = getProfileConfig('hr');
  assert(hrProfile.hideFinancials === true, 'HR profile hides financial accounts');
  assert(hrProfile.allowedSectionSlugs.includes('employee-and-workforce'), 'HR profile includes Section 1 (Employee & Workforce)');
  assert(!hrProfile.allowedSectionSlugs.includes('salary-payroll-and-cost'), 'HR profile excludes Section 4 (Salary)');

  const financeProfile = getProfileConfig('finance');
  assert(financeProfile.allowedSectionSlugs.includes('salary-payroll-and-cost'), 'Finance profile includes Section 4 (Salary)');
  assert(financeProfile.allowedSectionSlugs.includes('finance-and-startup-expense'), 'Finance profile includes Section 6 (Finance)');
  assert(!financeProfile.allowedSectionSlugs.includes('ticket-and-task'), 'Finance profile excludes technical task queues');

  // ================================================================
  // TEST SUITE 9: Export Formatting & Content Integrity
  // ================================================================
  console.log('\n--- Test Suite 9: Export Formatting & Content Integrity ---');

  const sampleReportData = await getReportExecutionData({
    reportSlug: 'task-summary',
    filters: { preset: 'this_month' },
    currentUser: adminUser,
  });

  const csv = buildReportCsv({
    title: sampleReportData.report.title,
    dateRangeLabel: sampleReportData.dateRange?.preset || 'All Time',
    columns: sampleReportData.columns,
    rows: sampleReportData.rows,
  });
  assert(csv.startsWith('\uFEFF'), 'CSV export starts with UTF-8 BOM for Excel compatibility');
  assert(csv.includes('Task Summary Report'), 'CSV header includes exact report title');
  assert(csv.includes('Key,Title,Project'), 'CSV includes proper column headers');

  const xml = buildExcelXml({
    title: sampleReportData.report.title,
    dateRangeLabel: sampleReportData.dateRange?.preset || 'All Time',
    columns: sampleReportData.columns,
    rows: sampleReportData.rows,
  });
  assert(xml.startsWith('<?xml version="1.0"'), 'Excel XML starts with valid XML declaration');
  assert(xml.includes('Task Summary Report'), 'Excel XML includes report title');
  assert(xml.includes('<Worksheet ss:Name="Report">'), 'Excel XML contains Worksheet element');

  // ================================================================
  // TEST SUITE 10: Scheduler & Automated Exception Alerts
  // ================================================================
  console.log('\n--- Test Suite 10: Scheduler & Automated Exception Alerts ---');

  const sched = await createReportSchedule({
    name: 'Accuracy Audit Schedule',
    reportSlug: 'task-summary',
    sectionSlug: 'ticket-and-task',
    frequency: 'daily',
    recipients: 'admin@serphawk.com',
    userId: adminUser.id,
  });
  assert(sched && sched.id, `Report schedule created with ID #${sched.id}`);

  const runRes = await runDueReportSchedules({ forceRunId: sched.id });
  assert(runRes.length > 0 && runRes[0].status === 'success', 'Scheduled report executed and dispatched email');

  const alertRes = await checkAndSendExceptionAlerts();
  assert(alertRes.alertSent !== undefined, 'Exception alert scanner ran cleanly');

  // ================================================================
  // TEST SUITE 11: Comprehensive Reporting Filter System Verification
  // ================================================================
  console.log('\n--- Test Suite 11: Reporting Filter System Verification ---');

  // 1. Task Summary date presets test
  const taskMonth = await getReportExecutionData({
    reportSlug: 'task-summary',
    filters: { preset: 'this_month' },
    currentUser: adminUser,
  });
  const taskToday = await getReportExecutionData({
    reportSlug: 'task-summary',
    filters: { preset: 'today' },
    currentUser: adminUser,
  });
  const taskPastYear = await getReportExecutionData({
    reportSlug: 'task-summary',
    filters: { preset: 'custom', startDate: '2020-01-01', endDate: '2020-01-31' },
    currentUser: adminUser,
  });

  const monthTickets = getKpiVal(taskMonth, 'total_tickets');
  const todayTickets = getKpiVal(taskToday, 'total_tickets');
  const pastTickets = getKpiVal(taskPastYear, 'total_tickets');

  assert(monthTickets === 10, `Task summary for 'this_month' returns 10 tickets (got ${monthTickets})`);
  assert(todayTickets === 0, `Task summary for 'today' returns 0 created tickets (got ${todayTickets})`);
  assert(pastTickets === 0, `Task summary for past custom range (2020) returns 0 tickets (got ${pastTickets})`);
  assert(taskPastYear.rows.length === 0, `Task summary past custom range table rows length is 0`);

  // 2. Salary Summary periodic financial multiplier
  const salaryMonth = await getReportExecutionData({
    reportSlug: 'salary-summary',
    filters: { preset: 'this_month' },
    currentUser: adminUser,
  });
  const salaryQuarter = await getReportExecutionData({
    reportSlug: 'salary-summary',
    filters: { preset: 'quarter' },
    currentUser: adminUser,
  });

  const monthPayrollNum = parseInt(String(getKpiVal(salaryMonth, 'total_monthly_payroll')).replace(/[^0-9]/g, ''));
  const quarterPayrollNum = parseInt(String(getKpiVal(salaryQuarter, 'total_monthly_payroll')).replace(/[^0-9]/g, ''));

  assert(quarterPayrollNum === monthPayrollNum * 3, `Salary summary quarter payroll ($${quarterPayrollNum.toLocaleString()}) is 3x monthly payroll ($${monthPayrollNum.toLocaleString()})`);

  // 3. Multi-dimensional filter (Project + Priority)
  const multiFiltered = await getReportExecutionData({
    reportSlug: 'task-summary',
    filters: { projectId: String(testProject.id), priority: 'urgent' },
    currentUser: adminUser,
  });
  const matchesBoth = multiFiltered.rows.every((r) => r.key.startsWith(testProject.key) && r.priority === 'urgent');
  assert(matchesBoth, `Multi-dimensional filter correctly enforces BOTH project ${testProject.key} AND urgent priority`);

  // 4. Date range order inversion resilience
  const invertedRange = resolveDateRange({ preset: 'custom', startDate: '2026-12-31', endDate: '2026-01-01' });
  assert(invertedRange.startDate === '2026-01-01' && invertedRange.endDate === '2026-12-31', 'resolveDateRange gracefully handles inverted start/end dates by ordering them chronologically');

  // 5. Admin Dashboard Summary date filter reaction
  const dashMonth = await getAdminDashboardSummary({ preset: 'this_month' });
  const dashToday = await getAdminDashboardSummary({ preset: 'today' });
  assert(dashMonth.kpis.totalTickets === 10, `Admin dashboard summary this_month has 10 total scoped tickets (got ${dashMonth.kpis.totalTickets})`);
  assert(dashToday.kpis.totalTickets === 4, `Admin dashboard summary today has 4 in-flight active tickets (got ${dashToday.kpis.totalTickets})`);

  // ================================================================
  // FINAL AUDIT SUMMARY
  // ================================================================
  console.log('\n================================================================');
  console.log(`AUDIT EXECUTION COMPLETE: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    console.error('Defects found during audit:', defectsList);
    process.exit(1);
  }
}

runComprehensiveAudit().catch((err) => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
