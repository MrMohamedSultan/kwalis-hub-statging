-- =====================================================================
-- D12 — link a cost row to the budget LINE it belongs to
--
-- purchase_orders, cash_advance_receipts and per_diem_ledger already carry
-- linked_budget_line_id. invoices and payroll did not, so their spend could
-- only be reported per budget CODE and got repeated under every line of the
-- code (code 1101: the same 135,539.47 shown under each of its 4 lines).
--
-- This adds the same nullable column, with the same name, to the two tables
-- that lacked it. ADDITIVE: nullable, no default, no backfill, no change to
-- any existing row, view or function.
--
-- No automatic backfill, on purpose. The plan sheet asks to fill old rows
-- "where the code has a single line"; the owner's standing decision in
-- pending-items is "no automatic retro-fill — the accountant reviews row by
-- row". The stricter rule is followed. db/tools/d12_backfill_candidates.sql
-- only LISTS the unambiguous candidates for review.
--
-- Rollback:
--   ALTER TABLE public.invoices DROP COLUMN linked_budget_line_id;
--   ALTER TABLE public.payroll  DROP COLUMN linked_budget_line_id;
-- =====================================================================
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS linked_budget_line_id uuid
  REFERENCES public.budget_lines(id) ON DELETE SET NULL;

ALTER TABLE public.payroll
  ADD COLUMN IF NOT EXISTS linked_budget_line_id uuid
  REFERENCES public.budget_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_linked_budget_line
  ON public.invoices (linked_budget_line_id) WHERE linked_budget_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_linked_budget_line
  ON public.payroll (linked_budget_line_id) WHERE linked_budget_line_id IS NOT NULL;

COMMENT ON COLUMN public.invoices.linked_budget_line_id IS
  'Budget line this invoice is charged to. NULL = known only by budget_code (reported as "not assigned to a line").';
COMMENT ON COLUMN public.payroll.linked_budget_line_id IS
  'Budget line this payroll row is charged to. NULL = known only by budget_code (reported as "not assigned to a line").';

-- A link must point at a line of the SAME project and the SAME budget code,
-- otherwise per-line totals stop adding up to the per-code totals.
CREATE OR REPLACE FUNCTION public.validate_linked_budget_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_project uuid;
  v_code    text;
BEGIN
  IF NEW.linked_budget_line_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.linked_budget_line_id IS NOT DISTINCT FROM OLD.linked_budget_line_id
     AND NEW.budget_code IS NOT DISTINCT FROM OLD.budget_code THEN
    RETURN NEW;
  END IF;
  SELECT bl.project_id, bl.main_code INTO v_project, v_code
  FROM public.budget_lines bl WHERE bl.id = NEW.linked_budget_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: linked budget line not found', TG_TABLE_NAME USING ERRCODE = '23503';
  END IF;
  IF v_project IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION '%: linked budget line belongs to another project', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  IF btrim(coalesce(v_code, '')) IS DISTINCT FROM btrim(coalesce(NEW.budget_code, '')) THEN
    RAISE EXCEPTION '%: linked budget line is on code %, the row is on code %',
      TG_TABLE_NAME, v_code, NEW.budget_code USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_linked_budget_line_invoices
  BEFORE INSERT OR UPDATE OF linked_budget_line_id, budget_code, project_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.validate_linked_budget_line();
CREATE TRIGGER trg_validate_linked_budget_line_payroll
  BEFORE INSERT OR UPDATE OF linked_budget_line_id, budget_code, project_id ON public.payroll
  FOR EACH ROW EXECUTE FUNCTION public.validate_linked_budget_line();
