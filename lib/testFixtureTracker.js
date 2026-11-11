import crypto from 'crypto';
import { db } from './db.js';
import { assertIsolatedTestDatabase } from './dbEnvironment.js';

/**
 * Creates a deterministic, unique identifier for an isolated test execution.
 */
export function generateTestRunId(prefix = 'run') {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${ts}_${rand}`;
}

/**
 * Tracks every synthetic record created during an isolated test run (both core tables
 * carrying `test_run_id` and dependent child tables) in `test_fixture_registry` so
 * `scripts/safe-clean-test-data.mjs --run-id=<id>` can remove 100% of test rows cleanly.
 */
export class TestFixtureTracker {
  constructor(runId = generateTestRunId()) {
    if (!runId || typeof runId !== 'string' || !runId.trim()) {
      throw new Error('TestFixtureTracker requires a non-empty test_run_id.');
    }
    assertIsolatedTestDatabase(`TestFixtureTracker(${runId})`);
    this.runId = runId.trim();
  }

  /**
   * Registers an exact `(table_name, record_id)` ownership pair idempotently.
   */
  async track(tableName, recordId) {
    if (!tableName || recordId === undefined || recordId === null || recordId === '') {
      throw new Error(`Invalid fixture track arguments: table=${tableName}, id=${recordId}`);
    }
    assertIsolatedTestDatabase(`TestFixtureTracker.track(${this.runId})`);
    await db
      .prepare(
        `INSERT OR IGNORE INTO test_fixture_registry (test_run_id, table_name, record_id)
         VALUES (?, ?, ?)`
      )
      .run(this.runId, String(tableName), String(recordId));
  }

  async trackMany(tableName, recordIds = []) {
    for (const id of recordIds) {
      await this.track(tableName, id);
    }
  }

  async listTracked() {
    assertIsolatedTestDatabase(`TestFixtureTracker.listTracked(${this.runId})`);
    return db
      .prepare(
        `SELECT table_name, record_id, created_at
         FROM test_fixture_registry
         WHERE test_run_id = ?
         ORDER BY id DESC`
      )
      .all(this.runId);
  }
}
