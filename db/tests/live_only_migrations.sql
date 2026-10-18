-- Migrations that are applied on the live database but whose files are NOT in
-- the repo snapshot (found by comparing supabase_migrations.schema_migrations
-- in the 2026-10-15 backup with supabase/migrations). The test runner applies
-- them right after the repo migrations so the local schema matches live.
--
-- 20260804132840  wht_treatment on people / payroll / invoices
ALTER TABLE public.people   ADD COLUMN IF NOT EXISTS wht_treatment TEXT NOT NULL DEFAULT 'inclusive';
ALTER TABLE public.payroll  ADD COLUMN IF NOT EXISTS wht_treatment TEXT NOT NULL DEFAULT 'inclusive';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS wht_treatment TEXT NOT NULL DEFAULT 'inclusive';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_wht_treatment_check') THEN
    ALTER TABLE public.people ADD CONSTRAINT people_wht_treatment_check CHECK (wht_treatment IN ('inclusive','exclusive'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_wht_treatment_check') THEN
    ALTER TABLE public.payroll ADD CONSTRAINT payroll_wht_treatment_check CHECK (wht_treatment IN ('inclusive','exclusive'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_wht_treatment_check') THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_wht_treatment_check CHECK (wht_treatment IN ('inclusive','exclusive'));
  END IF;
END$$;
