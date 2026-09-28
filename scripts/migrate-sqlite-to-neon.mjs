#!/usr/bin/env node
/**
 * Copy the local SQLite database into a Postgres database.
 *
 *   node scripts/migrate-sqlite-to-neon.mjs
 *
 * Reads   data/app.db
 * Writes  the target named by DATABASE_URL
 *
 * The script is idempotent: rows are upserted by primary key, so re-running it
 * converges rather than duplicating. Pass --truncate to start from empty
 * tables instead (useful when rows were removed locally after the last run).
 *
 * Explicit ids are written verbatim because the local ids are not contiguous
 * and tickets reference them through foreign keys. Identity sequences are then
 * advanced past the highest id so later inserts do not collide.
 *
 * Sessions are skipped on purpose. They are short-lived, and carrying them
 * across would pin the current browser session to a cookie the server may not
 * set identically in production.
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(import.meta.dirname, '..');
const SQLITE_PATH = path.join(ROOT, 'data', 'app.db');
const SCHEMA_PATH = path.join(ROOT, 'db', 'schema.postgres.sql');

const TRUNCATE = process.argv.includes('--truncate');
const DRY_RUN = process.argv.includes('--dry-run');

// Insert order respects foreign keys. sessions is intentionally excluded.
const TABLES = [
  {
    name: 'users',
    columns: ['id', 'name', 'email', 'password', 'role', 'created_at'],
    pk: 'id',
  },
  {
    name: 'projects',
    columns: ['id', 'key', 'name', 'description', 'color', 'created_at'],
    pk: 'id',
  },
  {
    name: 'employees',
    columns: [
      'id', 'name', 'email', 'role', 'department', 'title',
      'active', 'created_at', 'updated_at',
    ],
    pk: 'id',
  },
  {
    name: 'tickets',
    columns: [
      'id', 'title', 'description', 'status', 'priority',
      'created_by', 'assigned_to', 'project_id', 'employee_id',
      'created_at', 'updated_at',
    ],
    pk: 'id',
  },
  {
    name: 'email_outbox',
    columns: [
      'id', 'to_email', 'to_name', 'subject', 'body_text', 'body_html',
      'trigger', 'ticket_id', 'status', 'error', 'created_at',
    ],
    pk: 'id',
  },
];

/** Render a SQLite value as a Postgres literal. */
function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  // standard_conforming_strings is on, so doubling quotes is sufficient. A
  // leading backslash would be an escape in some settings, so neutralise it.
  const escaped = String(value).replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${escaped}'`;
}

function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Point it at the target database.');
    process.exit(1);
  }

  let sqlite;
  try {
    sqlite = new Database(SQLITE_PATH, { readonly: true });
  } catch (err) {
    console.error(`Cannot read ${SQLITE_PATH}: ${err.message}`);
    process.exit(1);
  }

  const statements = [];
  const summary = [];

  statements.push(readFileSync(SCHEMA_PATH, 'utf8'));
  statements.push('BEGIN;');

  if (TRUNCATE) {
    const order = ['sessions', 'email_outbox', 'tickets', 'employees', 'projects', 'users'];
    statements.push(
      `TRUNCATE ${order.map((t) => `public.${t}`).join(', ')} RESTART IDENTITY CASCADE;`
    );
  }

  for (const table of TABLES) {
    const rows = sqlite.prepare(`SELECT ${table.columns.join(', ')} FROM ${table.name}`).all();
    summary.push([table.name, rows.length]);

    for (const row of rows) {
      const cols = table.columns.join(', ');
      const vals = table.columns.map((c) => literal(row[c])).join(', ');
      // Everything except the key is overwritten so a re-run matches SQLite.
      const updates = table.columns
        .filter((c) => c !== table.pk)
        .map((c) => `${c} = EXCLUDED.${c}`)
        .join(', ');
      statements.push(
        `INSERT INTO ${table.name} (${cols}) VALUES (${vals}) ` +
          `ON CONFLICT (${table.pk}) DO UPDATE SET ${updates};`
      );
    }

    if (rows.length) {
      const maxId = Math.max(...rows.map((r) => r[table.pk]));
      statements.push(
        `SELECT setval(pg_get_serial_sequence('${table.name}', 'id'), ${maxId});`
      );
    }
  }

  statements.push('COMMIT;');
  statements.push(
    TABLES.map((t) => `SELECT '${t.name}' AS table, count(*) FROM ${t.name};`).join('\n')
  );

  const sql = statements.join('\n');
  const totalRows = summary.reduce((n, [, count]) => n + count, 0);

  console.log('source :', SQLITE_PATH);
  console.log('target :', connectionString.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@'));
  for (const [name, count] of summary) {
    console.log(`  ${name.padEnd(14)} ${String(count).padStart(4)}`);
  }
  console.log(`  ${'total'.padEnd(14)} ${String(totalRows).padStart(4)}`);
  if (TRUNCATE) console.log('mode   : truncate + reload');

  if (DRY_RUN) {
    writeFileSync(path.join(ROOT, 'migration.sql'), sql);
    console.log('dry run: wrote migration.sql, nothing was sent');
    return;
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'migrate-'));
  const file = path.join(dir, 'migration.sql');
  writeFileSync(file, sql);

  try {
    // timezone=UTC keeps SQLite's naive UTC strings on the same instant.
    const out = execFileSync(
      'psql',
      [connectionString, '-v', 'ON_ERROR_STOP=1', '-f', file],
      {
        encoding: 'utf8',
        env: { ...process.env, PGOPTIONS: '-c timezone=UTC' },
        stdio: ['ignore', 'pipe', 'inherit'],
      }
    );
    console.log('--- result ---');
    process.stdout.write(out.split('\n').slice(-12).join('\n').trim() + '\n');
  } finally {
    execFileSync('rm', ['-rf', dir]);
  }
}

main();
