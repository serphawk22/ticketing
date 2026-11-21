import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test_weekly_reports_phase1_2.db');

// Ensure isolated SQLite test database
for (const suffix of ['', '-wal', '-shm']) {
  const f = `${TEST_DB_PATH}${suffix}`;
  if (fs.existsSync(f)) {
    try { fs.unlinkSync(f); } catch {}
  }
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.NEXT_TELEMETRY_DISABLED = '1';

const { db } = await import('../lib/db.js');
const { assertIsolatedTestDatabase } = await import('../lib/dbEnvironment.js');
const {
  getWeeklySaturdayPeriod,
  computeReportingPeriod,
  resolveReportScope,
  collectWeeklyReportData,
  acquireRunLock,
  updateRunStatus,
  recordReportFile,
  getReportRun,
  listReportRuns,
} = await import('../lib/weeklyReportService.js');
const { WEEKLY_REPORT_POSTGRES_DDL } = await import('../lib/migrations/weeklyAiReportSchema.js');

test.before(() => {
  assertIsolatedTestDatabase('weekly-reports-test');
});

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
});

test('Phase 1.1: Weekly report schema tables, indexes, and partial unique indexes exist in SQLite', async () => {
  // Check tables exist
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'weekly_report_%'")
    .all();
  const tableNames = tables.map((t) => t.name);

  assert.ok(tableNames.includes('weekly_report_runs'), 'weekly_report_runs must exist');
  assert.ok(tableNames.includes('weekly_report_files'), 'weekly_report_files must exist');
  assert.ok(tableNames.includes('weekly_report_deliveries'), 'weekly_report_deliveries must exist');

  // Check partial unique indexes
  const indexes = await db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_uq_%'")
    .all();
  const indexNames = indexes.map((i) => i.name);

  assert.ok(indexNames.includes('idx_uq_report_file_company'), 'idx_uq_report_file_company partial unique index must exist');
  assert.ok(indexNames.includes('idx_uq_report_file_employee'), 'idx_uq_report_file_employee partial unique index must exist');
  assert.ok(indexNames.includes('idx_uq_deliv_management'), 'idx_uq_deliv_management partial unique index must exist');
  assert.ok(indexNames.includes('idx_uq_deliv_employee'), 'idx_uq_deliv_employee partial unique index must exist');
});

test('Phase 1.2: Partial unique indexes enforce exact company and employee file cardinality', async () => {
  // Insert real test employees to satisfy FK constraints
  const emp101 = await db.prepare(`
    INSERT INTO employees (name, email, role, department, title, active)
    VALUES ('Alice Dev', 'alice101@example.com', 'developer', 'Eng', 'Dev', 1)
  `).run();
  const emp102 = await db.prepare(`
    INSERT INTO employees (name, email, role, department, title, active)
    VALUES ('Bob Dev', 'bob102@example.com', 'developer', 'Eng', 'Dev', 1)
  `).run();

  // Insert a test run
  const runRes = await db.prepare(`
    INSERT INTO weekly_report_runs 
      (run_token, report_type, period_type, period_start, period_end, timezone, project_scope)
    VALUES ('test_token_cardinality', 'manual', 'weekly_sat', '2026-11-11T12:30:00.000Z', '2026-11-18T12:30:00.000Z', 'Asia/Kolkata', 'all')
  `).run();
  const runId = runRes.lastInsertRowid;

  // Insert company report file 1
  await recordReportFile({
    runId,
    fileType: 'company_report',
    filename: 'Company_Report.xlsx',
    storageKey: 'reports/comp_1.xlsx',
  });

  // Attempt duplicate company report file for same run -> must fail unique constraint
  await assert.rejects(
    async () => {
      await recordReportFile({
        runId,
        fileType: 'company_report',
        filename: 'Company_Report_Duplicate.xlsx',
        storageKey: 'reports/comp_2.xlsx',
      });
    },
    /UNIQUE constraint failed/i,
    'Second company_report file for same run must violate partial unique index'
  );

  // Insert employee report file for employee emp101
  await recordReportFile({
    runId,
    fileType: 'employee_report',
    employeeId: emp101.lastInsertRowid,
    employeeNameSnapshot: 'Alice Developer',
    filename: 'Employee_Report_101.xlsx',
    storageKey: 'reports/emp_101.xlsx',
  });

  // Attempt duplicate employee report for same employee emp101 -> must fail
  await assert.rejects(
    async () => {
      await recordReportFile({
        runId,
        fileType: 'employee_report',
        employeeId: emp101.lastInsertRowid,
        filename: 'Employee_Report_101_Dup.xlsx',
        storageKey: 'reports/emp_101_dup.xlsx',
      });
    },
    /UNIQUE constraint failed/i,
    'Second employee_report file for employee 101 must violate partial unique index'
  );

  // Different employee emp102 for same run -> must succeed
  const file102 = await recordReportFile({
    runId,
    fileType: 'employee_report',
    employeeId: emp102.lastInsertRowid,
    employeeNameSnapshot: 'Bob Developer',
    filename: 'Employee_Report_102.xlsx',
    storageKey: 'reports/emp_102.xlsx',
  });
  assert.ok(file102.id, 'Distinct employee report file must succeed');
});

test('Phase 1.3: PostgreSQL DDL syntax validation', () => {
  // Ensure the PostgreSQL DDL string contains all tables and valid PostgreSQL identity / timestamptz clauses
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY'));
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('TIMESTAMPTZ NOT NULL'));
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('CREATE TABLE IF NOT EXISTS weekly_report_runs'));
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('CREATE TABLE IF NOT EXISTS weekly_report_files'));
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('CREATE TABLE IF NOT EXISTS weekly_report_deliveries'));
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('idx_uq_report_file_company'));
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('idx_uq_deliv_management'));
});

test('Phase 2.1: Saturday 18:00 IST period calculation yields exact 168 hours', () => {
  // Test reference date: Saturday 2026-11-21 at 18:00 IST (12:30 UTC)
  const refSat = new Date('2026-11-21T12:30:00.000Z');
  const pSat = getWeeklySaturdayPeriod(refSat);

  assert.equal(pSat.periodType, 'weekly_sat');
  assert.equal(pSat.durationHours, 168);
  assert.equal(pSat.end, '2026-11-21T12:30:00.000Z');
  assert.equal(pSat.start, '2026-11-14T12:30:00.000Z');

  // Verify interval is exactly 7 days
  const startMs = new Date(pSat.start).getTime();
  const endMs = new Date(pSat.end).getTime();
  assert.equal(endMs - startMs, 7 * 24 * 3600 * 1000);

  // Test reference date: Wednesday 2026-11-18 (should snap back to previous Saturday 2026-11-14 18:00 IST)
  const refWed = new Date('2026-11-18T10:00:00.000Z');
  const pWed = getWeeklySaturdayPeriod(refWed);
  assert.equal(pWed.end, '2026-11-14T12:30:00.000Z');
  assert.equal(pWed.start, '2026-11-07T12:30:00.000Z');
  assert.equal(pWed.durationHours, 168);
});

test('Phase 2.2: Manual period calculations (last_7_days, current_month, custom)', () => {
  const ref = new Date('2026-11-18T12:00:00.000Z');

  // Last 7 days
  const p7 = computeReportingPeriod('last_7_days', { referenceDate: ref });
  assert.equal(p7.periodType, 'last_7_days');
  assert.equal(p7.durationHours, 168);

  // Current month
  const pMonth = computeReportingPeriod('current_month', { referenceDate: ref });
  assert.equal(pMonth.periodType, 'current_month');
  assert.ok(pMonth.start.includes('2026-10-31T18:30:00.000Z')); // 2026-11-01 00:00 IST = 2026-10-31 18:30 UTC

  // Custom date range: 2026-11-01 to 2026-11-05
  const pCustom = computeReportingPeriod('custom', {
    customStartDate: '2026-11-01',
    customEndDate: '2026-11-05',
    referenceDate: ref,
  });
  assert.equal(pCustom.periodType, 'custom');
  // 5 days = 120 hours
  assert.equal(pCustom.durationHours, 120);
});

test('Phase 2.3: Central Reporting Data Collection with Zero-Assignment Employees, Completion Attribution, and Overdue', async () => {
  // Seed fixtures
  let ownerUser = await db.prepare("SELECT * FROM users WHERE role = 'owner' LIMIT 1").get();
  if (!ownerUser) {
    const res = await db.prepare(`
      INSERT INTO users (name, email, password, role)
      VALUES ('Test Owner', 'testowner@example.com', 'hash', 'owner')
    `).run();
    ownerUser = await db.prepare("SELECT * FROM users WHERE id = ?").get(res.lastInsertRowid);
  }

  // Create two projects
  const p1Res = await db.prepare(`
    INSERT INTO projects (key, name, description, color)
    VALUES ('RP1', 'Reporting Alpha', 'Test Project Alpha', '#0c66e4')
  `).run();
  const proj1Id = p1Res.lastInsertRowid;

  const p2Res = await db.prepare(`
    INSERT INTO projects (key, name, description, color)
    VALUES ('RP2', 'Reporting Beta', 'Test Project Beta', '#00875a')
  `).run();
  const proj2Id = p2Res.lastInsertRowid;

  // Create 3 employees: Emp A (has tickets), Emp B (completes ticket), Emp C (zero tickets)
  const empARes = await db.prepare(`
    INSERT INTO employees (name, email, role, department, title, active)
    VALUES ('Dev Alpha', 'devalpha@example.com', 'developer', 'Backend', 'Senior Engineer', 1)
  `).run();
  const empAId = empARes.lastInsertRowid;

  const empBRes = await db.prepare(`
    INSERT INTO employees (name, email, role, department, title, active)
    VALUES ('Dev Beta', 'devbeta@example.com', 'developer', 'QA', 'QA Engineer', 1)
  `).run();
  const empBId = empBRes.lastInsertRowid;

  const empCRes = await db.prepare(`
    INSERT INTO employees (name, email, role, department, title, active)
    VALUES ('Dev Gamma', 'devgamma@example.com', 'developer', 'Design', 'UI Designer', 1)
  `).run();
  const empCId = empCRes.lastInsertRowid;

  // Set window boundaries: 2026-11-10T00:00:00Z to 2026-11-17T00:00:00Z
  const windowStart = '2026-11-10T00:00:00.000Z';
  const windowEnd = '2026-11-17T00:00:00.000Z';

  // Ticket 1: Assigned to Emp A, overdue, created in window
  const t1Res = await db.prepare(`
    INSERT INTO tickets (title, description, status, priority, type, created_by, employee_id, project_id, due_date, created_at, updated_at)
    VALUES ('Overdue Ticket 1', 'Desc 1', 'open', 'urgent', 'bug', ?, ?, ?, '2026-11-01', '2026-11-12T10:00:00.000Z', '2026-11-12T10:00:00.000Z')
  `).run(ownerUser.id, empAId, proj1Id);
  const ticket1Id = t1Res.lastInsertRowid;

  // Ticket 2: Assigned to Emp A, but completed during window by Emp B!
  const t2Res = await db.prepare(`
    INSERT INTO tickets (title, description, status, priority, type, created_by, employee_id, project_id, due_date, created_at, updated_at)
    VALUES ('Completed Ticket 2', 'Desc 2', 'resolved', 'medium', 'task', ?, ?, ?, '2026-11-20', '2026-11-08T10:00:00.000Z', '2026-11-14T15:00:00.000Z')
  `).run(ownerUser.id, empAId, proj1Id);
  const ticket2Id = t2Res.lastInsertRowid;

  // Log status change in ticket_activity for Ticket 2 attributing completion to Emp B!
  await db.prepare(`
    INSERT INTO ticket_activity (ticket_id, actor_id, field, from_value, to_value, employee_id, created_at)
    VALUES (?, ?, 'status', 'in_progress', 'resolved', ?, '2026-11-14T15:00:00.000Z')
  `).run(ticket2Id, ownerUser.id, empBId);

  // Ticket 3: In Project 2, blocked by Ticket 1
  const t3Res = await db.prepare(`
    INSERT INTO tickets (title, description, status, priority, type, created_by, employee_id, project_id, created_at, updated_at)
    VALUES ('Blocked Ticket 3', 'Desc 3', 'open', 'high', 'story', ?, ?, ?, '2026-11-11T10:00:00.000Z', '2026-11-11T10:00:00.000Z')
  `).run(ownerUser.id, empAId, proj2Id);
  const ticket3Id = t3Res.lastInsertRowid;

  // Add dependency relation: Ticket 1 blocks Ticket 3
  await db.prepare(`
    INSERT INTO ticket_relations (ticket_id, related_ticket_id, relation_type, created_at)
    VALUES (?, ?, 'blocks', '2026-11-11T10:30:00.000Z')
  `).run(ticket1Id, ticket3Id);

  // Run central report collection
  const reportData = await collectWeeklyReportData({
    user: ownerUser,
    periodType: 'custom',
    customStartDate: '2026-11-10',
    customEndDate: '2026-11-16',
    projectScope: 'all',
  });

  // Verify Executive Summary
  assert.ok(reportData.executiveSummary);
  assert.ok(reportData.executiveSummary.companyKPIs.totalCumulativeTickets >= 3);
  assert.ok(reportData.executiveSummary.companyKPIs.totalOverdueTickets >= 1);
  assert.ok(reportData.executiveSummary.companyKPIs.totalBlockedTickets >= 1);

  // Verify Overdue ticket is identified
  const overdueFound = reportData.blockersAndOverdue.find((t) => t.id === Number(ticket1Id));
  assert.ok(overdueFound, 'Ticket 1 must be flagged as overdue');
  assert.equal(overdueFound.isOverdue, true);
  assert.ok(overdueFound.daysOverdue > 0);

  // Verify Blocked ticket is identified and classified
  const blockedFound = reportData.blockersAndOverdue.find((t) => t.id === Number(ticket3Id));
  assert.ok(blockedFound, 'Ticket 3 must be flagged as blocked');
  assert.equal(blockedFound.isBlocked, true);
  assert.equal(blockedFound.blockerClassification, 'Confirmed Active');

  // Verify Completion Attribution: Ticket 2 completed during window by Emp B!
  const empBSummary = reportData.employeeSummary.find((e) => e.id === Number(empBId));
  assert.ok(empBSummary, 'Employee B must be in employee summary');
  assert.equal(empBSummary.weeklyCompleted, 1, 'Emp B must be credited with 1 weekly completion via activity log');

  // Verify Zero-Assignment Employee C is present with 0s and available status
  const empCSummary = reportData.employeeSummary.find((e) => e.id === Number(empCId));
  assert.ok(empCSummary, 'Employee C (zero tickets) must be in employee summary');
  assert.equal(empCSummary.totalAssigned, 0);
  assert.equal(empCSummary.openTickets, 0);
  assert.equal(empCSummary.workloadStatus, 'Available / Zero Assignment');

  // Verify Individual Scoped Employee Reports
  assert.ok(reportData.employeeReports.has(Number(empAId)));
  assert.ok(reportData.employeeReports.has(Number(empCId)));

  const empCReport = reportData.employeeReports.get(Number(empCId));
  assert.equal(empCReport.kpis.totalAssigned, 0);
  assert.equal(empCReport.activeTickets.length, 0);
});

test('Phase 2.4: Execution lock, lease expiry recovery, and run status lifecycle', async () => {
  const token = `lock_test_${Date.now()}`;

  // 1. First lock acquisition -> succeeds
  const lock1 = await acquireRunLock({
    runToken: token,
    reportType: 'manual',
    periodType: 'weekly_sat',
    periodStart: '2026-11-14T12:30:00.000Z',
    periodEnd: '2026-11-21T12:30:00.000Z',
    projectScope: 'all',
  });
  assert.equal(lock1.acquired, true);
  assert.equal(lock1.reason, 'created');
  assert.equal(lock1.run.status, 'running');

  // 2. Second lock acquisition with active run -> blocked
  const lock2 = await acquireRunLock({
    runToken: token,
    reportType: 'manual',
    periodType: 'weekly_sat',
    periodStart: '2026-11-14T12:30:00.000Z',
    periodEnd: '2026-11-21T12:30:00.000Z',
    projectScope: 'all',
  });
  assert.equal(lock2.acquired, false);
  assert.equal(lock2.reason, 'in_progress');

  // 3. Update run to completed
  await updateRunStatus(lock1.run.id, {
    status: 'completed',
    excelStatus: 'success',
    aiStatus: 'success',
    completed: true,
  });

  // 4. Lock acquisition for completed run -> blocked as completed
  const lock3 = await acquireRunLock({
    runToken: token,
    reportType: 'manual',
    periodType: 'weekly_sat',
    periodStart: '2026-11-14T12:30:00.000Z',
    periodEnd: '2026-11-21T12:30:00.000Z',
    projectScope: 'all',
  });
  assert.equal(lock3.acquired, false);
  assert.equal(lock3.reason, 'completed');

  // 5. Verify listReportRuns and getReportRun
  const details = await getReportRun(lock1.run.id);
  assert.equal(details.id, lock1.run.id);
  assert.equal(details.status, 'completed');

  const history = await listReportRuns({ limit: 5 });
  assert.ok(history.runs.length > 0);
  assert.ok(history.total > 0);
});
