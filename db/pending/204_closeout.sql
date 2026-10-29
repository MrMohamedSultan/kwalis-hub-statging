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
-- Functions of 196 / 201 changed here are full copies of their latest
-- definition with the changes marked "204".
--
-- 1. Purchase orders (X08)
--    * first_approved_at — stamped by the database the first time a PO is
--      approved / issued and never cleared. Backfilled from the audit history
--      (first approved / issued version) and from today's approval stamps.
--    * A PO that was ever approved cannot be deleted (also not to the trash)
--      while its organization exists; it is cancelled with a reason instead:
--      cancel_purchase_order(id, reason) or status → Cancelled with
--      cancellation_reason. Cancelling needs an approver of the organization
--      (can_approve_invoice, 201), no money paid against the PO (net of
--      refunds), no open payment request, no live invoice, and nothing else
--      changed in the same statement. A cancelled PO is locked (every column
--      but the notes) and keeps its approval stamps.
--    * Other moves of an approved PO: Closed only when fully invoiced
--      (approved invoices) or fully paid; back to Draft / Open or to Rejected
--      only by an approver with a reason (status_change_reason).
--    * No payment request / payment on a cancelled or rejected PO; the PO row
--      is locked FOR SHARE so a concurrent cancellation waits.
--    * POs that were never approved behave as before (delete, reject).
-- 2. Paid payment request → refund (X08)
--    * reverse_paid_payment_request(request, reason, refund_date, reference):
--      organization admin who did not request, approve (any level / board)
--      or execute the original (maker-checker); a platform owner may. The
--      request stays "paid" (its payment stays in the books) and a refund
--      payments row is added: same document, amount = −original,
--      reverses_payment_id = the original, bank_reference = the optional
--      reference (also kept in payment_requests.reversal_reference). Refund
--      date between the payment date and today. The ledger posts it with the
--      sides flipped (Dr Bank / Cr Accounts Payable): debits = credits and
--      ledger_phases_match() stays true; the document is payable again.
--    * payments.payment_request_id is written only by apply_request_payment
--      (196, redefined here with kwalis.request_payment = on): a payment
--      cannot be re-pointed at another request and refunded in its place.
--    * payments.amount may be negative only for such a refund row
--      (payments_amount_check). Refund rows are written only by the RPC, are
--      never edited or deleted; a payment with a refund cannot be edited or
--      deleted either (an organization being deleted still takes them).
--    * A reversed request is frozen (a moved proof file aside) and no longer
--      counts toward the document's requested total, so a new request can
--      pay it again. A fully refunded invoice / petty cash receipt can be
--      cancelled (201 functions redefined: payments counted net).
--    * Instalment (payroll) requests are not reversed here: the instalment
--      schedule is driven by its request (176) — a refund there needs a
--      contract correction (refused with a clear message).
-- 3. Platform Hub settings (D20) — platform_settings rows (035) for the
--    Platform Configuration tab, which kept them in the browser
--    (localStorage). Super admin writes (existing policy); values checked
--    in stamp_platform_settings(). The board-approval limit
--    (payment_board_approval_above_sar, 035) is read-only in the app until a
--    board approval action exists.
-- 4. budget_templates (D20) — an organization's own budget template (header /
--    main codes list). One per organization may be the default; the budget
--    creation screen starts from it, else from the built-in template.
--    Members read, organization admins write. Lines are rebuilt from the
--    known keys; at most 5000 lines / 4 MB.
--
-- SECURITY: triggers on financial tables, SECURITY DEFINER functions
-- (reverse_paid_payment_request, organization_exists, the PO / payment
-- guards), a new table with RLS — apply only after owner approval
-- (SECURITY.md).
--
-- Rollback (in this order):
--   DROP TRIGGER IF EXISTS trg_budget_templates_stamp ON public.budget_templates;
--   DROP TRIGGER IF EXISTS trg_audit_history_budget_templates ON public.budget_templates;
--   DROP TABLE IF EXISTS public.budget_templates;
--   DROP FUNCTION IF EXISTS public.stamp_budget_template();
--   DELETE FROM public.platform_settings WHERE key IN ('platform_base_currency', 'fx_usd_to_base',
--     'fx_eur_to_base', 'fx_aed_to_base', 'default_wht_rate_pct', 'fiscal_year_start',
--     'default_project_limit', 'default_language', 'vat_standard_rate_pct');
--   re-create stamp_platform_settings() from 035;
--   re-create enforce_invoice_approval() / enforce_petty_receipt_approval() from 201;
--   re-create apply_request_payment() from 196;
--   DROP FUNCTION IF EXISTS public.reverse_paid_payment_request(uuid, text, date, text);
--   DROP TRIGGER IF EXISTS trg_payment_request_reversal_guard ON public.payment_requests;
--   DROP FUNCTION IF EXISTS public.guard_reversed_payment_request();
--   DROP TRIGGER IF EXISTS trg_payments_reversal_guard ON public.payments;
--   DROP FUNCTION IF EXISTS public.guard_payment_reversal();
--   re-create enforce_payment_request_limit() / revalidate_payment_request_on_submit() from 176;
--   (only when no refund row exists) ALTER TABLE public.payments DROP CONSTRAINT payments_amount_check,
--     ADD CONSTRAINT payments_amount_check CHECK (amount >= 0);
--   ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_refund_no_request_link;
--   ALTER TABLE public.payments DROP COLUMN reverses_payment_id, DROP COLUMN reversal_reason;
--   ALTER TABLE public.payment_requests DROP COLUMN reversed_by, DROP COLUMN reversed_at,
--     DROP COLUMN reversal_reason, DROP COLUMN reversal_payment_id, DROP COLUMN reversal_reference;
--   DROP TRIGGER IF EXISTS trg_payments_po_live ON public.payments;
--   DROP TRIGGER IF EXISTS trg_payment_request_validate_zz_po ON public.payment_requests;
--   DROP FUNCTION IF EXISTS public.require_live_po_for_payment(), public.require_live_po_for_request();
--   DROP FUNCTION IF EXISTS public.cancel_purchase_order(uuid, text);
--   DROP TRIGGER IF EXISTS zz_trg_purchase_order_cancellation ON public.purchase_orders;
--   DROP TRIGGER IF EXISTS trg_purchase_order_delete_guard ON public.purchase_orders;
--   DROP FUNCTION IF EXISTS public.enforce_purchase_order_cancellation(), public.guard_purchase_order_delete(),
--     public.po_locked_view(jsonb, jsonb, text[]), public.po_net_paid(uuid, uuid), public.organization_exists(uuid);
--   ALTER TABLE public.purchase_orders DROP COLUMN first_approved_at, DROP COLUMN cancelled_by,
--     DROP COLUMN cancelled_at, DROP COLUMN cancellation_reason, DROP COLUMN status_change_reason;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Purchase orders: cancellation instead of delete
-- ---------------------------------------------------------------------
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS first_approved_at    timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by         uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at         timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason  text,
  ADD COLUMN IF NOT EXISTS status_change_reason text;
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_cancellation_reason_len;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_cancellation_reason_len
  CHECK (cancellation_reason IS NULL OR length(cancellation_reason) <= 1000);
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_change_reason_len;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_status_change_reason_len
  CHECK (status_change_reason IS NULL OR length(status_change_reason) <= 1000);
COMMENT ON COLUMN public.purchase_orders.first_approved_at IS
  'First time the PO was approved / issued; written by the database only and never cleared. Such a PO is cancelled with a reason, never deleted. db/pending/204.';
COMMENT ON COLUMN public.purchase_orders.cancellation_reason IS
  'Why an approved PO was cancelled (required). cancelled_by / cancelled_at are written by the database. db/pending/204.';
COMMENT ON COLUMN public.purchase_orders.status_change_reason IS
  'Why an approver moved an approved PO back to Draft / Open or to Rejected (required for that move; the audit history records who). db/pending/204.';

-- Backfill (new column only; triggers off so updated_at / audit are untouched):
-- the first approval in the audit history, else the approval stamp of a PO
-- approved / issued today. A PO approved and later moved back before the
-- audit history existed cannot be found (owner note in the README).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.purchase_orders po
              WHERE po.first_approved_at IS NULL
                AND (lower(COALESCE(po.status, '')) IN ('approved', 'issued') OR po.approved_at IS NOT NULL
                     OR EXISTS (SELECT 1 FROM public.audit_history h
                                 WHERE h.table_name = 'purchase_orders' AND h.record_id = po.id
                                   AND (lower(COALESCE(h.new_row->>'status', '')) IN ('approved', 'issued')
                                        OR NULLIF(h.new_row->>'approved_at', '') IS NOT NULL)))) THEN
    ALTER TABLE public.purchase_orders DISABLE TRIGGER USER;
    UPDATE public.purchase_orders po
       SET first_approved_at = COALESCE(
             (SELECT min(h.created_at) FROM public.audit_history h
               WHERE h.table_name = 'purchase_orders' AND h.record_id = po.id
                 AND (lower(COALESCE(h.new_row->>'status', '')) IN ('approved', 'issued')
                      OR NULLIF(h.new_row->>'approved_at', '') IS NOT NULL)),
             CASE WHEN lower(COALESCE(po.status, '')) IN ('approved', 'issued') OR po.approved_at IS NOT NULL
                  THEN COALESCE(po.approved_at, po.updated_at, po.created_at) END)
     WHERE po.first_approved_at IS NULL
       AND (lower(COALESCE(po.status, '')) IN ('approved', 'issued') OR po.approved_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.audit_history h
                        WHERE h.table_name = 'purchase_orders' AND h.record_id = po.id
                          AND (lower(COALESCE(h.new_row->>'status', '')) IN ('approved', 'issued')
                               OR NULLIF(h.new_row->>'approved_at', '') IS NOT NULL)));
    ALTER TABLE public.purchase_orders ENABLE TRIGGER USER;
  END IF;
END $$;

-- SECURITY DEFINER so the caller's RLS on organizations cannot hide the row
-- (same as project_exists, 176).
CREATE OR REPLACE FUNCTION public.organization_exists(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _org IS NOT NULL AND EXISTS (SELECT 1 FROM public.organizations WHERE id = _org)
$$;
REVOKE ALL ON FUNCTION public.organization_exists(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_exists(uuid) TO authenticated, service_role;

-- A PO row as compared by the cancellation rules: without the columns that
-- may change, money to 2 decimals (trg_money_precision rounds a legacy amount
-- on every update), and a link the database itself cleared (project /
-- budget line / vendor deleted, ON DELETE SET NULL) counted as unchanged.
CREATE OR REPLACE FUNCTION public.po_locked_view(n jsonb, o jsonb, p_free text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb := n - p_free;
BEGIN
  v := v || jsonb_build_object(
         'amount', round(COALESCE((n->>'amount')::numeric, 0), 2),
         'amount_original', round((n->>'amount_original')::numeric, 2));
  IF n->>'project_id' IS NULL AND o->>'project_id' IS NOT NULL
     AND NOT public.project_exists((o->>'project_id')::uuid) THEN
    v := jsonb_set(v, '{project_id}', o->'project_id');
  END IF;
  IF n->>'linked_budget_line_id' IS NULL AND o->>'linked_budget_line_id' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.budget_lines b WHERE b.id = (o->>'linked_budget_line_id')::uuid) THEN
    v := jsonb_set(v, '{linked_budget_line_id}', o->'linked_budget_line_id');
  END IF;
  IF n->>'vendor_id' IS NULL AND o->>'vendor_id' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.vendors x WHERE x.id = (o->>'vendor_id')::uuid) THEN
    v := jsonb_set(v, '{vendor_id}', o->'vendor_id');
  END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.po_locked_view(jsonb, jsonb, text[]) FROM PUBLIC, anon, authenticated;

-- Net money paid against a PO (refunds count negative) and what its
-- approved invoices cover.
CREATE OR REPLACE FUNCTION public.po_net_paid(p_po uuid, p_project uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(pm.amount), 0) FROM public.payments pm
   WHERE pm.source_type IN ('purchase_order', 'po') AND pm.source_id = p_po
     AND pm.project_id IS NOT DISTINCT FROM p_project
$$;
REVOKE ALL ON FUNCTION public.po_net_paid(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Runs after trg_purchase_order_maker_checker (174) — name order (zz_).
CREATE OR REPLACE FUNCTION public.enforce_purchase_order_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_old  text;
  v_new  text;
  v_amt  numeric;
  v_inv  numeric;
  -- columns a cancellation / a cancelled PO may still change
  c_cancel CONSTANT text[] := ARRAY['status', 'cancellation_reason', 'cancelled_by', 'cancelled_at',
                                    'approved_by', 'approved_at', 'first_approved_at',
                                    'status_change_reason', 'updated_at'];
  c_locked CONSTANT text[] := ARRAY['cancellation_reason', 'cancelled_by', 'cancelled_at',
                                    'approved_by', 'approved_at', 'first_approved_at',
                                    'status_change_reason', 'updated_at', 'notes'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NULL THEN RETURN NEW; END IF;      -- server jobs / SQL editor / imports
    NEW.first_approved_at := NULL;                 -- a new (or restored) PO was never approved
    NEW.cancelled_by := NULL; NEW.cancelled_at := NULL; NEW.cancellation_reason := NULL;
    NEW.status_change_reason := NULL;
    RETURN NEW;
  END IF;

  -- first approval: kept for ever
  NEW.first_approved_at := COALESCE(OLD.first_approved_at,
                                    CASE WHEN NEW.approved_at IS NOT NULL THEN NEW.approved_at END,
                                    CASE WHEN v_uid IS NULL AND NEW.first_approved_at IS NOT NULL
                                         THEN NEW.first_approved_at END);
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  v_old := lower(COALESCE(OLD.status, ''));
  v_new := lower(COALESCE(NEW.status, ''));

  -- a PO cancelled after approval is locked: every column (status, amounts,
  -- project, organization, number, description, rate …) except the notes
  IF OLD.cancelled_at IS NOT NULL THEN
    IF public.po_locked_view(to_jsonb(NEW) - c_locked, to_jsonb(OLD), ARRAY[]::text[])
       IS DISTINCT FROM public.po_locked_view(to_jsonb(OLD) - c_locked, to_jsonb(OLD), ARRAY[]::text[]) THEN
      RAISE EXCEPTION 'purchase_orders: a cancelled purchase order cannot be changed — record a new one'
        USING ERRCODE = '42501';
    END IF;
    NEW.amount := OLD.amount; NEW.amount_original := OLD.amount_original;
    NEW.cancelled_by := OLD.cancelled_by; NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancellation_reason := OLD.cancellation_reason;
    NEW.status_change_reason := OLD.status_change_reason;
    NEW.approved_by := OLD.approved_by;   NEW.approved_at := OLD.approved_at;
    RETURN NEW;
  END IF;

  IF v_new = v_old OR OLD.first_approved_at IS NULL THEN
    -- no status move of a once-approved PO: the stamps are the database's
    NEW.cancelled_by := OLD.cancelled_by; NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancellation_reason := OLD.cancellation_reason;
    NEW.status_change_reason := OLD.status_change_reason;
    RETURN NEW;
  END IF;

  v_amt := round(COALESCE(OLD.amount, 0), 2);

  -- (a) cancellation: an approver, a reason, nothing paid / requested /
  --     invoiced, and nothing else changed in the same statement
  IF v_new = 'cancelled' THEN
    IF public.po_locked_view(to_jsonb(NEW) - c_cancel, to_jsonb(OLD), ARRAY[]::text[])
       IS DISTINCT FROM public.po_locked_view(to_jsonb(OLD) - c_cancel, to_jsonb(OLD), ARRAY[]::text[]) THEN
      RAISE EXCEPTION 'purchase_orders: cancel the purchase order as recorded — save other changes separately'
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.can_approve_invoice(OLD.project_id, COALESCE(OLD.amount, 0)) THEN
      RAISE EXCEPTION 'purchase_orders: only an approver of this organization can cancel an approved purchase order'
        USING ERRCODE = '42501';
    END IF;
    IF NULLIF(btrim(COALESCE(NEW.cancellation_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'purchase_orders: a reason is required to cancel an approved purchase order'
        USING ERRCODE = '22023';
    END IF;
    IF public.po_net_paid(OLD.id, OLD.project_id) > 0 THEN
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
    NEW.amount := OLD.amount; NEW.amount_original := OLD.amount_original;
    NEW.cancellation_reason := btrim(NEW.cancellation_reason);
    NEW.cancelled_by := v_uid; NEW.cancelled_at := now();
    NEW.status_change_reason := OLD.status_change_reason;
    -- the approval stays on record (174 clears it when leaving an approved state)
    NEW.approved_by := OLD.approved_by; NEW.approved_at := OLD.approved_at;
    RETURN NEW;
  END IF;

  NEW.cancelled_by := OLD.cancelled_by; NEW.cancelled_at := OLD.cancelled_at;
  NEW.cancellation_reason := OLD.cancellation_reason;

  -- (b) Closed: only when nothing is left open — fully invoiced (approved
  --     invoices) or fully paid (net of refunds); otherwise cancel with a reason
  IF v_new = 'closed' THEN
    SELECT COALESCE(sum(COALESCE(i.price, 0)), 0) INTO v_inv FROM public.invoices i
     WHERE i.purchase_order_id = OLD.id AND i.approval_status = 'approved';
    IF greatest(v_inv, public.po_net_paid(OLD.id, OLD.project_id)) < v_amt - 0.005 THEN
      RAISE EXCEPTION 'purchase_orders: an approved purchase order can be closed only once it is fully invoiced or paid — cancel it with a reason instead'
        USING ERRCODE = '42501';
    END IF;
    NEW.status_change_reason := OLD.status_change_reason;
    RETURN NEW;
  END IF;

  -- (c) back to Draft / Open or to Rejected: an approver, with a reason
  IF v_new IN ('draft', 'rejected')
     OR (v_old IN ('approved', 'issued') AND v_new NOT IN ('approved', 'issued')) THEN
    IF NOT public.can_approve_invoice(OLD.project_id, COALESCE(OLD.amount, 0)) THEN
      RAISE EXCEPTION 'purchase_orders: only an approver of this organization can move an approved purchase order to % — or cancel it', NEW.status
        USING ERRCODE = '42501';
    END IF;
    IF length(btrim(COALESCE(NEW.status_change_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'purchase_orders: a reason is required to move an approved purchase order to %', NEW.status
        USING ERRCODE = '22023';
    END IF;
    NEW.status_change_reason := btrim(NEW.status_change_reason);
    RETURN NEW;
  END IF;

  NEW.status_change_reason := OLD.status_change_reason;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_purchase_order_cancellation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_trg_purchase_order_cancellation ON public.purchase_orders;
CREATE TRIGGER zz_trg_purchase_order_cancellation BEFORE INSERT OR UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_purchase_order_cancellation();

-- An approved (or once approved / cancelled) PO is never deleted. Deleting a
-- project does NOT delete its POs (purchase_orders.project_id is ON DELETE
-- SET NULL): they stay, without a project, and stay undeletable. Only an
-- organization being deleted takes its POs with it (the cascade may reach
-- the POs before the projects, so the organization is what is checked).
CREATE OR REPLACE FUNCTION public.guard_purchase_order_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (OLD.first_approved_at IS NOT NULL OR OLD.cancelled_at IS NOT NULL
          OR lower(COALESCE(OLD.status, '')) IN ('approved', 'issued'))
     AND public.organization_exists(OLD.organization_id) THEN
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

-- No payment request / payment on a cancelled or rejected PO. FOR SHARE: a
-- concurrent cancellation (which locks the PO row FOR UPDATE) waits for this
-- transaction and then sees the request / payment, and the reverse — as
-- require_approved_invoice_for_request does for invoices (201).
CREATE OR REPLACE FUNCTION public.require_live_po_for_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.source_type IS DISTINCT FROM 'purchase_order'
     OR NEW.status IN ('rejected', 'cancelled') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id
     AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.purchase_orders po
    WHERE po.id = NEW.source_id
      AND po.organization_id = NEW.organization_id
      AND po.project_id IS NOT DISTINCT FROM COALESCE(NEW.project_id, po.project_id)
      AND po.cancelled_at IS NULL
      AND lower(COALESCE(po.status, '')) NOT IN ('cancelled', 'rejected')
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order cancelled: a payment cannot be requested on a cancelled or rejected purchase order'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_live_po_for_request() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payment_request_validate_zz_po ON public.payment_requests;
CREATE TRIGGER trg_payment_request_validate_zz_po
  BEFORE INSERT OR UPDATE OF status, source_type, source_id ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.require_live_po_for_request();

CREATE OR REPLACE FUNCTION public.require_live_po_for_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.source_type NOT IN ('purchase_order', 'po')
     OR NEW.reverses_payment_id IS NOT NULL THEN       -- a refund is written by the RPC on a live PO
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id
     AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.purchase_orders po
    WHERE po.id = NEW.source_id
      AND po.project_id IS NOT DISTINCT FROM NEW.project_id
      AND po.cancelled_at IS NULL
      AND lower(COALESCE(po.status, '')) NOT IN ('cancelled', 'rejected')
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order cancelled: a payment can be recorded only on a live purchase order of this project'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_live_po_for_payment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payments_po_live ON public.payments;
CREATE TRIGGER trg_payments_po_live
  BEFORE INSERT OR UPDATE OF source_type, source_id ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.require_live_po_for_payment();

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
-- a refund row never carries the request link (the original payment does)
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_refund_no_request_link;
ALTER TABLE public.payments ADD CONSTRAINT payments_refund_no_request_link
  CHECK (reverses_payment_id IS NULL OR payment_request_id IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_reverses_payment
  ON public.payments (reverses_payment_id) WHERE reverses_payment_id IS NOT NULL;
-- (one payment per request: uq_payments_payment_request, 196 — unique on
--  every non-NULL payment_request_id; refund rows have none, see above)
COMMENT ON COLUMN public.payments.reverses_payment_id IS
  'Refund / reversal of that payment (amount = −original), written by reverse_paid_payment_request only. db/pending/204.';

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS reversed_by         uuid,
  ADD COLUMN IF NOT EXISTS reversed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason     text,
  ADD COLUMN IF NOT EXISTS reversal_payment_id uuid,
  ADD COLUMN IF NOT EXISTS reversal_reference  text;
ALTER TABLE public.payment_requests DROP CONSTRAINT IF EXISTS payment_requests_reversal_reason_len;
ALTER TABLE public.payment_requests ADD CONSTRAINT payment_requests_reversal_reason_len
  CHECK (reversal_reason IS NULL OR length(reversal_reason) <= 1000);
ALTER TABLE public.payment_requests DROP CONSTRAINT IF EXISTS payment_requests_reversal_reference_len;
ALTER TABLE public.payment_requests ADD CONSTRAINT payment_requests_reversal_reference_len
  CHECK (reversal_reference IS NULL OR length(reversal_reference) <= 200);
COMMENT ON COLUMN public.payment_requests.reversed_at IS
  'A paid request reversed by an organization admin who took no part in it (reason required): its payment stays, a refund payment (reversal_payment_id) offsets it. The request is then frozen. db/pending/204.';
COMMENT ON COLUMN public.payment_requests.reversal_reference IS
  'Optional proof of the refund (bank reference / credit note number), also written to the refund payment''s bank_reference. db/pending/204.';

-- Refund rows: written only by the RPC, never edited or deleted; a payment
-- that has a refund keeps its amount / document / date. The request link
-- (payment_request_id) is written by apply_request_payment only (196), so a
-- payment cannot be pointed at another request and then refunded.
CREATE OR REPLACE FUNCTION public.guard_payment_reversal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rpc  boolean := COALESCE(current_setting('kwalis.payment_reversal', true), '') = 'on';
  v_link boolean := COALESCE(current_setting('kwalis.request_payment', true), '') = 'on';
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF (NEW.reverses_payment_id IS NOT NULL OR NEW.reversal_reason IS NOT NULL) AND NOT v_rpc THEN
      RAISE EXCEPTION 'payments: refunds are recorded with "Reverse payment" on Payment Approvals'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.payment_request_id IS NOT NULL AND NOT v_link THEN
      NEW.payment_request_id := NULL;    -- e.g. a row restored from the trash: the request re-links it
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.reverses_payment_id IS DISTINCT FROM OLD.reverses_payment_id
       OR NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason THEN
      RAISE EXCEPTION 'payments: the reversal link is written by the database' USING ERRCODE = '42501';
    END IF;
    IF NEW.payment_request_id IS DISTINCT FROM OLD.payment_request_id AND NOT v_link
       AND NOT (NEW.payment_request_id IS NULL      -- request deleted (ON DELETE SET NULL)
                AND NOT EXISTS (SELECT 1 FROM public.payment_requests q WHERE q.id = OLD.payment_request_id)) THEN
      RAISE EXCEPTION 'payments: the payment request of a payment is linked by the database' USING ERRCODE = '42501';
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
  -- DELETE (an organization being deleted takes them with it, whatever the
  -- order the cascade reaches projects and payments in)
  IF public.organization_exists(OLD.organization_id)
     AND (OLD.project_id IS NULL OR public.project_exists(OLD.project_id))
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

-- Copy of 196, changes marked "204": runs with kwalis.request_payment = on
-- (the only writer of payments.payment_request_id), a reversed request only
-- passes a new proof path on to its payment, a refund row is never adopted.
CREATE OR REPLACE FUNCTION public.apply_request_payment(r public.payment_requests)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET kwalis.request_payment = 'on'                                          -- 204
AS $$
DECLARE
  v_types  text[];
  v_amount numeric;
  v_date   date;
  v_method text;
  v_id     uuid;
BEGIN
  IF r.payroll_milestone_id IS NOT NULL OR r.source_type NOT IN ('invoice', 'purchase_order', 'petty_cash') THEN
    RETURN NULL;                                   -- instalments: 160 / 176
  END IF;
  v_types := CASE r.source_type WHEN 'invoice' THEN ARRAY['invoice']
                                WHEN 'purchase_order' THEN ARRAY['purchase_order', 'po']
                                ELSE ARRAY['petty_cash', 'cash_advance'] END;

  -- 204: a reversed request is frozen; only a moved proof file follows
  IF r.reversed_at IS NOT NULL THEN
    UPDATE public.payments SET proof_path = COALESCE(r.proof_path, proof_path), updated_at = now()
     WHERE payment_request_id = r.id AND organization_id = r.organization_id
       AND proof_path IS DISTINCT FROM COALESCE(r.proof_path, proof_path)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF r.status IS DISTINCT FROM 'paid' THEN
    -- no longer paid: the row it created goes, a hand row it adopted is released
    DELETE FROM public.payments WHERE payment_request_id = r.id AND notes LIKE 'Payment request:%';
    UPDATE public.payments SET payment_request_id = NULL, updated_at = now() WHERE payment_request_id = r.id;
    RETURN NULL;
  END IF;

  v_amount := round(public.payment_request_amount_sar(r.requested_amount, r.currency, r.project_id), 2);
  v_date   := COALESCE(r.payment_date, r.executed_at::date, CURRENT_DATE);
  v_method := CASE WHEN r.payment_method IN ('Cash', 'Transfer', 'Check', 'Card', 'Bank') THEN r.payment_method ELSE 'Transfer' END;

  UPDATE public.payments
     SET amount = v_amount, payment_date = v_date, method = v_method,
         proof_path = COALESCE(r.proof_path, proof_path), updated_at = now()
   WHERE payment_request_id = r.id
     AND organization_id = r.organization_id                               -- secfix #6
     AND project_id IS NOT DISTINCT FROM r.project_id
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- adopt a payment recorded by hand for this document with the same amount
  -- (secfix #6: only a payment of the request's own organization and project)
  UPDATE public.payments
     SET payment_request_id = r.id, updated_at = now()
   WHERE id = (SELECT p.id FROM public.payments p
                WHERE p.source_id = r.source_id AND p.source_type = ANY (v_types)
                  AND p.organization_id = r.organization_id
                  AND p.project_id IS NOT DISTINCT FROM r.project_id
                  AND p.payment_request_id IS NULL AND p.payroll_milestone_id IS NULL
                  AND p.reverses_payment_id IS NULL                        -- 204
                  AND NOT EXISTS (SELECT 1 FROM public.payments x WHERE x.reverses_payment_id = p.id)  -- 204
                  AND p.amount = v_amount
                ORDER BY p.payment_date, p.created_at LIMIT 1)
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.payments
    (organization_id, project_id, source_type, source_id, amount, payment_date, method, proof_path, notes,
     recorded_by, payment_request_id)
  VALUES
    (r.organization_id, r.project_id, r.source_type, r.source_id, v_amount, v_date, v_method, r.proof_path,
     left('Payment request: ' || COALESCE(NULLIF(r.source_label, ''), r.source_type), 500),
     COALESCE(r.executed_by, auth.uid()), r.id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_request_payment(public.payment_requests) FROM PUBLIC, anon, authenticated;

-- A reversed request is frozen (except a moved proof file —
-- repoint_contract_file, 201); the reversal stamps come from the RPC only.
CREATE OR REPLACE FUNCTION public.guard_reversed_payment_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rpc boolean := COALESCE(current_setting('kwalis.payment_reversal', true), '') = 'on';
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.reversed_at IS NOT NULL AND public.organization_exists(OLD.organization_id)
       AND (OLD.project_id IS NULL OR public.project_exists(OLD.project_id)) THEN
      RAISE EXCEPTION 'payment_requests: a reversed request cannot be deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.reversed_by := NULL; NEW.reversed_at := NULL;
    NEW.reversal_reason := NULL; NEW.reversal_payment_id := NULL; NEW.reversal_reference := NULL;
    RETURN NEW;
  END IF;
  IF OLD.reversed_at IS NOT NULL THEN
    IF (to_jsonb(NEW) - ARRAY['updated_at', 'proof_path']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at', 'proof_path'])
       AND NOT (NEW.project_id IS NULL AND NOT public.project_exists(OLD.project_id)) THEN
      RAISE EXCEPTION 'payment_requests: a reversed request can no longer be changed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.reversed_by IS DISTINCT FROM OLD.reversed_by
      OR NEW.reversed_at IS DISTINCT FROM OLD.reversed_at
      OR NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason
      OR NEW.reversal_payment_id IS DISTINCT FROM OLD.reversal_payment_id
      OR NEW.reversal_reference IS DISTINCT FROM OLD.reversal_reference) AND NOT v_rpc THEN
    RAISE EXCEPTION 'payment_requests: a paid request is reversed with reverse_paid_payment_request only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_reversed_payment_request() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payment_request_reversal_guard ON public.payment_requests;
CREATE TRIGGER trg_payment_request_reversal_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_reversed_payment_request();

-- Maker-checker (SECURITY.md §4, owner decision): an organization admin who
-- requested, approved (any level of the chain, or the board) or executed the
-- original payment cannot reverse it; a platform owner (super admin) may.
DROP FUNCTION IF EXISTS public.reverse_paid_payment_request(uuid, text, date);
CREATE OR REPLACE FUNCTION public.reverse_paid_payment_request(
  _request uuid, _reason text, _refund_date date DEFAULT NULL, _reference text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_reason text := btrim(COALESCE(_reason, ''));
  v_ref    text := NULLIF(btrim(COALESCE(_reference, '')), '');
  v_types  text[];
  r        public.payment_requests%ROWTYPE;
  p        public.payments%ROWTYPE;
  v_n      int;
  v_date   date;
  v_id     uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'reverse_paid_payment_request: not signed in' USING ERRCODE = '42501';
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'A reversal needs a reason (3 to 1000 characters)' USING ERRCODE = '22023';
  END IF;
  IF length(v_ref) > 200 THEN
    RAISE EXCEPTION 'The refund reference is up to 200 characters' USING ERRCODE = '22023';
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
  v_types := CASE r.source_type WHEN 'invoice' THEN ARRAY['invoice']
                                WHEN 'purchase_order' THEN ARRAY['purchase_order', 'po']
                                ELSE ARRAY['petty_cash', 'cash_advance'] END;

  -- exactly one original payment of this request, for its own document
  SELECT count(*) INTO v_n FROM public.payments
   WHERE payment_request_id = r.id AND organization_id = r.organization_id
     AND project_id IS NOT DISTINCT FROM r.project_id
     AND reverses_payment_id IS NULL AND amount > 0
     AND source_type = ANY (v_types) AND source_id = r.source_id;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'No single payment is recorded for this request (run backfill_request_payments first)'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM public.payments
   WHERE payment_request_id = r.id AND organization_id = r.organization_id
     AND project_id IS NOT DISTINCT FROM r.project_id
     AND reverses_payment_id IS NULL AND amount > 0
     AND source_type = ANY (v_types) AND source_id = r.source_id
   FOR UPDATE;

  IF NOT public.is_super_admin(v_uid)
     AND (r.requested_by = v_uid OR r.approved_by = v_uid OR r.executed_by = v_uid
          OR p.recorded_by = v_uid
          OR EXISTS (SELECT 1 FROM public.payment_request_approvals a
                      WHERE a.payment_request_id = r.id AND a.approved_by = v_uid)
          OR EXISTS (SELECT 1 FROM public.payment_request_board_approvals b
                      WHERE b.payment_request_id = r.id AND b.approved_by = v_uid)) THEN
    RAISE EXCEPTION 'Maker-checker: you requested, approved or paid this request — another organization admin must reverse it'
      USING ERRCODE = '42501';
  END IF;

  v_date := COALESCE(_refund_date, CURRENT_DATE);
  IF v_date < p.payment_date THEN
    RAISE EXCEPTION 'The refund date cannot be before the payment date (%)', p.payment_date USING ERRCODE = '22023';
  END IF;
  IF v_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'The refund date cannot be in the future' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('kwalis.payment_reversal', 'on', true);
  INSERT INTO public.payments
    (organization_id, project_id, source_type, source_id, amount, payment_date, method, notes,
     recorded_by, reverses_payment_id, reversal_reason, currency, original_amount,
     bank_name, bank_country, spend_country, spend_city, bank_reference)
  VALUES
    (p.organization_id, p.project_id, p.source_type, p.source_id, -p.amount, v_date, p.method,
     left('Refund / reversal: ' || v_reason, 500),
     v_uid, p.id, v_reason, p.currency, CASE WHEN p.original_amount IS NOT NULL THEN -p.original_amount END,
     p.bank_name, p.bank_country, p.spend_country, p.spend_city, v_ref)
  RETURNING id INTO v_id;
  UPDATE public.payment_requests
     SET reversed_by = v_uid, reversed_at = now(), reversal_reason = v_reason, reversal_payment_id = v_id,
         reversal_reference = v_ref
   WHERE id = r.id;
  PERFORM set_config('kwalis.payment_reversal', '', true);
  RETURN jsonb_build_object('refund_payment_id', v_id, 'amount', -p.amount, 'refund_date', v_date);
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_paid_payment_request(uuid, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_paid_payment_request(uuid, text, date, text) TO authenticated, service_role;


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
-- 2b. Cancelling an invoice / a petty cash receipt after a full refund
--     (copies of 201, changes marked "204"): the payments are counted
--     net of refunds and a reversed request no longer blocks.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_invoice_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_old  text;
  v_new  text;
  v_tr   record;
  v_jn   jsonb;
  v_jo   jsonb;
  v_keep text[];
  c_meta CONSTANT text[] := ARRAY['approval_status', 'approved_by', 'approved_at', 'rejected_by', 'rejected_at',
                                  'rejection_reason', 'cancelled_by', 'cancelled_at', 'cancellation_reason',
                                  'updated_by', 'updated_at', 'last_edited_by'];
  c_files CONSTANT text[] := ARRAY['invoice_url', 'receipt_url', 'attachment_url'];
  c_money CONSTANT text[] := ARRAY['price', 'vat_amount', 'wht_amount', 'net_payable'];
  c_vendor CONSTANT text[] := ARRAY['vendor_id', 'vendor_cr_no', 'vendor_vat_no', 'vendor_country', 'vendor_tax_residency'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NULL THEN                       -- server jobs / SQL editor / imports
      IF NEW.approval_status = 'approved' AND NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
      RETURN NEW;
    END IF;
    IF NEW.approval_status IN ('approved', 'cancelled') THEN
      RAISE EXCEPTION 'Maker-checker: a new invoice is recorded as pending — another user must approve it'
        USING ERRCODE = '42501';
    END IF;
    NEW.approval_status := 'pending';           -- also a rejected row restored from the trash
    -- a row restored from the trash keeps its original creator (read from the
    -- trash row) and the restorer becomes its last editor: neither approves it
    SELECT * INTO v_tr FROM public.trash_original_creator('invoices', NEW.id);
    NEW.created_by := CASE WHEN v_tr.found THEN v_tr.created_by ELSE v_uid END;
    NEW.last_edited_by := v_uid;
    NEW.approved_by := NULL;  NEW.approved_at := NULL;
    NEW.rejected_by := NULL;  NEW.rejected_at := NULL;  NEW.rejection_reason := NULL;
    NEW.cancelled_by := NULL; NEW.cancelled_at := NULL; NEW.cancellation_reason := NULL;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN RETURN NEW; END IF;
  v_old := OLD.approval_status;
  v_new := NEW.approval_status;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'invoices: created_by cannot be changed' USING ERRCODE = '42501';
  END IF;
  NEW.last_edited_by := OLD.last_edited_by;     -- written by the database only

  -- X09: an approved (or cancelled) invoice is locked. Values the app sends
  -- back unchanged (normalised) are kept exactly as stored, so an untouched
  -- legacy amount with more than 2 decimals never blocks an update.
  IF v_old IN ('approved', 'cancelled') THEN
    v_jn := to_jsonb(NEW); v_jo := to_jsonb(OLD);
    IF public.invoice_lock_view(v_jn) IS DISTINCT FROM public.invoice_lock_view(v_jo)
       OR (OLD.vendor_id IS NOT NULL AND NEW.vendor_id IS DISTINCT FROM OLD.vendor_id)
       OR (NULLIF(btrim(OLD.vendor_cr_no), '') IS NOT NULL AND NEW.vendor_cr_no IS DISTINCT FROM OLD.vendor_cr_no)
       OR (NULLIF(btrim(OLD.vendor_vat_no), '') IS NOT NULL AND NEW.vendor_vat_no IS DISTINCT FROM OLD.vendor_vat_no)
       OR (NULLIF(btrim(OLD.vendor_country), '') IS NOT NULL AND NEW.vendor_country IS DISTINCT FROM OLD.vendor_country)
       OR (OLD.vendor_tax_residency IS NOT NULL AND NEW.vendor_tax_residency IS DISTINCT FROM OLD.vendor_tax_residency) THEN
      RAISE EXCEPTION 'invoices: an approved invoice cannot be changed (amount, tax, vendor, budget code, date, Film Commission inputs) — cancel it and record a new one'
        USING ERRCODE = '42501';
    END IF;
    -- keep the stored values of the locked columns (vendor fields: only
    -- where they were set — linking a vendor to an invoice without one is allowed)
    SELECT array_agg(k) INTO v_keep
      FROM jsonb_object_keys(public.invoice_lock_view(v_jo)) k;
    v_keep := v_keep || ARRAY(SELECT k FROM unnest(c_vendor) k WHERE v_jo->>k IS NOT NULL);
    NEW := jsonb_populate_record(NEW, (SELECT jsonb_object_agg(k, v_jo->k) FROM unnest(v_keep) k WHERE v_jo ? k));
  END IF;

  IF v_new IS DISTINCT FROM v_old THEN
    IF v_old = 'pending' AND v_new IN ('approved', 'rejected') THEN
      -- the decision is taken on the invoice as recorded: nothing else may
      -- change in the same statement
      IF public.approval_row_content(to_jsonb(NEW), c_meta, c_money)
         IS DISTINCT FROM public.approval_row_content(to_jsonb(OLD), c_meta, c_money) THEN
        RAISE EXCEPTION 'Maker-checker: approve or reject the invoice as recorded — save changes separately (another user then approves them)'
          USING ERRCODE = '42501';
      END IF;
      IF (OLD.created_by IS NOT NULL AND OLD.created_by = v_uid)
         OR (OLD.last_edited_by IS NOT NULL AND OLD.last_edited_by = v_uid) THEN
        RAISE EXCEPTION 'Maker-checker: an invoice must be approved or rejected by someone other than the person who recorded or last changed it'
          USING ERRCODE = '42501';
      END IF;
      IF NOT public.can_approve_invoice(OLD.project_id, COALESCE(OLD.price, 0) + COALESCE(OLD.vat_amount, 0)) THEN
        RAISE EXCEPTION 'invoices: only an approver of this organization (for this amount) can approve or reject this invoice'
          USING ERRCODE = '42501';
      END IF;
      IF v_new = 'approved' THEN
        NEW.approved_by := v_uid; NEW.approved_at := now();
        NEW.rejected_by := NULL;  NEW.rejected_at := NULL; NEW.rejection_reason := NULL;
      ELSE
        IF NULLIF(btrim(COALESCE(NEW.rejection_reason, '')), '') IS NULL THEN
          RAISE EXCEPTION 'invoices: a reason is required to reject an invoice' USING ERRCODE = '22023';
        END IF;
        NEW.rejection_reason := btrim(NEW.rejection_reason);
        NEW.rejected_by := v_uid; NEW.rejected_at := now();
        NEW.approved_by := NULL;  NEW.approved_at := NULL;
      END IF;
      RETURN NEW;
    ELSIF v_old = 'rejected' AND v_new = 'pending' THEN
      -- corrected and sent again
      NEW.rejected_by := NULL; NEW.rejected_at := NULL;
    ELSIF v_old = 'approved' AND v_new = 'cancelled' THEN
      IF NOT public.can_approve_invoice(OLD.project_id, COALESCE(OLD.price, 0) + COALESCE(OLD.vat_amount, 0)) THEN
        RAISE EXCEPTION 'invoices: only an approver of this organization can cancel an approved invoice'
          USING ERRCODE = '42501';
      END IF;
      IF NULLIF(btrim(COALESCE(NEW.cancellation_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'invoices: a reason is required to cancel an approved invoice' USING ERRCODE = '22023';
      END IF;
      -- 204: net of refunds (a fully refunded invoice can be cancelled)
      IF COALESCE((SELECT sum(pm.amount) FROM public.payments pm
                    WHERE pm.source_type = 'invoice' AND pm.source_id = OLD.id
                      AND pm.project_id IS NOT DISTINCT FROM OLD.project_id), 0) > 0 THEN
        RAISE EXCEPTION 'invoices: this invoice has payments — record a refund / credit note instead of cancelling it'
          USING ERRCODE = '42501';
      END IF;
      IF EXISTS (SELECT 1 FROM public.payment_requests r
                  WHERE r.source_type = 'invoice' AND r.source_id = OLD.id
                    AND r.organization_id = OLD.organization_id
                    AND r.status NOT IN ('rejected', 'cancelled')
                    AND r.reversed_at IS NULL) THEN                          -- 204
        RAISE EXCEPTION 'invoices: cancel or reject the payment request of this invoice first'
          USING ERRCODE = '42501';
      END IF;
      NEW.cancellation_reason := btrim(NEW.cancellation_reason);
      NEW.cancelled_by := v_uid; NEW.cancelled_at := now();
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'invoices: the approval status cannot go from % to %', v_old, v_new
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- same status: the stamps are written by the database only
    NEW.approved_by := OLD.approved_by;   NEW.approved_at := OLD.approved_at;
    NEW.rejected_by := OLD.rejected_by;   NEW.rejected_at := OLD.rejected_at;
    NEW.cancelled_by := OLD.cancelled_by; NEW.cancelled_at := OLD.cancelled_at;
    IF v_old IN ('approved', 'cancelled') THEN
      NEW.rejection_reason := OLD.rejection_reason;
      NEW.cancellation_reason := OLD.cancellation_reason;
    END IF;
  END IF;

  -- a content change (not attachments) makes the caller the last editor
  IF public.approval_row_content(to_jsonb(NEW), c_meta || c_files, c_money)
     IS DISTINCT FROM public.approval_row_content(to_jsonb(OLD), c_meta || c_files, c_money) THEN
    NEW.last_edited_by := v_uid;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_invoice_approval() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_petty_receipt_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_tr   record;
  v_jo   jsonb;
  v_maker uuid;
  c_meta CONSTANT text[] := ARRAY['status', 'approved_by', 'approved_at', 'cancelled_by', 'cancelled_at',
                                  'cancellation_reason', 'last_edited_by', 'notes'];
  c_files CONSTANT text[] := ARRAY['attachment_path', 'attachment_name'];
  c_money CONSTANT text[] := ARRAY['amount'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NULL THEN
      IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
      RETURN NEW;
    END IF;
    IF NEW.status IN ('approved', 'cancelled') THEN
      RAISE EXCEPTION 'A petty cash receipt is logged as pending — it is approved separately' USING ERRCODE = '42501';
    END IF;
    -- creator stamped by the database (a trash restore keeps the original one)
    SELECT * INTO v_tr FROM public.trash_original_creator('cash_advance_receipts', NEW.id);
    NEW.created_by := CASE WHEN v_tr.found THEN v_tr.created_by ELSE v_uid END;
    NEW.last_edited_by := v_uid;
    NEW.approved_by := NULL; NEW.approved_at := NULL;
    NEW.cancelled_by := NULL; NEW.cancelled_at := NULL; NEW.cancellation_reason := NULL;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN RETURN NEW; END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'cash_advance_receipts: created_by cannot be changed' USING ERRCODE = '42501';
  END IF;
  NEW.last_edited_by := OLD.last_edited_by;     -- written by the database only

  IF OLD.status IN ('approved', 'cancelled') THEN
    v_jo := to_jsonb(OLD);
    IF public.petty_receipt_lock_view(to_jsonb(NEW)) IS DISTINCT FROM public.petty_receipt_lock_view(v_jo) THEN
      RAISE EXCEPTION 'An approved petty cash receipt cannot be changed — cancel it and log a new one'
        USING ERRCODE = '42501';
    END IF;
    -- keep the stored values (an untouched legacy amount is never rounded here)
    NEW := jsonb_populate_record(NEW, (SELECT jsonb_object_agg(k, v_jo->k)
                                         FROM jsonb_object_keys(public.petty_receipt_lock_view(v_jo)) k));
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
      IF public.approval_row_content(to_jsonb(NEW), c_meta, c_money)
         IS DISTINCT FROM public.approval_row_content(to_jsonb(OLD), c_meta, c_money) THEN
        RAISE EXCEPTION 'Maker-checker: approve or reject the receipt as logged — save changes separately'
          USING ERRCODE = '42501';
      END IF;
      v_maker := COALESCE(OLD.created_by, OLD.submitted_by);   -- submitted_by: rows logged before 201
      IF (v_maker IS NOT NULL AND v_maker = v_uid)
         OR (OLD.last_edited_by IS NOT NULL AND OLD.last_edited_by = v_uid) THEN
        RAISE EXCEPTION 'Maker-checker: a petty cash receipt must be approved or rejected by someone other than the person who logged or last changed it'
          USING ERRCODE = '42501';
      END IF;
      IF NOT public.can_approve_petty_receipt(OLD.project_id) THEN
        RAISE EXCEPTION 'Only a petty cash approver of this project can approve or reject receipts' USING ERRCODE = '42501';
      END IF;
      IF NEW.status = 'approved' THEN
        NEW.approved_by := v_uid; NEW.approved_at := now();
      ELSE
        NEW.approved_by := NULL; NEW.approved_at := NULL;
      END IF;
      RETURN NEW;
    ELSIF OLD.status = 'rejected' AND NEW.status = 'pending' THEN
      NULL;
    ELSIF OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
      IF NOT (public.is_super_admin(v_uid)
              OR public.is_org_admin(v_uid, (SELECT p.organization_id FROM public.projects p WHERE p.id = OLD.project_id))
              OR OLD.approved_by = v_uid) THEN
        RAISE EXCEPTION 'Only an organization admin or the approver can cancel an approved receipt' USING ERRCODE = '42501';
      END IF;
      IF NULLIF(btrim(COALESCE(NEW.cancellation_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'A reason is required to cancel an approved receipt' USING ERRCODE = '22023';
      END IF;
      -- like cancel_invoice: not once money moved against it
      -- 204: net of refunds
      IF COALESCE((SELECT sum(pm.amount) FROM public.payments pm
                    WHERE pm.source_type IN ('receipt', 'cash_advance_receipt') AND pm.source_id = OLD.id), 0) > 0 THEN
        RAISE EXCEPTION 'This receipt has payments — it cannot be cancelled (record a refund instead)' USING ERRCODE = '42501';
      END IF;
      IF EXISTS (SELECT 1 FROM public.payment_requests r
                  WHERE r.source_type IN ('receipt', 'cash_advance_receipt') AND r.source_id = OLD.id
                    AND r.status NOT IN ('rejected', 'cancelled')
                    AND r.reversed_at IS NULL) THEN                          -- 204
        RAISE EXCEPTION 'Cancel or reject the payment request of this receipt first' USING ERRCODE = '42501';
      END IF;
      NEW.cancellation_reason := btrim(NEW.cancellation_reason);
      NEW.cancelled_by := v_uid; NEW.cancelled_at := now();
      NEW.approved_by := OLD.approved_by; NEW.approved_at := OLD.approved_at;
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'A petty cash receipt cannot go from % to % (an approved receipt is cancelled, not reopened)',
        OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
  ELSE
    NEW.approved_by := OLD.approved_by;   NEW.approved_at := OLD.approved_at;
    NEW.cancelled_by := OLD.cancelled_by; NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancellation_reason := OLD.cancellation_reason;
  END IF;

  IF public.approval_row_content(to_jsonb(NEW), c_meta || c_files, c_money)
     IS DISTINCT FROM public.approval_row_content(to_jsonb(OLD), c_meta || c_files, c_money) THEN
    NEW.last_edited_by := v_uid;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_petty_receipt_approval() FROM PUBLIC, anon, authenticated;


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
  -- 204: CASE, so the cast only runs on a value that matched the pattern
  -- (AND / OR do not fix the evaluation order)
  IF NEW.key = 'payment_board_approval_above_sar' AND NEW.value IS NOT NULL
     AND (CASE WHEN NEW.value ~ '^[0-9]+(\.[0-9]{1,2})?$' THEN NEW.value::numeric <= 0 ELSE true END) THEN
    RAISE EXCEPTION 'platform_settings: the approval limit must be a positive amount or NULL'
      USING ERRCODE = '22023';
  END IF;
  -- 204
  IF NEW.key = 'platform_base_currency' AND COALESCE(NEW.value, '') !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'platform_settings: the base currency must be a 3-letter code' USING ERRCODE = '22023';
  END IF;
  IF NEW.key IN ('fx_usd_to_base', 'fx_eur_to_base', 'fx_aed_to_base')
     AND (CASE WHEN COALESCE(NEW.value, '') ~ '^[0-9]+(\.[0-9]{1,6})?$' THEN NEW.value::numeric <= 0 ELSE true END) THEN
    RAISE EXCEPTION 'platform_settings: an exchange rate must be a positive number' USING ERRCODE = '22023';
  END IF;
  IF NEW.key IN ('default_wht_rate_pct', 'vat_standard_rate_pct')
     AND (CASE WHEN COALESCE(NEW.value, '') ~ '^[0-9]+(\.[0-9]{1,2})?$' THEN NEW.value::numeric >= 100 ELSE true END) THEN
    RAISE EXCEPTION 'platform_settings: a tax rate must be between 0 and 99.99 percent' USING ERRCODE = '22023';
  END IF;
  IF NEW.key = 'fiscal_year_start'
     AND (COALESCE(NEW.value, '') !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$') THEN
    RAISE EXCEPTION 'platform_settings: the fiscal year start must be MM-DD' USING ERRCODE = '22023';
  END IF;
  IF NEW.key = 'default_project_limit'
     AND (CASE WHEN COALESCE(NEW.value, '') ~ '^[0-9]{1,5}$' THEN NEW.value::int < 1 ELSE true END) THEN
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
  -- 204: bounded size, and the stored lines are rebuilt from the known keys
  -- only (anything else a client sends is dropped)
  IF jsonb_typeof(NEW.lines) IS DISTINCT FROM 'array' OR octet_length(NEW.lines::text) > 4000000 THEN
    RAISE EXCEPTION 'budget_templates: the lines must be a list of at most 4 MB' USING ERRCODE = '22023';
  END IF;
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
  NEW.lines := COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'group',       e->>'group',
             'header_code', e->>'header_code',
             'header_name', btrim(COALESCE(e->>'header_name', '')),
             'code',        e->>'code',
             'description', btrim(COALESCE(e->>'description', ''))) ORDER BY o)
      FROM jsonb_array_elements(NEW.lines) WITH ORDINALITY t(e, o)), '[]'::jsonb);
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
