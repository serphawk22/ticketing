import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ROOT_DIR = process.cwd();
const TEST_DB_PATH = path.resolve(ROOT_DIR, 'data', 'test_phase6_real_http.db');
let BASE_URL = '';

// Clean any previous test database files
for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch {}
  }
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.GITHUB_TOKEN = 'test-phase6-token';
process.env.NEXT_TELEMETRY_DISABLED = '1';
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;

// Mock external GitHub API calls at the global fetch level so that Next.js Route Handlers
// executing inside the HTTP server receive deterministic GitHub API responses.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const urlStr = String(url);

  // If request is targeting local Next.js HTTP server, let standard fetch execute
  if (urlStr.startsWith(BASE_URL) || urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
    return originalFetch(url, options);
  }

  // Branch checks
  if (urlStr.includes('/branches/feature%2Ftest-branch') || urlStr.includes('/branches/feature/test-branch')) {
    return new Response(JSON.stringify({ name: 'feature/test-branch', commit: { sha: 'sha-branch-1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Repository accessibility
  if (urlStr.endsWith('/repos/serphawk22/repo-alpha') || urlStr.endsWith('/repos/serphawk22/repo-beta')) {
    const name = urlStr.endsWith('alpha') ? 'repo-alpha' : 'repo-beta';
    return new Response(JSON.stringify({ id: 101, name, full_name: `serphawk22/${name}`, default_branch: 'main', private: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  // PR 100 on repo-alpha (Merged)
  if (urlStr.includes('/repos/serphawk22/repo-alpha/pulls/100')) {
    return new Response(JSON.stringify({
      id: 100,
      number: 100,
      title: 'PR 100 Alpha Merged',
      state: 'closed',
      merged: true,
      merged_at: '2026-03-01T12:00:00Z',
      html_url: 'https://github.com/serphawk22/repo-alpha/pull/100',
      head: { ref: 'feature/alpha-100', sha: 'sha100' },
      base: { ref: 'main' },
      user: { login: 'dev' }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // PR 200 on repo-alpha (Unmerged / Open)
  if (urlStr.includes('/repos/serphawk22/repo-alpha/pulls/200')) {
    return new Response(JSON.stringify({
      id: 200,
      number: 200,
      title: 'PR 200 Alpha Unmerged',
      state: 'open',
      merged: false,
      merged_at: null,
      html_url: 'https://github.com/serphawk22/repo-alpha/pull/200',
      head: { ref: 'feature/alpha-200', sha: 'sha200' },
      base: { ref: 'main' },
      user: { login: 'dev' }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // PR 300 on repo-alpha (Unknown / 503 outage)
  if (urlStr.includes('/repos/serphawk22/repo-alpha/pulls/300')) {
    return new Response(JSON.stringify({ message: 'GitHub Service Unavailable (503)' }), {
      status: 503,
      headers: { 'content-type': 'application/json' }
    });
  }

  // PR 999 on repo-beta (for cross repo test)
  if (urlStr.includes('/repos/serphawk22/repo-beta/pulls/999')) {
    return new Response(JSON.stringify({
      id: 999,
      number: 999,
      title: 'PR 999 Beta',
      state: 'open',
      merged: false,
      merged_at: null,
      html_url: 'https://github.com/serphawk22/repo-beta/pull/999',
      head: { ref: 'feature/beta-999', sha: 'sha999' },
      base: { ref: 'main' },
      user: { login: 'dev' }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  return originalFetch(url, options);
};

let server;
let nextApp;
let adminUserId;
let adminToken;
let devUserId;
let devToken;
let clientUserId;
let clientToken;
let testProjectId;
let otherProjectId;
let repoAlphaId;
let repoBetaId;
let otherRepoId;
let testTicketId;

async function createSession(db, userId) {
  const token = `sess-${userId}-${crypto.randomUUID()}`;
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, Date.now() + 86400000);
  return token;
}

test.before(async () => {
  // Initialize database schema and fixtures
  const { db } = await import('../lib/db.js');

  // Create Users: admin, developer, client
  const adminRes = await db.prepare("INSERT INTO users (email, name, role, password) VALUES ('httpadmin@test.local', 'HTTP Admin', 'admin', 'hash')").run();
  adminUserId = Number(adminRes.lastInsertRowid);
  adminToken = await createSession(db, adminUserId);

  const devRes = await db.prepare("INSERT INTO users (email, name, role, password) VALUES ('httpdev@test.local', 'HTTP Dev', 'developer', 'hash')").run();
  devUserId = Number(devRes.lastInsertRowid);
  await db.prepare("INSERT INTO employees (name, email, role, active, user_id) VALUES ('HTTP Dev', 'httpdev@test.local', 'developer', 1, ?)").run(devUserId);
  devToken = await createSession(db, devUserId);

  const clientRes = await db.prepare("INSERT INTO users (email, name, role, password) VALUES ('httpclient@test.local', 'HTTP Client', 'client', 'hash')").run();
  clientUserId = Number(clientRes.lastInsertRowid);
  clientToken = await createSession(db, clientUserId);

  // Create Projects
  const p1 = await db.prepare("INSERT INTO projects (key, name, description, color) VALUES ('HPROJECT', 'HTTP Test Project', 'Testing real HTTP', '#0c66e4')").run();
  testProjectId = Number(p1.lastInsertRowid);

  const p2 = await db.prepare("INSERT INTO projects (key, name, description, color) VALUES ('HOTHER', 'HTTP Other Project', 'Other project', '#36b37e')").run();
  otherProjectId = Number(p2.lastInsertRowid);

  // Boot actual Next.js application on dedicated HTTP port
  const next = (await import('next')).default;
  nextApp = next({ dev: true, dir: ROOT_DIR, quiet: true });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  server = http.createServer((req, res) => handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const assignedPort = server.address().port;
  BASE_URL = `http://127.0.0.1:${assignedPort}`;
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (nextApp) {
    try { await nextApp.close(); } catch {}
  }
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(TEST_DB_PATH + ext)) {
      try { fs.unlinkSync(TEST_DB_PATH + ext); } catch {}
    }
  }
  setTimeout(() => process.exit(0), 200).unref();
});

// Helper for making typed HTTP requests
async function httpReq(path, { method = 'GET', body, token, headers = {} } = {}) {
  const reqHeaders = { ...headers };
  if (token) {
    reqHeaders['Cookie'] = `ticket_session=${token}`;
  }
  if (body) {
    reqHeaders['Content-Type'] = 'application/json';
  }
  const res = await originalFetch(`${BASE_URL}${path}`, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    json = await res.json().catch(() => null);
  }
  return { status: res.status, headers: res.headers, json };
}

test('1. Real HTTP Auth Guards: 401 Unauthenticated and 403 Forbidden', async () => {
  // Unauthenticated request (no cookie) -> 401
  const unauth = await httpReq(`/api/projects/${testProjectId}/repositories`, {
    method: 'POST',
    body: { repo: 'serphawk22/repo-alpha' },
  });
  assert.equal(unauth.status, 401, 'Request with no cookie must return HTTP 401');

  // Client role attempting to add repository -> 403
  const clientForbidden = await httpReq(`/api/projects/${testProjectId}/repositories`, {
    method: 'POST',
    token: clientToken,
    body: { repo: 'serphawk22/repo-alpha' },
  });
  assert.equal(clientForbidden.status, 403, 'Client role must return HTTP 403');
});

test('2. Real HTTP: Project repository creation, case-insensitive duplicate rejection, and listing', async () => {
  // Create first repository on test project
  const create1 = await httpReq(`/api/projects/${testProjectId}/repositories`, {
    method: 'POST',
    token: adminToken,
    body: { repo: 'serphawk22/repo-alpha' },
  });
  assert.equal(create1.status, 201, 'Repository creation must return HTTP 201');
  assert.equal(create1.json.repository.github_owner, 'serphawk22');
  assert.equal(create1.json.repository.github_repo, 'repo-alpha');
  assert.equal(create1.json.repository.is_active, 1);
  repoAlphaId = create1.json.repository.id;

  // Add second repository on test project
  const create2 = await httpReq(`/api/projects/${testProjectId}/repositories`, {
    method: 'POST',
    token: adminToken,
    body: { repo: 'serphawk22/repo-beta' },
  });
  assert.equal(create2.status, 201);
  repoBetaId = create2.json.repository.id;

  // Add repository to other project
  const createOther = await httpReq(`/api/projects/${otherProjectId}/repositories`, {
    method: 'POST',
    token: adminToken,
    body: { repo: 'serphawk22/repo-beta' },
  });
  assert.equal(createOther.status, 201);
  otherRepoId = createOther.json.repository.id;

  // Exact duplicate rejection -> 409
  const dupExact = await httpReq(`/api/projects/${testProjectId}/repositories`, {
    method: 'POST',
    token: adminToken,
    body: { repo: 'serphawk22/repo-alpha' },
  });
  assert.equal(dupExact.status, 409, 'Exact duplicate must return HTTP 409');

  // Case-insensitive duplicate rejection -> 409
  const dupUpper = await httpReq(`/api/projects/${testProjectId}/repositories`, {
    method: 'POST',
    token: adminToken,
    body: { repo: 'SERPHAWK22/REPO-ALPHA' },
  });
  assert.equal(dupUpper.status, 409, 'UPPERCASE duplicate must return HTTP 409');

  const dupMixed = await httpReq(`/api/projects/${testProjectId}/repositories`, {
    method: 'POST',
    token: adminToken,
    body: { repo: 'SerpHawk22/Repo-Alpha' },
  });
  assert.equal(dupMixed.status, 409, 'MixedCase duplicate must return HTTP 409');

  // List repositories over HTTP
  const list = await httpReq(`/api/projects/${testProjectId}/repositories`, {
    token: adminToken,
  });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.repositories));
  assert.equal(list.json.repositories.length, 2);
});

test('3. Real HTTP: Repository activation and deactivation', async () => {
  // Deactivate repo-beta
  const deact = await httpReq(`/api/projects/${testProjectId}/repositories/${repoBetaId}`, {
    method: 'PATCH',
    token: adminToken,
    body: { is_active: 0 },
  });
  assert.equal(deact.status, 200);
  assert.equal(deact.json.repository.is_active, 0);

  // Active-only list excludes inactive repo
  const activeOnly = await httpReq(`/api/projects/${testProjectId}/repositories`, {
    token: adminToken,
  });
  assert.equal(activeOnly.status, 200);
  assert.equal(activeOnly.json.repositories.length, 1);
  assert.equal(activeOnly.json.repositories[0].id, repoAlphaId);

  // Reactivate repo-beta
  const react = await httpReq(`/api/projects/${testProjectId}/repositories/${repoBetaId}`, {
    method: 'PATCH',
    token: adminToken,
    body: { is_active: 1 },
  });
  assert.equal(react.status, 200);
  assert.equal(react.json.repository.is_active, 1);
});

test('4. Real HTTP: Ticket creation and cross-project repository rejection', async () => {
  // Direct DB helper to create ticket assigned to repoAlpha
  const { db } = await import('../lib/db.js');
  const tRes = await db.prepare(`
    INSERT INTO tickets (title, description, status, priority, type, created_by, project_id, repository_id)
    VALUES ('HTTP Workflow Ticket', 'Testing complete HTTP flow', 'open', 'medium', 'task', ?, ?, ?)
  `).run(devUserId, testProjectId, repoAlphaId);
  testTicketId = Number(tRes.lastInsertRowid);
  assert.ok(testTicketId > 0);

  // Attempt to assign a repository belonging to OTHER project -> 400
  const crossRepo = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: adminToken,
    body: {
      repository_id: otherRepoId,
      repository_change_reason: 'Testing cross project rejection',
    },
  });
  assert.equal(crossRepo.status, 400, 'Cross-project repository assignment must be rejected with HTTP 400');
  assert.equal(crossRepo.json.error, 'Selected repository belongs to a different project.');

  // Attempt to assign non-existent repository ID -> 404
  const nonExistentRepo = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: adminToken,
    body: {
      repository_id: 999999,
      repository_change_reason: 'Testing invalid repository ID',
    },
  });
  assert.equal(nonExistentRepo.status, 404, 'Non-existent repository must be rejected with HTTP 404');
});

test('5. Real HTTP: Branch verification and transition to in_progress', async () => {
  // Move ticket to in_progress with verified branch
  const toInProgress = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      status: 'in_progress',
      github_branch: 'feature/test-branch',
    },
  });
  assert.equal(toInProgress.status, 200);
  assert.equal(toInProgress.json.ticket.status, 'in_progress');
  assert.equal(toInProgress.json.ticket.github_branch, 'feature/test-branch');
});

test('6. Real HTTP: PR linking, cross-repository PR rejection, and transition to QA resolved', async () => {
  // Attempt to link PR belonging to different repository (repo-beta PR on repo-alpha ticket) -> 400
  const crossRepoPr = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      pr_url: 'https://github.com/serphawk22/repo-beta/pull/999',
    },
  });
  assert.equal(crossRepoPr.status, 400, 'Cross-repository PR must return HTTP 400');
  assert.equal(crossRepoPr.json.code, 'REPOSITORY_MISMATCH');

  // Link valid PR #200 (repo-alpha)
  const linkValidPr = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      pr_url: 'https://github.com/serphawk22/repo-alpha/pull/200',
    },
  });
  assert.equal(linkValidPr.status, 200);
  assert.equal(linkValidPr.json.ticket.github_pr_number, 200);
  assert.equal(linkValidPr.json.ticket.github_pr_state, 'open');

  // Transition to resolved (QA Testing) with verified PR
  const toResolved = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      status: 'resolved',
      pr_url: 'https://github.com/serphawk22/repo-alpha/pull/200',
    },
  });
  assert.equal(toResolved.status, 200);
  assert.equal(toResolved.json.ticket.status, 'resolved');
});

test('7. Real HTTP: Removing PR while resolved causes atomic revert to in_progress', async () => {
  // Clearing PR while in resolved must revert ticket to in_progress
  const removePr = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      pr_url: '',
    },
  });
  assert.equal(removePr.status, 200);
  assert.equal(removePr.json.ticket.status, 'in_progress', 'Status must revert to in_progress when PR is removed');
  assert.equal(removePr.json.ticket.pr_url, '');
  assert.equal(removePr.json.ticket.github_pr_number, null);
});

test('8. Real HTTP: Repository change clears Git metadata and reverts QA status', async () => {
  // Re-link PR and move back to resolved
  await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      status: 'resolved',
      pr_url: 'https://github.com/serphawk22/repo-alpha/pull/200',
    },
  });

  // Change ticket's repository to repo-beta
  const changeRepo = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: adminToken,
    body: {
      repository_id: repoBetaId,
      repository_change_reason: 'Switching backend service to repo-beta',
    },
  });
  assert.equal(changeRepo.status, 200);
  assert.equal(changeRepo.json.ticket.repository_id, repoBetaId);
  assert.equal(changeRepo.json.ticket.status, 'in_progress', 'Repository change must revert resolved to in_progress');
  assert.equal(changeRepo.json.ticket.pr_url, '');
  assert.equal(changeRepo.json.ticket.github_branch, '');
  assert.equal(changeRepo.json.ticket.github_pr_number, null);
  assert.equal(changeRepo.json.ticket.github_pr_merged, null);
  assert.ok(changeRepo.json.ticket.repository_changed_at);
  assert.equal(changeRepo.json.ticket.repository_change_reason, 'Switching backend service to repo-beta');

  // Change back to repo-alpha for closure tests
  await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: adminToken,
    body: {
      repository_id: repoAlphaId,
      repository_change_reason: 'Switching back to repo-alpha',
    },
  });
});

test('9. Real HTTP: Ticket closure under Merged, Unmerged, and Unknown merge states', async () => {
  // Case C: Unmerged PR (PR #200) without reason -> 400 UNMERGED_PR_REASON_REQUIRED
  await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      pr_url: 'https://github.com/serphawk22/repo-alpha/pull/200',
    },
  });

  const closeUnmergedNoReason = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      status: 'closed',
    },
  });
  assert.equal(closeUnmergedNoReason.status, 400);
  assert.equal(closeUnmergedNoReason.json.code, 'UNMERGED_PR_REASON_REQUIRED');

  // Case C: Unmerged PR with mandatory reason -> 200 Closed
  const closeUnmergedWithReason = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      status: 'closed',
      closure_reason: 'Feature cancelled by product owner; closing ticket with open PR',
    },
  });
  assert.equal(closeUnmergedWithReason.status, 200);
  assert.equal(closeUnmergedWithReason.json.ticket.status, 'closed');
  assert.equal(closeUnmergedWithReason.json.ticket.github_pr_merged, 0);

  // Reopen ticket for Case D
  await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: { status: 'in_progress' },
  });

  // Case D: Unknown / 503 outage during fresh verification on closure
  // Simulate ticket already having PR #300 linked before an outage occurred
  const { db } = await import('../lib/db.js');
  await db.prepare(
    "UPDATE tickets SET pr_url = 'https://github.com/serphawk22/repo-alpha/pull/300', github_pr_number = 300, github_pr_merged = NULL WHERE id = ?"
  ).run(testTicketId);

  // Close attempt without reason -> 400 UNKNOWN_PR_STATUS_REASON_REQUIRED
  const closeUnknownNoReason = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      status: 'closed',
    },
  });
  assert.equal(closeUnknownNoReason.status, 400);
  assert.equal(closeUnknownNoReason.json.code, 'UNKNOWN_PR_STATUS_REASON_REQUIRED');

  // Case D: Unknown with mandatory reason -> 200 Closed, preserves github_pr_merged = null
  const closeUnknownWithReason = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      status: 'closed',
      closure_reason: 'GitHub API experiencing 503 outage; manual emergency closure',
    },
  });
  assert.equal(closeUnknownWithReason.status, 200);
  assert.equal(closeUnknownWithReason.json.ticket.status, 'closed');
  assert.equal(closeUnknownWithReason.json.ticket.github_pr_merged, null);

  // Reopen ticket for Case B
  await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: { status: 'in_progress' },
  });

  // Case B: Merged PR (PR #100) -> closes normally without closure reason
  await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      pr_url: 'https://github.com/serphawk22/repo-alpha/pull/100',
    },
  });

  const closeMerged = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      status: 'closed',
    },
  });
  assert.equal(closeMerged.status, 200);
  assert.equal(closeMerged.json.ticket.status, 'closed');
  assert.equal(closeMerged.json.ticket.github_pr_merged, 1);
});

test('10. Real HTTP: Closed ticket protection rejects unauthorized mutations', async () => {
  // Ticket is currently closed. Attempting to change repository or PR without reopening
  const mutateClosed = await httpReq(`/api/tickets/${testTicketId}`, {
    method: 'PATCH',
    token: devToken,
    body: {
      pr_url: 'https://github.com/serphawk22/repo-alpha/pull/200',
    },
  });
  assert.equal(mutateClosed.status, 400, 'Mutating PR on closed ticket must be rejected with HTTP 400');
  assert.match(mutateClosed.json.error, /closed/i);
});
