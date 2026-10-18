-- =====================================================================
-- D23 (+ D08) — platform administration of users and companies
--   table public.user_account_controls
--   RPC   public.admin_disable_user(user, disabled, reason)
--   RPC   public.admin_force_logout(user)
--   RPC   public.admin_require_password_change(user, required)        [D08]
--   RPC   public.admin_suspend_company(org, suspend, confirm_name)
--   RPC   public.my_account_status()         what the app's sign-in gate reads
--   RPC   public.clear_my_password_change_requirement()                [D08]
--
-- SECURITY CHANGE — per SECURITY.md apply only after the owner approves.
--
-- What SQL can and cannot do here. The rules forbid touching the auth schema,
-- so these functions RECORD the decision (who, when, why — audited) and the
-- rest is done by the server functions in src/lib/platform-admin.functions.ts,
-- which call the Supabase admin API with the service role:
--
--   action               recorded here            enforced by
--   disable user         disabled = true          auth ban (server fn) + sign-in gate
--   force sign-out       sessions_revoked_at      sign-in gate compares session start
--   must change password must_change_password     sign-in gate redirects to the form
--   suspend company      subscription_status      sign-in gate blocks the tenant shell
--   reset password       —                        existing adminResetUserPassword()
--
-- There is deliberately NO SQL function named admin_reset_password: a
-- password can only be set through the auth admin API. Use the server
-- function that already exists.
--
-- ADDITIVE. Rollback:
--   DROP FUNCTION public.clear_my_password_change_requirement();
--   DROP FUNCTION public.my_account_status();
--   DROP FUNCTION public.admin_suspend_company(uuid, boolean, text);
--   DROP FUNCTION public.admin_require_password_change(uuid, boolean);
--   DROP FUNCTION public.admin_force_logout(uuid);
--   DROP FUNCTION public.admin_disable_user(uuid, boolean, text);
--   DROP TABLE    public.user_account_controls;
-- =====================================================================
CREATE TABLE public.user_account_controls (
  user_id              uuid PRIMARY KEY,
  disabled             boolean NOT NULL DEFAULT false,
  disabled_reason      text CHECK (disabled_reason IS NULL OR length(disabled_reason) <= 500),
  disabled_at          timestamptz,
  disabled_by          uuid,
  sessions_revoked_at  timestamptz,
  must_change_password boolean NOT NULL DEFAULT false,
  updated_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
-- log_audit_history() reads NEW.id: expose the key under that name too.
ALTER TABLE public.user_account_controls ADD COLUMN id uuid GENERATED ALWAYS AS (user_id) STORED;

GRANT SELECT ON public.user_account_controls TO authenticated;   -- every write goes through the RPCs
GRANT ALL ON public.user_account_controls TO service_role;
REVOKE ALL ON public.user_account_controls FROM anon;
ALTER TABLE public.user_account_controls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own account controls"
  ON public.user_account_controls FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE TRIGGER trg_audit_history_user_account_controls
  AFTER INSERT OR UPDATE OR DELETE ON public.user_account_controls
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- ---------------------------------------------------------------------
-- shared guard: caller must be the platform owner
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_super_admin(p_action text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION '%: only a platform super admin can do this', p_action USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END;
$$;

-- ---------------------------------------------------------------------
-- admin_disable_user
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_disable_user(
  p_user_id  uuid,
  p_disabled boolean DEFAULT true,
  p_reason   text    DEFAULT NULL
)
RETURNS public.user_account_controls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.assert_super_admin('admin_disable_user');
  v_row public.user_account_controls;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p_user_id) THEN
    RAISE EXCEPTION 'admin_disable_user: user not found' USING ERRCODE = '22023';
  END IF;
  IF p_disabled THEN
    IF p_user_id = v_uid THEN
      RAISE EXCEPTION 'admin_disable_user: you cannot disable your own account' USING ERRCODE = '42501';
    END IF;
    -- never leave the platform without an active owner
    IF public.is_super_admin(p_user_id) AND NOT EXISTS (
         SELECT 1 FROM public.user_roles ur
         LEFT JOIN public.user_account_controls c ON c.user_id = ur.user_id
         WHERE ur.role = 'super_admin' AND ur.user_id <> p_user_id AND NOT COALESCE(c.disabled, false)) THEN
      RAISE EXCEPTION 'admin_disable_user: this is the last active super admin' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.user_account_controls AS c
         (user_id, disabled, disabled_reason, disabled_at, disabled_by, sessions_revoked_at, updated_by, updated_at)
  VALUES (p_user_id, p_disabled,
          CASE WHEN p_disabled THEN NULLIF(btrim(p_reason), '') END,
          CASE WHEN p_disabled THEN now() END,
          CASE WHEN p_disabled THEN v_uid END,
          CASE WHEN p_disabled THEN now() END,
          v_uid, now())
  ON CONFLICT (user_id) DO UPDATE SET
    disabled            = EXCLUDED.disabled,
    disabled_reason     = EXCLUDED.disabled_reason,
    disabled_at         = EXCLUDED.disabled_at,
    disabled_by         = EXCLUDED.disabled_by,
    -- disabling also revokes the sessions that are open right now
    sessions_revoked_at = COALESCE(EXCLUDED.sessions_revoked_at, c.sessions_revoked_at),
    updated_by          = v_uid,
    updated_at          = now()
  RETURNING c.* INTO v_row;
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------
-- admin_force_logout — every session started before now is no longer accepted
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_force_logout(p_user_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.assert_super_admin('admin_force_logout');
  v_at  timestamptz := now();
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p_user_id) THEN
    RAISE EXCEPTION 'admin_force_logout: user not found' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.user_account_controls AS c (user_id, sessions_revoked_at, updated_by, updated_at)
  VALUES (p_user_id, v_at, v_uid, v_at)
  ON CONFLICT (user_id) DO UPDATE SET sessions_revoked_at = v_at, updated_by = v_uid, updated_at = v_at;
  RETURN v_at;
END;
$$;

-- ---------------------------------------------------------------------
-- D08 — force a password change at next sign-in
-- ---------------------------------------------------------------------
-- Callable by a super admin, or by an organization admin for a member of an
-- organization they administer (they are the ones who create accounts by hand).
CREATE OR REPLACE FUNCTION public.admin_require_password_change(p_user_id uuid, p_required boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'admin_require_password_change: not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_super_admin(v_uid) AND NOT EXISTS (
       SELECT 1 FROM public.organization_members target
       WHERE target.user_id = p_user_id AND public.is_org_admin(v_uid, target.organization_id)) THEN
    RAISE EXCEPTION 'admin_require_password_change: not allowed for this user' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.user_account_controls AS c (user_id, must_change_password, updated_by, updated_at)
  VALUES (p_user_id, p_required, v_uid, now())
  ON CONFLICT (user_id) DO UPDATE SET must_change_password = p_required, updated_by = v_uid, updated_at = now();
  RETURN p_required;
END;
$$;

-- The signed-in user clears their own flag — called by the server function
-- right after it has actually changed the password through the auth API.
CREATE OR REPLACE FUNCTION public.clear_my_password_change_requirement()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'clear_my_password_change_requirement: not signed in' USING ERRCODE = '42501';
  END IF;
  UPDATE public.user_account_controls
     SET must_change_password = false, updated_by = auth.uid(), updated_at = now()
   WHERE user_id = auth.uid() AND must_change_password;
END;
$$;

-- ---------------------------------------------------------------------
-- admin_suspend_company
-- ---------------------------------------------------------------------
-- p_confirm_name must equal the company name (the UI makes the admin type it).
-- Suspending sets subscription_status = 'suspended'; lifting it sets 'active'.
CREATE OR REPLACE FUNCTION public.admin_suspend_company(
  p_org_id       uuid,
  p_suspend      boolean DEFAULT true,
  p_confirm_name text    DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := public.assert_super_admin('admin_suspend_company');
  v_name text; v_old text; v_new text;
BEGIN
  SELECT o.name, o.subscription_status INTO v_name, v_old FROM public.organizations o WHERE o.id = p_org_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'admin_suspend_company: company not found' USING ERRCODE = '22023';
  END IF;
  IF p_suspend AND lower(btrim(COALESCE(p_confirm_name, ''))) <> lower(btrim(v_name)) THEN
    RAISE EXCEPTION 'admin_suspend_company: type the company name exactly to confirm' USING ERRCODE = '22023';
  END IF;
  v_new := CASE WHEN p_suspend THEN 'suspended' ELSE 'active' END;
  IF lower(COALESCE(v_old, '')) IS DISTINCT FROM v_new THEN
    UPDATE public.organizations SET subscription_status = v_new, updated_at = now() WHERE id = p_org_id;
    INSERT INTO public.audit_logs (organization_id, actor_id, category, action, severity, entity, summary, details)
    VALUES (p_org_id, v_uid, 'other',
            CASE WHEN p_suspend THEN 'company.suspended' ELSE 'company.reactivated' END,
            'warning', 'organization',
            CASE WHEN p_suspend THEN 'Company suspended: ' ELSE 'Company reactivated: ' END || v_name,
            jsonb_build_object('previous_status', v_old, 'new_status', v_new));
  END IF;
  RETURN v_new;
END;
$$;

-- ---------------------------------------------------------------------
-- my_account_status — one cheap call for the sign-in gate
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_account_status()
RETURNS TABLE (
  disabled             boolean,
  disabled_reason      text,
  sessions_revoked_at  timestamptz,
  must_change_password boolean,
  suspended_org_ids    uuid[],
  all_orgs_suspended   boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(c.disabled, false),
         c.disabled_reason,
         c.sessions_revoked_at,
         COALESCE(c.must_change_password, false),
         COALESCE(o.suspended, '{}'::uuid[]),
         (o.total > 0 AND o.total = COALESCE(array_length(o.suspended, 1), 0)
          AND NOT public.is_super_admin(auth.uid()))
  FROM (SELECT auth.uid() AS uid) me
  LEFT JOIN public.user_account_controls c ON c.user_id = me.uid
  CROSS JOIN LATERAL (
    SELECT count(*) AS total,
           array_agg(org.id) FILTER (WHERE lower(COALESCE(org.subscription_status, '')) = 'suspended') AS suspended
    FROM public.organization_members m
    JOIN public.organizations org ON org.id = m.organization_id
    WHERE m.user_id = me.uid
  ) o
  WHERE me.uid IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.assert_super_admin(text)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_disable_user(uuid, boolean, text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_force_logout(uuid)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_require_password_change(uuid, boolean)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_my_password_change_requirement()        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_suspend_company(uuid, boolean, text)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_account_status()                           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_super_admin(text)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_disable_user(uuid, boolean, text)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_force_logout(uuid)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_require_password_change(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_my_password_change_requirement()       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_suspend_company(uuid, boolean, text)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_account_status()                          TO authenticated, service_role;
