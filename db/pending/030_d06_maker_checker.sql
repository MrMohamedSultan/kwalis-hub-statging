-- =====================================================================
-- D06 — Maker–Checker on payment requests, enforced by the database
--
-- Today the approval is a plain UPDATE from the browser; nothing stops the
-- person who raised a request from approving it. This trigger refuses that
-- at the row level, whatever client issues the UPDATE.
--
-- Rules (apply to signed-in users; service_role / SQL editor are not blocked):
--   * approving  (-> 'approved'): approver must not be the requester.
--                 approved_by / approved_at are stamped by the database.
--   * rejecting  (-> 'rejected'): rejected_by / rejected_at are stamped.
--   * paying     (-> 'paid'):     only from 'approved'; executed_by / executed_at
--                 are stamped. The requester MAY execute (an accountant who
--                 raised the request usually makes the transfer once someone
--                 else approved it) — the control is on the approval.
--   * once approved, paid or rejected, the money fields are frozen.
--
-- Adds one function and one trigger. No table, column or policy is changed.
--
-- NOT covered here (needs a product decision + Roles UI): a separate
-- "Approve" permission in the role matrix. Who may approve is still decided
-- by the existing UPDATE policy (org admin / super admin).
--
-- Rollback:
--   DROP TRIGGER  trg_payment_request_maker_checker ON public.payment_requests;
--   DROP FUNCTION public.enforce_payment_request_maker_checker();
-- =====================================================================
CREATE OR REPLACE FUNCTION public.enforce_payment_request_maker_checker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Server-side jobs and SQL editor sessions have no end-user identity.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- The requester of record never changes.
  IF NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'payment_requests: requested_by cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  -- Decided requests: amounts and source are frozen.
  IF OLD.status IN ('approved', 'paid', 'rejected')
     AND (NEW.requested_amount IS DISTINCT FROM OLD.requested_amount
       OR NEW.total_amount     IS DISTINCT FROM OLD.total_amount
       OR NEW.source_type      IS DISTINCT FROM OLD.source_type
       OR NEW.source_id        IS DISTINCT FROM OLD.source_id
       OR NEW.project_id       IS DISTINCT FROM OLD.project_id
       OR NEW.organization_id  IS DISTINCT FROM OLD.organization_id) THEN
    RAISE EXCEPTION 'payment_requests: a % request can no longer be edited', OLD.status
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'approved' THEN
      IF OLD.status <> 'waiting_approval' THEN
        RAISE EXCEPTION 'payment_requests: only a request waiting for approval can be approved'
          USING ERRCODE = '42501';
      END IF;
      IF v_uid = OLD.requested_by THEN
        RAISE EXCEPTION 'Maker-checker: you cannot approve a payment request you raised yourself'
          USING ERRCODE = '42501';
      END IF;
      NEW.approved_by := v_uid;
      NEW.approved_at := now();

    ELSIF NEW.status = 'rejected' THEN
      NEW.rejected_by := v_uid;
      NEW.rejected_at := now();

    ELSIF NEW.status = 'paid' THEN
      IF OLD.status <> 'approved' THEN
        RAISE EXCEPTION 'payment_requests: only an approved request can be marked paid'
          USING ERRCODE = '42501';
      END IF;
      NEW.executed_by := v_uid;
      NEW.executed_at := now();
    END IF;
  ELSE
    -- No status change: nobody rewrites the approval trail by hand.
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.executed_by IS DISTINCT FROM OLD.executed_by
       OR NEW.executed_at IS DISTINCT FROM OLD.executed_at THEN
      RAISE EXCEPTION 'payment_requests: approval and execution stamps are set by the database'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_request_maker_checker
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_request_maker_checker();
