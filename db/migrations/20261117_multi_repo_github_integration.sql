-- ============================================================================
-- CONSOLIDATED PRODUCTION MIGRATION: Multi-Repository GitHub Integration (Phases 1-6)
-- Target: Existing Main Neon Production PostgreSQL Database (neondb)
-- Engine: PostgreSQL 18.7
-- Safety: Single Atomic Transaction, Full 'public.' Schema Qualification,
--         Deep Existing-Object Structure Validation, Single-Column Foreign Key
--         Enforcement, Catalog-Based Index Verification, Idempotent Backfill
-- ============================================================================

BEGIN;

-- Step 1: Enforce Safe Transaction-Local Search Path and Protective Timeouts
SET LOCAL search_path = public, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ============================================================================
-- Step 2: Preflight Data Integrity Validation on Legacy Repository Strings
-- Aborts immediately if malformed repository strings exist in public.projects.
-- Uses explicit column alias 'raw_item(item)' and uniform cleaning logic.
-- ============================================================================
DO $$
DECLARE
  rec RECORD;
  clean_entry text;
BEGIN
  FOR rec IN 
    SELECT p.id, p.key, p.github_repo, TRIM(raw_item.item) AS raw_item
    FROM public.projects p,
    LATERAL unnest(string_to_array(p.github_repo, ',')) AS raw_item(item)
    WHERE p.github_repo IS NOT NULL AND TRIM(raw_item.item) <> ''
  LOOP
    -- Uniform normalization expression across preflight and backfill
    clean_entry := regexp_replace(
      regexp_replace(
        regexp_replace(TRIM(rec.raw_item), '^https?://github\.com/', '', 'i'),
        '^git@github\.com:', '', 'i'
      ),
      '\.git$', '', 'i'
    );

    -- Strict GitHub repository format validation: [owner]/[repo]
    IF clean_entry !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' THEN
      RAISE EXCEPTION 'Pre-migration check failed: Project ID % (%) contains invalid repository string: "%" (normalized: "%")', 
        rec.id, rec.key, rec.raw_item, clean_entry;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- Step 3: Complete Existing Table Structure Validation for public.project_repositories
-- (If table already exists, validates all 10 columns, types, nullability, PK,
--  unique constraint, and check constraints before accepting it)
-- ============================================================================
DO $$
DECLARE
  col_rec RECORD;
  pk_exists boolean;
  uq_exists boolean;
  chk_active_exists boolean;
  chk_status_exists boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'project_repositories'
  ) THEN
    -- Validate column data types and nullabilities
    FOR col_rec IN
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'project_repositories'
    LOOP
      IF col_rec.column_name = 'id' AND (col_rec.data_type NOT IN ('integer', 'bigint') OR col_rec.is_nullable <> 'NO') THEN
        RAISE EXCEPTION 'Pre-migration check failed: Existing public.project_repositories.id column is invalid (type: %, nullable: %)', col_rec.data_type, col_rec.is_nullable;
      ELSIF col_rec.column_name = 'project_id' AND (col_rec.data_type NOT IN ('integer', 'bigint') OR col_rec.is_nullable <> 'NO') THEN
        RAISE EXCEPTION 'Pre-migration check failed: Existing public.project_repositories.project_id column is invalid (type: %, nullable: %)', col_rec.data_type, col_rec.is_nullable;
      ELSIF col_rec.column_name IN ('github_owner', 'github_repo', 'repository_url', 'verification_status') AND (col_rec.data_type NOT IN ('text', 'character varying') OR col_rec.is_nullable <> 'NO') THEN
        RAISE EXCEPTION 'Pre-migration check failed: Existing public.project_repositories.% column is invalid (type: %, nullable: %)', col_rec.column_name, col_rec.data_type, col_rec.is_nullable;
      ELSIF col_rec.column_name = 'is_active' AND (col_rec.data_type NOT IN ('integer', 'smallint') OR col_rec.is_nullable <> 'NO') THEN
        RAISE EXCEPTION 'Pre-migration check failed: Existing public.project_repositories.is_active column is invalid (type: %, nullable: %)', col_rec.data_type, col_rec.is_nullable;
      ELSIF col_rec.column_name IN ('created_at', 'updated_at') AND (col_rec.data_type <> 'timestamp with time zone' OR col_rec.is_nullable <> 'NO') THEN
        RAISE EXCEPTION 'Pre-migration check failed: Existing public.project_repositories.% column is invalid (type: %, nullable: %)', col_rec.column_name, col_rec.data_type, col_rec.is_nullable;
      END IF;
    END LOOP;

    -- Verify all 10 required columns exist
    IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_repositories' AND column_name IN (
      'id', 'project_id', 'github_owner', 'github_repo', 'repository_url', 'is_active', 'verification_status', 'created_by', 'created_at', 'updated_at'
    )) < 10 THEN
      RAISE EXCEPTION 'Pre-migration check failed: Existing public.project_repositories table is missing required columns.';
    END IF;

    -- Validate Primary Key constraint on id
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = c.conkey[1]
      WHERE ns.nspname = 'public' AND cl.relname = 'project_repositories'
        AND c.contype = 'p' AND cardinality(c.conkey) = 1 AND att.attname = 'id'
    ) INTO pk_exists;
    IF NOT pk_exists THEN
      RAISE EXCEPTION 'Pre-migration check failed: Existing public.project_repositories table is missing primary key on id.';
    END IF;

    -- Validate Unique constraint uq_project_repo on (project_id, github_owner, github_repo)
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE ns.nspname = 'public' AND cl.relname = 'project_repositories'
        AND c.contype = 'u' AND cardinality(c.conkey) = 3
        AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k ORDER BY array_position(c.conkey, k))
            = ARRAY['project_id', 'github_owner', 'github_repo']
    ) INTO uq_exists;
    IF NOT uq_exists THEN
      RAISE EXCEPTION 'Pre-migration check failed: Existing public.project_repositories table is missing unique constraint uq_project_repo on (project_id, github_owner, github_repo).';
    END IF;

    -- Validate Check constraint on is_active IN (0, 1)
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE ns.nspname = 'public' AND cl.relname = 'project_repositories'
        AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%is_active%'
    ) INTO chk_active_exists;
    IF NOT chk_active_exists THEN
      RAISE EXCEPTION 'Pre-migration check failed: Existing public.project_repositories table is missing CHECK constraint on is_active.';
    END IF;

    -- Validate Check constraint on verification_status
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE ns.nspname = 'public' AND cl.relname = 'project_repositories'
        AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%verification_status%'
    ) INTO chk_status_exists;
    IF NOT chk_status_exists THEN
      RAISE EXCEPTION 'Pre-migration check failed: Existing public.project_repositories table is missing CHECK constraint on verification_status.';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- Step 4: DDL - Create public.project_repositories Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.project_repositories (
  id                  integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  project_id          integer     NOT NULL,
  github_owner        text        NOT NULL,
  github_repo         text        NOT NULL,
  repository_url      text        NOT NULL,
  is_active           integer     NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  verification_status text        NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'failed')),
  created_by          integer              REFERENCES public.users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_repo UNIQUE (project_id, github_owner, github_repo)
);

-- ============================================================================
-- Step 5: Catalog-Based Foreign Key Validation & Creation on public.project_repositories
-- 1. project_id -> public.projects(id) [CASCADE]
-- 2. created_by -> public.users(id)
-- ============================================================================
DO $$
DECLARE
  fk_rec RECORD;
  found_project_fk boolean := false;
  found_created_by_fk boolean := false;
BEGIN
  -- Validate project_id foreign key
  FOR fk_rec IN
    SELECT 
      c.conname,
      ns_src.nspname AS src_schema,
      cl_src.relname AS src_table,
      ns_ref.nspname AS ref_schema,
      cl_ref.relname AS ref_table,
      c.confdeltype,
      c.convalidated,
      cardinality(c.conkey) AS num_src_cols,
      cardinality(c.confkey) AS num_ref_cols,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k ORDER BY array_position(c.conkey, k)) AS src_cols,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) k JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k ORDER BY array_position(c.confkey, k)) AS ref_cols
    FROM pg_constraint c
    JOIN pg_class cl_src ON cl_src.oid = c.conrelid
    JOIN pg_namespace ns_src ON ns_src.oid = cl_src.relnamespace
    JOIN pg_class cl_ref ON cl_ref.oid = c.confrelid
    JOIN pg_namespace ns_ref ON ns_ref.oid = cl_ref.relnamespace
    WHERE ns_src.nspname = 'public'
      AND cl_src.relname = 'project_repositories'
      AND c.contype = 'f'
      AND c.conkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = cl_src.oid AND attname = 'project_id')
  LOOP
    IF fk_rec.num_src_cols = 1 
       AND fk_rec.num_ref_cols = 1
       AND fk_rec.src_cols = ARRAY['project_id']
       AND fk_rec.ref_cols = ARRAY['id']
       AND fk_rec.ref_schema = 'public' 
       AND fk_rec.ref_table = 'projects' 
       AND fk_rec.confdeltype = 'c'
       AND fk_rec.convalidated THEN
      found_project_fk := true;
    ELSE
      RAISE EXCEPTION 'Pre-migration check failed: Existing foreign key "%" on public.project_repositories is incompatible. (Source: %.%(%), Target: %.%(%), delete_action: %, validated: %). Expected single-column public.projects(id) with ON DELETE CASCADE.',
        fk_rec.conname, fk_rec.src_schema, fk_rec.src_table, fk_rec.src_cols,
        fk_rec.ref_schema, fk_rec.ref_table, fk_rec.ref_cols,
        fk_rec.confdeltype, fk_rec.convalidated;
    END IF;
  END LOOP;

  IF NOT found_project_fk THEN
    ALTER TABLE public.project_repositories
      ADD CONSTRAINT fk_project_repositories_project
      FOREIGN KEY (project_id) REFERENCES public.projects (id) ON DELETE CASCADE;
  END IF;

  -- Validate created_by foreign key
  FOR fk_rec IN
    SELECT 
      c.conname,
      ns_src.nspname AS src_schema,
      cl_src.relname AS src_table,
      ns_ref.nspname AS ref_schema,
      cl_ref.relname AS ref_table,
      c.convalidated,
      cardinality(c.conkey) AS num_src_cols,
      cardinality(c.confkey) AS num_ref_cols,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k ORDER BY array_position(c.conkey, k)) AS src_cols,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) k JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k ORDER BY array_position(c.confkey, k)) AS ref_cols
    FROM pg_constraint c
    JOIN pg_class cl_src ON cl_src.oid = c.conrelid
    JOIN pg_namespace ns_src ON ns_src.oid = cl_src.relnamespace
    JOIN pg_class cl_ref ON cl_ref.oid = c.confrelid
    JOIN pg_namespace ns_ref ON ns_ref.oid = cl_ref.relnamespace
    WHERE ns_src.nspname = 'public'
      AND cl_src.relname = 'project_repositories'
      AND c.contype = 'f'
      AND c.conkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = cl_src.oid AND attname = 'created_by')
  LOOP
    IF fk_rec.num_src_cols = 1 
       AND fk_rec.num_ref_cols = 1
       AND fk_rec.src_cols = ARRAY['created_by']
       AND fk_rec.ref_cols = ARRAY['id']
       AND fk_rec.ref_schema = 'public' 
       AND fk_rec.ref_table = 'users'
       AND fk_rec.convalidated THEN
      found_created_by_fk := true;
    ELSE
      RAISE EXCEPTION 'Pre-migration check failed: Existing foreign key "%" on public.project_repositories.created_by is incompatible. (Source: %.%(%), Target: %.%(%)). Expected single-column public.users(id).',
        fk_rec.conname, fk_rec.src_schema, fk_rec.src_table, fk_rec.src_cols,
        fk_rec.ref_schema, fk_rec.ref_table, fk_rec.ref_cols;
    END IF;
  END LOOP;

  IF NOT found_created_by_fk THEN
    ALTER TABLE public.project_repositories
      ADD CONSTRAINT fk_project_repositories_created_by
      FOREIGN KEY (created_by) REFERENCES public.users (id);
  END IF;
END $$;

-- ============================================================================
-- Step 6: Catalog-Based Index Validation & Creation on public.project_repositories
-- Structural verification: access method, target table, uniqueness, validity,
-- readiness, non-partial, and exact expression order
-- ============================================================================
DO $$
DECLARE
  rec RECORD;
BEGIN
  -- Validate idx_proj_repos_project_id
  FOR rec IN
    SELECT c_idx.relname AS index_name, c_tbl.relname AS table_name, am.amname, i.indnatts, i.indisunique, i.indisvalid, i.indisready,
           (i.indpred IS NOT NULL) AS is_partial, pg_get_indexdef(i.indexrelid, 1, false) AS col1
    FROM pg_index i
    JOIN pg_class c_idx ON c_idx.oid = i.indexrelid
    JOIN pg_class c_tbl ON c_tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = c_idx.relnamespace
    JOIN pg_am am ON am.oid = c_idx.relam
    WHERE ns.nspname = 'public' AND c_idx.relname = 'idx_proj_repos_project_id'
  LOOP
    IF rec.table_name <> 'project_repositories' THEN
      RAISE EXCEPTION 'Index validation failure: Index "idx_proj_repos_project_id" already exists in public on table "%" (expected project_repositories)', rec.table_name;
    ELSIF rec.amname <> 'btree' OR rec.indnatts <> 1 OR rec.col1 <> 'project_id' OR rec.indisunique OR NOT rec.indisvalid OR NOT rec.indisready OR rec.is_partial THEN
      RAISE EXCEPTION 'Index validation failure: Existing index "idx_proj_repos_project_id" has incompatible structural definition.';
    END IF;
  END LOOP;

  -- Validate idx_proj_repos_lookup
  FOR rec IN
    SELECT c_idx.relname AS index_name, c_tbl.relname AS table_name, am.amname, i.indnatts, i.indisunique, i.indisvalid, i.indisready,
           (i.indpred IS NOT NULL) AS is_partial, pg_get_indexdef(i.indexrelid, 1, false) AS col1, pg_get_indexdef(i.indexrelid, 2, false) AS col2
    FROM pg_index i
    JOIN pg_class c_idx ON c_idx.oid = i.indexrelid
    JOIN pg_class c_tbl ON c_tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = c_idx.relnamespace
    JOIN pg_am am ON am.oid = c_idx.relam
    WHERE ns.nspname = 'public' AND c_idx.relname = 'idx_proj_repos_lookup'
  LOOP
    IF rec.table_name <> 'project_repositories' THEN
      RAISE EXCEPTION 'Index validation failure: Index "idx_proj_repos_lookup" already exists in public on table "%" (expected project_repositories)', rec.table_name;
    ELSIF rec.amname <> 'btree' OR rec.indnatts <> 2 OR rec.col1 <> 'project_id' OR rec.col2 <> 'is_active' OR rec.indisunique OR NOT rec.indisvalid OR NOT rec.indisready OR rec.is_partial THEN
      RAISE EXCEPTION 'Index validation failure: Existing index "idx_proj_repos_lookup" has incompatible structural definition.';
    END IF;
  END LOOP;

  -- Validate uq_project_repo_ci
  FOR rec IN
    SELECT c_idx.relname AS index_name, c_tbl.relname AS table_name, am.amname, i.indnatts, i.indisunique, i.indisvalid, i.indisready,
           (i.indpred IS NOT NULL) AS is_partial,
           pg_get_indexdef(i.indexrelid, 1, false) AS col1,
           pg_get_indexdef(i.indexrelid, 2, false) AS col2,
           pg_get_indexdef(i.indexrelid, 3, false) AS col3
    FROM pg_index i
    JOIN pg_class c_idx ON c_idx.oid = i.indexrelid
    JOIN pg_class c_tbl ON c_tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = c_idx.relnamespace
    JOIN pg_am am ON am.oid = c_idx.relam
    WHERE ns.nspname = 'public' AND c_idx.relname = 'uq_project_repo_ci'
  LOOP
    IF rec.table_name <> 'project_repositories' THEN
      RAISE EXCEPTION 'Index validation failure: Index "uq_project_repo_ci" already exists in public on table "%" (expected project_repositories)', rec.table_name;
    ELSIF rec.amname <> 'btree' OR rec.indnatts <> 3 OR rec.col1 <> 'project_id' OR rec.col2 <> 'lower(github_owner)' OR rec.col3 <> 'lower(github_repo)' OR NOT rec.indisunique OR NOT rec.indisvalid OR NOT rec.indisready OR rec.is_partial THEN
      RAISE EXCEPTION 'Index validation failure: Existing index "uq_project_repo_ci" has incompatible structural definition.';
    END IF;
  END LOOP;
END $$;

-- Inspect existing records for case-insensitive duplicates before applying index
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.project_repositories
    GROUP BY project_id, LOWER(github_owner), LOWER(github_repo)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Pre-migration check failed: Conflicting case-insensitive duplicate repository records found in public.project_repositories';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_proj_repos_project_id ON public.project_repositories (project_id);
CREATE INDEX IF NOT EXISTS idx_proj_repos_lookup ON public.project_repositories (project_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_repo_ci ON public.project_repositories (project_id, LOWER(github_owner), LOWER(github_repo));

-- ============================================================================
-- Step 7: Complete Existing Column Validation & Safe Addition for public.tickets
-- Validates: column name, exact data type, nullability, and default expression
-- ============================================================================
DO $$
DECLARE
  col_rec RECORD;
BEGIN
  -- Deep validation of all 13 GitHub columns if already present on tickets
  FOR col_rec IN
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets'
      AND column_name IN (
        'repository_id', 'github_branch', 'pr_url', 'github_pr_number',
        'github_pr_title', 'github_pr_state', 'github_pr_merged', 'github_pr_head_sha',
        'github_pr_base_branch', 'github_pr_last_verified_at', 'pr_merged_at',
        'repository_changed_at', 'repository_change_reason'
      )
  LOOP
    IF col_rec.column_name = 'repository_id' AND (col_rec.data_type NOT IN ('integer', 'bigint') OR col_rec.is_nullable <> 'YES') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Existing public.tickets.repository_id has invalid type % (nullable: %)', col_rec.data_type, col_rec.is_nullable;
    ELSIF col_rec.column_name = 'github_pr_number' AND (col_rec.data_type NOT IN ('integer', 'bigint') OR col_rec.is_nullable <> 'YES') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Existing public.tickets.github_pr_number has invalid type % (nullable: %)', col_rec.data_type, col_rec.is_nullable;
    ELSIF col_rec.column_name = 'github_pr_merged' AND (col_rec.data_type NOT IN ('integer', 'smallint') OR col_rec.is_nullable <> 'YES') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Existing public.tickets.github_pr_merged has invalid type % (nullable: %)', col_rec.data_type, col_rec.is_nullable;
    ELSIF col_rec.column_name IN ('github_pr_last_verified_at', 'pr_merged_at', 'repository_changed_at') AND (col_rec.data_type <> 'timestamp with time zone' OR col_rec.is_nullable <> 'YES') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Existing public.tickets.% has invalid type % (nullable: %)', col_rec.column_name, col_rec.data_type, col_rec.is_nullable;
    ELSIF col_rec.column_name = 'repository_change_reason' AND (col_rec.data_type NOT IN ('text', 'character varying') OR col_rec.is_nullable <> 'YES') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Existing public.tickets.repository_change_reason has invalid type % (nullable: %)', col_rec.data_type, col_rec.is_nullable;
    ELSIF col_rec.column_name IN ('github_branch', 'pr_url', 'github_pr_title', 'github_pr_state', 'github_pr_head_sha', 'github_pr_base_branch') AND (col_rec.data_type NOT IN ('text', 'character varying') OR col_rec.is_nullable <> 'NO') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Existing public.tickets.% has invalid type % (nullable: %)', col_rec.column_name, col_rec.data_type, col_rec.is_nullable;
    END IF;
  END LOOP;

  -- Add missing columns safely
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'repository_id') THEN
    ALTER TABLE public.tickets ADD COLUMN repository_id integer;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'github_branch') THEN
    ALTER TABLE public.tickets ADD COLUMN github_branch text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'pr_url') THEN
    ALTER TABLE public.tickets ADD COLUMN pr_url text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'github_pr_number') THEN
    ALTER TABLE public.tickets ADD COLUMN github_pr_number integer;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'github_pr_title') THEN
    ALTER TABLE public.tickets ADD COLUMN github_pr_title text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'github_pr_state') THEN
    ALTER TABLE public.tickets ADD COLUMN github_pr_state text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'github_pr_merged') THEN
    ALTER TABLE public.tickets ADD COLUMN github_pr_merged integer DEFAULT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'github_pr_head_sha') THEN
    ALTER TABLE public.tickets ADD COLUMN github_pr_head_sha text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'github_pr_base_branch') THEN
    ALTER TABLE public.tickets ADD COLUMN github_pr_base_branch text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'github_pr_last_verified_at') THEN
    ALTER TABLE public.tickets ADD COLUMN github_pr_last_verified_at timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'pr_merged_at') THEN
    ALTER TABLE public.tickets ADD COLUMN pr_merged_at timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'repository_changed_at') THEN
    ALTER TABLE public.tickets ADD COLUMN repository_changed_at timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'repository_change_reason') THEN
    ALTER TABLE public.tickets ADD COLUMN repository_change_reason text;
  END IF;
END $$;

-- ============================================================================
-- Step 8: Catalog-Based Foreign Key Validation & Creation on public.tickets(repository_id)
-- Verifies: public.tickets(repository_id) -> public.project_repositories(id) [RESTRICT]
-- Rejects composite FKs, wrong targets, or non-RESTRICT referential actions.
-- ============================================================================
DO $$
DECLARE
  fk_rec RECORD;
  found_valid_fk boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'repository_id'
  ) THEN
    FOR fk_rec IN
      SELECT 
        c.conname,
        ns_src.nspname AS src_schema,
        cl_src.relname AS src_table,
        ns_ref.nspname AS ref_schema,
        cl_ref.relname AS ref_table,
        c.confdeltype,
        c.convalidated,
        cardinality(c.conkey) AS num_src_cols,
        cardinality(c.confkey) AS num_ref_cols,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k ORDER BY array_position(c.conkey, k)) AS src_cols,
        ARRAY(SELECT a.attname::text FROM unnest(c.confkey) k JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k ORDER BY array_position(c.confkey, k)) AS ref_cols
      FROM pg_constraint c
      JOIN pg_class cl_src ON cl_src.oid = c.conrelid
      JOIN pg_namespace ns_src ON ns_src.oid = cl_src.relnamespace
      JOIN pg_class cl_ref ON cl_ref.oid = c.confrelid
      JOIN pg_namespace ns_ref ON ns_ref.oid = cl_ref.relnamespace
      WHERE ns_src.nspname = 'public'
        AND cl_src.relname = 'tickets'
        AND c.contype = 'f'
        AND c.conkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = cl_src.oid AND attname = 'repository_id')
    LOOP
      IF fk_rec.num_src_cols = 1 
         AND fk_rec.num_ref_cols = 1
         AND fk_rec.src_cols = ARRAY['repository_id']
         AND fk_rec.ref_cols = ARRAY['id']
         AND fk_rec.ref_schema = 'public' 
         AND fk_rec.ref_table = 'project_repositories' 
         AND fk_rec.confdeltype = 'r'
         AND fk_rec.convalidated THEN
        found_valid_fk := true;
      ELSE
        RAISE EXCEPTION 'Pre-migration check failed: Existing foreign key "%" on public.tickets is incompatible. (Source: %.%(%), Target: %.%(%), delete_action: %, validated: %). Expected single-column public.project_repositories(id) with ON DELETE RESTRICT.',
          fk_rec.conname, fk_rec.src_schema, fk_rec.src_table, fk_rec.src_cols,
          fk_rec.ref_schema, fk_rec.ref_table, fk_rec.ref_cols,
          fk_rec.confdeltype, fk_rec.convalidated;
      END IF;
    END LOOP;

    IF NOT found_valid_fk THEN
      ALTER TABLE public.tickets
        ADD CONSTRAINT fk_tickets_repository
        FOREIGN KEY (repository_id) REFERENCES public.project_repositories (id) ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;

-- ============================================================================
-- Step 9: Catalog-Based Index Validation & Creation on public.tickets
-- Structural verification: access method, target table, uniqueness, validity,
-- readiness, non-partial, and exact expression order
-- ============================================================================
DO $$
DECLARE
  rec RECORD;
BEGIN
  -- Validate idx_tickets_repository_id
  FOR rec IN
    SELECT c_idx.relname AS index_name, c_tbl.relname AS table_name, am.amname, i.indnatts, i.indisunique, i.indisvalid, i.indisready,
           (i.indpred IS NOT NULL) AS is_partial, pg_get_indexdef(i.indexrelid, 1, false) AS col1
    FROM pg_index i
    JOIN pg_class c_idx ON c_idx.oid = i.indexrelid
    JOIN pg_class c_tbl ON c_tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = c_idx.relnamespace
    JOIN pg_am am ON am.oid = c_idx.relam
    WHERE ns.nspname = 'public' AND c_idx.relname = 'idx_tickets_repository_id'
  LOOP
    IF rec.table_name <> 'tickets' THEN
      RAISE EXCEPTION 'Index validation failure: Index "idx_tickets_repository_id" already exists in public on table "%" (expected tickets)', rec.table_name;
    ELSIF rec.amname <> 'btree' OR rec.indnatts <> 1 OR rec.col1 <> 'repository_id' OR rec.indisunique OR NOT rec.indisvalid OR NOT rec.indisready OR rec.is_partial THEN
      RAISE EXCEPTION 'Index validation failure: Existing index "idx_tickets_repository_id" has incompatible structural definition.';
    END IF;
  END LOOP;

  -- Validate idx_tickets_repo_pr
  FOR rec IN
    SELECT c_idx.relname AS index_name, c_tbl.relname AS table_name, am.amname, i.indnatts, i.indisunique, i.indisvalid, i.indisready,
           (i.indpred IS NOT NULL) AS is_partial, pg_get_indexdef(i.indexrelid, 1, false) AS col1, pg_get_indexdef(i.indexrelid, 2, false) AS col2
    FROM pg_index i
    JOIN pg_class c_idx ON c_idx.oid = i.indexrelid
    JOIN pg_class c_tbl ON c_tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = c_idx.relnamespace
    JOIN pg_am am ON am.oid = c_idx.relam
    WHERE ns.nspname = 'public' AND c_idx.relname = 'idx_tickets_repo_pr'
  LOOP
    IF rec.table_name <> 'tickets' THEN
      RAISE EXCEPTION 'Index validation failure: Index "idx_tickets_repo_pr" already exists in public on table "%" (expected tickets)', rec.table_name;
    ELSIF rec.amname <> 'btree' OR rec.indnatts <> 2 OR rec.col1 <> 'repository_id' OR rec.col2 <> 'github_pr_number' OR rec.indisunique OR NOT rec.indisvalid OR NOT rec.indisready OR rec.is_partial THEN
      RAISE EXCEPTION 'Index validation failure: Existing index "idx_tickets_repo_pr" has incompatible structural definition.';
    END IF;
  END LOOP;

  -- Validate idx_tickets_pr_url
  FOR rec IN
    SELECT c_idx.relname AS index_name, c_tbl.relname AS table_name, am.amname, i.indnatts, i.indisunique, i.indisvalid, i.indisready,
           (i.indpred IS NOT NULL) AS is_partial, pg_get_indexdef(i.indexrelid, 1, false) AS col1
    FROM pg_index i
    JOIN pg_class c_idx ON c_idx.oid = i.indexrelid
    JOIN pg_class c_tbl ON c_tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = c_idx.relnamespace
    JOIN pg_am am ON am.oid = c_idx.relam
    WHERE ns.nspname = 'public' AND c_idx.relname = 'idx_tickets_pr_url'
  LOOP
    IF rec.table_name <> 'tickets' THEN
      RAISE EXCEPTION 'Index validation failure: Index "idx_tickets_pr_url" already exists in public on table "%" (expected tickets)', rec.table_name;
    ELSIF rec.amname <> 'btree' OR rec.indnatts <> 1 OR rec.col1 <> 'pr_url' OR rec.indisunique OR NOT rec.indisvalid OR NOT rec.indisready OR rec.is_partial THEN
      RAISE EXCEPTION 'Index validation failure: Existing index "idx_tickets_pr_url" has incompatible structural definition.';
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_tickets_repository_id ON public.tickets (repository_id);
CREATE INDEX IF NOT EXISTS idx_tickets_repo_pr ON public.tickets (repository_id, github_pr_number);
CREATE INDEX IF NOT EXISTS idx_tickets_pr_url ON public.tickets (pr_url);

-- ============================================================================
-- Step 10: Safe, Idempotent Legacy Repository Backfill
-- Enforces:
-- 1. Uniform regex normalization matching Step 2.
-- 2. Deterministic intra-batch deduplication via DISTINCT ON.
-- 3. Elimination of existing DB rows via WHERE NOT EXISTS.
-- 4. Expression-index conflict inference: (project_id, (LOWER(github_owner)), (LOWER(github_repo))).
-- ============================================================================
WITH parsed_repos AS (
  SELECT
    p.id AS project_id,
    split_part(clean_repo.normalized, '/', 1) AS github_owner,
    split_part(clean_repo.normalized, '/', 2) AS github_repo,
    'https://github.com/' || clean_repo.normalized AS repository_url,
    p.created_at AS created_at
  FROM public.projects p,
  LATERAL unnest(string_to_array(p.github_repo, ',')) AS raw_item(item),
  LATERAL (
    SELECT regexp_replace(
      regexp_replace(
        regexp_replace(TRIM(raw_item.item), '^https?://github\.com/', '', 'i'),
        '^git@github\.com:', '', 'i'
      ),
      '\.git$', '', 'i'
    ) AS normalized
  ) clean_repo
  WHERE p.github_repo IS NOT NULL 
    AND TRIM(raw_item.item) <> ''
    AND clean_repo.normalized ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
),
deduped_batch AS (
  SELECT DISTINCT ON (project_id, LOWER(github_owner), LOWER(github_repo))
    project_id,
    github_owner,
    github_repo,
    repository_url,
    1 AS is_active,
    'unverified' AS verification_status,
    created_at,
    created_at AS updated_at
  FROM parsed_repos
  ORDER BY project_id, LOWER(github_owner), LOWER(github_repo), created_at ASC
)
INSERT INTO public.project_repositories (
  project_id,
  github_owner,
  github_repo,
  repository_url,
  is_active,
  verification_status,
  created_at,
  updated_at
)
SELECT 
  d.project_id,
  d.github_owner,
  d.github_repo,
  d.repository_url,
  d.is_active,
  d.verification_status,
  d.created_at,
  d.updated_at
FROM deduped_batch d
WHERE NOT EXISTS (
  SELECT 1 FROM public.project_repositories pr
  WHERE pr.project_id = d.project_id
    AND LOWER(pr.github_owner) = LOWER(d.github_owner)
    AND LOWER(pr.github_repo) = LOWER(d.github_repo)
)
ON CONFLICT (project_id, (LOWER(github_owner)), (LOWER(github_repo))) DO NOTHING;

COMMIT;
