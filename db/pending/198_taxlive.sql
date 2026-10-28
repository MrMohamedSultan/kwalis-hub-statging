-- =====================================================================
-- 198 — Tax Cash Impact, Company Overhead, Live Balance (accruals), GSR by
--       payee bank country, instalment history.
--
-- Spec items R13–R15 (Crew Payables), R23/R24 (Tax Cash Impact), R25/E04/R11
-- (Company Overhead), N02/D10/D11 (Live Balance), N03 (GSR), D14–D16;
-- client decisions 12–16.
--
-- Why
--   * Live Balance (decision 16) needs the accrual method of every contract:
--     suggested from the deal type, editable per contract.
--   * Company Overhead (decision 14) replaces GOSI & Localization: company
--     employees (table project_overhead_staff, db/pending/060) plus office
--     rent share and company equipment share — new table
--     project_overhead_items. Overhead never enters the ledger, payments or
--     cash; it is a separate figure under the Cost Report total.
--   * GSR (decision 15) reports payments by the country of the payee's bank,
--     stored on the payment when it is made: new snapshot columns on
--     payments, filled by a BEFORE INSERT trigger from the contract / vendor.
--   * Crew Payables instalment popover (R15) shows requester, approvers and
--     history: get_instalment_history().
--
-- What changes (all additive, idempotent)
--   people.accrual_method        work_days | shoot_days | weekly | monthly |
--                                package | one_off. NULL = suggested from
--                                deal_type by accrual_method_suggest().
--   project_overhead_items       office rent / equipment share (monthly amount
--                                or % of budget), optional budget code.
--                                Read/write: project members holding Edit on
--                                "reports" (same rule as the staff table).
--   overhead_months()            months of a period overlapping a window
--                                (same rule as get_overhead in 060).
--   get_company_overhead()       one row per staff member / rent / equipment
--                                share with amount, budgeted flag, project
--                                budget. Monthly cost hidden from viewers.
--   payments.spend_country, spend_city, bank_name, bank_country, currency,
--   original_amount              snapshot at payment time (trigger
--                                payments_gsr_snapshot, BEFORE INSERT, fills
--                                only what the caller left empty).
--   get_gsr_payments()           one row per payment for the GSR screen.
--   get_instalment_history()     requests / approvals / rejections /
--                                cancellations / reversals / payment of one
--                                instalment, with user names.
--
-- Backfill (new columns only): payments rows get their snapshot from the
-- CURRENT contract / vendor data (the best available for payments made
-- before this file). Nothing else is rewritten.
--
-- SECURITY: new table + policies, SECURITY DEFINER functions
-- (get_company_overhead, payments_gsr_snapshot, get_instalment_history) —
-- per SECURITY.md apply only after owner approval.
--
-- Security review fixes (secfix, before first apply):
--   #8  payment_snapshot_values only reads the contract / invoice / PO /
--       person of the payment's own project (vendors: same project or
--       org-wide);
--   #14 snapshot values are cut to the column limits (bank 200, country 100)
--       and the backfill writes only rows whose values change, so a re-run
--       touches nothing.
--
-- Rollback:
--   DROP FUNCTION public.get_instalment_history(uuid, text);
--   DROP FUNCTION public.get_gsr_payments(uuid, date, date);
--   DROP TRIGGER trg_payments_gsr_snapshot ON public.payments;
--   DROP FUNCTION public.payments_gsr_snapshot();
--   DROP FUNCTION public.payment_snapshot_values(text, uuid, numeric, uuid);
--   ALTER TABLE public.payments DROP COLUMN spend_country, DROP COLUMN spend_city,
--     DROP COLUMN bank_name, DROP COLUMN bank_country, DROP COLUMN currency, DROP COLUMN original_amount;
--   DROP FUNCTION public.get_company_overhead(uuid, date, date);
--   DROP FUNCTION public.overhead_months(date, date, date, date);
--   DROP TABLE public.project_overhead_items;  DROP FUNCTION public.stamp_project_overhead_item();
--   DROP FUNCTION public.accrual_method_suggest(text);
--   ALTER TABLE public.people DROP COLUMN accrual_method;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Live Balance — accrual method per contract (decision 16)
-- ---------------------------------------------------------------------
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS accrual_method text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_accrual_method_check'
                 AND conrelid = 'public.people'::regclass) THEN
    ALTER TABLE public.people ADD CONSTRAINT people_accrual_method_check
      CHECK (accrual_method IS NULL OR accrual_method IN
             ('work_days', 'shoot_days', 'weekly', 'monthly', 'package', 'one_off'));
  END IF;
END $$;
COMMENT ON COLUMN public.people.accrual_method IS
  'Live Balance accrual method (decision 16): work_days | shoot_days | weekly | monthly | package | one_off. NULL = accrual_method_suggest(deal_type). db/pending/198.';

-- Suggested method from the deal type (the app mirrors this in live-balance.ts).
CREATE OR REPLACE FUNCTION public.accrual_method_suggest(p_deal_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(btrim(COALESCE(p_deal_type, '')))
           WHEN 'daily'   THEN 'work_days'
           WHEN 'weekly'  THEN 'weekly'
           WHEN 'monthly' THEN 'monthly'
           WHEN 'one_off' THEN 'one_off'
           ELSE 'package' END
$$;
GRANT EXECUTE ON FUNCTION public.accrual_method_suggest(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Company Overhead (decision 14, R25 / E04 / R11)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_overhead_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id)      ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('office_rent', 'equipment')),
  label           text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  basis           text NOT NULL DEFAULT 'monthly' CHECK (basis IN ('monthly', 'pct_budget')),
  monthly_amount  numeric(14,2) CHECK (monthly_amount IS NULL OR monthly_amount >= 0),     -- SAR
  pct_of_budget   numeric(6,3)  CHECK (pct_of_budget IS NULL OR (pct_of_budget >= 0 AND pct_of_budget <= 100)),
  allocation_pct  numeric(5,2)  NOT NULL DEFAULT 100 CHECK (allocation_pct > 0 AND allocation_pct <= 100),
  start_date      date,
  end_date        date,
  budget_code     text CHECK (budget_code IS NULL OR length(btrim(budget_code)) BETWEEN 1 AND 64),
  notes           text CHECK (notes IS NULL OR length(notes) <= 2000),
  deleted_at      timestamptz,
  deleted_by      uuid,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_overhead_items_basis_fields_check CHECK (
    (basis = 'monthly' AND monthly_amount IS NOT NULL AND start_date IS NOT NULL AND end_date IS NOT NULL)
    OR (basis = 'pct_budget' AND pct_of_budget IS NOT NULL)),
  CONSTRAINT project_overhead_items_dates_check CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_project_overhead_items_project
  ON public.project_overhead_items (project_id) WHERE deleted_at IS NULL;
COMMENT ON TABLE public.project_overhead_items IS
  'Company Overhead (decision 14): the project''s share of office rent and company equipment, as a monthly amount or a % of the budget. Never enters the ledger, payments or cash. db/pending/198.';

GRANT SELECT, INSERT, UPDATE ON public.project_overhead_items TO authenticated;
GRANT ALL ON public.project_overhead_items TO service_role;
REVOKE ALL ON public.project_overhead_items FROM anon;

ALTER TABLE public.project_overhead_items ENABLE ROW LEVEL SECURITY;

-- Same rule as project_overhead_staff (060): Edit on "reports" in the project.
-- Rows are never hard-deleted by users (no DELETE grant): soft delete via deleted_at.
DROP POLICY IF EXISTS "Report editors can read overhead items" ON public.project_overhead_items;
CREATE POLICY "Report editors can read overhead items"
  ON public.project_overhead_items FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('reports'));
DROP POLICY IF EXISTS "Report editors can insert overhead items" ON public.project_overhead_items;
CREATE POLICY "Report editors can insert overhead items"
  ON public.project_overhead_items FOR INSERT TO authenticated
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('reports'));
DROP POLICY IF EXISTS "Report editors can update overhead items" ON public.project_overhead_items;
CREATE POLICY "Report editors can update overhead items"
  ON public.project_overhead_items FOR UPDATE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('reports'))
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('reports'));

CREATE OR REPLACE FUNCTION public.stamp_project_overhead_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = NEW.project_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_overhead_items: project % not found', NEW.project_id USING ERRCODE = '23503';
  END IF;
  NEW.organization_id := v_org;
  NEW.label           := btrim(NEW.label);
  NEW.budget_code     := NULLIF(btrim(NEW.budget_code), '');
  NEW.updated_by      := auth.uid();
  NEW.updated_at      := now();
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
    NEW.deleted_at := NULL; NEW.deleted_by := NULL;
  ELSE
    NEW.project_id := OLD.project_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      NEW.deleted_at := now(); NEW.deleted_by := auth.uid();
    ELSIF NEW.deleted_at IS NULL THEN
      NEW.deleted_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_stamp_project_overhead_item ON public.project_overhead_items;
CREATE TRIGGER trg_stamp_project_overhead_item
  BEFORE INSERT OR UPDATE ON public.project_overhead_items
  FOR EACH ROW EXECUTE FUNCTION public.stamp_project_overhead_item();
DROP TRIGGER IF EXISTS trg_audit_history_project_overhead_items ON public.project_overhead_items;
CREATE TRIGGER trg_audit_history_project_overhead_items
  AFTER INSERT OR UPDATE OR DELETE ON public.project_overhead_items
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();
-- a locked / archived project refuses overhead changes too (184 rule)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_overhead_items', 'project_overhead_staff'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS zz_trg_project_lock ON public.%I', t);
    EXECUTE format('CREATE TRIGGER zz_trg_project_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.enforce_project_lock()', t);
  END LOOP;
END $$;

-- Months of [p_start, p_end] inside [p_from, p_to]: month by month, overlapped
-- days / days of that month (a full calendar month = 1). Same rule as 060.
CREATE OR REPLACE FUNCTION public.overhead_months(p_start date, p_end date, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH w AS (
    SELECT GREATEST(p_start, COALESCE(p_from, '-infinity'::date)) AS a,
           LEAST(p_end, COALESCE(p_to, 'infinity'::date))         AS b
  )
  SELECT CASE WHEN p_start IS NULL OR p_end IS NULL OR w.a > w.b THEN 0::numeric
         ELSE COALESCE((
           SELECT sum((LEAST(w.b, (m + interval '1 month - 1 day')::date) - GREATEST(w.a, m::date) + 1)::numeric
                      / extract(day FROM (m + interval '1 month - 1 day'))::numeric)
             FROM generate_series(date_trunc('month', w.a::timestamp), date_trunc('month', w.b::timestamp),
                                  interval '1 month') AS m), 0) END
  FROM w
$$;
GRANT EXECUTE ON FUNCTION public.overhead_months(date, date, date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- get_company_overhead — every overhead line of a project, SAR
-- ---------------------------------------------------------------------
--   kind            staff | office_rent | equipment
--   monthly_amount  staff: full monthly cost incl. company GOSI share (only
--                   to callers holding Edit on "reports"); rent/equipment:
--                   the monthly amount
--   amount          staff: monthly_cost × allocation % × months (060)
--                   monthly basis: monthly_amount × allocation % × months
--                   % of budget: project budget × pct × allocation %
--                   (the whole project; the period filter does not apply)
--   budgeted        the line's budget code exists in the active budget
--                   (else it is "unbudgeted")
--   project_budget  approved budget of the project (same on every row)
CREATE OR REPLACE FUNCTION public.get_company_overhead(
  p_project_id uuid,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
RETURNS TABLE (
  kind           text,
  id             uuid,
  label          text,
  "position"     text,
  basis          text,
  monthly_amount numeric,
  pct_of_budget  numeric,
  allocation_pct numeric,
  start_date     date,
  end_date       date,
  months         numeric,
  amount         numeric,
  budget_code    text,
  budgeted       boolean,
  over_allocated boolean,
  project_budget numeric,
  notes          text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid; v_fx numeric; v_budget numeric;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'get_company_overhead: p_project_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'get_company_overhead: p_from is after p_to' USING ERRCODE = '22023';
  END IF;
  SELECT p.organization_id, p.fx_rate INTO v_org, v_fx FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id)
     OR NOT (public.can_view('reports') OR public.can_edit('reports')) THEN
    RAISE EXCEPTION 'get_company_overhead: access denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(sum(public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap,
                                                   bl.unit, bl.currency, bl.excluded, v_fx)), 0)
    INTO v_budget
    FROM public.v_active_budget_lines bl WHERE bl.project_id = p_project_id;

  RETURN QUERY
  WITH codes AS (
    SELECT DISTINCT bl.main_code AS code FROM public.v_active_budget_lines bl WHERE bl.project_id = p_project_id
  ),
  staff AS (
    SELECT 'staff'::text AS kind, s.id, s.employee AS label, s."position", 'monthly'::text AS basis,
           s.monthly_cost AS monthly_amount, NULL::numeric AS pct_of_budget, s.allocation_pct,
           s.start_date, s.end_date, s.months, s.allocated_cost AS amount, s.budget_code,
           s.over_allocated, s.notes
      FROM public.get_overhead(p_project_id, p_from, p_to) s
  ),
  items AS (
    SELECT i.kind, i.id, i.label, NULL::text AS "position", i.basis,
           i.monthly_amount, i.pct_of_budget, i.allocation_pct, i.start_date, i.end_date,
           CASE WHEN i.basis = 'monthly' THEN round(public.overhead_months(i.start_date, i.end_date, p_from, p_to), 4) END AS months,
           round(CASE WHEN i.basis = 'monthly'
                      THEN i.monthly_amount * i.allocation_pct / 100 * public.overhead_months(i.start_date, i.end_date, p_from, p_to)
                      ELSE v_budget * i.pct_of_budget / 100 * i.allocation_pct / 100 END, 2) AS amount,
           i.budget_code, false AS over_allocated, i.notes
      FROM public.project_overhead_items i
     WHERE i.project_id = p_project_id AND i.deleted_at IS NULL
  ),
  allrows AS (SELECT * FROM staff UNION ALL SELECT * FROM items)
  SELECT a.kind, a.id, a.label, a."position", a.basis,
         CASE WHEN a.kind = 'staff' AND NOT public.can_edit('reports') THEN NULL ELSE a.monthly_amount END,
         a.pct_of_budget, a.allocation_pct, a.start_date, a.end_date, a.months, a.amount,
         a.budget_code,
         (a.budget_code IS NOT NULL AND EXISTS (SELECT 1 FROM codes c WHERE c.code = a.budget_code)),
         a.over_allocated,
         round(v_budget, 2),
         a.notes
    FROM allrows a
   ORDER BY CASE a.kind WHEN 'staff' THEN 0 WHEN 'office_rent' THEN 1 ELSE 2 END, a.label;
END;
$$;
REVOKE ALL ON FUNCTION public.get_company_overhead(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_overhead(uuid, date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. GSR (N03) — payee bank country stored on the payment
-- ---------------------------------------------------------------------
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS spend_country   text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS spend_city      text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS bank_name       text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS bank_country    text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS currency        text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS original_amount numeric(14,2);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_snapshot_len_check'
                 AND conrelid = 'public.payments'::regclass) THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_snapshot_len_check CHECK (
      (spend_country IS NULL OR length(spend_country) <= 100) AND (spend_city IS NULL OR length(spend_city) <= 100)
      AND (bank_name IS NULL OR length(bank_name) <= 200) AND (bank_country IS NULL OR length(bank_country) <= 100)
      AND (currency IS NULL OR currency ~ '^[A-Z]{3}$'));
  END IF;
END $$;
COMMENT ON COLUMN public.payments.spend_country IS
  'GSR (decision 15): country of the payee''s bank at payment time. Petty cash / cash / local payments = Saudi Arabia. Filled by trg_payments_gsr_snapshot. db/pending/198.';
COMMENT ON COLUMN public.payments.currency IS 'Contract / invoice currency at payment time (amount stays SAR). db/pending/198.';
COMMENT ON COLUMN public.payments.original_amount IS 'amount in currency (amount / project rate when not SAR). db/pending/198.';

-- What the snapshot columns would be for a payment of p_source_type / p_source_id.
CREATE OR REPLACE FUNCTION public.payment_snapshot_values(
  p_source_type text, p_source_id uuid, p_amount numeric, p_project uuid,
  OUT bank_country text, OUT bank_name text, OUT currency text, OUT original_amount numeric,
  OUT is_local boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_iban text; v_rate numeric; v_scope text;
BEGIN
  is_local := false;
  IF p_source_type = 'payroll' THEN
    SELECT COALESCE(NULLIF(btrim(pe.bank_country), ''), NULLIF(btrim(v.bank_country), '')),
           COALESCE(NULLIF(btrim(pe.bank), ''), NULLIF(btrim(v.bank_name), '')),
           COALESCE(NULLIF(btrim(pe.iban), ''), NULLIF(btrim(v.iban), '')),
           upper(NULLIF(btrim(pe.ccy), '')), v.vendor_scope
      INTO bank_country, bank_name, v_iban, currency, v_scope
      FROM public.payroll p
      LEFT JOIN LATERAL (SELECT pp.* FROM public.people pp
                          WHERE pp.project_id = p.project_id AND pp.organization_id = p.organization_id
                            AND (pp.id::text = p.ref_id OR (COALESCE(p.ref_id, '') !~* '^[0-9a-f]{8}-' AND pp.full_name = p.name))
                          ORDER BY (pp.id::text = p.ref_id) DESC LIMIT 1) pe ON p.kind <> 'vendor'
      LEFT JOIN public.vendors v ON p.kind = 'vendor' AND v.id::text = p.ref_id
             AND v.organization_id = p.organization_id AND (v.project_id IS NULL OR v.project_id = p.project_id)
     WHERE p.id = p_source_id
       AND p.project_id IS NOT DISTINCT FROM p_project;                    -- secfix #8
  ELSIF p_source_type = 'invoice' THEN
    SELECT NULLIF(btrim(v.bank_country), ''), NULLIF(btrim(v.bank_name), ''), NULLIF(btrim(v.iban), ''),
           upper(NULLIF(btrim(i.currency), '')), v.vendor_scope
      INTO bank_country, bank_name, v_iban, currency, v_scope
      FROM public.invoices i
      LEFT JOIN LATERAL (SELECT vv.* FROM public.vendors vv
                          WHERE vv.organization_id = i.organization_id AND lower(vv.name) = lower(i.vendor_name)
                            AND (vv.project_id IS NULL OR vv.project_id = i.project_id)
                          ORDER BY (vv.project_id = i.project_id) DESC NULLS LAST, vv.created_at LIMIT 1) v ON true
     WHERE i.id = p_source_id
       AND i.project_id IS NOT DISTINCT FROM p_project;                    -- secfix #8
  ELSIF p_source_type IN ('purchase_order', 'po') THEN
    SELECT NULLIF(btrim(v.bank_country), ''), NULLIF(btrim(v.bank_name), ''), NULLIF(btrim(v.iban), ''), v.vendor_scope
      INTO bank_country, bank_name, v_iban, v_scope
      FROM public.purchase_orders po
      LEFT JOIN LATERAL (SELECT vv.* FROM public.vendors vv
                          WHERE vv.organization_id = po.organization_id AND lower(vv.name) = lower(po.vendor_name)
                            AND (vv.project_id IS NULL OR vv.project_id = po.project_id)
                          ORDER BY (vv.project_id = po.project_id) DESC NULLS LAST, vv.created_at LIMIT 1) v ON true
     WHERE po.id = p_source_id
       AND po.project_id IS NOT DISTINCT FROM p_project;                   -- secfix #8
  ELSIF p_source_type IN ('overtime', 'per_diem') THEN
    SELECT NULLIF(btrim(pe.bank_country), ''), NULLIF(btrim(pe.bank), ''), NULLIF(btrim(pe.iban), ''),
           upper(NULLIF(btrim(pe.ccy), ''))
      INTO bank_country, bank_name, v_iban, currency
      FROM public.people pe
     WHERE pe.id = CASE p_source_type
                     WHEN 'overtime' THEN (SELECT o.person_id FROM public.overtime_entries o WHERE o.id = p_source_id)
                     ELSE (SELECT d.person_id FROM public.per_diem_ledger d WHERE d.id = p_source_id) END
       AND pe.project_id IS NOT DISTINCT FROM p_project;                   -- secfix #8
  ELSE
    -- petty cash floats / receipts: spent locally (decision 15)
    is_local := true;
  END IF;

  -- secfix #14: never longer than the payments columns allow (CHECK below)
  bank_country := left(bank_country, 100);
  bank_name    := left(bank_name, 200);

  -- no recorded bank country: a Saudi IBAN, or a vendor marked Local, is Saudi Arabia
  IF bank_country IS NULL AND (upper(COALESCE(v_iban, '')) LIKE 'SA%' OR v_scope = 'Local') THEN
    bank_country := 'Saudi Arabia';
  END IF;
  IF lower(COALESCE(bank_country, '')) IN ('saudi', 'ksa', 'sa', 'saudi arabia', 'السعودية', 'المملكة العربية السعودية') THEN
    bank_country := 'Saudi Arabia';
  END IF;

  currency := COALESCE(currency, 'SAR');
  IF currency !~ '^[A-Z]{3}$' THEN currency := 'SAR'; END IF;
  v_rate := CASE WHEN currency = 'SAR' THEN 1 ELSE public.amount_to_sar(1, currency, p_project) END;
  -- amount_to_sar leaves unknown currencies unconverted (rate 1): then the original is unknown
  original_amount := CASE WHEN currency = 'SAR' THEN p_amount
                          WHEN COALESCE(v_rate, 0) > 0 AND v_rate <> 1 THEN round(p_amount / v_rate, 2)
                          ELSE NULL END;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_snapshot_values(text, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.payments_gsr_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM public.payment_snapshot_values(NEW.source_type, NEW.source_id, NEW.amount, NEW.project_id);
  NEW.bank_country    := COALESCE(NULLIF(btrim(NEW.bank_country), ''), s.bank_country);
  NEW.bank_name       := COALESCE(NULLIF(btrim(NEW.bank_name), ''), s.bank_name);
  NEW.currency        := COALESCE(NULLIF(btrim(NEW.currency), ''), s.currency);
  NEW.original_amount := COALESCE(NEW.original_amount, s.original_amount);
  NEW.spend_country   := COALESCE(NULLIF(btrim(NEW.spend_country), ''),
                                  CASE WHEN s.is_local OR NEW.method = 'Cash' THEN 'Saudi Arabia' END,
                                  NEW.bank_country);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.payments_gsr_snapshot() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payments_gsr_snapshot ON public.payments;
CREATE TRIGGER trg_payments_gsr_snapshot
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_gsr_snapshot();

-- Backfill the NEW columns of payments already recorded (current contract / vendor data).
-- secfix #14: only rows whose values actually change are written (each write
-- fires the audit / ledger / updated_at triggers), so a re-run touches nothing.
WITH calc AS (
  SELECT pm.id,
         COALESCE(pm.bank_country, s.bank_country) AS bank_country,
         COALESCE(pm.bank_name, s.bank_name) AS bank_name,
         COALESCE(pm.currency, s.currency) AS currency,
         COALESCE(pm.original_amount, s.original_amount) AS original_amount,
         COALESCE(pm.spend_country,
                  CASE WHEN s.is_local OR pm.method = 'Cash' THEN 'Saudi Arabia' END,
                  COALESCE(pm.bank_country, s.bank_country)) AS spend_country
    FROM public.payments pm
    CROSS JOIN LATERAL public.payment_snapshot_values(pm.source_type, pm.source_id, pm.amount, pm.project_id) s
   WHERE pm.spend_country IS NULL OR pm.currency IS NULL
)
UPDATE public.payments pm
   SET bank_country = c.bank_country, bank_name = c.bank_name, currency = c.currency,
       original_amount = c.original_amount, spend_country = c.spend_country
  FROM calc c
 WHERE c.id = pm.id
   AND (pm.bank_country IS DISTINCT FROM c.bank_country OR pm.bank_name IS DISTINCT FROM c.bank_name
        OR pm.currency IS DISTINCT FROM c.currency OR pm.original_amount IS DISTINCT FROM c.original_amount
        OR pm.spend_country IS DISTINCT FROM c.spend_country);

-- One row per payment (money out) for the GSR screen. SAR.
--   payee_type  crew | cast | vendor | petty_cash | other
--   wht         WHT withheld on this payment: its share of the WHT stored
--               on the contract / invoice (never recomputed from a rate)
CREATE OR REPLACE FUNCTION public.get_gsr_payments(p_project_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
  payment_id      uuid,
  payment_date    date,
  country         text,
  city            text,
  bank_name       text,
  payee           text,
  payee_type      text,
  source_type     text,
  source_id       uuid,
  currency        text,
  amount_original numeric,
  amount_sar      numeric,
  wht             numeric,
  method          text
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'get_gsr_payments: p_from is after p_to' USING ERRCODE = '22023';
  END IF;
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_gsr_payments: access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT pm.id, pm.payment_date,
         COALESCE(NULLIF(btrim(pm.spend_country), ''), 'Unspecified'),
         NULLIF(btrim(pm.spend_city), ''),
         NULLIF(btrim(pm.bank_name), ''),
         COALESCE(pr.name, inv.vendor_name, po.vendor_name, ca.holder, rc.vendor, rc.recipient, pe.full_name, '—'),
         CASE
           WHEN pm.source_type = 'payroll' THEN COALESCE(NULLIF(pr.kind, ''), 'crew')
           WHEN pm.source_type IN ('invoice', 'purchase_order', 'po') THEN 'vendor'
           WHEN pm.source_type IN ('petty_cash', 'cash_advance', 'cash_advance_receipt', 'receipt') THEN 'petty_cash'
           WHEN pm.source_type IN ('overtime', 'per_diem') THEN COALESCE(pe.kind, 'crew')
           ELSE 'other' END,
         pm.source_type, pm.source_id,
         COALESCE(pm.currency, 'SAR'),
         COALESCE(pm.original_amount, CASE WHEN COALESCE(pm.currency, 'SAR') = 'SAR' THEN pm.amount END),
         pm.amount,
         round(CASE
           WHEN pr.id IS NOT NULL AND COALESCE(pr.wht_amount, 0) > 0
                AND COALESCE(NULLIF(pr.net_payable, 0), pr.total_amount - pr.wht_amount) > 0
             THEN pm.amount * pr.wht_amount / COALESCE(NULLIF(pr.net_payable, 0), pr.total_amount - pr.wht_amount)
           WHEN inv.id IS NOT NULL AND COALESCE(inv.wht_amount, 0) > 0
                AND COALESCE(inv.price, 0) + COALESCE(inv.vat_amount, 0) - inv.wht_amount > 0
             THEN pm.amount * inv.wht_amount / (COALESCE(inv.price, 0) + COALESCE(inv.vat_amount, 0) - inv.wht_amount)
           ELSE 0 END, 2),
         pm.method
    FROM public.payments pm
    LEFT JOIN public.payroll pr ON pm.source_type = 'payroll' AND pr.id = pm.source_id
    LEFT JOIN public.invoices inv ON pm.source_type = 'invoice' AND inv.id = pm.source_id
    LEFT JOIN public.purchase_orders po ON pm.source_type IN ('purchase_order', 'po') AND po.id = pm.source_id
    LEFT JOIN public.cash_advances ca ON pm.source_type IN ('petty_cash', 'cash_advance') AND ca.id = pm.source_id
    LEFT JOIN public.cash_advance_receipts rc ON pm.source_type IN ('cash_advance_receipt', 'receipt') AND rc.id = pm.source_id
    LEFT JOIN public.people pe ON pe.id = CASE pm.source_type
           WHEN 'overtime' THEN (SELECT o.person_id FROM public.overtime_entries o WHERE o.id = pm.source_id)
           WHEN 'per_diem' THEN (SELECT d.person_id FROM public.per_diem_ledger d WHERE d.id = pm.source_id) END
   WHERE pm.project_id = p_project_id
     AND (p_from IS NULL OR pm.payment_date >= p_from)
     AND (p_to   IS NULL OR pm.payment_date <= p_to)
   ORDER BY pm.payment_date, pm.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.get_gsr_payments(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gsr_payments(uuid, date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. R15 — history of one instalment
-- ---------------------------------------------------------------------
-- event: requested | approved_level | approved | rejected | cancelled |
--        reversed | paid. Oldest first.
CREATE OR REPLACE FUNCTION public.get_instalment_history(p_payroll_id uuid, p_milestone_id text)
RETURNS TABLE (at timestamptz, event text, actor_name text, level_label text, note text, amount numeric,
               payment_request_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_project uuid;
BEGIN
  SELECT p.organization_id, p.project_id INTO v_org, v_project FROM public.payroll p WHERE p.id = p_payroll_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, v_project) THEN
    RAISE EXCEPTION 'get_instalment_history: access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH r AS (
    SELECT * FROM public.payment_requests q
     WHERE q.source_type = 'payroll_row' AND q.source_id = p_payroll_id AND q.payroll_milestone_id = p_milestone_id
  ),
  ev AS (
    SELECT COALESCE(r.submitted_at, r.created_at) AS at, 'requested'::text AS event, r.requested_by AS uid,
           NULL::text AS level_label, NULLIF(r.notes, '') AS note, r.requested_amount AS amount, r.id AS rid
      FROM r
    UNION ALL
    SELECT a.approved_at, 'approved_level', a.approved_by, a.level_label, a.note, NULL::numeric, a.payment_request_id
      FROM public.payment_request_approvals a JOIN r ON r.id = a.payment_request_id
    UNION ALL
    SELECT r.approved_at, 'approved', r.approved_by, NULL, NULL, r.requested_amount, r.id
      FROM r WHERE r.approved_at IS NOT NULL
    UNION ALL
    SELECT r.rejected_at, 'rejected', r.rejected_by, NULL, r.rejection_reason, NULL, r.id
      FROM r WHERE r.rejected_at IS NOT NULL
    UNION ALL
    SELECT r.cancelled_at, 'cancelled', r.cancelled_by, NULL, r.cancellation_reason, NULL, r.id
      FROM r WHERE r.cancelled_at IS NOT NULL
    UNION ALL
    SELECT x.reversed_at, 'reversed', x.reversed_by, NULL, x.reason, x.amount, x.payment_request_id
      FROM public.accrual_reversals x
     WHERE x.source_id = p_payroll_id AND x.payroll_milestone_id = p_milestone_id
    UNION ALL
    SELECT COALESCE(r.executed_at, r.payment_date::timestamptz), 'paid', r.executed_by, NULL,
           NULLIF(r.notes, ''), r.requested_amount, r.id
      FROM r WHERE r.status = 'paid'
    UNION ALL
    -- paid by hand before the approval flow (no request): the payments row
    SELECT pm.created_at, 'paid', pm.recorded_by, NULL, NULLIF(pm.notes, ''), pm.amount, NULL::uuid
      FROM public.payments pm
     WHERE pm.source_type = 'payroll' AND pm.source_id = p_payroll_id AND pm.payroll_milestone_id = p_milestone_id
       AND NOT EXISTS (SELECT 1 FROM r WHERE r.status = 'paid')
  )
  SELECT ev.at, ev.event, public.user_display_name(ev.uid), ev.level_label, ev.note, ev.amount, ev.rid
    FROM ev
   WHERE ev.at IS NOT NULL
   ORDER BY ev.at, CASE ev.event WHEN 'requested' THEN 0 WHEN 'approved_level' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END;
END;
$$;
REVOKE ALL ON FUNCTION public.get_instalment_history(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_instalment_history(uuid, text) TO authenticated, service_role;
