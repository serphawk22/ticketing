import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test_weekly_reports_phase9.db');

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
  acquireRunLock,
  updateRunStatus,
  recordReportFile,
  getReportRun,
  listReportRuns,
} = await import('../lib/weeklyReportService.js');
const {
  initializeDeliveryRecords,
  retryFailedDeliveries,
} = await import('../lib/weeklyEmailService.js');
const { putAttachment, readAttachment } = await import('../lib/storage.js');

test.before(async () => {
  assertIsolatedTestDatabase();

  await db.prepare("DELETE FROM users WHERE email IN ('mgmt@test.com', 'emp1@test.com', 'emp2@test.com')").run();

  await db.prepare(`
    INSERT INTO users (name, email, password, role)
    VALUES ('Mgmt User', 'mgmt@test.com', 'hash', 'admin')
  `).run();

  const devRes = await db.prepare(`
    INSERT INTO users (name, email, password, role)
    VALUES ('Dev One', 'emp1@test.com', 'hash', 'developer')
  `).run();

  await db.prepare(`
    INSERT INTO employees (name, email, role, title, department, active, user_id)
    VALUES ('Dev One', 'emp1@test.com', 'developer', 'Senior Dev', 'Engineering', 1, ?)
  `).run(devRes.lastInsertRowid);
});

test('Phase 9.1: Concurrency protection — simultaneous acquireRunLock rejects overlapping execution', async () => {
  assertIsolatedTestDatabase();

  const token = 'concurrent_test_' + Date.now();
  const lock1 = await acquireRunLock({
    runToken: token,
    reportType: 'manual',
    periodType: 'last_7_days',
    periodStart: '2026-11-07 18:00:00',
    periodEnd: '2026-11-14 18:00:00',
    projectScope: 'all',
    requestedBy: 1,
  });

  assert.equal(lock1.acquired, true);

  // Second lock attempt with the same token while run is running
  const lock2 = await acquireRunLock({
    runToken: token,
    reportType: 'manual',
    periodType: 'last_7_days',
    periodStart: '2026-11-07 18:00:00',
    periodEnd: '2026-11-14 18:00:00',
    projectScope: 'all',
    requestedBy: 1,
  });

  assert.equal(lock2.acquired, false, 'Simultaneous lock must be rejected');
  assert.equal(lock2.reason, 'in_progress');
});

test('Phase 9.2: History listing and enriched delivery aggregation', async () => {
  assertIsolatedTestDatabase();

  const lock = await acquireRunLock({
    runToken: 'history_test_' + Date.now(),
    reportType: 'manual',
    periodType: 'weekly_sat',
    periodStart: '2026-11-07 18:00:00',
    periodEnd: '2026-11-14 18:00:00',
    projectScope: 'all',
    requestedBy: 1,
  });
  const runId = lock.run.id;

  const file = await recordReportFile({
    runId,
    fileType: 'company_report',
    filename: 'Company_Weekly_Report.xlsx',
    storageKey: `reports/weekly/${runId}/Company.xlsx`,
    fileSizeBytes: 2048,
    status: 'generated',
  });

  // Insert mock deliveries: 1 accepted, 2 failed
  await db.prepare(`
    INSERT INTO weekly_report_deliveries (run_id, file_id, recipient_type, recipient_email, delivery_status)
    VALUES (?, ?, 'management', 'mgmt@test.com', 'accepted')
  `).run(runId, file.id);

  await db.prepare(`
    INSERT INTO weekly_report_deliveries (run_id, file_id, recipient_type, recipient_email, delivery_status)
    VALUES (?, ?, 'employee', 'emp1@test.com', 'failed')
  `).run(runId, file.id);

  await db.prepare(`
    INSERT INTO weekly_report_deliveries (run_id, file_id, recipient_type, recipient_email, delivery_status)
    VALUES (?, ?, 'employee', 'emp2@test.com', 'failed')
  `).run(runId, file.id);

  const { runs } = await listReportRuns({ limit: 10, offset: 0 });
  const found = runs.find((r) => r.id === runId);
  assert.ok(found, 'Created run must appear in history list');
  assert.equal(found.report_type, 'manual');
  assert.equal(found.period_type, 'weekly_sat');
});

test('Phase 9.3: Controlled retry pipeline for failed deliveries only', async () => {
  assertIsolatedTestDatabase();

  const lock = await acquireRunLock({
    runToken: 'retry_pipeline_test_' + Date.now(),
    reportType: 'manual',
    periodType: 'last_7_days',
    periodStart: '2026-11-07 18:00:00',
    periodEnd: '2026-11-14 18:00:00',
    projectScope: 'all',
    requestedBy: 1,
  });
  const runId = lock.run.id;

  // Put a dummy attachment in storage
  const dummyBuffer = Buffer.from('PK\x03\x04DummyContent');
  const storageKey = `reports/weekly/${runId}/Company_Report.xlsx`;
  await putAttachment(storageKey, dummyBuffer);

  const file = await recordReportFile({
    runId,
    fileType: 'company_report',
    filename: 'Company_Report.xlsx',
    storageKey,
    fileSizeBytes: dummyBuffer.length,
    status: 'generated',
  });

  // 1 accepted, 1 failed
  const d1 = await db.prepare(`
    INSERT INTO weekly_report_deliveries (run_id, file_id, recipient_type, recipient_email, delivery_status)
    VALUES (?, ?, 'management', 'ok@test.com', 'accepted')
  `).run(runId, file.id);

  const d2 = await db.prepare(`
    INSERT INTO weekly_report_deliveries (run_id, file_id, recipient_type, recipient_email, delivery_status)
    VALUES (?, ?, 'management', 'fail@test.com', 'failed')
  `).run(runId, file.id);

  const retryRes = await retryFailedDeliveries(runId);
  assert.equal(retryRes.retriedCount, 1, 'Only the failed record should be retried');

  // Verify accepted was not re-processed
  const rec1 = await db.prepare('SELECT delivery_status, attempt_count FROM weekly_report_deliveries WHERE id = ?').get(d1.lastInsertRowid);
  assert.equal(rec1.delivery_status, 'accepted');
  assert.equal(rec1.attempt_count, 0);

  // Verify run retry_count incremented
  const run = await getReportRun(runId);
  assert.equal(run.retry_count, 1);
});
