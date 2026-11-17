import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_DB_PATH = path.resolve(ROOT_DIR, 'data/test_phase5_ticket_closure_isolated.db');

for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
}

// Load .env.local if present
const envLocalPath = path.resolve(ROOT_DIR, '.env.local');
if (fs.existsSync(envLocalPath)) {
  try {
    process.loadEnvFile(envLocalPath);
  } catch {}
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'test-github-token-12345';
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;

// Mock GitHub API responses for deterministic, offline testing
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const urlStr = String(url);
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/23')) {
    return new Response(
      JSON.stringify({
        id: 23,
        number: 23,
        title: 'PR 23 Merged Feature',
        state: 'closed',
        merged: true,
        merged_at: '2026-03-01T12:00:00Z',
        html_url: 'https://github.com/serphawk22/ticketing/pull/23',
        head: { ref: 'feature/pr23', sha: 'sha23' },
        base: { ref: 'main' },
        user: { login: 'serphawk22' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/999')) {
    return new Response(
      JSON.stringify({
        id: 999,
        number: 999,
        title: 'PR 999 Unmerged Work',
        state: 'open',
        merged: false,
        merged_at: null,
        html_url: 'https://github.com/serphawk22/ticketing/pull/999',
        head: { ref: 'feature/pr999', sha: 'sha999' },
        base: { ref: 'main' },
        user: { login: 'serphawk22' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/888')) {
    // 503 outage simulation
    return new Response(
      JSON.stringify({ message: 'GitHub Service Unavailable (503)' }),
      { status: 503, headers: { 'content-type': 'application/json' } }
    );
  }
  return originalFetch(url, options);
};

// Register ESM loader hook to test real Next.js route handlers
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
const { PATCH: patchTicketRoute } = await import('../app/api/tickets/[id]/route.js');
const { getTicket } = await import('../lib/tickets.js');
const { createTicketWithStage } = await import('../lib/ticketStageService.js');
const { createProjectRepository } = await import('../lib/projectRepositories.js');
const { assertCanCloseTicket } = await import('../lib/rbac.js');

after(() => {
  globalThis.__TEST_COOKIES__ = undefined;
  try {
    db.close();
  } catch {}
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
  }
});

let ownerUserId;
let ownerToken;
let dev1UserId;
let dev1EmpId;
let dev1Token;
let dev2UserId;
let dev2EmpId;
let dev2Token;
let clientUserId;
let clientToken;

let testProjectId;
let testRepo;

async function createSessionForUser(userId) {
  const token = `tok-${userId}-${crypto.randomUUID()}`;
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, Date.now() + 60 * 60 * 1000);
  return token;
}

test('0. Setup test fixtures (users, employees, project, repository)', async () => {
  // 1. Owner
  const ownerRes = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('owner@serphawk.local', 'Owner User', 'admin', 'hash')"
  ).run();
  ownerUserId = Number(ownerRes.lastInsertRowid);
  ownerToken = await createSessionForUser(ownerUserId);

  // 2. Dev 1
  const dev1Res = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('dev1@serphawk.local', 'Dev One', 'developer', 'hash')"
  ).run();
  dev1UserId = Number(dev1Res.lastInsertRowid);
  const dev1EmpRes = await db.prepare(
    "INSERT INTO employees (name, email, role, active, user_id) VALUES ('Dev One', 'dev1@serphawk.local', 'developer', 1, ?)"
  ).run(dev1UserId);
  dev1EmpId = Number(dev1EmpRes.lastInsertRowid);
  dev1Token = await createSessionForUser(dev1UserId);

  // 3. Dev 2
  const dev2Res = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('dev2@serphawk.local', 'Dev Two', 'developer', 'hash')"
  ).run();
  dev2UserId = Number(dev2Res.lastInsertRowid);
  const dev2EmpRes = await db.prepare(
    "INSERT INTO employees (name, email, role, active, user_id) VALUES ('Dev Two', 'dev2@serphawk.local', 'developer', 1, ?)"
  ).run(dev2UserId);
  dev2EmpId = Number(dev2EmpRes.lastInsertRowid);
  dev2Token = await createSessionForUser(dev2UserId);

  // 4. Client
  const clientRes = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('client@client.local', 'Client User', 'client', 'hash')"
  ).run();
  clientUserId = Number(clientRes.lastInsertRowid);
  clientToken = await createSessionForUser(clientUserId);

  // 5. Project & Repository
  const projRes = await db.prepare(
    "INSERT INTO projects (key, name, description, color, github_repo) VALUES ('CLO', 'Closure Project', 'Testing closure', '#0c66e4', 'serphawk22/ticketing')"
  ).run();
  testProjectId = Number(projRes.lastInsertRowid);

  testRepo = await createProjectRepository({
    projectId: testProjectId,
    owner: 'serphawk22',
    repo: 'ticketing',
    verificationStatus: 'verified',
    createdBy: ownerUserId,
  });

  assert.ok(ownerUserId > 0);
  assert.ok(dev1UserId > 0);
  assert.ok(testRepo.id > 0);
});

test('Case A: Legacy ticket without PR closes normally without GitHub verification', async () => {
  const legacyTicket = await createTicketWithStage({
    title: 'Legacy ticket without PR',
    description: 'Legacy ticket created without PR or repo',
    createdBy: dev1UserId,
    projectId: testProjectId,
    repositoryId: null,
  });

  // Assign to Dev 1
  await db.prepare('UPDATE tickets SET employee_id = ? WHERE id = ?').run(dev1EmpId, legacyTicket.id);

  globalThis.__TEST_COOKIES__ = { ticket_session: dev1Token };

  // Closure with optional reason
  const res = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${legacyTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'closed',
        closure_reason: 'Resolved via legacy direct patch without PR',
      }),
    }),
    { params: Promise.resolve({ id: String(legacyTicket.id) }) }
  );

  const resJson = await res.json();
  if (res.status !== 200) console.error('Case B Error:', resJson);
  assert.equal(res.status, 200);
  const updated = await getTicket(legacyTicket.id);
  assert.equal(updated.status, 'closed');
  assert.ok(!updated.pr_url);

  // Activity log check
  const activity = await db.prepare(
    "SELECT * FROM ticket_activity WHERE ticket_id = ? AND field = 'status' AND to_value = 'closed' ORDER BY id DESC LIMIT 1"
  ).get(legacyTicket.id);

  assert.ok(activity, 'Status change activity record must exist');
  assert.equal(activity.reason, 'Resolved via legacy direct patch without PR');
  assert.equal(activity.blocker, 'Legacy ticket / No Pull Request linked');
});

test('Case B: Ticket with verified merged PR allows normal closure without mandatory reason', async () => {
  const ticketB = await createTicketWithStage({
    title: 'Ticket with merged PR',
    description: 'Work verified in PR #23',
    createdBy: dev1UserId,
    projectId: testProjectId,
    repositoryId: testRepo.id,
  });

  // Assign to Dev 1, set resolved with PR #23
  await db.prepare(`
    UPDATE tickets 
    SET employee_id = ?, status = 'resolved', pr_url = 'https://github.com/serphawk22/ticketing/pull/23',
        github_pr_number = 23, github_pr_state = 'closed', github_pr_merged = 1
    WHERE id = ?
  `).run(dev1EmpId, ticketB.id);

  globalThis.__TEST_COOKIES__ = { ticket_session: dev1Token };

  // Close ticket without reason (should succeed because PR is verified merged)
  const res = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${ticketB.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'closed',
      }),
    }),
    { params: Promise.resolve({ id: String(ticketB.id) }) }
  );

  const resJson = await res.json();
  if (res.status !== 200) console.error('Case B Error:', resJson);
  assert.equal(res.status, 200);
  const updated = await getTicket(ticketB.id);
  assert.equal(updated.status, 'closed');
  assert.equal(updated.github_pr_merged, 1);

  // Check activity feed recorded verified merged
  const activity = await db.prepare(
    "SELECT * FROM ticket_activity WHERE ticket_id = ? AND field = 'status' AND to_value = 'closed' ORDER BY id DESC LIMIT 1"
  ).get(ticketB.id);

  assert.ok(activity);
  assert.match(activity.blocker, /verified merged/i);
});

test('Case C: Ticket with unmerged PR requires mandatory closure reason', async () => {
  const ticketC = await createTicketWithStage({
    title: 'Ticket with unmerged PR',
    description: 'Work done but PR unmerged',
    createdBy: dev1UserId,
    projectId: testProjectId,
    repositoryId: testRepo.id,
  });

  // Set resolved with an unmerged PR
  await db.prepare(`
    UPDATE tickets 
    SET employee_id = ?, status = 'resolved', pr_url = 'https://github.com/serphawk22/ticketing/pull/999',
        github_pr_number = 999, github_pr_state = 'open', github_pr_merged = 0
    WHERE id = ?
  `).run(dev1EmpId, ticketC.id);

  globalThis.__TEST_COOKIES__ = { ticket_session: dev1Token };

  // 1. Attempt closure WITHOUT reason -> MUST FAIL with 400
  const noReasonRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${ticketC.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }),
    { params: Promise.resolve({ id: String(ticketC.id) }) }
  );

  assert.equal(noReasonRes.status, 400);
  const noReasonJson = await noReasonRes.json();
  assert.ok(noReasonJson.error.includes('Closure reason is required') || noReasonJson.code === 'UNMERGED_PR_REASON_REQUIRED' || noReasonJson.code === 'UNKNOWN_PR_STATUS_REASON_REQUIRED');

  // Verify status did NOT change
  const untouched = await getTicket(ticketC.id);
  assert.equal(untouched.status, 'resolved');

  // 2. Attempt closure with whitespace-only reason -> MUST FAIL with 400
  const wsRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${ticketC.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed', closure_reason: '   \n  \t  ' }),
    }),
    { params: Promise.resolve({ id: String(ticketC.id) }) }
  );

  assert.equal(wsRes.status, 400);

  // 3. Attempt closure WITH valid reason -> MUST SUCCEED with 200
  const validReason = 'Feature discontinued by product management; closing work item without merge.';
  const successRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${ticketC.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'closed',
        closure_reason: validReason,
      }),
    }),
    { params: Promise.resolve({ id: String(ticketC.id) }) }
  );

  assert.equal(successRes.status, 200);
  const closedTicket = await getTicket(ticketC.id);
  assert.equal(closedTicket.status, 'closed');
  assert.equal(closedTicket.resolution, validReason);

  // Activity log verifies reason and unmerged PR details
  const activity = await db.prepare(
    "SELECT * FROM ticket_activity WHERE ticket_id = ? AND field = 'status' AND to_value = 'closed' ORDER BY id DESC LIMIT 1"
  ).get(ticketC.id);

  assert.ok(activity);
  assert.equal(activity.reason, validReason);
  assert.ok(activity.blocker.includes('Unmerged') || activity.blocker.includes('PR'));
});

test('Case D: Ticket with unknown PR merge status requires mandatory reason and retains null', async () => {
  const ticketD = await createTicketWithStage({
    title: 'Ticket with unknown merge status',
    description: 'GitHub API outage simulation',
    createdBy: dev1UserId,
    projectId: testProjectId,
    repositoryId: testRepo.id,
  });

  // Mock PR with unknown merge status (null)
  await db.prepare(`
    UPDATE tickets 
    SET employee_id = ?, status = 'resolved', pr_url = 'https://github.com/serphawk22/ticketing/pull/888',
        github_pr_number = 888, github_pr_state = 'open', github_pr_merged = NULL
    WHERE id = ?
  `).run(dev1EmpId, ticketD.id);

  globalThis.__TEST_COOKIES__ = { ticket_session: dev1Token };

  // 1. Without reason -> REJECTED (HTTP 400)
  const failRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${ticketD.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }),
    { params: Promise.resolve({ id: String(ticketD.id) }) }
  );

  assert.equal(failRes.status, 400);

  // 2. With reason -> SUCCEEDS (HTTP 200)
  const outageReason = 'GitHub API unreachable during deployment; approved for emergency close by lead.';
  const okRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${ticketD.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'closed',
        closure_reason: outageReason,
      }),
    }),
    { params: Promise.resolve({ id: String(ticketD.id) }) }
  );

  assert.equal(okRes.status, 200);
  const closedD = await getTicket(ticketD.id);
  assert.equal(closedD.status, 'closed');
  assert.equal(closedD.github_pr_merged, null, 'Must retain null for unknown status');

  const activity = await db.prepare(
    "SELECT * FROM ticket_activity WHERE ticket_id = ? AND field = 'status' AND to_value = 'closed' ORDER BY id DESC LIMIT 1"
  ).get(ticketD.id);

  assert.ok(activity);
  assert.equal(activity.reason, outageReason);
});

test('RBAC & Server Authorization: Client and unassigned developers cannot close tickets', async () => {
  const protectedTicket = await createTicketWithStage({
    title: 'Dev 1 Ticket',
    description: 'Dev 1 own work item',
    createdBy: dev1UserId,
    projectId: testProjectId,
    repositoryId: testRepo.id,
  });
  await db.prepare('UPDATE tickets SET employee_id = ? WHERE id = ?').run(dev1EmpId, protectedTicket.id);

  // 1. Client attempt -> 403 Forbidden
  globalThis.__TEST_COOKIES__ = { ticket_session: clientToken };
  const clientRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${protectedTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }),
    { params: Promise.resolve({ id: String(protectedTicket.id) }) }
  );
  assert.equal(clientRes.status, 403);
  const clientJson = await clientRes.json();
  assert.match(clientJson.error, /Clients are not authorized/i);

  // 2. Unassigned developer Dev 2 -> 403 Forbidden
  globalThis.__TEST_COOKIES__ = { ticket_session: dev2Token };
  const dev2Res = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${protectedTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }),
    { params: Promise.resolve({ id: String(protectedTicket.id) }) }
  );
  assert.equal(dev2Res.status, 403);

  // 3. Archived ticket cannot be closed -> 400 Bad Request
  await db.prepare('UPDATE tickets SET archived = 1 WHERE id = ?').run(protectedTicket.id);
  globalThis.__TEST_COOKIES__ = { ticket_session: ownerToken };
  const archRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${protectedTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }),
    { params: Promise.resolve({ id: String(protectedTicket.id) }) }
  );
  assert.equal(archRes.status, 400);
  const archJson = await archRes.json();
  assert.match(archJson.error, /Cannot close an archived ticket/i);
});

test('Strict Optimistic Concurrency: Rejects closure when ticket state modified concurrently', async () => {
  const concTicket = await createTicketWithStage({
    title: 'Concurrency ticket',
    description: 'Testing concurrency guards',
    createdBy: dev1UserId,
    projectId: testProjectId,
    repositoryId: testRepo.id,
  });
  await db.prepare("UPDATE tickets SET employee_id = ?, status = 'resolved' WHERE id = ?").run(dev1EmpId, concTicket.id);

  globalThis.__TEST_COOKIES__ = { ticket_session: dev1Token };

  // 1. Status conflict: expected "in_progress", but current is "resolved"
  const conflictRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${concTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'closed',
        expected_status: 'in_progress', // stale status
      }),
    }),
    { params: Promise.resolve({ id: String(concTicket.id) }) }
  );
  assert.equal(conflictRes.status, 409);
  const conflictJson = await conflictRes.json();
  assert.match(conflictJson.error, /Ticket status changed concurrently/i);

  // 2. PR URL conflict: expected "old_pr", current is null
  const prConflictRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${concTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'closed',
        expected_status: 'resolved',
        expected_pr_url: 'https://github.com/serphawk22/ticketing/pull/999',
      }),
    }),
    { params: Promise.resolve({ id: String(concTicket.id) }) }
  );
  assert.equal(prConflictRes.status, 409);
  const prConflictJson = await prConflictRes.json();
  assert.match(prConflictJson.error, /Ticket PR URL changed concurrently/i);

  // 3. Repository conflict: expected repo 9999, current is testRepo.id
  const repoConflictRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${concTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'closed',
        expected_status: 'resolved',
        expected_repository_id: 9999,
      }),
    }),
    { params: Promise.resolve({ id: String(concTicket.id) }) }
  );
  assert.equal(repoConflictRes.status, 409);
  const repoConflictJson = await repoConflictRes.json();
  assert.match(repoConflictJson.error, /Ticket repository changed concurrently/i);
});

test('Read-Only GitHub Rule Verification: GitHub API calls are strictly read-only (GET)', async () => {
  let writeAttempted = false;
  const oldFetch = globalThis.fetch;
  const monitoringFetch = async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && String(url).includes('api.github.com')) {
      writeAttempted = true;
    }
    return oldFetch(url, options);
  };

  globalThis.fetch = monitoringFetch;

  try {
    const ticketRO = await createTicketWithStage({
      title: 'Read-only audit ticket',
      description: 'Verifying no write requests to GitHub',
      createdBy: dev1UserId,
      projectId: testProjectId,
      repositoryId: testRepo.id,
    });
    await db.prepare(`
      UPDATE tickets 
      SET employee_id = ?, status = 'resolved', pr_url = 'https://github.com/serphawk22/ticketing/pull/23',
          github_pr_number = 23, github_pr_state = 'closed', github_pr_merged = 1
      WHERE id = ?
    `).run(dev1EmpId, ticketRO.id);

    globalThis.__TEST_COOKIES__ = { ticket_session: dev1Token };
    const res = await patchTicketRoute(
      new Request(`http://localhost/api/tickets/${ticketRO.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      }),
      { params: Promise.resolve({ id: String(ticketRO.id) }) }
    );
    assert.equal(res.status, 200);
    assert.equal(writeAttempted, false, 'SerpHawk application must NEVER execute write operations against GitHub');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

