import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
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

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    assigned_to INTEGER REFERENCES users(id),
    project_id INTEGER REFERENCES projects(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function migrate() {
  const ticketColumns = db.prepare('PRAGMA table_info(tickets)').all();
  if (!ticketColumns.some((c) => c.name === 'project_id')) {
    db.exec('ALTER TABLE tickets ADD COLUMN project_id INTEGER REFERENCES projects(id)');
  }
}

migrate();

function seedProjects() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO projects (key, name, description, color) VALUES (?, ?, ?, ?)'
  );

  insert.run(
    'WEB',
    'Web Platform',
    'Customer-facing web app, marketing site and design system.',
    '#0c66e4'
  );
  insert.run(
    'MOB',
    'Mobile App',
    'iOS and Android client for the ticketing workflow.',
    '#36b37e'
  );
  insert.run(
    'INFRA',
    'Infrastructure',
    'Build pipelines, hosting, observability and internal tooling.',
    '#6554c0'
  );
}

function backfillTicketProjects() {
  const orphan = db
    .prepare('SELECT COUNT(*) AS c FROM tickets WHERE project_id IS NULL')
    .get().c;
  if (orphan === 0) return;

  const project = db.prepare("SELECT id FROM projects WHERE key = 'WEB'").get();
  if (!project) return;

  db.prepare('UPDATE tickets SET project_id = ? WHERE project_id IS NULL').run(project.id);
}

function seed() {
  db.prepare(
    'INSERT OR IGNORE INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
  ).run(
    'Admin User',
    'admin@example.com',
    bcrypt.hashSync('admin123', bcrypt.genSaltSync(10)),
    'admin'
  );
  db.prepare(
    'INSERT OR IGNORE INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
  ).run(
    'Dev User',
    'dev@example.com',
    bcrypt.hashSync('dev123', bcrypt.genSaltSync(10)),
    'developer'
  );

  const ticketCount = db.prepare('SELECT COUNT(*) AS c FROM tickets').get().c;
  if (ticketCount === 0) {
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
    const dev = db.prepare("SELECT id FROM users WHERE role = 'developer'").get();

    const projectIds = db
      .prepare('SELECT key, id FROM projects')
      .all()
      .reduce((acc, p) => ({ ...acc, [p.key]: p.id }), {});

    const insertTicket = db.prepare(
      `INSERT INTO tickets (title, description, status, priority, created_by, assigned_to, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    insertTicket.run(
      'Fix login page loading bug',
      'The login page spins indefinitely when pressing submit on Firefox.',
      'open',
      'high',
      admin.id,
      dev.id,
      projectIds.WEB
    );
    insertTicket.run(
      'Offline mode loses draft tickets',
      'Drafts created without a connection are dropped instead of queued for sync.',
      'in_progress',
      'urgent',
      dev.id,
      dev.id,
      projectIds.MOB
    );
    insertTicket.run(
      'Speed up preview builds',
      'Preview environment builds take 14 minutes. Parallelise the test stage.',
      'open',
      'medium',
      admin.id,
      null,
      projectIds.INFRA
    );
    insertTicket.run(
      'Board columns lose scroll position',
      'Returning to the board after opening a ticket resets each column to the top.',
      'resolved',
      'low',
      dev.id,
      dev.id,
      projectIds.WEB
    );
  }

  backfillTicketProjects();
}

seedProjects();
seed();