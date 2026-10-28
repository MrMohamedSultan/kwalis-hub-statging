-- =====================================================================
-- 172 — Crew & Cast contracts: tax residency, WHT rate, identity flags
--
-- Spec items B04 / B26 / B27 / E02 / E03 (client review 2026-10-27).
--
-- The contract form now asks, and stores, what it used to guess:
--   people.tax_residency    'resident' | 'non_resident'. NULL = not confirmed
--                           yet; the app suggests the current rule (non-Saudi
--                           AND bank outside KSA → non-resident) and the user
--                           confirms it. WHT applies only to non-residents.
--   people.wht_service_type service type used to look the rate up in
--                           public.wht_rate_rules (090). NULL = 'default'.
--   people.wht_rate         rate (%) applied on this contract — a snapshot,
--                           so a later change to the rate table does not
--                           silently re-price signed contracts.
--   people.id_type          'national_id' | 'iqama' | 'passport'
--   people.mother_saudi     Film Commission eligibility (resident whose
--                           mother is Saudi). NULL = not answered.
--   people.related_party    Film Commission related-party disclosure.
--
-- wht_treatment ('inclusive' | 'exclusive') already exists on people and
-- payroll on the live database (added 2026-08-04); the app now actually
-- saves and reloads it. The ADD COLUMN IF NOT EXISTS lines below are no-ops
-- there and only matter on a database built from the repo migrations.
--
-- Stored amounts are unchanged: payroll.total_amount stays the contract
-- value (gross) in the project base currency, payroll.net_payable the net.
--
-- Backfill (fills NEW columns only, never touches existing values):
--   · id_type   where the stored ID number is unambiguous:
--               10 digits starting with 1 → national_id, with 2 → iqama
--   · wht_rate  from the contract's own payroll row when it carries a
--               WHT percent > 0
--
-- Security review fix (secfix #26, before first apply): the CHECKs are added
-- NOT VALID and validated one by one afterwards; a live value that does not
-- pass leaves that CHECK NOT VALID with a NOTICE instead of failing.
--
-- ADDITIVE and idempotent. Rollback:
--   ALTER TABLE public.people
--     DROP COLUMN IF EXISTS tax_residency, DROP COLUMN IF EXISTS wht_service_type,
--     DROP COLUMN IF EXISTS wht_rate,      DROP COLUMN IF EXISTS id_type,
--     DROP COLUMN IF EXISTS mother_saudi,  DROP COLUMN IF EXISTS related_party;
-- =====================================================================

ALTER TABLE public.people ADD COLUMN IF NOT EXISTS tax_residency    text;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS wht_service_type text;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS wht_rate         numeric(5,2);
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS id_type          text;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS mother_saudi     boolean;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS related_party    boolean;

-- Live already has these (with their CHECKs); repo-built databases may not.
ALTER TABLE public.people  ADD COLUMN IF NOT EXISTS wht_treatment text NOT NULL DEFAULT 'inclusive';
ALTER TABLE public.payroll ADD COLUMN IF NOT EXISTS wht_treatment text NOT NULL DEFAULT 'inclusive';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_tax_residency_check'
                 AND conrelid = 'public.people'::regclass) THEN
    ALTER TABLE public.people ADD CONSTRAINT people_tax_residency_check
      CHECK (tax_residency IS NULL OR tax_residency IN ('resident', 'non_resident')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_id_type_check'
                 AND conrelid = 'public.people'::regclass) THEN
    ALTER TABLE public.people ADD CONSTRAINT people_id_type_check
      CHECK (id_type IS NULL OR id_type IN ('national_id', 'iqama', 'passport')) NOT VALID;
  END IF;
  -- < 100: the gross-up divides by (1 − rate)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_wht_rate_check'
                 AND conrelid = 'public.people'::regclass) THEN
    ALTER TABLE public.people ADD CONSTRAINT people_wht_rate_check
      CHECK (wht_rate IS NULL OR (wht_rate >= 0 AND wht_rate < 100)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_wht_service_type_check'
                 AND conrelid = 'public.people'::regclass) THEN
    ALTER TABLE public.people ADD CONSTRAINT people_wht_service_type_check
      CHECK (wht_service_type IS NULL OR length(wht_service_type) BETWEEN 1 AND 100) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_wht_treatment_check'
                 AND conrelid = 'public.people'::regclass) THEN
    ALTER TABLE public.people ADD CONSTRAINT people_wht_treatment_check
      CHECK (wht_treatment IN ('inclusive', 'exclusive')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_wht_treatment_check'
                 AND conrelid = 'public.payroll'::regclass) THEN
    ALTER TABLE public.payroll ADD CONSTRAINT payroll_wht_treatment_check
      CHECK (wht_treatment IN ('inclusive', 'exclusive')) NOT VALID;
  END IF;
END $$;

-- secfix #26: the CHECKs above are added NOT VALID (no full-table scan under
-- the exclusive lock; new writes are checked at once) and validated here one
-- by one. A live value that does not pass leaves that CHECK NOT VALID with a
-- NOTICE instead of failing the migration: the owner lists the offending
-- rows, fixes them, then runs ALTER TABLE ... VALIDATE CONSTRAINT ... again.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
            WHERE conname IN ('people_tax_residency_check', 'people_id_type_check', 'people_wht_rate_check', 'people_wht_service_type_check', 'people_wht_treatment_check', 'payroll_wht_treatment_check') AND NOT convalidated LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE '172: % on % left NOT VALID, existing rows do not pass it (%)', c.conname, c.tbl, SQLERRM;
    END;
  END LOOP;
END $$;

COMMENT ON COLUMN public.people.tax_residency IS
  'resident | non_resident, confirmed by the user on the contract form. NULL = not confirmed (app suggests: non-Saudi AND bank outside KSA → non_resident).';
COMMENT ON COLUMN public.people.wht_rate IS
  'WHT % applied on this contract (snapshot of wht_rate_rules for wht_service_type at save time).';
COMMENT ON COLUMN public.people.wht_service_type IS
  'Service type used to look up wht_rate_rules. NULL = default.';
COMMENT ON COLUMN public.people.id_type IS 'national_id (10 digits, starts 1) | iqama (10 digits, starts 2) | passport';
COMMENT ON COLUMN public.people.mother_saudi IS 'Mother is Saudi (Film Commission eligibility for non-Saudi residents).';
COMMENT ON COLUMN public.people.related_party IS 'Related party (Film Commission disclosure list).';

-- ---------------------------------------------------------------------
-- Backfill new columns only, where the value is unambiguous.
-- Audit/stamp triggers are left on: these are real data changes.
-- ---------------------------------------------------------------------
UPDATE public.people
   SET id_type = CASE WHEN btrim(id_number) ~ '^1[0-9]{9}$' THEN 'national_id' ELSE 'iqama' END
 WHERE id_type IS NULL
   AND btrim(COALESCE(id_number, '')) ~ '^[12][0-9]{9}$';

UPDATE public.people pe
   SET wht_rate = round(pr.wht_percent, 2)
  FROM (SELECT DISTINCT ON (ref_id) ref_id, wht_percent
          FROM public.payroll
         WHERE COALESCE(wht_percent, 0) > 0 AND wht_percent < 100
         ORDER BY ref_id, created_at DESC) pr
 WHERE pe.wht_rate IS NULL
   AND pr.ref_id = pe.id::text;
