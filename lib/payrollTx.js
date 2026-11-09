import { db } from './db.js';

let txDepth = 0;

/**
 * Execute a function within a transactional scope with workspace context set.
 * Supports re-entrant / nested transaction calls via savepoints.
 * In Postgres, sets 'app.current_workspace_id' session config for RLS.
 * In SQLite, guarantees atomic BEGIN / COMMIT / ROLLBACK semantics.
 *
 * @param {number|string} workspaceId - The tenant workspace ID
 * @param {Function} callback - Async callback receiving the db helper
 */
export async function withPayrollTransaction(workspaceId, callback) {
  if (!workspaceId) {
    throw new Error('payrollTx: workspaceId is required to open a tenant transaction');
  }

  const isRoot = txDepth === 0;
  txDepth++;

  if (isRoot) {
    await db.exec('BEGIN');
  } else {
    try {
      await db.exec(`SAVEPOINT sp_${txDepth}`);
    } catch {
      // In dialect where SAVEPOINT syntax varies
    }
  }

  try {
    if (isRoot) {
      try {
        await db.exec(`SELECT set_config('app.current_workspace_id', '${String(workspaceId).replace(/'/g, "''")}', true)`);
      } catch {
        // In SQLite, set_config does not exist and fails gracefully.
      }
    }

    const result = await callback(db);

    if (isRoot) {
      await db.exec('COMMIT');
    } else {
      try {
        await db.exec(`RELEASE SAVEPOINT sp_${txDepth}`);
      } catch {
        // ignore
      }
    }
    return result;
  } catch (error) {
    if (isRoot) {
      try {
        await db.exec('ROLLBACK');
      } catch (rbErr) {
        console.error('payrollTx rollback error:', rbErr);
      }
    } else {
      try {
        await db.exec(`ROLLBACK TO SAVEPOINT sp_${txDepth}`);
      } catch {
        // ignore
      }
    }
    throw error;
  } finally {
    txDepth--;
  }
}
