-- =====================================================================
-- 160 — Crew & Cast milestone payments reach the payments ledger
--
-- Problem (client, 2026-10-20): marking a contract milestone as Paid on the
-- Crew & Cast payables screen only changed payroll.payment_schedule (JSON).
-- Nothing was written to public.payments — the canonical ledger that the
-- budget (paid), the code position views, the reports and the cash views
-- read — so a paid milestone showed up nowhere else.
--
-- Fix: a trigger on payroll keeps one payments row per PAID milestone:
--   · milestone becomes Paid      → payments row inserted (or adopted, see below)
--   · amount / date / method edit → payments row updated
--   · milestone reopened/removed  → its payments row deleted
--   · payroll row deleted         → its milestone payments deleted
-- Rows are tied to their milestone by payments.payroll_milestone_id, so a
-- re-save never duplicates.
--
-- Adoption: a payroll payment recorded BEFORE this file (e.g. the single
-- owner-verified 2,000 SAR "On Signing" payment backfilled in migration
-- 20260824201651) is linked to the matching paid milestone (same payroll row,
-- same amount) instead of being duplicated.
--
-- The last statement back-fills every milestone already marked Paid.
--
-- Additive only. Rollback:
--   DROP TRIGGER trg_payroll_milestone_payments ON public.payroll;
--   DROP FUNCTION public.sync_payroll_milestone_payments();
--   DELETE FROM public.payments WHERE payroll_milestone_id IS NOT NULL
--     AND notes LIKE 'Milestone:%';        -- rows this file created
--   ALTER TABLE public.payments DROP COLUMN payroll_milestone_id;
-- =====================================================================

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payroll_milestone_id text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_payroll_milestone_key
  ON public.payments (source_id, payroll_milestone_id)
  WHERE payroll_milestone_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_payroll_milestone_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m         jsonb;
  v_total   numeric;
  v_amount  numeric;
  v_mid     text;
  v_method  text;
  v_date    date;
  v_label   text;
  v_idx     int := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.payments
     WHERE source_type = 'payroll' AND source_id = OLD.id AND payroll_milestone_id IS NOT NULL;
    RETURN OLD;
  END IF;

  -- Same base the payables screen uses: net payable when set, else the contract total.
  v_total := COALESCE(NEW.net_payable, NEW.total_amount, 0);

  -- 1. milestones that are no longer Paid (or were removed) lose their payment
  DELETE FROM public.payments p
   WHERE p.source_type = 'payroll'
     AND p.source_id = NEW.id
     AND p.payroll_milestone_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.payment_schedule, '[]'::jsonb)) e
        WHERE e->>'status' = 'Paid' AND e->>'id' = p.payroll_milestone_id);

  -- 2. every Paid milestone has exactly one payment, kept up to date
  FOR m IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.payment_schedule, '[]'::jsonb)) LOOP
    v_idx := v_idx + 1;
    v_mid := m->>'id';
    CONTINUE WHEN v_mid IS NULL OR m->>'status' IS DISTINCT FROM 'Paid';

    v_amount := round(COALESCE(NULLIF(m->>'amount', '')::numeric,
                               v_total * COALESCE(NULLIF(m->>'percent', '')::numeric, 0) / 100), 2);
    CONTINUE WHEN v_amount IS NULL OR v_amount <= 0;
    v_method := CASE WHEN m->>'paymentMethod' IN ('Cash', 'Transfer', 'Check', 'Card', 'Bank')
                     THEN m->>'paymentMethod' ELSE 'Transfer' END;
    v_date   := COALESCE(NULLIF(m->>'paidDate', '')::date, CURRENT_DATE);
    v_label  := 'Milestone: ' || COALESCE(NULLIF(m->>'label', ''), 'P' || v_idx)
                || COALESCE(' · ref ' || NULLIF(m->>'paidRef', ''), '');

    UPDATE public.payments
       SET amount = v_amount, payment_date = v_date, method = v_method,
           proof_path = COALESCE(NULLIF(m->>'proofPath', ''), proof_path),
           updated_at = now()
     WHERE source_type = 'payroll' AND source_id = NEW.id AND payroll_milestone_id = v_mid;
    CONTINUE WHEN FOUND;

    -- adopt a payment recorded by hand for this contract with the same amount
    UPDATE public.payments
       SET payroll_milestone_id = v_mid, updated_at = now()
     WHERE id = (SELECT id FROM public.payments
                  WHERE source_type = 'payroll' AND source_id = NEW.id
                    AND payroll_milestone_id IS NULL AND amount = v_amount
                  ORDER BY payment_date, created_at LIMIT 1);
    CONTINUE WHEN FOUND;

    INSERT INTO public.payments
      (organization_id, project_id, source_type, source_id, amount, payment_date,
       method, proof_path, notes, recorded_by, payroll_milestone_id)
    VALUES
      (NEW.organization_id, NEW.project_id, 'payroll', NEW.id, v_amount, v_date,
       v_method, NULLIF(m->>'proofPath', ''), v_label, auth.uid(), v_mid);
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_payroll_milestone_payments() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payroll_milestone_payments ON public.payroll;
CREATE TRIGGER trg_payroll_milestone_payments
  AFTER INSERT OR UPDATE OF payment_schedule, total_amount, net_payable OR DELETE
  ON public.payroll
  FOR EACH ROW EXECUTE FUNCTION public.sync_payroll_milestone_payments();

-- Back-fill: run the trigger once for every contract that already has a Paid milestone.
UPDATE public.payroll
   SET payment_schedule = payment_schedule
 WHERE payment_schedule IS NOT NULL
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(payment_schedule) e WHERE e->>'status' = 'Paid');
