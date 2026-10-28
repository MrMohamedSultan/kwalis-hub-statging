-- =====================================================================
-- 171 — Platform date format + company logo for exports (G02 / G05)
--
-- G05: the client wants ONE date format for the whole platform, chosen in
-- Settings (default dd/MM/yyyy, year always shown). It is a company-level
-- setting, stored on public.organizations next to the other company
-- settings (base_currency, fx_rates) and read by the app on load.
--
-- G02: every Excel/PDF export carries the client company logo. The column
-- public.organizations.logo_url already exists; the Settings screen stores a
-- small, client-resized PNG there as a data URL (no storage bucket or
-- storage policy needed). The trigger below only lets a safe value in:
-- an http(s) URL or a PNG/JPEG data URL of at most ~512 KB.
--
-- Who can write: unchanged — the existing "Org admins update orgs" policy
-- (super admin or owner/admin of that organization). No new policy, no grant
-- change, no storage change.
--
-- Additive and idempotent. Existing rows get the default format; existing
-- logo_url values are not re-validated: the rule is a trigger that checks a
-- new or changed logo_url only (secfix #15).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_org_logo_url_safe ON public.organizations;
--   DROP FUNCTION IF EXISTS public.check_org_logo_url();
--   ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_date_format_check;
--   ALTER TABLE public.organizations DROP COLUMN IF EXISTS date_format;
-- =====================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS date_format text NOT NULL DEFAULT 'dd/MM/yyyy';

COMMENT ON COLUMN public.organizations.date_format IS
  'Platform date format for every screen and export (G05). One of dd/MM/yyyy, MM/dd/yyyy, yyyy-MM-dd, dd-MM-yyyy, dd.MM.yyyy.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_date_format_check'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_date_format_check
      CHECK (date_format IN ('dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd-MM-yyyy', 'dd.MM.yyyy'));
  END IF;
END $$;

-- secfix #15: the logo rule is a trigger that checks only a NEW or CHANGED
-- logo_url. (A NOT VALID CHECK is still evaluated on every later UPDATE of
-- the row, so an organization whose old logo_url is not a URL / data URL
-- could no longer save any setting.)
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_logo_url_safe;
CREATE OR REPLACE FUNCTION public.check_org_logo_url()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.logo_url IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.logo_url IS DISTINCT FROM OLD.logo_url)
     AND NOT ((NEW.logo_url ~* '^https?://' AND length(NEW.logo_url) <= 2048)
              OR (NEW.logo_url ~* '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$' AND length(NEW.logo_url) <= 700000)) THEN
    RAISE EXCEPTION 'The company logo must be an http(s) URL or a PNG / JPEG image of at most about 512 KB'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_org_logo_url() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_org_logo_url_safe ON public.organizations;
CREATE TRIGGER trg_org_logo_url_safe
  BEFORE INSERT OR UPDATE OF logo_url ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.check_org_logo_url();

COMMENT ON COLUMN public.organizations.logo_url IS
  'Company logo shown at the top of every export (G02): an http(s) URL or a small PNG/JPEG data URL set from Settings.';
