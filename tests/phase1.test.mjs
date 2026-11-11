import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test_phase1_isolated.db');

// Ensure clean isolated SQLite environment BEFORE importing db.js / environment checks
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.NEXT_TELEMETRY_DISABLED = '1';

const { db } = await import('../lib/db.js');
const { getDatabaseEnvironment, assertIsolatedTestDatabase, assertMigrationContextOnly } = await import('../lib/dbEnvironment.js');
const { TestFixtureTracker, generateTestRunId } = await import('../lib/testFixtureTracker.js');
const { reconcileFallbackAttendance } = await import('../lib/attendance.js');

test.after(() => {
  // Remove ephemeral isolated test DB files after suite
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch {}
    }
  }
});

test('1. Production DB safety gates block live Neon Postgres and live app.db even with NODE_ENV=test', () => {
  const savedDriver = process.env.DB_DRIVER;
  const savedUrl = process.env.DATABASE_URL;
  const savedSqlite = process.env.SQLITE_DB_PATH;
  const savedNodeEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'postgres';
    process.env.DATABASE_URL = 'postgresql://user:pass@ep-flat-union-b58rn3f5-pooler.c-7.us-east-2.aws.neon.tech/neondb';
    assert.throws(() => assertIsolatedTestDatabase('unit-test'), /DB SAFETY ABORT/);

    process.env.DB_DRIVER = 'sqlite';
    delete process.env.SQLITE_DB_PATH;
    assert.throws(() => assertIsolatedTestDatabase('unit-test'), /DB SAFETY ABORT/);

    // Verify migration separation rejects test arguments
    const origArgv = process.argv;
    process.argv = ['node', 'migrate.mjs', '--run-id=foo'];
    assert.throws(() => assertMigrationContextOnly('migrate'), /AUTHORIZATION SEPARATION ERROR/);
    process.argv = origArgv;
  } finally {
    process.env.DB_DRIVER = savedDriver;
    if (savedUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedUrl;
    if (savedSqlite === undefined) delete process.env.SQLITE_DB_PATH; else process.env.SQLITE_DB_PATH = savedSqlite;
    process.env.NODE_ENV = savedNodeEnv;
  }

  const activeEnv = getDatabaseEnvironment();
  assert.equal(activeEnv.dialect, 'sqlite');
  assert.equal(activeEnv.isIsolatedTestDb, true);
  assert.equal(activeEnv.isProduction, false);
});

test('2. Quarantined clean-test-data.mjs refuses execution unconditionally', () => {
  assert.throws(() => {
    execFileSync(process.execPath, ['scripts/clean-test-data.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, DB_DRIVER: 'sqlite', SQLITE_DB_PATH: TEST_DB_PATH },
      stdio: 'pipe',
    });
  });
});

test('3. Phase 1 schema seeds 4 workflow stages, work categories, provisional 2026-10-24 schedule, and preserves 4-status tickets CHECK', async () => {
  const stages = await db.prepare('SELECT code, label FROM workflow_stages ORDER BY sort_order ASC').all();
  assert.deepEqual(
    stages.map((s) => s.code),
    ['open', 'in_progress', 'resolved', 'closed']
  );

  const cats = await db.prepare('SELECT COUNT(*) AS c FROM work_categories').get();
  assert.ok(Number(cats.c) >= 15);

  const sched = await db.prepare('SELECT effective_from, effective_date_status FROM business_schedule_history LIMIT 1').get();
  assert.equal(sched.effective_from, '2026-10-24');
  assert.equal(sched.effective_date_status, 'provisional_inferred_from_settings');

  // Verify tickets.status rejects invalid stage 'code_review'
  const admin = await db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  await assert.rejects(async () => {
    await db
      .prepare("INSERT INTO tickets (title, description, status, created_by) VALUES (?, ?, ?, ?)")
      .run('Bad status', 'desc', 'code_review', admin.id);
  });
});

test('4. Active stage closes once and becomes immutable; DB trigger rejects silent updates/deletes on closed rows', async () => {
  const admin = await db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  const res = await db
    .prepare("INSERT INTO tickets (title, description, status, created_by, created_at) VALUES (?, ?, 'open', ?, '2026-10-25 04:00:00')")
    .run('Immutable Test Ticket', 'testing immutability', admin.id);
  const ticketId = res.lastInsertRowid;

  const ins = await db
    .prepare(
      `INSERT INTO ticket_stage_history
         (ticket_id, transition_seq, from_status, to_status, changed_by, source, entry_at, duration_precision)
       VALUES (?, 1, NULL, 'open', ?, 'create', '2026-10-25 04:00:00', 'provisional_baseline')`
    )
    .run(ticketId, admin.id);
  const stageId = ins.lastInsertRowid;

  // Close open stage cleanly ONCE (exit_at IS NULL -> populated)
  await db
    .prepare(
      `UPDATE ticket_stage_history
       SET exit_at = '2026-10-25 06:00:00', calendar_seconds = 7200, business_seconds = 7200
       WHERE id = ? AND exit_at IS NULL`
    )
    .run(stageId);

  // Subsequent silent update or delete on closed historical row MUST fail via DB trigger
  await assert.rejects(async () => {
    await db.prepare('UPDATE ticket_stage_history SET calendar_seconds = 9999 WHERE id = ?').run(stageId);
  }, /immutable/);

  await assert.rejects(async () => {
    await db.prepare('DELETE FROM ticket_stage_history WHERE id = ?').run(stageId);
  }, /cannot be deleted/);

  // Append correction separately into ticket_stage_corrections
  await db
    .prepare(
      `INSERT INTO ticket_stage_corrections
         (stage_history_id, ticket_id, correction_seq, original_from_status, original_to_status,
          original_entry_at, original_exit_at, original_calendar_seconds, original_business_seconds,
          corrected_to_status, corrected_entry_at, corrected_exit_at,
          recalculated_calendar_seconds, recalculated_business_seconds, reason, corrected_by)
       VALUES (?, ?, 1, NULL, 'open', '2026-10-25 04:00:00', '2026-10-25 06:00:00', 7200, 7200,
               'open', '2026-10-25 04:00:00', '2026-10-25 07:00:00', 10800, 10800, 'Verified QA handoff delay', ?)`
    )
    .run(stageId, ticketId, admin.id);

  const orig = await db.prepare('SELECT calendar_seconds FROM ticket_stage_history WHERE id = ?').get(stageId);
  assert.equal(orig.calendar_seconds, 7200);
});

test('5. Backfill infers missing created rows, distinguishes pre-2026-10-24 vs 2026-10-24+, preserves anonymous Task Sheets, and avoids double counting', async () => {
  const dev = await db.prepare("SELECT id, name FROM users WHERE role = 'developer' LIMIT 1").get();
  const proj = await db.prepare('SELECT id, name FROM projects LIMIT 1').get();

  // Ticket created BEFORE 2026-10-24 without any 'created' row in ticket_activity
  const preTkt = await db
    .prepare("INSERT INTO tickets (title, description, status, created_by, project_id, created_at) VALUES (?, ?, 'in_progress', ?, ?, '2026-10-10 04:00:00')")
    .run('Pre-schedule Ticket', 'desc', dev.id, proj.id);

  // Transition straddling 2026-10-24 boundary (2026-10-10 -> 2026-10-26)
  await db
    .prepare("INSERT INTO ticket_activity (ticket_id, actor_id, field, from_value, to_value, created_at) VALUES (?, ?, 'status', 'open', 'in_progress', '2026-10-26 04:00:00')")
    .run(preTkt.lastInsertRowid, dev.id);

  // One authenticated Task Sheet + one duplicate 'Task Sheet:' ticket_time_log + one manual log + one anonymous Task Sheet
  await db
    .prepare("INSERT INTO task_sheet_submissions (submitted_by, name, project, hours_worked, task_title, task_description, task_state, linked_ticket_id, created_at) VALUES (?, ?, ?, 3.0, 'Auth Sheet', 'Worked on fix', 'completed', ?, '2026-10-25 11:00:00')")
    .run(dev.id, dev.name, proj.name, preTkt.lastInsertRowid);

  await db
    .prepare("INSERT INTO ticket_time_logs (ticket_id, user_id, seconds, note, created_at) VALUES (?, ?, 10800, 'Task Sheet: Auth Sheet — Worked on fix', '2026-10-25 11:00:00')")
    .run(preTkt.lastInsertRowid, dev.id);

  await db
    .prepare("INSERT INTO ticket_time_logs (ticket_id, user_id, seconds, duration_minutes, note, work_date, created_at) VALUES (?, ?, 3600, 60, 'Manual debug log', '2026-10-25', '2026-10-25 12:00:00')")
    .run(preTkt.lastInsertRowid, dev.id);

  await db
    .prepare("INSERT INTO task_sheet_submissions (submitted_by, name, project, hours_worked, task_title, task_description, task_state, created_at) VALUES (NULL, ?, ?, 2.5, 'Anon Legacy', 'Anonymous work', 'completed', '2026-10-15 11:00:00')")
    .run(dev.name, proj.name);

  // Run backfill script against isolated test SQLite DB
  const dryOut = execFileSync(process.execPath, ['scripts/backfill-360-monitoring.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, DB_DRIVER: 'sqlite', SQLITE_DB_PATH: TEST_DB_PATH },
    encoding: 'utf8',
  });
  assert.match(dryOut, /Dry-run complete/);

  execFileSync(process.execPath, ['scripts/backfill-360-monitoring.mjs', '--commit'], {
    cwd: process.cwd(),
    env: { ...process.env, DB_DRIVER: 'sqlite', SQLITE_DB_PATH: TEST_DB_PATH },
    encoding: 'utf8',
  });

  const stageRows = await db
    .prepare('SELECT transition_seq, to_status, duration_precision FROM ticket_stage_history WHERE ticket_id = ? ORDER BY transition_seq ASC')
    .all(preTkt.lastInsertRowid);
  assert.equal(stageRows.length, 2);
  assert.equal(stageRows[0].to_status, 'open');
  assert.equal(stageRows[0].duration_precision, 'mixed_estimated');
  assert.equal(stageRows[1].to_status, 'in_progress');
  assert.equal(stageRows[1].duration_precision, 'provisional_baseline');

  // Verify legacy anonymous submission remained unmapped (submitted_by NULL, employee_id NULL, not inserted into employee_work_logs)
  const anon = await db.prepare("SELECT employee_id, submission_auth_mode FROM task_sheet_submissions WHERE task_title = 'Anon Legacy'").get();
  assert.equal(anon.employee_id, null);
  assert.equal(anon.submission_auth_mode, 'legacy_anonymous');

  // Verify total backfilled effort = 180m (Auth Sheet) + 60m (Manual debug log) = 240m (Task Sheet: ticket_time_log excluded!)
  const emp = await db.prepare('SELECT id FROM employees WHERE user_id = ?').get(dev.id);
  const effortSum = await db
    .prepare('SELECT SUM(duration_minutes) AS total_mins FROM employee_work_logs WHERE employee_id = ?')
    .get(emp.id);
  assert.equal(Number(effortSum.total_mins), 240);
});

test('6. reconcileFallbackAttendance works cleanly without SQLite-only date() offset syntax', async () => {
  const dev = await db.prepare("SELECT id, user_id FROM employees WHERE role = 'developer' LIMIT 1").get();
  await db
    .prepare(
      `INSERT OR IGNORE INTO employee_attendance
         (employee_id, user_id, work_date, check_in_time, status)
       VALUES (?, ?, '2026-10-25', '2026-10-25 04:00:00', 'present')`
    )
    .run(dev.id, dev.user_id);

  const rec = await reconcileFallbackAttendance();
  assert.ok(rec.reconciledCount >= 1);
  const att = await db
    .prepare("SELECT checkout_source, is_estimated, check_out_time FROM employee_attendance WHERE employee_id = ? AND work_date = '2026-10-25'")
    .get(dev.id);
  assert.equal(att.checkout_source, 'task_sheet_submission');
  assert.equal(att.is_estimated, 1);
  assert.ok(att.check_out_time);
});

test('7. TestFixtureTracker + safe-clean-test-data.mjs removes 100% of run-owned rows while preserving baseline rows', async () => {
  const baselineTicketCount = Number((await db.prepare('SELECT COUNT(*) AS c FROM tickets').get()).c);
  const runId = generateTestRunId('p1');
  const tracker = new TestFixtureTracker(runId);

  const admin = await db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  const synTkt = await db
    .prepare("INSERT INTO tickets (title, description, status, created_by, test_run_id) VALUES ('Synthetic Clean Test', 'd', 'open', ?, ?)")
    .run(admin.id, runId);
  await tracker.track('tickets', synTkt.lastInsertRowid);

  const synAct = await db
    .prepare("INSERT INTO ticket_activity (ticket_id, actor_id, field, from_value, to_value) VALUES (?, ?, 'created', '', '')")
    .run(synTkt.lastInsertRowid, admin.id);
  await tracker.track('ticket_activity', synAct.lastInsertRowid);

  // Dry-run first
  const dry = execFileSync(process.execPath, ['scripts/safe-clean-test-data.mjs', `--run-id=${runId}`], {
    cwd: process.cwd(),
    env: { ...process.env, DB_DRIVER: 'sqlite', SQLITE_DB_PATH: TEST_DB_PATH },
    encoding: 'utf8',
  });
  assert.match(dry, /DRY-RUN PREVIEW/);

  // Confirm clean
  const cleanOut = execFileSync(process.execPath, ['scripts/safe-clean-test-data.mjs', `--run-id=${runId}`, '--confirm-clean'], {
    cwd: process.cwd(),
    env: { ...process.env, DB_DRIVER: 'sqlite', SQLITE_DB_PATH: TEST_DB_PATH },
    encoding: 'utf8',
  });
  assert.match(cleanOut, /Verification PASSED: 0 rows remain/);

  const afterTicketCount = Number((await db.prepare('SELECT COUNT(*) AS c FROM tickets').get()).c);
  assert.equal(afterTicketCount, baselineTicketCount);
});
