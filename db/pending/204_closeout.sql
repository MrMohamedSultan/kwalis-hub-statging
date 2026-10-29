-- =====================================================================
-- 204 — Close-out: approved purchase orders are cancelled (never deleted),
--       a paid payment request is reversed with a refund entry, Platform
--       Hub settings in the database, organization budget templates.
--
-- Spec items: X08 (PO + paid request), D20 (platform settings, budget
-- template). Builds on 174 (PO maker-checker), 176 (request workflow),
-- 182/196/201 (ledger, request payments). Safe to apply ONCE on a database
-- that already has 171–203: every object is IF NOT EXISTS / CREATE OR
-- REPLACE / DROP … IF EXISTS first; existing client data is not rewritten
-- (the only backfill fills the NEW column purchase_orders.first_approved_at).
--
-- 1. Purchase orders (X08)
--    * first_approved_at — stamped by the database the first time a PO is
--      approved / issued and never cleared (moving an approved PO back to
--      Draft to edit it keeps it). Backfilled for POs approved / issued today.
--    * A PO that was ever approved cannot be deleted (also not to the trash);
--      it is cancelled with a reason instead: cancel_purchase_order(id, reason)
--      or status → Cancelled with cancellation_reason. Cancelling needs an
--      approver of the organization (can_approve_invoice, 201), no money
--      paid against the PO (net of refunds), no open payment request and no
--      live invoice against it. cancelled_by / cancelled_at are written by
--      the database; a cancelled PO is locked and keeps its approval stamps.
--    * POs that were never approved behave as before (delete, reject).
-- 2. Paid payment request → refund (X08)
--    * reverse_paid_payment_request(request, reason, refund_date):
--      organization admin (or platform owner) only; the request stays
--      "paid" (its payment stays in the books) and a refund payments row is
--      added: the same document, amount = −original, reverses_payment_id =
--      the original. The ledger posts it like every payment with the sides
--      flipped (Dr Bank / Cr Accounts Payable), so debits = credits and
--      ledger_phases_match() stays true; the document is payable again.
--    * payments.amount may be negative only for such a refund row
--      (payments_amount_check). Refund rows are written only by the RPC, are
--      never edited or deleted; a payment with a refund cannot be edited or
--      deleted either.
--    * A reversed request is frozen and no longer counts toward the
--      document's requested total, so a new request can pay it again.
--    * Instalment (payroll) requests are not reversed here: the instalment
--      schedule is driven by its request (176) — a refund there needs a
--      contract correction (refused with a clear message).
-- 3. Platform Hub settings (D20) — platform_settings rows (035) for the
--    Platform Configuration tab, which kept them in the browser
--    (localStorage). Super admin writes (existing policy); values checked
--    in stamp_platform_settings().
-- 4. budget_templates (D20) — an organization's own budget template (header /
--    main codes list). One per organization may be the default; the budget
--    creation screen starts from it, else from the built-in template.
--    Members read, organization admins write.
--
-- SECURITY: triggers on financial tables, a SECURITY DEFINER RPC, a new
-- table with RLS — apply only after owner approval (SECURITY.md).
--
-- Rollback (in this order):
--   DROP TRIGGER IF EXISTS trg_budget_templates_stamp ON public.budget_templates;
--   DROP TRIGGER IF EXISTS trg_audit_history_budget_templates ON public.budget_templates;
--   DROP TABLE IF EXISTS public.budget_templates;
--   DROP FUNCTION IF EXISTS public.stamp_budget_template();
--   DELETE FROM public.platform_settings WHERE key IN ('platform_base_currency', 'fx_usd_to_base',
--     'fx_eur_to_base', 'fx_aed_to_base', 'default_wht_rate_pct', 'fiscal_year_start',
--     'default_project_limit', 'default_language');
--   re-create stamp_platform_settings() from 035;
--   DROP FUNCTION IF EXISTS public.reverse_paid_payment_request(uuid, text, date);
--   DROP TRIGGER IF EXISTS trg_payment_request_reversal_guard ON public.payment_requests;
--   DROP FUNCTION IF EXISTS public.guard_reversed_payment_request();
--   DROP TRIGGER IF EXISTS trg_payments_reversal_guard ON public.payments;
--   DROP FUNCTION IF EXISTS public.guard_payment_reversal();
--   re-create enforce_payment_request_limit() / revalidate_payment_request_on_submit() from 176;
--   (only when no refund row exists) ALTER TABLE public.payments DROP CONSTRAINT payments_amount_check,
--     ADD CONSTRAINT payments_amount_check CHECK (amount >= 0);
--   ALTER TABLE public.payments DROP COLUMN reverses_payment_id, DROP COLUMN reversal_reason;
--   ALTER TABLE public.payment_requests DROP COLUMN reversed_by, DROP COLUMN reversed_at,
--     DROP COLUMN reversal_reason, DROP COLUMN reversal_payment_id;
--   DROP FUNCTION IF EXISTS public.cancel_purchase_order(uuid, text);
--   DROP TRIGGER IF EXISTS zz_trg_purchase_order_cancellation ON public.purchase_orders;
--   DROP TRIGGER IF EXISTS trg_purchase_order_delete_guard ON public.purchase_orders;
--   DROP FUNCTION IF EXISTS public.enforce_purchase_order_cancellation(), public.guard_purchase_order_delete();
--   ALTER TABLE public.purchase_orders DROP COLUMN first_approved_at, DROP COLUMN cancelled_by,
--     DROP COLUMN cancelled_at, DROP COLUMN cancellation_reason;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Purchase orders: cancellation instead of delete
-- ---------------------------------------------------------------------
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS first_approved_at   timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by        uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_cancellation_reason_len;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_cancellation_reason_len
  CHECK (cancellation_reason IS NULL OR length(cancellation_reason) <= 1000);
COMMENT ON COLUMN public.purchase_orders.first_approved_at IS
  'First time the PO was approved / issued; written by the database only and never cleared. Such a PO is cancelled with a reason, never deleted. db/pending/204.';
COMMENT ON COLUMN public.purchase_orders.cancellation_reason IS
  'Why an approved PO was cancelled (required). cancelled_by / cancelled_at are written by the database. db/pending/204.';

-- Backfill (new column only; triggers off so updated_at / audit are untouched).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.purchase_orders
              WHERE first_approved_at IS NULL
                AND (lower(COALESCE(status, '')) IN ('approved', 'issued') OR approved_at IS NOT NULL)) THEN
    ALTER TABLE public.purchase_orders DISABLE TRIGGER USER;
    UPDATE public.purchase_orders
       SET first_approved_at = COALESCE(approved_at, updated_at, created_at)
     WHERE first_approved_at IS NULL
       AND (lower(COALESCE(status, '')) IN ('approved', 'issued') OR approved_at IS NOT NULL);
    ALTER TABLE public.purchase_orders ENABLE TRIGGER USER;
  END IF;
END $$;

-- Runs after trg_purchase_order_maker_checker (174) — name order (zz_).
CREATE OR REPLACE FUNCTION public.enforce_purchase_order_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NULL THEN RETURN NEW; END IF;      -- server jobs / SQL editor / imports
    NEW.first_approved_at := NULL;                 -- a new (or restored) PO was never approved
    NEW.cancelled_by := NULL; NEW.cancelled_at := NULL; NEW.cancellation_reason := NULL;
    RETURN NEW;
  END IF;

  -- first approval: kept for ever
  NEW.first_approved_at := COALESCE(OLD.first_approved_at,
                                    CASE WHEN NEW.approved_at IS NOT NULL THEN NEW.approved_at END,
                                    CASE WHEN v_uid IS NULL AND NEW.first_approved_at IS NOT NULL
                                         THEN NEW.first_approved_at END);
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  -- a PO cancelled after approval is locked
  IF OLD.cancelled_at IS NOT NULL THEN
    IF lower(COALESCE(NEW.status, '')) IS DISTINCT FROM lower(COALESCE(OLD.status, ''))
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.vendor_name IS DISTINCT FROM OLD.vendor_name
       OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
       OR NEW.budget_code IS DISTINCT FROM OLD.budget_code
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.date IS DISTINCT FROM OLD.date THEN
      RAISE EXCEPTION 'purchase_orders: a cancelled purchase order cannot be changed — record a new one'
        USING ERRCODE = '42501';
    END IF;
    NEW.cancelled_by := OLD.cancelled_by; NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancellation_reason := OLD.cancellation_reason;
    NEW.approved_by := OLD.approved_by;   NEW.approved_at := OLD.approved_at;
    RETURN NEW;
  END IF;

  IF lower(COALESCE(NEW.status, '')) = 'cancelled' AND lower(COALESCE(OLD.status, '')) <> 'cancelled'
     AND OLD.first_approved_at IS NOT NULL THEN
    IF NOT public.can_approve_invoice(OLD.project_id, COALESCE(OLD.amount, 0)) THEN
      RAISE EXCEPTION 'purchase_orders: only an approver of this organization can cancel an approved purchase order'
        USING ERRCODE = '42501';
    END IF;
    IF NULLIF(btrim(COALESCE(NEW.cancellation_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'purchase_orders: a reason is required to cancel an approved purchase order'
        USING ERRCODE = '22023';
    END IF;
    IF COALESCE((SELECT sum(pm.amount) FROM public.payments pm
                  WHERE pm.source_type IN ('purchase_order', 'po') AND pm.source_id = OLD.id
                    AND pm.project_id IS NOT DISTINCT FROM OLD.project_id), 0) > 0 THEN
      RAISE EXCEPTION 'purchase_orders: this purchase order has payments — reverse them (refund) before cancelling it'
        USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.payment_requests r
                WHERE r.source_type = 'purchase_order' AND r.source_id = OLD.id
                  AND r.organization_id IS NOT DISTINCT FROM OLD.organization_id
                  AND r.status NOT IN ('rejected', 'cancelled') AND r.reversed_at IS NULL) THEN
      RAISE EXCEPTION 'purchase_orders: cancel or reject the payment request of this purchase order first'
        USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.invoices i
                WHERE i.purchase_order_id = OLD.id
                  AND i.approval_status NOT IN ('rejected', 'cancelled')) THEN
      RAISE EXCEPTION 'purchase_orders: invoices are recorded against this purchase order — cancel them first'
        USING ERRCODE = '42501';
    END IF;
    NEW.cancellation_reason := btrim(NEW.cancellation_reason);
    NEW.cancelled_by := v_uid; NEW.cancelled_at := now();
    -- the approval stays on record (174 clears it when leaving an approved state)
    NEW.approved_by := OLD.approved_by; NEW.approved_at := OLD.approved_at;
    RETURN NEW;
  END IF;

  -- not a cancellation: the stamps are the database's
  NEW.cancelled_by := OLD.cancelled_by; NEW.cancelled_at := OLD.cancelled_at;
  NEW.cancellation_reason := OLD.cancellation_reason;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_purchase_order_cancellation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_trg_purchase_order_cancellation ON public.purchase_orders;
CREATE TRIGGER zz_trg_purchase_order_cancellation BEFORE INSERT OR UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_purchase_order_cancellation();

-- An approved (or once approved / cancelled) PO is never deleted. A project
-- or organization being deleted still takes its POs with it.
CREATE OR REPLACE FUNCTION public.guard_purchase_order_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (OLD.first_approved_at IS NOT NULL OR OLD.cancelled_at IS NOT NULL
          OR lower(COALESCE(OLD.status, '')) IN ('approved', 'issued'))
     AND public.project_exists(OLD.project_id) THEN
    RAISE EXCEPTION 'purchase_orders: an approved purchase order cannot be deleted — cancel it with a reason instead (the cancellation is recorded)'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.guard_purchase_order_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_purchase_order_delete_guard ON public.purchase_orders;
CREATE TRIGGER trg_purchase_order_delete_guard BEFORE DELETE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_order_delete();

-- SECURITY INVOKER: the PO is reached through its RLS, the trigger applies every rule.
CREATE OR REPLACE FUNCTION public.cancel_purchase_order(p_po uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'cancel_purchase_order: a reason (up to 1000 characters) is required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.purchase_orders SET status = 'Cancelled', cancellation_reason = btrim(p_reason)
   WHERE id = p_po AND first_approved_at IS NOT NULL AND cancelled_at IS NULL
     AND lower(COALESCE(status, '')) <> 'cancelled';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_purchase_order: no approved purchase order with this id in your projects' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cancel_purchase_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Paid payment request → reversal (refund) entry
-- ---------------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS reverses_payment_id uuid REFERENCES public.payments(id),
  ADD COLUMN IF NOT EXISTS reversal_reason     text;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_reversal_reason_len;
ALTER TABLE public.payments ADD CONSTRAINT payments_reversal_reason_len
  CHECK (reversal_reason IS NULL OR length(reversal_reason) <= 1000);
-- a negative amount only for a refund row
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_check
  CHECK (amount >= 0 OR (reverses_payment_id IS NOT NULL AND amount < 0));
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_reverses_payment
  ON public.payments (reverses_payment_id) WHERE reverses_payment_id IS NOT NULL;
COMMENT ON COLUMN public.payments.reverses_payment_id IS
  'Refund / reversal of that payment (amount = −original), written by reverse_paid_payment_request only. db/pending/204.';

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS reversed_by         uuid,
  ADD COLUMN IF NOT EXISTS reversed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason     text,
  ADD COLUMN IF NOT EXISTS reversal_payment_id uuid;
ALTER TABLE public.payment_requests DROP CONSTRAINT IF EXISTS payment_requests_reversal_reason_len;
ALTER TABLE public.payment_requests ADD CONSTRAINT payment_requests_reversal_reason_len
  CHECK (reversal_reason IS NULL OR length(reversal_reason) <= 1000);
COMMENT ON COLUMN public.payment_requests.reversed_at IS
  'A paid request reversed by an organization admin (reason required): its payment stays, a refund payment (reversal_payment_id) offsets it. The request is then frozen. db/pending/204.';

-- Refund rows: written only by the RPC, never edited or deleted; a payment
-- that has a refund keeps its amount / document / date.
CREATE OR REPLACE FUNCTION public.guard_payment_reversal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rpc boolean := COALESCE(current_setting('kwalis.payment_reversal', true), '') = 'on';
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF (NEW.reverses_payment_id IS NOT NULL OR NEW.reversal_reason IS NOT NULL) AND NOT v_rpc THEN
      RAISE EXCEPTION 'payments: refunds are recorded with "Reverse payment" on Payment Approvals'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.reverses_payment_id IS DISTINCT FROM OLD.reverses_payment_id
       OR NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason THEN
      RAISE EXCEPTION 'payments: the reversal link is written by the database' USING ERRCODE = '42501';
    END IF;
    IF (OLD.reverses_payment_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.payments x WHERE x.reverses_payment_id = OLD.id))
       AND (NEW.amount IS DISTINCT FROM OLD.amount
         OR NEW.source_type IS DISTINCT FROM OLD.source_type
         OR NEW.source_id IS DISTINCT FROM OLD.source_id
         OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
         OR NEW.method IS DISTINCT FROM OLD.method
         OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR (NEW.project_id IS DISTINCT FROM OLD.project_id AND public.project_exists(OLD.project_id))) THEN
      RAISE EXCEPTION 'payments: a reversed payment and its refund cannot be changed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE
  IF public.project_exists(OLD.project_id)
     AND (OLD.reverses_payment_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.payments x WHERE x.reverses_payment_id = OLD.id)) THEN
    RAISE EXCEPTION 'payments: a reversed payment and its refund cannot be deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.guard_payment_reversal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payments_reversal_guard ON public.payments;
CREATE TRIGGER trg_payments_reversal_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_reversal();

-- A reversed request is frozen; the reversal stamps come from the RPC only.
CREATE OR REPLACE FUNCTION public.guard_reversed_payment_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rpc boolean := COALESCE(current_setting('kwalis.payment_reversal', true), '') = 'on';
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.reversed_at IS NOT NULL AND public.project_exists(OLD.project_id) THEN
      RAISE EXCEPTION 'payment_requests: a reversed request cannot be deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.reversed_by := NULL; NEW.reversed_at := NULL;
    NEW.reversal_reason := NULL; NEW.reversal_payment_id := NULL;
    RETURN NEW;
  END IF;
  IF OLD.reversed_at IS NOT NULL THEN
    IF (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at')
       AND NOT (NEW.project_id IS NULL AND NOT public.project_exists(OLD.project_id)) THEN
      RAISE EXCEPTION 'payment_requests: a reversed request can no longer be changed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.reversed_by IS DISTINCT FROM OLD.reversed_by
      OR NEW.reversed_at IS DISTINCT FROM OLD.reversed_at
      OR NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason
      OR NEW.reversal_payment_id IS DISTINCT FROM OLD.reversal_payment_id) AND NOT v_rpc THEN
    RAISE EXCEPTION 'payment_requests: a paid request is reversed with reverse_paid_payment_request only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_reversed_payment_request() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payment_request_reversal_guard ON public.payment_requests;
CREATE TRIGGER trg_payment_request_reversal_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_reversed_payment_request();

CREATE OR REPLACE FUNCTION public.reverse_paid_payment_request(_request uuid, _reason text, _refund_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_reason text := btrim(COALESCE(_reason, ''));
  r        public.payment_requests%ROWTYPE;
  p        public.payments%ROWTYPE;
  v_date   date;
  v_id     uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'reverse_paid_payment_request: not signed in' USING ERRCODE = '42501';
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'A reversal needs a reason (3 to 1000 characters)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.payment_requests WHERE id = _request FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_super_admin(v_uid) OR public.is_org_member(v_uid, r.organization_id)) THEN
    RAISE EXCEPTION 'reverse_paid_payment_request: request not found' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_super_admin(v_uid) OR public.is_org_admin(v_uid, r.organization_id)) THEN
    RAISE EXCEPTION 'Only an organization admin can reverse a paid request' USING ERRCODE = '42501';
  END IF;
  IF r.status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'Only a paid request can be reversed (this one is %) — cancel it instead', r.status
      USING ERRCODE = '42501';
  END IF;
  IF r.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This request was already reversed' USING ERRCODE = '42501';
  END IF;
  IF r.payroll_milestone_id IS NOT NULL OR r.source_type NOT IN ('invoice', 'purchase_order', 'petty_cash') THEN
    RAISE EXCEPTION 'Instalment and contract payments are corrected on the contract, not reversed here'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM public.payments
   WHERE payment_request_id = r.id AND organization_id = r.organization_id
     AND project_id IS NOT DISTINCT FROM r.project_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No payment is recorded for this request yet (run backfill_request_payments first)'
      USING ERRCODE = '22023';
  END IF;
  v_date := COALESCE(_refund_date, CURRENT_DATE);
  IF v_date < p.payment_date THEN
    RAISE EXCEPTION 'The refund date cannot be before the payment date (%)', p.payment_date USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('kwalis.payment_reversal', 'on', true);
  INSERT INTO public.payments
    (organization_id, project_id, source_type, source_id, amount, payment_date, method, notes,
     recorded_by, reverses_payment_id, reversal_reason, currency, original_amount,
     bank_name, bank_country, spend_country, spend_city)
  VALUES
    (p.organization_id, p.project_id, p.source_type, p.source_id, -p.amount, v_date, p.method,
     left('Refund / reversal: ' || v_reason, 500),
     v_uid, p.id, v_reason, p.currency, CASE WHEN p.original_amount IS NOT NULL THEN -p.original_amount END,
     p.bank_name, p.bank_country, p.spend_country, p.spend_city)
  RETURNING id INTO v_id;
  UPDATE public.payment_requests
     SET reversed_by = v_uid, reversed_at = now(), reversal_reason = v_reason, reversal_payment_id = v_id
   WHERE id = r.id;
  PERFORM set_config('kwalis.payment_reversal', '', true);
  RETURN jsonb_build_object('refund_payment_id', v_id, 'amount', -p.amount, 'refund_date', v_date);
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_paid_payment_request(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_paid_payment_request(uuid, text, date) TO authenticated, service_role;

-- A reversed request no longer counts toward the document's requested total
-- (copies of 176, changes marked "204").
CREATE OR REPLACE FUNCTION public.enforce_payment_request_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  active_sum numeric := 0;
  total numeric := 0;
BEGIN
  -- Skip check on rejected rows (they don't count toward committed)
  IF NEW.status IN ('rejected', 'cancelled') OR NEW.reversed_at IS NOT NULL THEN   -- 176, 204
    RETURN NEW;
  END IF;
  IF NEW.requested_amount IS NULL OR NEW.requested_amount <= 0 THEN
    RAISE EXCEPTION 'Payment request amount must be greater than zero';
  END IF;
  total := COALESCE(NEW.total_amount, 0);
  IF total <= 0 THEN
    RETURN NEW; -- nothing to enforce against
  END IF;
  -- Sum all non-rejected requests for the same source, excluding the current row
  SELECT COALESCE(SUM(requested_amount), 0) INTO active_sum
    FROM public.payment_requests
   WHERE source_type = NEW.source_type
     AND source_id = NEW.source_id
     AND status NOT IN ('rejected', 'cancelled')                           -- 176
     AND reversed_at IS NULL                                               -- 204
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF (active_sum + NEW.requested_amount) > total + 0.005 THEN
    RAISE EXCEPTION 'Payment request would exceed the source total (% + % > %). Reject or reduce another request first.',
      active_sum, NEW.requested_amount, total;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.revalidate_payment_request_on_submit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  active_sum numeric := 0;
BEGIN
  -- Only re-check when transitioning out of draft toward review/approval.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'draft'
     AND NEW.status IN ('submitted','pending','approved','waiting_approval') THEN   -- 176: + waiting_approval
    IF NEW.requested_amount IS NULL OR NEW.requested_amount <= 0 THEN
      RAISE EXCEPTION 'Payment request amount must be greater than zero at submission';
    END IF;
    IF COALESCE(NEW.total_amount, 0) > 0 THEN
      SELECT COALESCE(SUM(requested_amount), 0) INTO active_sum
        FROM public.payment_requests
       WHERE source_type = NEW.source_type
         AND source_id  = NEW.source_id
         AND status NOT IN ('rejected', 'cancelled')                       -- 176
         AND reversed_at IS NULL                                           -- 204
         AND id <> NEW.id;
      IF (active_sum + NEW.requested_amount) > NEW.total_amount + 0.005 THEN
        RAISE EXCEPTION 'Payment request at submission exceeds source total (% + % > %)',
          active_sum, NEW.requested_amount, NEW.total_amount;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. Platform Hub settings (D20) — the Platform Configuration tab
-- ---------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('platform_base_currency', 'SAR', 'Base currency of the platform (defaults for new companies).'),
  ('fx_usd_to_base', '3.75', 'Default USD → base currency rate for new companies (each project keeps its own rate).'),
  ('fx_eur_to_base', '4.05', 'Default EUR → base currency rate for new companies.'),
  ('fx_aed_to_base', '1.02', 'Default AED → base currency rate for new companies.'),
  ('default_wht_rate_pct', '5', 'Default withholding tax rate (percent) for new companies.'),
  ('fiscal_year_start', '01-01', 'Fiscal year start (MM-DD) for new companies.'),
  ('default_project_limit', '5', 'Default maximum number of projects for a new company.'),
  ('default_language', 'en', 'Default interface language for new users (en / ar).'),
  ('vat_standard_rate_pct', '15', 'Standard VAT rate (percent) applied to standard-rated invoices.')
ON CONFLICT (key) DO NOTHING;

-- copy of 035, + checks for the keys above ("204")
CREATE OR REPLACE FUNCTION public.stamp_platform_settings()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.key := OLD.key;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  IF NEW.key = 'payment_board_approval_above_sar' AND NEW.value IS NOT NULL
     AND (NEW.value !~ '^[0-9]+(\.[0-9]{1,2})?$' OR NEW.value::numeric <= 0) THEN
    RAISE EXCEPTION 'platform_settings: the approval limit must be a positive amount or NULL'
      USING ERRCODE = '22023';
  END IF;
  -- 204
  IF NEW.key = 'platform_base_currency' AND COALESCE(NEW.value, '') !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'platform_settings: the base currency must be a 3-letter code' USING ERRCODE = '22023';
  END IF;
  IF NEW.key IN ('fx_usd_to_base', 'fx_eur_to_base', 'fx_aed_to_base')
     AND (COALESCE(NEW.value, '') !~ '^[0-9]+(\.[0-9]{1,6})?$' OR NEW.value::numeric <= 0) THEN
    RAISE EXCEPTION 'platform_settings: an exchange rate must be a positive number' USING ERRCODE = '22023';
  END IF;
  IF NEW.key IN ('default_wht_rate_pct', 'vat_standard_rate_pct')
     AND (COALESCE(NEW.value, '') !~ '^[0-9]+(\.[0-9]{1,2})?$' OR NEW.value::numeric >= 100) THEN
    RAISE EXCEPTION 'platform_settings: a tax rate must be between 0 and 99.99 percent' USING ERRCODE = '22023';
  END IF;
  IF NEW.key = 'fiscal_year_start'
     AND (COALESCE(NEW.value, '') !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$') THEN
    RAISE EXCEPTION 'platform_settings: the fiscal year start must be MM-DD' USING ERRCODE = '22023';
  END IF;
  IF NEW.key = 'default_project_limit'
     AND (COALESCE(NEW.value, '') !~ '^[0-9]{1,5}$' OR NEW.value::int < 1) THEN
    RAISE EXCEPTION 'platform_settings: the project limit must be a whole number of at least 1' USING ERRCODE = '22023';
  END IF;
  IF NEW.key = 'default_language' AND COALESCE(NEW.value, '') NOT IN ('en', 'ar') THEN
    RAISE EXCEPTION 'platform_settings: the default language must be en or ar' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 4. Organization budget templates (D20)
-- ---------------------------------------------------------------------
-- lines: [{ "group": "ATL", "header_code": "1100", "header_name": "SCRIPT",
--           "code": "1101", "description": "SCRIPT" }, …]
CREATE TABLE IF NOT EXISTS public.budget_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  lines           jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'
                                        AND jsonb_array_length(lines) BETWEEN 1 AND 5000),
  is_default      boolean NOT NULL DEFAULT false,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_templates_default
  ON public.budget_templates (organization_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_budget_templates_org ON public.budget_templates (organization_id);
COMMENT ON TABLE public.budget_templates IS
  'Organization budget templates (header / main codes list). The default one is what budget creation starts from; none = the built-in template. db/pending/204.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_templates TO authenticated;
GRANT ALL ON public.budget_templates TO service_role;
REVOKE ALL ON public.budget_templates FROM anon;
ALTER TABLE public.budget_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members read budget templates" ON public.budget_templates;
CREATE POLICY "Org members read budget templates" ON public.budget_templates
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org admins add budget templates" ON public.budget_templates;
CREATE POLICY "Org admins add budget templates" ON public.budget_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org admins change budget templates" ON public.budget_templates;
CREATE POLICY "Org admins change budget templates" ON public.budget_templates
  FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id))
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org admins delete budget templates" ON public.budget_templates;
CREATE POLICY "Org admins delete budget templates" ON public.budget_templates
  FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION public.stamp_budget_template()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_bad jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'budget_templates: the organization of a template cannot be changed' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  NEW.name := btrim(NEW.name);
  SELECT e INTO v_bad FROM jsonb_array_elements(NEW.lines) e
   WHERE jsonb_typeof(e) <> 'object'
      OR COALESCE(e->>'code', '') !~ '^[A-Za-z0-9._-]{1,32}$'
      OR COALESCE(e->>'header_code', '') !~ '^[A-Za-z0-9._-]{1,32}$'
      OR length(COALESCE(e->>'description', '')) > 300
      OR length(COALESCE(e->>'header_name', '')) > 200
      OR COALESCE(e->>'group', '') NOT IN ('ATL', 'BTL', 'Post', 'Music', 'VFX', 'Other')
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'budget_templates: invalid line %', left(v_bad::text, 200) USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(NEW.lines) e)
     <> (SELECT count(DISTINCT e->>'code') FROM jsonb_array_elements(NEW.lines) e) THEN
    RAISE EXCEPTION 'budget_templates: a code appears twice in the template' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stamp_budget_template() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_budget_templates_stamp ON public.budget_templates;
CREATE TRIGGER trg_budget_templates_stamp BEFORE INSERT OR UPDATE ON public.budget_templates
  FOR EACH ROW EXECUTE FUNCTION public.stamp_budget_template();
DROP TRIGGER IF EXISTS trg_audit_history_budget_templates ON public.budget_templates;
CREATE TRIGGER trg_audit_history_budget_templates
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_templates
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();
