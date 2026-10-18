-- =====================================================================
-- Guard — the platform can never be left without an owner
--   (pending-items 6ج / handover §7 item 22)
--
-- SECURITY CHANGE — per SECURITY.md apply only after the owner approves.
--
-- Today user_roles has no guard: the DELETE policy lets a super admin delete
-- any role row, including the last 'super_admin' — their own. After that
-- nobody can administer the platform and there is no way back from inside
-- the app. This trigger refuses to remove or downgrade the LAST super admin,
-- whoever asks (browser, server function with the service role, SQL editor).
--
-- Recovery if it ever has to be bypassed on purpose:
--   ALTER TABLE public.user_roles DISABLE TRIGGER trg_guard_last_super_admin;
--
-- Still do the non-technical half: create a second owner account and keep
-- its credentials outside the platform.
--
-- Rollback:
--   DROP TRIGGER  trg_guard_last_super_admin ON public.user_roles;
--   DROP FUNCTION public.guard_last_super_admin();
-- =====================================================================
CREATE OR REPLACE FUNCTION public.guard_last_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role::text = 'super_admin'
     AND (TG_OP = 'DELETE' OR NEW.role::text <> 'super_admin' OR NEW.user_id <> OLD.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
                     WHERE ur.role::text = 'super_admin' AND ur.id <> OLD.id) THEN
    RAISE EXCEPTION 'lockout_prevented: this is the last platform super admin — grant the role to another account first'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_last_super_admin
  BEFORE UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_super_admin();
