-- ============================================================================
-- SerpHawk HRMS - Payroll Module Rollback
-- File: 001_rollback_payroll_module.sql
-- Description: Conditionally drops only tables created by 001_create_payroll_module.sql
-- Dialect: PostgreSQL (Neon compatible)
-- Safety: Verifies ownership in payroll_schema_metadata. Uses RESTRICT, never CASCADE.
-- ============================================================================

DO $$
DECLARE
  table_list TEXT[] := ARRAY[
    'payroll_audit_logs',
    'payment_webhook_events',
    'salary_payments',
    'payslips',
    'employee_incentives',
    'payroll_deductions',
    'payroll_earnings',
    'payroll_records',
    'payroll_periods',
    'employee_salary_assignments',
    'employee_salary_component_assignments',
    'employee_salary_structures',
    'salary_components'
  ];
  tbl TEXT;
  created_val TEXT;
BEGIN
  -- Verify metadata table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = current_schema() AND table_name = 'payroll_schema_metadata'
  ) THEN
    FOREACH tbl IN ARRAY table_list
    LOOP
      SELECT value INTO created_val 
      FROM payroll_schema_metadata 
      WHERE key = 'created_table_' || tbl;

      IF created_val = 'true' THEN
        RAISE NOTICE 'Dropping table % created by migration 001', tbl;
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(tbl) || ' RESTRICT';
        DELETE FROM payroll_schema_metadata WHERE key = 'created_table_' || tbl;
      ELSE
        RAISE NOTICE 'Skipping table % (not marked as created by migration 001)', tbl;
      END IF;
    END LOOP;

    -- Clean up migration status
    DELETE FROM payroll_schema_metadata WHERE key = 'migration_001_status';

    -- If no other keys remain, drop metadata table
    IF NOT EXISTS (SELECT 1 FROM payroll_schema_metadata LIMIT 1) THEN
      DROP TABLE IF EXISTS payroll_schema_metadata RESTRICT;
    END IF;
  ELSE
    RAISE NOTICE 'payroll_schema_metadata does not exist. Aborting rollback to prevent dropping unverified tables.';
  END IF;
END $$;
