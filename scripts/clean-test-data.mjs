/**
 * QUARANTINED SCRIPT — DISABLED FOR PRODUCTION SAFETY.
 *
 * This legacy cleanup script previously ran unconditional `DELETE FROM ...` statements
 * across tickets, ticket_activity, departments, designations, employees, and attendance
 * while disabling SQLite foreign keys.
 *
 * It MUST NEVER be executed. Use `scripts/safe-clean-test-data.mjs --run-id=<test_run_id>`
 * strictly against an isolated test database or dedicated Neon development branch.
 */

throw new Error(
  '[SAFETY BLOCK] scripts/clean-test-data.mjs has been permanently disabled because it performs unscoped table wipes. ' +
    'Run `node scripts/safe-clean-test-data.mjs --run-id=<test_run_id>` against an isolated test DB instead.'
);
