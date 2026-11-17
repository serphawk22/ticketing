import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test_phase2_multi_repo_isolated.db');

// Load GITHUB_TOKEN from .env.local if not already set in process.env
if (!process.env.GITHUB_TOKEN) {
  for (const envFile of ['.env.local', '.env']) {
    const fullPath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split('\n')) {
        const match = /^\s*GITHUB_TOKEN\s*=\s*["']?([^"'\r\n]+)["']?/.exec(line);
        if (match && match[1]) {
          process.env.GITHUB_TOKEN = match[1].trim();
          break;
        }
      }
    }
    if (process.env.GITHUB_TOKEN) break;
  }
}

// Ensure clean isolated SQLite test database environment
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.NEXT_TELEMETRY_DISABLED = '1';

const { db, ensureMultiRepoGithubSchema, migrateLegacyProjectRepos } = await import('../lib/db.js');
const {
  GitHubApiError,
  parseOwnerRepo,
  parsePullRequestUrl,
  verifyRepositoryAccess,
  verifyBranchExists,
  getAndVerifyPullRequest,
  isGithubConfigured,
} = await import('../lib/github.js');

test.after(() => {
  // Clean up ephemeral test DB files
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch {}
    }
  }
});

test('1. Migration Idempotency: project_repositories table and ticket columns are created safely and resumably', async () => {
  // Query table_info for tickets
  const ticketCols = await db.prepare("PRAGMA table_info(tickets)").all();
  const colNames = new Set(ticketCols.map((c) => c.name));

  assert.ok(colNames.has('repository_id'), 'tickets should have repository_id');
  assert.ok(colNames.has('github_branch'), 'tickets should have github_branch');
  assert.ok(colNames.has('pr_url'), 'tickets should have pr_url');
  assert.ok(colNames.has('github_pr_number'), 'tickets should have github_pr_number');
  assert.ok(colNames.has('github_pr_title'), 'tickets should have github_pr_title');
  assert.ok(colNames.has('github_pr_state'), 'tickets should have github_pr_state');
  assert.ok(colNames.has('github_pr_merged'), 'tickets should have github_pr_merged');
  assert.ok(colNames.has('github_pr_head_sha'), 'tickets should have github_pr_head_sha');
  assert.ok(colNames.has('github_pr_base_branch'), 'tickets should have github_pr_base_branch');
  assert.ok(colNames.has('github_pr_last_verified_at'), 'tickets should have github_pr_last_verified_at');

  // Query project_repositories table_info
  const repoCols = await db.prepare("PRAGMA table_info(project_repositories)").all();
  const repoColNames = new Set(repoCols.map((c) => c.name));
  assert.ok(repoColNames.has('id'), 'project_repositories should have id');
  assert.ok(repoColNames.has('project_id'), 'project_repositories should have project_id');
  assert.ok(repoColNames.has('github_owner'), 'project_repositories should have github_owner');
  assert.ok(repoColNames.has('github_repo'), 'project_repositories should have github_repo');
  assert.ok(repoColNames.has('repository_url'), 'project_repositories should have repository_url');
  assert.ok(repoColNames.has('is_active'), 'project_repositories should have is_active');
  assert.ok(repoColNames.has('verification_status'), 'project_repositories should have verification_status');

  // Re-run migration a 2nd and 3rd time to verify idempotency
  await assert.doesNotReject(async () => {
    await ensureMultiRepoGithubSchema(db);
    await ensureMultiRepoGithubSchema(db);
  }, 'Re-running ensureMultiRepoGithubSchema must be idempotent and not throw');
});

test('2. Partial Migration Recovery: resumes safely when some columns already exist', async () => {
  const partialDbPath = path.resolve(process.cwd(), 'data', 'test_partial_migration.db');
  if (fs.existsSync(partialDbPath)) fs.unlinkSync(partialDbPath);

  try {
    const rawSqlite = new Database(partialDbPath);
    // Create base tables with only a few columns
    rawSqlite.exec(`
      CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE tickets (id INTEGER PRIMARY KEY, title TEXT, repository_id INTEGER);
    `);

    // Mock an active driver interface matching lib/db.js
    const mockDriver = {
      dialect: 'sqlite',
      prepare: (sql) => ({
        all: async () => rawSqlite.prepare(sql).all(),
        run: async (...args) => rawSqlite.prepare(sql).run(...args),
      }),
      exec: async (sql) => rawSqlite.exec(sql),
    };

    // Run migration on partially populated DB
    await ensureMultiRepoGithubSchema(mockDriver);

    const colsAfter = rawSqlite.prepare("PRAGMA table_info(tickets)").all();
    const colsSet = new Set(colsAfter.map((c) => c.name));

    assert.ok(colsSet.has('repository_id'), 'Should retain repository_id');
    assert.ok(colsSet.has('github_branch'), 'Should add missing github_branch');
    assert.ok(colsSet.has('pr_url'), 'Should add missing pr_url');
    assert.ok(colsSet.has('github_pr_merged'), 'Should add missing github_pr_merged');

    // Re-run again to ensure resume capability
    await ensureMultiRepoGithubSchema(mockDriver);
    rawSqlite.close();
  } finally {
    if (fs.existsSync(partialDbPath)) fs.unlinkSync(partialDbPath);
  }
});

test('3. Legacy Repository Backfill: single & comma-separated github_repo strings are parsed safely into project_repositories', async () => {
  // Insert test projects with varied github_repo formats
  const p1 = await db.prepare(
    "INSERT INTO projects (key, name, description, color, github_repo) VALUES ('LEG1', 'Legacy 1', '', '#000', 'serphawk22/ticketing')"
  ).run();
  const p2 = await db.prepare(
    "INSERT INTO projects (key, name, description, color, github_repo) VALUES ('LEG2', 'Legacy Multi', '', '#000', 'serphawk22/api, serphawk22/web, serphawk22/admin')"
  ).run();
  const p3 = await db.prepare(
    "INSERT INTO projects (key, name, description, color, github_repo) VALUES ('LEG3', 'Legacy Empty', '', '#000', '')"
  ).run();
  const p4 = await db.prepare(
    "INSERT INTO projects (key, name, description, color, github_repo) VALUES ('LEG4', 'Legacy Mixed', '', '#000', 'invalid_no_slash, serphawk22/valid-repo')"
  ).run();

  await migrateLegacyProjectRepos(db);

  // Verify p1 repositories
  const p1Repos = await db.prepare('SELECT * FROM project_repositories WHERE project_id = ?').all(p1.lastInsertRowid);
  assert.equal(p1Repos.length, 1);
  assert.equal(p1Repos[0].github_owner, 'serphawk22');
  assert.equal(p1Repos[0].github_repo, 'ticketing');
  assert.equal(p1Repos[0].repository_url, 'https://github.com/serphawk22/ticketing');
  assert.equal(p1Repos[0].is_active, 1);

  // Verify p2 repositories (3 distinct repositories)
  const p2Repos = await db.prepare('SELECT * FROM project_repositories WHERE project_id = ? ORDER BY github_repo ASC').all(p2.lastInsertRowid);
  assert.equal(p2Repos.length, 3);
  assert.deepEqual(p2Repos.map((r) => r.github_repo), ['admin', 'api', 'web']);

  // Verify p3 repositories (empty)
  const p3Repos = await db.prepare('SELECT * FROM project_repositories WHERE project_id = ?').all(p3.lastInsertRowid);
  assert.equal(p3Repos.length, 0);

  // Verify p4 repositories (only valid format extracted)
  const p4Repos = await db.prepare('SELECT * FROM project_repositories WHERE project_id = ?').all(p4.lastInsertRowid);
  assert.equal(p4Repos.length, 1);
  assert.equal(p4Repos[0].github_repo, 'valid-repo');

  // Verify re-running backfill is completely idempotent (no duplicate rows)
  await migrateLegacyProjectRepos(db);
  const p2ReposSecondRun = await db.prepare('SELECT * FROM project_repositories WHERE project_id = ?').all(p2.lastInsertRowid);
  assert.equal(p2ReposSecondRun.length, 3, 'Second run must not duplicate repository records');

  // Verify original projects.github_repo values are preserved untouched
  const p1Check = await db.prepare('SELECT github_repo FROM projects WHERE id = ?').get(p1.lastInsertRowid);
  assert.equal(p1Check.github_repo, 'serphawk22/ticketing', 'Original projects.github_repo must be preserved');
});

test('4. Foreign Key ON DELETE RESTRICT & Soft Deletion Safeguard', async () => {
  const fkDbPath = path.resolve(process.cwd(), 'data', 'test_fk_restrict.db');
  if (fs.existsSync(fkDbPath)) fs.unlinkSync(fkDbPath);

  try {
    const rawSqlite = new Database(fkDbPath);
    rawSqlite.pragma('foreign_keys = ON');

    rawSqlite.exec(`
      CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE project_repositories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        github_owner TEXT NOT NULL,
        github_repo TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        repository_id INTEGER REFERENCES project_repositories(id) ON DELETE RESTRICT
      );
    `);

    rawSqlite.prepare("INSERT INTO projects (id, name) VALUES (1, 'Test Project')").run();
    rawSqlite.prepare("INSERT INTO project_repositories (id, project_id, github_owner, github_repo, is_active) VALUES (10, 1, 'serphawk22', 'repo-a', 1)").run();
    rawSqlite.prepare("INSERT INTO tickets (id, title, repository_id) VALUES (100, 'Ticket A', 10)").run();

    // Attempt hard delete on repository referenced by ticket -> Must FAIL due to ON DELETE RESTRICT
    assert.throws(() => {
      rawSqlite.prepare('DELETE FROM project_repositories WHERE id = 10').run();
    }, /FOREIGN KEY constraint failed/, 'Hard delete of repository referenced by a ticket must fail');

    // Soft delete -> Must SUCCEED
    const updateResult = rawSqlite.prepare('UPDATE project_repositories SET is_active = 0 WHERE id = 10').run();
    assert.equal(updateResult.changes, 1, 'Soft delete should succeed');

    // Ticket still retains its repository reference
    const ticket = rawSqlite.prepare('SELECT repository_id FROM tickets WHERE id = 100').get();
    assert.equal(ticket.repository_id, 10, 'Ticket must retain repository_id even after repository is deactivated');

    rawSqlite.close();
  } finally {
    if (fs.existsSync(fkDbPath)) fs.unlinkSync(fkDbPath);
  }
});

test('5. 3-State github_pr_merged: supports 1 (merged), 0 (unmerged), and NULL (unknown)', async () => {
  // Create user and project for foreign keys
  const user = await db.prepare("INSERT INTO users (name, email, password, role) VALUES ('Tester', 'test@test.com', 'pass', 'admin')").run();
  const proj = await db.prepare("INSERT INTO projects (key, name) VALUES ('TRI', 'Tri State')").run();

  // Ticket A: Confirmed Merged (1)
  const tA = await db.prepare(`
    INSERT INTO tickets (title, description, created_by, project_id, pr_url, github_pr_merged)
    VALUES ('Merged PR Ticket', 'Desc', ?, ?, 'https://github.com/serphawk22/ticketing/pull/1', 1)
  `).run(user.lastInsertRowid, proj.lastInsertRowid);

  // Ticket B: Confirmed Unmerged (0)
  const tB = await db.prepare(`
    INSERT INTO tickets (title, description, created_by, project_id, pr_url, github_pr_merged)
    VALUES ('Unmerged PR Ticket', 'Desc', ?, ?, 'https://github.com/serphawk22/ticketing/pull/2', 0)
  `).run(user.lastInsertRowid, proj.lastInsertRowid);

  // Ticket C: Unknown / Legacy / Outage (NULL)
  const tC = await db.prepare(`
    INSERT INTO tickets (title, description, created_by, project_id, pr_url, github_pr_merged)
    VALUES ('Legacy / Outage Ticket', 'Desc', ?, ?, '', NULL)
  `).run(user.lastInsertRowid, proj.lastInsertRowid);

  const rowA = await db.prepare('SELECT github_pr_merged FROM tickets WHERE id = ?').get(tA.lastInsertRowid);
  const rowB = await db.prepare('SELECT github_pr_merged FROM tickets WHERE id = ?').get(tB.lastInsertRowid);
  const rowC = await db.prepare('SELECT github_pr_merged FROM tickets WHERE id = ?').get(tC.lastInsertRowid);

  assert.equal(rowA.github_pr_merged, 1, 'Merged ticket should store integer 1');
  assert.equal(rowB.github_pr_merged, 0, 'Unmerged ticket should store integer 0');
  assert.equal(rowC.github_pr_merged, null, 'Unknown/outage ticket should store NULL');
});

test('6. GitHub API Service: URL Parsing, Owner/Repo Validation, and Error Classification', async () => {
  // parseOwnerRepo
  assert.deepEqual(parseOwnerRepo('serphawk22/ticketing'), {
    owner: 'serphawk22',
    repo: 'ticketing',
    fullName: 'serphawk22/ticketing',
  });
  assert.equal(parseOwnerRepo('invalid-no-slash'), null);
  assert.equal(parseOwnerRepo('too/many/slashes'), null);
  assert.equal(parseOwnerRepo(''), null);
  assert.equal(parseOwnerRepo(null), null);

  // parsePullRequestUrl
  assert.deepEqual(parsePullRequestUrl('https://github.com/serphawk22/ticketing/pull/123'), {
    owner: 'serphawk22',
    repo: 'ticketing',
    pullNumber: 123,
    canonicalUrl: 'https://github.com/serphawk22/ticketing/pull/123',
  });
  assert.deepEqual(parsePullRequestUrl('https://github.com/serphawk22/ticketing/pull/123/'), {
    owner: 'serphawk22',
    repo: 'ticketing',
    pullNumber: 123,
    canonicalUrl: 'https://github.com/serphawk22/ticketing/pull/123',
  });
  assert.equal(parsePullRequestUrl('https://gitlab.com/serphawk22/ticketing/pull/123'), null);
  assert.equal(parsePullRequestUrl('https://github.com/serphawk22/ticketing/issues/123'), null);
  assert.equal(parsePullRequestUrl('invalid url'), null);

  // GitHubApiError instantiation
  const authErr = new GitHubApiError('Auth error', { status: 401, code: 'AUTH_FAILED', isTransient: false });
  assert.equal(authErr.status, 401);
  assert.equal(authErr.code, 'AUTH_FAILED');
  assert.equal(authErr.isTransient, false);

  const outageErr = new GitHubApiError('Outage', { status: 502, code: 'OUTAGE', isTransient: true });
  assert.equal(outageErr.status, 502);
  assert.equal(outageErr.isTransient, true);
});

test('7. Live GitHub API: verifies repository accessibility with configured GITHUB_TOKEN', async (t) => {
  assert.ok(isGithubConfigured(), 'GITHUB_TOKEN must be configured in test environment');

  try {
    // Verify access to serphawk22/ticketing repository
    const repoData = await verifyRepositoryAccess('serphawk22', 'ticketing');
    assert.equal(repoData.valid, true);
    assert.equal(repoData.owner.toLowerCase(), 'serphawk22');
    assert.equal(repoData.repo.toLowerCase(), 'ticketing');
    assert.ok(repoData.defaultBranch, 'Should return default branch');

    // Verify branch check on existing default branch
    const branchData = await verifyBranchExists('serphawk22', 'ticketing', repoData.defaultBranch);
    assert.equal(branchData.valid, true);
    assert.equal(branchData.branch, repoData.defaultBranch);
    assert.ok(branchData.commitSha, 'Should return commit SHA for branch');

    // Verify rejection with clear NOT_FOUND error for non-existent repository
    await assert.rejects(
      async () => {
        await verifyRepositoryAccess('serphawk22', 'non-existent-repository-xyz-999');
      },
      (err) => {
        assert.ok(err instanceof GitHubApiError);
        assert.equal(err.status, 404);
        assert.equal(err.code, 'NOT_FOUND');
        return true;
      }
    );

    // Verify rejection for non-existent branch
    await assert.rejects(
      async () => {
        await verifyBranchExists('serphawk22', 'ticketing', 'non-existent-branch-xyz-999');
      },
      (err) => {
        assert.ok(err instanceof GitHubApiError);
        assert.equal(err.status, 404);
        assert.equal(err.code, 'NOT_FOUND');
        return true;
      }
    );
  } catch (err) {
    if (err.isTransient || err.code === 'OUTAGE' || err.status === 503) {
      t.skip(`GitHub API unreachable in test environment: ${err.message}`);
    } else {
      throw err;
    }
  }
});
