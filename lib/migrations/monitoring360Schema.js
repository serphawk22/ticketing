/**
 * Canonical Phase 1 Schema & Seed definitions for SerpHawk 360° Employee & Project Monitoring.
 * Keeps SQLite and PostgreSQL parity cleanly while preserving all 4 existing ticket statuses:
 *   open ('To Do'), in_progress ('In Progress'), resolved ('QA Testing'), closed ('Closed / Done').
 */

export const INITIAL_WORKFLOW_STAGES = [
  ['open', 'To Do', 1, 0, 1],
  ['in_progress', 'In Progress', 2, 0, 1],
  ['resolved', 'QA Testing', 3, 0, 1],
  ['closed', 'Closed / Done', 4, 1, 1],
];

export const INITIAL_WORK_CATEGORIES = [
  ['development', 'Development', 'ticket', 1, 1, 10],
  ['bug_fix', 'Bug Fix', 'ticket', 1, 1, 20],
  ['qa_testing', 'QA Testing', 'ticket', 1, 1, 30],
  ['code_review_activity', 'Code Review', 'ticket', 1, 1, 40],
  ['deployment', 'Deployment & Release', 'ticket', 1, 1, 50],
  ['documentation', 'Documentation', 'both', 1, 1, 60],
  ['team_meeting', 'Team Meeting', 'company_activity', 1, 1, 70],
  ['client_meeting', 'Client Meeting', 'company_activity', 1, 1, 80],
  ['client_call', 'Client Call', 'company_activity', 1, 1, 90],
  ['internal_discussion', 'Internal Discussion', 'company_activity', 1, 1, 100],
  ['training', 'Training & Upskilling', 'company_activity', 1, 1, 110],
  ['technical_discussion', 'Technical Discussion', 'company_activity', 1, 1, 120],
  ['research', 'Research & R&D', 'company_activity', 1, 1, 130],
  ['planning', 'Planning & Estimation', 'company_activity', 1, 1, 140],
  ['other_company_work', 'Other Company Activity', 'company_activity', 1, 1, 150],
];

/**
 * Earliest observed `attendance_settings.updated_at` in live Neon Postgres is `2026-10-24`.
 * Labeled strictly as `provisional_inferred_from_settings` until Owner/Admin explicitly confirms.
 */
export const PROVISIONAL_BASELINE_SCHEDULE = {
  effective_from: '2026-10-24',
  work_start_time: '09:00',
  work_end_time: '17:00',
  working_days_json: '[1,2,3,4,5,6]',
  timezone: 'Asia/Kolkata',
  effective_date_status: 'provisional_inferred_from_settings',
  reason: 'Provisional baseline inferred from earliest observed attendance_settings timestamp (2026-10-24); pending Owner confirmation.',
};

export const MONITORING_360_SQLITE_TABLES = `
  CREATE TABLE IF NOT EXISTS workflow_stages (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_terminal INTEGER NOT NULL DEFAULT 0 CHECK (is_terminal IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
  );

  CREATE TABLE IF NOT EXISTS business_schedule_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER REFERENCES workspaces(id),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    work_start_time TEXT NOT NULL DEFAULT '09:00',
    work_end_time TEXT NOT NULL DEFAULT '17:00',
    working_days_json TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    effective_date_status TEXT NOT NULL DEFAULT 'provisional_inferred_from_settings'
      CHECK (effective_date_status IN ('provisional_inferred_from_settings', 'owner_confirmed')),
    confirmed_by INTEGER REFERENCES users(id),
    confirmed_at TEXT,
    reason TEXT NOT NULL DEFAULT '',
    test_run_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_stage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
    project_id INTEGER REFERENCES projects(id),
    transition_seq INTEGER NOT NULL,
    from_status TEXT REFERENCES workflow_stages(code),
    to_status TEXT NOT NULL REFERENCES workflow_stages(code),
    changed_by INTEGER REFERENCES users(id),
    source TEXT NOT NULL DEFAULT 'board'
      CHECK (source IN ('create', 'board', 'list', 'detail', 'task_sheet', 'api', 'archive', 'backfill')),
    entry_at TEXT NOT NULL,
    exit_at TEXT,
    calendar_seconds INTEGER,
    business_seconds INTEGER,
    schedule_version_id INTEGER REFERENCES business_schedule_history(id),
    duration_precision TEXT NOT NULL DEFAULT 'provisional_baseline'
      CHECK (duration_precision IN ('verified', 'provisional_baseline', 'estimated_pre_schedule', 'mixed_estimated')),
    is_reopen INTEGER NOT NULL DEFAULT 0 CHECK (is_reopen IN (0, 1)),
    idempotency_key TEXT UNIQUE,
    test_run_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(ticket_id, transition_seq)
  );

  CREATE INDEX IF NOT EXISTS tsh_ticket_seq_idx ON ticket_stage_history(ticket_id, transition_seq);
  CREATE UNIQUE INDEX IF NOT EXISTS tsh_one_open_idx ON ticket_stage_history(ticket_id) WHERE exit_at IS NULL;
  CREATE INDEX IF NOT EXISTS tsh_proj_stage_idx ON ticket_stage_history(project_id, to_status, entry_at);
  CREATE INDEX IF NOT EXISTS tsh_test_run_idx ON ticket_stage_history(test_run_id);

  CREATE TRIGGER IF NOT EXISTS trg_tsh_immutable_update
  BEFORE UPDATE ON ticket_stage_history
  FOR EACH ROW
  WHEN OLD.exit_at IS NOT NULL AND OLD.test_run_id IS NULL
  BEGIN
    SELECT RAISE(ABORT, 'ticket_stage_history closed rows are immutable; insert into ticket_stage_corrections instead.');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_tsh_immutable_delete
  BEFORE DELETE ON ticket_stage_history
  FOR EACH ROW
  WHEN OLD.test_run_id IS NULL
  BEGIN
    SELECT RAISE(ABORT, 'ticket_stage_history rows cannot be deleted.');
  END;

  CREATE TABLE IF NOT EXISTS ticket_stage_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_history_id INTEGER NOT NULL REFERENCES ticket_stage_history(id) ON DELETE RESTRICT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
    correction_seq INTEGER NOT NULL,
    original_from_status TEXT,
    original_to_status TEXT NOT NULL REFERENCES workflow_stages(code),
    original_entry_at TEXT NOT NULL,
    original_exit_at TEXT,
    original_calendar_seconds INTEGER,
    original_business_seconds INTEGER,
    corrected_to_status TEXT NOT NULL REFERENCES workflow_stages(code),
    corrected_entry_at TEXT NOT NULL,
    corrected_exit_at TEXT,
    recalculated_calendar_seconds INTEGER,
    recalculated_business_seconds INTEGER,
    schedule_version_id INTEGER REFERENCES business_schedule_history(id),
    duration_precision TEXT NOT NULL DEFAULT 'verified'
      CHECK (duration_precision IN ('verified', 'provisional_baseline', 'estimated_pre_schedule', 'mixed_estimated')),
    reason TEXT NOT NULL,
    corrected_by INTEGER NOT NULL REFERENCES users(id),
    corrected_at TEXT NOT NULL DEFAULT (datetime('now')),
    test_run_id TEXT,
    UNIQUE(stage_history_id, correction_seq)
  );
  CREATE INDEX IF NOT EXISTS tsc_ticket_idx ON ticket_stage_corrections(ticket_id, stage_history_id);

  CREATE TABLE IF NOT EXISTS employee_task_sheet_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    token_hint TEXT NOT NULL,
    issued_by INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    revoked_by INTEGER REFERENCES users(id),
    last_used_at TEXT,
    test_run_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS etst_emp_active_idx ON employee_task_sheet_tokens(employee_id, revoked_at, expires_at);

  CREATE TABLE IF NOT EXISTS task_sheet_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_hash TEXT NOT NULL UNIQUE,
    csrf_token_hash TEXT NOT NULL,
    token_id INTEGER NOT NULL REFERENCES employee_task_sheet_tokens(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    ip_prefix TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    test_run_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_sheet_amendments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL REFERENCES task_sheet_submissions(id) ON DELETE RESTRICT,
    amendment_seq INTEGER NOT NULL,
    employee_id INTEGER REFERENCES employees(id),
    work_date TEXT NOT NULL,
    amendment_type TEXT NOT NULL CHECK (amendment_type IN ('self_correction', 'admin_adjustment')),
    reason TEXT NOT NULL,
    original_snapshot_json TEXT NOT NULL,
    amended_payload_json TEXT NOT NULL,
    actor_id INTEGER REFERENCES users(id),
    actor_role TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    test_run_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(submission_id, amendment_seq)
  );

  CREATE TABLE IF NOT EXISTS work_categories (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('ticket', 'company_activity', 'both')),
    counts_as_accounted INTEGER NOT NULL DEFAULT 1 CHECK (counts_as_accounted IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS employee_work_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    user_id INTEGER REFERENCES users(id),
    work_date TEXT NOT NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('ticket_work', 'company_activity')),
    entry_kind TEXT NOT NULL DEFAULT 'initial' CHECK (entry_kind IN ('initial', 'reversal_adjustment', 'amended_entry')),
    project_id INTEGER REFERENCES projects(id),
    ticket_id INTEGER REFERENCES tickets(id),
    category_code TEXT NOT NULL REFERENCES work_categories(code),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= -1440 AND duration_minutes <= 1440),
    work_description TEXT NOT NULL DEFAULT '',
    completed_work TEXT NOT NULL DEFAULT '',
    pending_work TEXT NOT NULL DEFAULT '',
    blocker_text TEXT NOT NULL DEFAULT '',
    task_state TEXT CHECK (task_state IN ('completed', 'not_completed', 'in_progress')),
    source_type TEXT NOT NULL
      CHECK (source_type IN ('task_sheet', 'task_sheet_amendment', 'manual_ticket_log', 'admin_adjustment', 'admin_legacy_map', 'backfill')),
    source_id INTEGER NOT NULL,
    source_item_index INTEGER NOT NULL DEFAULT 0,
    amendment_id INTEGER REFERENCES task_sheet_amendments(id),
    test_run_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_type, source_id, source_item_index)
  );
  CREATE INDEX IF NOT EXISTS ewl_emp_date_idx ON employee_work_logs(employee_id, work_date);
  CREATE INDEX IF NOT EXISTS ewl_proj_date_idx ON employee_work_logs(project_id, work_date);
  CREATE INDEX IF NOT EXISTS ewl_ticket_idx ON employee_work_logs(ticket_id);
  CREATE INDEX IF NOT EXISTS ewl_test_run_idx ON employee_work_logs(test_run_id);

  CREATE TABLE IF NOT EXISTS project_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    project_role TEXT NOT NULL DEFAULT 'contributor' CHECK (project_role IN ('manager', 'lead', 'contributor', 'qa', 'observer')),
    allocated_hours_per_week REAL DEFAULT 40,
    assigned_by INTEGER REFERENCES users(id),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    test_run_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, employee_id)
  );
  CREATE INDEX IF NOT EXISTS pm_emp_idx ON project_members(employee_id, is_active);

  CREATE TABLE IF NOT EXISTS test_fixture_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_run_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(test_run_id, table_name, record_id)
  );
  CREATE INDEX IF NOT EXISTS tfr_run_table_idx ON test_fixture_registry(test_run_id, table_name);
`;

export const MONITORING_360_POSTGRES_DDL = `
DO $$
BEGIN
  -- 1. Expand role constraints on users & employees while preserving existing rows
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('owner', 'admin', 'manager', 'employee', 'developer', 'client'));

  ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
  ALTER TABLE employees ADD CONSTRAINT employees_role_check
    CHECK (role IN ('owner', 'admin', 'manager', 'employee', 'developer', 'client'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Preserve 4 existing ticket statuses cleanly; add additive tracking columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS test_run_id TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS test_run_id TEXT;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS estimated_hours DOUBLE PRECISION DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS archived_at TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS test_run_id TEXT;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_manager_id INTEGER REFERENCES employees(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS estimated_hours DOUBLE PRECISION DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_end_date TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS actual_end_date TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS test_run_id TEXT;
DO $$
BEGIN
  ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
  ALTER TABLE projects ADD CONSTRAINT projects_status_check
    CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'archived'));
END $$;

ALTER TABLE company_holidays ADD COLUMN IF NOT EXISTS test_run_id TEXT;
ALTER TABLE employee_attendance ADD COLUMN IF NOT EXISTS test_run_id TEXT;

CREATE TABLE IF NOT EXISTS workflow_stages (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_terminal INTEGER NOT NULL DEFAULT 0 CHECK (is_terminal IN (0, 1)),
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS business_schedule_history (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  workspace_id INTEGER REFERENCES workspaces(id),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  work_start_time TEXT NOT NULL DEFAULT '09:00',
  work_end_time TEXT NOT NULL DEFAULT '17:00',
  working_days_json TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  effective_date_status TEXT NOT NULL DEFAULT 'provisional_inferred_from_settings'
    CHECK (effective_date_status IN ('provisional_inferred_from_settings', 'owner_confirmed')),
  confirmed_by INTEGER REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  reason TEXT NOT NULL DEFAULT '',
  test_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_stage_history (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  project_id INTEGER REFERENCES projects(id),
  transition_seq INTEGER NOT NULL,
  from_status TEXT REFERENCES workflow_stages(code),
  to_status TEXT NOT NULL REFERENCES workflow_stages(code),
  changed_by INTEGER REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'board'
    CHECK (source IN ('create', 'board', 'list', 'detail', 'task_sheet', 'api', 'archive', 'backfill')),
  entry_at TIMESTAMPTZ NOT NULL,
  exit_at TIMESTAMPTZ,
  calendar_seconds INTEGER,
  business_seconds INTEGER,
  schedule_version_id INTEGER REFERENCES business_schedule_history(id),
  duration_precision TEXT NOT NULL DEFAULT 'provisional_baseline'
    CHECK (duration_precision IN ('verified', 'provisional_baseline', 'estimated_pre_schedule', 'mixed_estimated')),
  is_reopen INTEGER NOT NULL DEFAULT 0 CHECK (is_reopen IN (0, 1)),
  idempotency_key TEXT UNIQUE,
  test_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ticket_id, transition_seq)
);
CREATE INDEX IF NOT EXISTS tsh_ticket_seq_idx ON ticket_stage_history(ticket_id, transition_seq);
CREATE UNIQUE INDEX IF NOT EXISTS tsh_one_open_idx ON ticket_stage_history(ticket_id) WHERE exit_at IS NULL;
CREATE INDEX IF NOT EXISTS tsh_proj_stage_idx ON ticket_stage_history(project_id, to_status, entry_at);
CREATE INDEX IF NOT EXISTS tsh_test_run_idx ON ticket_stage_history(test_run_id);

CREATE OR REPLACE FUNCTION fn_tsh_immutable_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.test_run_id IS NOT NULL THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'ticket_stage_history rows cannot be deleted.';
  END IF;
  IF OLD.exit_at IS NOT NULL AND OLD.test_run_id IS NULL THEN
    RAISE EXCEPTION 'ticket_stage_history closed rows are immutable; insert into ticket_stage_corrections instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tsh_immutable ON ticket_stage_history;
CREATE TRIGGER trg_tsh_immutable
  BEFORE UPDATE OR DELETE ON ticket_stage_history
  FOR EACH ROW EXECUTE FUNCTION fn_tsh_immutable_guard();

CREATE TABLE IF NOT EXISTS ticket_stage_corrections (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  stage_history_id INTEGER NOT NULL REFERENCES ticket_stage_history(id) ON DELETE RESTRICT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  correction_seq INTEGER NOT NULL,
  original_from_status TEXT,
  original_to_status TEXT NOT NULL REFERENCES workflow_stages(code),
  original_entry_at TIMESTAMPTZ NOT NULL,
  original_exit_at TIMESTAMPTZ,
  original_calendar_seconds INTEGER,
  original_business_seconds INTEGER,
  corrected_to_status TEXT NOT NULL REFERENCES workflow_stages(code),
  corrected_entry_at TIMESTAMPTZ NOT NULL,
  corrected_exit_at TIMESTAMPTZ,
  recalculated_calendar_seconds INTEGER,
  recalculated_business_seconds INTEGER,
  schedule_version_id INTEGER REFERENCES business_schedule_history(id),
  duration_precision TEXT NOT NULL DEFAULT 'verified'
    CHECK (duration_precision IN ('verified', 'provisional_baseline', 'estimated_pre_schedule', 'mixed_estimated')),
  reason TEXT NOT NULL,
  corrected_by INTEGER NOT NULL REFERENCES users(id),
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  test_run_id TEXT,
  UNIQUE(stage_history_id, correction_seq)
);
CREATE INDEX IF NOT EXISTS tsc_ticket_idx ON ticket_stage_corrections(ticket_id, stage_history_id);

CREATE TABLE IF NOT EXISTS employee_task_sheet_tokens (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  issued_by INTEGER NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by INTEGER REFERENCES users(id),
  last_used_at TIMESTAMPTZ,
  test_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etst_emp_active_idx ON employee_task_sheet_tokens(employee_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS task_sheet_sessions (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  token_id INTEGER NOT NULL REFERENCES employee_task_sheet_tokens(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  ip_prefix TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  test_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS work_date TEXT;
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id);
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS submission_auth_mode TEXT NOT NULL DEFAULT 'session';
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS token_id INTEGER REFERENCES employee_task_sheet_tokens(id);
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS completed_work TEXT NOT NULL DEFAULT '';
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS pending_work TEXT NOT NULL DEFAULT '';
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS other_activities_detail TEXT NOT NULL DEFAULT '[]';
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS amendment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS latest_amendment_id INTEGER;
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS legacy_mapped_employee_id INTEGER REFERENCES employees(id);
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS legacy_mapped_by INTEGER REFERENCES users(id);
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS legacy_mapped_at TEXT;
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS legacy_mapping_note TEXT NOT NULL DEFAULT '';
ALTER TABLE task_sheet_submissions ADD COLUMN IF NOT EXISTS test_run_id TEXT;
DO $$
BEGIN
  ALTER TABLE task_sheet_submissions DROP CONSTRAINT IF EXISTS tss_auth_mode_check;
  ALTER TABLE task_sheet_submissions ADD CONSTRAINT tss_auth_mode_check
    CHECK (submission_auth_mode IN ('session', 'signed_cookie_token', 'legacy_anonymous'));
END $$;

ALTER TABLE ticket_time_logs ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id);
ALTER TABLE ticket_time_logs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE ticket_time_logs ADD COLUMN IF NOT EXISTS task_sheet_id INTEGER REFERENCES task_sheet_submissions(id);
ALTER TABLE ticket_time_logs ADD COLUMN IF NOT EXISTS work_category TEXT NOT NULL DEFAULT 'development';
ALTER TABLE ticket_time_logs ADD COLUMN IF NOT EXISTS test_run_id TEXT;
DO $$
BEGIN
  ALTER TABLE ticket_time_logs DROP CONSTRAINT IF EXISTS ttl_source_check;
  ALTER TABLE ticket_time_logs ADD CONSTRAINT ttl_source_check
    CHECK (source IN ('manual', 'task_sheet', 'admin_adjustment'));
END $$;

CREATE TABLE IF NOT EXISTS task_sheet_amendments (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES task_sheet_submissions(id) ON DELETE RESTRICT,
  amendment_seq INTEGER NOT NULL,
  employee_id INTEGER REFERENCES employees(id),
  work_date TEXT NOT NULL,
  amendment_type TEXT NOT NULL CHECK (amendment_type IN ('self_correction', 'admin_adjustment')),
  reason TEXT NOT NULL,
  original_snapshot_json TEXT NOT NULL,
  amended_payload_json TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id),
  actor_role TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  test_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(submission_id, amendment_seq)
);

CREATE TABLE IF NOT EXISTS work_categories (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('ticket', 'company_activity', 'both')),
  counts_as_accounted INTEGER NOT NULL DEFAULT 1 CHECK (counts_as_accounted IN (0, 1)),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS employee_work_logs (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  user_id INTEGER REFERENCES users(id),
  work_date TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('ticket_work', 'company_activity')),
  entry_kind TEXT NOT NULL DEFAULT 'initial' CHECK (entry_kind IN ('initial', 'reversal_adjustment', 'amended_entry')),
  project_id INTEGER REFERENCES projects(id),
  ticket_id INTEGER REFERENCES tickets(id),
  category_code TEXT NOT NULL REFERENCES work_categories(code),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= -1440 AND duration_minutes <= 1440),
  work_description TEXT NOT NULL DEFAULT '',
  completed_work TEXT NOT NULL DEFAULT '',
  pending_work TEXT NOT NULL DEFAULT '',
  blocker_text TEXT NOT NULL DEFAULT '',
  task_state TEXT CHECK (task_state IN ('completed', 'not_completed', 'in_progress')),
  source_type TEXT NOT NULL
    CHECK (source_type IN ('task_sheet', 'task_sheet_amendment', 'manual_ticket_log', 'admin_adjustment', 'admin_legacy_map', 'backfill')),
  source_id INTEGER NOT NULL,
  source_item_index INTEGER NOT NULL DEFAULT 0,
  amendment_id INTEGER REFERENCES task_sheet_amendments(id),
  test_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_type, source_id, source_item_index)
);
CREATE INDEX IF NOT EXISTS ewl_emp_date_idx ON employee_work_logs(employee_id, work_date);
CREATE INDEX IF NOT EXISTS ewl_proj_date_idx ON employee_work_logs(project_id, work_date);
CREATE INDEX IF NOT EXISTS ewl_ticket_idx ON employee_work_logs(ticket_id);
CREATE INDEX IF NOT EXISTS ewl_test_run_idx ON employee_work_logs(test_run_id);

CREATE TABLE IF NOT EXISTS project_members (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_role TEXT NOT NULL DEFAULT 'contributor' CHECK (project_role IN ('manager', 'lead', 'contributor', 'qa', 'observer')),
  allocated_hours_per_week DOUBLE PRECISION DEFAULT 40,
  assigned_by INTEGER REFERENCES users(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  test_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, employee_id)
);
CREATE INDEX IF NOT EXISTS pm_emp_idx ON project_members(employee_id, is_active);

CREATE TABLE IF NOT EXISTS test_fixture_registry (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  test_run_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(test_run_id, table_name, record_id)
);
CREATE INDEX IF NOT EXISTS tfr_run_table_idx ON test_fixture_registry(test_run_id, table_name);
`;

/**
 * Ensures idempotent Phase 1 SQLite tables, additive columns, triggers, and baseline seeds.
 * Used during SQLite driver init and isolated test runs.
 */
export async function ensureMonitoring360SqliteSchema(activeDriver, rawPrepareFn) {
  const safeAddColumn = async (table, column, definition) => {
    const cols = await rawPrepareFn(`PRAGMA table_info(${table})`).all([]);
    const names = cols.map((c) => c.name);
    if (names.length && !names.includes(column)) {
      await activeDriver.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  // Expand SQLite CHECK constraints safely only on empty/new tables; existing tables preserve rows cleanly.
  await safeAddColumn('users', 'test_run_id', 'TEXT');
  await safeAddColumn('employees', 'test_run_id', 'TEXT');
  await safeAddColumn('tickets', 'estimated_hours', 'REAL DEFAULT 0');
  await safeAddColumn('tickets', 'archived_at', 'TEXT');
  await safeAddColumn('tickets', 'archived_by', 'INTEGER REFERENCES users(id)');
  await safeAddColumn('tickets', 'test_run_id', 'TEXT');

  await safeAddColumn('projects', 'project_manager_id', 'INTEGER REFERENCES employees(id)');
  await safeAddColumn('projects', 'status', "TEXT NOT NULL DEFAULT 'active'");
  await safeAddColumn('projects', 'estimated_hours', 'REAL DEFAULT 0');
  await safeAddColumn('projects', 'start_date', 'TEXT');
  await safeAddColumn('projects', 'target_end_date', 'TEXT');
  await safeAddColumn('projects', 'actual_end_date', 'TEXT');
  await safeAddColumn('projects', 'test_run_id', 'TEXT');

  await safeAddColumn('company_holidays', 'test_run_id', 'TEXT');
  await safeAddColumn('employee_attendance', 'test_run_id', 'TEXT');

  await safeAddColumn('task_sheet_submissions', 'work_date', 'TEXT');
  await safeAddColumn('task_sheet_submissions', 'employee_id', 'INTEGER REFERENCES employees(id)');
  await safeAddColumn('task_sheet_submissions', 'submission_auth_mode', "TEXT NOT NULL DEFAULT 'session'");
  await safeAddColumn('task_sheet_submissions', 'token_id', 'INTEGER');
  await safeAddColumn('task_sheet_submissions', 'completed_work', "TEXT NOT NULL DEFAULT ''");
  await safeAddColumn('task_sheet_submissions', 'pending_work', "TEXT NOT NULL DEFAULT ''");
  await safeAddColumn('task_sheet_submissions', 'other_activities_detail', "TEXT NOT NULL DEFAULT '[]'");
  await safeAddColumn('task_sheet_submissions', 'amendment_count', 'INTEGER NOT NULL DEFAULT 0');
  await safeAddColumn('task_sheet_submissions', 'latest_amendment_id', 'INTEGER');
  await safeAddColumn('task_sheet_submissions', 'legacy_mapped_employee_id', 'INTEGER REFERENCES employees(id)');
  await safeAddColumn('task_sheet_submissions', 'legacy_mapped_by', 'INTEGER REFERENCES users(id)');
  await safeAddColumn('task_sheet_submissions', 'legacy_mapped_at', 'TEXT');
  await safeAddColumn('task_sheet_submissions', 'legacy_mapping_note', "TEXT NOT NULL DEFAULT ''");
  await safeAddColumn('task_sheet_submissions', 'test_run_id', 'TEXT');

  await safeAddColumn('ticket_time_logs', 'employee_id', 'INTEGER REFERENCES employees(id)');
  await safeAddColumn('ticket_time_logs', 'source', "TEXT NOT NULL DEFAULT 'manual'");
  await safeAddColumn('ticket_time_logs', 'task_sheet_id', 'INTEGER REFERENCES task_sheet_submissions(id)');
  await safeAddColumn('ticket_time_logs', 'work_category', "TEXT NOT NULL DEFAULT 'development'");
  await safeAddColumn('ticket_time_logs', 'test_run_id', 'TEXT');

  await activeDriver.exec(MONITORING_360_SQLITE_TABLES);

  await seedMonitoring360Catalogs(rawPrepareFn);
}

/**
 * Idempotently seeds workflow_stages, work_categories, and provisional business_schedule_history baseline.
 */
export async function seedMonitoring360Catalogs(rawPrepareFn) {
  for (const row of INITIAL_WORKFLOW_STAGES) {
    await rawPrepareFn(
      'INSERT OR IGNORE INTO workflow_stages (code, label, sort_order, is_terminal, is_active) VALUES (?, ?, ?, ?, ?)'
    ).run(row);
  }

  for (const row of INITIAL_WORK_CATEGORIES) {
    await rawPrepareFn(
      'INSERT OR IGNORE INTO work_categories (code, label, scope, counts_as_accounted, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(row);
  }

  const existingSchedule = await rawPrepareFn(
    'SELECT id FROM business_schedule_history WHERE test_run_id IS NULL LIMIT 1'
  ).get([]);
  if (!existingSchedule) {
    await rawPrepareFn(
      `INSERT INTO business_schedule_history
        (effective_from, effective_to, work_start_time, work_end_time, working_days_json, timezone, effective_date_status, reason)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`
    ).run([
      PROVISIONAL_BASELINE_SCHEDULE.effective_from,
      PROVISIONAL_BASELINE_SCHEDULE.work_start_time,
      PROVISIONAL_BASELINE_SCHEDULE.work_end_time,
      PROVISIONAL_BASELINE_SCHEDULE.working_days_json,
      PROVISIONAL_BASELINE_SCHEDULE.timezone,
      PROVISIONAL_BASELINE_SCHEDULE.effective_date_status,
      PROVISIONAL_BASELINE_SCHEDULE.reason,
    ]);
  }
}

/**
 * Idempotently seeds Postgres workflow_stages, work_categories (`is_active` boolean), and baseline schedule.
 */
export async function seedMonitoring360PostgresCatalogs(rawPrepareFn) {
  for (const [code, label, sortOrder, isTerminal, isActive] of INITIAL_WORKFLOW_STAGES) {
    await rawPrepareFn(
      'INSERT OR IGNORE INTO workflow_stages (code, label, sort_order, is_terminal, is_active) VALUES (?, ?, ?, ?, ?)'
    ).run([code, label, sortOrder, isTerminal, Boolean(isActive)]);
  }

  for (const [code, label, scope, countsAsAccounted, isActive, sortOrder] of INITIAL_WORK_CATEGORIES) {
    await rawPrepareFn(
      'INSERT OR IGNORE INTO work_categories (code, label, scope, counts_as_accounted, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).run([code, label, scope, countsAsAccounted, Boolean(isActive), sortOrder]);
  }

  const existingSchedule = await rawPrepareFn(
    'SELECT id FROM business_schedule_history WHERE test_run_id IS NULL LIMIT 1'
  ).get([]);
  if (!existingSchedule) {
    await rawPrepareFn(
      `INSERT INTO business_schedule_history
        (effective_from, effective_to, work_start_time, work_end_time, working_days_json, timezone, effective_date_status, reason)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`
    ).run([
      PROVISIONAL_BASELINE_SCHEDULE.effective_from,
      PROVISIONAL_BASELINE_SCHEDULE.work_start_time,
      PROVISIONAL_BASELINE_SCHEDULE.work_end_time,
      PROVISIONAL_BASELINE_SCHEDULE.working_days_json,
      PROVISIONAL_BASELINE_SCHEDULE.timezone,
      PROVISIONAL_BASELINE_SCHEDULE.effective_date_status,
      PROVISIONAL_BASELINE_SCHEDULE.reason,
    ]);
  }
}

/**
 * Ensures idempotent Phase 1 PostgreSQL tables, additive columns, triggers, and baseline seeds
 * when the app connects to a Postgres/Neon database that has not run the CLI migration yet.
 */
export async function ensureMonitoring360PostgresSchema(activeDriver, rawPrepareFn) {
  if (process.env.SERPHAWK_MIGRATION_DRY_RUN === '1') {
    return;
  }
  const present = await rawPrepareFn(
    `SELECT to_regclass('public.employee_work_logs') AS ewl_tbl,
            to_regclass('public.ticket_stage_history') AS tsh_tbl,
            to_regclass('public.project_members') AS pm_tbl,
            to_regclass('public.workflow_stages') AS ws_tbl`
  ).get([]);

  if (present?.ewl_tbl && present?.tsh_tbl && present?.pm_tbl && present?.ws_tbl) {
    return;
  }

  await activeDriver.exec(MONITORING_360_POSTGRES_DDL);
  await seedMonitoring360PostgresCatalogs(rawPrepareFn);
}
