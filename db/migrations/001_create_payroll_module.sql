-- ============================================================================
-- SerpHawk HRMS - Payroll Module Migration
-- File: 001_create_payroll_module.sql
-- Description: Creates 12 additive tables for Payroll Lifecycle Management
-- Dialect: PostgreSQL (Neon compatible)
-- Safety: Additive only. Tracks created tables in payroll_schema_metadata.
-- ============================================================================

CREATE TABLE IF NOT EXISTS payroll_schema_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Register migration start
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('migration_001_status', 'in_progress')
ON CONFLICT (key) DO UPDATE SET value = 'in_progress';

-- 1. Salary Components
CREATE TABLE IF NOT EXISTS salary_components (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('earning', 'deduction')),
  calculation_type TEXT NOT NULL CHECK (calculation_type IN ('fixed', 'percentage_of_basic')),
  is_taxable BOOLEAN NOT NULL DEFAULT true,
  is_statutory BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_salary_components_ws_code UNIQUE (workspace_id, code)
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_salary_components', 'true')
ON CONFLICT (key) DO NOTHING;

-- 2. Employee Salary Structures (Templates)
CREATE TABLE IF NOT EXISTS employee_salary_structures (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_salary_structures_ws_name UNIQUE (workspace_id, name)
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_employee_salary_structures', 'true')
ON CONFLICT (key) DO NOTHING;

-- 3. Structure Component Assignments
CREATE TABLE IF NOT EXISTS employee_salary_component_assignments (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  structure_id BIGINT NOT NULL REFERENCES employee_salary_structures(id) ON DELETE CASCADE,
  component_id BIGINT NOT NULL REFERENCES salary_components(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  percentage_rate NUMERIC(7, 4) NOT NULL DEFAULT 0.0000,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_struct_comp_unique UNIQUE (workspace_id, structure_id, component_id)
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_employee_salary_component_assignments', 'true')
ON CONFLICT (key) DO NOTHING;

-- 4. Employee Salary Assignments (Active structure & base for an employee)
CREATE TABLE IF NOT EXISTS employee_salary_assignments (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  structure_id BIGINT NOT NULL REFERENCES employee_salary_structures(id) ON DELETE RESTRICT,
  base_salary_cents BIGINT NOT NULL CHECK (base_salary_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  effective_from DATE NOT NULL,
  effective_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_employee_salary_assignments', 'true')
ON CONFLICT (key) DO NOTHING;

-- 5. Payroll Periods (5-stage lifecycle)
CREATE TABLE IF NOT EXISTS payroll_periods (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  period_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  pay_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'calculated', 'approved', 'finalized', 'disbursed')),
  total_gross_cents BIGINT NOT NULL DEFAULT 0,
  total_deductions_cents BIGINT NOT NULL DEFAULT 0,
  total_net_cents BIGINT NOT NULL DEFAULT 0,
  approved_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  finalized_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  finalized_at TIMESTAMPTZ,
  disbursed_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  disbursed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_payroll_period_ws_dates UNIQUE (workspace_id, start_date, end_date)
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_payroll_periods', 'true')
ON CONFLICT (key) DO NOTHING;

-- 6. Payroll Records (One line per employee per period)
CREATE TABLE IF NOT EXISTS payroll_records (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  period_id BIGINT NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'calculated', 'approved', 'finalized', 'disbursed')),
  base_salary_cents BIGINT NOT NULL DEFAULT 0,
  working_days NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  paid_days NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  lop_days NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  gross_pay_cents BIGINT NOT NULL DEFAULT 0,
  total_deductions_cents BIGINT NOT NULL DEFAULT 0,
  net_pay_cents BIGINT NOT NULL DEFAULT 0,
  total_paid_cents BIGINT NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid')),
  currency TEXT NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_payroll_record_emp_period UNIQUE (workspace_id, period_id, employee_id)
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_payroll_records', 'true')
ON CONFLICT (key) DO NOTHING;

-- 7. Payroll Earnings
CREATE TABLE IF NOT EXISTS payroll_earnings (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  payroll_record_id BIGINT NOT NULL REFERENCES payroll_records(id) ON DELETE CASCADE,
  component_id BIGINT REFERENCES salary_components(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  is_taxable BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_payroll_earnings', 'true')
ON CONFLICT (key) DO NOTHING;

-- 8. Payroll Deductions
CREATE TABLE IF NOT EXISTS payroll_deductions (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  payroll_record_id BIGINT NOT NULL REFERENCES payroll_records(id) ON DELETE CASCADE,
  component_id BIGINT REFERENCES salary_components(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  is_statutory BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_payroll_deductions', 'true')
ON CONFLICT (key) DO NOTHING;

-- 9. Employee Incentives / Bonuses
CREATE TABLE IF NOT EXISTS employee_incentives (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  period_id BIGINT REFERENCES payroll_periods(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_employee_incentives', 'true')
ON CONFLICT (key) DO NOTHING;

-- 10. Payslips (Immutable, Versioned)
CREATE TABLE IF NOT EXISTS payslips (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  period_id BIGINT NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  payroll_record_id BIGINT NOT NULL REFERENCES payroll_records(id) ON DELETE RESTRICT,
  payslip_number TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  payload_json JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  pdf_url TEXT,
  CONSTRAINT uq_payslip_version UNIQUE (workspace_id, period_id, employee_id, version)
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_payslips', 'true')
ON CONFLICT (key) DO NOTHING;

-- 11. Salary Payments
CREATE TABLE IF NOT EXISTS salary_payments (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  period_id BIGINT NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  payroll_record_id BIGINT NOT NULL REFERENCES payroll_records(id) ON DELETE RESTRICT,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  payment_method TEXT NOT NULL DEFAULT 'bank_transfer',
  reference_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'processing', 'completed', 'failed')),
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_salary_payments_ref UNIQUE (workspace_id, reference_id)
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_salary_payments', 'true')
ON CONFLICT (key) DO NOTHING;

-- 12. Payment Webhook Events (Idempotency and Quarantine)
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  gateway TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'quarantined', 'failed')),
  signature TEXT NOT NULL DEFAULT '',
  reference_id TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_webhook_event UNIQUE (gateway, event_id)
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_payment_webhook_events', 'true')
ON CONFLICT (key) DO NOTHING;

-- 13. Payroll Audit Logs
CREATE TABLE IF NOT EXISTS payroll_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id BIGINT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('created_table_payroll_audit_logs', 'true')
ON CONFLICT (key) DO NOTHING;

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_sal_comp_ws ON salary_components(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sal_struct_ws ON employee_salary_structures(workspace_id);
CREATE INDEX IF NOT EXISTS idx_struct_comp_struct ON employee_salary_component_assignments(structure_id);
CREATE INDEX IF NOT EXISTS idx_emp_sal_assign_emp ON employee_salary_assignments(employee_id, is_active);
CREATE INDEX IF NOT EXISTS idx_pay_periods_ws_status ON payroll_periods(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_pay_records_period ON payroll_records(period_id);
CREATE INDEX IF NOT EXISTS idx_pay_records_emp ON payroll_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_pay_earnings_rec ON payroll_earnings(payroll_record_id);
CREATE INDEX IF NOT EXISTS idx_pay_deduct_rec ON payroll_deductions(payroll_record_id);
CREATE INDEX IF NOT EXISTS idx_emp_incentives_emp_period ON employee_incentives(employee_id, period_id);
CREATE INDEX IF NOT EXISTS idx_payslips_rec ON payslips(payroll_record_id);
CREATE INDEX IF NOT EXISTS idx_payslips_emp_period ON payslips(employee_id, period_id);
CREATE INDEX IF NOT EXISTS idx_sal_payments_rec ON salary_payments(payroll_record_id);
CREATE INDEX IF NOT EXISTS idx_sal_payments_ws_ref ON salary_payments(workspace_id, reference_id);
CREATE INDEX IF NOT EXISTS idx_webhook_ref ON payment_webhook_events(reference_id);
CREATE INDEX IF NOT EXISTS idx_pay_audit_ws_entity ON payroll_audit_logs(workspace_id, entity_type, entity_id);

-- Register completion
INSERT INTO payroll_schema_metadata (key, value)
VALUES ('migration_001_status', 'completed')
ON CONFLICT (key) DO UPDATE SET value = 'completed';
