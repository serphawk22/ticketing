import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test_phase3_multi_repo_isolated.db');

// Ensure clean isolated SQLite test database environment
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.NEXT_TELEMETRY_DISABLED = '1';

const { db } = await import('../lib/db.js');
const {
  getProjectRepositories,
  getRepositoryById,
  findProjectRepository,
  createProjectRepository,
  updateProjectRepository,
  deleteProjectRepository,
  validateTicketRepository,
  changeTicketRepository,
} = await import('../lib/projectRepositories.js');
const { createTicketWithStage, transitionTicketStatus } = await import('../lib/ticketStageService.js');
const { getTicket, getAllTickets } = await import('../lib/tickets.js');
const { getActivity, logRepositoryChange } = await import('../lib/ticketActivity.js');

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch {}
    }
  }
});

let testUserId;
let testProjectId1;
let testProjectId2;
let testRepo1;
let testRepo2;
let testRepoProject2;

test('0. Setup isolated test fixtures (user, projects)', async () => {
  const userRes = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('testadmin@serphawk.local', 'Test Admin', 'admin', 'dummy_hash')"
  ).run();
  testUserId = Number(userRes.lastInsertRowid);

  const p1Res = await db.prepare(
    "INSERT INTO projects (key, name, description, color, github_repo) VALUES ('PONE', 'Project One', 'First project', '#0c66e4', 'serphawk22/ticketing')"
  ).run();
  testProjectId1 = Number(p1Res.lastInsertRowid);

  const p2Res = await db.prepare(
    "INSERT INTO projects (key, name, description, color) VALUES ('PTWO', 'Project Two', 'Second project', '#36b37e')"
  ).run();
  testProjectId2 = Number(p2Res.lastInsertRowid);

  assert.ok(testUserId > 0);
  assert.ok(testProjectId1 > 0);
  assert.ok(testProjectId2 > 0);
});

test('1. Multi-repository creation, duplicate prevention, and listing', async () => {
  // Create first repository
  testRepo1 = await createProjectRepository({
    projectId: testProjectId1,
    owner: 'serphawk22',
    repo: 'ticketing',
    verificationStatus: 'verified',
    createdBy: testUserId,
  });

  assert.equal(testRepo1.github_owner, 'serphawk22');
  assert.equal(testRepo1.github_repo, 'ticketing');
  assert.equal(testRepo1.is_active, 1);
  assert.equal(testRepo1.verification_status, 'verified');

  // Create second repository under the same project
  testRepo2 = await createProjectRepository({
    projectId: testProjectId1,
    owner: 'serphawk22',
    repo: 'ticketing-frontend',
    verificationStatus: 'verified',
    createdBy: testUserId,
  });

  assert.equal(testRepo2.github_owner, 'serphawk22');
  assert.equal(testRepo2.github_repo, 'ticketing-frontend');

  // Verify list retrieves both repositories
  const list = await getProjectRepositories(testProjectId1);
  assert.equal(list.length, 2);

  // Duplicate rejection (exact match)
  await assert.rejects(
    async () => {
      await createProjectRepository({
        projectId: testProjectId1,
        owner: 'serphawk22',
        repo: 'ticketing',
      });
    },
    (err) => {
      assert.equal(err.code, 'DUPLICATE_REPOSITORY');
      return true;
    }
  );

  // Duplicate rejection (case-insensitive: SerpHawk22/Ticketing)
  await assert.rejects(
    async () => {
      await createProjectRepository({
        projectId: testProjectId1,
        owner: 'SerpHawk22',
        repo: 'Ticketing',
      });
    },
    (err) => {
      assert.equal(err.code, 'DUPLICATE_REPOSITORY');
      return true;
    }
  );

  // Cross-project independence: same repo name CAN exist in another project
  testRepoProject2 = await createProjectRepository({
    projectId: testProjectId2,
    owner: 'serphawk22',
    repo: 'ticketing',
  });
  assert.ok(testRepoProject2.id > 0);
  assert.notEqual(testRepoProject2.id, testRepo1.id);
});

test('2. Mandatory repository validation during ticket creation', async () => {
  // Reject ticket creation when repository is missing for a project
  await assert.rejects(
    async () => {
      await validateTicketRepository({
        projectId: testProjectId1,
        repositoryId: null,
      });
    },
    (err) => {
      assert.equal(err.code, 'REPOSITORY_REQUIRED');
      return true;
    }
  );

  // Reject ticket creation when repository belongs to a different project
  await assert.rejects(
    async () => {
      await validateTicketRepository({
        projectId: testProjectId1,
        repositoryId: testRepoProject2.id,
      });
    },
    (err) => {
      assert.equal(err.code, 'REPOSITORY_PROJECT_MISMATCH');
      return true;
    }
  );

  // Deactivate repo2 and reject ticket creation with inactive repo
  await updateProjectRepository(testRepo2.id, { isActive: false });
  await assert.rejects(
    async () => {
      await validateTicketRepository({
        projectId: testProjectId1,
        repositoryId: testRepo2.id,
      });
    },
    (err) => {
      assert.equal(err.code, 'REPOSITORY_INACTIVE');
      return true;
    }
  );

  // Re-activate repo2
  await updateProjectRepository(testRepo2.id, { isActive: true });

  // Validate active repo1 succeeds
  const validated = await validateTicketRepository({
    projectId: testProjectId1,
    repositoryId: testRepo1.id,
  });
  assert.equal(validated.id, testRepo1.id);

  // Create ticket with valid repository
  const created = await createTicketWithStage({
    title: 'Multi-Repo Test Ticket 1',
    description: 'Testing repository_id persistence',
    priority: 'high',
    type: 'task',
    createdBy: testUserId,
    projectId: testProjectId1,
    repositoryId: testRepo1.id,
  });

  assert.ok(created.id > 0);

  // Query ticket and ensure joined repository columns are populated
  const ticket = await getTicket(created.id);
  assert.equal(ticket.repository_id, testRepo1.id);
  assert.equal(ticket.repository_owner, 'serphawk22');
  assert.equal(ticket.repository_name, 'ticketing');
  assert.ok(ticket.repository_url.includes('serphawk22/ticketing'));
});

test('3. Soft deactivation vs Delete restrictions when tickets reference a repository', async () => {
  // Attempting to delete testRepo1 (which is referenced by ticket 1) must be rejected
  await assert.rejects(
    async () => {
      await deleteProjectRepository(testRepo1.id);
    },
    (err) => {
      assert.equal(err.code, 'REFERENCED_BY_TICKETS');
      assert.equal(err.ticketCount, 1);
      return true;
    }
  );

  // Deactivating testRepo1 must succeed
  const deactivated = await updateProjectRepository(testRepo1.id, { isActive: false });
  assert.equal(deactivated.is_active, 0);

  // Unreferenced repository (testRepoProject2) can be hard deleted cleanly
  const deleteResult = await deleteProjectRepository(testRepoProject2.id);
  assert.equal(deleteResult.success, true);
  const deletedCheck = await getRepositoryById(testRepoProject2.id);
  assert.ok(!deletedCheck, 'Deleted repository should not be found');

  // Re-activate testRepo1
  await updateProjectRepository(testRepo1.id, { isActive: true });
});

test('4. Ticket repository correction safeguards, complete 10-field Git cleanup, and activity logging', async () => {
  // Create a ticket with testRepo1 and all 10 Git references populated
  const created = await createTicketWithStage({
    title: 'Git Linked Ticket',
    description: 'Ticket with complete branch and PR references',
    priority: 'high',
    type: 'bug',
    createdBy: testUserId,
    projectId: testProjectId1,
    repositoryId: testRepo1.id,
  });

  const ticketId = created.id;

  // Simulate complete set of 10 repository-specific Git metadata fields
  await db.prepare(`
    UPDATE tickets
    SET github_branch = 'feature/fix-auth',
        pr_url = 'https://github.com/serphawk22/ticketing/pull/42',
        github_pr_number = 42,
        github_pr_title = 'Fix authentication bug',
        github_pr_state = 'open',
        github_pr_merged = 0,
        github_pr_head_sha = 'a1b2c3d4e5f6',
        github_pr_base_branch = 'main',
        github_pr_last_verified_at = '2026-11-17T12:00:00Z',
        pr_merged_at = NULL
    WHERE id = ?
  `).run(ticketId);

  const beforeChange = await getTicket(ticketId);
  assert.equal(beforeChange.github_branch, 'feature/fix-auth');
  assert.equal(beforeChange.pr_url, 'https://github.com/serphawk22/ticketing/pull/42');
  assert.equal(beforeChange.github_pr_number, 42);
  assert.equal(beforeChange.github_pr_title, 'Fix authentication bug');
  assert.equal(beforeChange.github_pr_head_sha, 'a1b2c3d4e5f6');

  // Attempt change without mandatory justification reason -> must reject
  await assert.rejects(
    async () => {
      await changeTicketRepository({
        ticketId,
        newRepoId: testRepo2.id,
        reason: '',
        actor: { id: testUserId, role: 'admin' },
      });
    },
    /mandatory when changing repository on a ticket with existing Git/
  );

  // Perform atomic repository change with justification reason
  const justification = 'Work moved to the frontend repository as this is a client-side component defect.';
  const result = await changeTicketRepository({
    ticketId,
    newRepoId: testRepo2.id,
    reason: justification,
    actor: { id: testUserId, role: 'admin' },
  });

  assert.equal(result.changed, true);
  assert.equal(result.clearedGitReferences, true);

  const afterChange = await getTicket(ticketId);
  assert.equal(afterChange.repository_id, testRepo2.id);
  assert.equal(afterChange.repository_owner, 'serphawk22');
  assert.equal(afterChange.repository_name, 'ticketing-frontend');
  assert.equal(afterChange.repository_change_reason, justification);
  assert.ok(afterChange.repository_changed_at);

  // Verify ALL 10 repository-specific Git metadata fields were completely reset
  assert.equal(afterChange.github_branch, '', 'github_branch must be cleared');
  assert.equal(afterChange.pr_url, '', 'pr_url must be cleared');
  assert.equal(afterChange.github_pr_number, null, 'github_pr_number must be cleared');
  assert.equal(afterChange.github_pr_title, '', 'github_pr_title must be cleared');
  assert.equal(afterChange.github_pr_state, '', 'github_pr_state must be cleared');
  assert.equal(afterChange.github_pr_merged, null, 'github_pr_merged must be cleared');
  assert.equal(afterChange.github_pr_head_sha, '', 'github_pr_head_sha must be cleared');
  assert.equal(afterChange.github_pr_base_branch, '', 'github_pr_base_branch must be cleared');
  assert.equal(afterChange.github_pr_last_verified_at, null, 'github_pr_last_verified_at must be cleared');
  assert.equal(afterChange.pr_merged_at, null, 'pr_merged_at must be cleared');

  // Verify activity history contains repository_id change with reason and complete cleared Git details
  const activities = await getActivity(ticketId);
  const repoActivity = activities.find((a) => a.field === 'repository_id');
  assert.ok(repoActivity, 'Activity feed should contain repository_id change');
  assert.equal(repoActivity.from_value, 'serphawk22/ticketing');
  assert.equal(repoActivity.to_value, 'serphawk22/ticketing-frontend');
  assert.equal(repoActivity.reason, justification);
  assert.ok(repoActivity.blocker.includes('feature/fix-auth'));
  assert.ok(repoActivity.blocker.includes('pull/42'));
  assert.ok(repoActivity.blocker.includes('Fix authentication bug'));
  assert.ok(repoActivity.blocker.includes('a1b2c3d4e5f6'));
});

test('4b. Atomic transaction rollback on failure', async () => {
  const created = await createTicketWithStage({
    title: 'Atomic Rollback Test Ticket',
    description: 'Testing rollback integrity',
    createdBy: testUserId,
    projectId: testProjectId1,
    repositoryId: testRepo1.id,
  });

  const ticketId = created.id;

  await db.prepare(`
    UPDATE tickets
    SET github_branch = 'feature/keep-this',
        pr_url = 'https://github.com/serphawk22/ticketing/pull/101'
    WHERE id = ?
  `).run(ticketId);

  const initialActivities = await getActivity(ticketId);
  const initialActivityCount = initialActivities.length;

  // Attempt changing to an invalid repository id (e.g. 99999)
  await assert.rejects(
    async () => {
      await changeTicketRepository({
        ticketId,
        newRepoId: 99999,
        reason: 'Should fail and rollback',
        actor: { id: testUserId, role: 'admin' },
      });
    },
    /Selected repository not found/
  );

  // Verify that the ticket state remains completely untouched
  const afterFailedAttempt = await getTicket(ticketId);
  assert.equal(afterFailedAttempt.repository_id, testRepo1.id);
  assert.equal(afterFailedAttempt.github_branch, 'feature/keep-this');
  assert.equal(afterFailedAttempt.pr_url, 'https://github.com/serphawk22/ticketing/pull/101');
  assert.equal(afterFailedAttempt.repository_change_reason, null);

  // Verify no new activity rows were inserted
  const afterActivities = await getActivity(ticketId);
  assert.equal(afterActivities.length, initialActivityCount);
});

test('4c. Authorization enforcement for repository changes', async () => {
  // Create an employee and a client user
  const empRes = await db.prepare(
    "INSERT INTO employees (name, email, role, active) VALUES ('Assigned Dev', 'dev@serphawk.local', 'employee', 1)"
  ).run();
  const employeeId = Number(empRes.lastInsertRowid);

  const devUserRes = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('dev@serphawk.local', 'Assigned Dev', 'employee', 'hash')"
  ).run();
  const devUserId = Number(devUserRes.lastInsertRowid);

  const otherDevUserRes = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('otherdev@serphawk.local', 'Other Dev', 'employee', 'hash')"
  ).run();
  const otherDevUserId = Number(otherDevUserRes.lastInsertRowid);

  const clientUserRes = await db.prepare(
    "INSERT INTO users (email, name, role, password) VALUES ('client@serphawk.local', 'Client User', 'client', 'hash')"
  ).run();
  const clientUserId = Number(clientUserRes.lastInsertRowid);

  // Link employee to dev user
  await db.prepare('UPDATE employees SET user_id = ? WHERE id = ?').run(devUserId, employeeId);

  // Create ticket assigned to employee
  const created = await createTicketWithStage({
    title: 'Auth Enforcement Ticket',
    description: 'Testing RBAC',
    createdBy: testUserId,
    projectId: testProjectId1,
    repositoryId: testRepo1.id,
    employeeId,
  });
  const ticketId = created.id;

  // 1. Client user must be rejected with 403
  await assert.rejects(
    async () => {
      await changeTicketRepository({
        ticketId,
        newRepoId: testRepo2.id,
        reason: 'Client change',
        actor: { id: clientUserId, role: 'client' },
      });
    },
    /Clients are not authorized/
  );

  // 2. Other unassigned employee must be rejected with 403
  await assert.rejects(
    async () => {
      await changeTicketRepository({
        ticketId,
        newRepoId: testRepo2.id,
        reason: 'Unassigned change',
        actor: { id: otherDevUserId, role: 'employee' },
      });
    },
    /Forbidden/
  );

  // 3. Assigned employee is authorized
  const assignedResult = await changeTicketRepository({
    ticketId,
    newRepoId: testRepo2.id,
    reason: 'Assigned employee valid change',
    actor: { id: devUserId, role: 'employee' },
  });
  assert.equal(assignedResult.changed, true);

  // 4. Admin is authorized
  const adminResult = await changeTicketRepository({
    ticketId,
    newRepoId: testRepo1.id,
    reason: 'Admin override change',
    actor: { id: testUserId, role: 'admin' },
  });
  assert.equal(adminResult.changed, true);
});

test('5. Automatic stage reversion from Resolved (QA Testing) to In Progress upon repository change', async () => {
  // Create ticket
  const created = await createTicketWithStage({
    title: 'QA Testing Stage Ticket',
    description: 'Ticket currently in QA testing',
    createdBy: testUserId,
    projectId: testProjectId1,
    repositoryId: testRepo1.id,
  });

  const ticketId = created.id;

  // Move ticket to in_progress then resolved (QA Testing)
  await transitionTicketStatus({
    ticketId,
    toStatus: 'in_progress',
    actor: { id: testUserId },
    source: 'board',
  });

  await transitionTicketStatus({
    ticketId,
    toStatus: 'resolved',
    actor: { id: testUserId },
    source: 'board',
  });

  const inQaTicket = await getTicket(ticketId);
  assert.equal(inQaTicket.status, 'resolved');

  // Add branch/PR metadata
  await db.prepare(`
    UPDATE tickets
    SET github_branch = 'feature/qa-branch',
        pr_url = 'https://github.com/serphawk22/ticketing/pull/99',
        github_pr_number = 99
    WHERE id = ?
  `).run(ticketId);

  // Change repository -> atomic status reversion from 'resolved' to 'in_progress'
  const justification = 'Switching repository requires re-implementing and re-testing in dev environment';
  const changeRes = await changeTicketRepository({
    ticketId,
    newRepoId: testRepo2.id,
    reason: justification,
    actor: { id: testUserId, role: 'admin' },
  });

  assert.equal(changeRes.revertedFromQa, true);

  const revertedTicket = await getTicket(ticketId);
  assert.equal(revertedTicket.status, 'in_progress', 'Ticket in resolved must revert to in_progress on repo change');
  assert.equal(revertedTicket.repository_id, testRepo2.id);
  assert.equal(revertedTicket.github_branch, '');
  assert.equal(revertedTicket.pr_url, '');
  assert.equal(revertedTicket.github_pr_number, null);

  // Verify stage history contains closure of resolved and new in_progress with is_reopen = 1
  const stageRows = await db
    .prepare('SELECT * FROM ticket_stage_history WHERE ticket_id = ? ORDER BY transition_seq ASC')
    .all(ticketId);

  const lastStage = stageRows[stageRows.length - 1];
  assert.equal(lastStage.to_status, 'in_progress');
  assert.equal(lastStage.from_status, 'resolved');
  assert.equal(lastStage.is_reopen, 1);

  // Verify activity history contains both repository_id change and status change
  const activities = await getActivity(ticketId);
  const statusActivity = activities.find((a) => a.field === 'status' && a.to_value === 'in_progress');
  assert.ok(statusActivity, 'Activity history must record QA invalidation status transition');
  assert.equal(statusActivity.from_value, 'resolved');
  assert.equal(statusActivity.to_value, 'in_progress');
});

test('6. Legacy tickets compatibility', async () => {
  // Legacy ticket created without a repository_id
  const info = await db.prepare(
    "INSERT INTO tickets (title, description, status, priority, type, created_by) VALUES ('Legacy ticket', 'No repo', 'open', 'medium', 'task', ?)"
  ).run(testUserId);

  const legacyTicket = await getTicket(info.lastInsertRowid);
  assert.equal(legacyTicket.repository_id, null);
  assert.equal(legacyTicket.repository_owner, null);
  assert.equal(legacyTicket.repository_name, null);
  assert.equal(legacyTicket.repository_url, null);

  // Can be listed alongside all tickets without failure
  const allTickets = await getAllTickets();
  assert.ok(allTickets.some((t) => t.id === legacyTicket.id));
});
