import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

/**
 * Database access layer.
 *
 * Two drivers sit behind one small interface:
 *
 *   - Local / self-hosted: better-sqlite3 against data/app.db. No credentials
 *     needed, and it is the only driver that works inside the Next dev server.
 *   - Serverless (Vercel): a remote Turso/libSQL database, selected by
 *     TURSO_DATABASE_URL + TURSO_AUTH_TOKEN. Serverless filesystems are
 *     ephemeral, so a local file cannot be used in production.
 *
 * Both are exposed as `db.prepare(sql).run/get/all`. Those methods always
 * return promises so callers are identical in both environments, and the
 * client is created lazily so `next build` never needs credentials.
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
    exec: async (sql) => conn.exec(sql),
    prepare(sql) {
      const stmt = conn.prepare(sql);
      return {
        run: async (args) => stmt.run(...args),
        get: async (args) => stmt.get(...args),
        all: async (args) => stmt.all(...args),
      };
    },
  };
}

function createRemoteDriver() {
  const { createClient } = require('@libsql/client');
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  return {
    exec: async (sql) => client.executeMultiple(sql),
    prepare(sql) {
      const plain = (row) => (row ? { ...row } : undefined);
      return {
        run: async (args) => client.execute({ sql, args }),
        get: async (args) => plain((await client.execute({ sql, args })).rows[0]),
        all: async (args) =>
          (await client.execute({ sql, args })).rows.map((row) => ({ ...row })),
      };
    },
  };
}

function getDriver() {
  if (driver) return driver;

  if (process.env.VERCEL && !process.env.TURSO_DATABASE_URL) {
    throw new Error(
      'TURSO_DATABASE_URL is not set. Vercel has no persistent filesystem, so a ' +
        'local SQLite file would silently lose every ticket on redeploy. Set ' +
        'TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the project environment variables.'
    );
  }

  driver = process.env.TURSO_DATABASE_URL
    ? createRemoteDriver()
    : createLocalDriver();
  return driver;
}

export function isRemoteDatabase() {
  return Boolean(process.env.TURSO_DATABASE_URL);
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
  await insert.run([
    'INFRA',
    'Infrastructure',
    'Build pipelines, hosting, observability and internal tooling.',
    '#6554c0',
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
  if (row.c === 0) {
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
      projectIds.INFRA,
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
  await rawPrepare(
    `INSERT OR IGNORE INTO employees (name, email, role, department, title)
     SELECT u.name, u.email, u.role, '', ''
     FROM users u`
  ).run([]);
}

async function backfill() {
  // Local databases created by older versions may predate these columns.
  try {
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
  } catch {
    // Remote databases always start from the current schema.
  }

  const orphanProjects = await rawPrepare(
    'SELECT COUNT(*) AS c FROM tickets WHERE project_id IS NULL'
  ).get([]);
  if (orphanProjects.c > 0) {
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
  if (orphanAssignees.c > 0) {
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
  await getDriver().exec(SCHEMA);
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
