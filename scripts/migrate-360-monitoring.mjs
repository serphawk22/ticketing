import { db } from '../lib/db.js';
import { assertMigrationContextOnly } from '../lib/dbEnvironment.js';
import {
  MONITORING_360_POSTGRES_DDL,
  seedMonitoring360PostgresCatalogs,
} from '../lib/migrations/monitoring360Schema.js';

const VERIFIED_CORE_TABLES = [
  'users',
  'employees',
  'projects',
  'tickets',
  'ticket_activity',
  'ticket_time_logs',
  'task_sheet_submissions',
  'employee_attendance',
  'company_holidays',
  'payroll_records',
];

async function captureRowCounts() {
  const counts = {};
  for (const tbl of VERIFIED_CORE_TABLES) {
    const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${tbl}`).get();
    counts[tbl] = Number(row?.c || 0);
  }
  return counts;
}

async function runMigration() {
  const apply = process.argv.includes('--apply');
  if (!apply) {
    process.env.SERPHAWK_MIGRATION_DRY_RUN = '1';
  }
  const env = assertMigrationContextOnly('scripts/migrate-360-monitoring.mjs');

  console.log(`[migrate-360] Active Target: ${env.dialect} -> ${env.target}`);
  console.log(`[migrate-360] Mode: ${apply ? 'APPLY MIGRATION (--apply)' : 'DRY-RUN PREVIEW'}`);

  const preCounts = await captureRowCounts();
  console.log('[migrate-360] Pre-migration core row counts:', JSON.stringify(preCounts));

  if (!apply) {
    console.log('[migrate-360] Dry-run preview complete. Zero DDL executed. Pass --apply only after backup & approval.');
    return;
  }

  if (db.dialect() === 'postgres') {
    await db.exec(MONITORING_360_POSTGRES_DDL);
    await seedMonitoring360PostgresCatalogs((sql) => db.prepare(sql));
  } else {
    // SQLite schema & seed already executed via db init -> ensureMonitoring360SqliteSchema
    await db.prepare('SELECT 1 FROM workflow_stages LIMIT 1').get();
  }

  const postCounts = await captureRowCounts();
  console.log('[migrate-360] Post-migration core row counts:', JSON.stringify(postCounts));

  for (const tbl of VERIFIED_CORE_TABLES) {
    if (postCounts[tbl] !== preCounts[tbl]) {
      throw new Error(
        `[migrate-360] INTEGRITY MISMATCH on "${tbl}": before=${preCounts[tbl]}, after=${postCounts[tbl]}`
      );
    }
  }
  console.log('[migrate-360] Migration & row-count verification PASSED cleanly.');
}

runMigration().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
