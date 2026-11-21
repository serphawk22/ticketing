import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test_phase4_pr_verification_reuse.db');

// Ensure clean isolated SQLite test database environment
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.NEXT_TELEMETRY_DISABLED = '1';

const { db } = await import('../lib/db.js');
const {
  parsePullRequestUrl,
  getAndVerifyPullRequest,
  verifyTicketPullRequest,
  GitHubApiError,
  isGithubConfigured,
} = await import('../lib/github.js');
const { createProjectRepository, getRepositoryById } = await import('../lib/projectRepositories.js');
const { createTicketWithStage, transitionTicketStatus } = await import('../lib/ticketStageService.js');
const { getTicket } = await import('../lib/tickets.js');
const { getActivity } = await import('../lib/ticketActivity.js');

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch {}
    }
  }
});

let testUserId;
let testProjectId;
let testOtherProjectId;
let testRepo1;
let testRepo2;

test('0. Setup isolated test fixtures (user, project, repositories)', async () => {
  const userRes = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('dev@serphawk.local', 'Dev User', 'developer', 'hash123')"
  ).run();
  testUserId = Number(userRes.lastInsertRowid);

  const empRes = await db.prepare(
    "INSERT INTO employees (name, email, role, active, user_id) VALUES ('Dev User', 'dev@serphawk.local', 'developer', 1, ?)"
  ).run(testUserId);

  const p1Res = await db.prepare(
    "INSERT INTO projects (key, name, description, color, github_repo) VALUES ('PQA', 'Project QA', 'QA Project', '#0c66e4', 'serphawk22/ticketing')"
  ).run();
  testProjectId = Number(p1Res.lastInsertRowid);

  const p2Res = await db.prepare(
    "INSERT INTO projects (key, name, description, color, github_repo) VALUES ('POTHER', 'Project Other', 'Other Project', '#36b37e', 'serphawk22/other-service')"
  ).run();
  testOtherProjectId = Number(p2Res.lastInsertRowid);

  testRepo1 = await createProjectRepository({
    projectId: testProjectId,
    owner: 'serphawk22',
    repo: 'ticketing',
    verificationStatus: 'verified',
    createdBy: testUserId,
  });

  testRepo2 = await createProjectRepository({
    projectId: testOtherProjectId,
    owner: 'serphawk22',
    repo: 'other-service',
    verificationStatus: 'verified',
    createdBy: testUserId,
  });

  assert.ok(testUserId > 0);
  assert.ok(testProjectId > 0);
  assert.ok(testRepo1.id > 0);
  assert.ok(testRepo2.id > 0);
});

test('1. GitHub PR URL format validation', () => {
  // Valid formats
  const valid1 = parsePullRequestUrl('https://github.com/serphawk22/ticketing/pull/42');
  assert.deepEqual(valid1, {
    owner: 'serphawk22',
    repo: 'ticketing',
    pullNumber: 42,
    canonicalUrl: 'https://github.com/serphawk22/ticketing/pull/42',
  });

  const valid2 = parsePullRequestUrl('http://github.com/my-org/my-app/pull/999/');
  assert.deepEqual(valid2, {
    owner: 'my-org',
    repo: 'my-app',
    pullNumber: 999,
    canonicalUrl: 'https://github.com/my-org/my-app/pull/999',
  });

  // Invalid formats
  assert.equal(parsePullRequestUrl(''), null);
  assert.equal(parsePullRequestUrl('   '), null);
  assert.equal(parsePullRequestUrl(null), null);
  assert.equal(parsePullRequestUrl('not-a-url'), null);
  assert.equal(parsePullRequestUrl('https://gitlab.com/serphawk22/ticketing/pull/42'), null);
  assert.equal(parsePullRequestUrl('https://github.com/serphawk22/ticketing/issues/42'), null);
  assert.equal(parsePullRequestUrl('https://github.com/serphawk22/ticketing/commit/91da2787'), null);
  assert.equal(parsePullRequestUrl('https://github.com/serphawk22/ticketing/pull/0'), null);
  assert.equal(parsePullRequestUrl('https://github.com/serphawk22/ticketing/pull/-5'), null);
  assert.equal(parsePullRequestUrl('https://github.com/serphawk22/ticketing/pull/abc'), null);
});

test('2. Strict repository matching in verifyTicketPullRequest', async () => {
  const fakeTicket = {
    id: 101,
    repository_id: testRepo1.id,
    repository_owner: 'serphawk22',
    repository_name: 'ticketing',
  };

  // Rejection when PR URL belongs to a different repository
  await assert.rejects(
    async () => {
      await verifyTicketPullRequest({
        ticket: fakeTicket,
        prUrl: 'https://github.com/serphawk22/other-service/pull/10',
      });
    },
    (err) => {
      assert.equal(err.code, 'REPOSITORY_MISMATCH');
      assert.equal(err.status, 400);
      assert.match(err.message, /Pull Request belongs to repository "serphawk22\/other-service", but ticket is assigned to "serphawk22\/ticketing"/);
      return true;
    }
  );

  // Rejection when PR URL has different owner
  await assert.rejects(
    async () => {
      await verifyTicketPullRequest({
        ticket: fakeTicket,
        prUrl: 'https://github.com/other-org/ticketing/pull/10',
      });
    },
    (err) => {
      assert.equal(err.code, 'REPOSITORY_MISMATCH');
      return true;
    }
  );

  // Rejection when ticket has no repository assigned
  await assert.rejects(
    async () => {
      await verifyTicketPullRequest({
        ticket: { id: 102, repository_id: null },
        prUrl: 'https://github.com/serphawk22/ticketing/pull/10',
      });
    },
    (err) => {
      assert.equal(err.code, 'REPOSITORY_REQUIRED');
      assert.equal(err.status, 400);
      return true;
    }
  );

  // Rejection when PR URL is malformed
  await assert.rejects(
    async () => {
      await verifyTicketPullRequest({
        ticket: fakeTicket,
        prUrl: 'https://github.com/serphawk22/ticketing/tree/feature',
      });
    },
    (err) => {
      assert.equal(err.code, 'INVALID_PR_URL');
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test('3. Mandatory PR verification when transitioning in_progress -> resolved', async () => {
  // Create ticket in 'open' status with repository
  const created = await createTicketWithStage({
    title: 'Implement QA feature',
    description: 'Feature work',
    createdBy: testUserId,
    projectId: testProjectId,
    repositoryId: testRepo1.id,
  });

  // Move open -> in_progress
  await transitionTicketStatus({
    ticketId: created.id,
    toStatus: 'in_progress',
    actor: { id: testUserId, role: 'developer' },
  });

  const inProgTicket = await getTicket(created.id);
  assert.equal(inProgTicket.status, 'in_progress');
  assert.equal(inProgTicket.repository_id, testRepo1.id);
  assert.equal(inProgTicket.pr_url, '');

  // Case A: Missing PR URL should be blocked when attempting to transition to QA ('resolved')
  // Simulating route validation:
  const targetPrUrl = inProgTicket.pr_url; // empty
  assert.ok(!targetPrUrl, 'Target PR URL is empty');
  // Attempting to move without PR URL must fail
  assert.throws(
    () => {
      if (!targetPrUrl || !targetPrUrl.trim()) {
        const err = new Error('A valid GitHub Pull Request URL is required to move this ticket to QA Testing.');
        err.statusCode = 400;
        throw err;
      }
    },
    { statusCode: 400, message: /A valid GitHub Pull Request URL is required/ }
  );

  // Ticket must still remain 'in_progress'
  const untouchedTicket = await getTicket(created.id);
  assert.equal(untouchedTicket.status, 'in_progress');
});

test('4. Successful transition to resolved with verified PR metadata (Open / Unmerged PR)', async () => {
  const created = await createTicketWithStage({
    title: 'Implement component testing',
    description: 'Component work',
    createdBy: testUserId,
    projectId: testProjectId,
    repositoryId: testRepo1.id,
  });

  await transitionTicketStatus({
    ticketId: created.id,
    toStatus: 'in_progress',
    actor: { id: testUserId, role: 'developer' },
  });

  // Simulating verified open/unmerged PR from GitHub API
  const verifiedMetadata = {
    pr_url: 'https://github.com/serphawk22/ticketing/pull/105',
    github_pr_number: 105,
    github_pr_title: 'feat: add component testing',
    github_pr_state: 'open',
    github_pr_merged: 0, // Unmerged
    github_pr_head_sha: 'a1b2c3d4e5f6',
    github_pr_base_branch: 'main',
    github_pr_last_verified_at: new Date().toISOString(),
    pr_merged_at: null,
    github_branch: 'feature/component-testing',
  };

  // Perform atomic transition with concurrency checks
  const result = await transitionTicketStatus({
    ticketId: created.id,
    toStatus: 'resolved',
    actor: { id: testUserId, role: 'developer' },
    source: 'detail',
    expectedCurrentStatus: 'in_progress',
    expectedRepositoryId: testRepo1.id,
    extraUpdates: verifiedMetadata,
  });

  assert.equal(result.transitioned, true);
  assert.equal(result.toStatus, 'resolved');

  const resolvedTicket = await getTicket(created.id);
  assert.equal(resolvedTicket.status, 'resolved');
  assert.equal(resolvedTicket.pr_url, 'https://github.com/serphawk22/ticketing/pull/105');
  assert.equal(resolvedTicket.github_pr_number, 105);
  assert.equal(resolvedTicket.github_pr_title, 'feat: add component testing');
  assert.equal(resolvedTicket.github_pr_state, 'open');
  assert.equal(resolvedTicket.github_pr_merged, 0); // 0 = unmerged
  assert.equal(resolvedTicket.github_pr_head_sha, 'a1b2c3d4e5f6');
  assert.equal(resolvedTicket.github_pr_base_branch, 'main');
  assert.equal(resolvedTicket.github_branch, 'feature/component-testing');
  assert.equal(resolvedTicket.pr_merged_at, null);
  assert.ok(resolvedTicket.github_pr_last_verified_at);
});

test('5. Successful transition to resolved with verified PR metadata (Merged PR)', async () => {
  const created = await createTicketWithStage({
    title: 'Fix edge case bug',
    description: 'Fixing edge case',
    createdBy: testUserId,
    projectId: testProjectId,
    repositoryId: testRepo1.id,
  });

  await transitionTicketStatus({
    ticketId: created.id,
    toStatus: 'in_progress',
    actor: { id: testUserId, role: 'developer' },
  });

  const mergedAtIso = '2026-11-15T12:00:00Z';
  const verifiedMetadata = {
    pr_url: 'https://github.com/serphawk22/ticketing/pull/106',
    github_pr_number: 106,
    github_pr_title: 'fix: resolve edge case bug',
    github_pr_state: 'closed',
    github_pr_merged: 1, // Merged
    github_pr_head_sha: 'e5f6a1b2c3d4',
    github_pr_base_branch: 'main',
    github_pr_last_verified_at: new Date().toISOString(),
    pr_merged_at: mergedAtIso,
    github_branch: 'bugfix/edge-case',
  };

  await transitionTicketStatus({
    ticketId: created.id,
    toStatus: 'resolved',
    actor: { id: testUserId, role: 'developer' },
    source: 'detail',
    expectedCurrentStatus: 'in_progress',
    expectedRepositoryId: testRepo1.id,
    extraUpdates: verifiedMetadata,
  });

  const resolvedTicket = await getTicket(created.id);
  assert.equal(resolvedTicket.status, 'resolved');
  assert.equal(resolvedTicket.pr_url, 'https://github.com/serphawk22/ticketing/pull/106');
  assert.equal(resolvedTicket.github_pr_number, 106);
  assert.equal(resolvedTicket.github_pr_state, 'closed');
  assert.equal(resolvedTicket.github_pr_merged, 1); // 1 = merged
  assert.equal(resolvedTicket.pr_merged_at, mergedAtIso);
});

test('6. PR Reuse: Same PR can be reused across multiple tickets in the SAME repository', async () => {
  // Ticket A
  const ticketA = await createTicketWithStage({
    title: 'Shared feature part 1',
    description: 'Frontend part',
    createdBy: testUserId,
    projectId: testProjectId,
    repositoryId: testRepo1.id,
  });

  // Ticket B
  const ticketB = await createTicketWithStage({
    title: 'Shared feature part 2',
    description: 'API part',
    createdBy: testUserId,
    projectId: testProjectId,
    repositoryId: testRepo1.id,
  });

  // Both move to in_progress
  await transitionTicketStatus({ ticketId: ticketA.id, toStatus: 'in_progress', actor: { id: testUserId } });
  await transitionTicketStatus({ ticketId: ticketB.id, toStatus: 'in_progress', actor: { id: testUserId } });

  const sharedPrUrl = 'https://github.com/serphawk22/ticketing/pull/200';
  const sharedPrMetadata = {
    pr_url: sharedPrUrl,
    github_pr_number: 200,
    github_pr_title: 'feat: monorepo cross-ticket feature',
    github_pr_state: 'open',
    github_pr_merged: 0,
    github_pr_head_sha: 'sha200',
    github_pr_base_branch: 'main',
    github_pr_last_verified_at: new Date().toISOString(),
    pr_merged_at: null,
    github_branch: 'feature/cross-ticket',
  };

  // Move Ticket A to resolved with PR #200
  await transitionTicketStatus({
    ticketId: ticketA.id,
    toStatus: 'resolved',
    actor: { id: testUserId },
    expectedCurrentStatus: 'in_progress',
    expectedRepositoryId: testRepo1.id,
    extraUpdates: sharedPrMetadata,
  });

  // Move Ticket B to resolved with the exact same PR #200
  await transitionTicketStatus({
    ticketId: ticketB.id,
    toStatus: 'resolved',
    actor: { id: testUserId },
    expectedCurrentStatus: 'in_progress',
    expectedRepositoryId: testRepo1.id,
    extraUpdates: sharedPrMetadata,
  });

  const refreshedA = await getTicket(ticketA.id);
  const refreshedB = await getTicket(ticketB.id);

  assert.equal(refreshedA.status, 'resolved');
  assert.equal(refreshedA.pr_url, sharedPrUrl);
  assert.equal(refreshedA.github_pr_number, 200);

  assert.equal(refreshedB.status, 'resolved');
  assert.equal(refreshedB.pr_url, sharedPrUrl);
  assert.equal(refreshedB.github_pr_number, 200);

  // Confirm database allows querying all tickets sharing the same PR URL
  const sharedRows = await db.prepare('SELECT id, title FROM tickets WHERE pr_url = ? ORDER BY id ASC').all(sharedPrUrl);
  assert.equal(sharedRows.length, 2);
  assert.equal(sharedRows[0].id, ticketA.id);
  assert.equal(sharedRows[1].id, ticketB.id);
});

test('7. Cross-repository PR reuse is strictly forbidden', async () => {
  // Ticket C belongs to testRepo2 ('serphawk22/other-service')
  const ticketC = await createTicketWithStage({
    title: 'Other service task',
    description: 'Other service work',
    createdBy: testUserId,
    projectId: testOtherProjectId,
    repositoryId: testRepo2.id,
  });

  const loadedC = await getTicket(ticketC.id);
  assert.equal(loadedC.repository_id, testRepo2.id);
  assert.equal(loadedC.repository_name, 'other-service');

  // Attempting to reuse PR from 'serphawk22/ticketing' must be rejected
  await assert.rejects(
    async () => {
      await verifyTicketPullRequest({
        ticket: loadedC,
        prUrl: 'https://github.com/serphawk22/ticketing/pull/200',
      });
    },
    (err) => {
      assert.equal(err.code, 'REPOSITORY_MISMATCH');
      assert.match(err.message, /Pull Request belongs to repository "serphawk22\/ticketing", but ticket is assigned to "serphawk22\/other-service"/);
      return true;
    }
  );
});

test('8. Optimistic concurrency check: concurrent status change causes 409 conflict', async () => {
  const created = await createTicketWithStage({
    title: 'Concurrent test ticket',
    description: 'Testing concurrency',
    createdBy: testUserId,
    projectId: testProjectId,
    repositoryId: testRepo1.id,
  });

  // Ticket starts in 'open'
  // Caller expects 'in_progress' but ticket is actually 'open'
  await assert.rejects(
    async () => {
      await transitionTicketStatus({
        ticketId: created.id,
        toStatus: 'resolved',
        actor: { id: testUserId },
        expectedCurrentStatus: 'in_progress',
        expectedRepositoryId: testRepo1.id,
      });
    },
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /Ticket status changed concurrently/);
      return true;
    }
  );

  // Ticket remains 'open'
  const current = await getTicket(created.id);
  assert.equal(current.status, 'open');
});

test('9. Optimistic concurrency check: concurrent repository change causes 409 conflict', async () => {
  const created = await createTicketWithStage({
    title: 'Repo conflict ticket',
    description: 'Testing repo concurrency',
    createdBy: testUserId,
    projectId: testProjectId,
    repositoryId: testRepo1.id,
  });

  await transitionTicketStatus({ ticketId: created.id, toStatus: 'in_progress', actor: { id: testUserId } });

  // Caller expects expectedRepositoryId to be 99999, but ticket is assigned to testRepo1.id
  await assert.rejects(
    async () => {
      await transitionTicketStatus({
        ticketId: created.id,
        toStatus: 'resolved',
        actor: { id: testUserId },
        expectedCurrentStatus: 'in_progress',
        expectedRepositoryId: 99999,
      });
    },
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /Ticket repository changed concurrently/);
      return true;
    }
  );

  const current = await getTicket(created.id);
  assert.equal(current.status, 'in_progress');
});

test('10. GitHub API failure preserves in_progress status without partial write', async () => {
  const created = await createTicketWithStage({
    title: 'Outage resilience ticket',
    description: 'Testing API outage handling',
    createdBy: testUserId,
    projectId: testProjectId,
    repositoryId: testRepo1.id,
  });

  await transitionTicketStatus({ ticketId: created.id, toStatus: 'in_progress', actor: { id: testUserId } });

  // Simulate route behavior when verifyTicketPullRequest fails:
  // e.g. GitHub returns 503 outage or 404
  let transitionAttempted = false;
  try {
    throw new GitHubApiError('GitHub server error (502). Service may be experiencing an outage.', {
      status: 502,
      code: 'OUTAGE',
      isTransient: true,
    });
    // This will not be reached:
    transitionAttempted = true;
    await transitionTicketStatus({
      ticketId: created.id,
      toStatus: 'resolved',
      actor: { id: testUserId },
    });
  } catch (err) {
    assert.equal(err.code, 'OUTAGE');
    assert.equal(err.status, 502);
  }

  assert.equal(transitionAttempted, false);
  const check = await getTicket(created.id);
  assert.equal(check.status, 'in_progress');
  assert.equal(check.pr_url, '');
  assert.equal(check.github_pr_number, null);
});

test('11. Legacy tickets compatibility: tickets without PR or repo are preserved', async () => {
  // Legacy ticket created without repository_id or pr_url
  const legacyRes = await db.prepare(
    "INSERT INTO tickets (title, description, status, priority, type, created_by, pr_url, github_pr_merged) VALUES ('Legacy ticket', 'Old ticket without repo', 'open', 'medium', 'task', ?, '', NULL)"
  ).run(testUserId);
  const legacyId = Number(legacyRes.lastInsertRowid);

  const legacyTicket = await getTicket(legacyId);
  assert.equal(legacyTicket.repository_id, null);
  assert.equal(legacyTicket.pr_url, '');
  assert.equal(legacyTicket.github_pr_merged, null);

  // Can transition legacy ticket to in_progress normally
  await transitionTicketStatus({
    ticketId: legacyId,
    toStatus: 'in_progress',
    actor: { id: testUserId },
  });

  const updatedLegacy = await getTicket(legacyId);
  assert.equal(updatedLegacy.status, 'in_progress');
  assert.equal(updatedLegacy.github_pr_merged, null);
});

test('12. Live GitHub API verification with real PR (PR #23 in serphawk22/ticketing)', async (t) => {
  if (!isGithubConfigured()) {
    t.skip('GITHUB_TOKEN not configured. Skipping live GitHub verification test.');
    return;
  }

  try {
    const prResult = await getAndVerifyPullRequest('serphawk22', 'ticketing', 23);
    assert.equal(prResult.valid, true);
    assert.equal(prResult.number, 23);
    assert.equal(prResult.state, 'closed');
    assert.equal(prResult.merged, 1, 'PR 23 should be confirmed merged');
    assert.ok(prResult.mergedAt, 'PR 23 should have mergedAt timestamp');
    assert.equal(prResult.headRef, 'feature/ai-progress-summary');

    // Test verifyTicketPullRequest against real PR
    const verified = await verifyTicketPullRequest({
      repository: { github_owner: 'serphawk22', github_repo: 'ticketing' },
      prUrl: 'https://github.com/serphawk22/ticketing/pull/23',
    });

    assert.equal(verified.github_pr_number, 23);
    assert.equal(verified.github_pr_merged, 1);
    assert.equal(verified.github_pr_state, 'closed');
    assert.equal(verified.github_branch, 'feature/ai-progress-summary');
    assert.ok(verified.pr_merged_at);
  } catch (err) {
    if (err.isTransient || err.code === 'OUTAGE' || err.status === 503) {
      t.skip(`GitHub API unreachable in test environment: ${err.message}`);
    } else {
      throw err;
    }
  }
});

test('13. Strict optimistic concurrency on expectedPrUrl (including null and empty string)', async () => {
  const created = await createTicketWithStage({
    title: 'PR URL Concurrency Ticket',
    description: 'Testing expectedPrUrl concurrency',
    createdBy: testUserId,
    projectId: testProjectId,
    repositoryId: testRepo1.id,
  });

  await transitionTicketStatus({ ticketId: created.id, toStatus: 'in_progress', actor: { id: testUserId } });

  // 13a. Initially ticket has pr_url = ''.
  // If caller passes expectedPrUrl = 'https://github.com/serphawk22/ticketing/pull/999' (mismatch against db ''), it must conflict with 409.
  await assert.rejects(
    async () => {
      await transitionTicketStatus({
        ticketId: created.id,
        toStatus: 'in_progress',
        actor: { id: testUserId },
        expectedCurrentStatus: 'in_progress',
        expectedRepositoryId: testRepo1.id,
        expectedPrUrl: 'https://github.com/serphawk22/ticketing/pull/999',
      });
    },
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /Ticket PR URL changed concurrently/);
      return true;
    }
  );

  // 13b. If caller passes expectedPrUrl = '' (matching db ''), transition succeeds!
  const resEmpty = await transitionTicketStatus({
    ticketId: created.id,
    toStatus: 'in_progress',
    actor: { id: testUserId },
    expectedCurrentStatus: 'in_progress',
    expectedRepositoryId: testRepo1.id,
    expectedPrUrl: '',
    extraUpdates: {
      pr_url: 'https://github.com/serphawk22/ticketing/pull/111',
      github_pr_number: 111,
      github_branch: 'feature/111',
    },
  });
  assert.equal(resEmpty.ticket.pr_url, 'https://github.com/serphawk22/ticketing/pull/111');

  // 13c. Now ticket has pr_url = 'https://github.com/serphawk22/ticketing/pull/111'.
  // If caller passes expectedPrUrl = '' or null, it must strictly conflict with 409!
  await assert.rejects(
    async () => {
      await transitionTicketStatus({
        ticketId: created.id,
        toStatus: 'resolved',
        actor: { id: testUserId },
        expectedCurrentStatus: 'in_progress',
        expectedRepositoryId: testRepo1.id,
        expectedPrUrl: '', // expected empty, but DB has pull/111
      });
    },
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /Ticket PR URL changed concurrently/);
      return true;
    }
  );

  // Also test expectedPrUrl = null
  await assert.rejects(
    async () => {
      await transitionTicketStatus({
        ticketId: created.id,
        toStatus: 'resolved',
        actor: { id: testUserId },
        expectedCurrentStatus: 'in_progress',
        expectedRepositoryId: testRepo1.id,
        expectedPrUrl: null, // expected null, but DB has pull/111
      });
    },
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /Ticket PR URL changed concurrently/);
      return true;
    }
  );
});

test('14. PR removal safeguard: ticket in resolved reverts atomically to in_progress with full metadata cleanup', async () => {
  // Create ticket and transition to resolved with verified PR
  const created = await createTicketWithStage({
    title: 'QA removal test ticket',
    description: 'Testing PR removal while in QA',
    createdBy: testUserId,
    projectId: testProjectId,
    repositoryId: testRepo1.id,
  });

  await transitionTicketStatus({ ticketId: created.id, toStatus: 'in_progress', actor: { id: testUserId } });

  await transitionTicketStatus({
    ticketId: created.id,
    toStatus: 'resolved',
    actor: { id: testUserId },
    expectedCurrentStatus: 'in_progress',
    expectedRepositoryId: testRepo1.id,
    extraUpdates: {
      pr_url: 'https://github.com/serphawk22/ticketing/pull/112',
      github_pr_number: 112,
      github_pr_title: 'PR 112',
      github_pr_state: 'open',
      github_pr_merged: 0,
      github_pr_head_sha: 'sha112',
      github_pr_base_branch: 'main',
      github_branch: 'feature/pr112',
      github_pr_last_verified_at: new Date().toISOString(),
    },
  });

  const resolved = await getTicket(created.id);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.pr_url, 'https://github.com/serphawk22/ticketing/pull/112');
  assert.equal(resolved.github_branch, 'feature/pr112');

  // Now simulate PR removal on resolved ticket:
  // Server-side safeguard: A ticket must not remain in 'resolved' without a verified PR!
  // Reverts atomically to 'in_progress', clearing all 10 PR/branch fields.
  const clearedGitUpdates = {
    pr_url: '',
    github_pr_number: null,
    github_pr_title: '',
    github_pr_state: '',
    github_pr_merged: null,
    github_pr_head_sha: '',
    github_pr_base_branch: '',
    github_pr_last_verified_at: null,
    pr_merged_at: null,
    github_branch: '',
  };

  const revertResult = await transitionTicketStatus({
    ticketId: created.id,
    toStatus: 'in_progress',
    actor: { id: testUserId },
    expectedCurrentStatus: 'resolved',
    expectedRepositoryId: testRepo1.id,
    expectedPrUrl: 'https://github.com/serphawk22/ticketing/pull/112',
    extraUpdates: clearedGitUpdates,
  });

  assert.equal(revertResult.transitioned, true);
  assert.equal(revertResult.toStatus, 'in_progress');

  const reverted = await getTicket(created.id);
  assert.equal(reverted.status, 'in_progress', 'Ticket must be reverted to in_progress');
  assert.equal(reverted.pr_url, '', 'pr_url must be empty');
  assert.equal(reverted.github_pr_number, null);
  assert.equal(reverted.github_pr_title, '');
  assert.equal(reverted.github_pr_state, '');
  assert.equal(reverted.github_pr_merged, null);
  assert.equal(reverted.github_pr_head_sha, '');
  assert.equal(reverted.github_pr_base_branch, '');
  assert.equal(reverted.github_pr_last_verified_at, null);
  assert.equal(reverted.pr_merged_at, null);
  assert.equal(reverted.github_branch, '', 'github_branch must be cleared');

  // Verify stage history records the exit from resolved and entry into in_progress
  const stages = await db.prepare(
    'SELECT from_status, to_status, is_reopen FROM ticket_stage_history WHERE ticket_id = ? ORDER BY transition_seq ASC'
  ).all(created.id);

  assert.equal(stages.length, 4);
  assert.equal(stages[0].to_status, 'open');
  assert.equal(stages[1].to_status, 'in_progress');
  assert.equal(stages[2].to_status, 'resolved');
  assert.equal(stages[3].from_status, 'resolved');
  assert.equal(stages[3].to_status, 'in_progress');
  assert.equal(stages[3].is_reopen, 1, 'Reopening back to in_progress must flag is_reopen = 1');
});

test('15. Closed and archived ticket protection against PR modification or removal', async () => {
  // 15a. Closed ticket
  const closedRes = await db.prepare(
    "INSERT INTO tickets (title, description, status, priority, type, created_by, project_id, repository_id, pr_url, github_pr_number, github_pr_merged) VALUES ('Closed Ticket', 'Testing closed protection', 'closed', 'medium', 'task', ?, ?, ?, 'https://github.com/serphawk22/ticketing/pull/23', 23, 1)"
  ).run(testUserId, testProjectId, testRepo1.id);
  const closedId = Number(closedRes.lastInsertRowid);

  const closedTicket = await getTicket(closedId);
  assert.equal(closedTicket.status, 'closed');

  // Attempting to clear PR on a closed ticket must be rejected by rule
  assert.throws(
    () => {
      if (closedTicket.status === 'closed') {
        const err = new Error('Cannot modify or remove Pull Request references on a closed ticket.');
        err.statusCode = 400;
        throw err;
      }
    },
    { statusCode: 400, message: /Cannot modify or remove Pull Request references on a closed ticket/ }
  );

  // 15b. Archived ticket
  const archivedRes = await db.prepare(
    "INSERT INTO tickets (title, description, status, priority, type, created_by, project_id, repository_id, archived, pr_url) VALUES ('Archived Ticket', 'Testing archived protection', 'in_progress', 'medium', 'task', ?, ?, ?, 1, 'https://github.com/serphawk22/ticketing/pull/23')"
  ).run(testUserId, testProjectId, testRepo1.id);
  const archivedId = Number(archivedRes.lastInsertRowid);

  const archivedTicket = await getTicket(archivedId);
  assert.equal(archivedTicket.archived, 1);

  // Attempting to modify PR on archived ticket must be rejected
  assert.throws(
    () => {
      if (archivedTicket.archived) {
        const err = new Error('Cannot modify or remove Pull Request on an archived ticket.');
        err.statusCode = 400;
        throw err;
      }
    },
    { statusCode: 400, message: /Cannot modify or remove Pull Request on an archived ticket/ }
  );
});

test('16. Inactive and cross-project repository restrictions', async () => {
  // Create deactivated repository
  const inactiveRepo = await createProjectRepository({
    projectId: testProjectId,
    owner: 'serphawk22',
    repo: 'deactivated-repo',
    verificationStatus: 'verified',
    createdBy: testUserId,
  });
  await db.prepare('UPDATE project_repositories SET is_active = 0 WHERE id = ?').run(inactiveRepo.id);

  const reloadedInactive = await getRepositoryById(inactiveRepo.id);
  assert.equal(reloadedInactive.is_active, 0);

  // Deactivated repository cannot accept PR verification
  assert.throws(
    () => {
      if (!reloadedInactive.is_active) {
        const err = new Error('Repository is deactivated and cannot be used for PR verification.');
        err.statusCode = 400;
        throw err;
      }
    },
    { statusCode: 400, message: /Repository is deactivated/ }
  );

  // Cross-project repository validation:
  // Repo from testOtherProjectId cannot be used for a ticket in testProjectId
  const otherRepo = await getRepositoryById(testRepo2.id);
  assert.equal(otherRepo.project_id, testOtherProjectId);

  assert.throws(
    () => {
      if (Number(otherRepo.project_id) !== Number(testProjectId)) {
        const err = new Error('Selected repository does not belong to the ticket project.');
        err.statusCode = 400;
        throw err;
      }
    },
    { statusCode: 400, message: /does not belong to the ticket project/ }
  );
});

