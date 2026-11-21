/**
 * Canonical Schema definitions for Weekly AI Excel Reports and Delivery Tracking.
 * Dual compatibility: SQLite (local development / testing) and Neon PostgreSQL (production).
 */

export const WEEKLY_REPORT_SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS weekly_report_runs (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    run_token                TEXT NOT NULL UNIQUE,
    report_type              TEXT NOT NULL CHECK (report_type IN ('scheduled', 'manual')),
    period_type              TEXT NOT NULL CHECK (period_type IN ('weekly_sat', 'last_7_days', 'current_month', 'custom')),
    period_start             TEXT NOT NULL,
    period_end               TEXT NOT NULL,
    timezone                 TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    project_scope            TEXT NOT NULL CHECK (project_scope IN ('all', 'active', 'selected')),
    selected_project_ids     TEXT NOT NULL DEFAULT '[]',
    requested_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status                   TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'partial')),
    ai_status                TEXT NOT NULL DEFAULT 'pending' CHECK (ai_status IN ('pending', 'success', 'failed', 'skipped')),
    excel_status             TEXT NOT NULL DEFAULT 'pending' CHECK (excel_status IN ('pending', 'success', 'failed')),
    management_email_status  TEXT NOT NULL DEFAULT 'not_requested' CHECK (management_email_status IN ('not_requested', 'pending', 'sent', 'failed')),
    employee_email_status    TEXT NOT NULL DEFAULT 'not_requested' CHECK (employee_email_status IN ('not_requested', 'pending', 'sent', 'partial_failed', 'failed')),
    summary_metrics_json     TEXT NOT NULL DEFAULT '{}',
    ai_insights_json         TEXT NOT NULL DEFAULT '{}',
    error_message            TEXT,
    retry_count              INTEGER NOT NULL DEFAULT 0,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at             TEXT
  );

  CREATE TABLE IF NOT EXISTS weekly_report_files (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id                   INTEGER NOT NULL REFERENCES weekly_report_runs(id) ON DELETE CASCADE,
    file_type                TEXT NOT NULL CHECK (file_type IN ('company_report', 'employee_report')),
    employee_id              INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    employee_name_snapshot   TEXT NOT NULL DEFAULT '',
    filename                 TEXT NOT NULL,
    storage_key              TEXT NOT NULL,
    content_type             TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    file_size_bytes          INTEGER NOT NULL DEFAULT 0,
    status                   TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('pending', 'generated', 'failed')),
    error_message            TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_report_file_company 
    ON weekly_report_files (run_id) 
    WHERE file_type = 'company_report';

  CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_report_file_employee 
    ON weekly_report_files (run_id, employee_id) 
    WHERE file_type = 'employee_report' AND employee_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS weekly_report_deliveries (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id                   INTEGER NOT NULL REFERENCES weekly_report_runs(id) ON DELETE CASCADE,
    file_id                  INTEGER REFERENCES weekly_report_files(id) ON DELETE SET NULL,
    recipient_type           TEXT NOT NULL CHECK (recipient_type IN ('management', 'employee')),
    recipient_email          TEXT NOT NULL,
    recipient_name_snapshot  TEXT NOT NULL DEFAULT '',
    user_id                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    employee_id              INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    delivery_status          TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'in_flight', 'accepted', 'logged_local', 'failed', 'uncertain', 'skipped')),
    smtp_message_id          TEXT,
    error_message            TEXT,
    attempt_count            INTEGER NOT NULL DEFAULT 0,
    last_attempt_at          TEXT,
    sent_at                  TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_deliv_management 
    ON weekly_report_deliveries (run_id, recipient_email) 
    WHERE recipient_type = 'management';

  CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_deliv_employee 
    ON weekly_report_deliveries (run_id, employee_id) 
    WHERE recipient_type = 'employee' AND employee_id IS NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_deliv_employee_fallback 
    ON weekly_report_deliveries (run_id, recipient_email) 
    WHERE recipient_type = 'employee' AND employee_id IS NULL;

  CREATE INDEX IF NOT EXISTS idx_weekly_runs_created ON weekly_report_runs(created_at);
  CREATE INDEX IF NOT EXISTS idx_weekly_runs_token ON weekly_report_runs(run_token);
  CREATE INDEX IF NOT EXISTS idx_weekly_files_run ON weekly_report_files(run_id);
  CREATE INDEX IF NOT EXISTS idx_weekly_deliv_run_status ON weekly_report_deliveries(run_id, delivery_status);
`;

export const WEEKLY_REPORT_POSTGRES_DDL = `
  CREATE TABLE IF NOT EXISTS weekly_report_runs (
    id                       INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    run_token                TEXT NOT NULL UNIQUE,
    report_type              TEXT NOT NULL CHECK (report_type IN ('scheduled', 'manual')),
    period_type              TEXT NOT NULL CHECK (period_type IN ('weekly_sat', 'last_7_days', 'current_month', 'custom')),
    period_start             TIMESTAMPTZ NOT NULL,
    period_end               TIMESTAMPTZ NOT NULL,
    timezone                 TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    project_scope            TEXT NOT NULL CHECK (project_scope IN ('all', 'active', 'selected')),
    selected_project_ids     TEXT NOT NULL DEFAULT '[]',
    requested_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status                   TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'partial')),
    ai_status                TEXT NOT NULL DEFAULT 'pending' CHECK (ai_status IN ('pending', 'success', 'failed', 'skipped')),
    excel_status             TEXT NOT NULL DEFAULT 'pending' CHECK (excel_status IN ('pending', 'success', 'failed')),
    management_email_status  TEXT NOT NULL DEFAULT 'not_requested' CHECK (management_email_status IN ('not_requested', 'pending', 'sent', 'failed')),
    employee_email_status    TEXT NOT NULL DEFAULT 'not_requested' CHECK (employee_email_status IN ('not_requested', 'pending', 'sent', 'partial_failed', 'failed')),
    summary_metrics_json     TEXT NOT NULL DEFAULT '{}',
    ai_insights_json         TEXT NOT NULL DEFAULT '{}',
    error_message            TEXT,
    retry_count              INTEGER NOT NULL DEFAULT 0,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at             TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS weekly_report_files (
    id                       INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    run_id                   INTEGER NOT NULL REFERENCES weekly_report_runs(id) ON DELETE CASCADE,
    file_type                TEXT NOT NULL CHECK (file_type IN ('company_report', 'employee_report')),
    employee_id              INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    employee_name_snapshot   TEXT NOT NULL DEFAULT '',
    filename                 TEXT NOT NULL,
    storage_key              TEXT NOT NULL,
    content_type             TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    file_size_bytes          INTEGER NOT NULL DEFAULT 0,
    status                   TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('pending', 'generated', 'failed')),
    error_message            TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_report_file_company 
    ON weekly_report_files (run_id) 
    WHERE file_type = 'company_report';

  CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_report_file_employee 
    ON weekly_report_files (run_id, employee_id) 
    WHERE file_type = 'employee_report' AND employee_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS weekly_report_deliveries (
    id                       INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    run_id                   INTEGER NOT NULL REFERENCES weekly_report_runs(id) ON DELETE CASCADE,
    file_id                  INTEGER REFERENCES weekly_report_files(id) ON DELETE SET NULL,
    recipient_type           TEXT NOT NULL CHECK (recipient_type IN ('management', 'employee')),
    recipient_email          TEXT NOT NULL,
    recipient_name_snapshot  TEXT NOT NULL DEFAULT '',
    user_id                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    employee_id              INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    delivery_status          TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'in_flight', 'accepted', 'logged_local', 'failed', 'uncertain', 'skipped')),
    smtp_message_id          TEXT,
    error_message            TEXT,
    attempt_count            INTEGER NOT NULL DEFAULT 0,
    last_attempt_at          TIMESTAMPTZ,
    sent_at                  TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_deliv_management 
    ON weekly_report_deliveries (run_id, recipient_email) 
    WHERE recipient_type = 'management';

  CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_deliv_employee 
    ON weekly_report_deliveries (run_id, employee_id) 
    WHERE recipient_type = 'employee' AND employee_id IS NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_deliv_employee_fallback 
    ON weekly_report_deliveries (run_id, recipient_email) 
    WHERE recipient_type = 'employee' AND employee_id IS NULL;

  CREATE INDEX IF NOT EXISTS idx_weekly_runs_created ON weekly_report_runs(created_at);
  CREATE INDEX IF NOT EXISTS idx_weekly_runs_token ON weekly_report_runs(run_token);
  CREATE INDEX IF NOT EXISTS idx_weekly_files_run ON weekly_report_files(run_id);
  CREATE INDEX IF NOT EXISTS idx_weekly_deliv_run_status ON weekly_report_deliveries(run_id, delivery_status);
`;

/**
 * Ensures idempotent Weekly AI Report tables and indexes in SQLite.
 */
export async function ensureWeeklyAiReportSqliteSchema(activeDriver) {
  await activeDriver.exec(WEEKLY_REPORT_SQLITE_DDL);
}

/**
 * Ensures idempotent Weekly AI Report tables and indexes in PostgreSQL.
 */
export async function ensureWeeklyAiReportPostgresSchema(activeDriver, rawPrepareFn) {
  if (process.env.SERPHAWK_MIGRATION_DRY_RUN === '1') {
    return;
  }
  const present = await rawPrepareFn(
    `SELECT to_regclass('public.weekly_report_runs') AS runs_tbl,
            to_regclass('public.weekly_report_files') AS files_tbl,
            to_regclass('public.weekly_report_deliveries') AS deliv_tbl`
  ).get([]);

  if (present?.runs_tbl && present?.files_tbl && present?.deliv_tbl) {
    return;
  }

  await activeDriver.exec(WEEKLY_REPORT_POSTGRES_DDL);
}
