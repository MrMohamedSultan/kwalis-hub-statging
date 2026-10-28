-- =====================================================================
-- 174 — Accounts payable: invoice ↔ purchase order, VAT treatment, invoice
--       fields, PO maker-checker + numbering, balance-sheet GL accounts for
--       petty cash, car rentals / accommodation as budget commitments.
--
-- Spec items: B05 B06 B07 B08 B09 B10 B11 B14 B15 B16 B17 B20 E07 E08 E09 X12
--
-- Why
--   * B05/X12/E08  An invoice raised against a purchase order was counted
--     twice (PO 1,000 committed + invoice 1,000 actual = 2,000). Invoices now
--     carry purchase_order_id; the PO's commitment is reduced by what has been
--     invoiced on it, so PO 1,000 + invoice 1,000 on it = 1,000 in total.
--     Cancelled / draft / rejected / closed POs are no longer a commitment.
--   * E07  VAT treatment per invoice (standard / zero-rated / exempt /
--     reverse charge) and the standard rate as a platform setting (15%).
--   * E08/B15/B09  Due date + payment terms, currency + FX, service period,
--     service received date, related party, payment method — on invoices;
--     currency + FX + vendor link on purchase orders. Stored amounts stay in
--     the record currency (SAR) as before; the original amount is kept next
--     to it, so no report changes its unit.
--   * E09  An invoice saved without a GL account gets one derived from its
--     budget code: the organization / platform mapping of 070 first, then a
--     default by budget code range. Rows that already have an account keep it.
--   * B10/B11  Purchase orders: creator recorded, the creator can neither
--     create a PO as Approved nor approve their own PO (same rule as payment
--     requests in 030); readable sequential number <PROJECT CODE>-PO-0001.
--   * B07  The chart of accounts had expense accounts only, so a float could
--     not be issued on a new project. Adds account_type and seven
--     balance-sheet accounts (9xxx — no clash with budget codes 1000-7999).
--   * B08  Float holders are picked from people (custodian flag); adds
--     cash_advances.person_id next to the legacy crew_member_id.
--   * B20  Car rentals and accommodation get a budget line, a computed total
--     (days × rate / nights × rate) and appear as commitments in
--     v_ledger_transactions (so in the cost report and project position).
--     A linked invoice converts the commitment, like a PO.
--
-- Redefines public.v_ledger_transactions (copied from the live definition,
-- only the purchase_order branch changed and two branches added). Everything
-- else is ADDITIVE: nullable columns, two generated columns, new functions and
-- triggers, catalogue rows inserted with ON CONFLICT DO NOTHING. No existing
-- client row is rewritten; the only backfill is account_type on gl_accounts
-- (a new column) for the existing WHT liability account 2140.
--
-- SECURITY: touches a SECURITY-relevant trigger (maker-checker on POs) and a
-- view read by the app — per SECURITY.md apply only after owner approval.
--
-- Security review fix (secfix #26, before first apply): the two gl_accounts
-- CHECKs are added NOT VALID and validated separately; a live row that does
-- not pass leaves the CHECK NOT VALID with a NOTICE instead of failing.
--
-- Rollback (manual):
--   DROP TRIGGER IF EXISTS trg_purchase_order_maker_checker ON public.purchase_orders;
--   DROP TRIGGER IF EXISTS trg_purchase_order_number ON public.purchase_orders;
--   DROP TRIGGER IF EXISTS trg_invoices_ap_defaults ON public.invoices;
--   DROP FUNCTION IF EXISTS public.enforce_purchase_order_maker_checker();
--   DROP FUNCTION IF EXISTS public.assign_purchase_order_number();
--   DROP FUNCTION IF EXISTS public.invoices_ap_defaults();
--   DROP FUNCTION IF EXISTS public.derive_gl_account(uuid, text);
--   DROP FUNCTION IF EXISTS public.default_gl_code_for_budget_code(text);
--   DROP FUNCTION IF EXISTS public.payment_term_days(text);
--   re-create v_ledger_transactions from the live schema dump;
--   the added columns can stay (nullable, unused) or be dropped one by one.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('vat_standard_rate_pct', '15',
   'Standard VAT rate (percent) applied to standard-rated invoices.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Chart of accounts: balance-sheet accounts (B07)
-- ---------------------------------------------------------------------
ALTER TABLE public.gl_accounts ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'expense';
ALTER TABLE public.gl_accounts DROP CONSTRAINT IF EXISTS gl_accounts_account_type_check;
ALTER TABLE public.gl_accounts ADD CONSTRAINT gl_accounts_account_type_check
  CHECK (account_type IN ('expense','bank','cash','petty_cash','payable','wht_payable','vat','funding')) NOT VALID;
ALTER TABLE public.gl_accounts DROP CONSTRAINT IF EXISTS gl_accounts_category_check;
ALTER TABLE public.gl_accounts ADD CONSTRAINT gl_accounts_category_check
  CHECK (category IN ('ATL','BTL','Post-Production','Admin & Other','Balance Sheet')) NOT VALID;
-- secfix #26: added NOT VALID, validated separately. A live row that does not
-- pass leaves the CHECK NOT VALID with a NOTICE (new writes are still
-- checked); the owner fixes the row and runs VALIDATE CONSTRAINT again.
DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['gl_accounts_account_type_check', 'gl_accounts_category_check'] LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.gl_accounts VALIDATE CONSTRAINT %I', c);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE '174: % left NOT VALID, existing gl_accounts rows do not pass it (%)', c, SQLERRM;
    END;
  END LOOP;
END $$;

INSERT INTO public.gl_accounts (code, name, category, description, account_type) VALUES
  ('9100','Project Bank Account','Balance Sheet','Dedicated production bank account (funding in, payments out).','bank'),
  ('9110','Cash on Hand','Balance Sheet','Office cash box.','cash'),
  ('9120','Petty Cash Floats','Balance Sheet','Cash issued to float holders, cleared by approved receipts.','petty_cash'),
  ('9200','Accounts Payable','Balance Sheet','Invoices and approved installments not yet paid.','payable'),
  ('9220','VAT Recoverable (Input VAT)','Balance Sheet','VAT paid on vendor invoices, recoverable from ZATCA.','vat'),
  ('9300','Production Funding','Balance Sheet','Money received from financiers / the production company.','funding')
ON CONFLICT (code) DO NOTHING;
-- the existing WHT liability account is a balance-sheet account (new column only)
UPDATE public.gl_accounts SET account_type = 'wht_payable'
 WHERE code = '2140' AND account_type = 'expense';

-- ---------------------------------------------------------------------
-- 3. Invoices: new fields (B05 B09 B14 B15 E07 E08)
-- ---------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS purchase_order_id     uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_terms         text,
  ADD COLUMN IF NOT EXISTS due_date              date,
  ADD COLUMN IF NOT EXISTS payment_method        text,
  ADD COLUMN IF NOT EXISTS currency              text,
  ADD COLUMN IF NOT EXISTS fx_rate               numeric,
  ADD COLUMN IF NOT EXISTS amount_original       numeric,
  ADD COLUMN IF NOT EXISTS vat_treatment         text,
  ADD COLUMN IF NOT EXISTS vat_rate              numeric,
  ADD COLUMN IF NOT EXISTS service_period_from   date,
  ADD COLUMN IF NOT EXISTS service_period_to     date,
  ADD COLUMN IF NOT EXISTS service_received_date date,
  ADD COLUMN IF NOT EXISTS is_related_party      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS related_party_note    text;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_vat_treatment_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_vat_treatment_check
  CHECK (vat_treatment IS NULL OR vat_treatment IN ('standard','zero_rated','exempt','reverse_charge'));
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_payment_method_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('bank_transfer','petty_cash','corporate_card','cash','cheque'));
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_fx_rate_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_fx_rate_check CHECK (fx_rate IS NULL OR fx_rate > 0);
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_service_period_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_service_period_check
  CHECK (service_period_from IS NULL OR service_period_to IS NULL OR service_period_to >= service_period_from);
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_related_party_note_len;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_related_party_note_len
  CHECK (related_party_note IS NULL OR length(related_party_note) <= 1000);
CREATE INDEX IF NOT EXISTS idx_invoices_purchase_order ON public.invoices (purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. Purchase orders: vendor link, currency, maker-checker stamps (B09 B10 B11)
-- ---------------------------------------------------------------------
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS vendor_id       uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency        text,
  ADD COLUMN IF NOT EXISTS fx_rate         numeric,
  ADD COLUMN IF NOT EXISTS amount_original numeric,
  ADD COLUMN IF NOT EXISTS created_by      uuid,
  ADD COLUMN IF NOT EXISTS approved_by     uuid,
  ADD COLUMN IF NOT EXISTS approved_at     timestamptz;
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_fx_rate_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_fx_rate_check CHECK (fx_rate IS NULL OR fx_rate > 0);

-- A PO counts as a commitment unless it is one of these states.
-- (kept in one place; src/lib/budget-position.ts mirrors the same list)
CREATE OR REPLACE FUNCTION public.po_is_commitment(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(COALESCE(p_status, '')) NOT IN ('draft','cancelled','rejected','closed')
$$;

-- Readable sequential numbers: <project code>-PO-0001 (decision 17).
-- Only fills an empty number; a number typed by the user is kept.
CREATE OR REPLACE FUNCTION public.assign_purchase_order_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prefix text;
  v_next   int;
BEGIN
  IF NEW.po_number IS NOT NULL AND btrim(NEW.po_number) <> '' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(NULLIF(btrim(p.code), ''), 'PO') INTO v_prefix
    FROM public.projects p WHERE p.id = NEW.project_id;
  v_prefix := upper(COALESCE(v_prefix, 'PO')) || '-PO-';
  PERFORM pg_advisory_xact_lock(hashtext('po_number:' || COALESCE(NEW.project_id::text, '')));
  SELECT COALESCE(max(substring(po.po_number FROM '([0-9]+)$')::int), 0) + 1 INTO v_next
    FROM public.purchase_orders po
   WHERE po.project_id IS NOT DISTINCT FROM NEW.project_id
     AND po.po_number LIKE v_prefix || '%'
     AND po.po_number ~ '[0-9]+$';
  NEW.po_number := v_prefix || lpad(v_next::text, 4, '0');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_purchase_order_number ON public.purchase_orders;
CREATE TRIGGER trg_purchase_order_number
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_purchase_order_number();

-- Maker-checker (B10): mirrors enforce_payment_request_maker_checker (030).
CREATE OR REPLACE FUNCTION public.enforce_purchase_order_maker_checker()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new_ok boolean := lower(COALESCE(NEW.status, '')) IN ('approved','issued');
  v_old_ok boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NULL THEN RETURN NEW; END IF;   -- server jobs / SQL editor
    NEW.created_by := v_uid;
    IF v_new_ok THEN
      RAISE EXCEPTION 'Maker-checker: a purchase order cannot be created as %; another user must approve it', NEW.status
        USING ERRCODE = '42501';
    END IF;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN RETURN NEW; END IF;
  v_old_ok := lower(COALESCE(OLD.status, '')) IN ('approved','issued');

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'purchase_orders: created_by cannot be changed' USING ERRCODE = '42501';
  END IF;

  IF v_new_ok AND NOT v_old_ok THEN
    IF OLD.created_by IS NOT NULL AND OLD.created_by = v_uid THEN
      RAISE EXCEPTION 'Maker-checker: you cannot approve a purchase order you created yourself'
        USING ERRCODE = '42501';
    END IF;
    NEW.approved_by := v_uid;
    NEW.approved_at := now();
  ELSIF v_new_ok AND v_old_ok THEN
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'purchase_orders: approval stamps are set by the database' USING ERRCODE = '42501';
    END IF;
    IF NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.vendor_name IS DISTINCT FROM OLD.vendor_name
       OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
       OR NEW.budget_code IS DISTINCT FROM OLD.budget_code THEN
      RAISE EXCEPTION 'purchase_orders: an approved purchase order cannot be changed; move it back to Draft first'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- leaving / never in an approved state: no approval on record
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_purchase_order_maker_checker ON public.purchase_orders;
CREATE TRIGGER trg_purchase_order_maker_checker
  BEFORE INSERT OR UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_purchase_order_maker_checker();

-- ---------------------------------------------------------------------
-- 5. GL account derived from the budget code (E09)
-- ---------------------------------------------------------------------
-- Default GL account for a budget code range when no mapping row exists.
-- Budget codes follow the top-sheet sections (1000-1999 ATL, 2000-3999
-- production, 5000-6199 post, 5500/5600/7000+ other). Editable per
-- organization by adding rows to budget_code_gl_map (070) — those win.
CREATE OR REPLACE FUNCTION public.default_gl_code_for_budget_code(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH c AS (SELECT substring(btrim(COALESCE(p_code, '')) FROM '^([0-9]{2})') AS h)
  SELECT CASE
    WHEN h IS NULL                  THEN 'GL-4400'
    WHEN h IN ('10','11')           THEN 'GL-1000'
    WHEN h = '12'                   THEN 'GL-1100'
    WHEN h = '13'                   THEN 'GL-1200'
    WHEN h IN ('14','15')           THEN 'GL-1300'
    WHEN h BETWEEN '16' AND '19'    THEN 'GL-1400'
    WHEN h = '20'                   THEN 'GL-2000'
    WHEN h = '21'                   THEN 'GL-2800'
    WHEN h BETWEEN '22' AND '25'    THEN 'GL-2300'
    WHEN h = '26'                   THEN 'GL-2600'
    WHEN h IN ('27','28')           THEN 'GL-2400'
    WHEN h IN ('29','30')           THEN 'GL-2200'
    WHEN h IN ('31','35')           THEN 'GL-2100'
    WHEN h = '32'                   THEN 'GL-2700'
    WHEN h = '33'                   THEN 'GL-2300'
    WHEN h = '34'                   THEN 'GL-2500'
    WHEN h = '36'                   THEN 'GL-2600'
    WHEN h = '37'                   THEN 'GL-4400'
    WHEN h = '38'                   THEN 'GL-3000'
    WHEN h BETWEEN '39' AND '49'    THEN 'GL-2000'
    WHEN h IN ('50','51')           THEN 'GL-3000'
    WHEN h IN ('52','54')           THEN 'GL-3400'
    WHEN h = '53'                   THEN 'GL-3200'
    WHEN h = '55'                   THEN 'GL-4500'
    WHEN h = '56'                   THEN 'GL-4100'
    WHEN h = '60'                   THEN 'GL-3300'
    WHEN h = '61'                   THEN 'GL-3100'
    WHEN h BETWEEN '57' AND '69'    THEN 'GL-3400'
    WHEN h = '72'                   THEN 'GL-4000'
    ELSE 'GL-4400'
  END FROM c
$$;

CREATE OR REPLACE FUNCTION public.derive_gl_account(p_org uuid, p_budget_code text)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE(
    public.resolve_gl_account(p_org, p_budget_code),
    (SELECT g.id FROM public.gl_accounts g
      WHERE g.code = public.default_gl_code_for_budget_code(p_budget_code) AND g.is_active),
    (SELECT g.id FROM public.gl_accounts g WHERE g.code = 'GL-4400')
  )
$$;

CREATE OR REPLACE FUNCTION public.payment_term_days(p_terms text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_terms IS NULL OR btrim(p_terms) = '' THEN NULL
    WHEN lower(btrim(p_terms)) IN ('advance','due on receipt','immediate') THEN 0
    WHEN p_terms ~ '[0-9]+' THEN least(substring(p_terms FROM '([0-9]+)')::int, 3650)
    ELSE NULL END
$$;

-- Invoice defaults and integrity on every write.
CREATE OR REPLACE FUNCTION public.invoices_ap_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_days int;
BEGIN
  -- E09: never a new invoice without a GL account when it has a budget code.
  -- Existing rows are only touched when their budget code is changed.
  IF NEW.gl_account_id IS NULL AND NULLIF(btrim(COALESCE(NEW.budget_code, '')), '') IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.budget_code IS DISTINCT FROM OLD.budget_code) THEN
    NEW.gl_account_id := public.derive_gl_account(NEW.organization_id, NEW.budget_code);
  END IF;
  -- B05: a linked PO must belong to the same project (and be visible to the caller)
  IF NEW.purchase_order_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id) THEN
    PERFORM 1 FROM public.purchase_orders po
     WHERE po.id = NEW.purchase_order_id
       AND po.project_id IS NOT DISTINCT FROM NEW.project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invoices: the linked purchase order is not part of this project'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  -- B15: due date from the payment terms when none was given
  IF NEW.due_date IS NULL AND NEW.date IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.date IS DISTINCT FROM OLD.date
          OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms) THEN
    v_days := public.payment_term_days(NEW.payment_terms);
    IF v_days IS NOT NULL THEN NEW.due_date := NEW.date + v_days; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_invoices_ap_defaults ON public.invoices;
CREATE TRIGGER trg_invoices_ap_defaults
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoices_ap_defaults();

-- ---------------------------------------------------------------------
-- 6. Petty cash holder from people (B08)
-- ---------------------------------------------------------------------
ALTER TABLE public.cash_advances
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.people(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cash_advances_person ON public.cash_advances (person_id) WHERE person_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 7. Car rentals / accommodation as budget commitments (B20)
-- ---------------------------------------------------------------------
ALTER TABLE public.car_rentals
  ADD COLUMN IF NOT EXISTS linked_budget_line_id uuid REFERENCES public.budget_lines(id) ON DELETE SET NULL;
ALTER TABLE public.car_rentals
  ADD COLUMN IF NOT EXISTS total_amount numeric(14,2) GENERATED ALWAYS AS (
    CASE
      WHEN rental_start_date IS NULL OR rental_end_date IS NULL OR rental_end_date < rental_start_date THEN 0
      WHEN rate_type = 'monthly'
        THEN round(((rental_end_date - rental_start_date + 1)::numeric / 30) * COALESCE(monthly_rate, 0), 2)
      ELSE round((rental_end_date - rental_start_date + 1) * COALESCE(daily_rate, 0), 2)
    END) STORED;

ALTER TABLE public.accommodations
  ADD COLUMN IF NOT EXISTS vendor_id             uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_name           text,
  ADD COLUMN IF NOT EXISTS nightly_rate          numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency              text NOT NULL DEFAULT 'SAR',
  ADD COLUMN IF NOT EXISTS budget_code           text,
  ADD COLUMN IF NOT EXISTS linked_budget_line_id uuid REFERENCES public.budget_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_id            uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
ALTER TABLE public.accommodations DROP CONSTRAINT IF EXISTS accommodations_nightly_rate_check;
ALTER TABLE public.accommodations ADD CONSTRAINT accommodations_nightly_rate_check CHECK (nightly_rate >= 0);
ALTER TABLE public.accommodations
  ADD COLUMN IF NOT EXISTS nights integer GENERATED ALWAYS AS (
    CASE WHEN check_in_date IS NULL OR check_out_date IS NULL OR check_out_date < check_in_date THEN 0
         ELSE check_out_date - check_in_date END) STORED;
ALTER TABLE public.accommodations
  ADD COLUMN IF NOT EXISTS total_amount numeric(14,2) GENERATED ALWAYS AS (
    CASE WHEN check_in_date IS NULL OR check_out_date IS NULL OR check_out_date < check_in_date THEN 0
         ELSE round((check_out_date - check_in_date) * nightly_rate, 2) END) STORED;

-- ---------------------------------------------------------------------
-- 8. v_ledger_transactions — PO commitment net of invoices; logistics
-- ---------------------------------------------------------------------
-- Copied from the live definition. Changes:
--   * purchase_order: only commitment states (po_is_commitment), amount =
--     GREATEST(po.amount - invoiced on it (ex VAT), 0)
--   * new branch car_rental    (commitment, SAR, net of its linked invoice)
--   * new branch accommodation (commitment, SAR, net of its linked invoice)
CREATE OR REPLACE VIEW public.v_ledger_transactions WITH (security_invoker = on) AS
 SELECT i.id,
    'invoice'::text AS source_type,
    i.id AS source_id,
    'actual'::text AS entry_kind,
    i.date AS entry_date,
    i.invoice_no AS reference,
    i.description,
    i.vendor_name AS counterparty,
    i.budget_code,
    i.gl_account_id,
    i.department,
    COALESCE(i.price, 0::numeric) AS amount,
    COALESCE(i.vat_amount, 0::numeric) AS vat_amount,
    COALESCE(i.net_payable, COALESCE(i.price, 0::numeric) + COALESCE(i.vat_amount, 0::numeric)) AS total,
    org.base_currency AS currency,
    NULL::text AS status,
    COALESCE(i.rebate_eligible, false) AS qfe_eligible,
    i.organization_id,
    i.project_id,
    i.created_at,
    COALESCE(i.wht_amount, 0::numeric) AS wht_amount
   FROM public.invoices i
     LEFT JOIN public.organizations org ON org.id = i.organization_id
UNION ALL
 SELECT p.id,
    'payroll'::text AS source_type,
    p.id AS source_id,
    'actual'::text AS entry_kind,
    p.created_at::date AS entry_date,
        CASE
            WHEN p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN NULL::text
            ELSE p.ref_id
        END AS reference,
    p.kind AS description,
    p.name AS counterparty,
    p.budget_code,
    p.gl_account_id,
    NULL::text AS department,
    COALESCE(p.total_amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(p.net_payable, COALESCE(p.total_amount, 0::numeric)) AS total,
    org.base_currency AS currency,
    NULL::text AS status,
    false AS qfe_eligible,
    p.organization_id,
    p.project_id,
    p.created_at,
    COALESCE(p.wht_amount, 0::numeric) AS wht_amount
   FROM public.payroll p
     LEFT JOIN public.organizations org ON org.id = p.organization_id
UNION ALL
 SELECT po.id,
    'purchase_order'::text AS source_type,
    po.id AS source_id,
    'commitment'::text AS entry_kind,
    po.date AS entry_date,
    po.po_number AS reference,
    po.description,
    po.vendor_name AS counterparty,
    po.budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    GREATEST(COALESCE(po.amount, 0::numeric) - COALESCE(inv.invoiced, 0::numeric), 0::numeric) AS amount,
    0::numeric AS vat_amount,
    GREATEST(COALESCE(po.amount, 0::numeric) - COALESCE(inv.invoiced, 0::numeric), 0::numeric) AS total,
    org.base_currency AS currency,
    po.status,
    false AS qfe_eligible,
    po.organization_id,
    po.project_id,
    po.created_at,
    0::numeric AS wht_amount
   FROM public.purchase_orders po
     LEFT JOIN public.organizations org ON org.id = po.organization_id
     LEFT JOIN LATERAL (
       SELECT sum(COALESCE(i2.price, 0::numeric)) AS invoiced
         FROM public.invoices i2 WHERE i2.purchase_order_id = po.id
     ) inv ON true
  WHERE public.po_is_commitment(po.status)
UNION ALL
 SELECT r.id,
    'petty_cash'::text AS source_type,
    r.id AS source_id,
    'actual'::text AS entry_kind,
    r.date AS entry_date,
    NULL::text AS reference,
    r.description,
    COALESCE(r.vendor, r.recipient) AS counterparty,
    r.budget_code,
    r.gl_account_id,
    r.department,
    COALESCE(r.amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(r.amount, 0::numeric) AS total,
    COALESCE(r.currency, org.base_currency) AS currency,
    r.status,
    false AS qfe_eligible,
    r.organization_id,
    r.project_id,
    r.created_at,
    0::numeric AS wht_amount
   FROM public.cash_advance_receipts r
     LEFT JOIN public.organizations org ON org.id = r.organization_id
UNION ALL
 SELECT ot.id,
    'overtime'::text AS source_type,
    ot.id AS source_id,
    'actual'::text AS entry_kind,
    ot.work_date AS entry_date,
    NULL::text AS reference,
    NULL::text AS description,
    ot.person_name AS counterparty,
    ot.budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    COALESCE(ot.amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(ot.amount, 0::numeric) AS total,
    COALESCE(ot.currency, org.base_currency) AS currency,
    ot.status,
    false AS qfe_eligible,
    ot.organization_id,
    ot.project_id,
    ot.created_at,
    0::numeric AS wht_amount
   FROM public.overtime_entries ot
     LEFT JOIN public.organizations org ON org.id = ot.organization_id
UNION ALL
 SELECT d.id,
    'per_diem'::text AS source_type,
    d.id AS source_id,
    'actual'::text AS entry_kind,
    d.period_start AS entry_date,
    NULL::text AS reference,
    'Per diem '::text || d.period_start || ' – '::text || d.period_end AS description,
    pe.full_name AS counterparty,
    d.budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    COALESCE(d.total_amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(d.total_amount, 0::numeric) AS total,
    COALESCE(d.currency, org.base_currency) AS currency,
    d.status,
    false AS qfe_eligible,
    d.organization_id,
    d.project_id,
    d.created_at,
    0::numeric AS wht_amount
   FROM public.per_diem_ledger d
     LEFT JOIN public.people pe ON pe.id = d.person_id
     LEFT JOIN public.organizations org ON org.id = d.organization_id
UNION ALL
 SELECT pay.id,
    'payment'::text AS source_type,
    pay.source_id,
    'payment'::text AS entry_kind,
    pay.payment_date AS entry_date,
    NULL::text AS reference,
    pay.source_type || ' payment'::text AS description,
    NULL::text AS counterparty,
    NULL::text AS budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    COALESCE(pay.amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(pay.amount, 0::numeric) AS total,
    org.base_currency AS currency,
    NULL::text AS status,
    false AS qfe_eligible,
    pay.organization_id,
    pay.project_id,
    pay.created_at,
    0::numeric AS wht_amount
   FROM public.payments pay
     LEFT JOIN public.organizations org ON org.id = pay.organization_id
UNION ALL
 SELECT cr.id,
    'car_rental'::text AS source_type,
    cr.id AS source_id,
    'commitment'::text AS entry_kind,
    cr.rental_start_date AS entry_date,
    cr.license_plate AS reference,
    cr.make_model AS description,
    cr.vendor_name AS counterparty,
    COALESCE(NULLIF(cr.budget_code, ''), bl.main_code) AS budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    GREATEST(round(COALESCE(cr.total_amount, 0::numeric)
                   * CASE WHEN upper(cr.currency) = 'USD' THEN COALESCE(pr.fx_rate, 3.75) ELSE 1 END, 2)
             - COALESCE(ci.price, 0::numeric), 0::numeric) AS amount,
    0::numeric AS vat_amount,
    GREATEST(round(COALESCE(cr.total_amount, 0::numeric)
                   * CASE WHEN upper(cr.currency) = 'USD' THEN COALESCE(pr.fx_rate, 3.75) ELSE 1 END, 2)
             - COALESCE(ci.price, 0::numeric), 0::numeric) AS total,
    org.base_currency AS currency,
    NULL::text AS status,
    false AS qfe_eligible,
    COALESCE(cr.organization_id, pr.organization_id) AS organization_id,
    cr.project_id,
    cr.created_at,
    0::numeric AS wht_amount
   FROM public.car_rentals cr
     LEFT JOIN public.projects pr ON pr.id = cr.project_id
     LEFT JOIN public.organizations org ON org.id = COALESCE(cr.organization_id, pr.organization_id)
     LEFT JOIN public.budget_lines bl ON bl.id = cr.linked_budget_line_id
     LEFT JOIN public.invoices ci ON ci.id = cr.invoice_id
  WHERE COALESCE(cr.total_amount, 0) > 0
UNION ALL
 SELECT ac.id,
    'accommodation'::text AS source_type,
    ac.id AS source_id,
    'commitment'::text AS entry_kind,
    ac.check_in_date AS entry_date,
    ac.room_number AS reference,
    COALESCE(ac.hotel_name, 'Accommodation') || ' · ' || COALESCE(pe.full_name, '') AS description,
    COALESCE(ac.vendor_name, ac.hotel_name) AS counterparty,
    COALESCE(NULLIF(ac.budget_code, ''), bl.main_code) AS budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    GREATEST(round(COALESCE(ac.total_amount, 0::numeric)
                   * CASE WHEN upper(ac.currency) = 'USD' THEN COALESCE(pr.fx_rate, 3.75) ELSE 1 END, 2)
             - COALESCE(ai.price, 0::numeric), 0::numeric) AS amount,
    0::numeric AS vat_amount,
    GREATEST(round(COALESCE(ac.total_amount, 0::numeric)
                   * CASE WHEN upper(ac.currency) = 'USD' THEN COALESCE(pr.fx_rate, 3.75) ELSE 1 END, 2)
             - COALESCE(ai.price, 0::numeric), 0::numeric) AS total,
    org.base_currency AS currency,
    NULL::text AS status,
    false AS qfe_eligible,
    COALESCE(ac.organization_id, pr.organization_id) AS organization_id,
    ac.project_id,
    ac.created_at,
    0::numeric AS wht_amount
   FROM public.accommodations ac
     LEFT JOIN public.projects pr ON pr.id = ac.project_id
     LEFT JOIN public.organizations org ON org.id = COALESCE(ac.organization_id, pr.organization_id)
     LEFT JOIN public.people pe ON pe.id = ac.person_id
     LEFT JOIN public.budget_lines bl ON bl.id = ac.linked_budget_line_id
     LEFT JOIN public.invoices ai ON ai.id = ac.invoice_id
  WHERE COALESCE(ac.total_amount, 0) > 0;

COMMENT ON VIEW public.v_ledger_transactions IS
  'One row per cost document. actual = invoices, payroll, petty cash, overtime, per diem; commitment = purchase orders (net of invoices raised on them, commitment states only), car rentals and accommodation (net of their linked invoice); payment = payments ledger. Amounts in the record currency (SAR). Redefined by db/pending/174.';
