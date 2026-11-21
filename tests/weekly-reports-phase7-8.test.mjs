import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test_weekly_reports_phase7_8.db');

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
} = await import('../lib/weeklyExcelGenerator.js');
const {
  generateWeeklyAiReportInsights,
} = await import('../lib/weeklyAiReporting.js');
const {
  resolveReportRecipients,
  executeReportEmailPipeline,
  retryFailedDeliveries,
} = await import('../lib/weeklyEmailService.js');
const { putAttachment, readAttachment } = await import('../lib/storage.js');

test.before(async () => {
  assertIsolatedTestDatabase();

  // Seed sample users, projects, tickets
  await db.prepare("DELETE FROM users WHERE email IN ('owner@test.com', 'admin@test.com', 'dev1@test.com', 'dev2@test.com')").run();

  const ownerRes = await db.prepare(`
    INSERT INTO users (name, email, password, role)
    VALUES ('Owner User', 'owner@test.com', 'hash', 'owner')
  `).run();

  const adminRes = await db.prepare(`
    INSERT INTO users (name, email, password, role)
    VALUES ('Admin User', 'admin@test.com', 'hash', 'admin')
  `).run();

  const dev1Res = await db.prepare(`
    INSERT INTO users (name, email, password, role)
    VALUES ('Dev One', 'dev1@test.com', 'hash', 'developer')
  `).run();

  const emp1Res = await db.prepare(`
    INSERT INTO employees (name, email, role, title, department, active, user_id)
    VALUES ('Dev One', 'dev1@test.com', 'developer', 'Software Engineer', 'Engineering', 1, ?)
  `).run(dev1Res.lastInsertRowid);

  const emp2Res = await db.prepare(`
    INSERT INTO employees (name, email, role, title, department, active)
    VALUES ('Dev Two', 'dev2@test.com', 'developer', 'QA Engineer', 'QA', 1)
  `).run();

  const projRes = await db.prepare(`
    INSERT INTO projects (name, key, description, status)
    VALUES ('Core API', 'API', 'Core API platform', 'active')
  `).run();

  await db.prepare(`
    INSERT INTO tickets (title, description, project_id, status, priority, created_by, employee_id, created_at, updated_at)
    VALUES ('Build Auth Service', 'Description', ?, 'in_progress', 'high', ?, ?, datetime('now', '-5 days'), datetime('now', '-1 day'))
  `).run(projRes.lastInsertRowid, dev1Res.lastInsertRowid, emp1Res.lastInsertRowid);

  await db.prepare(`
    INSERT INTO tickets (title, description, project_id, status, priority, created_by, employee_id, created_at, updated_at)
    VALUES ('Setup Health Check', 'Description', ?, 'resolved', 'medium', ?, ?, datetime('now', '-4 days'), datetime('now', '-1 day'))
  `).run(projRes.lastInsertRowid, dev1Res.lastInsertRowid, emp1Res.lastInsertRowid);
});

test('Phase 7.1: Recipients preview resolves management and employee recipients with validity check', async () => {
  assertIsolatedTestDatabase();

  const user = { id: 1, role: 'admin' };
  const recipients = await resolveReportRecipients({ user, includeEmployees: true });

  assert.ok(recipients.managementRecipients.length >= 2, 'Must include Owner and Admin');
  assert.ok(recipients.employeeRecipients.length >= 2, 'Must include active employees');

  for (const m of recipients.managementRecipients) {
    assert.equal(m.recipientType, 'management');
    assert.equal(typeof m.isValid, 'boolean');
  }

  for (const e of recipients.employeeRecipients) {
    assert.equal(e.recipientType, 'employee');
    assert.equal(typeof e.isValid, 'boolean');
  }
});

test('Phase 7.2: On-Demand Manual Generation generates company report without sending emails (Download Only)', async () => {
  assertIsolatedTestDatabase();

  const user = { id: 1, role: 'admin' };
  const period = computeReportingPeriod('last_7_days');

  const lockResult = await acquireRunLock({
    runToken: 'test_manual_on_demand_' + Date.now(),
    reportType: 'manual',
    periodType: period.periodType,
    periodStart: period.start,
    periodEnd: period.end,
    projectScope: 'all',
    requestedBy: user.id,
  });

  assert.equal(lockResult.acquired, true);
  const run = lockResult.run;

  const reportData = await collectWeeklyReportData({
    period,
    user,
    projectScope: 'all',
  });

  const aiInsights = await generateWeeklyAiReportInsights({ reportData, period });
  assert.ok(aiInsights, 'AI insights (offline fallback) generated');

  const companyBuffer = await generateCompanyWorkbookBuffer({ reportData, aiInsights });
  assert.ok(Buffer.isBuffer(companyBuffer));

  const filename = `SerpHawk_Report_${Date.now()}.xlsx`;
  const storageKey = `reports/weekly/${run.id}/${filename}`;
  await putAttachment(storageKey, companyBuffer);

  const fileRecord = await recordReportFile({
    runId: run.id,
    fileType: 'company_report',
    filename,
    storageKey,
    fileSizeBytes: companyBuffer.length,
    status: 'generated',
  });

  await updateRunStatus(run.id, {
    status: 'completed',
    aiStatus: aiInsights.aiAvailable ? 'success' : 'failed',
    excelStatus: 'success',
    managementEmailStatus: 'not_requested',
    employeeEmailStatus: 'not_requested',
  });

  // Verify DB state
  const completedRun = await getReportRun(run.id);
  assert.equal(completedRun.status, 'completed');
  assert.equal(completedRun.excel_status, 'success');
  assert.equal(completedRun.management_email_status, 'not_requested');
  assert.equal(completedRun.employee_email_status, 'not_requested');

  // Verify file buffer can be read back
  const readBuffer = await readAttachment(storageKey);
  assert.equal(readBuffer.length, companyBuffer.length);
});

test('Phase 8.1: Saturday 18:00 IST Automated Scheduler logic and idempotency', async () => {
  assertIsolatedTestDatabase();

  const period = getWeeklySaturdayPeriod(new Date());
  const dateStamp = period.end.slice(0, 10);
  const runToken = `weekly_sat_test:${dateStamp}:${Date.now()}`;

  // First run: acquires lock
  const lock1 = await acquireRunLock({
    runToken,
    reportType: 'scheduled',
    periodType: 'weekly_sat',
    periodStart: period.start,
    periodEnd: period.end,
    projectScope: 'all',
    requestedBy: null,
  });

  assert.equal(lock1.acquired, true);
  const run = lock1.run;

  const systemUser = { id: null, role: 'owner', name: 'Automated System Scheduler' };
  const reportData = await collectWeeklyReportData({
    period,
    user: systemUser,
    projectScope: 'all',
  });

  const aiInsights = await generateWeeklyAiReportInsights({ reportData, period });

  // Execute email pipeline with simulated transport
  const emailStats = await executeReportEmailPipeline({
    runId: run.id,
    reportData,
    aiInsights,
    sendManagement: true,
    sendEmployees: true,
    user: systemUser,
  });

  assert.ok(emailStats.totalRecipients >= 2, 'Should have resolved recipients');
  assert.ok(emailStats.companyFileRecord, 'Must have recorded company report file');

  await updateRunStatus(run.id, {
    status: 'completed',
    excelStatus: 'success',
  });

  // Second run with same token: must report acquired: false with reason 'completed' (Idempotency)
  const lock2 = await acquireRunLock({
    runToken,
    reportType: 'scheduled',
    periodType: 'weekly_sat',
    periodStart: period.start,
    periodEnd: period.end,
    projectScope: 'all',
    requestedBy: null,
  });

  assert.equal(lock2.acquired, false);
  assert.equal(lock2.reason, 'completed');
  assert.equal(lock2.run.id, run.id);
});

test('Phase 8.2: vercel.json cron configuration is valid and matches Saturday 18:00 IST (12:30 UTC)', async () => {
  const vercelPath = path.resolve(process.cwd(), 'vercel.json');
  assert.ok(fs.existsSync(vercelPath), 'vercel.json must exist');

  const content = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  assert.ok(Array.isArray(content.crons), 'vercel.json must specify crons array');

  const weeklyCron = content.crons.find((c) => c.path === '/api/cron/weekly-ai-report');
  assert.ok(weeklyCron, 'Cron for /api/cron/weekly-ai-report must be present');
  assert.equal(weeklyCron.schedule, '30 12 * * 6', 'Schedule must be 30 12 * * 6 (Saturday 12:30 UTC = 18:00 IST)');
});
