import { db } from '../lib/db.js';
import { assertIsolatedTestDatabase } from '../lib/dbEnvironment.js';

function parseArgs(argv) {
  let runId = '';
  let confirmClean = false;
  for (const arg of argv) {
    if (arg.startsWith('--run-id=')) {
      runId = arg.slice('--run-id='.length).trim();
    } else if (arg === '--confirm-clean') {
      confirmClean = true;
    }
  }
  return { runId, confirmClean };
}

/**
 * Reverse foreign-key dependency order covering every core & dependent table.
 * Deletion only targets exact `test_run_id` ownership or exact `(table_name, record_id)`
 * registered in `test_fixture_registry`. Never deletes by names, dates, or exclusions.
 */
const REGISTRY_DEPENDENCY_ORDER = [
  'notifications',
  'email_outbox',
  'audit_logs',
  'attendance_audit_logs',
  'ticket_votes',
  'ticket_watchers',
  'ticket_web_links',
  'ticket_relations',
  'ticket_attachments',
  'ticket_comments',
  'ticket_activity',
  'ticket_time_logs',
  'task_sheet_sessions',
  'employee_work_logs',
  'task_sheet_amendments',
  'task_sheet_submissions',
  'employee_task_sheet_tokens',
  'ticket_stage_corrections',
  'ticket_stage_history',
  'employee_leave_requests',
  'employee_attendance',
  'project_members',
  'tickets',
  'projects',
  'business_schedule_history',
  'company_holidays',
  'employees',
  'users',
];

const DIRECT_TEST_RUN_ID_TABLES = [
  'task_sheet_sessions',
  'employee_work_logs',
  'task_sheet_amendments',
  'ticket_time_logs',
  'task_sheet_submissions',
  'employee_task_sheet_tokens',
  'ticket_stage_corrections',
  'ticket_stage_history',
  'employee_attendance',
  'project_members',
  'tickets',
  'projects',
  'business_schedule_history',
  'company_holidays',
  'employees',
  'users',
];

async function tableExists(txOrDb, tableName) {
  if (db.dialect() === 'postgres') {
    const res = await txOrDb.prepare('SELECT to_regclass(?) AS reg').get(`public.${tableName}`);
    return Boolean(res?.reg);
  }
  const res = await txOrDb
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(res);
}

async function runSafeCleanup() {
  const { runId, confirmClean } = parseArgs(process.argv.slice(2));
  const env = assertIsolatedTestDatabase('scripts/safe-clean-test-data.mjs');

  if (!runId) {
    throw new Error(
      'Missing required argument: --run-id=<test_run_id>. Unscoped cleanup is permanently forbidden.'
    );
  }

  console.log(`[safe-clean] Environment verified: ${env.dialect} -> ${env.target}`);
  console.log(`[safe-clean] Target test_run_id: "${runId}" | Mode: ${confirmClean ? 'EXECUTE (--confirm-clean)' : 'DRY-RUN PREVIEW'}`);

  const registryRows = (await tableExists(db, 'test_fixture_registry'))
    ? await db
        .prepare('SELECT table_name, record_id FROM test_fixture_registry WHERE test_run_id = ?')
        .all(runId)
    : [];

  const registryByTable = new Map();
  for (const row of registryRows) {
    if (!registryByTable.has(row.table_name)) registryByTable.set(row.table_name, []);
    registryByTable.get(row.table_name).push(row.record_id);
  }

  const directCounts = {};
  for (const tbl of DIRECT_TEST_RUN_ID_TABLES) {
    if (!(await tableExists(db, tbl))) continue;
    const row = await db
      .prepare(`SELECT COUNT(*) AS c FROM ${tbl} WHERE test_run_id = ?`)
      .get(runId);
    const count = Number(row?.c || 0);
    if (count > 0) directCounts[tbl] = count;
  }

  console.log('[safe-clean] Registered fixture rows:', Object.fromEntries([...registryByTable.entries()].map(([k, v]) => [k, v.length])));
  console.log('[safe-clean] Direct test_run_id tagged rows:', directCounts);

  if (!confirmClean) {
    console.log('[safe-clean] Dry-run complete. Re-run with --confirm-clean on this isolated test DB to delete only these rows.');
    return;
  }

  const deletedLog = [];
  await db.transaction(async (tx) => {
    // 1. Delete tracked dependent child rows by exact registered record IDs in reverse FK order
    for (const tbl of REGISTRY_DEPENDENCY_ORDER) {
      if (!(await tableExists(tx, tbl))) continue;
      const ids = registryByTable.get(tbl) || [];
      for (const recId of ids) {
        const pkCol = tbl === 'sessions' ? 'token' : 'id';
        const parsedId = /^\d+$/.test(String(recId)) ? Number(recId) : recId;
        const info = await tx.prepare(`DELETE FROM ${tbl} WHERE ${pkCol} = ?`).run(parsedId);
        if (info.rowCount > 0) {
          deletedLog.push({ table: tbl, source: 'registry', id: recId, deleted: info.rowCount });
        }
      }
    }

    // 2. Delete direct test_run_id tagged rows in dependency-safe child-before-parent order
    for (const tbl of DIRECT_TEST_RUN_ID_TABLES) {
      if (!(await tableExists(tx, tbl))) continue;
      const info = await tx.prepare(`DELETE FROM ${tbl} WHERE test_run_id = ?`).run(runId);
      if (info.rowCount > 0) {
        deletedLog.push({ table: tbl, source: 'test_run_id', deleted: info.rowCount });
      }
    }

    // 3. Remove registry ownership rows for this test_run_id
    if (await tableExists(tx, 'test_fixture_registry')) {
      const regDel = await tx
        .prepare('DELETE FROM test_fixture_registry WHERE test_run_id = ?')
        .run(runId);
      deletedLog.push({ table: 'test_fixture_registry', source: 'test_run_id', deleted: regDel.rowCount });
    }
  });

  // Post-cleanup verification
  let remainingCount = 0;
  for (const tbl of DIRECT_TEST_RUN_ID_TABLES) {
    if (!(await tableExists(db, tbl))) continue;
    const rem = await db.prepare(`SELECT COUNT(*) AS c FROM ${tbl} WHERE test_run_id = ?`).get(runId);
    remainingCount += Number(rem?.c || 0);
  }
  if (await tableExists(db, 'test_fixture_registry')) {
    const regRem = await db
      .prepare('SELECT COUNT(*) AS c FROM test_fixture_registry WHERE test_run_id = ?')
      .get(runId);
    remainingCount += Number(regRem?.c || 0);
  }

  if (remainingCount > 0) {
    throw new Error(`[safe-clean] Verification FAILED: ${remainingCount} test rows still remain for run "${runId}".`);
  }

  if (db.dialect() === 'sqlite') {
    const fkErrors = await db.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length > 0) {
      throw new Error(`[safe-clean] Foreign key integrity violation after cleanup: ${JSON.stringify(fkErrors)}`);
    }
  }

  console.log('[safe-clean] Cleanup summary:', JSON.stringify(deletedLog));
  console.log(`[safe-clean] Verification PASSED: 0 rows remain for test_run_id="${runId}".`);
}

runSafeCleanup().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
