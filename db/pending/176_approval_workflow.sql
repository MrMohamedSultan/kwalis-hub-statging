-- =====================================================================
-- 176 — Approval workflow: one payment path, approval chain, maker-checker
--
-- Client test log 2026-10-27 (B12, B13, B21, D05, X08, X09, X10, X11).
--
-- B12  A contract was approved (Pending → Active) by the same user who
--      created it. Now refused by the database; the approver is stamped on
--      people.contract_approved_by / contract_approved_at.
--
-- B13  "Request payment" on a contract instalment only flipped the JSON
--      status to Hold; no payment_requests row existed, so Payment Approvals
--      never saw it, and an unapproved contract could be paid.
--      Now an instalment request IS a payment_requests row
--      (source_type 'payroll_row', source_id = payroll.id,
--       payroll_milestone_id = the instalment id). The request drives the
--      instalment: waiting → Hold, approved → Approved, paid → Paid (which the
--      160 trigger turns into the payments row), rejected/cancelled → Pending.
--      A request is refused while the contract is not Active, when the amount
--      is not the instalment amount, and when the instalment already has an
--      open request (unique index).
--      The instalment JSON can no longer be moved to Hold / Approved / Paid by
--      hand, and an instalment that has an open or paid request cannot be
--      removed or have its amount changed (X09); its status is preserved
--      when the contract form re-saves the schedule.
--
-- B21  Payroll Hub bulk runs inserted payroll rows already marked "Paid",
--      a second way to pay the same crew. Posting now goes through
--      post_payroll_run(): each line becomes a payroll row with ONE instalment
--      plus a waiting payment request — the same Payment Approvals → Paid path
--      as contract instalments. Base (timesheet) lines for a person who has a
--      contract instalment schedule in the same project are refused, so a
--      person cannot be paid through both. Setting a run to "posted" directly
--      is refused. reverse_payroll_run() cancels the run's open requests and
--      is refused once one of them is approved or paid.
--
-- D05 / X11  Approval chain per organization: public.payment_approval_levels
--      (level 1..5, label, minimum amount in SAR, who approves). A request
--      needs every level whose minimum is <= its SAR amount, in order, each
--      by a different person who is not the requester. Approvals are recorded
--      in public.payment_request_approvals. RPCs: approve_payment_request_step,
--      reject_payment_request_step (reason required), cancel_payment_request,
--      payment_request_chain_status (whose turn it is). Organizations with no
--      levels keep today's single approval by an org admin.
--      The next approvers and the requester are notified from the database.
--
-- X08  Approved / paid / cancelled requests can no longer be deleted; they
--      are cancelled instead (new status 'cancelled' with who / when / why).
--      A paid request cannot be cancelled (needs a refund entry — not here).
-- X09  Decided requests stay frozen (030); additionally the amount of a
--      waiting request is frozen once a chain level approved it, and
--      decided statuses cannot be moved back.
-- X10  Maker-checker on every chain level (requester never approves; one
--      person approves one level only).
--
-- Additive: new columns, tables, functions, triggers; three existing
-- functions are redefined (enforce_payment_request_maker_checker from 035,
-- enforce_payment_request_limit and revalidate_payment_request_on_submit from
-- the live schema, reverse_payroll_run from the live schema) — only the marked
-- lines change. The payment_requests status CHECK gains 'cancelled'.
-- No existing row is modified.
--
-- Session flags kwalis.milestone_sync / kwalis.posting_run are set only inside
-- the SECURITY DEFINER functions below (set_config is not reachable through
-- the Data API).
--
-- Depends on 030, 035, 160.
--
-- Rollback (in this order):
--   DROP TRIGGER trg_payment_request_validate_source ON public.payment_requests;
--   DROP TRIGGER trg_payment_request_sync_milestone ON public.payment_requests;
--   DROP TRIGGER trg_payment_request_notify ON public.payment_requests;
--   DROP TRIGGER trg_payment_request_keep_decided ON public.payment_requests;
--   DROP TRIGGER trg_payroll_milestone_guard ON public.payroll;
--   DROP TRIGGER trg_people_contract_maker_checker ON public.people;
--   DROP TRIGGER trg_payroll_run_post_via_rpc ON public.payroll_runs;
--   DROP FUNCTION public.approve_payment_request_step(uuid, text),
--     public.reject_payment_request_step(uuid, text), public.cancel_payment_request(uuid, text),
--     public.payment_request_chain_status(uuid, uuid), public.post_payroll_run(uuid),
--     public.payment_request_required_levels(uuid), public.payment_approver_matches(uuid, uuid, uuid, text, uuid),
--     public.payment_request_amount_sar(numeric, text, uuid), public.payroll_milestone_amount(jsonb, numeric),
--     public.notify_payment_approvers(uuid), public.validate_payment_request_source(),
--     public.sync_milestone_from_payment_request(), public.notify_payment_request_change(),
--     public.keep_decided_payment_requests(), public.guard_payroll_milestones(),
--     public.enforce_contract_approval_maker_checker(), public.require_post_payroll_run_rpc();
--   re-run 035 (maker-checker function) and restore enforce_payment_request_limit /
--   revalidate_payment_request_on_submit / reverse_payroll_run from the live schema;
--   DROP TABLE public.payment_request_approvals, public.payment_approval_levels;
--   (only if no row uses it) restore payment_requests_status_check without 'cancelled';
--   ALTER TABLE public.payment_requests DROP COLUMN payroll_milestone_id,
--     DROP COLUMN cancelled_by, DROP COLUMN cancelled_at, DROP COLUMN cancellation_reason;
--   ALTER TABLE public.people DROP COLUMN contract_approved_by, DROP COLUMN contract_approved_at;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
ALTER TABLE public.payment_requests ADD COLUMN IF NOT EXISTS payroll_milestone_id text;
ALTER TABLE public.payment_requests ADD COLUMN IF NOT EXISTS cancelled_by uuid;
ALTER TABLE public.payment_requests ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.payment_requests ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE public.payment_requests DROP CONSTRAINT IF EXISTS payment_requests_status_check;
ALTER TABLE public.payment_requests ADD CONSTRAINT payment_requests_status_check
  CHECK (status = ANY (ARRAY['draft', 'waiting_approval', 'approved', 'paid', 'rejected', 'cancelled']));
ALTER TABLE public.payment_requests DROP CONSTRAINT IF EXISTS payment_requests_cancellation_reason_len;
ALTER TABLE public.payment_requests ADD CONSTRAINT payment_requests_cancellation_reason_len
  CHECK (cancellation_reason IS NULL OR length(cancellation_reason) <= 1000);

-- one open (or paid) request per instalment
CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_open_milestone_key
  ON public.payment_requests (source_id, payroll_milestone_id)
  WHERE payroll_milestone_id IS NOT NULL AND status NOT IN ('rejected', 'cancelled');

ALTER TABLE public.people ADD COLUMN IF NOT EXISTS contract_approved_by uuid;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS contract_approved_at timestamptz;

-- ---------------------------------------------------------------------
-- 2. B12 — contract approval by someone other than its creator
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_contract_approval_maker_checker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN            -- service role / SQL editor / seeds
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.contract_status = 'Active' THEN
      RAISE EXCEPTION 'Maker-checker: a new contract cannot start as Active — another user must approve it'
        USING ERRCODE = '42501';
    END IF;
    NEW.contract_approved_by := NULL;
    NEW.contract_approved_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.contract_status = 'Active' AND OLD.contract_status IS DISTINCT FROM 'Active' THEN
    IF OLD.created_by IS NOT NULL AND OLD.created_by = v_uid THEN
      RAISE EXCEPTION 'Maker-checker: a contract must be approved by someone other than the person who created it'
        USING ERRCODE = '42501';
    END IF;
    NEW.contract_approved_by := v_uid;
    NEW.contract_approved_at := now();
  ELSIF NEW.contract_status IS DISTINCT FROM 'Active' THEN
    NEW.contract_approved_by := NULL;
    NEW.contract_approved_at := NULL;
  ELSE
    -- still Active: the approval stamp is not editable by hand
    NEW.contract_approved_by := OLD.contract_approved_by;
    NEW.contract_approved_at := OLD.contract_approved_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_people_contract_maker_checker ON public.people;
CREATE TRIGGER trg_people_contract_maker_checker
  BEFORE INSERT OR UPDATE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contract_approval_maker_checker();

-- ---------------------------------------------------------------------
-- 3. Small helpers
-- ---------------------------------------------------------------------
-- Instalment amount: flat amount when set, else percent of the contract base.
CREATE OR REPLACE FUNCTION public.payroll_milestone_amount(m jsonb, base numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT round(COALESCE(NULLIF(m->>'amount', '')::numeric,
                        COALESCE(base, 0) * COALESCE(NULLIF(m->>'percent', '')::numeric, 0) / 100), 2)
$$;

-- Request amount in SAR: SAR as is; the project currency at the project's
-- locked rate; anything else unconverted.
CREATE OR REPLACE FUNCTION public.payment_request_amount_sar(_amount numeric, _currency text, _project uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(CASE
    WHEN upper(COALESCE(NULLIF(_currency, ''), 'SAR')) = 'SAR' THEN _amount
    ELSE _amount * COALESCE((SELECT NULLIF(p.fx_rate, 0) FROM public.projects p
                              WHERE p.id = _project AND upper(p.currency) = upper(_currency)), 1)
  END, 2)
$$;

-- ---------------------------------------------------------------------
-- 4. D05 / X11 — approval chain configuration and approvals
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_approval_levels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  level_no        smallint NOT NULL CHECK (level_no BETWEEN 1 AND 5),
  label           text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  min_amount_sar  numeric(14,2) NOT NULL DEFAULT 0 CHECK (min_amount_sar >= 0),
  approver_kind   text NOT NULL CHECK (approver_kind IN ('org_admin', 'org_owner', 'project_executive', 'role')),
  role_id         uuid REFERENCES public.roles(id) ON DELETE CASCADE,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_approval_levels_unique UNIQUE (organization_id, level_no),
  CONSTRAINT payment_approval_levels_role CHECK ((approver_kind = 'role') = (role_id IS NOT NULL))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_approval_levels TO authenticated;
GRANT ALL ON public.payment_approval_levels TO service_role;
REVOKE ALL ON public.payment_approval_levels FROM anon;
ALTER TABLE public.payment_approval_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members read approval levels" ON public.payment_approval_levels;
CREATE POLICY "Org members read approval levels" ON public.payment_approval_levels
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org admins insert approval levels" ON public.payment_approval_levels;
CREATE POLICY "Org admins insert approval levels" ON public.payment_approval_levels
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org admins update approval levels" ON public.payment_approval_levels;
CREATE POLICY "Org admins update approval levels" ON public.payment_approval_levels
  FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id))
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org admins delete approval levels" ON public.payment_approval_levels;
CREATE POLICY "Org admins delete approval levels" ON public.payment_approval_levels
  FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id));

-- a 'role' level must name a role of the same organization (or a system role)
CREATE OR REPLACE FUNCTION public.stamp_payment_approval_level()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.role_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.roles r
        WHERE r.id = NEW.role_id
          AND (r.organization_id IS NULL OR r.organization_id = NEW.organization_id)) THEN
    RAISE EXCEPTION 'payment_approval_levels: the role does not belong to this organization'
      USING ERRCODE = '22023';
  END IF;
  NEW.label := btrim(NEW.label);
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  ELSE
    NEW.organization_id := OLD.organization_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_payment_approval_level ON public.payment_approval_levels;
CREATE TRIGGER trg_stamp_payment_approval_level
  BEFORE INSERT OR UPDATE ON public.payment_approval_levels
  FOR EACH ROW EXECUTE FUNCTION public.stamp_payment_approval_level();
DROP TRIGGER IF EXISTS trg_audit_history_payment_approval_levels ON public.payment_approval_levels;
CREATE TRIGGER trg_audit_history_payment_approval_levels
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_approval_levels
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

CREATE TABLE IF NOT EXISTS public.payment_request_approvals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES public.payment_requests(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL,
  project_id         uuid,
  level_no           smallint NOT NULL,
  level_label        text NOT NULL,
  approved_by        uuid NOT NULL,
  approved_at        timestamptz NOT NULL DEFAULT now(),
  note               text CHECK (note IS NULL OR length(note) <= 1000),
  CONSTRAINT payment_request_approvals_level_once UNIQUE (payment_request_id, level_no),
  CONSTRAINT payment_request_approvals_person_once UNIQUE (payment_request_id, approved_by)
);
CREATE INDEX IF NOT EXISTS payment_request_approvals_org_idx
  ON public.payment_request_approvals (organization_id);
GRANT SELECT ON public.payment_request_approvals TO authenticated;   -- written only through the RPC
GRANT ALL ON public.payment_request_approvals TO service_role;
REVOKE ALL ON public.payment_request_approvals FROM anon;
ALTER TABLE public.payment_request_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members read request approvals" ON public.payment_request_approvals;
CREATE POLICY "Org members read request approvals" ON public.payment_request_approvals
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_member(auth.uid(), organization_id));
DROP TRIGGER IF EXISTS trg_audit_history_payment_request_approvals ON public.payment_request_approvals;
CREATE TRIGGER trg_audit_history_payment_request_approvals
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_request_approvals
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- Can this user act for a level of this kind?
CREATE OR REPLACE FUNCTION public.payment_approver_matches(_uid uuid, _org uuid, _project uuid, _kind text, _role uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.is_super_admin(_uid)
    OR CASE _kind
         WHEN 'org_admin' THEN public.is_org_admin(_uid, _org)
         WHEN 'org_owner' THEN public.is_org_owner(_uid, _org)
         WHEN 'project_executive' THEN public.is_org_owner(_uid, _org)
              OR EXISTS (SELECT 1 FROM public.project_members pm
                          WHERE pm.project_id = _project AND pm.user_id = _uid
                            AND pm.executive_title IS NOT NULL)
         WHEN 'role' THEN public.is_org_member(_uid, _org) AND EXISTS (
              SELECT 1 FROM public.user_role_assignments ura
               WHERE ura.user_id = _uid AND ura.role_id = _role
                 AND (ura.organization_id IS NULL OR ura.organization_id = _org)
                 AND (ura.project_id IS NULL OR ura.project_id = _project))
         ELSE false
       END)
$$;

-- The levels a request needs, in order (empty = single admin approval).
CREATE OR REPLACE FUNCTION public.payment_request_required_levels(_request uuid)
RETURNS TABLE (level_no smallint, label text, approver_kind text, role_id uuid, min_amount_sar numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.level_no, l.label, l.approver_kind, l.role_id, l.min_amount_sar
    FROM public.payment_requests pr
    JOIN public.payment_approval_levels l ON l.organization_id = pr.organization_id
   WHERE pr.id = _request
     AND (auth.uid() IS NULL OR public.is_super_admin(auth.uid())
          OR public.is_org_member(auth.uid(), pr.organization_id))
     AND l.min_amount_sar <= public.payment_request_amount_sar(pr.requested_amount, pr.currency, pr.project_id)
   ORDER BY l.level_no
$$;

-- Notify whoever can act on the next level (org admins when there is no chain).
CREATE OR REPLACE FUNCTION public.notify_payment_approvers(_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       public.payment_requests%ROWTYPE;
  v_has   boolean;
  v_level smallint;
  v_label text;
  v_kind  text;
  v_role  uuid;
BEGIN
  SELECT * INTO r FROM public.payment_requests WHERE id = _request;
  IF NOT FOUND OR r.status <> 'waiting_approval' THEN RETURN; END IF;
  SELECT EXISTS (SELECT 1 FROM public.payment_request_required_levels(r.id)) INTO v_has;
  IF v_has THEN
    SELECT l.level_no, l.label, l.approver_kind, l.role_id INTO v_level, v_label, v_kind, v_role
      FROM public.payment_request_required_levels(r.id) l
     WHERE NOT EXISTS (SELECT 1 FROM public.payment_request_approvals a
                        WHERE a.payment_request_id = r.id AND a.level_no = l.level_no)
     ORDER BY l.level_no LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;
  INSERT INTO public.notifications (organization_id, project_id, user_id, severity, category, title, body, metadata)
  SELECT r.organization_id, r.project_id, om.user_id, 'info', 'payment_approval',
         'Payment request awaiting your approval',
         COALESCE(r.source_label, r.source_type) || ' — ' || r.currency || ' ' || to_char(r.requested_amount, 'FM999,999,999,990.00'),
         jsonb_build_object('payment_request_id', r.id, 'source_type', r.source_type, 'source_id', r.source_id,
                            'status', 'waiting_approval', 'level', v_level, 'level_label', v_label)
    FROM public.organization_members om
   WHERE om.organization_id = r.organization_id
     AND om.user_id IS DISTINCT FROM r.requested_by
     AND CASE WHEN v_has
              THEN public.payment_approver_matches(om.user_id, r.organization_id, r.project_id, v_kind, v_role)
                   AND NOT EXISTS (SELECT 1 FROM public.payment_request_approvals a
                                    WHERE a.payment_request_id = r.id AND a.approved_by = om.user_id)
              ELSE om.role IN ('owner', 'admin') END;
END $$;

-- ---------------------------------------------------------------------
-- 5. Maker-checker trigger (copy of 035; changes marked "176")
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_payment_request_maker_checker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit numeric;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'payment_requests: requested_by cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  -- 176: the instalment link never changes
  IF NEW.payroll_milestone_id IS DISTINCT FROM OLD.payroll_milestone_id THEN
    RAISE EXCEPTION 'payment_requests: the linked instalment cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status IN ('approved', 'paid', 'rejected', 'cancelled')          -- 176: + cancelled
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
    -- 176: decided statuses never move back
    IF OLD.status IN ('paid', 'rejected', 'cancelled')
       OR (OLD.status = 'approved' AND NEW.status NOT IN ('paid', 'cancelled'))
       OR NEW.status = 'draft'
       OR (NEW.status = 'waiting_approval' AND OLD.status <> 'draft') THEN
      RAISE EXCEPTION 'payment_requests: a % request cannot be moved to %', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status = 'approved' THEN
      IF OLD.status <> 'waiting_approval' THEN
        RAISE EXCEPTION 'payment_requests: only a request waiting for approval can be approved'
          USING ERRCODE = '42501';
      END IF;
      IF v_uid = OLD.requested_by THEN
        RAISE EXCEPTION 'Maker-checker: you cannot approve a payment request you raised yourself'
          USING ERRCODE = '42501';
      END IF;

      -- 176: every chain level that applies to this amount must be approved
      IF EXISTS (SELECT 1 FROM public.payment_request_required_levels(OLD.id) l
                  WHERE NOT EXISTS (SELECT 1 FROM public.payment_request_approvals a
                                     WHERE a.payment_request_id = OLD.id AND a.level_no = l.level_no)) THEN
        RAISE EXCEPTION 'Approval chain: every approval level must approve this request first (use the Approve action on Payment Approvals)'
          USING ERRCODE = '42501';
      END IF;

      -- D09: above the configured limit a separate board approval must exist,
      -- given by someone other than the requester and other than this approver.
      v_limit := public.payment_board_approval_limit();
      IF v_limit IS NOT NULL AND NEW.requested_amount > v_limit
         AND NOT EXISTS (SELECT 1 FROM public.payment_request_board_approvals b
                         WHERE b.payment_request_id = OLD.id
                           AND b.approved_by <> OLD.requested_by
                           AND b.approved_by <> v_uid) THEN
        RAISE EXCEPTION 'Board approval required: requests above % SAR need an additional approval from the organization owner or a project executive before they can be approved', v_limit
          USING ERRCODE = '42501';
      END IF;

      NEW.approved_by := v_uid;
      NEW.approved_at := now();

    ELSIF NEW.status = 'rejected' THEN
      IF OLD.status <> 'waiting_approval' THEN                              -- 176
        RAISE EXCEPTION 'payment_requests: only a request waiting for approval can be rejected'
          USING ERRCODE = '42501';
      END IF;
      NEW.rejected_by := v_uid;
      NEW.rejected_at := now();

    ELSIF NEW.status = 'paid' THEN
      IF OLD.status <> 'approved' THEN
        RAISE EXCEPTION 'payment_requests: only an approved request can be marked paid'
          USING ERRCODE = '42501';
      END IF;
      NEW.executed_by := v_uid;
      NEW.executed_at := now();

    ELSIF NEW.status = 'cancelled' THEN                                     -- 176
      NEW.cancelled_by := v_uid;
      NEW.cancelled_at := now();
    END IF;
  ELSE
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.executed_by IS DISTINCT FROM OLD.executed_by
       OR NEW.executed_at IS DISTINCT FROM OLD.executed_at
       OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by                -- 176
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN           -- 176
      RAISE EXCEPTION 'payment_requests: approval and execution stamps are set by the database'
        USING ERRCODE = '42501';
    END IF;
    -- D09: a board approval is given for a figure. Once it exists the amount
    -- cannot be raised — reject the request and raise a new one instead.
    IF OLD.status = 'waiting_approval' AND NEW.requested_amount > OLD.requested_amount
       AND EXISTS (SELECT 1 FROM public.payment_request_board_approvals b
                   WHERE b.payment_request_id = OLD.id) THEN
      RAISE EXCEPTION 'payment_requests: the amount cannot be increased after board approval was given'
        USING ERRCODE = '42501';
    END IF;
    -- 176 (X09): chain approvals are given for a figure too
    IF OLD.status = 'waiting_approval'
       AND (NEW.requested_amount IS DISTINCT FROM OLD.requested_amount
            OR NEW.currency IS DISTINCT FROM OLD.currency)
       AND EXISTS (SELECT 1 FROM public.payment_request_approvals a
                   WHERE a.payment_request_id = OLD.id) THEN
      RAISE EXCEPTION 'payment_requests: the amount cannot change after an approval level approved it — reject it and raise a new request'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 6. Live functions that count "active" requests: cancelled no longer counts
--    (copies of the live definitions; changed lines marked "176")
-- ---------------------------------------------------------------------
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
  IF NEW.status IN ('rejected', 'cancelled') THEN                          -- 176
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
-- 7. B13 — what a request may point at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_payment_request_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  p        public.payroll%ROWTYPE;
  m        jsonb;
  v_ref    text;
  v_status text;
  v_amt    numeric;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  -- on UPDATE only re-check when the request is sent for approval
  IF TG_OP = 'UPDATE' AND NOT (NEW.status = 'waiting_approval' AND OLD.status = 'draft') THEN
    RETURN NEW;
  END IF;

  IF NEW.source_type IN ('crew_contract', 'cast_contract') THEN
    v_ref := NEW.source_id::text;
  END IF;

  IF NEW.payroll_milestone_id IS NOT NULL THEN
    IF NEW.source_type <> 'payroll_row' THEN
      RAISE EXCEPTION 'payment_requests: an instalment request must point at its payroll row'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO p FROM public.payroll WHERE id = NEW.source_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment_requests: contract not found' USING ERRCODE = '22023';
    END IF;
    IF p.organization_id IS DISTINCT FROM NEW.organization_id OR p.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'payment_requests: the request and the contract belong to different projects'
        USING ERRCODE = '42501';
    END IF;
    SELECT e INTO m FROM jsonb_array_elements(COALESCE(p.payment_schedule, '[]'::jsonb)) e
     WHERE e->>'id' = NEW.payroll_milestone_id LIMIT 1;
    IF m IS NULL THEN
      RAISE EXCEPTION 'payment_requests: instalment % not found on this contract', NEW.payroll_milestone_id
        USING ERRCODE = '22023';
    END IF;
    IF TG_OP = 'INSERT' AND m->>'status' IN ('Approved', 'Paid') THEN
      RAISE EXCEPTION 'payment_requests: this instalment is already %', lower(m->>'status')
        USING ERRCODE = '22023';
    END IF;
    v_amt := public.payroll_milestone_amount(m, COALESCE(p.net_payable, p.total_amount));
    IF abs(v_amt - NEW.requested_amount) > 0.005 THEN
      RAISE EXCEPTION 'payment_requests: the request (%) must equal the instalment amount (%)', NEW.requested_amount, v_amt
        USING ERRCODE = '22023';
    END IF;
    v_ref := p.ref_id;
  ELSIF NEW.source_type = 'payroll_row' THEN
    SELECT ref_id INTO v_ref FROM public.payroll WHERE id = NEW.source_id;
  END IF;

  -- B13: no payment request while the contract is not approved
  IF v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT contract_status INTO v_status FROM public.people WHERE id = v_ref::uuid;
    IF NOT FOUND THEN
      SELECT contract_status INTO v_status FROM public.crew_members WHERE id = v_ref::uuid;
    END IF;
    IF FOUND AND v_status IS DISTINCT FROM 'Active' THEN
      RAISE EXCEPTION 'Contract not approved: a payment can be requested only after the contract is approved (status is %)', v_status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_request_validate_source ON public.payment_requests;
CREATE TRIGGER trg_payment_request_validate_source
  BEFORE INSERT OR UPDATE OF status ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_request_source();

-- ---------------------------------------------------------------------
-- 8. B13 — the request drives its instalment
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_milestone_from_payment_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        public.payment_requests%ROWTYPE;
  v_status text;
  v_patch  jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    IF r.payroll_milestone_id IS NULL OR r.status = 'paid' THEN RETURN OLD; END IF;
    v_status := 'Pending';
  ELSE
    r := NEW;
    IF r.payroll_milestone_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.payment_date IS NOT DISTINCT FROM OLD.payment_date
       AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method
       AND NEW.proof_path IS NOT DISTINCT FROM OLD.proof_path THEN
      RETURN NEW;
    END IF;
    v_status := CASE r.status
                  WHEN 'waiting_approval' THEN 'Hold'
                  WHEN 'approved' THEN 'Approved'
                  WHEN 'paid' THEN 'Paid'
                  ELSE 'Pending' END;                       -- draft / rejected / cancelled
  END IF;

  v_patch := jsonb_build_object('status', v_status);
  IF v_status = 'Paid' THEN
    v_patch := v_patch || jsonb_build_object(
      'paidDate', COALESCE(r.payment_date, r.executed_at::date, CURRENT_DATE)::text,
      'paymentMethod', r.payment_method,
      'proofPath', r.proof_path);
  ELSE
    v_patch := v_patch || jsonb_build_object('paidDate', NULL, 'paymentMethod', NULL, 'proofPath', NULL);
  END IF;

  PERFORM set_config('kwalis.milestone_sync', r.id::text, true);
  UPDATE public.payroll p
     SET payment_schedule = (
           SELECT COALESCE(jsonb_agg(CASE WHEN e->>'id' = r.payroll_milestone_id THEN e || v_patch ELSE e END
                                     ORDER BY ord), '[]'::jsonb)
             FROM jsonb_array_elements(p.payment_schedule) WITH ORDINALITY AS t(e, ord))
   WHERE p.id = r.source_id;
  PERFORM set_config('kwalis.milestone_sync', '', true);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_milestone_from_payment_request() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payment_request_sync_milestone ON public.payment_requests;
CREATE TRIGGER trg_payment_request_sync_milestone
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_milestone_from_payment_request();

-- ---------------------------------------------------------------------
-- 9. B13 / B21 / X09 — the instalment JSON follows the request, not the hand
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_payroll_milestones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_base numeric;
  v_new_base numeric;
  o          jsonb;
  n          jsonb;
  pr         record;
  v_out      jsonb := '[]'::jsonb;
  v_old      jsonb;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(current_setting('kwalis.milestone_sync', true), '') <> '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.payment_schedule, '[]'::jsonb)) e
                WHERE e->>'status' IN ('Hold', 'Approved', 'Paid')) THEN
      RAISE EXCEPTION 'Instalments start as Pending: request payment from the payables screen, it is approved and paid on Payment Approvals'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_old_base := COALESCE(OLD.net_payable, OLD.total_amount);
  v_new_base := COALESCE(NEW.net_payable, NEW.total_amount);

  -- instalments that have an open or paid request
  FOR pr IN
    SELECT q.payroll_milestone_id AS mid, q.status
      FROM public.payment_requests q
     WHERE q.source_type = 'payroll_row' AND q.source_id = OLD.id
       AND q.payroll_milestone_id IS NOT NULL
       AND q.status IN ('draft', 'waiting_approval', 'approved', 'paid')
  LOOP
    SELECT e INTO o FROM jsonb_array_elements(COALESCE(OLD.payment_schedule, '[]'::jsonb)) e
     WHERE e->>'id' = pr.mid LIMIT 1;
    CONTINUE WHEN o IS NULL;
    SELECT e INTO n FROM jsonb_array_elements(COALESCE(NEW.payment_schedule, '[]'::jsonb)) e
     WHERE e->>'id' = pr.mid LIMIT 1;
    IF n IS NULL THEN
      RAISE EXCEPTION 'Instalment "%" has a % payment request and cannot be removed — cancel or reject the request first',
        COALESCE(o->>'label', pr.mid), replace(pr.status, '_', ' ')
        USING ERRCODE = '42501';
    END IF;
    IF public.payroll_milestone_amount(n, v_new_base) IS DISTINCT FROM public.payroll_milestone_amount(o, v_old_base) THEN
      RAISE EXCEPTION 'Instalment "%" has a % payment request — its amount cannot change. Cancel or reject the request first',
        COALESCE(o->>'label', pr.mid), replace(pr.status, '_', ' ')
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- rebuild: statuses of linked instalments are kept; manual moves to
  -- Hold / Approved / Paid are refused
  FOR n IN SELECT e FROM jsonb_array_elements(COALESCE(NEW.payment_schedule, '[]'::jsonb)) WITH ORDINALITY t(e, ord) ORDER BY ord LOOP
    SELECT e INTO v_old FROM jsonb_array_elements(COALESCE(OLD.payment_schedule, '[]'::jsonb)) e
     WHERE e->>'id' = n->>'id' LIMIT 1;
    IF EXISTS (SELECT 1 FROM public.payment_requests q
                WHERE q.source_type = 'payroll_row' AND q.source_id = OLD.id
                  AND q.payroll_milestone_id = n->>'id'
                  AND q.status IN ('draft', 'waiting_approval', 'approved', 'paid')) THEN
      n := n || jsonb_build_object('status', v_old->'status', 'paidDate', v_old->'paidDate',
                                   'paymentMethod', v_old->'paymentMethod', 'proofPath', v_old->'proofPath');
    ELSIF n->>'status' IN ('Hold', 'Approved', 'Paid')
          AND n->>'status' IS DISTINCT FROM v_old->>'status' THEN
      RAISE EXCEPTION 'Instalment "%": request payment from the payables screen — it is approved and paid on Payment Approvals',
        COALESCE(n->>'label', n->>'id')
        USING ERRCODE = '42501';
    END IF;
    v_out := v_out || jsonb_build_array(n);
  END LOOP;
  NEW.payment_schedule := v_out;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_payroll_milestones() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payroll_milestone_guard ON public.payroll;
CREATE TRIGGER trg_payroll_milestone_guard
  BEFORE INSERT OR UPDATE OF payment_schedule, total_amount, net_payable ON public.payroll
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_milestones();

-- ---------------------------------------------------------------------
-- 10. X08 — decided requests are cancelled, never deleted
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.keep_decided_payment_requests()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND OLD.status IN ('approved', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'A % payment request is part of the record and cannot be deleted — cancel it instead', OLD.status
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_payment_request_keep_decided ON public.payment_requests;
CREATE TRIGGER trg_payment_request_keep_decided
  BEFORE DELETE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.keep_decided_payment_requests();

-- ---------------------------------------------------------------------
-- 11. Notifications from the database (approvers on submit, requester on decision)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_payment_request_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'waiting_approval' THEN
    PERFORM public.notify_payment_approvers(NEW.id);
  ELSIF NEW.status IN ('approved', 'rejected', 'paid', 'cancelled')
        AND NEW.requested_by IS NOT NULL
        AND NEW.requested_by IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (organization_id, project_id, user_id, severity, category, title, body, metadata)
    VALUES (NEW.organization_id, NEW.project_id, NEW.requested_by,
            CASE WHEN NEW.status IN ('rejected', 'cancelled') THEN 'warning' ELSE 'info' END,
            'payment_approval',
            CASE NEW.status WHEN 'approved' THEN 'Your payment request was approved'
                            WHEN 'rejected' THEN 'Your payment request was rejected'
                            WHEN 'paid' THEN 'Your payment was executed'
                            ELSE 'Your payment request was cancelled' END,
            COALESCE(NEW.source_label, NEW.source_type) || ' — ' || NEW.currency || ' '
              || to_char(NEW.requested_amount, 'FM999,999,999,990.00')
              || COALESCE(' · Reason: ' || COALESCE(NEW.rejection_reason, NEW.cancellation_reason), ''),
            jsonb_build_object('payment_request_id', NEW.id, 'source_type', NEW.source_type,
                               'source_id', NEW.source_id, 'status', NEW.status,
                               'rejection_reason', COALESCE(NEW.rejection_reason, NEW.cancellation_reason)));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_payment_request_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payment_request_notify ON public.payment_requests;
CREATE TRIGGER trg_payment_request_notify
  AFTER INSERT OR UPDATE OF status ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_payment_request_change();

-- ---------------------------------------------------------------------
-- 12. RPCs used by the Payment Approvals screen
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_payment_request_step(_request uuid, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  r      public.payment_requests%ROWTYPE;
  n      record;
  v_has  boolean;
  v_more boolean;
  v_lvl  smallint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'approve_payment_request_step: not signed in' USING ERRCODE = '42501';
  END IF;
  IF _note IS NOT NULL AND length(_note) > 1000 THEN
    RAISE EXCEPTION 'approve_payment_request_step: the note is too long' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.payment_requests WHERE id = _request FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_super_admin(v_uid) OR public.is_org_member(v_uid, r.organization_id)) THEN
    RAISE EXCEPTION 'approve_payment_request_step: request not found' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'waiting_approval' THEN
    RAISE EXCEPTION 'Only a request waiting for approval can be approved' USING ERRCODE = '42501';
  END IF;
  IF v_uid = r.requested_by THEN
    RAISE EXCEPTION 'Maker-checker: you cannot approve a payment request you raised yourself'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.payment_request_required_levels(r.id)) INTO v_has;
  IF NOT v_has THEN
    IF NOT (public.is_super_admin(v_uid) OR public.is_org_admin(v_uid, r.organization_id)) THEN
      RAISE EXCEPTION 'Only an organization admin can approve payment requests' USING ERRCODE = '42501';
    END IF;
    UPDATE public.payment_requests SET status = 'approved' WHERE id = r.id;
    RETURN jsonb_build_object('status', 'approved');
  END IF;

  SELECT l.* INTO n FROM public.payment_request_required_levels(r.id) l
   WHERE NOT EXISTS (SELECT 1 FROM public.payment_request_approvals a
                      WHERE a.payment_request_id = r.id AND a.level_no = l.level_no)
   ORDER BY l.level_no LIMIT 1;
  IF FOUND THEN
    IF NOT public.payment_approver_matches(v_uid, r.organization_id, r.project_id, n.approver_kind, n.role_id) THEN
      RAISE EXCEPTION 'Not your turn: level % (%) must approve this request next', n.level_no, n.label
        USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.payment_request_approvals a
                WHERE a.payment_request_id = r.id AND a.approved_by = v_uid) THEN
      RAISE EXCEPTION 'Maker-checker: each approval level must be approved by a different person'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.payment_request_approvals
      (payment_request_id, organization_id, project_id, level_no, level_label, approved_by, note)
    VALUES (r.id, r.organization_id, r.project_id, n.level_no, n.label, v_uid, NULLIF(btrim(_note), ''));
    v_lvl := n.level_no;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.payment_request_required_levels(r.id) l
                  WHERE NOT EXISTS (SELECT 1 FROM public.payment_request_approvals a
                                     WHERE a.payment_request_id = r.id AND a.level_no = l.level_no))
    INTO v_more;
  IF v_more THEN
    PERFORM public.notify_payment_approvers(r.id);
    RETURN jsonb_build_object('status', 'waiting_approval', 'approved_level', v_lvl);
  END IF;
  UPDATE public.payment_requests SET status = 'approved' WHERE id = r.id;
  RETURN jsonb_build_object('status', 'approved', 'approved_level', v_lvl);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_payment_request_step(_request uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_reason text := btrim(COALESCE(_reason, ''));
  r        public.payment_requests%ROWTYPE;
  n        record;
  v_ok     boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'reject_payment_request_step: not signed in' USING ERRCODE = '42501';
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'A rejection needs a reason (3 to 1000 characters)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.payment_requests WHERE id = _request FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_super_admin(v_uid) OR public.is_org_member(v_uid, r.organization_id)) THEN
    RAISE EXCEPTION 'reject_payment_request_step: request not found' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'waiting_approval' THEN
    RAISE EXCEPTION 'Only a request waiting for approval can be rejected' USING ERRCODE = '42501';
  END IF;
  IF v_uid = r.requested_by THEN
    RAISE EXCEPTION 'You cannot reject your own request — cancel it instead' USING ERRCODE = '42501';
  END IF;
  v_ok := public.is_super_admin(v_uid) OR public.is_org_admin(v_uid, r.organization_id);
  IF NOT v_ok THEN
    SELECT l.* INTO n FROM public.payment_request_required_levels(r.id) l
     WHERE NOT EXISTS (SELECT 1 FROM public.payment_request_approvals a
                        WHERE a.payment_request_id = r.id AND a.level_no = l.level_no)
     ORDER BY l.level_no LIMIT 1;
    v_ok := FOUND AND public.payment_approver_matches(v_uid, r.organization_id, r.project_id, n.approver_kind, n.role_id);
  END IF;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Only the approver whose turn it is (or an organization admin) can reject this request'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.payment_requests SET status = 'rejected', rejection_reason = v_reason WHERE id = r.id;
  RETURN jsonb_build_object('status', 'rejected');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_payment_request(_request uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_reason text := btrim(COALESCE(_reason, ''));
  r        public.payment_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'cancel_payment_request: not signed in' USING ERRCODE = '42501';
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'A cancellation needs a reason (3 to 1000 characters)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.payment_requests WHERE id = _request FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_super_admin(v_uid) OR public.is_org_member(v_uid, r.organization_id)) THEN
    RAISE EXCEPTION 'cancel_payment_request: request not found' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'paid' THEN
    RAISE EXCEPTION 'A paid request cannot be cancelled — the money has left; record a refund instead'
      USING ERRCODE = '42501';
  END IF;
  IF r.status IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'This request is already %', r.status USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_super_admin(v_uid) OR public.is_org_admin(v_uid, r.organization_id)
          OR (r.requested_by = v_uid AND r.status IN ('draft', 'waiting_approval'))) THEN
    RAISE EXCEPTION 'Only the requester (before approval) or an organization admin can cancel this request'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.payment_requests SET status = 'cancelled', cancellation_reason = v_reason WHERE id = r.id;
  RETURN jsonb_build_object('status', 'cancelled');
END;
$$;

-- Whose turn: one row per request of the organization (optionally one project).
CREATE OR REPLACE FUNCTION public.payment_request_chain_status(_org uuid, _project uuid DEFAULT NULL)
RETURNS TABLE (request_id uuid, required_levels int, approved_levels int,
               next_level smallint, next_label text, can_act boolean, steps jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  req AS (
    SELECT pr.* FROM public.payment_requests pr, me
     WHERE pr.organization_id = _org
       AND (_project IS NULL OR pr.project_id = _project)
       AND me.uid IS NOT NULL
       AND (public.is_super_admin(me.uid) OR public.is_org_member(me.uid, _org))),
  lv AS (
    SELECT r.id AS rid, l.level_no, l.label, l.approver_kind, l.role_id
      FROM req r JOIN public.payment_approval_levels l ON l.organization_id = r.organization_id
     WHERE l.min_amount_sar <= public.payment_request_amount_sar(r.requested_amount, r.currency, r.project_id)),
  ap AS (
    SELECT a.* FROM public.payment_request_approvals a JOIN req r ON r.id = a.payment_request_id),
  nxt AS (
    SELECT DISTINCT ON (lv.rid) lv.*
      FROM lv
     WHERE NOT EXISTS (SELECT 1 FROM ap WHERE ap.payment_request_id = lv.rid AND ap.level_no = lv.level_no)
     ORDER BY lv.rid, lv.level_no)
  SELECT r.id,
         (SELECT count(*) FROM lv WHERE lv.rid = r.id)::int,
         (SELECT count(*) FROM ap WHERE ap.payment_request_id = r.id)::int,
         n.level_no,
         n.label,
         (r.status = 'waiting_approval'
           AND r.requested_by IS DISTINCT FROM me.uid
           AND CASE
                 WHEN NOT EXISTS (SELECT 1 FROM lv WHERE lv.rid = r.id)
                   THEN public.is_super_admin(me.uid) OR public.is_org_admin(me.uid, r.organization_id)
                 WHEN n.rid IS NULL THEN false
                 ELSE public.payment_approver_matches(me.uid, r.organization_id, r.project_id, n.approver_kind, n.role_id)
                      AND NOT EXISTS (SELECT 1 FROM ap WHERE ap.payment_request_id = r.id AND ap.approved_by = me.uid)
               END),
         CASE WHEN r.status = 'waiting_approval' THEN
           COALESCE((SELECT jsonb_agg(jsonb_build_object('level', lv.level_no, 'label', lv.label,
                                                         'approved_by', a.approved_by, 'approved_at', a.approved_at,
                                                         'note', a.note) ORDER BY lv.level_no)
                       FROM lv LEFT JOIN ap a ON a.payment_request_id = lv.rid AND a.level_no = lv.level_no
                      WHERE lv.rid = r.id), '[]'::jsonb)
         ELSE
           COALESCE((SELECT jsonb_agg(jsonb_build_object('level', a.level_no, 'label', a.level_label,
                                                         'approved_by', a.approved_by, 'approved_at', a.approved_at,
                                                         'note', a.note) ORDER BY a.level_no)
                       FROM ap a WHERE a.payment_request_id = r.id), '[]'::jsonb)
         END
    FROM req r CROSS JOIN me LEFT JOIN nxt n ON n.rid = r.id
$$;

-- ---------------------------------------------------------------------
-- 13. B21 — Payroll Hub runs are paid through payment requests
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.require_post_payroll_run_rpc()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted'
     AND COALESCE(current_setting('kwalis.posting_run', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'A payroll run is posted with post_payroll_run(), which sends every line to Payment Approvals'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_payroll_run_post_via_rpc ON public.payroll_runs;
CREATE TRIGGER trg_payroll_run_post_via_rpc
  BEFORE UPDATE OF status ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.require_post_payroll_run_rpc();

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

  -- One path per person: base (timesheet) lines are refused for anyone paid
  -- through contract instalments in this project. Approved overtime lines are
  -- not part of a contract schedule and stay allowed.
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
    v_amount := round(COALESCE(NULLIF(it.net, 0), it.gross, 0), 2);
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
       COALESCE(NULLIF(it.currency, ''), r.currency, 'SAR'), 'waiting_approval', v_uid, now(),
       'run', 'Payroll run ' || r.label || ' (' || r.period_start || ' → ' || r.period_end || ')');
    v_requests := v_requests + 1;
  END LOOP;

  PERFORM set_config('kwalis.posting_run', r.id::text, true);
  UPDATE public.payroll_runs SET status = 'posted', posted_at = now(), posted_by = v_uid WHERE id = r.id;
  PERFORM set_config('kwalis.posting_run', '', true);

  -- Approved overtime attached to this run is settled by the run (as before),
  -- so it can never be put in a second run.
  UPDATE public.overtime_entries SET status = 'paid', paid_at = now()
   WHERE payroll_run_id = r.id AND status = 'approved';

  RETURN jsonb_build_object('payment_requests', v_requests);
END;
$$;

-- reverse_payroll_run: copy of the live definition; lines marked "176" are new.
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
  req_count int := 0;                                                       -- 176
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
  -- 176: lines already approved or paid on Payment Approvals cannot be undone here
  IF EXISTS (SELECT 1 FROM public.payment_requests q
               JOIN public.payroll_run_items i ON i.payroll_id = q.source_id
              WHERE i.payroll_run_id = _run AND q.source_type = 'payroll_row'
                AND q.status IN ('approved', 'paid')) THEN
    RAISE EXCEPTION 'This run has lines already approved or paid on Payment Approvals — it cannot be reversed'
      USING ERRCODE = '42501';
  END IF;
  -- 176: open requests of the run are cancelled (recorded, not deleted)
  WITH cancelled AS (
    UPDATE public.payment_requests q
       SET status = 'cancelled',
           cancellation_reason = left('Payroll run reversed: ' || COALESCE(NULLIF(_reason, ''), 'no reason given'), 1000)
      FROM public.payroll_run_items i
     WHERE i.payroll_run_id = _run AND i.payroll_id = q.source_id
       AND q.source_type = 'payroll_row' AND q.status IN ('draft', 'waiting_approval')
     RETURNING 1
  ) SELECT count(*) INTO req_count FROM cancelled;
  -- Overtime settled by this run goes back to approved + unpaid and is freed
  -- so it can be attached to a corrected run.
  WITH reverted AS (
    UPDATE public.overtime_entries
       SET status = 'approved', paid_at = NULL, payroll_run_id = NULL
     WHERE payroll_run_id = _run AND status = 'paid'
     RETURNING 1
  ) SELECT count(*) INTO ot_count FROM reverted;
  -- Ledger rows created when the run was posted are marked unpaid.
  WITH unpaid AS (
    UPDATE public.payroll
       SET payments = '["Unpaid"]'::jsonb,
           percents = '[0]'::jsonb,
           ledger = '[]'::jsonb,
           payment_schedule = '[]'::jsonb                                   -- 176: no instalment left to pay
     WHERE ref_id LIKE 'PR-' || left(_run::text, 8) || '-%'
     RETURNING 1
  ) SELECT count(*) INTO ledger_count FROM unpaid;
  UPDATE public.payroll_run_items SET payroll_id = NULL WHERE payroll_run_id = _run;   -- 176
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
             ot_count, ledger_count, req_count),                            -- 176
    r.gross_total, r.net_total, r.wht_total
  );
  RETURN jsonb_build_object('overtime_reverted', ot_count, 'ledger_unpaid', ledger_count,
                            'requests_cancelled', req_count);              -- 176
END;
$$;

-- ---------------------------------------------------------------------
-- 14. Grants
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.payroll_milestone_amount(jsonb, numeric)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_request_amount_sar(numeric, text, uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_approver_matches(uuid, uuid, uuid, text, uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payment_request_required_levels(uuid)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notify_payment_approvers(uuid)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_payment_request_step(uuid, text)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_payment_request_step(uuid, text)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_payment_request(uuid, text)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_request_chain_status(uuid, uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_payroll_run(uuid)                                      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_milestone_amount(jsonb, numeric)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_request_amount_sar(numeric, text, uuid)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_approver_matches(uuid, uuid, uuid, text, uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.payment_request_required_levels(uuid)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_payment_approvers(uuid)                           TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_payment_request_step(uuid, text)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_payment_request_step(uuid, text)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_payment_request(uuid, text)                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_request_chain_status(uuid, uuid)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_payroll_run(uuid)                                   TO authenticated, service_role;
