-- =====================================================================
-- D09 — the board approval limit (50,000) made real
--
-- Finding: the limit is NOT applied anywhere today. "Require approval above"
-- on Platform Hub → Settings is saved in the browser's localStorage only
-- (key kwalis.platform-settings) — it is not stored in the database, other
-- users never see it, and nothing reads it when a payment is approved.
--
-- This adds the missing mechanism, switched OFF until someone sets a limit:
--   table public.platform_settings                    key/value, super admin writes
--   table public.payment_request_board_approvals      the additional approval
--   RPC   public.board_approve_payment_request(id, note)
--   RPC   public.payment_request_needs_board_approval(id)
--   the D06 trigger function is extended: above the limit, a request cannot be
--   approved until a board approval exists from someone who is neither the
--   requester nor the final approver.
--
-- While payment_board_approval_above_sar is NULL (the shipped value) nothing
-- changes for anyone. Turning it on is a deliberate act by the platform owner:
--   UPDATE public.platform_settings SET value = '50000'
--   WHERE key = 'payment_board_approval_above_sar';
-- Do that only after the approvals screen has a "Board approval" action
-- (see docs/lovable-prompts), otherwise large requests cannot be approved.
--
-- Who may give the board approval: the organization owner, or a member of the
-- project holding an executive title (project_members.executive_title).
--
-- Depends on 030_d06. Rollback:
--   re-run 030_d06_maker_checker.sql (restores the function without the limit)
--   DROP FUNCTION public.board_approve_payment_request(uuid, text);
--   DROP FUNCTION public.payment_request_needs_board_approval(uuid);
--   DROP TABLE public.payment_request_board_approvals;
--   DROP TABLE public.platform_settings;
-- =====================================================================
CREATE TABLE public.platform_settings (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{1,80}$'),
  value       text,
  description text,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;
REVOKE ALL ON public.platform_settings FROM anon;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
-- platform-wide configuration, no tenant data: any signed-in user may read it
CREATE POLICY "Signed-in users read platform settings"
  ON public.platform_settings FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Super admin updates platform settings"
  ON public.platform_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

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
  RETURN NEW;
END $$;
CREATE TRIGGER trg_stamp_platform_settings
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_platform_settings();

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('payment_board_approval_above_sar', NULL,
   'Payment requests above this amount (SAR) need a board approval before the normal approval. NULL = off.');

CREATE TABLE public.payment_request_board_approvals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES public.payment_requests(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL,
  project_id         uuid,
  approved_by        uuid NOT NULL,
  approved_at        timestamptz NOT NULL DEFAULT now(),
  note               text CHECK (note IS NULL OR length(note) <= 1000),
  CONSTRAINT payment_request_board_approvals_once UNIQUE (payment_request_id, approved_by)
);
GRANT SELECT ON public.payment_request_board_approvals TO authenticated;   -- written only through the RPC
GRANT ALL ON public.payment_request_board_approvals TO service_role;
REVOKE ALL ON public.payment_request_board_approvals FROM anon;
ALTER TABLE public.payment_request_board_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members read board approvals"
  ON public.payment_request_board_approvals FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_member(auth.uid(), organization_id));
CREATE TRIGGER trg_audit_history_payment_request_board_approvals
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_request_board_approvals
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- The configured limit (NULL = off). SECURITY DEFINER so the trigger sees the
-- same value whoever fires it.
CREATE OR REPLACE FUNCTION public.payment_board_approval_limit()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NULLIF(s.value, '')::numeric
  FROM public.platform_settings s WHERE s.key = 'payment_board_approval_above_sar'
$$;

CREATE OR REPLACE FUNCTION public.payment_request_needs_board_approval(p_request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT public.payment_board_approval_limit() IS NOT NULL
     AND pr.requested_amount > public.payment_board_approval_limit()
     AND NOT EXISTS (SELECT 1 FROM public.payment_request_board_approvals b
                     WHERE b.payment_request_id = pr.id AND b.approved_by <> pr.requested_by)
  FROM public.payment_requests pr WHERE pr.id = p_request_id
$$;

CREATE OR REPLACE FUNCTION public.board_approve_payment_request(p_request_id uuid, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.payment_requests%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'board_approve_payment_request: not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.payment_requests WHERE id = p_request_id;
  IF NOT FOUND
     OR NOT (public.is_super_admin(v_uid) OR public.is_org_member(v_uid, r.organization_id)) THEN
    RAISE EXCEPTION 'board_approve_payment_request: request not found' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'waiting_approval' THEN
    RAISE EXCEPTION 'board_approve_payment_request: the request is not waiting for approval' USING ERRCODE = '42501';
  END IF;
  IF v_uid = r.requested_by THEN
    RAISE EXCEPTION 'Maker-checker: you cannot give board approval to a request you raised' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_org_owner(v_uid, r.organization_id)
          OR EXISTS (SELECT 1 FROM public.project_members pm
                     WHERE pm.project_id = r.project_id AND pm.user_id = v_uid
                       AND pm.executive_title IS NOT NULL)) THEN
    RAISE EXCEPTION 'board_approve_payment_request: only the organization owner or a project executive can give board approval'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.payment_request_board_approvals (payment_request_id, organization_id, project_id, approved_by, note)
  VALUES (r.id, r.organization_id, r.project_id, v_uid, NULLIF(btrim(p_note), ''))
  ON CONFLICT (payment_request_id, approved_by) DO UPDATE SET note = EXCLUDED.note
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_board_approval_limit()                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_request_needs_board_approval(uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.board_approve_payment_request(uuid, text)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_board_approval_limit()              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_request_needs_board_approval(uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.board_approve_payment_request(uuid, text)   TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- D06 trigger function, now also holding the limit. Identical to 030 except
-- for the block marked D09.
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
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.executed_by IS DISTINCT FROM OLD.executed_by
       OR NEW.executed_at IS DISTINCT FROM OLD.executed_at THEN
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
  END IF;

  RETURN NEW;
END;
$$;
