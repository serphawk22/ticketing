import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test_phase6_uniqueness.db');

for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch {}
  }
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;

const { db, ensureMultiRepoGithubSchema } = await import('../lib/db.js');
const {
  createProjectRepository,
  findProjectRepository,
  getProjectRepositories,
} = await import('../lib/projectRepositories.js');

test.after(() => {
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(TEST_DB_PATH + ext)) {
      try { fs.unlinkSync(TEST_DB_PATH + ext); } catch {}
    }
  }
});

let testProjectId;

test('0. Setup test project', async () => {
  const pRes = await db.prepare(
    "INSERT INTO projects (key, name, description, color) VALUES ('UNIQ', 'Uniqueness Project', 'Testing case sensitivity', '#0c66e4')"
  ).run();
  testProjectId = Number(pRes.lastInsertRowid);
  assert.ok(testProjectId > 0);
});

test('1. Case-insensitive duplicate prevention: Owner/Repo, owner/repo, and OWNER/REPO via application layer', async () => {
  // Insert initial repository with MixedCase
  const repo1 = await createProjectRepository({
    projectId: testProjectId,
    owner: 'SerpHawk22',
    repo: 'Core-Platform',
    verificationStatus: 'verified',
  });

  assert.equal(repo1.github_owner, 'serphawk22');
  assert.equal(repo1.github_repo, 'core-platform');

  // Attempting to add with all lowercase
  await assert.rejects(
    async () => {
      await createProjectRepository({
        projectId: testProjectId,
        owner: 'serphawk22',
        repo: 'core-platform',
      });
    },
    (err) => {
      assert.equal(err.code, 'DUPLICATE_REPOSITORY');
      return true;
    }
  );

  // Attempting to add with all uppercase
  await assert.rejects(
    async () => {
      await createProjectRepository({
        projectId: testProjectId,
        owner: 'SERPHAWK22',
        repo: 'CORE-PLATFORM',
      });
    },
    (err) => {
      assert.equal(err.code, 'DUPLICATE_REPOSITORY');
      return true;
    }
  );

  // Attempting to add with inverse casing
  await assert.rejects(
    async () => {
      await createProjectRepository({
        projectId: testProjectId,
        owner: 'sERPhAWK22',
        repo: 'cORE-pLATFORM',
      });
    },
    (err) => {
      assert.equal(err.code, 'DUPLICATE_REPOSITORY');
      return true;
    }
  );
});

test('2. Database engine-level enforcement: raw SQL rejects duplicate casing via uq_project_repo_ci index', async () => {
  // Raw SQL insert bypassing application normalization should be rejected by uq_project_repo_ci
  await assert.rejects(
    async () => {
      await db.prepare(
        `INSERT INTO project_repositories (project_id, github_owner, github_repo, repository_url, is_active, verification_status)
         VALUES (?, 'SERPHAWK22', 'CORE-PLATFORM', 'https://github.com/SERPHAWK22/CORE-PLATFORM', 1, 'verified')`
      ).run(testProjectId);
    },
    /UNIQUE constraint failed/i
  );

  await assert.rejects(
    async () => {
      await db.prepare(
        `INSERT INTO project_repositories (project_id, github_owner, github_repo, repository_url, is_active, verification_status)
         VALUES (?, 'SerpHawk22', 'Core-Platform', 'https://github.com/SerpHawk22/Core-Platform', 1, 'verified')`
      ).run(testProjectId);
    },
    /UNIQUE constraint failed/i
  );
});

test('3. Migration duplicate safety check: aborts migration if pre-existing duplicate records exist without deleting data', async () => {
  // Create an isolated in-memory or temp SQLite database with pre-existing case-insensitive duplicates
  const Database = (await import('better-sqlite3')).default;
  const tempDbPath = path.resolve(process.cwd(), 'data', 'test_duplicate_migration_safety.db');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const rawConn = new Database(tempDbPath);
  rawConn.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY, key TEXT, name TEXT);
    INSERT INTO projects VALUES (1, 'P1', 'Proj 1');
    CREATE TABLE tickets (id INTEGER PRIMARY KEY, title TEXT);

    CREATE TABLE project_repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      github_owner TEXT,
      github_repo TEXT,
      repository_url TEXT,
      is_active INTEGER DEFAULT 1,
      verification_status TEXT DEFAULT 'unverified',
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (project_id, github_owner, github_repo)
    );

    -- Insert conflicting duplicate records with different casing
    INSERT INTO project_repositories (id, project_id, github_owner, github_repo, repository_url)
    VALUES (10, 1, 'serphawk22', 'conflicting-repo', 'url1');
    INSERT INTO project_repositories (id, project_id, github_owner, github_repo, repository_url)
    VALUES (11, 1, 'SerpHawk22', 'Conflicting-Repo', 'url2');
  `);

  const mockActive = {
    dialect: 'sqlite',
    prepare: (sql) => ({
      all: async () => rawConn.prepare(sql).all(),
    }),
    exec: async (sql) => rawConn.exec(sql),
  };

  // Running ensureMultiRepoGithubSchema must abort and throw an error reporting the duplicates
  await assert.rejects(
    async () => {
      await ensureMultiRepoGithubSchema(mockActive);
    },
    (err) => {
      assert.match(err.message, /Cannot create case-insensitive unique index uq_project_repo_ci/i);
      assert.match(err.message, /conflicting-repo/i);
      return true;
    }
  );

  // Verify that neither conflicting record was automatically deleted or rewritten
  const surviving = rawConn.prepare('SELECT id, github_owner, github_repo FROM project_repositories ORDER BY id').all();
  assert.equal(surviving.length, 2, 'Migration abort must NOT delete or rewrite any records');
  assert.equal(surviving[0].id, 10);
  assert.equal(surviving[0].github_owner, 'serphawk22');
  assert.equal(surviving[1].id, 11);
  assert.equal(surviving[1].github_owner, 'SerpHawk22');

  rawConn.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
});

test('4. Migration idempotency: running ensureMultiRepoGithubSchema twice succeeds cleanly', async () => {
  const activeDriver = {
    dialect: 'sqlite',
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
  };

  // Run 1
  await ensureMultiRepoGithubSchema(activeDriver);
  // Run 2
  await ensureMultiRepoGithubSchema(activeDriver);

  // Index still exists and enforces uniqueness
  const repos = await getProjectRepositories(testProjectId);
  assert.ok(repos.length >= 1);
});

test('5. Concurrent duplicate insertion safety simulation', async () => {
  await db.prepare(
    `INSERT INTO project_repositories (project_id, github_owner, github_repo, repository_url, is_active, verification_status)
     VALUES (?, 'UniqueOrg', 'RaceConditionRepo', 'url', 1, 'verified')`
  ).run(testProjectId);

  await assert.rejects(
    async () => {
      await db.prepare(
        `INSERT INTO project_repositories (project_id, github_owner, github_repo, repository_url, is_active, verification_status)
         VALUES (?, 'uniqueorg', 'raceconditionrepo', 'url', 1, 'verified')`
      ).run(testProjectId);
    },
    /UNIQUE constraint failed/i,
    'Second concurrent insert must fail unique constraint'
  );
});
