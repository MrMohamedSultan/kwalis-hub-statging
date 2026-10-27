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
-- storage policy needed). The check below only lets a safe value in:
-- an http(s) URL or a PNG/JPEG data URL of at most ~512 KB.
--
-- Who can write: unchanged — the existing "Org admins update orgs" policy
-- (super admin or owner/admin of that organization). No new policy, no grant
-- change, no storage change.
--
-- Additive and idempotent. Existing rows get the default format; existing
-- logo_url values are not re-validated (constraint is NOT VALID).
--
-- Rollback:
--   ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_logo_url_safe;
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

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_logo_url_safe'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_logo_url_safe
      CHECK (
        logo_url IS NULL
        OR (logo_url ~* '^https?://' AND length(logo_url) <= 2048)
        OR (logo_url ~* '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$' AND length(logo_url) <= 700000)
      ) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.logo_url IS
  'Company logo shown at the top of every export (G02): an http(s) URL or a small PNG/JPEG data URL set from Settings.';
