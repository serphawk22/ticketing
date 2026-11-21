-- Migration: 20261120_fix_ticket_deletion.sql
-- Description: Updates ticket_stage_history immutability guard to allow authorized ticket deletion within a transaction.
-- Target: PostgreSQL / Neon

BEGIN;

SET LOCAL search_path = public, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Update fn_tsh_immutable_guard to permit stage history deletion when an authorized
-- ticket deletion transaction sets serphawk.allow_ticket_deletion = 'on'
CREATE OR REPLACE FUNCTION fn_tsh_immutable_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.test_run_id IS NOT NULL OR current_setting('serphawk.allow_ticket_deletion', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'ticket_stage_history rows cannot be deleted.';
  END IF;
  IF OLD.exit_at IS NOT NULL AND OLD.test_run_id IS NULL AND current_setting('serphawk.allow_ticket_deletion', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'ticket_stage_history closed rows are immutable; insert into ticket_stage_corrections instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure trigger is active
DROP TRIGGER IF EXISTS trg_tsh_immutable ON ticket_stage_history;
CREATE TRIGGER trg_tsh_immutable
  BEFORE UPDATE OR DELETE ON ticket_stage_history
  FOR EACH ROW EXECUTE FUNCTION fn_tsh_immutable_guard();

COMMIT;
