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

const DETAIL_COLUMNS = [
  { name: 'labels', ddl: "TEXT NOT NULL DEFAULT ''" },
  { name: 'due_date', ddl: 'TEXT' },
  { name: 'start_date', ddl: 'TEXT' },
  { name: 'category', ddl: "TEXT NOT NULL DEFAULT ''" },
  { name: 'team', ddl: "TEXT NOT NULL DEFAULT ''" },
  { name: 'budget', ddl: 'REAL NOT NULL DEFAULT 0' },
  { name: 'estimate_seconds', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'parent_id', ddl: 'INTEGER REFERENCES tickets(id)' },
  // Archiving is a flag rather than a delete, so the row survives and can be
  // restored. Stored as 0/1 because SQLite has no boolean and Postgres gets the
  // same integer rather than a second dialect to reason about.
  { name: 'archived', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'archived_at', ddl: 'TEXT' },
  { name: 'slack_channel', ddl: "TEXT NOT NULL DEFAULT ''" },
];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'developer', 'client')),
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#0c66e4',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#0c66e4',
    workspace_id INTEGER REFERENCES workspaces(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('admin', 'developer', 'client')),
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
    labels TEXT NOT NULL DEFAULT '',
    due_date TEXT,
    start_date TEXT,
    category TEXT NOT NULL DEFAULT '',
    team TEXT NOT NULL DEFAULT '',
    budget REAL NOT NULL DEFAULT 0,
    estimate_seconds INTEGER NOT NULL DEFAULT 0,
    parent_id INTEGER REFERENCES tickets(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    actor_id INTEGER REFERENCES users(id),
    field TEXT NOT NULL,
    from_value TEXT NOT NULL DEFAULT '',
    to_value TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    filename TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    uploaded_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    related_ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    relation_type TEXT NOT NULL DEFAULT 'relates_to'
      CHECK (relation_type IN ('parent_of', 'child_of', 'blocks', 'blocked_by',
                               'relates_to', 'duplicates', 'duplicated_by',
                               'clones', 'cloned_by')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_watchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_time_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    seconds INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_web_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    url TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A daily timesheet line. This replaces the external Microsoft Forms link, so
  -- the answers stay free-form: the name and project are what the person picked
  -- on the day, not a join against users or projects, because the form is
  -- answered on behalf of the person filling it in and the projects are
  -- client/internal names rather than board projects.
  CREATE TABLE IF NOT EXISTS task_sheet_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The sheet is shared as a link that works without signing in, so someone
    -- on the other end of it has no session row. submitted_by records who
    -- filed it when the app knows, and stays NULL for the anonymous share; the
    -- name/project answers are the record that matters either way.
    submitted_by INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    project TEXT NOT NULL,
    hours_worked REAL NOT NULL,
    task_title TEXT NOT NULL,
    task_description TEXT NOT NULL,
    task_state TEXT NOT NULL CHECK (task_state IN ('completed', 'not_completed')),
    linked_ticket_id INTEGER REFERENCES tickets(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A day's positive note, answered on the same page as the task sheet. Two
  -- free-text questions (what made your day happy; did you make anybody else
  -- happy) with no right answers, filed independently so a person can answer
  -- one sheet without being dragged through the other. Same submitted_by rule
  -- as the task sheet: NULL for the anonymous share of the link.
  CREATE TABLE IF NOT EXISTS happy_sheet_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submitted_by INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    happy_one TEXT NOT NULL,
    happy_others TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS activity_ticket_idx  ON ticket_activity(ticket_id);
  CREATE INDEX IF NOT EXISTS comments_ticket_idx  ON ticket_comments(ticket_id);
  CREATE INDEX IF NOT EXISTS attachments_ticket_idx ON ticket_attachments(ticket_id);
  CREATE INDEX IF NOT EXISTS relations_ticket_idx ON ticket_relations(ticket_id);
  CREATE INDEX IF NOT EXISTS watchers_ticket_idx ON ticket_watchers(ticket_id);
  CREATE INDEX IF NOT EXISTS timelogs_ticket_idx ON ticket_time_logs(ticket_id);
  CREATE INDEX IF NOT EXISTS votes_ticket_idx ON ticket_votes(ticket_id);
  CREATE INDEX IF NOT EXISTS weblinks_ticket_idx ON ticket_web_links(ticket_id);
  CREATE INDEX IF NOT EXISTS task_sheet_created_idx ON task_sheet_submissions(created_at);
  CREATE INDEX IF NOT EXISTS task_sheet_name_idx    ON task_sheet_submissions(name);
  CREATE INDEX IF NOT EXISTS happy_sheet_created_idx ON happy_sheet_submissions(created_at);
  CREATE INDEX IF NOT EXISTS happy_sheet_name_idx    ON happy_sheet_submissions(name);
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

// A fresh install is one with no users yet. The seed runs on every init(), which
// is correct for creating the first admin but must never repopulate data the
// user has since deleted, so every seed path checks this rather than looking at
// the table it is about to write to.
async function isFreshInstall() {
  const users = await rawPrepare('SELECT COUNT(*) AS c FROM users').get([]);
  return Number(users.c) === 0;
}

async function seedProjects() {
  // Only seed on a fresh install. Keyed off the users table rather than the
  // projects table: once any user exists the project list belongs to the app's
  // users, so seeding again would resurrect a project they deliberately deleted
  // (a deleted row no longer conflicts with INSERT OR IGNORE's unique key).
  if (!(await isFreshInstall())) return;

  const insert = rawPrepare(
    'INSERT INTO workspaces (key, name, description, color) VALUES (?, ?, ?, ?)'
  );

  const workspace = await insert.run([
    'GEN',
    'General',
    'Default work space for uncategorised projects.',
    '#0c66e4',
  ]);

  const insertProject = rawPrepare(
    'INSERT INTO projects (key, name, description, color, workspace_id) VALUES (?, ?, ?, ?, ?)'
  );

  await insertProject.run([
    'WEB',
    'Web Platform',
    'Customer-facing web app, marketing site and design system.',
    '#0c66e4',
    workspace.lastInsertRowid,
  ]);
  await insertProject.run([
    'MOB',
    'Mobile App',
    'iOS and Android client for the ticketing workflow.',
    '#36b37e',
    workspace.lastInsertRowid,
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

  // Same reasoning as seedProjects: demo tickets belong to a fresh install, and
  // an empty tickets table on an established database means the user deleted
  // them, not that they should come back.
  if (await isFreshInstall()) {
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

// SQLite cannot alter a CHECK constraint, so widening relation_type means
// rebuilding the table. A database created before the parenting or clone types
// existed would otherwise reject those links. The guard tests for the newest
// type, 'clones', so a database that already has the parenting types but not
// these still gets rebuilt.
async function rebuildRelations() {
  const active = getDriver();
  if (active.dialect !== 'sqlite') return;

  const rows = await active.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ticket_relations'").all([]);
  const ddl = rows[0]?.sql || '';
  if (!ddl || ddl.includes("'clones'")) return;

  await active.exec('PRAGMA foreign_keys = OFF');
  await active.exec('BEGIN');
  try {
    await active.exec(`
      CREATE TABLE ticket_relations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL REFERENCES tickets(id),
        related_ticket_id INTEGER NOT NULL REFERENCES tickets(id),
        relation_type TEXT NOT NULL DEFAULT 'relates_to'
          CHECK (relation_type IN ('parent_of', 'child_of', 'blocks', 'blocked_by',
                                   'relates_to', 'duplicates', 'duplicated_by',
                                   'clones', 'cloned_by')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO ticket_relations_new
        (id, ticket_id, related_ticket_id, relation_type, created_at)
        SELECT id, ticket_id, related_ticket_id, relation_type, created_at
        FROM ticket_relations;
      DROP TABLE ticket_relations;
      ALTER TABLE ticket_relations_new RENAME TO ticket_relations;
      CREATE INDEX IF NOT EXISTS relations_ticket_idx ON ticket_relations(ticket_id);
    `);
    await active.exec('COMMIT');
  } catch (err) {
    await active.exec('ROLLBACK');
    throw err;
  } finally {
    await active.exec('PRAGMA foreign_keys = ON');
  }
}

// Parenting used to be stored as a parent_of row in ticket_relations. Move any
// that exist onto tickets.parent_id and delete the rows, so a ticket's place in
// the hierarchy lives in exactly one place. Runs after rebuildRelations so the
// column is guaranteed to exist.
async function foldLegacyParenting() {
  const active = getDriver();
  if (active.dialect !== 'sqlite') return;

  const cols = await active.prepare('PRAGMA table_info(tickets)').all([]);
  if (!cols.map((c) => c.name).includes('parent_id')) return;

  await active.exec(`
    UPDATE tickets
       SET parent_id = (
         SELECT r.ticket_id FROM ticket_relations r
         WHERE r.relation_type = 'parent_of' AND r.related_ticket_id = tickets.id
         ORDER BY r.id LIMIT 1
       )
     WHERE parent_id IS NULL
       AND EXISTS (
         SELECT 1 FROM ticket_relations r
         WHERE r.relation_type = 'parent_of' AND r.related_ticket_id = tickets.id
       );

    UPDATE tickets
       SET parent_id = (
         SELECT r.related_ticket_id FROM ticket_relations r
         WHERE r.relation_type = 'child_of' AND r.ticket_id = tickets.id
         ORDER BY r.id LIMIT 1
       )
     WHERE parent_id IS NULL
       AND EXISTS (
         SELECT 1 FROM ticket_relations r
         WHERE r.relation_type = 'child_of' AND r.ticket_id = tickets.id
       );

    DELETE FROM ticket_relations WHERE relation_type IN ('parent_of', 'child_of');
  `);
}

// 'client' was added to the role lists once external requesters started
// signing in. SQLite cannot widen a CHECK constraint with ALTER TABLE, so both
// tables are rebuilt the same way rebuildRelations does it: create the new
// shape, copy the rows across, swap the name. Foreign keys are off for the swap
// so dropping the old table cannot cascade, and the REFERENCES clauses in
// sessions/tickets still name "users", which the rename puts back in place.
async function widenRoleChecks() {
  const active = getDriver();
  if (active.dialect !== 'sqlite') return;

  const shapes = {
    users: `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'developer', 'client')),
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    employees: `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('admin', 'developer', 'client')),
      department TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  };

  for (const [table, shape] of Object.entries(shapes)) {
    const row = await active
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .all([table]);
    const ddl = row[0]?.sql || '';
    if (!ddl || ddl.includes("'client'")) continue;

    const columns = await active.prepare(`PRAGMA table_info(${table})`).all([]);
    const names = columns.map((c) => c.name).join(', ');

    await active.exec('PRAGMA foreign_keys = OFF');
    await active.exec('BEGIN');
    try {
      await active.exec(`CREATE TABLE ${table}_new ${shape}`);
      await active.exec(`INSERT INTO ${table}_new (${names}) SELECT ${names} FROM ${table}`);
      await active.exec(`DROP TABLE ${table}`);
      await active.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
      await active.exec('COMMIT');
    } catch (err) {
      await active.exec('ROLLBACK');
      throw err;
    } finally {
      await active.exec('PRAGMA foreign_keys = ON');
    }
  }
}

async function backfill() {
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
    for (const col of DETAIL_COLUMNS) {
      if (names.length && !names.includes(col.name)) {
        await getDriver().exec(
          `ALTER TABLE tickets ADD COLUMN ${col.name} ${col.ddl}`
        );
      }
    }
    // Created here rather than in SCHEMA: on a database that predates the
    // column, SCHEMA has already run by this point and the index would fail
    // with 'no such column: parent_id'.
    await getDriver().exec(
      'CREATE INDEX IF NOT EXISTS tickets_parent_idx ON tickets(parent_id)'
    );
    // Same reason. Every list view filters on archived, so the index earns its
    // keep as soon as there is more than one project of tickets.
    await getDriver().exec(
      'CREATE INDEX IF NOT EXISTS tickets_archived_idx ON tickets(archived)'
    );
    await rebuildRelations();
    await foldLegacyParenting();
    await widenRoleChecks();

    // Workspaces were added after projects already existed, so a database
    // created earlier keeps its old projects table. ALTER TABLE is the only way
    // to add the column in SQLite; guarded so re-runs are a no-op.
    const projectCols = await rawPrepare('PRAGMA table_info(projects)').all([]);
    const projectNames = projectCols.map((c) => c.name);
    if (projectNames.length && !projectNames.includes('workspace_id')) {
      await getDriver().exec(
        'ALTER TABLE projects ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id)'
      );
    }
    // An admin-created account starts life with a temporary password, so the flag
    // that forces a reset at first login has to be added to databases that
    // predate it. Stored as 0/1 like every other flag in this schema.
    const userCols = await rawPrepare('PRAGMA table_info(users)').all([]);
    const userNames = userCols.map((c) => c.name);
    if (userNames.length && !userNames.includes('must_change_password')) {
      await getDriver().exec(
        'ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0'
      );
    }

    // Created here rather than in SCHEMA, for the same reason as the tickets
    // indexes above: on a database that predates the column, SCHEMA has already
    // run and the index would fail with 'no such column: workspace_id'.
    await getDriver().exec(
      'CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects(workspace_id)'
    );
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

// better-sqlite3 accepts bindings either as a single array or as loose
// arguments, and call sites use both. node-postgres does not: handing it
// `[[1, 2]]` binds one Postgres array literal instead of two values, which
// fails as a placeholder-count or cast error. Collapse the one-array form so
// both drivers see the same flat list.
const bindings = (args) => (args.length === 1 && Array.isArray(args[0]) ? args[0] : args);

export const db = {
  prepare(sql) {
    return {
      async run(...args) {
        await ensureReady();
        return rawPrepare(sql).run(bindings(args));
      },
      async get(...args) {
        await ensureReady();
        return rawPrepare(sql).get(bindings(args));
      },
      async all(...args) {
        await ensureReady();
        return rawPrepare(sql).all(bindings(args));
      },
    };
  },

  async exec(sql) {
    await ensureReady();
    return getDriver().exec(sql);
  },
};
