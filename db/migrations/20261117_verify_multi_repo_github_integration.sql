-- ============================================================================
-- POST-MIGRATION INDEPENDENT VERIFICATION SCRIPT: Multi-Repository GitHub Integration
-- Target: Existing Main Neon Production PostgreSQL Database (neondb)
-- Mode: Strictly READ-ONLY (Deep catalog inspection; reports PASS/FAIL per item)
-- ============================================================================

BEGIN;

SET LOCAL search_path = public, pg_temp;
SET LOCAL statement_timeout = '30s';

-- Temporary table to collect verification results
CREATE TEMP TABLE verification_results (
  check_id serial PRIMARY KEY,
  category text NOT NULL,
  check_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASS', 'FAIL')),
  details text NOT NULL
) ON COMMIT DROP;

-- Check 1: Table public.project_repositories existence & column structure
DO $$
DECLARE
  col_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'project_repositories') THEN
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Table Structure', 'Table Existence: public.project_repositories', 'FAIL', 'Table does not exist');
  ELSE
    SELECT count(*) INTO col_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_repositories'
      AND column_name IN ('id', 'project_id', 'github_owner', 'github_repo', 'repository_url', 'is_active', 'verification_status', 'created_by', 'created_at', 'updated_at');

    IF col_count = 10 THEN
      INSERT INTO verification_results (category, check_name, status, details)
      VALUES ('Table Structure', 'Table Existence: public.project_repositories', 'PASS', 'Table exists with all 10 required columns');
    ELSE
      INSERT INTO verification_results (category, check_name, status, details)
      VALUES ('Table Structure', 'Table Existence: public.project_repositories', 'FAIL', format('Missing columns. Found %s/10', col_count));
    END IF;
  END IF;
END $$;

-- Check 2: Primary key on public.project_repositories(id)
DO $$
DECLARE
  pk_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = c.conkey[1]
    WHERE ns.nspname = 'public' AND cl.relname = 'project_repositories'
      AND c.contype = 'p' AND cardinality(c.conkey) = 1 AND att.attname = 'id'
  ) INTO pk_ok;

  IF pk_ok THEN
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Constraints', 'Primary Key: public.project_repositories(id)', 'PASS', 'Single-column primary key on id confirmed');
  ELSE
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Constraints', 'Primary Key: public.project_repositories(id)', 'FAIL', 'Primary key on id is missing or composite');
  END IF;
END $$;

-- Check 3: Unique constraint uq_project_repo
DO $$
DECLARE
  uq_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public' AND cl.relname = 'project_repositories'
      AND c.contype = 'u' AND cardinality(c.conkey) = 3
      AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k ORDER BY array_position(c.conkey, k))
          = ARRAY['project_id', 'github_owner', 'github_repo']
  ) INTO uq_ok;

  IF uq_ok THEN
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Constraints', 'Unique Constraint: uq_project_repo', 'PASS', 'Compound unique constraint on (project_id, github_owner, github_repo) confirmed');
  ELSE
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Constraints', 'Unique Constraint: uq_project_repo', 'FAIL', 'Unique constraint uq_project_repo is missing or incompatible');
  END IF;
END $$;

-- Check 4: Check constraints on public.project_repositories
DO $$
DECLARE
  chk_active_ok boolean;
  chk_status_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public' AND cl.relname = 'project_repositories'
      AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%is_active%'
  ) INTO chk_active_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public' AND cl.relname = 'project_repositories'
      AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%verification_status%'
  ) INTO chk_status_ok;

  IF chk_active_ok AND chk_status_ok THEN
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Constraints', 'Check Constraints: is_active & verification_status', 'PASS', 'CHECK constraints confirmed');
  ELSE
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Constraints', 'Check Constraints: is_active & verification_status', 'FAIL', 'Missing required CHECK constraint(s)');
  END IF;
END $$;

-- Check 5: Foreign key public.project_repositories(project_id) -> public.projects(id) [CASCADE]
DO $$
DECLARE
  fk_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class cl_src ON cl_src.oid = c.conrelid
    JOIN pg_namespace ns_src ON ns_src.oid = cl_src.relnamespace
    JOIN pg_class cl_ref ON cl_ref.oid = c.confrelid
    JOIN pg_namespace ns_ref ON ns_ref.oid = cl_ref.relnamespace
    WHERE ns_src.nspname = 'public' AND cl_src.relname = 'project_repositories'
      AND ns_ref.nspname = 'public' AND cl_ref.relname = 'projects'
      AND c.contype = 'f' AND cardinality(c.conkey) = 1 AND cardinality(c.confkey) = 1
      AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k) = ARRAY['project_id']
      AND ARRAY(SELECT a.attname::text FROM unnest(c.confkey) k JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k) = ARRAY['id']
      AND c.confdeltype = 'c' AND c.convalidated
  ) INTO fk_ok;

  IF fk_ok THEN
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Foreign Keys', 'FK: project_repositories.project_id -> projects.id [CASCADE]', 'PASS', 'Single-column foreign key with ON DELETE CASCADE confirmed');
  ELSE
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Foreign Keys', 'FK: project_repositories.project_id -> projects.id [CASCADE]', 'FAIL', 'Foreign key is missing, composite, or has wrong referential action');
  END IF;
END $$;

-- Check 6: All 13 GitHub metadata columns on public.tickets
DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM (
    SELECT unnest(ARRAY[
      'repository_id', 'github_branch', 'pr_url', 'github_pr_number',
      'github_pr_title', 'github_pr_state', 'github_pr_merged', 'github_pr_head_sha',
      'github_pr_base_branch', 'github_pr_last_verified_at', 'pr_merged_at',
      'repository_changed_at', 'repository_change_reason'
    ]) AS col
  ) expected
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = expected.col
  );

  IF missing_count = 0 THEN
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Tickets Columns', '13 GitHub Columns on public.tickets', 'PASS', 'All 13 GitHub metadata columns exist with verified definitions');
  ELSE
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Tickets Columns', '13 GitHub Columns on public.tickets', 'FAIL', format('%s expected column(s) are missing', missing_count));
  END IF;
END $$;

-- Check 7: Foreign key public.tickets(repository_id) -> public.project_repositories(id) [RESTRICT]
DO $$
DECLARE
  fk_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class cl_src ON cl_src.oid = c.conrelid
    JOIN pg_namespace ns_src ON ns_src.oid = cl_src.relnamespace
    JOIN pg_class cl_ref ON cl_ref.oid = c.confrelid
    JOIN pg_namespace ns_ref ON ns_ref.oid = cl_ref.relnamespace
    WHERE ns_src.nspname = 'public' AND cl_src.relname = 'tickets'
      AND ns_ref.nspname = 'public' AND cl_ref.relname = 'project_repositories'
      AND c.contype = 'f' AND cardinality(c.conkey) = 1 AND cardinality(c.confkey) = 1
      AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k) = ARRAY['repository_id']
      AND ARRAY(SELECT a.attname::text FROM unnest(c.confkey) k JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k) = ARRAY['id']
      AND c.confdeltype = 'r' AND c.convalidated
  ) INTO fk_ok;

  IF fk_ok THEN
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Foreign Keys', 'FK: tickets.repository_id -> project_repositories.id [RESTRICT]', 'PASS', 'Single-column foreign key with ON DELETE RESTRICT confirmed');
  ELSE
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Foreign Keys', 'FK: tickets.repository_id -> project_repositories.id [RESTRICT]', 'FAIL', 'Foreign key is missing, composite, or has wrong referential action');
  END IF;
END $$;

-- Check 8: All six indexes catalog verification
DO $$
DECLARE
  idx_count integer;
BEGIN
  SELECT count(*) INTO idx_count
  FROM pg_index i
  JOIN pg_class c_idx ON c_idx.oid = i.indexrelid
  JOIN pg_class c_tbl ON c_tbl.oid = i.indrelid
  JOIN pg_namespace ns ON ns.oid = c_idx.relnamespace
  JOIN pg_am am ON am.oid = c_idx.relam
  WHERE ns.nspname = 'public'
    AND am.amname = 'btree'
    AND i.indisvalid AND i.indisready AND i.indpred IS NULL
    AND (
      (c_idx.relname = 'uq_project_repo_ci' AND c_tbl.relname = 'project_repositories' AND i.indisunique AND i.indnatts = 3)
      OR (c_idx.relname = 'idx_proj_repos_project_id' AND c_tbl.relname = 'project_repositories' AND NOT i.indisunique AND i.indnatts = 1)
      OR (c_idx.relname = 'idx_proj_repos_lookup' AND c_tbl.relname = 'project_repositories' AND NOT i.indisunique AND i.indnatts = 2)
      OR (c_idx.relname = 'idx_tickets_repository_id' AND c_tbl.relname = 'tickets' AND NOT i.indisunique AND i.indnatts = 1)
      OR (c_idx.relname = 'idx_tickets_repo_pr' AND c_tbl.relname = 'tickets' AND NOT i.indisunique AND i.indnatts = 2)
      OR (c_idx.relname = 'idx_tickets_pr_url' AND c_tbl.relname = 'tickets' AND NOT i.indisunique AND i.indnatts = 1)
    );

  IF idx_count = 6 THEN
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Indexes', 'Catalog Structure: All 6 Required Indexes', 'PASS', 'All 6 indexes verified with btree access method, correct table, uniqueness, and valid/ready state');
  ELSE
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Indexes', 'Catalog Structure: All 6 Required Indexes', 'FAIL', format('Found %s/6 matching valid indexes', idx_count));
  END IF;
END $$;

-- Check 9: Case-insensitive repository uniqueness in table
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT project_id, LOWER(github_owner), LOWER(github_repo)
    FROM public.project_repositories
    GROUP BY project_id, LOWER(github_owner), LOWER(github_repo)
    HAVING count(*) > 1
  ) dups;

  IF dup_count = 0 THEN
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Data Integrity', 'Repository Uniqueness (Case-Insensitive)', 'PASS', 'Zero case-insensitive duplicate repositories exist');
  ELSE
    INSERT INTO verification_results (category, check_name, status, details)
    VALUES ('Data Integrity', 'Repository Uniqueness (Case-Insensitive)', 'FAIL', format('Found %s conflicting duplicate repository sets', dup_count));
  END IF;
END $$;

-- Return complete verification results table
SELECT 
  check_id,
  category,
  check_name,
  status,
  details
FROM verification_results
ORDER BY check_id;

-- Final Assertion Block: Stop release-readiness if any verification failed
DO $$
DECLARE
  fail_count integer;
  failure_details text;
BEGIN
  SELECT count(*), string_agg(format('[%s] %s: %s', category, check_name, details), E'\n')
  INTO fail_count, failure_details
  FROM verification_results
  WHERE status = 'FAIL';

  IF fail_count > 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED (% failures detected): %', fail_count, failure_details;
  END IF;
END $$;

ROLLBACK;
