import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { PG_SCHEMA } from './schema.postgres.js';

/**
 * Database access layer.
 *
 * Two drivers sit behind one small interface:
 *
 *   - Local / self-hosted: better-sqlite3 against data/app.db. No credentials
 *     needed, and it is the only driver that works inside the Next dev server.
 *   - Serverless (Vercel): a remote Postgres database (Neon), selected by
 *     DATABASE_URL. Serverless filesystems are ephemeral, so a local file
 *     cannot be used in production.
 *
 * Both are exposed as `db.prepare(sql).run/get/all`. Those methods always
 * return promises so callers are identical in both environments, and the
 * client is created lazily so `next build` never needs credentials.
 *
 * `run` resolves to `{ rowCount, lastInsertRowid, rows }` in both dialects.
 *
 * Driver selection, in order:
 *   1. DB_DRIVER=sqlite or DB_DRIVER=postgres forces a driver.
 *   2. Otherwise DATABASE_URL means Postgres, and no DATABASE_URL means the
 *      local file.
 *
 * The rest of the codebase contains no dialect conditionals. Where SQLite and
 * Postgres genuinely differ, the Postgres driver rewrites the statement in
 * `toPostgres` below, which keeps a single copy of every query.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'developer')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#0c66e4',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('admin', 'developer')),
    department TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email TEXT NOT NULL,
    to_name TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT NOT NULL DEFAULT '',
    trigger TEXT NOT NULL DEFAULT 'assignment',
    ticket_id INTEGER REFERENCES tickets(id),
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'logged', 'failed')),
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    type TEXT NOT NULL DEFAULT 'task' CHECK (type IN ('task', 'bug', 'story', 'epic')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    assigned_to INTEGER REFERENCES users(id),
    project_id INTEGER REFERENCES projects(id),
    employee_id INTEGER REFERENCES employees(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

/**
 * Rewrite a SQLite statement into its Postgres equivalent.
 *
 * Exported for tests. Four transformations, all mechanical:
 *
 *   ?                 -> $1, $2, ...   (skipping ? inside string literals)
 *   datetime('now')   -> now()
 *   COLLATE NOCASE    -> LOWER(expr)   (case-insensitive sort)
 *   INSERT OR IGNORE  -> INSERT ... ON CONFLICT DO NOTHING
 *
 * Inserts also get `RETURNING *` appended so `run` can surface the new id as
 * `lastInsertRowid`, which is how the SQLite drivers report it. `RETURNING *`
 * rather than `RETURNING id` because not every table has an `id` column:
 * `sessions` is keyed by `token`, and naming a missing column is a hard error.
 */
export function toPostgres(sql) {
  const hadOrIgnore = /\bINSERT\s+OR\s+IGNORE\b/i.test(sql);
  const isInsert = /^\s*INSERT\b/i.test(sql);

  // Rewrite positional placeholders first, walking the string so a `?` inside a
  // quoted literal is left alone. Doubled quotes ('') stay balanced.
  let out = '';
  let index = 0;
  let next = 0;
  let inString = false;

  while (index < sql.length) {
    const char = sql[index];

    if (inString) {
      if (char === "'" && sql[index + 1] === "'") {
        out += "''";
        index += 2;
        continue;
      }
      if (char === "'") inString = false;
      out += char;
      index += 1;
      continue;
    }

    if (char === "'") inString = true;
    if (char === '?') {
      next += 1;
      out += `$${next}`;
    } else {
      out += char;
    }
    index += 1;
  }

  let text = out
    .replace(/\bdatetime\(\s*'now'\s*\)/gi, 'now()')
    .replace(/\bdate\(\s*'now'\s*\)/gi, 'now()::date')
    .replace(
      /\b((?:[A-Za-z_]\w*\.)?[A-Za-z_]\w*)\s+COLLATE\s+NOCASE\b/gi,
      'LOWER($1)'
    )
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');

  let statement = text.trim().replace(/;+\s*$/, '');

  if (isInsert && !/\bRETURNING\b/i.test(statement)) {
    // Only INSERT OR IGNORE should swallow a conflict; a plain INSERT must still
    // fail loudly on a duplicate key.
    if (hadOrIgnore) statement += ' ON CONFLICT DO NOTHING';
    statement += ' RETURNING *';
  }

  return statement;
}

let driver;
let ready;

function createLocalDriver() {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // Required lazily: bundlers must not try to inline the native binding.
  const Database = require('better-sqlite3');
  const conn = new Database(path.join(dataDir, 'app.db'));
  conn.pragma('journal_mode = WAL');
  conn.pragma('busy_timeout = 5000');

  return {
    dialect: 'sqlite',
    exec: async (sql) => conn.exec(sql),
    prepare(sql) {
      const stmt = conn.prepare(sql);
      return {
        run: async (args = []) => {
          const info = stmt.run(...args);
          return {
            rowCount: info.changes,
            lastInsertRowid: info.lastInsertRowid,
            rows: [],
          };
        },
        get: async (args = []) => stmt.get(...args),
        all: async (args = []) => stmt.all(...args),
      };
    },
  };
}

/**
 * Postgres timestamps arrive as text such as '2026-09-24 11:33:24.123+00'.
 * The rest of the app expects exactly what SQLite produced, a naive UTC string
 * of the form 'YYYY-MM-DD HH:MM:SS' -- lib/ticketMeta.js parses that shape by
 * appending 'Z' itself. Returning a JS Date here would render every timestamp
 * in the UI blank, so reformat instead of letting node-postgres build a Date.
 */
const TIMESTAMP_TEXT =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-])(\d{2})(?::?(\d{2}))?$/;

function toSqliteTimestamp(value) {
  const match = TIMESTAMP_TEXT.exec(value);
  if (!match) return value;

  const [, date, time, sign, hours, minutes = '00'] = match;
  const instant = new Date(`${date}T${time}${sign}${hours}:${minutes}`);
  if (Number.isNaN(instant.getTime())) return `${date} ${time}`;

  return instant.toISOString().slice(0, 19).replace('T', ' ');
}

function createPostgresDriver() {
  // Required lazily so `next build` never needs pg resolved.
  const { Pool, types } = require('pg');

  // COUNT(*) and sessions.expires_at are int8/bigint, which node-postgres
  // returns as strings to avoid precision loss. The application compares those
  // with === and against Date.now(), so hand them back as numbers. Ticket ids
  // and epoch milliseconds are many orders of magnitude below 2^53, so nothing
  // is lost here.
  types.setTypeParser(types.builtins.INT8, (value) => Number(value));
  types.setTypeParser(types.builtins.TIMESTAMPTZ, toSqliteTimestamp);
  types.setTypeParser(types.builtins.TIMESTAMP, toSqliteTimestamp);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Ask the server for UTC so timestamptz text output needs no shifting.
    options: '-c timezone=UTC',
    // Serverless invocations are short and bursty. A small pool avoids opening
    // far more backends than Neon needs to keep warm.
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
  });

  // Required on Vercel Fluid: keeps the pool alive between invocations instead
  // of reconnecting on every request.
  if (process.env.VERCEL) {
    const { attachDatabasePool } = require('@vercel/functions');
    attachDatabasePool(pool);
  }

  return {
    dialect: 'postgres',
    // Multi-statement DDL uses the simple query protocol, which node-postgres
    // only allows when no values are bound.
    exec: async (sql) => {
      await pool.query(sql);
    },
    prepare(sql) {
      const statement = toPostgres(sql);
      const run = (args = []) => pool.query(statement, args);

      return {
        run: async (args = []) => {
          const result = await run(args);
          return {
            rowCount: result.rowCount ?? result.rows.length,
            lastInsertRowid: result.rows[0]?.id ?? null,
            rows: result.rows,
          };
        },
        get: async (args = []) => (await run(args)).rows[0],
        all: async (args = []) => (await run(args)).rows,
      };
    },
  };
}

function selectDriver() {
  const forced = process.env.DB_DRIVER;
  if (forced === 'sqlite' || forced === 'postgres') return forced;
  return process.env.DATABASE_URL ? 'postgres' : 'sqlite';
}

function getDriver() {
  if (driver) return driver;

  const name = selectDriver();

  // A local file on Vercel would silently lose every ticket on redeploy, so
  // refuse rather than pretend. An explicit DB_DRIVER=sqlite is honoured, but
  // that is a deliberate choice rather than an accident.
  if (name === 'sqlite' && process.env.VERCEL && !process.env.DB_DRIVER) {
    throw new Error(
      'DATABASE_URL is not set. Vercel has no persistent filesystem, so a local ' +
        'SQLite file would silently lose every ticket on redeploy. Set ' +
        'DATABASE_URL in the project environment variables to point at the ' +
        'Neon Postgres database.'
    );
  }

  driver = name === 'postgres' ? createPostgresDriver() : createLocalDriver();
  return driver;
}

export function isRemoteDatabase() {
  return selectDriver() === 'postgres';
}

/**
 * Statements that bypass the initialisation gate. Only used while `init()` is
 * running: calling the gated `db` helpers from here would deadlock, because
 * `ensureReady()` would wait on the very promise that is running init.
 */
function rawPrepare(sql) {
  return getDriver().prepare(sql);
}

async function seedProjects() {
  const insert = rawPrepare(
    'INSERT OR IGNORE INTO projects (key, name, description, color) VALUES (?, ?, ?, ?)'
  );

  await insert.run([
    'WEB',
    'Web Platform',
    'Customer-facing web app, marketing site and design system.',
    '#0c66e4',
  ]);
  await insert.run([
    'MOB',
    'Mobile App',
    'iOS and Android client for the ticketing workflow.',
    '#36b37e',
  ]);
}

async function seed() {
  await rawPrepare(
    'INSERT OR IGNORE INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
  ).run([
    'Admin User',
    'admin@example.com',
    bcrypt.hashSync('admin123', bcrypt.genSaltSync(10)),
    'admin',
  ]);
  await rawPrepare(
    'INSERT OR IGNORE INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
  ).run([
    'Dev User',
    'dev@example.com',
    bcrypt.hashSync('dev123', bcrypt.genSaltSync(10)),
    'developer',
  ]);

  const row = await rawPrepare('SELECT COUNT(*) AS c FROM tickets').get([]);
  if (Number(row.c) === 0) {
    const admin = await rawPrepare("SELECT id FROM users WHERE role = 'admin'").get([]);
    const dev = await rawPrepare("SELECT id FROM users WHERE role = 'developer'").get([]);
    const rows = await rawPrepare('SELECT key, id FROM projects').all([]);
    const projectIds = rows.reduce((acc, p) => ({ ...acc, [p.key]: p.id }), {});

    const insertTicket = rawPrepare(
      `INSERT INTO tickets (title, description, status, priority, created_by, assigned_to, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    await insertTicket.run([
      'Fix login page loading bug',
      'The login page spins indefinitely when pressing submit on Firefox.',
      'open',
      'high',
      admin.id,
      dev.id,
      projectIds.WEB,
    ]);
    await insertTicket.run([
      'Offline mode loses draft tickets',
      'Drafts created without a connection are dropped instead of queued for sync.',
      'in_progress',
      'urgent',
      dev.id,
      dev.id,
      projectIds.MOB,
    ]);
    await insertTicket.run([
      'Speed up preview builds',
      'Preview environment builds take 14 minutes. Parallelise the test stage.',
      'open',
      'medium',
      admin.id,
      null,
      projectIds.MOB,
    ]);
    await insertTicket.run([
      'Board columns lose scroll position',
      'Returning to the board after opening a ticket resets each column to the top.',
      'resolved',
      'low',
      dev.id,
      dev.id,
      projectIds.WEB,
    ]);
  }
}

async function mirrorUsersAsEmployees() {
  // Written with NOT EXISTS rather than INSERT OR IGNORE so the same statement
  // is valid in both dialects without relying on how Postgres parses a trailing
  // ON CONFLICT after an INSERT ... SELECT.
  await rawPrepare(
    `INSERT INTO employees (name, email, role, department, title)
     SELECT u.name, u.email, u.role, '', ''
     FROM users u
     WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.email = u.email)`
  ).run([]);
}

async function backfill() {
  // A local database created by an older version may predate these columns.
  // Postgres applies the current schema up front, so it never needs this.
  if (getDriver().dialect === 'sqlite') {
    const cols = await rawPrepare('PRAGMA table_info(tickets)').all([]);
    const names = cols.map((c) => c.name);
    if (names.length && !names.includes('project_id')) {
      await getDriver().exec(
        'ALTER TABLE tickets ADD COLUMN project_id INTEGER REFERENCES projects(id)'
      );
    }
    if (names.length && !names.includes('employee_id')) {
      await getDriver().exec(
        'ALTER TABLE tickets ADD COLUMN employee_id INTEGER REFERENCES employees(id)'
      );
    }
    if (names.length && !names.includes('type')) {
      // SQLite cannot add a CHECK constraint through ALTER TABLE, so the
      // constraint only exists on freshly created tables. This branch only ever
      // runs for databases created before the column was introduced, where every
      // value is the default anyway.
      await getDriver().exec(
        "ALTER TABLE tickets ADD COLUMN type TEXT NOT NULL DEFAULT 'task'"
      );
    }
  }

  const orphanProjects = await rawPrepare(
    'SELECT COUNT(*) AS c FROM tickets WHERE project_id IS NULL'
  ).get([]);
  if (Number(orphanProjects.c) > 0) {
    const project = await rawPrepare("SELECT id FROM projects WHERE key = 'WEB'").get([]);
    if (project) {
      await rawPrepare(
        'UPDATE tickets SET project_id = ? WHERE project_id IS NULL'
      ).run([project.id]);
    }
  }

  const orphanAssignees = await rawPrepare(
    'SELECT COUNT(*) AS c FROM tickets WHERE employee_id IS NULL AND assigned_to IS NOT NULL'
  ).get([]);
  if (Number(orphanAssignees.c) > 0) {
    await rawPrepare(
      `UPDATE tickets
       SET employee_id = (
         SELECT e.id FROM employees e
         JOIN users u ON u.email = e.email
         WHERE u.id = tickets.assigned_to
       )
       WHERE employee_id IS NULL AND assigned_to IS NOT NULL`
    ).run([]);
  }
}

async function init() {
  const active = getDriver();
  await active.exec(active.dialect === 'postgres' ? PG_SCHEMA : SCHEMA);
  await seedProjects();
  await seed();
  await mirrorUsersAsEmployees();
  await backfill();
}

function ensureReady() {
  if (!ready) {
    ready = init().catch((err) => {
      // Let the next request retry instead of caching a rejected promise.
      ready = undefined;
      throw err;
    });
  }
  return ready;
}

export const db = {
  prepare(sql) {
    return {
      async run(...args) {
        await ensureReady();
        return rawPrepare(sql).run(args);
      },
      async get(...args) {
        await ensureReady();
        return rawPrepare(sql).get(args);
      },
      async all(...args) {
        await ensureReady();
        return rawPrepare(sql).all(args);
      },
    };
  },

  async exec(sql) {
    await ensureReady();
    return getDriver().exec(sql);
  },
};
