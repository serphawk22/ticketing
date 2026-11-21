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

// Mock GitHub API responses for deterministic, offline testing across all scenarios
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const urlStr = String(url);

  // Confirmed merged PR
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

  // Confirmed unmerged PR
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

  // HTTP 401 Auth failure
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/401')) {
    return new Response(
      JSON.stringify({ message: 'Bad credentials' }),
      { status: 401, headers: { 'content-type': 'application/json' } }
    );
  }

  // HTTP 403 Rate limit
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/403')) {
    return new Response(
      JSON.stringify({ message: 'API rate limit exceeded' }),
      { status: 403, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '0' } }
    );
  }

  // HTTP 404 Missing PR / private repo
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/404')) {
    return new Response(
      JSON.stringify({ message: 'Not Found' }),
      { status: 404, headers: { 'content-type': 'application/json' } }
    );
  }

  // HTTP 429 Too many requests
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/429')) {
    return new Response(
      JSON.stringify({ message: 'Too Many Requests' }),
      { status: 429, headers: { 'content-type': 'application/json' } }
    );
  }

  // HTTP 500 / 502 / 503 Server errors
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/500')) {
    return new Response(
      JSON.stringify({ message: 'Internal Server Error' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/502')) {
    return new Response(
      JSON.stringify({ message: 'Bad Gateway' }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/503')) {
    return new Response(
      JSON.stringify({ message: 'Service Unavailable' }),
      { status: 503, headers: { 'content-type': 'application/json' } }
    );
  }

  // Network timeout
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/701')) {
    throw new Error('Connection timed out');
  }

  // Network connection failure
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/702')) {
    throw new Error('fetch failed: ECONNREFUSED');
  }

  // Malformed API response
  if (urlStr.includes('/repos/serphawk22/ticketing/pulls/703')) {
    return new Response('{ malformed json response not valid syntax !!!', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
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
let managerUserId;
let managerEmpId;
let managerToken;
let dev1UserId;
let dev1EmpId;
let dev1Token;
let dev2UserId;
let dev2EmpId;
let dev2Token;
let clientUserId;
let clientToken;

let testProjectId;
let otherProjectId;
let testRepo;
let deactRepo;

async function createSessionForUser(userId) {
  const token = `tok-${userId}-${crypto.randomUUID()}`;
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, Date.now() + 60 * 60 * 1000);
  return token;
}

test('0. Setup test fixtures (users, employees, projects, repositories)', async () => {
  // 1. Owner
  const ownerRes = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('owner@serphawk.local', 'Owner User', 'admin', 'hash')"
  ).run();
  ownerUserId = Number(ownerRes.lastInsertRowid);
  ownerToken = await createSessionForUser(ownerUserId);

  // 2. Manager
  const mgrRes = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('mgr@serphawk.local', 'Manager User', 'manager', 'hash')"
  ).run();
  managerUserId = Number(mgrRes.lastInsertRowid);
  const mgrEmpRes = await db.prepare(
    "INSERT INTO employees (name, email, role, active, user_id) VALUES ('Manager User', 'mgr@serphawk.local', 'manager', 1, ?)"
  ).run(managerUserId);
  managerEmpId = Number(mgrEmpRes.lastInsertRowid);
  managerToken = await createSessionForUser(managerUserId);

  // 3. Dev 1
  const dev1Res = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('dev1@serphawk.local', 'Dev One', 'developer', 'hash')"
  ).run();
  dev1UserId = Number(dev1Res.lastInsertRowid);
  const dev1EmpRes = await db.prepare(
    "INSERT INTO employees (name, email, role, active, user_id) VALUES ('Dev One', 'dev1@serphawk.local', 'developer', 1, ?)"
  ).run(dev1UserId);
  dev1EmpId = Number(dev1EmpRes.lastInsertRowid);
  dev1Token = await createSessionForUser(dev1UserId);

  // 4. Dev 2
  const dev2Res = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('dev2@serphawk.local', 'Dev Two', 'developer', 'hash')"
  ).run();
  dev2UserId = Number(dev2Res.lastInsertRowid);
  const dev2EmpRes = await db.prepare(
    "INSERT INTO employees (name, email, role, active, user_id) VALUES ('Dev Two', 'dev2@serphawk.local', 'developer', 1, ?)"
  ).run(dev2UserId);
  dev2EmpId = Number(dev2EmpRes.lastInsertRowid);
  dev2Token = await createSessionForUser(dev2UserId);

  // 5. Client
  const clientRes = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('client@client.local', 'Client User', 'client', 'hash')"
  ).run();
  clientUserId = Number(clientRes.lastInsertRowid);
  clientToken = await createSessionForUser(clientUserId);

  // 6. Project & Repository
  const projRes = await db.prepare(
    "INSERT INTO projects (key, name, description, color, github_repo) VALUES ('CLO', 'Closure Project', 'Testing closure', '#0c66e4', 'serphawk22/ticketing')"
  ).run();
  testProjectId = Number(projRes.lastInsertRowid);

  const otherProjRes = await db.prepare(
    "INSERT INTO projects (key, name, description, color) VALUES ('OTH', 'Other Project', 'Other', '#ff9900')"
  ).run();
  otherProjectId = Number(otherProjRes.lastInsertRowid);

  // Add Manager to testProjectId
  await db.prepare(
    "INSERT INTO project_members (project_id, employee_id, project_role, is_active) VALUES (?, ?, 'manager', 1)"
  ).run(testProjectId, managerEmpId);

  testRepo = await createProjectRepository({
    projectId: testProjectId,
    owner: 'serphawk22',
    repo: 'ticketing',
    verificationStatus: 'verified',
    createdBy: ownerUserId,
  });

  deactRepo = await createProjectRepository({
    projectId: testProjectId,
    owner: 'serphawk22',
    repo: 'deactivated-service',
    verificationStatus: 'verified',
    createdBy: ownerUserId,
  });
  await db.prepare('UPDATE project_repositories SET is_active = 0 WHERE id = ?').run(deactRepo.id);

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

  await db.prepare(`
    UPDATE tickets 
    SET employee_id = ?, status = 'resolved', pr_url = 'https://github.com/serphawk22/ticketing/pull/999',
        github_pr_number = 999, github_pr_state = 'open', github_pr_merged = 0
    WHERE id = ?
  `).run(dev1EmpId, ticketC.id);

  globalThis.__TEST_COOKIES__ = { ticket_session: dev1Token };

  // 1. Direct API call WITHOUT reason -> MUST FAIL with 400
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
  assert.equal(noReasonJson.code, 'UNMERGED_PR_REASON_REQUIRED');

  // Verify status did NOT change
  const untouched = await getTicket(ticketC.id);
  assert.equal(untouched.status, 'resolved');

  // 2. Direct API call with whitespace-only reason -> MUST FAIL with 400
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
  assert.ok(activity.blocker.includes('Unmerged'));
});

test('Case D & Error Classifications: Thoroughly tests 401, 403, 404, 429, 500, 502, 503, timeout, network error, and malformed response', async () => {
  const errorPrCases = [
    { code: '401', prNumber: 401, desc: 'HTTP 401 Auth Failure' },
    { code: '403', prNumber: 403, desc: 'HTTP 403 Rate Limit / Forbidden' },
    { code: '404', prNumber: 404, desc: 'HTTP 404 Missing PR' },
    { code: '429', prNumber: 429, desc: 'HTTP 429 Rate Limit' },
    { code: '500', prNumber: 500, desc: 'HTTP 500 Internal Server Error' },
    { code: '502', prNumber: 502, desc: 'HTTP 502 Bad Gateway' },
    { code: '503', prNumber: 503, desc: 'HTTP 503 Service Unavailable' },
    { code: '701', prNumber: 701, desc: 'Network Timeout' },
    { code: '702', prNumber: 702, desc: 'Network Connection Failure' },
    { code: '703', prNumber: 703, desc: 'Malformed API Response' },
  ];

  for (const tc of errorPrCases) {
    const ticket = await createTicketWithStage({
      title: `Error test ${tc.desc}`,
      description: `Testing failure mode ${tc.desc}`,
      createdBy: dev1UserId,
      projectId: testProjectId,
      repositoryId: testRepo.id,
    });

    const prUrl = `https://github.com/serphawk22/ticketing/pull/${tc.prNumber}`;
    await db.prepare(`
      UPDATE tickets 
      SET employee_id = ?, status = 'resolved', pr_url = ?,
          github_pr_number = ?, github_pr_title = 'Original Title', github_branch = 'feature/orig', github_pr_merged = NULL
      WHERE id = ?
    `).run(dev1EmpId, prUrl, tc.prNumber, ticket.id);

    globalThis.__TEST_COOKIES__ = { ticket_session: dev1Token };

    // 1. Without reason -> Must be rejected with 400 UNKNOWN_PR_STATUS_REASON_REQUIRED
    const failRes = await patchTicketRoute(
      new Request(`http://localhost/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      }),
      { params: Promise.resolve({ id: String(ticket.id) }) }
    );

    assert.equal(failRes.status, 400, `${tc.desc} without reason must be rejected`);
    const failJson = await failRes.json();
    assert.equal(failJson.code, 'UNKNOWN_PR_STATUS_REASON_REQUIRED');

    // 2. With whitespace-only reason -> Must also be rejected
    const wsRes = await patchTicketRoute(
      new Request(`http://localhost/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed', closure_reason: '     ' }),
      }),
      { params: Promise.resolve({ id: String(ticket.id) }) }
    );
    assert.equal(wsRes.status, 400);

    // 3. With valid reason -> Must succeed and preserve last known PR metadata
    const reasonText = `Approved close despite ${tc.desc} by QA Lead`;
    const okRes = await patchTicketRoute(
      new Request(`http://localhost/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'closed',
          closure_reason: reasonText,
        }),
      }),
      { params: Promise.resolve({ id: String(ticket.id) }) }
    );

    assert.equal(okRes.status, 200, `${tc.desc} with valid reason must succeed`);
    const closed = await getTicket(ticket.id);
    assert.equal(closed.status, 'closed');
    assert.equal(closed.github_pr_merged, null, 'Must retain null for unknown merge status');
    assert.equal(closed.pr_url, prUrl, 'Must preserve original pr_url');
    assert.equal(closed.github_pr_title, 'Original Title', 'Must preserve original title');
    assert.equal(closed.github_branch, 'feature/orig', 'Must preserve original branch');

    const activity = await db.prepare(
      "SELECT * FROM ticket_activity WHERE ticket_id = ? AND field = 'status' AND to_value = 'closed' ORDER BY id DESC LIMIT 1"
    ).get(ticket.id);

    assert.ok(activity);
    assert.equal(activity.reason, reasonText);
    assert.match(activity.blocker, /GitHub PR Verification Failed/i);
    // Ensure no secrets/tokens leaked in activity record
    assert.doesNotMatch(activity.blocker, /ghp_|github_pat_|Bearer/i);
  }
});

test('Direct API Rejections: Rejects invalid PR URL format, cross-repo mismatch, and deactivated repo', async () => {
  const directTicket = await createTicketWithStage({
    title: 'Direct API rejection test',
    description: 'Testing validation rejections',
    createdBy: dev1UserId,
    projectId: testProjectId,
    repositoryId: testRepo.id,
  });
  await db.prepare("UPDATE tickets SET employee_id = ?, status = 'resolved' WHERE id = ?").run(dev1EmpId, directTicket.id);

  globalThis.__TEST_COOKIES__ = { ticket_session: dev1Token };

  // 1. Invalid PR URL format
  const badFormatRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${directTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'closed',
        pr_url: 'https://github.com/serphawk22/ticketing/issues/10',
        closure_reason: 'Testing bad URL',
      }),
    }),
    { params: Promise.resolve({ id: String(directTicket.id) }) }
  );
  assert.equal(badFormatRes.status, 400);
  const badFormatJson = await badFormatRes.json();
  assert.equal(badFormatJson.code, 'INVALID_PR_URL');

  // 2. Cross-repository mismatch (PR from other repo)
  const crossRepoRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${directTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'closed',
        pr_url: 'https://github.com/serphawk22/other-service/pull/23',
        closure_reason: 'Testing cross repo',
      }),
    }),
    { params: Promise.resolve({ id: String(directTicket.id) }) }
  );
  assert.equal(crossRepoRes.status, 400);
  const crossRepoJson = await crossRepoRes.json();
  assert.equal(crossRepoJson.code, 'REPOSITORY_MISMATCH');

  // 3. Deactivated repository
  await db.prepare('UPDATE tickets SET repository_id = ?, pr_url = ? WHERE id = ?').run(
    deactRepo.id,
    'https://github.com/serphawk22/deactivated-service/pull/1',
    directTicket.id
  );
  const deactRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${directTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'closed',
        closure_reason: 'Testing deactivated repo',
      }),
    }),
    { params: Promise.resolve({ id: String(directTicket.id) }) }
  );
  assert.equal(deactRes.status, 400);
  const deactJson = await deactRes.json();
  assert.match(deactJson.error, /deactivated/i);
});

test('RBAC & Server Authorization: Full role audit (Client, Unauthorized Dev, Scoped Manager, Creator, Admin, Archived)', async () => {
  const tAuth = await createTicketWithStage({
    title: 'Auth audit ticket',
    description: 'Testing closure authorization',
    createdBy: dev1UserId,
    projectId: testProjectId,
    repositoryId: testRepo.id,
  });
  await db.prepare('UPDATE tickets SET employee_id = ? WHERE id = ?').run(dev1EmpId, tAuth.id);

  // 1. Unauthenticated -> 401
  globalThis.__TEST_COOKIES__ = {};
  const unauthRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${tAuth.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }),
    { params: Promise.resolve({ id: String(tAuth.id) }) }
  );
  assert.equal(unauthRes.status, 401);

  // 2. Client attempt -> 403
  globalThis.__TEST_COOKIES__ = { ticket_session: clientToken };
  const clientRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${tAuth.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }),
    { params: Promise.resolve({ id: String(tAuth.id) }) }
  );
  assert.equal(clientRes.status, 403);
  const clientJson = await clientRes.json();
  assert.match(clientJson.error, /Clients are not authorized/i);

  // 3. Unauthorized developer Dev 2 -> 403
  globalThis.__TEST_COOKIES__ = { ticket_session: dev2Token };
  const dev2Res = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${tAuth.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }),
    { params: Promise.resolve({ id: String(tAuth.id) }) }
  );
  assert.equal(dev2Res.status, 403);

  // 4. Scoped Manager inside project scope -> 200
  globalThis.__TEST_COOKIES__ = { ticket_session: managerToken };
  const mgrRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${tAuth.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed', closure_reason: 'Closed by project manager' }),
    }),
    { params: Promise.resolve({ id: String(tAuth.id) }) }
  );
  assert.equal(mgrRes.status, 200);

  // 5. Manager OUTSIDE project scope -> 403
  const outProjTicket = await createTicketWithStage({
    title: 'Outside project ticket',
    description: 'Project OTH has no manager',
    createdBy: dev2UserId,
    projectId: otherProjectId,
    repositoryId: null,
  });
  await db.prepare('UPDATE tickets SET employee_id = ? WHERE id = ?').run(dev2EmpId, outProjTicket.id);

  const outMgrRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${outProjTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }),
    { params: Promise.resolve({ id: String(outProjTicket.id) }) }
  );
  assert.equal(outMgrRes.status, 403);

  // 6. Ticket Creator Dev 2 can close their own created ticket -> 200
  globalThis.__TEST_COOKIES__ = { ticket_session: dev2Token };
  const creatorRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${outProjTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }),
    { params: Promise.resolve({ id: String(outProjTicket.id) }) }
  );
  assert.equal(creatorRes.status, 200);

  // 7. Archived ticket cannot be closed even by Admin -> 400
  await db.prepare('UPDATE tickets SET archived = 1 WHERE id = ?').run(tAuth.id);
  globalThis.__TEST_COOKIES__ = { ticket_session: ownerToken };
  const archRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${tAuth.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }),
    { params: Promise.resolve({ id: String(tAuth.id) }) }
  );
  assert.equal(archRes.status, 400);
  const archJson = await archRes.json();
  assert.match(archJson.error, /Cannot close an archived ticket/i);
});

test('Strict Optimistic Concurrency & Atomic Rollback: No partial writes on conflict', async () => {
  const concTicket = await createTicketWithStage({
    title: 'Concurrency ticket',
    description: 'Testing concurrency guards',
    createdBy: dev1UserId,
    projectId: testProjectId,
    repositoryId: testRepo.id,
  });
  await db.prepare("UPDATE tickets SET employee_id = ?, status = 'resolved' WHERE id = ?").run(dev1EmpId, concTicket.id);

  globalThis.__TEST_COOKIES__ = { ticket_session: dev1Token };

  // Status conflict: expected "in_progress", but current is "resolved"
  const conflictRes = await patchTicketRoute(
    new Request(`http://localhost/api/tickets/${concTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'closed',
        expected_status: 'in_progress', // stale status
        closure_reason: 'Conflict attempt',
      }),
    }),
    { params: Promise.resolve({ id: String(concTicket.id) }) }
  );
  assert.equal(conflictRes.status, 409);
  const conflictJson = await conflictRes.json();
  assert.match(conflictJson.error, /Ticket status changed concurrently/i);

  // Verify atomic rollback: no status update and NO activity record inserted
  const checkTicket = await getTicket(concTicket.id);
  assert.equal(checkTicket.status, 'resolved');

  const checkActivity = await db.prepare(
    "SELECT COUNT(*) AS cnt FROM ticket_activity WHERE ticket_id = ? AND reason = 'Conflict attempt'"
  ).get(concTicket.id);
  assert.equal(checkActivity.cnt, 0, 'No partial activity record must be committed on 409 rollback');

  // PR URL conflict: expected "old_pr", current is null
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

  // Repository conflict: expected repo 9999, current is testRepo.id
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
