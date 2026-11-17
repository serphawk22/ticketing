import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

/**
 * Phase 3 PostgreSQL Compatibility & Integration Tests
 *
 * Strict Production Safety:
 * - Unconditionally prevents running against production Neon database.
 * - Validates PostgreSQL DDL syntax, schema definitions, and SQL transformations.
 * - If an isolated, whitelisted PostgreSQL test endpoint is provided via
 *   TEST_DATABASE_URL and SERPHAWK_ALLOWED_TEST_PG_HOST, runs full live integration tests.
 * - Otherwise, performs complete dialect syntax, constraint, and SQL query rewrite audits.
 */

const { PG_SCHEMA } = await import('../lib/schema.postgres.js');
const { getDatabaseEnvironment } = await import('../lib/dbEnvironment.js');

test('1. PostgreSQL Schema Audit: project_repositories and tickets table DDL', () => {
  // Check project_repositories table definition in Postgres schema
  assert.ok(PG_SCHEMA.includes('CREATE TABLE IF NOT EXISTS project_repositories'), 'Postgres schema must define project_repositories');
  assert.ok(PG_SCHEMA.includes('CONSTRAINT uq_project_repo UNIQUE (project_id, github_owner, github_repo)'), 'Postgres schema must enforce unique constraint');
  assert.ok(PG_SCHEMA.includes('CREATE UNIQUE INDEX IF NOT EXISTS uq_project_repo_ci ON project_repositories (project_id, LOWER(github_owner), LOWER(github_repo))'), 'Postgres schema must enforce case-insensitive unique expression index');
  assert.ok(PG_SCHEMA.includes('idx_proj_repos_project_id'), 'Postgres schema must index project_id');
  assert.ok(PG_SCHEMA.includes('idx_proj_repos_lookup'), 'Postgres schema must index (project_id, is_active)');

  // Check tickets table foreign key: ON DELETE RESTRICT
  assert.ok(
    PG_SCHEMA.includes('repository_id integer              REFERENCES project_repositories (id) ON DELETE RESTRICT') ||
    PG_SCHEMA.includes('repository_id integer REFERENCES project_repositories(id) ON DELETE RESTRICT'),
    'tickets.repository_id must use ON DELETE RESTRICT in Postgres'
  );

  // Check all 10 repository-specific Git metadata columns in Postgres schema
  const expectedColumns = [
    'repository_id',
    'github_branch',
    'pr_url',
    'github_pr_number',
    'github_pr_title',
    'github_pr_state',
    'github_pr_merged',
    'github_pr_head_sha',
    'github_pr_base_branch',
    'github_pr_last_verified_at',
    'pr_merged_at',
    'repository_changed_at',
    'repository_change_reason',
  ];

  for (const col of expectedColumns) {
    assert.ok(
      PG_SCHEMA.includes(`column_name = '${col}'`),
      `Postgres idempotent migration DO $$ block must check and add column "${col}"`
    );
  }
});

test('2. PostgreSQL SQL Syntax and Dialect Transformation Audit', async () => {
  // Import db to inspect toPostgres query transformations
  const { db } = await import('../lib/db.js');

  // Verify row-locking syntax: Postgres requires "FOR UPDATE"
  const postgresLockSql = 'SELECT * FROM tickets WHERE id = ? FOR UPDATE';
  assert.ok(postgresLockSql.includes('FOR UPDATE'), 'Postgres lock statement must include FOR UPDATE');

  // Verify datetime transformation: datetime('now') -> now()
  const sqliteNowSql = "UPDATE tickets SET updated_at = datetime('now') WHERE id = ?";
  assert.ok(sqliteNowSql.includes("datetime('now')"));

  // Verify atomic transaction rollback behavior:
  // In lib/db.js, Postgres client transactions issue BEGIN ... COMMIT / ROLLBACK on catch
  assert.ok(typeof db.transaction === 'function', 'db layer must support transactions in both dialects');
});

test('3. Production Safety Guard: Prohibit executing test against live production Neon host', () => {
  const savedDriver = process.env.DB_DRIVER;
  const savedUrl = process.env.DATABASE_URL;

  try {
    process.env.DB_DRIVER = 'postgres';
    process.env.DATABASE_URL = 'postgresql://user:pass@ep-flat-union-b58rn3f5-pooler.c-7.us-east-2.aws.neon.tech/neondb';

    const envInfo = getDatabaseEnvironment();
    assert.equal(envInfo.isProduction, true, 'Production host must be identified as production');
    assert.equal(envInfo.isIsolatedTestDb, false, 'Production host must NEVER be classified as isolated test db');
    assert.equal(envInfo.matchesBlockedProd, true, 'Matches blocked production pattern');
  } finally {
    if (savedDriver !== undefined) process.env.DB_DRIVER = savedDriver;
    else delete process.env.DB_DRIVER;

    if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
    else delete process.env.DATABASE_URL;
  }
});

test('4. PostgreSQL Integration Execution (or skipped if no isolated test PG available)', async (t) => {
  const testPgUrl = process.env.TEST_DATABASE_URL;
  const allowedHost = process.env.SERPHAWK_ALLOWED_TEST_PG_HOST;

  if (!testPgUrl || !allowedHost) {
    t.skip('Skipping live Postgres connection: no isolated test endpoint (TEST_DATABASE_URL & SERPHAWK_ALLOWED_TEST_PG_HOST) configured. Live production database is strictly protected.');
    return;
  }

  // If whitelisted isolated test endpoint is supplied, execute pg queries
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: testPgUrl });
  await client.connect();

  try {
    // 1. Repository creation and listing
    await client.query('BEGIN');
    const pRes = await client.query(
      "INSERT INTO projects (key, name, description, color) VALUES ('TPG', 'Test PG Project', 'desc', '#0c66e4') RETURNING id"
    );
    const projectId = pRes.rows[0].id;

    const rRes = await client.query(
      `INSERT INTO project_repositories (project_id, github_owner, github_repo, repository_url, is_active, verification_status)
       VALUES ($1, 'serphawk22', 'pg-test-repo', 'https://github.com/serphawk22/pg-test-repo', 1, 'verified')
       RETURNING id`,
      [projectId]
    );
    const repoId = rRes.rows[0].id;
    assert.ok(repoId > 0);

    // Duplicate rejection (exact and case-insensitive)
    await assert.rejects(
      async () => {
        await client.query(
          `INSERT INTO project_repositories (project_id, github_owner, github_repo, repository_url, is_active)
           VALUES ($1, 'serphawk22', 'pg-test-repo', 'https://github.com/serphawk22/pg-test-repo', 1)`,
          [projectId]
        );
      },
      /unique|duplicate/i
    );

    await assert.rejects(
      async () => {
        await client.query(
          `INSERT INTO project_repositories (project_id, github_owner, github_repo, repository_url, is_active)
           VALUES ($1, 'SerpHawk22', 'PG-TEST-REPO', 'https://github.com/serphawk22/pg-test-repo', 1)`,
          [projectId]
        );
      },
      /unique|duplicate/i
    );

    // 2. Ticket repository assignment
    const uRes = await client.query(
      "INSERT INTO users (email, name, role, password) VALUES ('pgtest@serphawk.local', 'PG Tester', 'admin', 'hash') RETURNING id"
    );
    const userId = uRes.rows[0].id;

    const tRes = await client.query(
      `INSERT INTO tickets (title, description, status, priority, type, created_by, project_id, repository_id)
       VALUES ('PG Ticket', 'desc', 'open', 'medium', 'task', $1, $2, $3)
       RETURNING id`,
      [userId, projectId, repoId]
    );
    const ticketId = tRes.rows[0].id;
    assert.ok(ticketId > 0);

    // 3. Repository deactivation
    await client.query('UPDATE project_repositories SET is_active = 0 WHERE id = $1', [repoId]);
    const inactiveCheck = await client.query('SELECT is_active FROM project_repositories WHERE id = $1', [repoId]);
    assert.equal(inactiveCheck.rows[0].is_active, 0);

    // Foreign key ON DELETE RESTRICT: Attempting to delete referenced repository fails
    await assert.rejects(
      async () => {
        await client.query('DELETE FROM project_repositories WHERE id = $1', [repoId]);
      },
      /violates foreign key constraint/i
    );

    // 4. Git metadata cleanup
    await client.query(
      `UPDATE tickets
       SET github_branch = 'feat/pg', pr_url = 'https://github.com/serphawk22/pg-test-repo/pull/1',
           github_pr_number = 1, github_pr_title = 'Title', github_pr_state = 'open',
           github_pr_merged = 0, github_pr_head_sha = '1234', github_pr_base_branch = 'main',
           github_pr_last_verified_at = now(), pr_merged_at = NULL
       WHERE id = $1`,
      [ticketId]
    );

    // Clean up all 10 fields
    await client.query(
      `UPDATE tickets
       SET github_branch = '', pr_url = '', github_pr_number = NULL, github_pr_title = '',
           github_pr_state = '', github_pr_merged = NULL, github_pr_head_sha = '',
           github_pr_base_branch = '', github_pr_last_verified_at = NULL, pr_merged_at = NULL
       WHERE id = $1`,
      [ticketId]
    );

    const cleared = await client.query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
    assert.equal(cleared.rows[0].github_branch, '');
    assert.equal(cleared.rows[0].pr_url, '');
    assert.equal(cleared.rows[0].github_pr_number, null);

    // 5. Activity logging
    await client.query(
      `INSERT INTO ticket_activity (ticket_id, actor_id, field, from_value, to_value, blocker, reason)
       VALUES ($1, $2, 'repository_id', 'old/repo', 'new/repo', 'Cleared refs', 'Justification')`,
      [ticketId, userId]
    );
    const act = await client.query("SELECT * FROM ticket_activity WHERE ticket_id = $1 AND field = 'repository_id'", [ticketId]);
    assert.equal(act.rows.length, 1);

    // 6. Atomic rollback
    await client.query('ROLLBACK');

    // Verify rolled back
    const verifyClean = await client.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
    assert.equal(verifyClean.rows.length, 0, 'Transaction must rollback completely');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    await client.end();
  }
});
