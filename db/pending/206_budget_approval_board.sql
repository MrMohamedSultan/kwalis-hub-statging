-- =====================================================================
-- 206 — Board approval of the budget, version by version.
--
-- Client request (Ammar, voice note 2/11): a board member sees only the
-- Budget and the Dashboard, receives a request on a budget, sees its summary
-- and approves. Only the PRODUCER sends the budget for approval. An approved
-- budget is LOCKED. A change goes through a NEW DRAFT that is sent for
-- approval in turn; when it is approved it replaces the old budget.
--
-- Builds on 20260715111109 (projects.budget_status, project_members.
-- executive_title, budget_approvers), 20260715114032 (budget_status_events,
-- is_budget_editable, budget_lines lock), 20260727133902 (budget_lines
-- policies), 20260828155312 (budget_versions, publish_budget_version) and
-- 201 (create_budget_draft). Safe to apply ONCE on a database that already
-- has 171–204: every object is IF NOT EXISTS / CREATE OR REPLACE / DROP …
-- IF EXISTS first; no existing row is rewritten (the only data written is the
-- copy of a legacy pending approval into the new request table, see 6).
--
-- 1. Requests: budget_approval_requests (one per submission, bound to ONE
--    budget version) + budget_approval_decisions (one row per approver).
--    Read by every member of the project (can_access_project); written only
--    by the functions below (no INSERT / UPDATE / DELETE grant or policy).
-- 2. Who:
--    * board / executive member = project_members.executive_title IS NOT NULL
--      on THAT project (is_budget_executive). The profile-level title is a UI
--      fallback only and gives no right in the database.
--    * submitter (can_submit_budget) = super admin, an admin / owner of the
--      project's organization with access to the project, or a project member
--      whose project role is owner / admin / producer. Never an executive.
--    * approver = a member of the project with an executive title, never the
--      submitter (maker–checker). Default: every Board Member of the project.
-- 3. Flow (SECURITY DEFINER RPCs, search_path = public, no PUBLIC / anon):
--    * submit_budget_for_approval(project, version, approvers[], note) — the
--      version is a draft, or the active version while the budget is not
--      Locked/Approved; it has lines; no other request of the project is
--      pending. A request on the ACTIVE version moves the project to
--      'Pending Approval'; a request on a DRAFT leaves the project status as
--      it is (the active budget stays locked if it was). Approvers notified.
--    * decide_budget_approval(request, approved|rejected, reason) — own row
--      only, once; reason required on reject. Any reject → request rejected
--      (and 'Revision Requested' when it was the active version). All
--      approved → a draft becomes the active version (the old active one is
--      archived, same as publish_budget_version) and the project budget is
--      'Locked/Approved'; the active version → just 'Locked/Approved'. The
--      submitter is notified either way.
--    * cancel_budget_approval(request, reason) — the submitter or another
--      allowed submitter withdraws a pending request.
--    * budget_version_summary(version) — totals by section / top sheet code
--      for the request screen (SECURITY INVOKER: RLS applies).
-- 4. Locks:
--    * budget_lines insert / update / delete: can_edit_budget_line(project,
--      org, version) — version-aware. The ACTIVE version (and legacy lines
--      without a version) is editable only while the budget is 'Draft' /
--      'Revision Requested' — by NOBODY once 'Pending Approval' /
--      'Locked/Approved' (project and organization admins lose the bypass
--      they had; super admin keeps it). A DRAFT is editable by the project
--      members even while the active budget is locked, except while the
--      draft itself is under a pending request. ARCHIVED versions are
--      read-only. Executives never write budget lines.
--    * budget_versions: status changes (draft → active → archived) only by
--      these functions / publish_budget_version (guard trigger); a version
--      cannot move to another project; a version under a pending request
--      cannot be deleted; a new version is inserted as a draft (an 'active'
--      one only when the project has none, the bootstrap case).
--    * projects.budget_status / budget_locked_at / budget_locked_by: written
--      only by these functions (guard trigger). The old client flow (status
--      resolved in the browser, org admins writing the column) is refused.
--      Super admin and the backend (no auth.uid(): service role, demo seed,
--      migrations) are not affected.
--    * publish_budget_version: direct publish only while the budget is
--      'Draft' and no request is pending (projects that never used approvals
--      keep working). Once a budget was submitted / approved / rejected, a
--      draft becomes active only through an approved request. No super-admin
--      exception (none existed — it never checked the lock).
--    * create_budget_draft(project, name, blank): new optional "blank" draft
--      (not copied from anything). Executives cannot create drafts.
-- 5. Notifications on submit (approvers) and decision (submitter), category
--    'budget' (the notifications page opens /budget?focus=governance).
--    log_budget_status_change (20260715114032) is redefined to skip its
--    legacy fan-out to budget_approvers when the status is changed by these
--    functions (no duplicate notifications).
-- 6. Legacy: budget_approvers stays (read by nothing new, policies untouched).
--    A project that is 'Pending Approval' with legacy approvers, at least one
--    of them still pending and none rejected, gets one pending request on its
--    active version with those decisions copied (legacy = true, submitter
--    unknown), so the new screen can finish it.
--
-- Not changed: budget_upload_batches keep the project-level
-- is_budget_editable(); links from contracts / POs / invoices to budget
-- lines (linked_budget_line_id) are not remapped on promotion — the position
-- views resolve the budget CODE through the linked line of any version, so
-- project / code totals are unaffected (see the report to the owner).
--
-- SECURITY: new tables with RLS, SECURITY DEFINER functions, changed
-- budget_lines policies and guard triggers on projects / budget_versions —
-- apply only after owner approval (SECURITY.md).
--
-- Rollback (in this order):
--   DROP TRIGGER IF EXISTS trg_guard_project_budget_status ON public.projects;
--   DROP TRIGGER IF EXISTS trg_guard_budget_version ON public.budget_versions;
--   DROP TRIGGER IF EXISTS trg_guard_budget_version_delete ON public.budget_versions;
--   DROP FUNCTION IF EXISTS public.guard_project_budget_status(), public.guard_budget_version(),
--     public.guard_budget_version_delete();
--   re-create the budget_lines_insert / _update / _delete policies from 20260727133902;
--   DROP FUNCTION IF EXISTS public.can_edit_budget_line(uuid, uuid, uuid);
--   re-create publish_budget_version() from 20260828155312;
--   DROP FUNCTION IF EXISTS public.create_budget_draft(uuid, text, boolean);
--   re-create create_budget_draft(uuid, text) from 201;
--   re-create log_budget_status_change() from 20260715114032;
--   DROP FUNCTION IF EXISTS public.submit_budget_for_approval(uuid, uuid, uuid[], text),
--     public.decide_budget_approval(uuid, text, text), public.cancel_budget_approval(uuid, text),
--     public.budget_version_summary(uuid), public.budget_approval_notify(uuid, uuid, text, text, text, jsonb),
--     public.can_submit_budget(uuid, uuid), public.is_budget_executive(uuid, uuid);
--   DROP TABLE IF EXISTS public.budget_approval_decisions;
--   DROP TABLE IF EXISTS public.budget_approval_requests;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.budget_approval_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id     uuid,
  version_id          uuid REFERENCES public.budget_versions(id) ON DELETE SET NULL,
  version_name        text,
  kind                text NOT NULL CHECK (kind IN ('draft', 'active')),
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  prev_budget_status  text,
  total_sar           numeric(16,2),
  line_count          integer,
  note                text CHECK (note IS NULL OR length(note) <= 1000),
  submitted_by        uuid,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  decided_at          timestamptz,
  decision_reason     text CHECK (decision_reason IS NULL OR length(decision_reason) <= 1000),
  cancelled_by        uuid,
  legacy              boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS budget_approval_requests_one_pending
  ON public.budget_approval_requests (project_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS budget_approval_requests_project_idx
  ON public.budget_approval_requests (project_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS budget_approval_requests_version_idx
  ON public.budget_approval_requests (version_id);
COMMENT ON TABLE public.budget_approval_requests IS
  'A budget version sent for board approval. Written only by submit_budget_for_approval / decide_budget_approval / cancel_budget_approval. db/pending/206.';

GRANT SELECT ON public.budget_approval_requests TO authenticated;
GRANT ALL ON public.budget_approval_requests TO service_role;
ALTER TABLE public.budget_approval_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_approval_requests_select ON public.budget_approval_requests;
CREATE POLICY budget_approval_requests_select ON public.budget_approval_requests
  FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));

CREATE TABLE IF NOT EXISTS public.budget_approval_decisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid NOT NULL REFERENCES public.budget_approval_requests(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id  uuid,
  approver_id      uuid NOT NULL,
  decision         text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'rejected')),
  reason           text CHECK (reason IS NULL OR length(reason) <= 1000),
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, approver_id)
);
CREATE INDEX IF NOT EXISTS budget_approval_decisions_approver_idx
  ON public.budget_approval_decisions (approver_id, decision);
COMMENT ON TABLE public.budget_approval_decisions IS
  'One approver of a budget_approval_requests row and their decision. Written only by the 206 functions.';

GRANT SELECT ON public.budget_approval_decisions TO authenticated;
GRANT ALL ON public.budget_approval_decisions TO service_role;
ALTER TABLE public.budget_approval_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_approval_decisions_select ON public.budget_approval_decisions;
CREATE POLICY budget_approval_decisions_select ON public.budget_approval_decisions
  FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));

-- organization_id must be the project's (same guard as every tenant table, 200)
DROP TRIGGER IF EXISTS zzz_trg_project_org_consistency ON public.budget_approval_requests;
CREATE TRIGGER zzz_trg_project_org_consistency BEFORE INSERT OR UPDATE ON public.budget_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_org_consistency();
DROP TRIGGER IF EXISTS zzz_trg_project_org_consistency ON public.budget_approval_decisions;
CREATE TRIGGER zzz_trg_project_org_consistency BEFORE INSERT OR UPDATE ON public.budget_approval_decisions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_org_consistency();
DROP TRIGGER IF EXISTS trg_audit_history_budget_approval_requests ON public.budget_approval_requests;
CREATE TRIGGER trg_audit_history_budget_approval_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();
DROP TRIGGER IF EXISTS trg_audit_history_budget_approval_decisions ON public.budget_approval_decisions;
CREATE TRIGGER trg_audit_history_budget_approval_decisions
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_approval_decisions
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- ---------------------------------------------------------------------
-- 2. Who
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_budget_executive(_uid uuid, _project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.project_members pm
                  WHERE pm.project_id = _project AND pm.user_id = _uid
                    AND pm.executive_title IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION public.can_submit_budget(_uid uuid, _project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.is_super_admin(_uid)
    OR EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = _project
         AND public.can_access_project(_uid, p.organization_id, p.id)
         AND NOT public.is_budget_executive(_uid, p.id)
         AND (public.is_org_admin(_uid, p.organization_id)
              OR EXISTS (SELECT 1 FROM public.project_members pm
                          WHERE pm.project_id = p.id AND pm.user_id = _uid
                            AND pm.role IN ('owner', 'admin', 'producer')))))
$$;

-- ---------------------------------------------------------------------
-- 3. Version-aware budget line lock
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_edit_budget_line(_project uuid, _org uuid, _version uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
BEGIN
  IF public.is_super_admin(v_uid) THEN RETURN true; END IF;
  IF v_uid IS NULL OR NOT public.can_access_project(v_uid, _org, _project) THEN RETURN false; END IF;
  IF public.is_budget_executive(v_uid, _project) THEN RETURN false; END IF;
  IF _version IS NOT NULL THEN
    SELECT bv.status INTO v_status FROM public.budget_versions bv
     WHERE bv.id = _version AND bv.project_id = _project;
    IF v_status IS NULL THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM public.budget_approval_requests r
                WHERE r.version_id = _version AND r.status = 'pending') THEN
      RETURN false;  -- frozen while the board reviews it
    END IF;
    IF v_status = 'draft' THEN RETURN true; END IF;
    IF v_status = 'archived' THEN RETURN false; END IF;
  END IF;
  -- the active version (or a legacy line without a version)
  RETURN public.is_budget_editable(_project);
END;
$$;
REVOKE ALL ON FUNCTION public.can_edit_budget_line(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_budget_line(uuid, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS budget_lines_insert ON public.budget_lines;
DROP POLICY IF EXISTS budget_lines_update ON public.budget_lines;
DROP POLICY IF EXISTS budget_lines_delete ON public.budget_lines;
CREATE POLICY budget_lines_insert ON public.budget_lines
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id)
              AND public.can_edit_budget_line(project_id, organization_id, version_id));
CREATE POLICY budget_lines_update ON public.budget_lines
  FOR UPDATE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id)
         AND public.can_edit_budget_line(project_id, organization_id, version_id))
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id)
              AND public.can_edit_budget_line(project_id, organization_id, version_id));
CREATE POLICY budget_lines_delete ON public.budget_lines
  FOR DELETE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id)
         AND public.can_edit_budget_line(project_id, organization_id, version_id));

-- ---------------------------------------------------------------------
-- 4. Guards: version status and project budget status move only through
--    the functions (kwalis.budget_approval = on, transaction-local)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_budget_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rpc boolean := COALESCE(current_setting('kwalis.budget_approval', true), '') = 'on';
BEGIN
  IF v_uid IS NULL OR v_rpc OR public.is_super_admin(v_uid) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'draft' THEN RETURN NEW; END IF;
    IF NEW.status = 'active' AND NOT EXISTS (
         SELECT 1 FROM public.budget_versions bv WHERE bv.project_id = NEW.project_id AND bv.status = 'active') THEN
      RETURN NEW;  -- first version of a project (stamp_budget_line_version)
    END IF;
    RAISE EXCEPTION 'a new budget version starts as a draft; it becomes active only through approval or publish'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'a budget version cannot move to another project' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'budget version status changes only through publish or board approval'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_budget_version ON public.budget_versions;
CREATE TRIGGER trg_guard_budget_version BEFORE INSERT OR UPDATE ON public.budget_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_version();

CREATE OR REPLACE FUNCTION public.guard_budget_version_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  -- a project being deleted takes its versions (and requests) with it
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM public.budget_approval_requests r
              WHERE r.version_id = OLD.id AND r.status = 'pending') THEN
    RAISE EXCEPTION 'this budget version is waiting for board approval; withdraw the request first'
      USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NOT NULL AND NOT public.is_super_admin(v_uid) AND public.is_budget_executive(v_uid, OLD.project_id) THEN
    RAISE EXCEPTION 'board members cannot delete budget versions' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_budget_version_delete ON public.budget_versions;
CREATE TRIGGER trg_guard_budget_version_delete BEFORE DELETE ON public.budget_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_version_delete();

CREATE OR REPLACE FUNCTION public.guard_project_budget_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF (NEW.budget_status IS DISTINCT FROM OLD.budget_status
      OR NEW.budget_locked_at IS DISTINCT FROM OLD.budget_locked_at
      OR NEW.budget_locked_by IS DISTINCT FROM OLD.budget_locked_by)
     AND v_uid IS NOT NULL
     AND COALESCE(current_setting('kwalis.budget_approval', true), '') <> 'on'
     AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'the budget status changes only through the approval flow (send for approval / approve / reject)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_project_budget_status ON public.projects;
CREATE TRIGGER trg_guard_project_budget_status
  BEFORE UPDATE OF budget_status, budget_locked_at, budget_locked_by ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_budget_status();

-- log_budget_status_change (copy of 20260715114032) — "206": the legacy
-- fan-out to budget_approvers is skipped when the approval functions move the
-- status (they notify the request's own approvers).
CREATE OR REPLACE FUNCTION public.log_budget_status_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  approver RECORD;
  proj_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(NEW.budget_status,'Draft') IS DISTINCT FROM COALESCE(OLD.budget_status,'Draft') THEN
    INSERT INTO public.budget_status_events(project_id, organization_id, actor_id, action, from_status, to_status)
    VALUES (NEW.id, NEW.organization_id, auth.uid(), 'status_change', OLD.budget_status, NEW.budget_status);

    IF NEW.budget_status = 'Pending Approval' AND NEW.organization_id IS NOT NULL
       AND COALESCE(current_setting('kwalis.budget_approval', true), '') <> 'on' THEN   -- 206
      proj_name := COALESCE(NEW.name, 'Project');
      FOR approver IN
        SELECT user_id FROM public.budget_approvers WHERE project_id = NEW.id
      LOOP
        INSERT INTO public.notifications(organization_id, project_id, user_id, severity, category, title, body, metadata)
        VALUES (
          NEW.organization_id, NEW.id, approver.user_id,
          'warning', 'budget',
          'Budget approval required: ' || proj_name,
          'The budget for ' || proj_name || ' has been submitted and requires your approval.',
          jsonb_build_object('event','budget_pending_approval','project_id', NEW.id)
        );
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. Functions of the flow
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.budget_approval_notify(
  _project uuid, _user uuid, _severity text, _title text, _body text, _meta jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  IF _user IS NULL THEN RETURN; END IF;
  SELECT organization_id INTO v_org FROM public.projects WHERE id = _project;
  INSERT INTO public.notifications(organization_id, project_id, user_id, severity, category, title, body, metadata)
  VALUES (v_org, _project, _user, _severity, 'budget', left(_title, 300), left(_body, 1000), COALESCE(_meta, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.budget_approval_notify(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_budget_for_approval(
  p_project   uuid,
  p_version   uuid,
  p_approvers uuid[] DEFAULT NULL,
  p_note      text   DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_proj record;
  v_ver record;
  v_kind text;
  v_ids uuid[];
  v_bad int;
  v_lines int;
  v_total numeric;
  v_req uuid;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  a uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'submit_budget_for_approval: sign in first' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.organization_id, p.name, p.budget_status::text AS budget_status,
         COALESCE(NULLIF(p.fx_rate, 0), 3.75) AS fx
    INTO v_proj FROM public.projects p WHERE p.id = p_project FOR UPDATE;
  IF v_proj.id IS NULL OR NOT public.can_submit_budget(v_uid, p_project) THEN
    RAISE EXCEPTION 'only the producer, a project admin or an organization admin of this project can send the budget for approval'
      USING ERRCODE = '42501';
  END IF;
  SELECT bv.id, bv.status, bv.version_name INTO v_ver
    FROM public.budget_versions bv WHERE bv.id = p_version AND bv.project_id = p_project FOR UPDATE;
  IF v_ver.id IS NULL THEN
    RAISE EXCEPTION 'budget version not found in this project' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.budget_approval_requests r WHERE r.project_id = p_project AND r.status = 'pending') THEN
    RAISE EXCEPTION 'a budget approval request is already pending for this project' USING ERRCODE = '22023';
  END IF;
  IF v_ver.status = 'draft' THEN
    v_kind := 'draft';
  ELSIF v_ver.status = 'active' THEN
    IF v_proj.budget_status = 'Locked/Approved' THEN
      RAISE EXCEPTION 'the active budget is already approved and locked; create a new draft and send that draft'
        USING ERRCODE = '22023';
    END IF;
    v_kind := 'active';
  ELSE
    RAISE EXCEPTION 'an archived budget version cannot be sent for approval' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN
    RAISE EXCEPTION 'note too long (max 1000 characters)' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), COALESCE(sum(public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting,
           bl.wrap, bl.unit, bl.currency, bl.excluded, v_proj.fx)), 0)
    INTO v_lines, v_total
    FROM public.budget_lines bl WHERE bl.version_id = p_version;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'this budget version has no lines' USING ERRCODE = '22023';
  END IF;

  IF p_approvers IS NULL OR cardinality(p_approvers) = 0 THEN
    SELECT array_agg(pm.user_id ORDER BY pm.created_at) INTO v_ids
      FROM public.project_members pm
     WHERE pm.project_id = p_project AND pm.executive_title = 'Board Member' AND pm.user_id <> v_uid;
  ELSE
    SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_approvers) x WHERE x IS NOT NULL;
  END IF;
  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'no board member on this project: give a project member the Board Member title first'
      USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_ids) > 10 THEN
    RAISE EXCEPTION 'at most 10 approvers' USING ERRCODE = '22023';
  END IF;
  IF v_uid = ANY (v_ids) THEN
    RAISE EXCEPTION 'you cannot approve a budget you send (maker-checker)' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_bad FROM unnest(v_ids) x
   WHERE NOT EXISTS (SELECT 1 FROM public.project_members pm
                      WHERE pm.project_id = p_project AND pm.user_id = x AND pm.executive_title IS NOT NULL);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'every approver must be a member of this project with an executive title (Board Member, CEO, CFO, Executive Producer)'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.budget_approval_requests(project_id, organization_id, version_id, version_name, kind, status,
         prev_budget_status, total_sar, line_count, note, submitted_by)
  VALUES (p_project, v_proj.organization_id, p_version, v_ver.version_name, v_kind, 'pending',
          v_proj.budget_status, round(v_total, 2), v_lines, v_note, v_uid)
  RETURNING id INTO v_req;
  INSERT INTO public.budget_approval_decisions(request_id, project_id, organization_id, approver_id)
  SELECT v_req, p_project, v_proj.organization_id, x FROM unnest(v_ids) x;

  PERFORM set_config('kwalis.budget_approval', 'on', true);
  IF v_kind = 'active' AND v_proj.budget_status IS DISTINCT FROM 'Pending Approval' THEN
    UPDATE public.projects SET budget_status = 'Pending Approval', budget_locked_at = NULL, budget_locked_by = NULL
     WHERE id = p_project;
  END IF;
  INSERT INTO public.budget_status_events(project_id, organization_id, actor_id, action, to_status, note, metadata)
  VALUES (p_project, v_proj.organization_id, v_uid, 'approval_submitted', 'pending', v_note,
          jsonb_build_object('request_id', v_req, 'version_id', p_version, 'version_name', v_ver.version_name,
                             'kind', v_kind, 'approvers', to_jsonb(v_ids)));
  FOREACH a IN ARRAY v_ids LOOP
    PERFORM public.budget_approval_notify(p_project, a, 'warning',
      'Budget approval required: ' || COALESCE(v_proj.name, 'Project'),
      'Budget ' || COALESCE(v_ver.version_name, '') || ' of ' || COALESCE(v_proj.name, 'the project')
        || ' was sent for your approval.',
      jsonb_build_object('event', 'budget_approval_requested', 'request_id', v_req, 'version_id', p_version,
                         'version_name', v_ver.version_name, 'project_name', v_proj.name));
  END LOOP;
  PERFORM set_config('kwalis.budget_approval', 'off', true);
  RETURN v_req;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_budget_approval(
  p_request  uuid,
  p_decision text,
  p_reason   text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
  v_row record;
  v_dec text := lower(btrim(COALESCE(p_decision, '')));
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_proj record;
  v_vstatus text;
  v_result text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'decide_budget_approval: sign in first' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_req FROM public.budget_approval_requests WHERE id = p_request FOR UPDATE;
  IF v_req.id IS NULL OR NOT public.can_access_project(v_uid, v_req.organization_id, v_req.project_id) THEN
    RAISE EXCEPTION 'approval request not found' USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'this approval request is already %', v_req.status USING ERRCODE = '22023';
  END IF;
  IF v_req.submitted_by = v_uid THEN
    RAISE EXCEPTION 'you sent this budget; another person must approve it (maker-checker)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.budget_approval_decisions
   WHERE request_id = p_request AND approver_id = v_uid FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'you are not an approver of this request' USING ERRCODE = '42501';
  END IF;
  IF v_row.decision <> 'pending' THEN
    RAISE EXCEPTION 'you already decided on this request' USING ERRCODE = '22023';
  END IF;
  IF v_dec NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected' USING ERRCODE = '22023';
  END IF;
  IF v_dec = 'rejected' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'a reason is required to reject the budget' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'reason too long (max 1000 characters)' USING ERRCODE = '22023';
  END IF;

  UPDATE public.budget_approval_decisions SET decision = v_dec, reason = v_reason, decided_at = now()
   WHERE id = v_row.id;
  SELECT p.id, p.name, p.organization_id, p.budget_status::text AS budget_status
    INTO v_proj FROM public.projects p WHERE p.id = v_req.project_id FOR UPDATE;

  PERFORM set_config('kwalis.budget_approval', 'on', true);
  INSERT INTO public.budget_status_events(project_id, organization_id, actor_id, action, from_status, to_status, note, metadata)
  VALUES (v_req.project_id, v_req.organization_id, v_uid,
          CASE WHEN v_dec = 'approved' THEN 'approver_approved' ELSE 'approver_rejected' END,
          'pending', v_dec, v_reason,
          jsonb_build_object('request_id', p_request, 'version_id', v_req.version_id, 'version_name', v_req.version_name));

  IF v_dec = 'rejected' THEN
    UPDATE public.budget_approval_requests SET status = 'rejected', decided_at = now(), decision_reason = v_reason
     WHERE id = p_request;
    IF v_req.kind = 'active' AND v_proj.budget_status = 'Pending Approval' THEN
      UPDATE public.projects SET budget_status = 'Revision Requested', budget_locked_at = NULL, budget_locked_by = NULL
       WHERE id = v_req.project_id;
    END IF;
    PERFORM public.budget_approval_notify(v_req.project_id, v_req.submitted_by, 'warning',
      'Budget rejected: ' || COALESCE(v_proj.name, 'Project'),
      'Budget ' || COALESCE(v_req.version_name, '') || ' was rejected. Reason: ' || v_reason,
      jsonb_build_object('event', 'budget_approval_rejected', 'request_id', p_request,
                         'version_name', v_req.version_name, 'project_name', v_proj.name, 'reason', v_reason));
    v_result := 'rejected';
  ELSIF NOT EXISTS (SELECT 1 FROM public.budget_approval_decisions
                     WHERE request_id = p_request AND decision <> 'approved') THEN
    SELECT status INTO v_vstatus FROM public.budget_versions WHERE id = v_req.version_id FOR UPDATE;
    IF v_vstatus IS NULL OR v_vstatus <> v_req.kind THEN
      RAISE EXCEPTION 'the budget version of this request changed since it was sent (now %); withdraw the request',
        COALESCE(v_vstatus, 'deleted') USING ERRCODE = '22023';
    END IF;
    IF v_req.kind = 'draft' THEN
      -- same swap as publish_budget_version: the approved draft replaces the active budget
      UPDATE public.budget_versions SET status = 'archived'
       WHERE project_id = v_req.project_id AND status = 'active' AND id <> v_req.version_id;
      UPDATE public.budget_versions SET status = 'active', published_at = now() WHERE id = v_req.version_id;
    END IF;
    UPDATE public.projects SET budget_status = 'Locked/Approved', budget_locked_at = now(), budget_locked_by = v_uid
     WHERE id = v_req.project_id;
    UPDATE public.budget_approval_requests SET status = 'approved', decided_at = now() WHERE id = p_request;
    PERFORM public.budget_approval_notify(v_req.project_id, v_req.submitted_by, 'info',
      'Budget approved: ' || COALESCE(v_proj.name, 'Project'),
      'Budget ' || COALESCE(v_req.version_name, '') || ' was approved and is now the locked active budget.',
      jsonb_build_object('event', 'budget_approval_approved', 'request_id', p_request,
                         'version_name', v_req.version_name, 'project_name', v_proj.name));
    v_result := 'approved';
  ELSE
    v_result := 'pending';
  END IF;
  PERFORM set_config('kwalis.budget_approval', 'off', true);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_budget_approval(p_request uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
  v_reason text := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 1000);
BEGIN
  SELECT * INTO v_req FROM public.budget_approval_requests WHERE id = p_request FOR UPDATE;
  IF v_uid IS NULL OR v_req.id IS NULL
     OR NOT (v_req.submitted_by = v_uid OR public.can_submit_budget(v_uid, v_req.project_id)) THEN
    RAISE EXCEPTION 'only the sender or the producer / admins of the project can withdraw this request'
      USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'this approval request is already %', v_req.status USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('kwalis.budget_approval', 'on', true);
  UPDATE public.budget_approval_requests
     SET status = 'cancelled', decided_at = now(), cancelled_by = v_uid, decision_reason = v_reason
   WHERE id = p_request;
  IF v_req.kind = 'active' THEN
    UPDATE public.projects
       SET budget_status = (CASE WHEN v_req.prev_budget_status IN ('Draft', 'Revision Requested')
                                 THEN v_req.prev_budget_status ELSE 'Draft' END)::public.budget_status_enum
     WHERE id = v_req.project_id AND budget_status = 'Pending Approval';
  END IF;
  INSERT INTO public.budget_status_events(project_id, organization_id, actor_id, action, from_status, to_status, note, metadata)
  VALUES (v_req.project_id, v_req.organization_id, v_uid, 'approval_cancelled', 'pending', 'cancelled', v_reason,
          jsonb_build_object('request_id', p_request, 'version_id', v_req.version_id, 'version_name', v_req.version_name));
  PERFORM set_config('kwalis.budget_approval', 'off', true);
END;
$$;

-- Totals of one version by section / top sheet code (RLS applies).
CREATE OR REPLACE FUNCTION public.budget_version_summary(p_version uuid)
RETURNS TABLE(section text, topsheet_code text, topsheet_name text, line_count bigint, total_sar numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT bl."group" AS section,
         COALESCE(NULLIF(bl.topsheet_code, ''), left(bl.main_code, 2) || '00') AS topsheet_code,
         max(ta.name) AS topsheet_name,
         count(*) AS line_count,
         round(sum(public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap,
               bl.unit, bl.currency, bl.excluded, COALESCE(NULLIF(p.fx_rate, 0), 3.75))), 2) AS total_sar
    FROM public.budget_lines bl
    JOIN public.projects p ON p.id = bl.project_id
    LEFT JOIN public.budget_topsheet_accounts ta
      ON ta.code = COALESCE(NULLIF(bl.topsheet_code, ''), left(bl.main_code, 2) || '00')
   WHERE bl.version_id = p_version
   GROUP BY 1, 2
   ORDER BY 2
$$;

-- publish_budget_version (copy of 20260828155312) — "206": only while the
-- budget never went through approval (Draft) and nothing is pending.
CREATE OR REPLACE FUNCTION public.publish_budget_version(_version uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _project uuid; _org uuid; _vstatus text; _bstatus text;
BEGIN
  SELECT project_id, organization_id, status INTO _project, _org, _vstatus
    FROM public.budget_versions WHERE id = _version;
  IF _project IS NULL THEN RAISE EXCEPTION 'Version not found'; END IF;
  IF NOT public.is_project_admin(auth.uid(), _project)
     AND NOT public.is_org_admin(auth.uid(), _org)
     AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only project or company admins can publish a budget version';
  END IF;
  SELECT budget_status::text INTO _bstatus FROM public.projects WHERE id = _project FOR UPDATE;   -- 206
  IF _vstatus <> 'active' AND (COALESCE(_bstatus, 'Draft') <> 'Draft'
     OR EXISTS (SELECT 1 FROM public.budget_approval_requests r WHERE r.project_id = _project AND r.status = 'pending')) THEN
    RAISE EXCEPTION 'this budget goes through board approval (status: %): send the draft for approval instead of publishing it',
      _bstatus USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('kwalis.budget_approval', 'on', true);
  UPDATE public.budget_versions SET status = 'archived'
    WHERE project_id = _project AND status = 'active' AND id <> _version;
  UPDATE public.budget_versions SET status = 'active', published_at = now() WHERE id = _version;
  PERFORM set_config('kwalis.budget_approval', 'off', true);
END;
$$;

-- create_budget_draft (copy of 201) — "206": optional blank draft, and no
-- drafts by board members.
DROP FUNCTION IF EXISTS public.create_budget_draft(uuid, text);
CREATE OR REPLACE FUNCTION public.create_budget_draft(_project uuid, _name text DEFAULT NULL, _blank boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid; _no int; _src uuid; _new uuid;
BEGIN
  SELECT organization_id INTO _org FROM public.projects WHERE id = _project;
  IF NOT public.can_access_project(auth.uid(), _org, _project) THEN
    RAISE EXCEPTION 'Not authorized for this project';
  END IF;
  IF NOT public.is_super_admin(auth.uid()) AND public.is_budget_executive(auth.uid(), _project) THEN   -- 206
    RAISE EXCEPTION 'board members cannot create budget drafts' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(max(version_no), 0) + 1 INTO _no FROM public.budget_versions WHERE project_id = _project;
  SELECT id INTO _src FROM public.budget_versions WHERE project_id = _project AND status = 'active' LIMIT 1;

  INSERT INTO public.budget_versions (project_id, organization_id, version_no, version_name, status, created_by)
  VALUES (_project, _org, _no, left(COALESCE(NULLIF(btrim(_name), ''), 'v' || _no || ' (Draft)'), 120), 'draft', auth.uid())
  RETURNING id INTO _new;

  IF _src IS NOT NULL AND NOT COALESCE(_blank, false) THEN                                           -- 206
    INSERT INTO public.budget_lines (
      project_id, organization_id, version_id, header_code, main_code, description, name, "group",
      amount, rate, currency, unit, x, prep, shooting, wrap, excluded,
      topsheet_code, notes, rebate_eligible, character_id,
      region
    )
    SELECT bl.project_id, bl.organization_id, _new, bl.header_code, bl.main_code, bl.description, bl.name, bl."group",
      bl.amount, bl.rate, bl.currency, bl.unit, bl.x, bl.prep, bl.shooting, bl.wrap, bl.excluded,
      bl.topsheet_code, bl.notes, bl.rebate_eligible, bl.character_id,
      bl.region
    FROM public.budget_lines bl WHERE bl.version_id = _src;
  END IF;
  RETURN _new;
END;
$$;

REVOKE ALL ON FUNCTION public.is_budget_executive(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_submit_budget(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_budget_for_approval(uuid, uuid, uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_budget_approval(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_budget_approval(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.budget_version_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.publish_budget_version(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_budget_draft(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_budget_version() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_budget_version_delete() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_project_budget_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_budget_executive(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_submit_budget(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_budget_for_approval(uuid, uuid, uuid[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_budget_approval(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_budget_approval(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.budget_version_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_budget_version(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_budget_draft(uuid, text, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Legacy pending approvals (budget_approvers) → one pending request
-- ---------------------------------------------------------------------
DO $$
DECLARE r record; v_req uuid;
BEGIN
  FOR r IN
    SELECT p.id AS project_id, p.organization_id, bv.id AS version_id, bv.version_name
      FROM public.projects p
      JOIN public.budget_versions bv ON bv.project_id = p.id AND bv.status = 'active'
     WHERE p.budget_status = 'Pending Approval'
       AND EXISTS (SELECT 1 FROM public.budget_approvers ba WHERE ba.project_id = p.id AND ba.decision = 'pending')
       AND NOT EXISTS (SELECT 1 FROM public.budget_approvers ba WHERE ba.project_id = p.id AND ba.decision = 'rejected')
       AND NOT EXISTS (SELECT 1 FROM public.budget_approval_requests q WHERE q.project_id = p.id AND q.status = 'pending')
  LOOP
    INSERT INTO public.budget_approval_requests(project_id, organization_id, version_id, version_name, kind, status,
           prev_budget_status, legacy, note)
    VALUES (r.project_id, r.organization_id, r.version_id, r.version_name, 'active', 'pending', 'Draft', true,
            'Carried over from the earlier approval list')
    RETURNING id INTO v_req;
    INSERT INTO public.budget_approval_decisions(request_id, project_id, organization_id, approver_id, decision, reason, decided_at)
    SELECT v_req, ba.project_id, r.organization_id, ba.user_id, ba.decision, left(ba.note, 1000), ba.decided_at
      FROM public.budget_approvers ba WHERE ba.project_id = r.project_id;
  END LOOP;
END $$;
