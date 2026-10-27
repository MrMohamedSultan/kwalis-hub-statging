-- =====================================================================
-- 180 — Glossary + commitment model on every number
--
-- Spec items A01 A02 A03 A04 A05 A09 A12 R06 R07 B18 B19 X07 (+ carry-over
-- notes of 172 / 174 / 176). Client decisions 1–3 and the glossary.
--
-- The model (one definition, used by every view / RPC below and mirrored in
-- src/lib/budget-position.ts):
--   Commitment  contract / PO value − actual on it
--   Actual      approved instalments + invoices + APPROVED petty-cash receipts
--   Paid        money out (public.payments)
--   Payable     Actual − Paid
--   Remaining   Budget − Actual − Commitment
--   ETC         per budget code, editable (cost_report_etc), default max(Remaining, 0)
--   EFC         Actual + Commitment + ETC
--   Variance    Budget − EFC (positive = saving)
--   Cash        Funding − Paid − VAT paid + VAT recovered − WHT remitted
--
-- What changes
--   A01  A signed contract no longer counts as Actual on the day it is
--        created. v_ledger_transactions splits each payroll row into an
--        'actual' row (its Approved / Paid instalments, scaled from the net
--        instalment basis to the gross contract value) and a 'commitment'
--        row (the rest). A contract without instalments counts what was paid
--        on it (payments ledger / legacy Paid slots) as Actual and the rest
--        as Commitment. Payroll rows that mirror an invoice split
--        (ref_id 'invoice:…') are no longer counted twice.
--        Petty-cash receipts count as Actual only once approved.
--   A02  Instalment words: the JSON keeps its stored values (Pending / Hold /
--        Approved / Paid, written by the 160/176 triggers); Hold is shown and
--        mirrored as "Requested" (public.payroll_instalments.status).
--   A03  An Approved / Paid instalment cannot be edited (amount, percent,
--        label, due date). Un-approving = cancelling its approved payment
--        request (cancel_payment_request, org admin); that writes an
--        automatic reversal row in public.accrual_reversals, which the ledger
--        batch posts as the reversing entry.
--   A04  cancel_payroll_contract(): approved instalments stay Actual, the
--        rest leaves Commitment, open requests on it are cancelled, and no
--        new request can be raised. Reversed payroll runs (176) are marked
--        cancelled the same way, so they leave the budget views.
--   A05  public.payroll_instalments: one row per instalment (name, due date,
--        amount, status, request, approval date), kept in sync from
--        payroll.payment_schedule by trigger. The JSON stays the write path:
--        the 160 payment trigger and the 176 request/guard triggers are built
--        on it, and moving the source of truth would rewrite both of them and
--        every old screen. A save is refused when an instalment has no name
--        or due date, or when the instalments do not add up to the contract
--        (net payable) value. Payments keep their link (payments.source_id +
--        payroll_milestone_id = payroll_instalments key).
--   A09  Funding and direct tax movements live in the database (they were in
--        the browser only): project_funding.kind, new table
--        project_tax_payments (vat_paid / vat_recovered / wht_remitted), and
--        get_funding_position() returns the cash figures.
--   A12  get_funding_position(): funding received, paid, VAT / WHT, cash
--        balance, upcoming payments (approved, not paid), expected balance,
--        no-funding and overdrawn flags.
--   R06  get_cost_report_detail(): the Cost Report rows with Remaining,
--        Paid, Payable, % spent and the GL account, so one screen can group
--        by line / account / category. ETC stays editable in cost_report_etc.
--   B19  get_budget_reconciliation(): estimate in SAR (FX applied, same
--        function as the budget views), Commitment / Actual from
--        v_ledger_transactions (PO and its invoice no longer doubled, people
--        contracts converted and grossed up because they come from payroll).
--   Carry-over: post_payroll_run converts run lines to SAR (lines were booked
--        in the line currency); v_source_totals_by_code / v_paid_by_code /
--        v_budget_line_financials follow the glossary (they computed people
--        commitments as daily_rate × shooting_days, no FX, no gross-up).
--        v_project_position and v_budget_code_position gain payable_sar.
--
-- Redefined (copied from their latest definition, changed parts marked
-- "180"): v_ledger_transactions (174), v_budget_code_position,
-- v_project_position, v_source_totals_by_code, v_paid_by_code,
-- v_budget_line_financials, get_budget_reconciliation (live schema),
-- post_payroll_run, reverse_payroll_run (176).
-- Everything else is ADDITIVE. Backfills fill new columns / tables only:
-- payroll_instalments from the JSON, payroll.contract_cancelled_* for
-- payroll rows of runs that were already reversed.
--
-- SECURITY: new tables with RLS, SECURITY DEFINER triggers / RPCs, views read
-- by the app — per SECURITY.md apply only after owner approval.
--
-- Rollback (in this order):
--   DROP TRIGGER trg_payroll_instalments_sync ON public.payroll;
--   DROP TRIGGER trg_payroll_schedule_rules ON public.payroll;
--   DROP TRIGGER trg_payment_request_accrual_reversal ON public.payment_requests;
--   DROP TRIGGER trg_payment_request_cancelled_contract ON public.payment_requests;
--   DROP FUNCTION public.get_funding_position(uuid, date), public.get_cost_report_detail(uuid, date, date),
--     public.cancel_payroll_contract(uuid, text), public.sync_payroll_instalments(),
--     public.enforce_payroll_schedule_rules(), public.record_accrual_reversal(),
--     public.refuse_request_on_cancelled_contract(), public.payroll_contract_actual(jsonb, numeric, numeric, numeric),
--     public.payroll_legacy_paid(uuid, jsonb, jsonb, numeric), public.instalment_status_word(text),
--     public.amount_to_sar(numeric, text, uuid);
--   re-run db/pending/174 (v_ledger_transactions) and 176 (post_payroll_run,
--   reverse_payroll_run); restore the other views and get_budget_reconciliation
--   from the live schema dump;
--   DROP TABLE public.payroll_instalments, public.accrual_reversals, public.project_tax_payments;
--   ALTER TABLE public.payroll DROP COLUMN contract_cancelled_at, DROP COLUMN contract_cancelled_by,
--     DROP COLUMN contract_cancellation_reason;
--   ALTER TABLE public.project_funding DROP COLUMN kind;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
ALTER TABLE public.payroll ADD COLUMN IF NOT EXISTS contract_cancelled_at timestamptz;
ALTER TABLE public.payroll ADD COLUMN IF NOT EXISTS contract_cancelled_by uuid;
ALTER TABLE public.payroll ADD COLUMN IF NOT EXISTS contract_cancellation_reason text;
ALTER TABLE public.payroll DROP CONSTRAINT IF EXISTS payroll_contract_cancellation_reason_len;
ALTER TABLE public.payroll ADD CONSTRAINT payroll_contract_cancellation_reason_len
  CHECK (contract_cancellation_reason IS NULL OR length(contract_cancellation_reason) <= 1000);

ALTER TABLE public.project_funding ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE public.project_funding DROP CONSTRAINT IF EXISTS project_funding_kind_check;
ALTER TABLE public.project_funding ADD CONSTRAINT project_funding_kind_check
  CHECK (kind IS NULL OR kind IN ('Investor Tranche', 'Capital', 'Grant', 'Loan', 'Other'));

-- ---------------------------------------------------------------------
-- 2. Helpers (one definition; src/lib/budget-position.ts mirrors them)
-- ---------------------------------------------------------------------
-- Stored instalment status → glossary word.
CREATE OR REPLACE FUNCTION public.instalment_status_word(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_status
           WHEN 'Hold' THEN 'Requested'
           WHEN 'Approved' THEN 'Approved'
           WHEN 'Paid' THEN 'Paid'
           ELSE 'Pending' END
$$;

-- Amount in SAR: SAR as is; USD or the project currency at the project's
-- locked rate (3.75 when none); anything else unconverted.
CREATE OR REPLACE FUNCTION public.amount_to_sar(p_amount numeric, p_currency text, p_project uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(CASE
    WHEN upper(COALESCE(NULLIF(btrim(p_currency), ''), 'SAR')) = 'SAR' THEN COALESCE(p_amount, 0)
    WHEN upper(p_currency) = 'USD'
      OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project AND upper(p.currency) = upper(p_currency))
      THEN COALESCE(p_amount, 0) * COALESCE((SELECT NULLIF(p.fx_rate, 0) FROM public.projects p WHERE p.id = p_project), 3.75)
    ELSE COALESCE(p_amount, 0)
  END, 2)
$$;

-- What was paid on a contract that has no instalment schedule: the payments
-- ledger, or the legacy Paid slots (payments / percents JSON), whichever is
-- larger.
CREATE OR REPLACE FUNCTION public.payroll_legacy_paid(p_id uuid, p_payments jsonb, p_percents jsonb, p_total numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(
    COALESCE((SELECT sum(pm.amount) FROM public.payments pm
               WHERE pm.source_type = 'payroll' AND pm.source_id = p_id), 0),
    COALESCE((SELECT sum(COALESCE(p_total, 0)
                         * COALESCE(NULLIF(p_percents->>((s.ord - 1)::int), '')::numeric,
                                    100.0 / NULLIF(jsonb_array_length(p_payments), 0)) / 100)
                FROM jsonb_array_elements_text(
                       CASE WHEN jsonb_typeof(p_payments) = 'array' THEN p_payments ELSE '[]'::jsonb END)
                     WITH ORDINALITY AS s(st, ord)
               WHERE s.st = 'Paid'), 0))
$$;

-- Actual on a contract (decision 1): Approved / Paid instalments. Instalment
-- amounts are on the net payable basis; they are scaled to the gross
-- contract value so Actual + Commitment = contract value. Without a schedule:
-- what was paid on it (p_legacy_paid). Never above the contract value.
CREATE OR REPLACE FUNCTION public.payroll_contract_actual(p_schedule jsonb, p_total numeric, p_net numeric, p_legacy_paid numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH s AS (
    SELECT CASE WHEN jsonb_typeof(p_schedule) = 'array' THEN p_schedule ELSE '[]'::jsonb END AS sch,
           COALESCE(p_total, 0) AS total,
           CASE WHEN COALESCE(NULLIF(p_net, 0), p_total, 0) > 0
                THEN COALESCE(p_total, 0) / COALESCE(NULLIF(p_net, 0), p_total) ELSE 1 END AS scale
  )
  SELECT round(CASE
    WHEN jsonb_array_length(s.sch) = 0 THEN LEAST(s.total, GREATEST(COALESCE(p_legacy_paid, 0), 0))
    ELSE LEAST(s.total, GREATEST(0, COALESCE((
      SELECT sum(CASE WHEN NULLIF(e->>'amount', '') IS NOT NULL
                      THEN (e->>'amount')::numeric * s.scale
                      ELSE s.total * COALESCE(NULLIF(e->>'percent', '')::numeric, 0) / 100 END)
        FROM jsonb_array_elements(s.sch) e
       WHERE e->>'status' IN ('Approved', 'Paid')), 0)))
  END, 2)
  FROM s
$$;

GRANT EXECUTE ON FUNCTION public.instalment_status_word(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payroll_contract_actual(jsonb, numeric, numeric, numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.amount_to_sar(numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amount_to_sar(numeric, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.payroll_legacy_paid(uuid, jsonb, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_legacy_paid(uuid, jsonb, jsonb, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. A05 — instalments as rows (read model, written by trigger only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_instalments (
  payroll_id          uuid NOT NULL REFERENCES public.payroll(id) ON DELETE CASCADE,
  milestone_id        text NOT NULL,
  organization_id     uuid,
  project_id          uuid,
  seq                 integer NOT NULL,
  label               text,
  due_date            date,
  amount              numeric(14,2) NOT NULL DEFAULT 0,   -- net payable basis (what is paid)
  amount_gross        numeric(14,2) NOT NULL DEFAULT 0,   -- share of the contract value (budget)
  status              text NOT NULL CHECK (status IN ('Pending', 'Requested', 'Approved', 'Paid')),
  stored_status       text,                               -- value in payroll.payment_schedule
  payment_request_id  uuid,
  request_status      text,
  approved_at         timestamptz,
  paid_date           date,
  budget_code         text,
  contract_cancelled  boolean NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payroll_id, milestone_id)
);
CREATE INDEX IF NOT EXISTS payroll_instalments_project_idx ON public.payroll_instalments (project_id);
COMMENT ON TABLE public.payroll_instalments IS
  'One row per contract instalment, mirrored from payroll.payment_schedule by trigger (db/pending/180). Read only for the app. Payments link by (payments.source_id, payments.payroll_milestone_id) = (payroll_id, milestone_id); requests by (payment_requests.source_id, payroll_milestone_id).';

GRANT SELECT ON public.payroll_instalments TO authenticated;
GRANT ALL ON public.payroll_instalments TO service_role;
REVOKE ALL ON public.payroll_instalments FROM anon;
ALTER TABLE public.payroll_instalments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Project members read instalments" ON public.payroll_instalments;
CREATE POLICY "Project members read instalments" ON public.payroll_instalments
  FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));

CREATE OR REPLACE FUNCTION public.sync_payroll_instalments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
  v_base  numeric;
  v_scale numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;   -- rows go with the payroll row (ON DELETE CASCADE)
  END IF;
  v_total := COALESCE(NEW.total_amount, 0);
  v_base  := COALESCE(NULLIF(NEW.net_payable, 0), NEW.total_amount, 0);
  v_scale := CASE WHEN v_base > 0 THEN v_total / v_base ELSE 1 END;

  DELETE FROM public.payroll_instalments pi
   WHERE pi.payroll_id = NEW.id
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(NEW.payment_schedule) = 'array' THEN NEW.payment_schedule ELSE '[]'::jsonb END) e
                      WHERE e->>'id' = pi.milestone_id);

  INSERT INTO public.payroll_instalments AS pi
    (payroll_id, milestone_id, organization_id, project_id, seq, label, due_date, amount, amount_gross,
     status, stored_status, payment_request_id, request_status, approved_at, paid_date, budget_code,
     contract_cancelled, updated_at)
  SELECT NEW.id, e->>'id', NEW.organization_id, NEW.project_id, ord::int,
         NULLIF(btrim(e->>'label'), ''),
         CASE WHEN COALESCE(e->>'dueDate', e->>'due_date', '') ~ '^\d{4}-\d{2}-\d{2}'
              THEN left(COALESCE(e->>'dueDate', e->>'due_date'), 10)::date END,
         public.payroll_milestone_amount(e, v_base),
         round(CASE WHEN NULLIF(e->>'amount', '') IS NOT NULL THEN (e->>'amount')::numeric * v_scale
                    ELSE v_total * COALESCE(NULLIF(e->>'percent', '')::numeric, 0) / 100 END, 2),
         public.instalment_status_word(e->>'status'),
         e->>'status',
         q.id, q.status, q.approved_at,
         CASE WHEN e->>'status' = 'Paid' AND COALESCE(e->>'paidDate', '') ~ '^\d{4}-\d{2}-\d{2}'
              THEN left(e->>'paidDate', 10)::date END,
         NEW.budget_code,
         NEW.contract_cancelled_at IS NOT NULL,
         now()
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(NEW.payment_schedule) = 'array' THEN NEW.payment_schedule ELSE '[]'::jsonb END)
         WITH ORDINALITY AS t(e, ord)
    LEFT JOIN LATERAL (
      SELECT r.id, r.status, r.approved_at FROM public.payment_requests r
       WHERE r.source_type = 'payroll_row' AND r.source_id = NEW.id AND r.payroll_milestone_id = e->>'id'
       ORDER BY (r.status IN ('rejected', 'cancelled')), r.created_at DESC
       LIMIT 1) q ON true
   WHERE NULLIF(e->>'id', '') IS NOT NULL
  ON CONFLICT (payroll_id, milestone_id) DO UPDATE
     SET organization_id = EXCLUDED.organization_id, project_id = EXCLUDED.project_id,
         seq = EXCLUDED.seq, label = EXCLUDED.label, due_date = EXCLUDED.due_date,
         amount = EXCLUDED.amount, amount_gross = EXCLUDED.amount_gross,
         status = EXCLUDED.status, stored_status = EXCLUDED.stored_status,
         payment_request_id = EXCLUDED.payment_request_id, request_status = EXCLUDED.request_status,
         approved_at = EXCLUDED.approved_at, paid_date = EXCLUDED.paid_date,
         budget_code = EXCLUDED.budget_code, contract_cancelled = EXCLUDED.contract_cancelled,
         updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_payroll_instalments() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payroll_instalments_sync ON public.payroll;
CREATE TRIGGER trg_payroll_instalments_sync
  AFTER INSERT OR UPDATE ON public.payroll
  FOR EACH ROW EXECUTE FUNCTION public.sync_payroll_instalments();

-- ---------------------------------------------------------------------
-- 4. A05 + A03 + A04 — rules on every schedule save
--    (runs after trg_payroll_milestone_guard of 176: BEFORE triggers fire in
--     name order, so it sees the schedule with the request statuses restored)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_payroll_schedule_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sched   jsonb;
  v_base    numeric;
  v_sum     numeric;
  v_sig_old jsonb;
  v_sig_new jsonb;
  e         jsonb;
  o         jsonb;
BEGIN
  -- A04: the cancellation stamp is set by cancel_payroll_contract / reverse_payroll_run only
  IF TG_OP = 'UPDATE'
     AND (NEW.contract_cancelled_at IS DISTINCT FROM OLD.contract_cancelled_at
          OR NEW.contract_cancelled_by IS DISTINCT FROM OLD.contract_cancelled_by
          OR NEW.contract_cancellation_reason IS DISTINCT FROM OLD.contract_cancellation_reason)
     AND auth.uid() IS NOT NULL
     AND COALESCE(current_setting('kwalis.contract_cancel', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'A contract is cancelled with cancel_payroll_contract()' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.contract_cancelled_at IS NOT NULL AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'A new contract cannot start cancelled' USING ERRCODE = '42501';
  END IF;

  -- server jobs / SQL editor / request-driven status sync are not user edits
  IF auth.uid() IS NULL OR COALESCE(current_setting('kwalis.milestone_sync', true), '') <> '' THEN
    RETURN NEW;
  END IF;

  v_sched := CASE WHEN jsonb_typeof(NEW.payment_schedule) = 'array' THEN NEW.payment_schedule ELSE '[]'::jsonb END;
  v_base  := COALESCE(NULLIF(NEW.net_payable, 0), NEW.total_amount, 0);

  IF TG_OP = 'UPDATE' THEN
    -- A03: an Approved / Paid instalment is frozen — un-approve it first
    FOR o IN SELECT x FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(OLD.payment_schedule) = 'array' THEN OLD.payment_schedule ELSE '[]'::jsonb END) x
              WHERE x->>'status' IN ('Approved', 'Paid') LOOP
      SELECT x INTO e FROM jsonb_array_elements(v_sched) x WHERE x->>'id' = o->>'id' LIMIT 1;
      IF e IS NULL
         OR public.payroll_milestone_amount(e, v_base)
            IS DISTINCT FROM public.payroll_milestone_amount(o, COALESCE(NULLIF(OLD.net_payable, 0), OLD.total_amount, 0))
         OR COALESCE(e->>'label', '') IS DISTINCT FROM COALESCE(o->>'label', '')
         OR COALESCE(e->>'dueDate', e->>'due_date', '') IS DISTINCT FROM COALESCE(o->>'dueDate', o->>'due_date', '') THEN
        IF e IS NULL OR e->>'status' IN ('Approved', 'Paid') THEN
          RAISE EXCEPTION 'Instalment "%" is %: it cannot be edited or removed. Un-approve it first (this writes a reversing entry)',
            COALESCE(o->>'label', o->>'id'), o->>'status'
            USING ERRCODE = '42501';
        END IF;
      END IF;
      e := NULL;
    END LOOP;

    -- the A05 checks below run only when the schedule itself (or the value it
    -- must add up to) changed — a status-only update of an old schedule passes
    SELECT COALESCE(jsonb_agg(jsonb_build_array(x->'id', x->'label', COALESCE(x->'dueDate', x->'due_date'), x->'amount', x->'percent') ORDER BY ord), '[]'::jsonb)
      INTO v_sig_new FROM jsonb_array_elements(v_sched) WITH ORDINALITY t(x, ord);
    SELECT COALESCE(jsonb_agg(jsonb_build_array(x->'id', x->'label', COALESCE(x->'dueDate', x->'due_date'), x->'amount', x->'percent') ORDER BY ord), '[]'::jsonb)
      INTO v_sig_old FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(OLD.payment_schedule) = 'array' THEN OLD.payment_schedule ELSE '[]'::jsonb END) WITH ORDINALITY t(x, ord);
    IF v_sig_new = v_sig_old
       AND COALESCE(NULLIF(OLD.net_payable, 0), OLD.total_amount, 0) = v_base THEN
      RETURN NEW;
    END IF;
  END IF;

  IF jsonb_array_length(v_sched) = 0 THEN
    RETURN NEW;   -- no schedule: the whole contract is a commitment
  END IF;

  -- A05: every instalment has a name and a due date
  FOR e IN SELECT x FROM jsonb_array_elements(v_sched) x LOOP
    IF NULLIF(btrim(COALESCE(e->>'label', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Every instalment needs a name' USING ERRCODE = '23514';
    END IF;
    IF NOT (COALESCE(e->>'dueDate', e->>'due_date', '') ~ '^\d{4}-\d{2}-\d{2}') THEN
      RAISE EXCEPTION 'Instalment "%" needs a due date', e->>'label' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- A05: the instalments add up to the contract value (net payable basis)
  SELECT COALESCE(sum(public.payroll_milestone_amount(x, v_base)), 0) INTO v_sum
    FROM jsonb_array_elements(v_sched) x;
  IF abs(v_sum - round(v_base, 2)) > 0.01 THEN
    RAISE EXCEPTION 'The instalments add up to % but the contract value is % — the schedule must equal the contract',
      to_char(v_sum, 'FM999,999,999,990.00'), to_char(v_base, 'FM999,999,999,990.00')
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_schedule_rules ON public.payroll;
CREATE TRIGGER trg_payroll_schedule_rules
  BEFORE INSERT OR UPDATE ON public.payroll
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_schedule_rules();

-- ---------------------------------------------------------------------
-- 5. A03 — un-approving writes an automatic reversal
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accrual_reversals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  project_id           uuid,
  source_type          text NOT NULL CHECK (source_type IN ('payroll_instalment')),
  source_id            uuid NOT NULL,           -- payroll.id
  payroll_milestone_id text,
  payment_request_id   uuid REFERENCES public.payment_requests(id) ON DELETE SET NULL,
  budget_code          text,
  amount               numeric(14,2) NOT NULL,  -- Actual reversed (gross, SAR)
  net_amount           numeric(14,2) NOT NULL,  -- instalment amount (net payable basis)
  accrued_at           timestamptz,             -- when it had been approved
  reversed_at          timestamptz NOT NULL DEFAULT now(),
  reversed_by          uuid,
  reason               text CHECK (reason IS NULL OR length(reason) <= 1000)
);
CREATE INDEX IF NOT EXISTS accrual_reversals_project_idx ON public.accrual_reversals (project_id, reversed_at);
COMMENT ON TABLE public.accrual_reversals IS
  'A03: one row each time an Approved instalment is un-approved (its approved payment request cancelled). The ledger posts it as the reverse of the accrual (Dr Accounts Payable / Cr expense) on reversed_at. Written by trigger only.';
GRANT SELECT ON public.accrual_reversals TO authenticated;
GRANT ALL ON public.accrual_reversals TO service_role;
REVOKE ALL ON public.accrual_reversals FROM anon;
ALTER TABLE public.accrual_reversals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Project members read accrual reversals" ON public.accrual_reversals;
CREATE POLICY "Project members read accrual reversals" ON public.accrual_reversals
  FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));

CREATE OR REPLACE FUNCTION public.record_accrual_reversal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p     public.payroll%ROWTYPE;
  v_base numeric;
BEGIN
  IF NOT (OLD.status = 'approved' AND NEW.status = 'cancelled' AND NEW.payroll_milestone_id IS NOT NULL
          AND NEW.source_type = 'payroll_row') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO p FROM public.payroll WHERE id = NEW.source_id;
  v_base := COALESCE(NULLIF(p.net_payable, 0), p.total_amount, 0);
  INSERT INTO public.accrual_reversals
    (organization_id, project_id, source_type, source_id, payroll_milestone_id, payment_request_id,
     budget_code, amount, net_amount, accrued_at, reversed_by, reason)
  VALUES
    (NEW.organization_id, NEW.project_id, 'payroll_instalment', NEW.source_id, NEW.payroll_milestone_id, NEW.id,
     p.budget_code,
     round(CASE WHEN v_base > 0 THEN NEW.requested_amount * COALESCE(p.total_amount, 0) / v_base
                ELSE NEW.requested_amount END, 2),
     NEW.requested_amount, OLD.approved_at, auth.uid(), NEW.cancellation_reason);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_accrual_reversal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payment_request_accrual_reversal ON public.payment_requests;
CREATE TRIGGER trg_payment_request_accrual_reversal
  AFTER UPDATE OF status ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.record_accrual_reversal();

-- ---------------------------------------------------------------------
-- 6. A04 — cancel a contract
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refuse_request_on_cancelled_contract()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.source_type = 'payroll_row' AND EXISTS (
       SELECT 1 FROM public.payroll p WHERE p.id = NEW.source_id AND p.contract_cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This contract is cancelled: no new payment can be requested on it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.refuse_request_on_cancelled_contract() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payment_request_cancelled_contract ON public.payment_requests;
CREATE TRIGGER trg_payment_request_cancelled_contract
  BEFORE INSERT ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.refuse_request_on_cancelled_contract();

CREATE OR REPLACE FUNCTION public.cancel_payroll_contract(_payroll uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_reason text := btrim(COALESCE(_reason, ''));
  p        public.payroll%ROWTYPE;
  v_req    int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'cancel_payroll_contract: not signed in' USING ERRCODE = '42501';
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'A cancellation needs a reason (3 to 1000 characters)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM public.payroll WHERE id = _payroll FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_super_admin(v_uid) OR public.is_org_member(v_uid, p.organization_id)) THEN
    RAISE EXCEPTION 'cancel_payroll_contract: contract not found' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_super_admin(v_uid) OR public.is_org_admin(v_uid, p.organization_id)) THEN
    RAISE EXCEPTION 'Only an organization admin can cancel a contract' USING ERRCODE = '42501';
  END IF;
  IF p.contract_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'This contract is already cancelled' USING ERRCODE = '42501';
  END IF;

  -- open requests on instalments that are not approved yet are cancelled
  -- (recorded, not deleted); their instalments return to Pending (176 sync)
  WITH c AS (
    UPDATE public.payment_requests q
       SET status = 'cancelled', cancellation_reason = left('Contract cancelled: ' || v_reason, 1000)
     WHERE q.source_type = 'payroll_row' AND q.source_id = p.id
       AND q.status IN ('draft', 'waiting_approval')
    RETURNING 1)
  SELECT count(*) INTO v_req FROM c;

  PERFORM set_config('kwalis.contract_cancel', p.id::text, true);
  UPDATE public.payroll
     SET contract_cancelled_at = now(), contract_cancelled_by = v_uid,
         contract_cancellation_reason = v_reason
   WHERE id = p.id;
  PERFORM set_config('kwalis.contract_cancel', '', true);

  RETURN jsonb_build_object('requests_cancelled', v_req,
    'actual_kept', public.payroll_contract_actual(p.payment_schedule, p.total_amount, p.net_payable,
                     public.payroll_legacy_paid(p.id, p.payments, p.percents, p.total_amount)));
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_payroll_contract(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_payroll_contract(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. v_ledger_transactions — copy of 174; changes marked "180"
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ledger_transactions WITH (security_invoker = on) AS
 SELECT i.id,
    'invoice'::text AS source_type,
    i.id AS source_id,
    'actual'::text AS entry_kind,
    i.date AS entry_date,
    i.invoice_no AS reference,
    i.description,
    i.vendor_name AS counterparty,
    i.budget_code,
    i.gl_account_id,
    i.department,
    COALESCE(i.price, 0::numeric) AS amount,
    COALESCE(i.vat_amount, 0::numeric) AS vat_amount,
    COALESCE(i.net_payable, COALESCE(i.price, 0::numeric) + COALESCE(i.vat_amount, 0::numeric)) AS total,
    org.base_currency AS currency,
    NULL::text AS status,
    COALESCE(i.rebate_eligible, false) AS qfe_eligible,
    i.organization_id,
    i.project_id,
    i.created_at,
    COALESCE(i.wht_amount, 0::numeric) AS wht_amount
   FROM public.invoices i
     LEFT JOIN public.organizations org ON org.id = i.organization_id
UNION ALL
 -- 180: payroll = Actual for Approved / Paid instalments only
 SELECT p.id,
    'payroll'::text AS source_type,
    p.id AS source_id,
    'actual'::text AS entry_kind,
    p.created_at::date AS entry_date,
        CASE
            WHEN p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN NULL::text
            ELSE p.ref_id
        END AS reference,
    p.kind AS description,
    p.name AS counterparty,
    p.budget_code,
    p.gl_account_id,
    NULL::text AS department,
    pc.actual AS amount,
    0::numeric AS vat_amount,
    pc.actual AS total,
    org.base_currency AS currency,
    'Approved'::text AS status,
    false AS qfe_eligible,
    p.organization_id,
    p.project_id,
    p.created_at,
    CASE WHEN COALESCE(p.total_amount, 0) > 0
         THEN round(COALESCE(p.wht_amount, 0::numeric) * pc.actual / p.total_amount, 2)
         ELSE 0::numeric END AS wht_amount
   FROM public.payroll p
     LEFT JOIN public.organizations org ON org.id = p.organization_id
     CROSS JOIN LATERAL (SELECT public.payroll_contract_actual(p.payment_schedule, p.total_amount, p.net_payable,
                                  CASE WHEN jsonb_array_length(COALESCE(p.payment_schedule, '[]'::jsonb)) = 0
                                       THEN public.payroll_legacy_paid(p.id, p.payments, p.percents, p.total_amount)
                                       ELSE 0 END) AS actual) pc
  WHERE COALESCE(p.ref_id, '') NOT LIKE 'invoice:%'
    AND pc.actual <> 0
UNION ALL
 -- 180: payroll = Commitment for the rest of the contract (none once cancelled)
 SELECT p.id,
    'payroll'::text AS source_type,
    p.id AS source_id,
    'commitment'::text AS entry_kind,
    p.created_at::date AS entry_date,
        CASE
            WHEN p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN NULL::text
            ELSE p.ref_id
        END AS reference,
    p.kind AS description,
    p.name AS counterparty,
    p.budget_code,
    p.gl_account_id,
    NULL::text AS department,
    GREATEST(COALESCE(p.total_amount, 0::numeric) - pc.actual, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    GREATEST(COALESCE(p.total_amount, 0::numeric) - pc.actual, 0::numeric) AS total,
    org.base_currency AS currency,
    'Pending'::text AS status,
    false AS qfe_eligible,
    p.organization_id,
    p.project_id,
    p.created_at,
    0::numeric AS wht_amount
   FROM public.payroll p
     LEFT JOIN public.organizations org ON org.id = p.organization_id
     CROSS JOIN LATERAL (SELECT public.payroll_contract_actual(p.payment_schedule, p.total_amount, p.net_payable,
                                  CASE WHEN jsonb_array_length(COALESCE(p.payment_schedule, '[]'::jsonb)) = 0
                                       THEN public.payroll_legacy_paid(p.id, p.payments, p.percents, p.total_amount)
                                       ELSE 0 END) AS actual) pc
  WHERE COALESCE(p.ref_id, '') NOT LIKE 'invoice:%'
    AND p.contract_cancelled_at IS NULL
    AND COALESCE(p.total_amount, 0::numeric) - pc.actual > 0
UNION ALL
 SELECT po.id,
    'purchase_order'::text AS source_type,
    po.id AS source_id,
    'commitment'::text AS entry_kind,
    po.date AS entry_date,
    po.po_number AS reference,
    po.description,
    po.vendor_name AS counterparty,
    po.budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    GREATEST(COALESCE(po.amount, 0::numeric) - COALESCE(inv.invoiced, 0::numeric), 0::numeric) AS amount,
    0::numeric AS vat_amount,
    GREATEST(COALESCE(po.amount, 0::numeric) - COALESCE(inv.invoiced, 0::numeric), 0::numeric) AS total,
    org.base_currency AS currency,
    po.status,
    false AS qfe_eligible,
    po.organization_id,
    po.project_id,
    po.created_at,
    0::numeric AS wht_amount
   FROM public.purchase_orders po
     LEFT JOIN public.organizations org ON org.id = po.organization_id
     LEFT JOIN LATERAL (
       SELECT sum(COALESCE(i2.price, 0::numeric)) AS invoiced
         FROM public.invoices i2 WHERE i2.purchase_order_id = po.id
     ) inv ON true
  WHERE public.po_is_commitment(po.status)
UNION ALL
 SELECT r.id,
    'petty_cash'::text AS source_type,
    r.id AS source_id,
    'actual'::text AS entry_kind,
    r.date AS entry_date,
    NULL::text AS reference,
    r.description,
    COALESCE(r.vendor, r.recipient) AS counterparty,
    r.budget_code,
    r.gl_account_id,
    r.department,
    COALESCE(r.amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(r.amount, 0::numeric) AS total,
    COALESCE(r.currency, org.base_currency) AS currency,
    r.status,
    false AS qfe_eligible,
    r.organization_id,
    r.project_id,
    r.created_at,
    0::numeric AS wht_amount
   FROM public.cash_advance_receipts r
     LEFT JOIN public.organizations org ON org.id = r.organization_id
  WHERE r.status = 'approved'                                               -- 180
UNION ALL
 SELECT ot.id,
    'overtime'::text AS source_type,
    ot.id AS source_id,
    'actual'::text AS entry_kind,
    ot.work_date AS entry_date,
    NULL::text AS reference,
    NULL::text AS description,
    ot.person_name AS counterparty,
    ot.budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    COALESCE(ot.amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(ot.amount, 0::numeric) AS total,
    COALESCE(ot.currency, org.base_currency) AS currency,
    ot.status,
    false AS qfe_eligible,
    ot.organization_id,
    ot.project_id,
    ot.created_at,
    0::numeric AS wht_amount
   FROM public.overtime_entries ot
     LEFT JOIN public.organizations org ON org.id = ot.organization_id
UNION ALL
 SELECT d.id,
    'per_diem'::text AS source_type,
    d.id AS source_id,
    'actual'::text AS entry_kind,
    d.period_start AS entry_date,
    NULL::text AS reference,
    'Per diem '::text || d.period_start || ' – '::text || d.period_end AS description,
    pe.full_name AS counterparty,
    d.budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    COALESCE(d.total_amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(d.total_amount, 0::numeric) AS total,
    COALESCE(d.currency, org.base_currency) AS currency,
    d.status,
    false AS qfe_eligible,
    d.organization_id,
    d.project_id,
    d.created_at,
    0::numeric AS wht_amount
   FROM public.per_diem_ledger d
     LEFT JOIN public.people pe ON pe.id = d.person_id
     LEFT JOIN public.organizations org ON org.id = d.organization_id
UNION ALL
 SELECT pay.id,
    'payment'::text AS source_type,
    pay.source_id,
    'payment'::text AS entry_kind,
    pay.payment_date AS entry_date,
    NULL::text AS reference,
    pay.source_type || ' payment'::text AS description,
    NULL::text AS counterparty,
    NULL::text AS budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    COALESCE(pay.amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(pay.amount, 0::numeric) AS total,
    org.base_currency AS currency,
    NULL::text AS status,
    false AS qfe_eligible,
    pay.organization_id,
    pay.project_id,
    pay.created_at,
    0::numeric AS wht_amount
   FROM public.payments pay
     LEFT JOIN public.organizations org ON org.id = pay.organization_id
UNION ALL
 SELECT cr.id,
    'car_rental'::text AS source_type,
    cr.id AS source_id,
    'commitment'::text AS entry_kind,
    cr.rental_start_date AS entry_date,
    cr.license_plate AS reference,
    cr.make_model AS description,
    cr.vendor_name AS counterparty,
    COALESCE(NULLIF(cr.budget_code, ''), bl.main_code) AS budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    GREATEST(round(COALESCE(cr.total_amount, 0::numeric)
                   * CASE WHEN upper(cr.currency) = 'USD' THEN COALESCE(pr.fx_rate, 3.75) ELSE 1 END, 2)
             - COALESCE(ci.price, 0::numeric), 0::numeric) AS amount,
    0::numeric AS vat_amount,
    GREATEST(round(COALESCE(cr.total_amount, 0::numeric)
                   * CASE WHEN upper(cr.currency) = 'USD' THEN COALESCE(pr.fx_rate, 3.75) ELSE 1 END, 2)
             - COALESCE(ci.price, 0::numeric), 0::numeric) AS total,
    org.base_currency AS currency,
    NULL::text AS status,
    false AS qfe_eligible,
    COALESCE(cr.organization_id, pr.organization_id) AS organization_id,
    cr.project_id,
    cr.created_at,
    0::numeric AS wht_amount
   FROM public.car_rentals cr
     LEFT JOIN public.projects pr ON pr.id = cr.project_id
     LEFT JOIN public.organizations org ON org.id = COALESCE(cr.organization_id, pr.organization_id)
     LEFT JOIN public.budget_lines bl ON bl.id = cr.linked_budget_line_id
     LEFT JOIN public.invoices ci ON ci.id = cr.invoice_id
  WHERE COALESCE(cr.total_amount, 0) > 0
UNION ALL
 SELECT ac.id,
    'accommodation'::text AS source_type,
    ac.id AS source_id,
    'commitment'::text AS entry_kind,
    ac.check_in_date AS entry_date,
    ac.room_number AS reference,
    COALESCE(ac.hotel_name, 'Accommodation') || ' · ' || COALESCE(pe.full_name, '') AS description,
    COALESCE(ac.vendor_name, ac.hotel_name) AS counterparty,
    COALESCE(NULLIF(ac.budget_code, ''), bl.main_code) AS budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    GREATEST(round(COALESCE(ac.total_amount, 0::numeric)
                   * CASE WHEN upper(ac.currency) = 'USD' THEN COALESCE(pr.fx_rate, 3.75) ELSE 1 END, 2)
             - COALESCE(ai.price, 0::numeric), 0::numeric) AS amount,
    0::numeric AS vat_amount,
    GREATEST(round(COALESCE(ac.total_amount, 0::numeric)
                   * CASE WHEN upper(ac.currency) = 'USD' THEN COALESCE(pr.fx_rate, 3.75) ELSE 1 END, 2)
             - COALESCE(ai.price, 0::numeric), 0::numeric) AS total,
    org.base_currency AS currency,
    NULL::text AS status,
    false AS qfe_eligible,
    COALESCE(ac.organization_id, pr.organization_id) AS organization_id,
    ac.project_id,
    ac.created_at,
    0::numeric AS wht_amount
   FROM public.accommodations ac
     LEFT JOIN public.projects pr ON pr.id = ac.project_id
     LEFT JOIN public.organizations org ON org.id = COALESCE(ac.organization_id, pr.organization_id)
     LEFT JOIN public.people pe ON pe.id = ac.person_id
     LEFT JOIN public.budget_lines bl ON bl.id = ac.linked_budget_line_id
     LEFT JOIN public.invoices ai ON ai.id = ac.invoice_id
  WHERE COALESCE(ac.total_amount, 0) > 0;

COMMENT ON VIEW public.v_ledger_transactions IS
  'One row per cost document and kind. actual = invoices, approved / paid contract instalments (scaled to the gross contract value), approved petty-cash receipts, overtime, per diem; commitment = the rest of each contract (none once cancelled), purchase orders (net of invoices raised on them, commitment states only), car rentals and accommodation (net of their linked invoice); payment = payments ledger. A payroll row can appear twice (actual + commitment) with the same id. Amounts in SAR. Redefined by db/pending/180.';

-- ---------------------------------------------------------------------
-- 8. Position views — live definitions + payable_sar ("180")
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_budget_code_position WITH (security_invoker = on) AS
 WITH lines AS (
         SELECT bl.project_id,
            bl.main_code AS budget_code,
            count(*) AS line_count,
            sum(public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap, bl.unit, bl.currency, bl.excluded, p_1.fx_rate)) AS budget_sar
           FROM (public.v_active_budget_lines bl
             JOIN public.projects p_1 ON ((p_1.id = bl.project_id)))
          GROUP BY bl.project_id, bl.main_code
        ), ledger2 AS (
         SELECT t.project_id,
            t.budget_code,
            sum(t.amount) FILTER (WHERE (t.entry_kind = 'actual'::text)) AS actual_sar,
            sum(t.amount) FILTER (WHERE (t.entry_kind = 'commitment'::text)) AS committed_sar
           FROM public.v_ledger_transactions t
          GROUP BY t.project_id, t.budget_code
        ), paid AS (
         SELECT pd_1.project_id,
            pd_1.budget_code,
            sum(pd_1.paid_sar) AS paid_sar
           FROM public.v_paid_by_budget_code pd_1
          GROUP BY pd_1.project_id, pd_1.budget_code
        )
 SELECT COALESCE(li.project_id, l.project_id, pd.project_id) AS project_id,
    p.organization_id,
    COALESCE(li.budget_code, l.budget_code, pd.budget_code) AS budget_code,
    (COALESCE(li.line_count, (0)::bigint))::integer AS line_count,
    COALESCE(li.budget_sar, (0)::numeric) AS budget_sar,
    COALESCE(l.actual_sar, (0)::numeric) AS actual_sar,
    COALESCE(l.committed_sar, (0)::numeric) AS committed_sar,
    COALESCE(pd.paid_sar, (0)::numeric) AS paid_sar,
    ((COALESCE(li.budget_sar, (0)::numeric) - COALESCE(l.actual_sar, (0)::numeric)) - COALESCE(l.committed_sar, (0)::numeric)) AS available_sar,
    (COALESCE(l.actual_sar, (0)::numeric) - COALESCE(pd.paid_sar, (0)::numeric)) AS payable_sar   -- 180
   FROM (((lines li
     FULL JOIN ledger2 l ON (((l.project_id = li.project_id) AND (NOT (l.budget_code IS DISTINCT FROM li.budget_code)))))
     FULL JOIN paid pd ON (((pd.project_id = COALESCE(li.project_id, l.project_id)) AND (NOT (pd.budget_code IS DISTINCT FROM COALESCE(li.budget_code, l.budget_code))))))
     JOIN public.projects p ON ((p.id = COALESCE(li.project_id, l.project_id, pd.project_id))));
COMMENT ON VIEW public.v_budget_code_position IS 'Account-code position: one row per (project, main_code), glossary definitions (db/pending/180): actual_sar = Actual, committed_sar = Commitment, paid_sar = Paid, available_sar = Remaining Budget (Budget − Actual − Commitment), payable_sar = Actual − Paid. line_count = 0: money on an unbudgeted code; budget_code NULL: codeless money. Σ over rows ≡ v_project_position. Full precision.';

CREATE OR REPLACE VIEW public.v_project_position WITH (security_invoker = on) AS
 WITH codes AS (
         SELECT DISTINCT bl.project_id,
            bl.main_code AS budget_code
           FROM public.v_active_budget_lines bl
          WHERE (bl.main_code IS NOT NULL)
        ), ledger AS (
         SELECT t.project_id,
            sum(t.amount) FILTER (WHERE (t.entry_kind = 'actual'::text)) AS actual_sar,
            sum(t.amount) FILTER (WHERE (t.entry_kind = 'commitment'::text)) AS committed_sar,
            sum(t.vat_amount) AS vat_sar,
            sum(t.wht_amount) AS wht_sar
           FROM public.v_ledger_transactions t
          GROUP BY t.project_id
        ), unalloc AS (
         SELECT t.project_id,
            sum(t.amount) FILTER (WHERE (t.entry_kind = 'actual'::text)) AS unallocated_actual_sar,
            sum(t.amount) FILTER (WHERE (t.entry_kind = 'commitment'::text)) AS unallocated_committed_sar
           FROM (public.v_ledger_transactions t
             LEFT JOIN codes c ON (((c.project_id = t.project_id) AND (c.budget_code = t.budget_code))))
          WHERE (c.budget_code IS NULL)
          GROUP BY t.project_id
        ), paid AS (
         SELECT pd_1.project_id,
            sum(pd_1.paid_sar) AS paid_sar
           FROM public.v_paid_by_budget_code pd_1
          GROUP BY pd_1.project_id
        ), unalloc_paid AS (
         SELECT pd_1.project_id,
            sum(pd_1.paid_sar) AS unallocated_paid_sar
           FROM (public.v_paid_by_budget_code pd_1
             LEFT JOIN codes c ON (((c.project_id = pd_1.project_id) AND (c.budget_code = pd_1.budget_code))))
          WHERE (c.budget_code IS NULL)
          GROUP BY pd_1.project_id
        ), budget AS (
         SELECT bl.project_id,
            sum(public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap, bl.unit, bl.currency, bl.excluded, p_1.fx_rate)) AS budget_sar
           FROM (public.v_active_budget_lines bl
             JOIN public.projects p_1 ON ((p_1.id = bl.project_id)))
          GROUP BY bl.project_id
        )
 SELECT p.id AS project_id,
    p.organization_id,
    COALESCE(b.budget_sar, (0)::numeric) AS budget_sar,
    COALESCE(l.actual_sar, (0)::numeric) AS actual_sar,
    COALESCE(l.committed_sar, (0)::numeric) AS committed_sar,
    COALESCE(pd.paid_sar, (0)::numeric) AS paid_sar,
    COALESCE(l.vat_sar, (0)::numeric) AS vat_sar,
    COALESCE(l.wht_sar, (0)::numeric) AS wht_sar,
    ((COALESCE(b.budget_sar, (0)::numeric) - COALESCE(l.actual_sar, (0)::numeric)) - COALESCE(l.committed_sar, (0)::numeric)) AS available_sar,
    COALESCE(u.unallocated_actual_sar, (0)::numeric) AS unallocated_actual_sar,
    COALESCE(u.unallocated_committed_sar, (0)::numeric) AS unallocated_committed_sar,
    COALESCE(up.unallocated_paid_sar, (0)::numeric) AS unallocated_paid_sar,
    (COALESCE(l.actual_sar, (0)::numeric) - COALESCE(pd.paid_sar, (0)::numeric)) AS payable_sar   -- 180
   FROM (((((public.projects p
     LEFT JOIN budget b ON ((b.project_id = p.id)))
     LEFT JOIN ledger l ON ((l.project_id = p.id)))
     LEFT JOIN paid pd ON ((pd.project_id = p.id)))
     LEFT JOIN unalloc u ON ((u.project_id = p.id)))
     LEFT JOIN unalloc_paid up ON ((up.project_id = p.id)));
COMMENT ON VIEW public.v_project_position IS 'Project rollup, glossary definitions (db/pending/180): actual_sar = Actual, committed_sar = Commitment, paid_sar = Paid (payments ledger), available_sar = Remaining Budget, payable_sar = Actual − Paid. unallocated_* = money whose code is NULL or matches no budget line. Full precision.';

-- Legacy per-line views (not read by the app): same definitions, so nobody
-- finds a second set of numbers in them. Column names / types unchanged.
CREATE OR REPLACE VIEW public.v_paid_by_code WITH (security_invoker = on) AS
 SELECT t.project_id,
    t.budget_code,
    (round(sum(t.amount), 2))::numeric(14,2) AS actuals
   FROM public.v_ledger_transactions t
  WHERE t.entry_kind = 'actual' AND t.project_id IS NOT NULL AND t.budget_code IS NOT NULL
  GROUP BY t.project_id, t.budget_code;
COMMENT ON VIEW public.v_paid_by_code IS 'Actual by (project, code), glossary definition (db/pending/180). Despite the name this is Actual, not Paid.';

CREATE OR REPLACE VIEW public.v_source_totals_by_code WITH (security_invoker = on) AS
 SELECT t.project_id,
    t.budget_code,
    (round(sum(t.amount), 2))::numeric(14,2) AS source_total
   FROM public.v_ledger_transactions t
  WHERE t.entry_kind IN ('actual', 'commitment') AND t.project_id IS NOT NULL AND t.budget_code IS NOT NULL
  GROUP BY t.project_id, t.budget_code;
COMMENT ON VIEW public.v_source_totals_by_code IS 'Actual + Commitment by (project, code), SAR (db/pending/180).';

CREATE OR REPLACE VIEW public.v_budget_line_financials WITH (security_invoker = on) AS
 SELECT bl.id AS budget_line_id,
    bl.project_id,
    bl.organization_id,
    bl.main_code AS budget_code,
    bl.description,
    bl.currency,
    (public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap, bl.unit, bl.currency, bl.excluded, pr.fx_rate))::numeric(14,2) AS estimate,
    (COALESCE(a.actuals, (0)::numeric))::numeric(14,2) AS actuals,
    (GREATEST((COALESCE(st.source_total, (0)::numeric) - COALESCE(a.actuals, (0)::numeric)), (0)::numeric))::numeric(14,2) AS committed,
    ((public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap, bl.unit, bl.currency, bl.excluded, pr.fx_rate)
      - COALESCE(st.source_total, (0)::numeric)))::numeric(14,2) AS variance
   FROM (((public.v_active_budget_lines bl
     LEFT JOIN public.projects pr ON ((pr.id = bl.project_id)))
     LEFT JOIN public.v_paid_by_code a ON (((a.project_id = bl.project_id) AND (a.budget_code = bl.main_code))))
     LEFT JOIN public.v_source_totals_by_code st ON (((st.project_id = bl.project_id) AND (st.budget_code = bl.main_code))));
COMMENT ON VIEW public.v_budget_line_financials IS 'Per budget line: estimate in SAR, the code''s Actual and Commitment, variance = Remaining Budget of the code (db/pending/180). Lines sharing a code each show the code''s money.';

-- ---------------------------------------------------------------------
-- 9. B19 — Budget Reconciliation on the same definitions (same signature)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_budget_reconciliation(_project uuid, _from date DEFAULT NULL::date, _to date DEFAULT NULL::date)
RETURNS TABLE(budget_code text, description text, is_header boolean, parent_code text, currency text,
              master_planned numeric, master_actual numeric, project_estimate numeric, committed numeric,
              actuals numeric, variance numeric, in_master boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER                                                            -- 180 (was DEFINER)
SET search_path TO 'public'
AS $$
WITH access AS (
  SELECT public.can_access_project(
           auth.uid(),
           (SELECT p.organization_id FROM public.projects p WHERE p.id = _project),
           _project
         ) AS ok
),
d AS (
  SELECT COALESCE(_from, '-infinity'::date) AS df, COALESCE(_to, 'infinity'::date) AS dt
),
-- 180: estimate in SAR with the project's rate (same as v_budget_code_position)
est AS (
  SELECT bl.main_code AS code,
         round(sum(public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap,
                                                bl.unit, bl.currency, bl.excluded, pr.fx_rate)), 2) AS amt,
         max(bl.description) AS descr
  FROM public.v_active_budget_lines bl
  JOIN public.projects pr ON pr.id = bl.project_id
  WHERE bl.project_id = _project
    AND bl.main_code IS NOT NULL
  GROUP BY bl.main_code
),
-- 180: Commitment / Actual from v_ledger_transactions (glossary)
led AS (
  SELECT t.budget_code AS code,
         round(sum(t.amount) FILTER (WHERE t.entry_kind = 'commitment'), 2) AS com,
         round(sum(t.amount) FILTER (WHERE t.entry_kind = 'actual'), 2) AS act
  FROM public.v_ledger_transactions t, d
  WHERE t.project_id = _project
    AND t.budget_code IS NOT NULL
    AND t.entry_kind IN ('actual', 'commitment')
    AND COALESCE(t.entry_date, t.created_at::date) BETWEEN d.df AND d.dt
  GROUP BY t.budget_code
),
codes AS (
  SELECT code FROM est
  UNION SELECT code FROM led
)
SELECT
  c.code,
  COALESCE(mb.description, e.descr, '(unmapped code)'),
  COALESCE(mb.is_header, false),
  mb.parent_code,
  'SAR'::text,                                                              -- 180: every amount is SAR
  round(COALESCE(mb.planned_amount, 0), 2),
  round(COALESCE(mb.actual_amount, 0), 2),
  round(COALESCE(e.amt, 0), 2),
  round(COALESCE(l.com, 0), 2),
  round(COALESCE(l.act, 0), 2),
  round(COALESCE(e.amt, 0) - COALESCE(l.act, 0) - COALESCE(l.com, 0), 2),   -- 180: Remaining Budget
  (mb.budget_code IS NOT NULL)
FROM codes c
CROSS JOIN access a
LEFT JOIN est e ON e.code = c.code
LEFT JOIN led l ON l.code = c.code
LEFT JOIN public.master_budget mb ON mb.budget_code = c.code
WHERE a.ok
ORDER BY c.code;
$$;
REVOKE ALL ON FUNCTION public.get_budget_reconciliation(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_budget_reconciliation(uuid, date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. R06 / R07 — Cost Report detail (one definition: get_cost_report)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cost_report_detail(
  p_project_id uuid,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
RETURNS TABLE (
  "group"         text,
  topsheet_code   text,
  topsheet_name   text,
  budget_code     text,
  description     text,
  gl_code         text,
  gl_name         text,
  budget          numeric,
  actual          numeric,
  commitment      numeric,
  remaining       numeric,
  paid_to_date    numeric,
  paid_period     numeric,
  payable         numeric,
  etc             numeric,
  efc             numeric,
  variance        numeric,
  pct_spent       numeric,
  etc_is_manual   boolean,
  etc_updated_at  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  RETURN QUERY
  SELECT r."group", r.topsheet_code, r.topsheet_name, r.budget_code, r.description,
         g.code, g.name,
         r.estimate, r.actual, r.committed,
         round(r.estimate - r.actual - r.committed, 2),
         r.paid_to_date, r.paid_period,
         round(r.actual - r.paid_to_date, 2),
         r.etc, r.efc, r.variance,
         CASE WHEN r.estimate <> 0 THEN round(r.actual / r.estimate * 100, 2) END,
         r.etc_is_manual, r.etc_updated_at
    FROM public.get_cost_report(p_project_id, p_from, p_to) r          -- access check inside
    LEFT JOIN public.gl_accounts g
           ON g.id = CASE WHEN r.budget_code IS NOT NULL THEN public.derive_gl_account(v_org, r.budget_code) END;
END;
$$;
REVOKE ALL ON FUNCTION public.get_cost_report_detail(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cost_report_detail(uuid, date, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_cost_report_detail(uuid, date, date) IS
  'Cost Report (R06): get_cost_report rows + Remaining Budget, Payable, % spent and the GL account of the code, for grouping by line / account / category. SAR.';

-- ---------------------------------------------------------------------
-- 11. A09 / A12 — funding & cash position
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_tax_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  payment_date    date NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('vat_paid', 'vat_recovered', 'wht_remitted')),
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),   -- SAR
  reference       text CHECK (reference IS NULL OR length(reference) <= 200),
  notes           text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_tax_payments_project ON public.project_tax_payments (project_id, payment_date);
COMMENT ON TABLE public.project_tax_payments IS
  'Cash movements with the tax authority (ZATCA) for a project: VAT paid, VAT recovered (refund), WHT remitted. SAR. Feeds Cash Balance (db/pending/180).';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_tax_payments TO authenticated;
GRANT ALL ON public.project_tax_payments TO service_role;
REVOKE ALL ON public.project_tax_payments FROM anon;
ALTER TABLE public.project_tax_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Project members can read tax payments" ON public.project_tax_payments;
CREATE POLICY "Project members can read tax payments" ON public.project_tax_payments
  FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));
DROP POLICY IF EXISTS "Funding editors can insert tax payments" ON public.project_tax_payments;
CREATE POLICY "Funding editors can insert tax payments" ON public.project_tax_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'));
DROP POLICY IF EXISTS "Funding editors can update tax payments" ON public.project_tax_payments;
CREATE POLICY "Funding editors can update tax payments" ON public.project_tax_payments
  FOR UPDATE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'))
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'));
DROP POLICY IF EXISTS "Funding editors can delete tax payments" ON public.project_tax_payments;
CREATE POLICY "Funding editors can delete tax payments" ON public.project_tax_payments
  FOR DELETE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'));
-- organization from the project, stamps by the database (same function as project_funding)
DROP TRIGGER IF EXISTS trg_stamp_project_tax_payments ON public.project_tax_payments;
CREATE TRIGGER trg_stamp_project_tax_payments
  BEFORE INSERT OR UPDATE ON public.project_tax_payments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_project_funding();
DROP TRIGGER IF EXISTS trg_audit_history_project_tax_payments ON public.project_tax_payments;
CREATE TRIGGER trg_audit_history_project_tax_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.project_tax_payments
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- Cash figures of a project as of a date (default today). SAR.
--   funding          received funding (project_funding.status = 'received')
--   funding_expected expected, not yet received
--   paid             payments ledger (money out)
--   cash_balance     funding − paid − vat_paid + vat_recovered − wht_remitted
--   upcoming         approved, not paid yet: unpaid invoice balances
--                    (net payable incl. VAT less WHT) + Approved instalments
--   expected_balance cash_balance − upcoming
--   actual / commitment / payable (= actual − paid) as in v_project_position
CREATE OR REPLACE FUNCTION public.get_funding_position(p_project_id uuid, p_as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org   uuid;
  v_as_of date := COALESCE(p_as_of, current_date);
  v_fund  numeric; v_exp numeric; v_paid numeric;
  v_vatp  numeric; v_vatr numeric; v_wht numeric;
  v_inv   numeric; v_inst numeric;
  v_cash  numeric; v_up numeric;
  pos     record;
BEGIN
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_funding_position: access denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(sum(amount) FILTER (WHERE status = 'received' AND funding_date <= v_as_of), 0),
         COALESCE(sum(amount) FILTER (WHERE NOT (status = 'received' AND funding_date <= v_as_of)), 0)
    INTO v_fund, v_exp
    FROM public.project_funding WHERE project_id = p_project_id;
  SELECT COALESCE(sum(amount), 0) INTO v_paid
    FROM public.payments WHERE project_id = p_project_id AND (payment_date IS NULL OR payment_date <= v_as_of);
  SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'vat_paid'), 0),
         COALESCE(sum(amount) FILTER (WHERE kind = 'vat_recovered'), 0),
         COALESCE(sum(amount) FILTER (WHERE kind = 'wht_remitted'), 0)
    INTO v_vatp, v_vatr, v_wht
    FROM public.project_tax_payments WHERE project_id = p_project_id AND payment_date <= v_as_of;

  SELECT COALESCE(sum(GREATEST(COALESCE(i.net_payable, COALESCE(i.price, 0) + COALESCE(i.vat_amount, 0) - COALESCE(i.wht_amount, 0))
                               - COALESCE(pd.paid, 0), 0)), 0)
    INTO v_inv
    FROM public.invoices i
    LEFT JOIN LATERAL (SELECT sum(pm.amount) AS paid FROM public.payments pm
                        WHERE pm.source_type = 'invoice' AND pm.source_id = i.id) pd ON true
   WHERE i.project_id = p_project_id;
  SELECT COALESCE(sum(pi.amount), 0) INTO v_inst
    FROM public.payroll_instalments pi
   WHERE pi.project_id = p_project_id AND pi.status = 'Approved';

  SELECT * INTO pos FROM public.v_project_position vp WHERE vp.project_id = p_project_id;

  v_cash := v_fund - v_paid - v_vatp + v_vatr - v_wht;
  v_up   := v_inv + v_inst;
  RETURN jsonb_build_object(
    'as_of', v_as_of, 'currency', 'SAR',
    'funding', round(v_fund, 2), 'funding_expected', round(v_exp, 2),
    'paid', round(v_paid, 2),
    'vat_paid', round(v_vatp, 2), 'vat_recovered', round(v_vatr, 2), 'wht_remitted', round(v_wht, 2),
    'cash_balance', round(v_cash, 2),
    'upcoming_invoices', round(v_inv, 2), 'upcoming_instalments', round(v_inst, 2),
    'upcoming', round(v_up, 2),
    'expected_balance', round(v_cash - v_up, 2),
    'actual', round(COALESCE(pos.actual_sar, 0), 2),
    'commitment', round(COALESCE(pos.committed_sar, 0), 2),
    'payable', round(COALESCE(pos.payable_sar, 0), 2),
    'has_funding', v_fund > 0,
    'overdrawn', v_cash < 0,
    'payments_exceed_funding', v_paid > v_fund);
END;
$$;
REVOKE ALL ON FUNCTION public.get_funding_position(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_funding_position(uuid, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 12. Payroll runs — copy of 176; changes marked "180"
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_payroll_run(_run uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  r          public.payroll_runs%ROWTYPE;
  it         record;
  v_payroll  uuid;
  v_amount   numeric;
  v_kind     text;
  v_conflict text;
  v_requests int := 0;
BEGIN
  SELECT * INTO r FROM public.payroll_runs WHERE id = _run FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run not found';
  END IF;
  IF v_uid IS NULL OR NOT public.can_approve_payroll(v_uid, r.organization_id, r.project_id) THEN
    RAISE EXCEPTION 'Not authorized to post a payroll run (requires approver / admin / finance role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF r.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved payroll run can be posted (current status: %)', r.status;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_run_items WHERE payroll_run_id = r.id AND payroll_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This payroll run already sent its lines to payment';
  END IF;

  SELECT string_agg(DISTINCT i.beneficiary_name, ', ') INTO v_conflict
    FROM public.payroll_run_items i
    JOIN public.payroll p
      ON p.project_id = r.project_id
     AND p.ref_id = i.person_id::text
     AND jsonb_array_length(COALESCE(p.payment_schedule, '[]'::jsonb)) > 0
   WHERE i.payroll_run_id = r.id AND i.timesheet_id IS NOT NULL;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Double payment blocked: % is paid through contract instalments (Crew & Cast Payables). Remove the timesheet line from this run.', v_conflict
      USING ERRCODE = '42501';
  END IF;

  v_kind := CASE WHEN r.kind IN ('crew', 'cast', 'vendor') THEN r.kind ELSE 'crew' END;

  FOR it IN SELECT * FROM public.payroll_run_items WHERE payroll_run_id = r.id ORDER BY created_at, id LOOP
    -- 180: run lines are booked in SAR (they were stored in the line currency)
    v_amount := public.amount_to_sar(round(COALESCE(NULLIF(it.net, 0), it.gross, 0), 2),
                                     COALESCE(NULLIF(it.currency, ''), r.currency, 'SAR'), r.project_id);
    CONTINUE WHEN v_amount <= 0;
    INSERT INTO public.payroll
      (organization_id, project_id, ref_id, name, kind, total_amount, budget_code,
       payments, percents, payment_schedule)
    VALUES
      (r.organization_id, r.project_id, 'PR-' || left(r.id::text, 8) || '-' || left(it.id::text, 4),
       it.beneficiary_name, v_kind, v_amount, it.budget_code, '[]'::jsonb, '[]'::jsonb,
       jsonb_build_array(jsonb_build_object(
         'id', 'run', 'label', r.label, 'percent', 0, 'amount', v_amount,
         'dueDate', COALESCE(r.pay_date, r.period_end)::text, 'status', 'Pending')))
    RETURNING id INTO v_payroll;
    UPDATE public.payroll_run_items SET payroll_id = v_payroll WHERE id = it.id;
    INSERT INTO public.payment_requests
      (organization_id, project_id, source_type, source_id, source_label, total_amount,
       previously_paid, requested_amount, currency, status, requested_by, submitted_at,
       payroll_milestone_id, notes)
    VALUES
      (r.organization_id, r.project_id, 'payroll_row', v_payroll,
       left(r.label || ' · ' || it.beneficiary_name, 300), v_amount, 0, v_amount,
       'SAR', 'waiting_approval', v_uid, now(),                                -- 180: SAR
       'run', 'Payroll run ' || r.label || ' (' || r.period_start || ' → ' || r.period_end || ')');
    v_requests := v_requests + 1;
  END LOOP;

  PERFORM set_config('kwalis.posting_run', r.id::text, true);
  UPDATE public.payroll_runs SET status = 'posted', posted_at = now(), posted_by = v_uid WHERE id = r.id;
  PERFORM set_config('kwalis.posting_run', '', true);

  UPDATE public.overtime_entries SET status = 'paid', paid_at = now()
   WHERE payroll_run_id = r.id AND status = 'approved';

  RETURN jsonb_build_object('payment_requests', v_requests);
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_payroll_run(_run uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  r RECORD;
  ot_count int := 0;
  ledger_count int := 0;
  actor_email_txt text;
  req_count int := 0;
  pr_row RECORD;                                                            -- 180
BEGIN
  SELECT * INTO r FROM public.payroll_runs WHERE id = _run FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found';
  END IF;
  IF uid IS NULL OR NOT public.can_approve_payroll(uid, r.organization_id, r.project_id) THEN
    RAISE EXCEPTION 'Not authorized to reverse a payroll run (requires approver / admin / finance role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF r.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted payroll runs can be reversed (current status: %)', r.status;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_requests q
               JOIN public.payroll_run_items i ON i.payroll_id = q.source_id
              WHERE i.payroll_run_id = _run AND q.source_type = 'payroll_row'
                AND q.status IN ('approved', 'paid')) THEN
    RAISE EXCEPTION 'This run has lines already approved or paid on Payment Approvals — it cannot be reversed'
      USING ERRCODE = '42501';
  END IF;
  WITH cancelled AS (
    UPDATE public.payment_requests q
       SET status = 'cancelled',
           cancellation_reason = left('Payroll run reversed: ' || COALESCE(NULLIF(_reason, ''), 'no reason given'), 1000)
      FROM public.payroll_run_items i
     WHERE i.payroll_run_id = _run AND i.payroll_id = q.source_id
       AND q.source_type = 'payroll_row' AND q.status IN ('draft', 'waiting_approval')
     RETURNING 1
  ) SELECT count(*) INTO req_count FROM cancelled;
  WITH reverted AS (
    UPDATE public.overtime_entries
       SET status = 'approved', paid_at = NULL, payroll_run_id = NULL
     WHERE payroll_run_id = _run AND status = 'paid'
     RETURNING 1
  ) SELECT count(*) INTO ot_count FROM reverted;
  -- 180: the run's payroll rows are cancelled contracts — they leave Commitment
  FOR pr_row IN SELECT id FROM public.payroll WHERE ref_id LIKE 'PR-' || left(_run::text, 8) || '-%' LOOP
    PERFORM set_config('kwalis.contract_cancel', pr_row.id::text, true);
    UPDATE public.payroll
       SET payments = '["Unpaid"]'::jsonb,
           percents = '[0]'::jsonb,
           ledger = '[]'::jsonb,
           payment_schedule = '[]'::jsonb,
           contract_cancelled_at = COALESCE(contract_cancelled_at, now()),
           contract_cancelled_by = COALESCE(contract_cancelled_by, uid),
           contract_cancellation_reason = COALESCE(contract_cancellation_reason,
             left('Payroll run reversed: ' || COALESCE(NULLIF(_reason, ''), 'no reason given'), 1000))
     WHERE id = pr_row.id;
    ledger_count := ledger_count + 1;
  END LOOP;
  PERFORM set_config('kwalis.contract_cancel', '', true);
  UPDATE public.payroll_run_items SET payroll_id = NULL WHERE payroll_run_id = _run;
  UPDATE public.payroll_runs
     SET status = 'cancelled',
         posted_at = NULL,
         posted_by = NULL,
         notes = COALESCE(NULLIF(_reason, ''), 'Reversed by accountant')
   WHERE id = _run;
  SELECT email INTO actor_email_txt FROM auth.users WHERE id = uid;
  INSERT INTO public.payroll_approval_events(
    payroll_run_id, organization_id, project_id, actor_id, actor_email,
    action, from_status, to_status, note,
    gross_total, net_total, wht_total
  ) VALUES (
    _run, r.organization_id, r.project_id, uid, actor_email_txt,
    'reversed', 'posted', 'cancelled',
    COALESCE(NULLIF(_reason, ''), 'Reversed') ||
      format(' · %s overtime entries restored, %s ledger rows marked unpaid, %s payment requests cancelled',
             ot_count, ledger_count, req_count),
    r.gross_total, r.net_total, r.wht_total
  );
  RETURN jsonb_build_object('overtime_reverted', ot_count, 'ledger_unpaid', ledger_count,
                            'requests_cancelled', req_count);
END;
$$;
REVOKE ALL ON FUNCTION public.post_payroll_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_payroll_run(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 13. Backfills (new columns / new table only)
-- ---------------------------------------------------------------------
-- payroll rows of runs reversed before this file are cancelled contracts
UPDATE public.payroll p
   SET contract_cancelled_at = COALESCE(r.updated_at, now()),
       contract_cancellation_reason = 'Payroll run reversed'
  FROM public.payroll_runs r
 WHERE r.status = 'cancelled'
   AND p.ref_id LIKE 'PR-' || left(r.id::text, 8) || '-%'
   AND p.contract_cancelled_at IS NULL
   AND jsonb_array_length(COALESCE(p.payment_schedule, '[]'::jsonb)) = 0;

-- instalment rows from the JSON (no payroll row is touched)
INSERT INTO public.payroll_instalments AS pi
  (payroll_id, milestone_id, organization_id, project_id, seq, label, due_date, amount, amount_gross,
   status, stored_status, payment_request_id, request_status, approved_at, paid_date, budget_code,
   contract_cancelled, updated_at)
SELECT p.id, e->>'id', p.organization_id, p.project_id, ord::int,
       NULLIF(btrim(e->>'label'), ''),
       CASE WHEN COALESCE(e->>'dueDate', e->>'due_date', '') ~ '^\d{4}-\d{2}-\d{2}'
            THEN left(COALESCE(e->>'dueDate', e->>'due_date'), 10)::date END,
       public.payroll_milestone_amount(e, COALESCE(NULLIF(p.net_payable, 0), p.total_amount, 0)),
       round(CASE WHEN NULLIF(e->>'amount', '') IS NOT NULL
                  THEN (e->>'amount')::numeric
                       * CASE WHEN COALESCE(NULLIF(p.net_payable, 0), p.total_amount, 0) > 0
                              THEN COALESCE(p.total_amount, 0) / COALESCE(NULLIF(p.net_payable, 0), p.total_amount) ELSE 1 END
                  ELSE COALESCE(p.total_amount, 0) * COALESCE(NULLIF(e->>'percent', '')::numeric, 0) / 100 END, 2),
       public.instalment_status_word(e->>'status'), e->>'status',
       q.id, q.status, q.approved_at,
       CASE WHEN e->>'status' = 'Paid' AND COALESCE(e->>'paidDate', '') ~ '^\d{4}-\d{2}-\d{2}'
            THEN left(e->>'paidDate', 10)::date END,
       p.budget_code, p.contract_cancelled_at IS NOT NULL, now()
  FROM public.payroll p
  CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(p.payment_schedule) = 'array' THEN p.payment_schedule ELSE '[]'::jsonb END)
       WITH ORDINALITY AS t(e, ord)
  LEFT JOIN LATERAL (
    SELECT r.id, r.status, r.approved_at FROM public.payment_requests r
     WHERE r.source_type = 'payroll_row' AND r.source_id = p.id AND r.payroll_milestone_id = e->>'id'
     ORDER BY (r.status IN ('rejected', 'cancelled')), r.created_at DESC
     LIMIT 1) q ON true
 WHERE NULLIF(e->>'id', '') IS NOT NULL
ON CONFLICT (payroll_id, milestone_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 14. get_cost_by_gl_account — copy of 070; a payroll row now has an actual
--     and a commitment row, so payments are matched to ONE source row and the
--     document counts are distinct documents ("180")
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cost_by_gl_account(
  p_project_id uuid,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
RETURNS TABLE (
  gl_account_id   uuid,
  gl_code         text,
  gl_name         text,
  category        text,
  actual          numeric,
  committed       numeric,
  paid            numeric,
  invoice_count   integer,
  payroll_count   integer,
  receipt_count   integer,
  other_count     integer,
  mapped_by_code  integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_org uuid;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'get_cost_by_gl_account: p_project_id is required' USING ERRCODE = '22004';
  END IF;
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_cost_by_gl_account: access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH led AS (
    SELECT t.source_type, t.source_id, t.entry_kind, t.amount,
           COALESCE(t.gl_account_id, public.resolve_gl_account(v_org, t.budget_code)) AS gl_id,
           (t.gl_account_id IS NULL AND public.resolve_gl_account(v_org, t.budget_code) IS NOT NULL) AS via_map
    FROM public.v_ledger_transactions t
    WHERE t.project_id = p_project_id
      AND t.entry_kind IN ('actual', 'commitment')
      AND (p_from IS NULL OR t.entry_date >= p_from)
      AND (p_to   IS NULL OR t.entry_date <= p_to)
  ),
  src_gl AS (   -- 180: one row per source document
    SELECT DISTINCT ON (t.source_type, t.source_id) t.source_type, t.source_id,
           COALESCE(t.gl_account_id, public.resolve_gl_account(v_org, t.budget_code)) AS gl_id
    FROM public.v_ledger_transactions t
    WHERE t.project_id = p_project_id AND t.entry_kind IN ('actual', 'commitment')
    ORDER BY t.source_type, t.source_id, t.entry_kind
  ),
  pay AS (
    SELECT s.gl_id, pm.amount
    FROM public.payments pm
    LEFT JOIN src_gl s
           ON s.source_id = pm.source_id
          AND s.source_type = CASE WHEN pm.source_type IN ('purchase_order', 'po') THEN 'purchase_order'
                                   WHEN pm.source_type IN ('petty_cash', 'cash_advance', 'cash_advance_receipt', 'receipt')
                                     THEN 'petty_cash' ELSE pm.source_type END
    WHERE pm.project_id = p_project_id
      AND (p_from IS NULL OR pm.payment_date >= p_from)
      AND (p_to   IS NULL OR pm.payment_date <= p_to)
  ),
  docs AS (     -- 180: distinct documents per account
    SELECT d.gl_id,
           count(*) FILTER (WHERE d.source_type = 'invoice')::int AS inv,
           count(*) FILTER (WHERE d.source_type = 'payroll')::int AS pr,
           count(*) FILTER (WHERE d.source_type = 'petty_cash')::int AS rc,
           count(*) FILTER (WHERE d.source_type NOT IN ('invoice', 'payroll', 'petty_cash'))::int AS oth,
           count(*) FILTER (WHERE d.via_map)::int AS via
    FROM (SELECT DISTINCT led.gl_id, led.source_type, led.source_id, led.via_map FROM led) d
    GROUP BY d.gl_id
  ),
  agg AS (
    SELECT u.gl_id,
           sum(u.actual) AS actual, sum(u.committed) AS committed, sum(u.paid) AS paid
    FROM (
      SELECT led.gl_id,
             CASE WHEN led.entry_kind = 'actual' THEN led.amount ELSE 0 END AS actual,
             CASE WHEN led.entry_kind = 'commitment' THEN led.amount ELSE 0 END AS committed,
             0::numeric AS paid
      FROM led
      UNION ALL
      SELECT pay.gl_id, 0, 0, pay.amount FROM pay
    ) u
    GROUP BY u.gl_id
  )
  SELECT g.id, COALESCE(g.code, '—'), COALESCE(g.name, 'Uncategorized'), g.category,
         round(a.actual, 2), round(a.committed, 2), round(a.paid, 2),
         COALESCE(dc.inv, 0), COALESCE(dc.pr, 0), COALESCE(dc.rc, 0), COALESCE(dc.oth, 0), COALESCE(dc.via, 0)
  FROM agg a
  LEFT JOIN docs dc ON dc.gl_id IS NOT DISTINCT FROM a.gl_id
  LEFT JOIN public.gl_accounts g ON g.id = a.gl_id
  ORDER BY (g.id IS NULL), g.code;
END;
$$;
