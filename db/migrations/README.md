# Production Migration Package: Multi-Repository GitHub Integration (Phases 1–6)

**Repository:** `serphawk22/ticketing`  
**Branch:** `feature/multi-repo-github-integration`  
**Audited Commit:** `09bef30d208cd5695fa1cc6b8421d6d7db12b47b`  
**Target Database:** Existing Main Neon Production PostgreSQL Database (`neondb`, PostgreSQL 18.7)

---

## 1. Migration Package Overview

This directory contains the single, authoritative, production-ready database migration package for the Multi-Repository GitHub Integration:

| File | Purpose | Execution Mode |
| :--- | :--- | :--- |
| `20261117_preflight_multi_repo_github_integration.sql` | Inspects database environment, captures baseline metrics, verifies legacy strings, and confirms readiness. | **Read-Only** (Transaction rolls back automatically) |
| `20261117_multi_repo_github_integration.sql` | The consolidated, idempotent migration script applying all Phase 1–6 database changes. | **Read-Write Atomic Transaction** (`BEGIN; ... COMMIT;`) |
| `20261117_verify_multi_repo_github_integration.sql` | Independent post-migration verification script returning PASS/FAIL for all schema, constraint, and index requirements. | **Read-Only** (Asserts zero failures) |

---

## 2. Key Safety & Architecture Principles

1. **Full Schema Qualification:** Every database object is explicitly qualified with `public.` (e.g. `public.projects`, `public.tickets`, `public.project_repositories`). `SET LOCAL search_path = public, pg_temp;` ensures total isolation.
2. **Transaction-Scoped Timeouts:** Uses `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '60s'`. Settings are strictly scoped to the transaction block and automatically expire on `COMMIT` or `ROLLBACK`.
3. **Deep Existing-Object Validation:**
   - Validates complete structure of `public.project_repositories` if it already exists (all 10 columns, types, nullability, PK, unique, check constraints).
   - Validates all 13 GitHub metadata columns on `public.tickets` if they already exist.
   - Enforces single-column foreign keys (`cardinality(c.conkey) = 1` and `cardinality(c.confkey) = 1`) with exact referential actions (`CASCADE` on projects, `RESTRICT` on tickets).
   - Schema-wide index validation verifying btree access method, table ownership, uniqueness, validity, readiness, and exact expression order.
4. **Data Preservation:** Zero existing production records are dropped, modified, or overwritten. Existing test fixtures (`test_fixture_registry`) and `test_run_id` columns are completely preserved.
5. **No Destructive Manual Rollbacks:** Prohibits `DROP TABLE ... CASCADE` or column drops, which cause irreversible data loss once application traffic commences.

---

## 3. Step-by-Step Execution Guide

### Step 1: Create Pre-Migration Recovery Snapshot in Neon
1. Log in to the [Neon Console](https://console.neon.tech/app/projects/ep-flat-union-b58rn3f5).
2. Navigate to **Branches** -> Click **New Branch**.
3. **Branch Name:** `pre-github-migration-backup-20261117`
4. **Parent Branch:** `main`
5. **Source Point:** `Current point in time` (record exact timestamp).
6. Click **Create Branch**.  
   *This creates an instant, zero-copy, copy-on-write snapshot of the database state.*

### Step 2: Execute Preflight Script (Read-Only)
Run the preflight inspection to confirm baseline row counts and schema readiness:
```bash
# Using psql:
psql "$DATABASE_URL" -f db/migrations/20261117_preflight_multi_repo_github_integration.sql
```
Confirm:
- PostgreSQL version is 18.x.
- All non-empty legacy strings in `projects.github_repo` report `VALID`.
- Baseline counts are recorded.

### Step 3: Execute Consolidated Migration
Execute the migration within a planned maintenance window:
```bash
# Using psql:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/20261117_multi_repo_github_integration.sql
```
*If any error or lock timeout occurs, the runner immediately stops and rolls back the transaction cleanly.*

### Step 4: Execute Post-Migration Independent Verification (Read-Only)
Run the independent verification script:
```bash
# Using psql:
psql "$DATABASE_URL" -f db/migrations/20261117_verify_multi_repo_github_integration.sql
```
Confirm:
- Every verification check returns `PASS`.
- The final assertion block completes without raising an exception.

### Step 5: Deploy Application Code
Merge feature branch `feature/multi-repo-github-integration` (`09bef30`) into `main` and deploy to production.

---

## 4. Recovery & Rollback Protocols

### Immediate Failure During Migration Execution
Because all changes are encapsulated inside a single atomic transaction block:
- If a statement encounters a lock timeout (after 5s) or any catalog validation exception, PostgreSQL automatically aborts the transaction.
- The runner must explicitly issue `ROLLBACK;`.
- The database remains 100% untouched.

### Recovery After Production Writes Have Occurred
If an issue is discovered after the application has written production data to the new schema:
1. **NEVER execute `DROP TABLE project_repositories CASCADE` or drop ticket columns.** Doing so destroys all linked PR metadata, branch head SHAs, closure verifications, and audit trails.
2. **Procedure:**
   - Put application into maintenance mode.
   - Run a data preservation export script to archive all post-migration tickets, PR links, and activity logs to external storage.
   - Point the application connection pool to the pre-migration snapshot branch (`pre-github-migration-backup-20261117`) or restore `main` using Neon Point-In-Time Recovery (PITR) to the timestamp recorded before migration.
   - Replay any non-corrupted post-migration tickets from the archive.
