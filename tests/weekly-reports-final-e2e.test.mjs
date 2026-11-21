import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test_weekly_reports_final_e2e.db');

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
const {
  generateCompanyWorkbookBuffer,
  generateEmployeeWorkbookBuffer,
  sanitizeExcelValue,
} = await import('../lib/weeklyExcelGenerator.js');
const {
  generateWeeklyAiReportInsights,
  generateEmployeeAiObservations,
  validateWeeklyAiReportResponse,
} = await import('../lib/weeklyAiReporting.js');
const {
  resolveReportRecipients,
  claimDeliveryRecord,
  updateDeliveryResult,
  reconcileStaleInFlightDeliveries,
  retryFailedDeliveries,
  initializeDeliveryRecords,
  executeReportEmailPipeline,
} = await import('../lib/weeklyEmailService.js');
const { putAttachment, readAttachment } = await import('../lib/storage.js');
const { WEEKLY_REPORT_POSTGRES_DDL } = await import('../lib/migrations/weeklyAiReportSchema.js');

let testOwnerId;
let testAdminId;
let testMgrUserId;
let testMgrEmpId;
let testDev1UserId;
let testDev1EmpId;
let testDev2EmpId;
let testSharedEmp1Id;
let testSharedEmp2Id;
let testProjAlphaId;
let testProjBetaId;

test.before(async () => {
  assertIsolatedTestDatabase();

  // Clear weekly report tables
  await db.prepare('DELETE FROM weekly_report_deliveries').run();
  await db.prepare('DELETE FROM weekly_report_files').run();
  await db.prepare('DELETE FROM weekly_report_runs').run();

  // 1. Create Users
  const uOwner = await db.prepare("INSERT INTO users (name, email, password, role) VALUES ('Owner Corp', 'owner@corp.com', 'h', 'owner')").run();
  testOwnerId = Number(uOwner.lastInsertRowid);

  const uAdmin = await db.prepare("INSERT INTO users (name, email, password, role) VALUES ('Admin Corp', 'admin@corp.com', 'h', 'admin')").run();
  testAdminId = Number(uAdmin.lastInsertRowid);

  const uMgr = await db.prepare("INSERT INTO users (name, email, password, role) VALUES ('Manager Lead', 'mgr@corp.com', 'h', 'manager')").run();
  testMgrUserId = Number(uMgr.lastInsertRowid);

  const uDev1 = await db.prepare("INSERT INTO users (name, email, password, role) VALUES ('Alice Dev', 'alice@corp.com', 'h', 'developer')").run();
  testDev1UserId = Number(uDev1.lastInsertRowid);

  // 2. Create Employees
  const eMgr = await db.prepare("INSERT INTO employees (name, email, role, title, department, active, user_id) VALUES ('Manager Lead', 'mgr@corp.com', 'manager', 'Engineering Manager', 'Core', 1, ?)").run(testMgrUserId);
  testMgrEmpId = Number(eMgr.lastInsertRowid);

  const eDev1 = await db.prepare("INSERT INTO employees (name, email, role, title, department, active, user_id) VALUES ('Alice Dev', 'alice@corp.com', 'developer', 'Senior Dev', 'Core', 1, ?)").run(testDev1UserId);
  testDev1EmpId = Number(eDev1.lastInsertRowid);

  // Dev 2 has zero assignments
  const eDev2 = await db.prepare("INSERT INTO employees (name, email, role, title, department, active) VALUES ('Bob Zero', 'bob.zero@corp.com', 'developer', 'QA Eng', 'Core', 1)").run();
  testDev2EmpId = Number(eDev2.lastInsertRowid);

  // Employee linked to Owner (Dual role: Management + Employee with same email)
  await db.prepare("INSERT INTO employees (name, email, role, title, department, active, user_id) VALUES ('Owner Corp', 'owner@corp.com', 'owner', 'Founder & CEO', 'Executive', 1, ?)").run(testOwnerId);

  // Employee with invalid email syntax
  await db.prepare("INSERT INTO employees (name, email, role, title, department, active) VALUES ('Invalid Mail Dev', 'bad-email-no-at', 'developer', 'Intern', 'Ops', 1)").run();

  // 3. Create Projects
  const pAlpha = await db.prepare("INSERT INTO projects (name, key, description, status) VALUES ('Project Alpha', 'ALP', 'Alpha Platform', 'active')").run();
  testProjAlphaId = Number(pAlpha.lastInsertRowid);

  const pBeta = await db.prepare("INSERT INTO projects (name, key, description, status) VALUES ('Project Beta', 'BET', 'Beta Platform', 'active')").run();
  testProjBetaId = Number(pBeta.lastInsertRowid);

  // 4. Create Tickets
  // Overdue & Blocked ticket
  const t1 = await db.prepare(`
    INSERT INTO tickets (title, description, project_id, status, priority, created_by, employee_id, due_date, created_at, updated_at)
    VALUES ('=1+1 Blocker Bug', 'Injected formula title', ?, 'open', 'urgent', ?, ?, datetime('now', '-10 days'), datetime('now', '-5 days'), datetime('now', '-1 day'))
  `).run(testProjAlphaId, testOwnerId, testDev1EmpId);

  // Ticket resolved in current weekly window
  const t2 = await db.prepare(`
    INSERT INTO tickets (title, description, project_id, status, priority, created_by, employee_id, created_at, updated_at)
    VALUES ('Health Check API', 'Implement health route', ?, 'resolved', 'medium', ?, ?, datetime('now', '-3 days'), datetime('now', '-1 day'))
  `).run(testProjAlphaId, testOwnerId, testDev1EmpId);

  // Log activity attributing resolution of t2 to Alice
  await db.prepare(`
    INSERT INTO ticket_activity (ticket_id, actor_id, field, from_value, to_value, created_at)
    VALUES (?, ?, 'status', 'in_progress', 'resolved', datetime('now', '-1 day'))
  `).run(t2.lastInsertRowid, testDev1UserId);

  // Relation: t1 is blocked by t2
  await db.prepare(`
    INSERT INTO ticket_relations (ticket_id, related_ticket_id, relation_type)
    VALUES (?, ?, 'blocked_by')
  `).run(t1.lastInsertRowid, t2.lastInsertRowid);
});

test('E2E Audit 1: Saturday 18:00 IST period calculation yields exactly 168 hours across boundary shifts', () => {
  // Test from a known Wednesday
  const wedDate = new Date('2026-11-18T10:00:00.000Z');
  const period = getWeeklySaturdayPeriod(wedDate);

  assert.equal(period.periodType, 'weekly_sat');
  assert.equal(period.durationHours, 168);

  const startMs = new Date(period.start).getTime();
  const endMs = new Date(period.end).getTime();
  assert.equal((endMs - startMs) / (1000 * 3600), 168, 'Must be exact 168 hours');

  // Verify end is Saturday 12:30 UTC (= 18:00 IST)
  const endUtc = new Date(period.end);
  assert.equal(endUtc.getUTCDay(), 6, 'End must be a Saturday');
  assert.equal(endUtc.getUTCHours(), 12, '12:30 UTC');
  assert.equal(endUtc.getUTCMinutes(), 30);
});

test('E2E Audit 2: Reporting periods support last_7_days, current_month, and custom date range', () => {
  const p7 = computeReportingPeriod('last_7_days');
  assert.equal(p7.periodType, 'last_7_days');
  assert.equal(p7.durationHours, 168);

  const pMonth = computeReportingPeriod('current_month');
  assert.equal(pMonth.periodType, 'current_month');
  assert.ok(pMonth.durationHours > 0);

  const pCustom = computeReportingPeriod('custom', {
    customStartDate: '2026-11-01',
    customEndDate: '2026-11-15',
  });
  assert.equal(pCustom.periodType, 'custom');
  assert.equal(pCustom.durationHours, 15 * 24);
});

test('E2E Audit 3: Complete Company Workbook Generation (7 sheets) with formula sanitization', async () => {
  const period = getWeeklySaturdayPeriod(new Date());
  const reportData = await collectWeeklyReportData({
    period,
    user: { id: testOwnerId, role: 'owner' },
    projectScope: 'all',
  });

  const aiInsights = await generateWeeklyAiReportInsights({ reportData, period });
  assert.ok(aiInsights, 'AI insights generated');

  const buffer = await generateCompanyWorkbookBuffer({ reportData, aiInsights });
  assert.ok(Buffer.isBuffer(buffer));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const expectedSheets = [
    'Executive Summary',
    'Project Summary',
    'Employee Summary',
    'Complete Ticket Register',
    'Blockers & Overdue',
    'AI Insights',
    'Weekly Activity',
  ];

  assert.equal(wb.worksheets.length, 7, 'Must contain exactly 7 sheets');
  for (let i = 0; i < expectedSheets.length; i++) {
    assert.equal(wb.worksheets[i].name, expectedSheets[i]);
  }

  // Verify formula sanitization on Sheet 4 (Complete Ticket Register)
  const regSheet = wb.getWorksheet('Complete Ticket Register');
  let sanitizedFound = false;
  regSheet.eachRow((row) => {
    row.eachCell((cell) => {
      const v = String(cell.value || '');
      if (v.includes('Blocker Bug')) {
        sanitizedFound = true;
        assert.ok(v.startsWith("'="), `Formula must be prepended with quote: ${v}`);
      }
    });
  });
  assert.ok(sanitizedFound, 'Sanitized title must be found in sheet');
});

test('E2E Audit 4: Complete Employee Workbook Generation (6 sheets) with zero-assignment handling', async () => {
  const period = getWeeklySaturdayPeriod(new Date());
  const reportData = await collectWeeklyReportData({
    period,
    user: { id: testOwnerId, role: 'owner' },
    projectScope: 'all',
  });

  // Verify Dev 2 (Bob Zero with 0 assignments) has an entry in employeeReports
  const bobData = reportData.employeeReports.get(testDev2EmpId);
  assert.ok(bobData, 'Zero assignment employee must have a report entry');
  assert.equal(bobData.kpis.totalAssigned, 0);

  const bobObs = await generateEmployeeAiObservations({ employeeReportData: bobData, period });
  const bobBuffer = await generateEmployeeWorkbookBuffer({
    employeeReportData: bobData,
    aiObservations: bobObs,
    period,
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bobBuffer);

  const expectedEmpSheets = [
    'My Work Overview',
    'Active & Upcoming Tickets',
    'Completed Tickets',
    'Overdue & Blockers',
    'My Recent Activity',
    'My AI Observations',
  ];

  assert.equal(wb.worksheets.length, 6, 'Employee workbook must have exactly 6 sheets');
  for (let i = 0; i < expectedEmpSheets.length; i++) {
    assert.equal(wb.worksheets[i].name, expectedEmpSheets[i]);
  }
});

test('E2E Audit 5: Privacy — Cross-role shared email address segregation and invalid email skipping', async () => {
  const recipients = await resolveReportRecipients({
    user: { id: testOwnerId, role: 'owner' },
    includeEmployees: true,
  });

  // Verify Owner user with email 'owner@corp.com' is resolved as Management
  const mgmtOwner = recipients.managementRecipients.find((r) => r.email === 'owner@corp.com');
  assert.ok(mgmtOwner, 'Owner must be present in management recipients');
  assert.equal(mgmtOwner.recipientType, 'management');
  assert.equal(mgmtOwner.employeeId, null);
  assert.equal(mgmtOwner.isValid, true);

  // Verify Owner employee with email 'owner@corp.com' is resolved as Employee
  const empOwner = recipients.employeeRecipients.find((r) => r.email === 'owner@corp.com');
  assert.ok(empOwner, 'Owner employee must be present in employee recipients');
  assert.equal(empOwner.recipientType, 'employee');
  assert.ok(empOwner.employeeId > 0);
  assert.equal(empOwner.isValid, true);

  // Verify invalid email employee is cleanly skipped
  const badEmp = recipients.employeeRecipients.find((r) => r.email === 'bad-email-no-at');
  assert.ok(badEmp, 'Invalid email employee must be recorded');
  assert.equal(badEmp.isValid, false);
  assert.ok(badEmp.skipReason.includes('Missing or invalid'));
});

test('E2E Audit 6: Delivery State Machine, Atomic Claiming, and Recovery of Stale Deliveries', async () => {
  const lock = await acquireRunLock({
    runToken: 'e2e_deliv_test_' + Date.now(),
    reportType: 'manual',
    periodType: 'last_7_days',
    periodStart: '2026-11-07 18:00:00',
    periodEnd: '2026-11-14 18:00:00',
    projectScope: 'all',
    requestedBy: testOwnerId,
  });
  const runId = lock.run.id;

  const file = await recordReportFile({
    runId,
    fileType: 'company_report',
    filename: 'Company.xlsx',
    storageKey: `reports/weekly/${runId}/Company.xlsx`,
    fileSizeBytes: 1024,
    status: 'generated',
  });

  const rec = [
    { recipientType: 'management', email: 'owner@corp.com', name: 'Owner', userId: testOwnerId, employeeId: null, isValid: true },
    { recipientType: 'employee', email: 'bad-email-format', name: 'Bad', userId: null, employeeId: testDev1EmpId, isValid: false, skipReason: 'Invalid syntax' },
  ];

  const deliveryRecords = await initializeDeliveryRecords(runId, rec, { managementFileId: file.id });
  const pendingRec = deliveryRecords.find((r) => r.recipient_email === 'owner@corp.com');
  const skippedRec = deliveryRecords.find((r) => r.recipient_email === 'bad-email-format');

  assert.equal(pendingRec.delivery_status, 'pending');
  assert.equal(skippedRec.delivery_status, 'skipped');

  // Claim pending record
  const claim1 = await claimDeliveryRecord(pendingRec.id);
  assert.equal(claim1, true, 'First claim must succeed');

  // Second claim must fail
  const claim2 = await claimDeliveryRecord(pendingRec.id);
  assert.equal(claim2, false, 'Concurrent claim on in_flight record must fail');

  // Simulate stale in_flight record (>15 mins ago)
  await db.prepare("UPDATE weekly_report_deliveries SET last_attempt_at = datetime('now', '-20 minutes') WHERE id = ?").run(pendingRec.id);
  await reconcileStaleInFlightDeliveries(runId);

  const reconciled = await db.prepare('SELECT delivery_status, error_message FROM weekly_report_deliveries WHERE id = ?').get(pendingRec.id);
  assert.equal(reconciled.delivery_status, 'uncertain');
  assert.ok(reconciled.error_message.includes('timed out in-flight'));
});

test('E2E Audit 7: retryFailedDeliveries retries ONLY confirmed failed deliveries and never accepted or uncertain', async () => {
  const lock = await acquireRunLock({
    runToken: 'e2e_retry_test_' + Date.now(),
    reportType: 'manual',
    periodType: 'last_7_days',
    periodStart: '2026-11-07 18:00:00',
    periodEnd: '2026-11-14 18:00:00',
    projectScope: 'all',
    requestedBy: testOwnerId,
  });
  const runId = lock.run.id;

  const file = await recordReportFile({
    runId,
    fileType: 'company_report',
    filename: 'Company.xlsx',
    storageKey: `reports/weekly/${runId}/Company.xlsx`,
    fileSizeBytes: 1024,
    status: 'generated',
  });

  const aId = (await db.prepare("INSERT INTO weekly_report_deliveries (run_id, file_id, recipient_type, recipient_email, delivery_status) VALUES (?, ?, 'management', 'a@corp.com', 'accepted')").run(runId, file.id)).lastInsertRowid;
  const uId = (await db.prepare("INSERT INTO weekly_report_deliveries (run_id, file_id, recipient_type, recipient_email, delivery_status) VALUES (?, ?, 'management', 'u@corp.com', 'uncertain')").run(runId, file.id)).lastInsertRowid;
  const fId = (await db.prepare("INSERT INTO weekly_report_deliveries (run_id, file_id, recipient_type, recipient_email, delivery_status) VALUES (?, ?, 'management', 'f@corp.com', 'failed')").run(runId, file.id)).lastInsertRowid;

  const retryRes = await retryFailedDeliveries(runId);
  assert.equal(retryRes.retriedCount, 1, 'Only 1 failed record must be retried');

  const checkA = await db.prepare('SELECT delivery_status FROM weekly_report_deliveries WHERE id = ?').get(aId);
  assert.equal(checkA.delivery_status, 'accepted');

  const checkU = await db.prepare('SELECT delivery_status FROM weekly_report_deliveries WHERE id = ?').get(uId);
  assert.equal(checkU.delivery_status, 'uncertain');
});

test('E2E Audit 8: PostgreSQL DDL contains all tables, indexes, and partial unique constraints', () => {
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('CREATE TABLE IF NOT EXISTS weekly_report_runs'));
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('CREATE TABLE IF NOT EXISTS weekly_report_files'));
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('CREATE TABLE IF NOT EXISTS weekly_report_deliveries'));
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('idx_uq_report_file_company'));
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('idx_uq_report_file_employee'));
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('idx_uq_deliv_management'));
  assert.ok(WEEKLY_REPORT_POSTGRES_DDL.includes('idx_uq_deliv_employee'));
});
