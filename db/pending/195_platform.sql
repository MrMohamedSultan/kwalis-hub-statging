-- =====================================================================
-- 195 — Platform: server-side login lockout, per-org 2FA switch, upload
--       limits, e-mail outbox for notifications, overspend alerts,
--       project counts for billing, per diem totals, central archive of
--       transaction attachments, health check.
--
-- Spec items: X02 X06 X13 X24 X25 X27 D04 D08 (D06 is proved by the test)
--
-- Why
--   * X02  The login lockout lived in the browser (localStorage): another
--     browser or a direct API call skipped it. public.login_throttle now
--     counts failures per e-mail, per IP and per user id in the database.
--       - public.login_throttle_check / login_throttle_record are called by
--         the server sign-in function (src/lib/auth-login.functions.ts) with
--         the service role only. Lock schedule (same as before):
--         5 failures -> 2 min, 8 -> 15 min, 12+ -> 60 min (per e-mail / user);
--         20 failures from one IP within an hour -> 15 min, 40+ -> 60 min.
--       - public.hook_password_verification_attempt(jsonb) is a GoTrue
--         "password verification attempt" hook (a function in public, the
--         auth schema is not touched). Enable it on the self-hosted server:
--           GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_ENABLED=true
--           GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_URI=pg-functions://postgres/public/hook_password_verification_attempt
--         Then the lock also holds for anyone calling /auth/v1/token directly.
--       - A super admin "Force unlock" (existing admin_unlock row in
--         auth_security_log) now also clears the database counters.
--     organizations.require_mfa (default false): an org admin can require
--     two-step verification (TOTP, Supabase Auth MFA) for every member;
--     set through public.set_org_require_mfa(). The app sends members
--     without a verified factor to enrol. public.my_mfa_required() tells
--     the app whether the signed-in user must use it.
--   * X06  Bucket limits (20 MB, documents and images only) on the private
--     upload buckets, ONLY if the bucket rows exist (storage.buckets is
--     data here, its structure is not changed). Buckets stay private.
--     FLAG FOR OWNER: see section 2 for one storage-policy change that is
--     proposed but NOT applied (commented out).
--   * X24/D04  public.notification_email_outbox: every in-app notification
--     about an approval / rejection / payment / overspend is queued for an
--     e-mail to its recipient. The server route
--     /api/public/notifications-dispatch (cron, shared secret) claims rows
--     with public.claim_notification_emails() and reports back with
--     public.mark_notification_email(). Overspend: public.run_budget_alerts()
--     compares Actual + Commitment with the budget of each account code
--     (v_budget_code_position) and notifies at 80 % and 100 % once per
--     crossing (public.budget_alert_log; re-armed when the code drops back
--     below). Recipients: public.budget_alert_responsibles for the code or
--     the whole project; when none are set, the project owner and the
--     organization owners/admins.
--   * X27  public.v_org_project_counts: active / finalized / archived /
--     billable (= not archived) projects per organization, next to
--     max_projects. Creating a project over max_projects is refused for
--     non-platform users, and only the platform owner can change
--     max_projects or subscription_status (org admins could raise their own
--     limit through the "Org admins update orgs" policy).
--   * X13  per_diem_ledger.total_amount is recomputed by the database on
--     every write = shoot_days x on_set_rate + off_days x off_set_rate, so
--     the screen, the ledger view and the reports always agree.
--   * D08  public.supporting_document_links replaces the browser-only
--     (localStorage) "supporting document" links used by the Film Commission
--     export. public.v_project_attachments lists every file attached to a
--     transaction of a project (project-prefixed objects in the private
--     buckets + the per diem / payment request / payment / payroll proofs
--     stored outside the project folder + external links). It is
--     security_invoker, so storage and table RLS decide who sees what.
--   * D06  The test proved that payment_requests were readable (and
--     insertable) by every member of the organization across projects.
--     Section 8 replaces those two policies with project-scoped ones.
--     FLAG FOR OWNER: this is an RLS change.
--   * X25  public.health_check(): a tiny anon-callable function the health
--     endpoint uses to prove the database answers. Returns no data.
--
-- ADDITIVE: new tables, columns (with defaults), functions, triggers and
-- views. No existing data is changed. No existing function or view is
-- redefined. Two existing RLS policies on payment_requests are replaced
-- (section 8). No auth / storage structure is changed.
--
-- Rollback
--   DROP VIEW IF EXISTS public.v_project_attachments, public.v_org_project_counts;
--   DROP TRIGGER IF EXISTS trg_notification_email_outbox ON public.notifications;
--   DROP TRIGGER IF EXISTS trg_admin_unlock_clears_throttle ON public.auth_security_log;
--   DROP TRIGGER IF EXISTS trg_projects_max_projects ON public.projects;
--   DROP TRIGGER IF EXISTS trg_org_billing_fields_guard ON public.organizations;
--   DROP TRIGGER IF EXISTS trg_per_diem_total ON public.per_diem_ledger;
--   DROP FUNCTION IF EXISTS public.login_throttle_check(text,text), public.login_throttle_record(text,text,boolean),
--     public.hook_password_verification_attempt(jsonb), public.login_lock_minutes(integer,text),
--     public.admin_unlock_clears_throttle(), public.set_org_require_mfa(uuid,boolean), public.my_mfa_required(),
--     public.queue_notification_email(), public.claim_notification_emails(integer),
--     public.mark_notification_email(uuid,boolean,text), public.run_budget_alerts(uuid),
--     public.enforce_max_projects(), public.guard_org_billing_fields(), public.per_diem_compute_total(),
--     public.set_supporting_doc_link(text,uuid,text), public.health_check(),
--     public.is_payment_request_approver(uuid);
--   (and re-create the two payment_requests policies, section 8)
--   DROP TABLE IF EXISTS public.login_throttle, public.notification_email_outbox, public.budget_alert_log,
--     public.budget_alert_responsibles, public.supporting_document_links;
--   ALTER TABLE public.organizations DROP COLUMN IF EXISTS require_mfa;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. X02 — login lockout in the database
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_throttle (
  key             text PRIMARY KEY CHECK (length(key) BETWEEN 3 AND 300),
  failed_count    integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  first_failed_at timestamptz,
  last_failed_at  timestamptz,
  locked_until    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.login_throttle IS
  'X02: failed sign-in counters. key = email:<lower email> | ip:<address> | user:<uuid>. Written only by SECURITY DEFINER functions.';
REVOKE ALL ON public.login_throttle FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.login_throttle TO authenticated;
GRANT ALL ON public.login_throttle TO service_role;
ALTER TABLE public.login_throttle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS login_throttle_super_admin_read ON public.login_throttle;
CREATE POLICY login_throttle_super_admin_read ON public.login_throttle
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

-- Lock minutes after the n-th consecutive failure (0 = no new lock).
CREATE OR REPLACE FUNCTION public.login_lock_minutes(_count integer, _kind text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _kind = 'ip' THEN CASE WHEN _count >= 40 THEN 60 WHEN _count = 20 THEN 15 ELSE 0 END
    ELSE CASE WHEN _count >= 12 THEN 60 WHEN _count = 8 THEN 15 WHEN _count = 5 THEN 2 ELSE 0 END
  END
$$;

-- Internal: one failure on one key; returns the row after the update.
CREATE OR REPLACE FUNCTION public.login_throttle_fail(_key text, _kind text)
RETURNS public.login_throttle LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r      public.login_throttle%ROWTYPE;
  v_win  interval := CASE WHEN _kind = 'ip' THEN interval '1 hour' ELSE interval '24 hours' END;
  v_mins integer;
BEGIN
  INSERT INTO public.login_throttle AS lt (key, failed_count, first_failed_at, last_failed_at, updated_at)
  VALUES (_key, 1, now(), now(), now())
  ON CONFLICT (key) DO UPDATE
     SET failed_count = CASE WHEN lt.last_failed_at < now() - v_win THEN 1 ELSE lt.failed_count + 1 END,
         first_failed_at = CASE WHEN lt.last_failed_at < now() - v_win THEN now() ELSE lt.first_failed_at END,
         last_failed_at = now(),
         updated_at = now()
  RETURNING * INTO r;
  v_mins := public.login_lock_minutes(r.failed_count, _kind);
  IF v_mins > 0 THEN
    UPDATE public.login_throttle SET locked_until = now() + make_interval(mins => v_mins)
     WHERE key = _key RETURNING * INTO r;
  END IF;
  RETURN r;
END $$;

-- Is this e-mail / IP locked right now?
CREATE OR REPLACE FUNCTION public.login_throttle_check(_email text, _ip text)
RETURNS TABLE (locked boolean, locked_until timestamptz, failed_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH k AS (
    SELECT 'email:' || lower(btrim(_email)) AS key WHERE COALESCE(btrim(_email), '') <> ''
    UNION ALL SELECT 'ip:' || btrim(_ip) WHERE COALESCE(btrim(_ip), '') <> ''
    UNION ALL SELECT 'user:' || u.id::text FROM auth.users u
               WHERE COALESCE(btrim(_email), '') <> '' AND lower(u.email) = lower(btrim(_email))
  )
  SELECT COALESCE(max(lt.locked_until) > now(), false),
         CASE WHEN max(lt.locked_until) > now() THEN max(lt.locked_until) END,
         COALESCE(max(lt.failed_count) FILTER (WHERE lt.key LIKE 'email:%'), 0)::integer
    FROM k LEFT JOIN public.login_throttle lt ON lt.key = k.key
$$;

-- Record the outcome of one sign-in attempt.
CREATE OR REPLACE FUNCTION public.login_throttle_record(_email text, _ip text, _success boolean)
RETURNS TABLE (failed_count integer, locked_until timestamptz, lock_minutes integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(_email, '')));
  v_ip    text := btrim(COALESCE(_ip, ''));
  r       public.login_throttle%ROWTYPE;
  v_lock  timestamptz;
BEGIN
  IF length(v_email) > 255 OR length(v_ip) > 64 THEN
    RAISE EXCEPTION 'login_throttle_record: value too long' USING ERRCODE = '22001';
  END IF;
  IF _success THEN
    DELETE FROM public.login_throttle lt
     WHERE lt.key = 'email:' || v_email
        OR lt.key IN (SELECT 'user:' || u.id::text FROM auth.users u WHERE lower(u.email) = v_email);
    RETURN QUERY SELECT 0, NULL::timestamptz, 0;
    RETURN;
  END IF;
  IF v_ip <> '' THEN
    r := public.login_throttle_fail('ip:' || v_ip, 'ip');
    v_lock := r.locked_until;
  END IF;
  IF v_email <> '' THEN
    r := public.login_throttle_fail('email:' || v_email, 'email');
    v_lock := GREATEST(v_lock, r.locked_until);
  END IF;
  RETURN QUERY SELECT COALESCE(r.failed_count, 0),
                      CASE WHEN v_lock > now() THEN v_lock END,
                      CASE WHEN v_lock > now() THEN public.login_lock_minutes(COALESCE(r.failed_count, 0), 'email') ELSE 0 END;
END $$;

-- GoTrue password-verification hook: per user lock that also covers direct API calls.
CREATE OR REPLACE FUNCTION public.hook_password_verification_attempt(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  text := event ->> 'user_id';
  v_valid boolean := COALESCE((event ->> 'valid')::boolean, false);
  v_key   text;
  v_until timestamptz;
BEGIN
  IF v_user IS NULL OR v_user = '' THEN
    RETURN jsonb_build_object('decision', 'continue');
  END IF;
  v_key := 'user:' || v_user;
  SELECT lt.locked_until INTO v_until FROM public.login_throttle lt WHERE lt.key = v_key;
  IF v_until > now() THEN
    RETURN jsonb_build_object('decision', 'reject',
      'message', 'Too many failed sign-in attempts. Try again later.',
      'should_logout_user', false);
  END IF;
  IF v_valid THEN
    DELETE FROM public.login_throttle WHERE key = v_key;
  ELSE
    PERFORM public.login_throttle_fail(v_key, 'user');
  END IF;
  RETURN jsonb_build_object('decision', 'continue');
END $$;

REVOKE ALL ON FUNCTION public.login_throttle_fail(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.login_throttle_check(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.login_throttle_record(text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hook_password_verification_attempt(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_throttle_check(text, text),
  public.login_throttle_record(text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.hook_password_verification_attempt(jsonb) TO supabase_auth_admin, service_role;

-- A super admin's existing "Force unlock" also clears the database counters.
CREATE OR REPLACE FUNCTION public.admin_unlock_clears_throttle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.event_type = 'admin_unlock' AND NEW.email IS NOT NULL THEN
    DELETE FROM public.login_throttle
     WHERE key = 'email:' || lower(NEW.email)
        OR key IN (SELECT 'user:' || u.id::text FROM auth.users u WHERE lower(u.email) = lower(NEW.email));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.admin_unlock_clears_throttle() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_admin_unlock_clears_throttle ON public.auth_security_log;
CREATE TRIGGER trg_admin_unlock_clears_throttle
  AFTER INSERT ON public.auth_security_log
  FOR EACH ROW EXECUTE FUNCTION public.admin_unlock_clears_throttle();

-- Per organization two-step verification switch.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS require_mfa boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_org_require_mfa(_org uuid, _on boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), _org)) THEN
    RAISE EXCEPTION 'Only an organization admin can change two-step verification' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organizations SET require_mfa = COALESCE(_on, false) WHERE id = _org;
END $$;

CREATE OR REPLACE FUNCTION public.my_mfa_required()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
     WHERE om.user_id = auth.uid() AND o.require_mfa)
$$;
REVOKE ALL ON FUNCTION public.set_org_require_mfa(uuid, boolean), public.my_mfa_required() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_org_require_mfa(uuid, boolean), public.my_mfa_required() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. X06 — upload limits on the private buckets (data, not structure)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets
       SET public = false,
           file_size_limit = 20971520,          -- 20 MB, same as src/lib/upload-policy.ts
           allowed_mime_types = ARRAY[
             'application/pdf',
             'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
             'application/msword',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/vnd.ms-excel',
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             'application/vnd.ms-powerpoint',
             'application/vnd.openxmlformats-officedocument.presentationml.presentation',
             'text/csv', 'text/plain', 'application/zip', 'application/x-zip-compressed',
             'application/octet-stream']
     WHERE id IN ('contracts', 'project-documents', 'receipts', 'org-documents', 'support-attachments');
  END IF;
END $$;
-- PROPOSED, NOT APPLIED (owner decision, see docs/SECURITY_GAPS.md):
-- the policy "Org members can read contracts" lets any member of an
-- organization read every file of every project of that organization in
-- the contracts bucket. Files saved under a project folder are already
-- covered by "Project members can read contract files by project". Before
-- dropping the org-wide policy, move the files that are not under a
-- project folder (per-diem/..., payroll/..., payment_requests/... written
-- by older app versions), otherwise they become unreadable:
--   DROP POLICY IF EXISTS "Org members can read contracts" ON storage.objects;

-- ---------------------------------------------------------------------
-- 3. X24 / D04 — e-mail outbox for notifications
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_email_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE,
  organization_id uuid,
  project_id      uuid,
  user_id         uuid NOT NULL,
  to_email        text NOT NULL CHECK (length(to_email) <= 320),
  category        text NOT NULL,
  subject         text NOT NULL CHECK (length(subject) <= 300),
  body            text NOT NULL CHECK (length(body) <= 5000),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  locked_at       timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_email_outbox_notification_uq
  ON public.notification_email_outbox (notification_id);
CREATE INDEX IF NOT EXISTS notification_email_outbox_pending_idx
  ON public.notification_email_outbox (status, created_at);
REVOKE ALL ON public.notification_email_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_email_outbox TO authenticated;
GRANT ALL ON public.notification_email_outbox TO service_role;
ALTER TABLE public.notification_email_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_email_outbox_read ON public.notification_email_outbox;
CREATE POLICY notification_email_outbox_read ON public.notification_email_outbox
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR user_id = auth.uid()
         OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)));

CREATE OR REPLACE FUNCTION public.queue_notification_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.category NOT IN ('payment_approval', 'budget_alert') THEN
    RETURN NEW;
  END IF;
  SELECT u.email INTO v_email FROM auth.users u
   WHERE u.id = NEW.user_id AND u.deleted_at IS NULL
     AND (u.banned_until IS NULL OR u.banned_until < now());
  IF COALESCE(v_email, '') = '' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.notification_email_outbox
    (notification_id, organization_id, project_id, user_id, to_email, category, subject, body)
  VALUES (NEW.id, NEW.organization_id, NEW.project_id, NEW.user_id, v_email, NEW.category,
          left('Kwalis HUB — ' || NEW.title, 300), left(COALESCE(NEW.body, NEW.title), 5000))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_notification_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notification_email_outbox ON public.notifications;
CREATE TRIGGER trg_notification_email_outbox
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.queue_notification_email();

-- Dispatcher: take up to _limit e-mails (stale "sending" rows come back after 10 min).
CREATE OR REPLACE FUNCTION public.claim_notification_emails(_limit integer DEFAULT 20)
RETURNS SETOF public.notification_email_outbox
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notification_email_outbox o
     SET status = 'sending', locked_at = now(), attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT id FROM public.notification_email_outbox
      WHERE attempts < 5
        AND (status = 'pending' OR (status = 'sending' AND locked_at < now() - interval '10 minutes'))
      ORDER BY created_at
      LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 100)
      FOR UPDATE SKIP LOCKED)
  RETURNING o.*
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_email(_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notification_email_outbox
     SET status = CASE WHEN _ok THEN 'sent' WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
         sent_at = CASE WHEN _ok THEN now() END,
         locked_at = NULL,
         last_error = CASE WHEN _ok THEN NULL ELSE left(_error, 500) END
   WHERE id = _id
$$;
REVOKE ALL ON FUNCTION public.claim_notification_emails(integer),
  public.mark_notification_email(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_emails(integer),
  public.mark_notification_email(uuid, boolean, text) TO service_role;

-- Overspend alerts: who is responsible for a code (budget_code NULL = whole project).
CREATE TABLE IF NOT EXISTS public.budget_alert_responsibles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  budget_code     text CHECK (budget_code IS NULL OR length(budget_code) <= 40),
  user_id         uuid NOT NULL,
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS budget_alert_responsibles_uq
  ON public.budget_alert_responsibles (project_id, COALESCE(budget_code, ''), user_id);
REVOKE ALL ON public.budget_alert_responsibles FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.budget_alert_responsibles TO authenticated;
GRANT ALL ON public.budget_alert_responsibles TO service_role;
ALTER TABLE public.budget_alert_responsibles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_alert_responsibles_read ON public.budget_alert_responsibles;
CREATE POLICY budget_alert_responsibles_read ON public.budget_alert_responsibles
  FOR SELECT TO authenticated USING (public.can_access_project(auth.uid(), organization_id, project_id));
DROP POLICY IF EXISTS budget_alert_responsibles_write ON public.budget_alert_responsibles;
CREATE POLICY budget_alert_responsibles_write ON public.budget_alert_responsibles
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.organization_id = budget_alert_responsibles.organization_id)
              AND (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id))
              AND public.is_org_member(user_id, organization_id));
DROP POLICY IF EXISTS budget_alert_responsibles_delete ON public.budget_alert_responsibles;
CREATE POLICY budget_alert_responsibles_delete ON public.budget_alert_responsibles
  FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id));

CREATE TABLE IF NOT EXISTS public.budget_alert_log (
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  budget_code  text NOT NULL,
  threshold    smallint NOT NULL CHECK (threshold IN (80, 100)),
  budget_sar   numeric NOT NULL,
  spent_sar    numeric NOT NULL,
  notified_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, budget_code, threshold)
);
REVOKE ALL ON public.budget_alert_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.budget_alert_log TO authenticated;
GRANT ALL ON public.budget_alert_log TO service_role;
ALTER TABLE public.budget_alert_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_alert_log_read ON public.budget_alert_log;
CREATE POLICY budget_alert_log_read ON public.budget_alert_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id
                  AND public.can_access_project(auth.uid(), p.organization_id, p.id)));

-- Compare Actual + Commitment with each code's budget; notify once per crossing.
-- Signed-in caller: one project they can access. Service role (cron): every live project.
CREATE OR REPLACE FUNCTION public.run_budget_alerts(_project uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_sent  integer := 0;
  v_n     integer;
  rec     record;
  v_th    smallint;
  v_top   smallint;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF _project IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.projects p WHERE p.id = _project
            AND public.can_access_project(v_uid, p.organization_id, p.id)) THEN
      RAISE EXCEPTION 'run_budget_alerts: no access to this project' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR rec IN
    SELECT bp.project_id, bp.organization_id, bp.budget_code, pr.owner_id, pr.name AS project_name,
           bp.budget_sar, (bp.actual_sar + bp.committed_sar) AS spent_sar,
           round((bp.actual_sar + bp.committed_sar) / bp.budget_sar * 100, 1) AS pct
      FROM public.v_budget_code_position bp
      JOIN public.projects pr ON pr.id = bp.project_id
     WHERE bp.budget_code IS NOT NULL AND bp.budget_sar > 0
       AND (_project IS NULL OR bp.project_id = _project)
       AND pr.archived_at IS NULL
  LOOP
    -- re-arm thresholds the code is back under
    DELETE FROM public.budget_alert_log l
     WHERE l.project_id = rec.project_id AND l.budget_code = rec.budget_code AND l.threshold > rec.pct;

    v_top := CASE WHEN rec.pct >= 100 THEN 100 WHEN rec.pct >= 80 THEN 80 END;
    CONTINUE WHEN v_top IS NULL;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.budget_alert_log l
                           WHERE l.project_id = rec.project_id AND l.budget_code = rec.budget_code
                             AND l.threshold = v_top);
    FOREACH v_th IN ARRAY ARRAY[80, 100]::smallint[] LOOP
      IF v_th <= v_top THEN
        INSERT INTO public.budget_alert_log (project_id, budget_code, threshold, budget_sar, spent_sar)
        VALUES (rec.project_id, rec.budget_code, v_th, rec.budget_sar, rec.spent_sar)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;

    INSERT INTO public.notifications (organization_id, project_id, user_id, severity, category, title, body, metadata)
    SELECT rec.organization_id, rec.project_id, r.user_id,
           CASE WHEN v_top = 100 THEN 'critical' ELSE 'warning' END,
           'budget_alert',
           'Budget code ' || rec.budget_code || ' reached ' || v_top || '% of its budget',
           rec.project_name || ' — ' || rec.budget_code || ': Actual + Commitment SAR '
             || to_char(rec.spent_sar, 'FM999,999,999,990.00') || ' of SAR '
             || to_char(rec.budget_sar, 'FM999,999,999,990.00') || ' (' || rec.pct || '%)',
           jsonb_build_object('budget_code', rec.budget_code, 'threshold', v_top, 'pct', rec.pct,
                              'spent_sar', round(rec.spent_sar, 2), 'budget_sar', round(rec.budget_sar, 2),
                              'project_name', rec.project_name)
      FROM (
        SELECT DISTINCT x.user_id FROM (
          SELECT bar.user_id FROM public.budget_alert_responsibles bar
           WHERE bar.project_id = rec.project_id
             AND (bar.budget_code IS NULL OR bar.budget_code = rec.budget_code)
          UNION ALL
          SELECT d.user_id FROM (
            SELECT rec.owner_id AS user_id
            UNION ALL
            SELECT om.user_id FROM public.organization_members om
             WHERE om.organization_id = rec.organization_id AND om.role IN ('owner', 'admin')
          ) d
           WHERE NOT EXISTS (SELECT 1 FROM public.budget_alert_responsibles bar
                              WHERE bar.project_id = rec.project_id
                                AND (bar.budget_code IS NULL OR bar.budget_code = rec.budget_code))
        ) x WHERE x.user_id IS NOT NULL
      ) r;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_sent := v_sent + v_n;
  END LOOP;
  RETURN v_sent;
END $$;
REVOKE ALL ON FUNCTION public.run_budget_alerts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_budget_alerts(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. X27 — projects per organization for billing; limit enforced
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_org_project_counts WITH (security_invoker = on) AS
SELECT o.id AS organization_id,
       o.name,
       o.max_projects,
       o.subscription_status,
       count(p.id) FILTER (WHERE p.archived_at IS NULL AND p.status NOT IN ('Archived', 'Finalized'))::integer AS active_projects,
       count(p.id) FILTER (WHERE p.archived_at IS NULL AND p.status = 'Finalized')::integer AS finalized_projects,
       count(p.id) FILTER (WHERE p.archived_at IS NOT NULL OR p.status = 'Archived')::integer AS archived_projects,
       count(p.id) FILTER (WHERE p.archived_at IS NULL AND p.status <> 'Archived')::integer AS billable_projects,
       count(p.id)::integer AS total_projects
  FROM public.organizations o
  LEFT JOIN public.projects p ON p.organization_id = o.id
 GROUP BY o.id, o.name, o.max_projects, o.subscription_status;
COMMENT ON VIEW public.v_org_project_counts IS
  'X27: projects per organization for billing. billable = not archived (active + finalized). security_invoker: a member sees only their organizations, the platform owner sees all.';
REVOKE ALL ON public.v_org_project_counts FROM PUBLIC, anon;
GRANT SELECT ON public.v_org_project_counts TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_max_projects()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max   integer;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR current_setting('role', true) IS DISTINCT FROM 'authenticated'
     OR public.is_super_admin(auth.uid()) OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT o.max_projects INTO v_max FROM public.organizations o WHERE o.id = NEW.organization_id;
  IF v_max IS NULL OR v_max <= 0 THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count FROM public.projects p
   WHERE p.organization_id = NEW.organization_id AND p.archived_at IS NULL AND p.status <> 'Archived';
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Project limit reached: this organization''s plan allows % projects', v_max
      USING ERRCODE = '42501', HINT = 'project_limit_reached';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_max_projects() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_projects_max_projects ON public.projects;
CREATE TRIGGER trg_projects_max_projects
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_max_projects();

CREATE OR REPLACE FUNCTION public.guard_org_billing_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND current_setting('role', true) = 'authenticated'
     AND NOT public.is_super_admin(auth.uid())
     AND (NEW.max_projects IS DISTINCT FROM OLD.max_projects
          OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status) THEN
    RAISE EXCEPTION 'Only the platform owner can change the plan limits of an organization'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_org_billing_fields() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_org_billing_fields_guard ON public.organizations;
CREATE TRIGGER trg_org_billing_fields_guard
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.guard_org_billing_fields();

-- ---------------------------------------------------------------------
-- 5. X13 — per diem total always = days x rates
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.per_diem_compute_total()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.total_amount := round(COALESCE(NEW.shoot_days, 0) * COALESCE(NEW.on_set_rate, 0)
                          + COALESCE(NEW.off_days, 0) * COALESCE(NEW.off_set_rate, 0), 2);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_per_diem_total ON public.per_diem_ledger;
CREATE TRIGGER trg_per_diem_total
  BEFORE INSERT OR UPDATE OF shoot_days, off_days, on_set_rate, off_set_rate, total_amount
  ON public.per_diem_ledger
  FOR EACH ROW EXECUTE FUNCTION public.per_diem_compute_total();

-- ---------------------------------------------------------------------
-- 6. D08 — supporting document links on the server + central archive
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supporting_document_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_kind     text NOT NULL CHECK (source_kind IN ('invoice', 'receipt', 'payroll')),
  source_id       uuid NOT NULL,
  url             text NOT NULL CHECK (length(url) <= 2000 AND url ~* '^https?://'),
  updated_by      uuid DEFAULT auth.uid(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id)
);
REVOKE ALL ON public.supporting_document_links FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supporting_document_links TO authenticated;
GRANT ALL ON public.supporting_document_links TO service_role;
ALTER TABLE public.supporting_document_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supporting_document_links_select ON public.supporting_document_links;
CREATE POLICY supporting_document_links_select ON public.supporting_document_links
  FOR SELECT TO authenticated USING (public.can_access_project(auth.uid(), organization_id, project_id));
DROP POLICY IF EXISTS supporting_document_links_insert ON public.supporting_document_links;
CREATE POLICY supporting_document_links_insert ON public.supporting_document_links
  FOR INSERT TO authenticated WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id));
DROP POLICY IF EXISTS supporting_document_links_update ON public.supporting_document_links;
CREATE POLICY supporting_document_links_update ON public.supporting_document_links
  FOR UPDATE TO authenticated USING (public.can_access_project(auth.uid(), organization_id, project_id))
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id));
DROP POLICY IF EXISTS supporting_document_links_delete ON public.supporting_document_links;
CREATE POLICY supporting_document_links_delete ON public.supporting_document_links
  FOR DELETE TO authenticated USING (public.can_access_project(auth.uid(), organization_id, project_id));

-- Set / clear a link; the project is taken from the document itself, never from the caller.
CREATE OR REPLACE FUNCTION public.set_supporting_doc_link(_kind text, _source uuid, _url text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_proj uuid;
  v_org  uuid;
  v_url  text := NULLIF(btrim(COALESCE(_url, '')), '');
BEGIN
  IF _kind = 'invoice' THEN
    SELECT project_id, organization_id INTO v_proj, v_org FROM public.invoices WHERE id = _source;
  ELSIF _kind = 'receipt' THEN
    SELECT project_id, organization_id INTO v_proj, v_org FROM public.cash_advance_receipts WHERE id = _source;
  ELSIF _kind = 'payroll' THEN
    SELECT project_id, organization_id INTO v_proj, v_org FROM public.payroll WHERE id = _source;
  ELSE
    RAISE EXCEPTION 'Unknown document kind %', _kind USING ERRCODE = '22023';
  END IF;
  IF v_proj IS NULL THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  IF v_url IS NULL THEN
    DELETE FROM public.supporting_document_links WHERE source_kind = _kind AND source_id = _source;
  ELSE
    INSERT INTO public.supporting_document_links (organization_id, project_id, source_kind, source_id, url)
    VALUES (v_org, v_proj, _kind, _source, v_url)
    ON CONFLICT (source_kind, source_id) DO UPDATE
      SET url = EXCLUDED.url, updated_at = now(), updated_by = auth.uid();
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_supporting_doc_link(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_supporting_doc_link(text, uuid, text) TO authenticated, service_role;

-- Every file attached to a transaction of a project.
CREATE OR REPLACE VIEW public.v_project_attachments WITH (security_invoker = on) AS
WITH obj AS (
  SELECT o.bucket_id, o.name, o.created_at,
         NULLIF(o.metadata ->> 'size', '')::bigint AS size_bytes,
         o.metadata ->> 'mimetype' AS mime_type,
         split_part(o.name, '/', 1) AS seg1,
         split_part(o.name, '/', 2) AS seg2,
         split_part(o.name, '/', 3) AS seg3
    FROM storage.objects o
   WHERE o.bucket_id IN ('contracts', 'project-documents', 'receipts')
), files AS (
  -- objects stored under the project folder: {project}/{kind}/{document id}/...
  SELECT p.id AS project_id, p.organization_id,
         CASE obj.seg2
           WHEN 'invoices' THEN 'invoice'
           WHEN 'petty-cash' THEN 'petty_cash'
           WHEN 'per-diem' THEN 'per_diem'
           WHEN 'crew' THEN 'crew_contract'
           WHEN 'cast' THEN 'cast_contract'
           WHEN 'payroll' THEN 'payroll'
           WHEN 'payment_requests' THEN 'payment_request'
           WHEN 'locations' THEN 'location'
           ELSE 'other' END AS source_type,
         CASE WHEN obj.seg3 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN obj.seg3::uuid END AS source_id,
         obj.bucket_id, obj.name AS storage_path, NULL::text AS external_url,
         regexp_replace(obj.name, '^.*/', '') AS file_name,
         obj.size_bytes, obj.mime_type, obj.created_at AS attached_at
    FROM obj
    JOIN public.projects p ON p.id::text = obj.seg1
   WHERE obj.seg3 <> ''        -- library files ({project}/{file}) stay in the File Library
  UNION ALL
  -- proofs saved outside the project folder by older app versions
  SELECT d.project_id, d.organization_id, 'per_diem', d.id, 'contracts', d.receipt_path, NULL,
         regexp_replace(d.receipt_path, '^.*/', ''), NULL::bigint, NULL::text, d.updated_at
    FROM public.per_diem_ledger d
   WHERE COALESCE(d.receipt_path, '') <> '' AND split_part(d.receipt_path, '/', 1) <> d.project_id::text
  UNION ALL
  SELECT pr.project_id, pr.organization_id, 'payment_request', pr.id, 'contracts', pr.proof_path, NULL,
         regexp_replace(pr.proof_path, '^.*/', ''), NULL::bigint, NULL::text, pr.updated_at
    FROM public.payment_requests pr
   WHERE COALESCE(pr.proof_path, '') <> '' AND split_part(pr.proof_path, '/', 1) <> pr.project_id::text
  UNION ALL
  SELECT pay.project_id, pay.organization_id, 'payment', pay.id, 'contracts', pay.proof_path, NULL,
         regexp_replace(pay.proof_path, '^.*/', ''), NULL::bigint, NULL::text, pay.created_at
    FROM public.payments pay
   WHERE COALESCE(pay.proof_path, '') <> '' AND split_part(pay.proof_path, '/', 1) <> pay.project_id::text
  UNION ALL
  SELECT pa.project_id, pa.organization_id, 'payroll', pa.id, 'contracts', e.proof, NULL,
         regexp_replace(e.proof, '^.*/', ''), NULL::bigint, NULL::text, pa.created_at
    FROM public.payroll pa
    CROSS JOIN LATERAL (
      SELECT DISTINCT COALESCE(NULLIF(x ->> 'proofPath', ''), NULLIF(x ->> 'receiptPath', '')) AS proof
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pa.payment_schedule) = 'array'
                                       THEN pa.payment_schedule ELSE '[]'::jsonb END
                                  || CASE WHEN jsonb_typeof(pa.ledger) = 'array'
                                          THEN pa.ledger ELSE '[]'::jsonb END) x
    ) e
   WHERE e.proof IS NOT NULL AND split_part(e.proof, '/', 1) <> pa.project_id::text
  UNION ALL
  -- external links (invoice attachment URL, supporting document links)
  SELECT i.project_id, i.organization_id, 'invoice', i.id, NULL, NULL, i.attachment_url,
         i.attachment_url, NULL::bigint, NULL::text, i.created_at
    FROM public.invoices i
   WHERE COALESCE(i.attachment_url, '') ~* '^https?://'
  UNION ALL
  SELECT s.project_id, s.organization_id,
         CASE s.source_kind WHEN 'receipt' THEN 'petty_cash' ELSE s.source_kind END,
         s.source_id, NULL, NULL, s.url, s.url, NULL::bigint, NULL::text, s.updated_at
    FROM public.supporting_document_links s
)
SELECT f.project_id, f.organization_id, f.source_type, f.source_id,
       COALESCE(i.ref_no, i.invoice_no, r.ref_no, pd.ref_no, pay.ref_no, pa.ref_no) AS reference,
       COALESCE(i.vendor_name, r.vendor, r.recipient, pe.full_name, pr.source_label, pa.name) AS counterparty,
       f.bucket_id, f.storage_path, f.external_url, f.file_name, f.size_bytes, f.mime_type, f.attached_at
  FROM files f
  LEFT JOIN public.invoices i ON f.source_type = 'invoice' AND i.id = f.source_id
  LEFT JOIN public.cash_advance_receipts r ON f.source_type = 'petty_cash' AND r.id = f.source_id
  LEFT JOIN public.per_diem_ledger pd ON f.source_type = 'per_diem' AND pd.id = f.source_id
  LEFT JOIN public.people pe ON pe.id = pd.person_id
  LEFT JOIN public.payment_requests pr ON f.source_type = 'payment_request' AND pr.id = f.source_id
  LEFT JOIN public.payments pay ON f.source_type = 'payment' AND pay.id = f.source_id
  LEFT JOIN public.payroll pa ON f.source_type IN ('payroll', 'crew_contract', 'cast_contract') AND pa.id = f.source_id;
COMMENT ON VIEW public.v_project_attachments IS
  'D08: files and links attached to the transactions of a project. security_invoker: storage.objects and table RLS decide visibility; downloads go through signed URLs.';
REVOKE ALL ON public.v_project_attachments FROM PUBLIC, anon;
GRANT SELECT ON public.v_project_attachments TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. X25 — health check
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.health_check()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object('ok', true, 'at', now())
$$;
REVOKE ALL ON FUNCTION public.health_check() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.health_check() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. D06 — payment requests were readable by every member of the
--    organization, across projects (found by db/tests/195_platform.sql).
--    FLAG FOR OWNER: this changes two RLS policies.
--    Read: project access (can_access_project), the requester, org admins,
--    and whoever can approve one of the request's levels (176 chain).
--    Insert: the requester must have access to the request's project.
--    Rollback: re-create the two policies from the live schema
--    (payment_requests_select_org_members / payment_requests_insert_org_members).
-- ---------------------------------------------------------------------
-- true when the signed-in user can approve one of the request's levels
CREATE OR REPLACE FUNCTION public.is_payment_request_approver(_request uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.payment_requests pr
     CROSS JOIN LATERAL public.payment_request_required_levels(pr.id) l
     WHERE pr.id = _request
       AND public.payment_approver_matches(auth.uid(), pr.organization_id, pr.project_id,
                                           l.approver_kind, l.role_id))
$$;
REVOKE ALL ON FUNCTION public.is_payment_request_approver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_payment_request_approver(uuid) TO authenticated, service_role;
DROP POLICY IF EXISTS payment_requests_select_org_members ON public.payment_requests;
DROP POLICY IF EXISTS payment_requests_select_project_scope ON public.payment_requests;
CREATE POLICY payment_requests_select_project_scope ON public.payment_requests
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR requested_by = auth.uid()
         OR public.is_org_admin(auth.uid(), organization_id)
         OR public.can_access_project(auth.uid(), organization_id, project_id)
         OR public.is_payment_request_approver(id));
DROP POLICY IF EXISTS payment_requests_insert_org_members ON public.payment_requests;
DROP POLICY IF EXISTS payment_requests_insert_project_scope ON public.payment_requests;
CREATE POLICY payment_requests_insert_project_scope ON public.payment_requests
  FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid()
              AND (public.is_super_admin(auth.uid())
                   OR public.can_access_project(auth.uid(), organization_id, project_id)));
