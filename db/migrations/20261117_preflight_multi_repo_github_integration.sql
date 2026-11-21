-- ============================================================================
-- PREFLIGHT VERIFICATION SCRIPT: Multi-Repository GitHub Integration (Phases 1-6)
-- Target: Existing Main Neon Production PostgreSQL Database (neondb)
-- Mode: Strictly READ-ONLY (No state or data is mutated)
-- ============================================================================

SET default_transaction_read_only = on;
BEGIN TRANSACTION READ ONLY;

SET LOCAL search_path = public, pg_temp;
SET LOCAL statement_timeout = '30s';

-- 1. Database Version & Environment Identification
SELECT 
  current_database() AS database_name,
  current_user AS database_user,
  current_schema() AS default_schema,
  version() AS postgresql_version;

-- 2. Baseline Row Counts (Record fresh baseline before migration)
SELECT 
  (SELECT count(*) FROM public.projects) AS project_count,
  (SELECT count(*) FROM public.tickets) AS ticket_count,
  (SELECT count(*) FROM public.ticket_activity) AS activity_count,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'project_repositories') AS repo_table_exists,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'test_fixture_registry') AS test_registry_exists;

-- 3. Legacy Repository Data Inspection in public.projects
-- Inspect all non-empty github_repo values and verify their format
SELECT 
  p.id AS project_id,
  p.key AS project_key,
  p.github_repo AS raw_github_repo,
  TRIM(raw_item.item) AS raw_item,
  regexp_replace(
    regexp_replace(
      regexp_replace(TRIM(raw_item.item), '^https?://github\.com/', '', 'i'),
      '^git@github\.com:', '', 'i'
    ),
    '\.git$', '', 'i'
  ) AS normalized_item,
  CASE 
    WHEN regexp_replace(
      regexp_replace(
        regexp_replace(TRIM(raw_item.item), '^https?://github\.com/', '', 'i'),
        '^git@github\.com:', '', 'i'
      ),
      '\.git$', '', 'i'
    ) ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' THEN 'VALID'
    ELSE 'MALFORMED'
  END AS validation_status
FROM public.projects p,
LATERAL unnest(string_to_array(p.github_repo, ',')) AS raw_item(item)
WHERE p.github_repo IS NOT NULL AND TRIM(raw_item.item) <> '';

-- 4. Check for Any Conflicting Index Names Across Entire public Schema
SELECT 
  c_idx.relname AS index_name,
  c_tbl.relname AS attached_to_table,
  am.amname AS access_method,
  i.indisunique AS is_unique,
  i.indisvalid AS is_valid,
  i.indisready AS is_ready,
  pg_get_indexdef(i.indexrelid) AS index_def
FROM pg_index i
JOIN pg_class c_idx ON c_idx.oid = i.indexrelid
JOIN pg_class c_tbl ON c_tbl.oid = i.indrelid
JOIN pg_namespace ns ON ns.oid = c_idx.relnamespace
JOIN pg_am am ON am.oid = c_idx.relam
WHERE ns.nspname = 'public'
  AND c_idx.relname IN (
    'uq_project_repo_ci',
    'idx_proj_repos_project_id',
    'idx_proj_repos_lookup',
    'idx_tickets_repository_id',
    'idx_tickets_repo_pr',
    'idx_tickets_pr_url'
  )
ORDER BY c_idx.relname;

-- 5. Inspect Existing Structure of public.project_repositories (If It Exists)
SELECT 
  column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'project_repositories'
ORDER BY ordinal_position;

-- 6. Inspect Existing Constraints on public.project_repositories (If It Exists)
SELECT 
  c.conname,
  c.contype,
  pg_get_constraintdef(c.oid) AS constraint_def
FROM pg_constraint c
JOIN pg_class cl ON cl.oid = c.conrelid
JOIN pg_namespace ns ON ns.oid = cl.relnamespace
WHERE ns.nspname = 'public' AND cl.relname = 'project_repositories'
ORDER BY c.conname;

-- 7. Inspect Existing GitHub Metadata Columns on public.tickets (If Any Exist)
SELECT 
  column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tickets'
  AND column_name IN (
    'repository_id', 'github_branch', 'pr_url', 'github_pr_number',
    'github_pr_title', 'github_pr_state', 'github_pr_merged', 'github_pr_head_sha',
    'github_pr_base_branch', 'github_pr_last_verified_at', 'pr_merged_at',
    'repository_changed_at', 'repository_change_reason'
  )
ORDER BY column_name;

ROLLBACK;
