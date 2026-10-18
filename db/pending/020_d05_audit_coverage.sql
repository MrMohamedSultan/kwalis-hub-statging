-- =====================================================================
-- D05 — audit trail coverage for the money tables that had none
--
-- The row-level audit trigger public.log_audit_history() already exists and
-- already records table, record id, organization_id, project_id, actor,
-- operation and the full before/after rows into public.audit_history. It is
-- attached to invoices, payroll, payments, purchase_orders and budget_lines.
--
-- This migration attaches the SAME trigger to the financial and permission
-- tables that were not covered. It adds triggers only: no table, column,
-- policy or existing trigger is changed.
--
-- Rollback: DROP TRIGGER trg_audit_history_<table> ON public.<table>;
-- =====================================================================
DO $$
DECLARE
  t text;
  tables constant text[] := ARRAY[
    -- money
    'payment_requests', 'payroll_payments', 'cash_advances', 'cash_advance_receipts',
    'per_diem_ledger', 'overtime_entries', 'payroll_runs', 'payroll_run_items',
    'contract_budget_splits', 'project_fx_rates', 'budget_versions', 'budget_approvers',
    -- who may do what
    'user_roles', 'organization_members', 'project_members',
    -- the tenant and project records themselves (subscription, limits, status, FX)
    'organizations', 'projects'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'D05: table % not found, skipped', t;
      CONTINUE;
    END IF;
    -- log_audit_history reads NEW.id — skip tables without an id column.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = t AND column_name = 'id') THEN
      RAISE NOTICE 'D05: table % has no id column, skipped', t;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger tg
               JOIN pg_proc p ON p.oid = tg.tgfoid
               WHERE tg.tgrelid = ('public.' || t)::regclass
                 AND NOT tg.tgisinternal AND p.proname = 'log_audit_history') THEN
      CONTINUE;  -- already audited
    END IF;
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.log_audit_history()',
      'trg_audit_history_' || t, t);
  END LOOP;
END $$;
