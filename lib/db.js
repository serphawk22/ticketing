import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import bcrypt from 'bcryptjs';
import { PG_SCHEMA } from './schema.postgres.js';

const requireModule = typeof require === 'function' ? require : createRequire(import.meta.url);

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
  { name: 'resolution', ddl: "TEXT NOT NULL DEFAULT ''" },
  { name: 'team', ddl: "TEXT NOT NULL DEFAULT ''" },
  { name: 'budget', ddl: 'REAL NOT NULL DEFAULT 0' },
  { name: 'estimate_seconds', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'parent_id', ddl: 'INTEGER REFERENCES tickets(id)' },
  // Archiving is a flag rather than a delete, so the row survives and can be
  // restored. Stored as 0/1 because SQLite has no boolean and Postgres gets the
  // same integer rather than a second dialect to reason about.
  { name: 'archived', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'archived_at', ddl: 'TEXT' },
  // Who put it away, so the archived list can name them the way Jira does.
  // Cleared on restore. No foreign key: ALTER TABLE on an existing SQLite
  // file cannot add one, and the id is only ever a user id we just wrote.
  { name: 'archived_by', ddl: 'INTEGER' },
  { name: 'slack_channel', ddl: "TEXT NOT NULL DEFAULT ''" },
  {
    name: 'product_inclusion_status',
    ddl: "TEXT NOT NULL DEFAULT 'pending_review'",
  },
  {
    name: 'product_inclusion_reference',
    ddl: "TEXT NOT NULL DEFAULT ''",
  },
];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    password TEXT NOT NULL,
    passkey TEXT,
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
    client_id INTEGER REFERENCES users(id),
    github_repo TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    secondary_email TEXT,
    role TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('admin', 'developer', 'client')),
    department TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    base_salary REAL,
    salary_currency TEXT NOT NULL DEFAULT 'USD',
    last_payment_date TEXT,
    payment_status TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    user_id INTEGER REFERENCES users(id),
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

  -- In-app notifications, one row per recipient so each person owns their own
  -- read/unread state. Every event fans out to all admins and developers, which
  -- is what makes the bell global rather than scoped to a project or assignee.
  -- actor_id deliberately has no foreign key: a deleted account should not take
  -- the notification history with it, the same reasoning as tickets.archived_by.
  -- dedupe_key names the event that produced the row ('created:42') so a retry
  -- cannot double-post; the partial unique index below ignores empty keys,
  -- which marks events that are legitimately unique every time.
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    actor_id INTEGER,
    type TEXT NOT NULL DEFAULT 'update',
    ticket_id INTEGER REFERENCES tickets(id),
    project_id INTEGER,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    dedupe_key TEXT NOT NULL DEFAULT '',
    read INTEGER NOT NULL DEFAULT 0,
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
    resolution TEXT NOT NULL DEFAULT '',
    team TEXT NOT NULL DEFAULT '',
    budget REAL NOT NULL DEFAULT 0,
    estimate_seconds INTEGER NOT NULL DEFAULT 0,
    product_inclusion_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (product_inclusion_status IN ('pending_review', 'included', 'not_included')),
    product_inclusion_reference TEXT NOT NULL DEFAULT '',
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
    duration_minutes INTEGER,
    note TEXT NOT NULL DEFAULT '',
    work_date TEXT,
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
    -- Only meaningful when the state is not_completed: what stopped the work.
    blocker TEXT,
    linked_ticket_id INTEGER REFERENCES tickets(id),
    tickets_detail TEXT,
    projects_detail TEXT,
    -- Two optional extra questions on the same sheet: a learning or other
    -- project, and something new the person did away from work. Nullable, so a
    -- sheet filed without them is still complete.
    learning_project TEXT,
    other_activities TEXT,
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
    happy_goals TEXT NOT NULL DEFAULT '',
    happy_dreams TEXT NOT NULL DEFAULT '',
    happy_self_study TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    parent_id INTEGER REFERENCES project_docs(id),
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  CREATE INDEX IF NOT EXISTS docs_project_idx ON project_docs(project_id);
  CREATE INDEX IF NOT EXISTS docs_parent_idx ON project_docs(parent_id);
  CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read);
  CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at);
  CREATE INDEX IF NOT EXISTS notifications_ticket_idx ON notifications(ticket_id);
  CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications(user_id, dedupe_key) WHERE dedupe_key <> '';

  CREATE TABLE IF NOT EXISTS user_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    avatar_url TEXT NOT NULL DEFAULT '',
    avatar_storage_key TEXT NOT NULL DEFAULT '',
    age INTEGER,
    github_url TEXT NOT NULL DEFAULT '',
    linkedin_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_bank_details (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    account_holder_name TEXT NOT NULL DEFAULT '',
    bank_name TEXT NOT NULL DEFAULT '',
    account_number_encrypted TEXT NOT NULL DEFAULT '',
    account_number_last4 TEXT NOT NULL DEFAULT '',
    ifsc_code TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    sidebar TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER REFERENCES users(id),
    actor_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS report_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    report_slug TEXT NOT NULL,
    section_slug TEXT NOT NULL,
    frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('daily', 'weekly', 'monthly')),
    recipients TEXT NOT NULL,
    filter_config TEXT NOT NULL DEFAULT '{}',
    format TEXT NOT NULL DEFAULT 'csv' CHECK (format IN ('csv', 'json', 'summary')),
    last_sent_at TEXT,
    next_run_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_id);
  CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS report_schedules_active_idx ON report_schedules(is_active);

  -- One row per IST reporting day makes scheduled delivery idempotent across
  -- serverless retries without retaining the report attachments themselves.
  CREATE TABLE IF NOT EXISTS daily_sheet_report_deliveries (
    report_date TEXT PRIMARY KEY,
    run_token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS daily_sheet_report_recipient_deliveries (
    report_date TEXT NOT NULL REFERENCES daily_sheet_report_deliveries(report_date),
    recipient_email TEXT NOT NULL,
    recipient_name TEXT NOT NULL DEFAULT '',
    run_token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    error TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (report_date, recipient_email)
  );

  CREATE TABLE IF NOT EXISTS employee_leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    leave_type TEXT NOT NULL CHECK (leave_type IN ('casual', 'sick', 'paid', 'unpaid', 'other')),
    day_type TEXT NOT NULL DEFAULT 'full_day' CHECK (day_type IN ('full_day', 'first_half', 'second_half')),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    total_working_days REAL NOT NULL DEFAULT 1.0,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by INTEGER REFERENCES users(id),
    reviewer_notes TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS leave_req_emp_idx ON employee_leave_requests(employee_id);
  CREATE INDEX IF NOT EXISTS leave_req_status_idx ON employee_leave_requests(status);
  CREATE INDEX IF NOT EXISTS leave_req_date_idx ON employee_leave_requests(start_date, end_date);

  CREATE TABLE IF NOT EXISTS employee_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    work_date TEXT NOT NULL,
    scheduled_start_time TEXT NOT NULL DEFAULT '09:00',
    scheduled_end_time TEXT NOT NULL DEFAULT '17:00',
    check_in_time TEXT,
    check_out_time TEXT,
    original_check_in_time TEXT,
    original_check_out_time TEXT,
    checkout_source TEXT NOT NULL DEFAULT 'user_action' CHECK (checkout_source IN ('user_action', 'task_sheet_submission', 'admin_adjustment', 'none', 'leave_approval')),
    is_estimated INTEGER NOT NULL DEFAULT 0,
    gross_duration_minutes INTEGER DEFAULT 0,
    break_duration_minutes INTEGER DEFAULT 0,
    net_duration_minutes INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'late', 'half_day', 'absent', 'on_leave', 'weekly_off', 'holiday')),
    original_status TEXT NOT NULL DEFAULT 'present',
    is_manually_adjusted INTEGER NOT NULL DEFAULT 0,
    adjusted_by INTEGER REFERENCES users(id),
    adjustment_reason TEXT,
    requires_admin_review INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    leave_request_id INTEGER REFERENCES employee_leave_requests(id),
    leave_day_type TEXT CHECK (leave_day_type IN ('full_day', 'first_half', 'second_half')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(employee_id, work_date)
  );

  CREATE INDEX IF NOT EXISTS emp_att_workdate_idx ON employee_attendance(work_date);
  CREATE INDEX IF NOT EXISTS emp_att_emp_date_idx ON employee_attendance(employee_id, work_date);

  CREATE TABLE IF NOT EXISTS attendance_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL REFERENCES employee_attendance(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    admin_id INTEGER NOT NULL REFERENCES users(id),
    admin_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT 'admin_manual_correction',
    field_changed TEXT NOT NULL DEFAULT 'status',
    old_value TEXT,
    new_value TEXT,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS att_audit_att_id_idx ON attendance_audit_logs(attendance_id);

  CREATE TABLE IF NOT EXISTS company_holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holiday_date TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_recurring INTEGER NOT NULL DEFAULT 0,
    falls_on_sunday INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
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
  const Database = requireModule('better-sqlite3');
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

// Neon suspends idle compute and its pooler can reset a socket that is opening
// or idle. These are transient: the pool has already discarded the dead client,
// so checking out a fresh one and retrying succeeds. Only retried for the schema
// DDL, which is idempotent, and for reads -- never for writes, where a reset
// after the server applied the statement could otherwise duplicate it.
const TRANSIENT_CONNECTION_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  // undici (Node's global fetch) reports failures as a generic TypeError whose
  // real reason lives on error.cause. These are the socket/timeout codes it uses.
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_REQ_ABORTED',
  'UND_ERR_ABORTED',
]);
const TRANSIENT_CONNECTION_MESSAGES = [
  'Connection terminated unexpectedly',
  'Connection terminated',
  'Client has encountered a connection error',
  'timeout exceeded when trying to connect',
  'read ECONNRESET',
  'fetch failed',
  'network connection was lost',
  'socket hang up',
];
// Neon's HTTP endpoint can answer 503 while compute wakes up or 429 while it is
// rate limiting. Retry those instead of failing the whole request.
const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
// Postgres SQLSTATEs that mean "try again": connection exceptions (08xxx),
// cannot_connect_now, too_many_connections and admin/crash shutdown.
const TRANSIENT_SQL_STATES = new Set(['57P01', '57P02', '57P03', '53300']);

function isTransientConnectionError(error) {
  // Walk the cause chain: fetch() throws TypeError('fetch failed') and puts the
  // actionable code (ECONNRESET, UND_ERR_CONNECT_TIMEOUT, ...) on error.cause.
  // Without this, every transient Neon HTTP failure looked permanent and the
  // retry helper rethrew it immediately -- which is exactly the "fetch failed"
  // crash seen during init().
  const seen = new Set();
  for (let current = error; current && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (TRANSIENT_CONNECTION_CODES.has(current.code)) return true;
    if (current.status && TRANSIENT_HTTP_STATUS.has(current.status)) return true;
    if (typeof current.code === 'string') {
      if (current.code.startsWith('08') || TRANSIENT_SQL_STATES.has(current.code)) return true;
    }
    if (current.name === 'AbortError' || current.name === 'TimeoutError') return true;
    const message = String(current.message || '');
    if (TRANSIENT_CONNECTION_MESSAGES.some((text) => message.includes(text))) return true;
  }
  return false;
}

async function withConnectionRetry(operation, attempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientConnectionError(error) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

function createPostgresDriver() {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && isNeonUrl(dbUrl)) {
    return createNeonHttpDriver(dbUrl);
  }
  // Required lazily so `next build` never needs pg resolved.
  const { Pool, types } = requireModule('pg');

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
    // Serverless invocations are short and bursty. A small pool avoids opening
    // far more backends than Neon needs to keep warm.
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 60_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: true }
        : process.env.DATABASE_SSL === 'false'
          ? false
          : { rejectUnauthorized: false },
  });

  // Neon may close an idle client between requests. Without a listener, the
  // 'error' event an idle client emits would crash the process; the pool then
  // replaces the dead client on the next checkout.
  pool.on('error', (err) => {
    console.error('Unexpected error on idle Postgres client', err);
  });

  // Required on Vercel Fluid: keeps the pool alive between invocations instead
  // of reconnecting on every request.
  if (process.env.VERCEL) {
    const { attachDatabasePool } = requireModule('@vercel/functions');
    attachDatabasePool(pool);
  }

  return {
    dialect: 'postgres',
    // Multi-statement DDL uses the simple query protocol, which node-postgres
    // only allows when no values are bound.
    exec: async (sql) => {
      try {
        await withConnectionRetry(() => pool.query(sql));
      } catch (err) {
        if (isTransientConnectionError(err)) {
          try { await pool.end(); } catch {}
          driver = undefined;
        }
        throw err;
      }
    },
    prepare(sql) {
      const statement = toPostgres(sql);
      const run = (args = []) => pool.query(statement, args);
      const read = (args = []) => withConnectionRetry(() => pool.query(statement, args));

      return {
        run: async (args = []) => {
          const result = await run(args);
          return {
            rowCount: result.rowCount ?? result.rows.length,
            lastInsertRowid: result.rows[0]?.id ?? null,
            rows: result.rows,
          };
        },
        get: async (args = []) => (await read(args)).rows[0],
        all: async (args = []) => (await read(args)).rows,
      };
    },
  };
}

function isNeonUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('.neon.tech');
  } catch {
    return false;
  }
}

function splitStatements(sql) {
  const stmts = [];
  let current = '';
  let inDollar = false;
  let dollarTag = '';

  const lines = sql.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inDollar && trimmed.startsWith('--')) continue;

    current += line + '\n';

    if (!inDollar) {
      const match = current.match(/\$\$|(\$\w+\$)/);
      if (match) {
        inDollar = true;
        dollarTag = match[0];
      }
    } else {
      if (current.includes(dollarTag, current.indexOf(dollarTag) + dollarTag.length)) {
        inDollar = false;
        dollarTag = '';
      }
    }

    if (!inDollar && trimmed.endsWith(';')) {
      const stmt = current.trim();
      if (stmt) stmts.push(stmt);
      current = '';
    }
  }

  if (current.trim()) {
    stmts.push(current.trim());
  }
  return stmts;
}

function createNeonHttpDriver(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const endpoint = `https://${parsed.hostname}/sql`;
  const configuredTimeout = Number(process.env.DATABASE_HTTP_TIMEOUT_MS);
  const requestTimeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 60_000;

  function normalizeRow(row) {
    if (!row || typeof row !== 'object') return row;
    const out = {};
    for (const [key, val] of Object.entries(row)) {
      if (typeof val === 'string' && TIMESTAMP_TEXT.test(val)) {
        out[key] = toSqliteTimestamp(val);
      } else if (key === 'c' || key === 'count' || key === 'expires_at') {
        out[key] = Number(val);
      } else {
        out[key] = val;
      }
    }
    return out;
  }

  async function send(text, params) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Neon-Connection-String': databaseUrl,
        },
        body: JSON.stringify({ query: text, params }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function execute(text, params = [], { retry = false } = {}) {
    const operation = async () => {
      const resp = await send(text, params);

      if (!resp.ok) {
        const errText = await resp.text();
        let parsedErr;
        try { parsedErr = JSON.parse(errText); } catch {}
        const error = new Error(parsedErr?.message || errText);
        error.status = resp.status;
        if (parsedErr?.code) error.code = parsedErr.code;
        throw error;
      }

      const data = await resp.json();
      const rows = (data.rows || []).map(normalizeRow);
      return {
        rows,
        rowCount: data.rowCount ?? rows.length,
      };
    };

    return retry ? withConnectionRetry(operation) : operation();
  }

  return {
    dialect: 'postgres',
    exec: async (sql) => {
      const stmts = splitStatements(sql);
      for (const stmt of stmts) {
        // DDL is idempotent, so retrying a dropped connection is safe here.
        await execute(stmt, [], { retry: true });
      }
    },
    prepare(sql) {
      const statement = toPostgres(sql);
      return {
        // Never retry a write: the server may already have applied it before the
        // connection dropped, and a replay could duplicate the row.
        run: async (args = []) => {
          const result = await execute(statement, args);
          return {
            rowCount: result.rowCount ?? result.rows.length,
            lastInsertRowid: result.rows[0]?.id ?? null,
            rows: result.rows,
          };
        },
        get: async (args = []) => {
          const result = await execute(statement, args, { retry: true });
          return result.rows[0];
        },
        all: async (args = []) => {
          const result = await execute(statement, args, { retry: true });
          return result.rows;
        },
      };
    },
  };
}

function selectDriver() {
  const raw = process.env.DB_DRIVER;
  const forced = (raw || '').replace(/^['"]|['"]$/g, '').trim().toLowerCase();
  if (forced === 'sqlite') return 'sqlite';
  if (forced === 'postgres' || forced === 'postgresql') return 'postgres';
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
    'Default workspace for uncategorised projects.',
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

async function seedAttendanceDefaults() {
  const settings = [
    ['work_start_time', '09:00', 'Official office start time (Asia/Kolkata)'],
    ['work_end_time', '17:00', 'Official office end time (Asia/Kolkata)'],
    ['lunch_start_time', '12:30', 'Standard lunch break start time'],
    ['lunch_end_time', '13:00', 'Standard lunch break end time'],
    ['grace_period_minutes', '150', 'Grace period in minutes before Late status applies (max 180)'],
    ['max_grace_period_limit', '180', 'Maximum configurable grace period cap in minutes'],
    ['timezone', 'Asia/Kolkata', 'Company standard timezone'],
  ];

  for (const [key, value, description] of settings) {
    await rawPrepare(
      'INSERT OR IGNORE INTO attendance_settings (key, value, description) VALUES (?, ?, ?)'
    ).run([key, value, description]);
  }

  const holidays = [
    // 6 Fixed Recurring Annual Holidays
    ['01-01', "New Year's Day", 1, 0],
    ['01-26', 'Republic Day', 1, 0],
    ['05-01', 'May Day', 1, 0],
    ['08-15', 'Independence Day', 1, 0],
    ['10-02', 'Mahatma Gandhi Jayanthi', 1, 0],
    ['12-25', 'Christmas', 1, 0],

    // 8 Year-Specific Festival Holidays for 2026
    ['2026-01-15', 'Uttarayana Punyakala / Makara Sankranti', 0, 0],
    ['2026-03-19', 'Ugadi Festival', 0, 0],
    ['2026-09-14', 'Varasiddhi Vinayaka Vratha', 0, 0],
    ['2026-10-20', 'Ayudha Pooja', 0, 0],
    ['2026-10-21', 'Vijayadasami / Ayudha Pooja', 0, 0],
    ['2026-02-15', 'Maha Shivaratri', 0, 1],
    ['2026-11-01', 'Kannada Rajyotsava', 0, 1],
    ['2026-11-08', 'Diwali (Naraka Chaturdashi)', 0, 1],
  ];

  for (const [holidayDate, name, isRecurring, fallsOnSunday] of holidays) {
    await rawPrepare(
      'INSERT OR IGNORE INTO company_holidays (holiday_date, name, is_recurring, falls_on_sunday) VALUES (?, ?, ?, ?)'
    ).run([holidayDate, name, isRecurring, fallsOnSunday]);
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
     WHERE u.email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.email = u.email)`
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
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      passkey TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin', 'developer', 'client')),
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    employees: `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('admin', 'developer', 'client')),
      department TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      user_id INTEGER REFERENCES users(id),
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

// Make email optional for clients on users and employees tables, and link
// employees to users via user_id.
async function makeEmailOptional() {
  const active = getDriver();
  if (active.dialect !== 'sqlite') return;

  const userCols = await active.prepare('PRAGMA table_info(users)').all([]);
  const userEmailCol = userCols.find((c) => c.name === 'email');
  if (userEmailCol && userEmailCol.notnull === 1) {
    const names = userCols.map((c) => c.name).join(', ');
    await active.exec('PRAGMA foreign_keys = OFF');
    await active.exec('BEGIN');
    try {
      await active.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          password TEXT NOT NULL,
          passkey TEXT,
          role TEXT NOT NULL CHECK (role IN ('admin', 'developer', 'client')),
          must_change_password INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users_new (${names}) SELECT ${names} FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      await active.exec('COMMIT');
    } catch (err) {
      await active.exec('ROLLBACK');
      throw err;
    } finally {
      await active.exec('PRAGMA foreign_keys = ON');
    }
  }

  const empCols = await active.prepare('PRAGMA table_info(employees)').all([]);
  const empEmailCol = empCols.find((c) => c.name === 'email');
  const hasUserId = empCols.some((c) => c.name === 'user_id');

  if ((empEmailCol && empEmailCol.notnull === 1) || !hasUserId) {
    const names = empCols.map((c) => c.name).join(', ');
    await active.exec('PRAGMA foreign_keys = OFF');
    await active.exec('BEGIN');
    try {
      await active.exec(`
        CREATE TABLE employees_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          secondary_email TEXT,
          role TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('admin', 'developer', 'client')),
          department TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          base_salary REAL,
          salary_currency TEXT NOT NULL DEFAULT 'USD',
          last_payment_date TEXT,
          payment_status TEXT NOT NULL DEFAULT '',
          active INTEGER NOT NULL DEFAULT 1,
          user_id INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO employees_new (${names}) SELECT ${names} FROM employees;
        DROP TABLE employees;
        ALTER TABLE employees_new RENAME TO employees;
        CREATE INDEX IF NOT EXISTS employees_active_idx ON employees(active);
        CREATE INDEX IF NOT EXISTS employees_user_idx ON employees(user_id);
      `);
      await active.exec('COMMIT');
    } catch (err) {
      await active.exec('ROLLBACK');
      throw err;
    } finally {
      await active.exec('PRAGMA foreign_keys = ON');
    }
  }

  await active.exec(`
    UPDATE employees
    SET user_id = (SELECT u.id FROM users u WHERE u.email = employees.email)
    WHERE user_id IS NULL AND email IS NOT NULL;
  `);
}


async function rebuildEmployeeAttendanceIfNeeded() {
  const active = getDriver();
  if (active.dialect !== 'sqlite') return;

  const row = await active
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'employee_attendance'")
    .all([]);
  const ddl = row[0]?.sql || '';
  if (!ddl || ddl.includes("'on_leave'")) return;

  const dataDir = path.join(process.cwd(), 'data');
  const dbFile = path.join(dataDir, 'app.db');
  if (fs.existsSync(dbFile)) {
    const backupFile = path.join(dataDir, `app.db.bak-${Date.now()}`);
    try {
      fs.copyFileSync(dbFile, backupFile);
    } catch (err) {
      console.warn('Could not create pre-migration backup of app.db:', err.message);
    }
  }

  const preAtt = await active
    .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(id), 0) AS id_sum, COALESCE(MIN(id), 0) AS min_id, COALESCE(MAX(id), 0) AS max_id FROM employee_attendance')
    .all([]);
  const preTotal = Number(preAtt[0]?.total || 0);
  const preIdSum = Number(preAtt[0]?.id_sum || 0);
  const preMinId = Number(preAtt[0]?.min_id || 0);
  const preMaxId = Number(preAtt[0]?.max_id || 0);

  const existingCols = await active.prepare('PRAGMA table_info(employee_attendance)').all([]);
  const colNames = existingCols.map((c) => c.name);

  await active.exec('PRAGMA foreign_keys = OFF');
  await active.exec('BEGIN TRANSACTION');
  try {
    await active.exec(`
      CREATE TABLE employee_attendance_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        work_date TEXT NOT NULL,
        scheduled_start_time TEXT NOT NULL DEFAULT '09:00',
        scheduled_end_time TEXT NOT NULL DEFAULT '17:00',
        check_in_time TEXT,
        check_out_time TEXT,
        original_check_in_time TEXT,
        original_check_out_time TEXT,
        checkout_source TEXT NOT NULL DEFAULT 'user_action' CHECK (checkout_source IN ('user_action', 'task_sheet_submission', 'admin_adjustment', 'none', 'leave_approval')),
        is_estimated INTEGER NOT NULL DEFAULT 0,
        gross_duration_minutes INTEGER DEFAULT 0,
        break_duration_minutes INTEGER DEFAULT 0,
        net_duration_minutes INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'late', 'half_day', 'absent', 'on_leave', 'weekly_off', 'holiday')),
        original_status TEXT NOT NULL DEFAULT 'present',
        is_manually_adjusted INTEGER NOT NULL DEFAULT 0,
        adjusted_by INTEGER REFERENCES users(id),
        adjustment_reason TEXT,
        requires_admin_review INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        leave_request_id INTEGER REFERENCES employee_leave_requests(id),
        leave_day_type TEXT CHECK (leave_day_type IN ('full_day', 'first_half', 'second_half')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(employee_id, work_date)
      )
    `);

    const selectCols = colNames.join(', ');
    await active.exec(`INSERT INTO employee_attendance_new (${selectCols}) SELECT ${selectCols} FROM employee_attendance`);

    const postAtt = await active
      .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(id), 0) AS id_sum, COALESCE(MIN(id), 0) AS min_id, COALESCE(MAX(id), 0) AS max_id FROM employee_attendance_new')
      .all([]);
    const postTotal = Number(postAtt[0]?.total || 0);
    const postIdSum = Number(postAtt[0]?.id_sum || 0);
    const postMinId = Number(postAtt[0]?.min_id || 0);
    const postMaxId = Number(postAtt[0]?.max_id || 0);

    if (postTotal !== preTotal || postIdSum !== preIdSum || postMinId !== preMinId || postMaxId !== preMaxId) {
      throw new Error(`Data mismatch during employee_attendance migration: Expected count=${preTotal}, id_sum=${preIdSum}; got count=${postTotal}, id_sum=${postIdSum}`);
    }

    await active.exec('DROP TABLE employee_attendance');
    await active.exec('ALTER TABLE employee_attendance_new RENAME TO employee_attendance');
    await active.exec('CREATE INDEX IF NOT EXISTS emp_att_workdate_idx ON employee_attendance(work_date)');
    await active.exec('CREATE INDEX IF NOT EXISTS emp_att_emp_date_idx ON employee_attendance(employee_id, work_date)');
    await active.exec('CREATE INDEX IF NOT EXISTS emp_att_leave_req_idx ON employee_attendance(leave_request_id)');

    await active.exec('COMMIT');
  } catch (err) {
    await active.exec('ROLLBACK');
    throw err;
  } finally {
    await active.exec('PRAGMA foreign_keys = ON');
  }

  const fkErrors = await active.prepare('PRAGMA foreign_key_check(employee_attendance)').all([]);
  const fkAudit = await active.prepare('PRAGMA foreign_key_check(attendance_audit_logs)').all([]);
  if (fkAudit && fkAudit.length > 0) fkErrors.push(...fkAudit);
  if (fkErrors && fkErrors.length > 0) {
    throw new Error(`Foreign key integrity violation detected post-migration: ${JSON.stringify(fkErrors)}`);
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
    await makeEmailOptional();
    await rebuildEmployeeAttendanceIfNeeded();

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
    // Optional client account behind a project. Nullable: a project may have no
    // client, and rows created before the field existed stay valid.
    if (projectNames.length && !projectNames.includes('client_id')) {
      await getDriver().exec(
        'ALTER TABLE projects ADD COLUMN client_id INTEGER REFERENCES users(id)'
      );
    }
    // Optional GitHub repo(s) for the task-sheet activity panel. owner/name or
    // a comma-separated list; empty falls back to GITHUB_REPOS in the env.
    if (projectNames.length && !projectNames.includes('github_repo')) {
      await getDriver().exec(
        "ALTER TABLE projects ADD COLUMN github_repo TEXT NOT NULL DEFAULT ''"
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
    // Clients sign in with a single per-client passkey rather than a password,
    // so the hashed passkey has to be added to databases that predate it.
    // Nullable: is only ever written for client accounts.
    if (userNames.length && !userNames.includes('passkey')) {
      await getDriver().exec('ALTER TABLE users ADD COLUMN passkey TEXT');
    }
    // The blocker answer arrived after the sheet itself. Nullable, so no
    // default is needed and rows filed before it stay valid.
    const sheetCols = await rawPrepare(
      'PRAGMA table_info(task_sheet_submissions)'
    ).all([]);
    const sheetNames = sheetCols.map((c) => c.name);
    if (sheetNames.length && !sheetNames.includes('blocker')) {
      await getDriver().exec(
        'ALTER TABLE task_sheet_submissions ADD COLUMN blocker TEXT'
      );
    }
    if (sheetNames.length && !sheetNames.includes('tickets_detail')) {
      await getDriver().exec(
        'ALTER TABLE task_sheet_submissions ADD COLUMN tickets_detail TEXT'
      );
    }
    if (sheetNames.length && !sheetNames.includes('projects_detail')) {
      await getDriver().exec(
        'ALTER TABLE task_sheet_submissions ADD COLUMN projects_detail TEXT'
      );
    }
    // The learning/other-project and off-the-clock questions arrived after the
    // sheet itself. Both optional, so the columns are nullable and rows filed
    // before they existed stay valid.
    if (sheetNames.length && !sheetNames.includes('learning_project')) {
      await getDriver().exec(
        'ALTER TABLE task_sheet_submissions ADD COLUMN learning_project TEXT'
      );
    }
    if (sheetNames.length && !sheetNames.includes('other_activities')) {
      await getDriver().exec(
        'ALTER TABLE task_sheet_submissions ADD COLUMN other_activities TEXT'
      );
    }
    // The goals and dreams questions arrived after the happy sheet itself.
    // Required, so they carry an empty default; rows filed before they existed
    // stay valid.
    const happyCols = await rawPrepare(
      'PRAGMA table_info(happy_sheet_submissions)'
    ).all([]);
    const happyNames = happyCols.map((c) => c.name);
    if (happyNames.length && !happyNames.includes('happy_goals')) {
      await getDriver().exec(
        "ALTER TABLE happy_sheet_submissions ADD COLUMN happy_goals TEXT NOT NULL DEFAULT ''"
      );
    }
    if (happyNames.length && !happyNames.includes('happy_dreams')) {
      await getDriver().exec(
        "ALTER TABLE happy_sheet_submissions ADD COLUMN happy_dreams TEXT NOT NULL DEFAULT ''"
      );
    }
    if (happyNames.length && !happyNames.includes('happy_self_study')) {
      await getDriver().exec(
        "ALTER TABLE happy_sheet_submissions ADD COLUMN happy_self_study TEXT NOT NULL DEFAULT ''"
      );
    }

    const timeLogCols = await rawPrepare(
      'PRAGMA table_info(ticket_time_logs)'
    ).all([]);
    const timeLogNames = timeLogCols.map((c) => c.name);
    if (timeLogNames.length && !timeLogNames.includes('work_date')) {
      await getDriver().exec(
        'ALTER TABLE ticket_time_logs ADD COLUMN work_date TEXT'
      );
    }
    if (timeLogNames.length && !timeLogNames.includes('duration_minutes')) {
      await getDriver().exec(
        'ALTER TABLE ticket_time_logs ADD COLUMN duration_minutes INTEGER'
      );
    }

    // Created here rather than in SCHEMA, for the same reason as the tickets
    // indexes above: on a database that predates the column, SCHEMA has already
    // run and the index would fail with 'no such column: workspace_id'.
    await getDriver().exec(
      'CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects(workspace_id)'
    );

    const empCols = await rawPrepare('PRAGMA table_info(employees)').all([]);
    const empNames = empCols.map((c) => c.name);
    if (empNames.length && !empNames.includes('secondary_email')) {
      await getDriver().exec('ALTER TABLE employees ADD COLUMN secondary_email TEXT');
    }
    if (empNames.length && !empNames.includes('base_salary')) {
      await getDriver().exec('ALTER TABLE employees ADD COLUMN base_salary REAL');
    }
    if (empNames.length && !empNames.includes('last_payment_date')) {
      await getDriver().exec('ALTER TABLE employees ADD COLUMN last_payment_date TEXT');
    }
    if (empNames.length && !empNames.includes('payment_status')) {
      await getDriver().exec(
        "ALTER TABLE employees ADD COLUMN payment_status TEXT NOT NULL DEFAULT ''"
      );
    }
    if (empNames.length && !empNames.includes('salary_currency')) {
      await getDriver().exec(
        "ALTER TABLE employees ADD COLUMN salary_currency TEXT NOT NULL DEFAULT 'USD'"
      );
    }

    await getDriver().exec(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        avatar_url TEXT NOT NULL DEFAULT '',
        avatar_storage_key TEXT NOT NULL DEFAULT '',
        age INTEGER,
        github_url TEXT NOT NULL DEFAULT '',
        linkedin_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS user_bank_details (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        account_holder_name TEXT NOT NULL DEFAULT '',
        bank_name TEXT NOT NULL DEFAULT '',
        account_number_encrypted TEXT NOT NULL DEFAULT '',
        account_number_last4 TEXT NOT NULL DEFAULT '',
        ifsc_code TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id INTEGER REFERENCES users(id),
        actor_name TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL DEFAULT '',
        details TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS report_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        report_slug TEXT NOT NULL,
        section_slug TEXT NOT NULL,
        frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('daily', 'weekly', 'monthly')),
        recipients TEXT NOT NULL,
        filter_config TEXT NOT NULL DEFAULT '{}',
        format TEXT NOT NULL DEFAULT 'csv' CHECK (format IN ('csv', 'json', 'summary')),
        last_sent_at TEXT,
        next_run_at TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_id);
      CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS report_schedules_active_idx ON report_schedules(is_active);

  CREATE TABLE IF NOT EXISTS employee_leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    leave_type TEXT NOT NULL CHECK (leave_type IN ('casual', 'sick', 'paid', 'unpaid', 'other')),
    day_type TEXT NOT NULL DEFAULT 'full_day' CHECK (day_type IN ('full_day', 'first_half', 'second_half')),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    total_working_days REAL NOT NULL DEFAULT 1.0,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by INTEGER REFERENCES users(id),
    reviewer_notes TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS leave_req_emp_idx ON employee_leave_requests(employee_id);
  CREATE INDEX IF NOT EXISTS leave_req_status_idx ON employee_leave_requests(status);
  CREATE INDEX IF NOT EXISTS leave_req_date_idx ON employee_leave_requests(start_date, end_date);

  CREATE TABLE IF NOT EXISTS employee_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    work_date TEXT NOT NULL,
    scheduled_start_time TEXT NOT NULL DEFAULT '09:00',
    scheduled_end_time TEXT NOT NULL DEFAULT '17:00',
    check_in_time TEXT,
    check_out_time TEXT,
    original_check_in_time TEXT,
    original_check_out_time TEXT,
    checkout_source TEXT NOT NULL DEFAULT 'user_action' CHECK (checkout_source IN ('user_action', 'task_sheet_submission', 'admin_adjustment', 'none', 'leave_approval')),
    is_estimated INTEGER NOT NULL DEFAULT 0,
    gross_duration_minutes INTEGER DEFAULT 0,
    break_duration_minutes INTEGER DEFAULT 0,
    net_duration_minutes INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'late', 'half_day', 'absent', 'on_leave', 'weekly_off', 'holiday')),
    original_status TEXT NOT NULL DEFAULT 'present',
    is_manually_adjusted INTEGER NOT NULL DEFAULT 0,
    adjusted_by INTEGER REFERENCES users(id),
    adjustment_reason TEXT,
    requires_admin_review INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    leave_request_id INTEGER REFERENCES employee_leave_requests(id),
    leave_day_type TEXT CHECK (leave_day_type IN ('full_day', 'first_half', 'second_half')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(employee_id, work_date)
  );

  CREATE INDEX IF NOT EXISTS emp_att_workdate_idx ON employee_attendance(work_date);
  CREATE INDEX IF NOT EXISTS emp_att_emp_date_idx ON employee_attendance(employee_id, work_date);

  CREATE TABLE IF NOT EXISTS attendance_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL REFERENCES employee_attendance(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    admin_id INTEGER NOT NULL REFERENCES users(id),
    admin_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT 'admin_manual_correction',
    field_changed TEXT NOT NULL DEFAULT 'status',
    old_value TEXT,
    new_value TEXT,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS att_audit_att_id_idx ON attendance_audit_logs(attendance_id);

  CREATE TABLE IF NOT EXISTS company_holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holiday_date TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_recurring INTEGER NOT NULL DEFAULT 0,
    falls_on_sunday INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );
    `);
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

  // Seed the notification panel with the tickets that already exist, so the
  // feature ships with history rather than an empty feed. Marked read: they
  // happened before anybody had a bell, and arriving with a badge on every
  // account would trainsignal nothing. Guarded on an empty table so this runs
  // once -- afterwards the app's own event hooks own the table.
  const notificationCount = await rawPrepare(
    'SELECT COUNT(*) AS c FROM notifications'
  ).get([]);
  if (Number(notificationCount.c) === 0) {
    const recipients = await rawPrepare(
      "SELECT id FROM users WHERE role IN ('admin', 'developer')"
    ).all([]);
    if (recipients.length) {
      const existingTickets = await rawPrepare(
        `SELECT t.id, t.title, t.project_id, p.key AS project_key, t.created_at
         FROM tickets t
         LEFT JOIN projects p ON p.id = t.project_id`
      ).all([]);
      for (const ticket of existingTickets) {
        const key = `${ticket.project_key || 'TM'}-${ticket.id}`;
        const link = ticket.project_id
          ? `/projects/${ticket.project_id}/list?selectedIssue=${encodeURIComponent(key)}`
          : `/work-items?selectedIssue=${encodeURIComponent(key)}`;
        for (const recipient of recipients) {
          await rawPrepare(
            `INSERT OR IGNORE INTO notifications
               (user_id, type, ticket_id, project_id, title, body, link, dedupe_key, read, created_at)
             VALUES (?, 'created', ?, ?, ?, ?, ?, ?, 1, ?)`
          ).run([
            recipient.id,
            ticket.id,
            ticket.project_id ?? null,
            `${key} created`,
            ticket.title,
            link,
            `created:${ticket.id}`,
            ticket.created_at,
          ]);
        }
      }
    }
  }
}

async function init() {
  const active = getDriver();
  await active.exec(active.dialect === 'postgres' ? PG_SCHEMA : SCHEMA);
  await seedProjects();
  await seed();
  await mirrorUsersAsEmployees();
  await backfill();
  await seedAttendanceDefaults();
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
