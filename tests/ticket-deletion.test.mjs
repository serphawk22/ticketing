import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_DB_PATH = path.resolve(ROOT_DIR, 'data/test_ticket_deletion_isolated.db');

for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;

// Register ESM loader hook to mock Next.js headers/cookies and server responses
const rootUrl = pathToFileURL(ROOT_DIR + path.sep).href;
const loaderCode = `
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT_URL = ${JSON.stringify(rootUrl)};

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/headers') {
    return { url: 'test-mock:next/headers', shortCircuit: true };
  }
  if (specifier === 'next/server') {
    return { url: 'test-mock:next/server', shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2);
    const candidate = new URL(rel, ROOT_URL);
    if (!fs.existsSync(fileURLToPath(candidate)) && fs.existsSync(fileURLToPath(new URL(rel + '.js', ROOT_URL)))) {
      return nextResolve(new URL(rel + '.js', ROOT_URL).href, context);
    }
    return nextResolve(candidate.href, context);
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith(ROOT_URL)) {
    const candidate = new URL(specifier, context.parentURL);
    if (!fs.existsSync(fileURLToPath(candidate)) && fs.existsSync(fileURLToPath(new URL(specifier + '.js', context.parentURL)))) {
      return nextResolve(new URL(specifier + '.js', context.parentURL).href, context);
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === 'test-mock:next/headers') {
    return {
      format: 'module',
      shortCircuit: true,
      source: \`
        export async function cookies() {
          return {
            get(name) {
              const val = globalThis.__TEST_COOKIES__?.[name];
              return val ? { name, value: val } : undefined;
            },
            set() {},
            delete() {},
          };
        }
      \`,
    };
  }
  if (url === 'test-mock:next/server') {
    return {
      format: 'module',
      shortCircuit: true,
      source: \`
        export const NextResponse = {
          json(body, init) {
            return new Response(JSON.stringify(body), {
              status: init?.status ?? 200,
              headers: { 'content-type': 'application/json' },
            });
          },
        };
      \`,
    };
  }
  return nextLoad(url, context);
}
`;

register(`data:text/javascript;base64,${Buffer.from(loaderCode).toString('base64')}`, import.meta.url);

const { db } = await import('../lib/db.js');
const { DELETE: deleteTicketRoute } = await import('../app/api/tickets/[id]/route.js');
const { deleteTicket } = await import('../lib/tickets.js');

after(() => {
  globalThis.__TEST_COOKIES__ = undefined;
  try {
    db.close();
  } catch {}
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(TEST_DB_PATH + ext)) {
      try { fs.unlinkSync(TEST_DB_PATH + ext); } catch {}
    }
  }
});

test('Ticket Deletion Full Test Suite (Isolated SQLite)', async (t) => {
  // 1. Setup seed users, sessions, employees, and project
  const ownerRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Test Owner', 'owner_del_test@example.com', 'hash', 'owner')")
    .run();
  const ownerId = ownerRes.lastInsertRowid;
  const ownerToken = 'token_owner_123';
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(ownerToken, ownerId, Date.now() + 86400000);

  const adminRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Test Admin', 'admin_del_test@example.com', 'hash', 'admin')")
    .run();
  const adminId = adminRes.lastInsertRowid;
  const adminToken = 'token_admin_123';
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(adminToken, adminId, Date.now() + 86400000);

  const empRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Test Emp', 'emp_del_test@example.com', 'hash', 'employee')")
    .run();
  const empUserId = empRes.lastInsertRowid;
  const empToken = 'token_emp_123';
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(empToken, empUserId, Date.now() + 86400000);

  const clientRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Test Client', 'client_del_test@example.com', 'hash', 'client')")
    .run();
  const clientToken = 'token_client_123';
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(clientToken, clientRes.lastInsertRowid, Date.now() + 86400000);

  const projRes = await db
    .prepare("INSERT INTO projects (key, name, description) VALUES ('TESTDEL', 'Test Project', 'Testing')")
    .run();
  const projectId = projRes.lastInsertRowid;

  const employeeRecord = await db
    .prepare("INSERT INTO employees (user_id, name, email) VALUES (?, 'Test Emp', 'emp_del_test@example.com')")
    .run(empUserId);
  const employeeId = employeeRecord.lastInsertRowid;

  await t.test('1. Deletes ticket with stage history, comments, and attachments cleanly', async () => {
    const tRes = await db
      .prepare("INSERT INTO tickets (title, description, created_by, project_id, status) VALUES ('Ticket To Delete', 'Desc', ?, ?, 'open')")
      .run(ownerId, projectId);
    const ticketId = tRes.lastInsertRowid;

    // Insert stage history
    await db
      .prepare("INSERT INTO ticket_stage_history (ticket_id, project_id, transition_seq, from_status, to_status, entry_at) VALUES (?, ?, 1, NULL, 'open', datetime('now'))")
      .run(ticketId, projectId);

    // Insert comment
    await db
      .prepare("INSERT INTO ticket_comments (ticket_id, author_id, body) VALUES (?, ?, 'A comment')")
      .run(ticketId, ownerId);

    // Insert attachment
    await db
      .prepare("INSERT INTO ticket_attachments (ticket_id, filename, storage_key, uploaded_by) VALUES (?, 'file.txt', 'storage/file.txt', ?)")
      .run(ticketId, ownerId);

    globalThis.__TEST_COOKIES__ = { ticket_session: ownerToken };

    const req = new Request(`http://localhost/api/tickets/${ticketId}`, { method: 'DELETE' });
    const res = await deleteTicketRoute(req, { params: Promise.resolve({ id: String(ticketId) }) });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.deleted, true);
    assert.equal(body.ticket.id, ticketId);

    // Assert row in tickets is gone
    const checkTicket = await db.prepare('SELECT id FROM tickets WHERE id = ?').get(ticketId);
    assert.equal(checkTicket, undefined);

    // Assert stage history is gone
    const checkHistory = await db.prepare('SELECT id FROM ticket_stage_history WHERE ticket_id = ?').all(ticketId);
    assert.equal(checkHistory.length, 0);

    // Assert comments and attachments are gone
    const checkComments = await db.prepare('SELECT id FROM ticket_comments WHERE ticket_id = ?').all(ticketId);
    assert.equal(checkComments.length, 0);
    const checkAttachments = await db.prepare('SELECT id FROM ticket_attachments WHERE ticket_id = ?').all(ticketId);
    assert.equal(checkAttachments.length, 0);
  });

  await t.test('2. Correctly re-parents child tickets to parent of deleted ticket', async () => {
    // Grandparent ticket
    const gpRes = await db
      .prepare("INSERT INTO tickets (title, description, created_by, project_id) VALUES ('Grandparent', '', ?, ?)")
      .run(ownerId, projectId);
    const gpId = gpRes.lastInsertRowid;

    // Parent ticket
    const pRes = await db
      .prepare("INSERT INTO tickets (title, description, created_by, project_id, parent_id) VALUES ('Parent', '', ?, ?, ?)")
      .run(ownerId, projectId, gpId);
    const pId = pRes.lastInsertRowid;

    // 2 Child tickets
    const c1Res = await db
      .prepare("INSERT INTO tickets (title, description, created_by, project_id, parent_id) VALUES ('Child 1', '', ?, ?, ?)")
      .run(ownerId, projectId, pId);
    const c1Id = c1Res.lastInsertRowid;

    const c2Res = await db
      .prepare("INSERT INTO tickets (title, description, created_by, project_id, parent_id) VALUES ('Child 2', '', ?, ?, ?)")
      .run(ownerId, projectId, pId);
    const c2Id = c2Res.lastInsertRowid;

    globalThis.__TEST_COOKIES__ = { ticket_session: adminToken };
    const req = new Request(`http://localhost/api/tickets/${pId}`, { method: 'DELETE' });
    const res = await deleteTicketRoute(req, { params: Promise.resolve({ id: String(pId) }) });
    assert.equal(res.status, 200);

    // Check re-parenting: c1 and c2 should now have parent_id = gpId
    const c1 = await db.prepare('SELECT parent_id FROM tickets WHERE id = ?').get(c1Id);
    assert.equal(c1.parent_id, gpId);

    const c2 = await db.prepare('SELECT parent_id FROM tickets WHERE id = ?').get(c2Id);
    assert.equal(c2.parent_id, gpId);
  });

  await t.test('3. Preserves employee work logs, task sheets, and daily notes with original data intact', async () => {
    const tRes = await db
      .prepare("INSERT INTO tickets (title, description, created_by, project_id) VALUES ('Work Ticket', '', ?, ?)")
      .run(ownerId, projectId);
    const tid = tRes.lastInsertRowid;

    // Create employee work log with 150 minutes
    const ewlRes = await db
      .prepare(`INSERT INTO employee_work_logs (
        employee_id, user_id, work_date, entry_type, category_code, duration_minutes, work_description, source_type, source_id, ticket_id
      ) VALUES (?, ?, '2026-11-19', 'ticket_work', 'development', 150, 'Built deletion feature', 'task_sheet', 101, ?)`)
      .run(employeeId, empUserId, tid);
    const ewlId = ewlRes.lastInsertRowid;

    // Create task sheet submission
    const tssRes = await db
      .prepare(`INSERT INTO task_sheet_submissions (
        submitted_by, name, project, hours_worked, task_title, task_description, task_state, linked_ticket_id
      ) VALUES (?, 'Test Emp', 'Test Project', 2.5, 'Task Title', 'Task Desc', 'completed', ?)`)
      .run(empUserId, tid);
    const tssId = tssRes.lastInsertRowid;

    // Create daily employee note
    const denRes = await db
      .prepare(`INSERT INTO daily_employee_notes (
        employee_id, user_id, work_date, ticket_id, body
      ) VALUES (?, ?, '2026-11-19', ?, 'Daily note content')`)
      .run(employeeId, empUserId, tid);
    const denId = denRes.lastInsertRowid;

    // Delete ticket
    await deleteTicket(tid);

    // Verify employee_work_logs: record still exists, hours and description preserved, ticket_id is null
    const ewl = await db.prepare('SELECT * FROM employee_work_logs WHERE id = ?').get(ewlId);
    assert.ok(ewl);
    assert.equal(ewl.ticket_id, null);
    assert.equal(ewl.duration_minutes, 150);
    assert.equal(ewl.work_description, 'Built deletion feature');
    assert.equal(ewl.category_code, 'development');

    // Verify task_sheet_submissions: record still exists, hours and title preserved, linked_ticket_id is null
    const tss = await db.prepare('SELECT * FROM task_sheet_submissions WHERE id = ?').get(tssId);
    assert.ok(tss);
    assert.equal(tss.linked_ticket_id, null);
    assert.equal(tss.hours_worked, 2.5);
    assert.equal(tss.task_title, 'Task Title');

    // Verify daily_employee_notes: record still exists, body preserved, ticket_id is null
    const den = await db.prepare('SELECT * FROM daily_employee_notes WHERE id = ?').get(denId);
    assert.ok(den);
    assert.equal(den.ticket_id, null);
    assert.equal(den.body, 'Daily note content');
  });

  await t.test('4. Direct rogue deletion of ticket_stage_history without ticket deletion is blocked by trigger', async () => {
    const tRes = await db
      .prepare("INSERT INTO tickets (title, description, created_by, project_id) VALUES ('Audit Ticket', '', ?, ?)")
      .run(ownerId, projectId);
    const tid = tRes.lastInsertRowid;

    const shRes = await db
      .prepare("INSERT INTO ticket_stage_history (ticket_id, project_id, transition_seq, from_status, to_status, entry_at) VALUES (?, ?, 1, NULL, 'open', datetime('now'))")
      .run(tid, projectId);
    const shId = shRes.lastInsertRowid;

    // Direct deletion attempt must trigger SQLite RAISE(ABORT)
    await assert.rejects(async () => {
      await db.prepare('DELETE FROM ticket_stage_history WHERE id = ?').run(shId);
    }, /ticket_stage_history rows cannot be deleted/);
  });

  await t.test('5. RBAC strictly enforces that only Admin and Owner can delete tickets', async () => {
    const tRes = await db
      .prepare("INSERT INTO tickets (title, description, created_by, project_id) VALUES ('RBAC Ticket', '', ?, ?)")
      .run(ownerId, projectId);
    const tid = tRes.lastInsertRowid;

    // Unauthenticated
    globalThis.__TEST_COOKIES__ = {};
    const unauthReq = new Request(`http://localhost/api/tickets/${tid}`, { method: 'DELETE' });
    const unauthRes = await deleteTicketRoute(unauthReq, { params: Promise.resolve({ id: String(tid) }) });
    assert.equal(unauthRes.status, 401);

    // Employee
    globalThis.__TEST_COOKIES__ = { ticket_session: empToken };
    const empReq = new Request(`http://localhost/api/tickets/${tid}`, { method: 'DELETE' });
    const empRes = await deleteTicketRoute(empReq, { params: Promise.resolve({ id: String(tid) }) });
    assert.equal(empRes.status, 403);
    const empBody = await empRes.json();
    assert.match(empBody.error, /Only Business Owners or Administrators can delete/);

    // Client
    globalThis.__TEST_COOKIES__ = { ticket_session: clientToken };
    const clientReq = new Request(`http://localhost/api/tickets/${tid}`, { method: 'DELETE' });
    const clientRes = await deleteTicketRoute(clientReq, { params: Promise.resolve({ id: String(tid) }) });
    assert.equal(clientRes.status, 403);

    // Owner succeeds
    globalThis.__TEST_COOKIES__ = { ticket_session: ownerToken };
    const ownerReq = new Request(`http://localhost/api/tickets/${tid}`, { method: 'DELETE' });
    const ownerRes = await deleteTicketRoute(ownerReq, { params: Promise.resolve({ id: String(tid) }) });
    assert.equal(ownerRes.status, 200);
  });

  await t.test('6. PostgreSQL Migration & DDL Dialect Verification', async () => {
    // 1. Verify db/migrations/20261120_fix_ticket_deletion.sql syntax and safety
    const migrationPath = path.resolve(ROOT_DIR, 'db/migrations/20261120_fix_ticket_deletion.sql');
    assert.ok(fs.existsSync(migrationPath), 'PostgreSQL migration file must exist');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    assert.ok(migrationSql.includes('BEGIN;'), 'Migration must be wrapped in atomic transaction');
    assert.ok(migrationSql.includes('COMMIT;'), 'Migration must end with COMMIT');
    assert.ok(migrationSql.includes('SET LOCAL lock_timeout'), 'Migration must set lock_timeout');
    assert.ok(migrationSql.includes("current_setting('serphawk.allow_ticket_deletion', true) = 'on'"), 'Migration must check transaction-scoped bypass');
    assert.ok(migrationSql.includes('CREATE OR REPLACE FUNCTION fn_tsh_immutable_guard()'), 'Migration must update function');

    // 2. Verify monitoring360Schema.js PostgreSQL DDL
    const schemaModulePath = path.resolve(ROOT_DIR, 'lib/migrations/monitoring360Schema.js');
    const schemaContent = fs.readFileSync(schemaModulePath, 'utf8');
    assert.ok(schemaContent.includes("current_setting('serphawk.allow_ticket_deletion', true) = 'on'"), 'monitoring360Schema must include PostgreSQL bypass');
    assert.ok(schemaContent.includes('active_ticket_deletions'), 'monitoring360Schema must include SQLite active_ticket_deletions table');
  });
});
