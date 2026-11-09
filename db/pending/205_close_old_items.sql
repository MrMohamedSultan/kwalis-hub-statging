-- =====================================================================
-- 205 — Closing the client's open items of 29/10 – 8/11
--
-- 1. Reports page groups (N06): five per-group modules under "Reports" in
--    the role matrix, so an admin can decide per role which report groups
--    it sees. Seeded from each role's existing "reports" row (nothing that
--    works today is taken away), except that the system "Producer" role does
--    not get the Accounting and Cash & Bank groups (client's sheet).
-- 2. New crew / cast contract saved in ONE transaction (QA 29/10: a failed
--    step left a hidden contract and the next save hit "duplicate key"):
--    save_new_contract(person jsonb, payroll jsonb). SECURITY INVOKER — the
--    caller's own RLS policies and every existing trigger apply exactly as
--    for the two separate inserts the app made before; only the columns
--    present in the JSON are written (defaults keep working).
-- 3. Link an existing invoice to its purchase order (QA 29/10: PO 1,000 +
--    invoice 1,000 counted twice): link_invoice_to_po(invoice, po).
--    An APPROVED invoice that has no PO may now be linked once (the PO is
--    no longer part of the approved-invoice lock); a PO already set on an
--    approved / cancelled invoice still cannot be changed or removed.
--    Linking an approved invoice needs an invoice approver of the
--    organization. Two links at the same time are taken one after the
--    other (PO row locked FOR UPDATE).
--    Checks: same project (existing 174 trigger), the PO is a live
--    commitment (not draft / cancelled / rejected / closed) — also for new
--    invoices; when an EXISTING invoice is linked: same vendor when both
--    have one, same budget code when both have one, and the invoice amount
--    fits the PO's open amount.
-- 5. The creator of a contract is written by the database (maker-checker:
--    a user could set created_by to someone else and approve his own
--    contract — found in the security review of this file).
-- 4. Read-only list of contracts saved before the currency fix whose
--    figures are still in the contract currency (QA 29/10: 2,000 USD
--    counted as 2,000 SAR): contracts_not_in_base_currency(project).
--    Nothing is changed: each one is corrected by opening and saving it in
--    the app (the form converts it).
--
-- Objects: modules rows reports-*; role_permissions rows for them;
--   public.insert_row_from_jsonb(regclass, jsonb) (internal);
--   public.save_new_contract(jsonb, jsonb);
--   public.invoice_lock_view(jsonb) (re-created without purchase_order_id);
--   public.guard_invoice_po_link() + trigger zz_trg_invoice_po_link;
--   public.link_invoice_to_po(uuid, uuid);
--   public.contracts_not_in_base_currency(uuid);
--   public.guard_people_creator() + trigger a_trg_people_creator.
--
-- Rollback:
--   DROP TRIGGER a_trg_people_creator ON public.people; DROP FUNCTION public.guard_people_creator();
--   DROP FUNCTION public.contracts_not_in_base_currency(uuid);
--   DROP FUNCTION public.link_invoice_to_po(uuid, uuid);
--   DROP TRIGGER zz_trg_invoice_po_link ON public.invoices; DROP FUNCTION public.guard_invoice_po_link();
--   re-run the invoice_lock_view definition of 201 (adds purchase_order_id back);
--   DROP FUNCTION public.save_new_contract(jsonb, jsonb); DROP FUNCTION public.insert_row_from_jsonb(regclass, jsonb);
--   DELETE FROM public.modules WHERE key LIKE 'reports-%';  (cascades to role_permissions)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Report group modules
-- ---------------------------------------------------------------------
INSERT INTO public.modules (key, label, icon, route_path, parent_key, sort_order, layer, is_active) VALUES
  ('reports-budget-cost', 'Reports · Budget & Cost',            'PieChart',  NULL, 'budget-reporting', 31, 'operational', true),
  ('reports-payables',    'Reports · Payables & Payments',      'PieChart',  NULL, 'budget-reporting', 32, 'operational', true),
  ('reports-cash',        'Reports · Cash & Bank',              'PieChart',  NULL, 'budget-reporting', 33, 'operational', true),
  ('reports-accounting',  'Reports · Accounting',               'PieChart',  NULL, 'budget-reporting', 34, 'operational', true),
  ('reports-commission',  'Reports · Commission & Platforms',   'PieChart',  NULL, 'budget-reporting', 35, 'operational', true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
SELECT rp.role_id, m.key, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete, rp.can_export
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
 CROSS JOIN (VALUES ('reports-budget-cost'), ('reports-payables'), ('reports-cash'),
                    ('reports-accounting'), ('reports-commission')) m(key)
 WHERE rp.module_key = 'reports'
   AND NOT (r.slug = 'producer' AND r.is_system AND m.key IN ('reports-accounting', 'reports-cash'))
ON CONFLICT (role_id, module_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. New contract in one transaction
-- ---------------------------------------------------------------------
-- Inserts one row built from the keys of p_row that are real, writable
-- columns of the table. SECURITY INVOKER: RLS and triggers of the caller.
-- Only the two contract tables are accepted.
CREATE OR REPLACE FUNCTION public.insert_row_from_jsonb(p_table regclass, p_row jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_cols text;
BEGIN
  IF p_table NOT IN ('public.people'::regclass, 'public.payroll'::regclass) THEN
    RAISE EXCEPTION 'insert_row_from_jsonb: table % is not allowed', p_table USING ERRCODE = '42501';
  END IF;
  IF p_row IS NULL OR jsonb_typeof(p_row) <> 'object' THEN
    RAISE EXCEPTION 'insert_row_from_jsonb: a JSON object is required' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = p_table AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attgenerated = '' AND a.attidentity <> 'a'
     AND p_row ? a.attname;
  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'insert_row_from_jsonb: no known column in the row' USING ERRCODE = '22023';
  END IF;
  EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_record(NULL::%s, $1)',
                 p_table, v_cols, v_cols, p_table)
    USING p_row;
END $$;
REVOKE ALL ON FUNCTION public.insert_row_from_jsonb(regclass, jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.save_new_contract(p_person jsonb, p_payroll jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'save_new_contract: sign in first' USING ERRCODE = '42501';
  END IF;
  v_id := NULLIF(p_person->>'id', '')::uuid;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'save_new_contract: the contract id is required' USING ERRCODE = '22023';
  END IF;
  IF p_payroll IS NULL OR p_payroll->>'ref_id' IS DISTINCT FROM v_id::text THEN
    RAISE EXCEPTION 'save_new_contract: the payroll row must belong to this contract' USING ERRCODE = '22023';
  END IF;
  IF (p_payroll->>'project_id') IS DISTINCT FROM (p_person->>'project_id') THEN
    RAISE EXCEPTION 'save_new_contract: contract and payroll must be in the same project' USING ERRCODE = '22023';
  END IF;
  -- both inserts run in this one statement's transaction: all or nothing
  PERFORM public.insert_row_from_jsonb('public.people'::regclass, p_person);
  PERFORM public.insert_row_from_jsonb('public.payroll'::regclass, p_payroll);
  RETURN v_id;
END $$;
-- the helper is called with the caller's rights from inside the function
GRANT EXECUTE ON FUNCTION public.insert_row_from_jsonb(regclass, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.save_new_contract(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_new_contract(jsonb, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Invoice ↔ purchase order link
-- ---------------------------------------------------------------------
-- 201's lock view without purchase_order_id; the link has its own guard below.
CREATE OR REPLACE FUNCTION public.invoice_lock_view(j jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'price',            round(COALESCE((j->>'price')::numeric, 0), 2),
    'vat_amount',       round(COALESCE((j->>'vat_amount')::numeric, 0), 2),
    'wht_amount',       round(COALESCE((j->>'wht_amount')::numeric, 0), 2),
    'wht_percent',      COALESCE((j->>'wht_percent')::numeric, 0),
    'net_payable',      round((j->>'net_payable')::numeric, 2),
    'currency',         upper(COALESCE(NULLIF(btrim(j->>'currency'), ''), 'SAR')),
    'fx_rate',          (j->>'fx_rate')::numeric,
    'amount_original',  (j->>'amount_original')::numeric,
    'fx_rate_source',   NULLIF(btrim(j->>'fx_rate_source'), ''),
    'fx_rate_date',     j->>'fx_rate_date',
    'vendor_name',      NULLIF(btrim(j->>'vendor_name'), ''),
    'budget_code',      NULLIF(btrim(j->>'budget_code'), ''),
    'department',       NULLIF(btrim(j->>'department'), ''),
    'gl_account_id',    j->>'gl_account_id',
    'project_id',       j->>'project_id',
    'organization_id',  j->>'organization_id',
    'date',             j->>'date',
    'invoice_no',       NULLIF(btrim(j->>'invoice_no'), ''),
    'vatable',          COALESCE((j->>'vatable')::boolean, false),
    'vat_treatment',    COALESCE(NULLIF(j->>'vat_treatment', ''),
                                 CASE WHEN COALESCE((j->>'vatable')::boolean, false) THEN 'standard' ELSE 'exempt' END),
    'vat_rate',         (j->>'vat_rate')::numeric,
    'wht_treatment',    NULLIF(j->>'wht_treatment', ''),
    'wht_gl_code',      COALESCE(NULLIF(btrim(j->>'wht_gl_code'), ''),
                                 CASE WHEN COALESCE((j->>'wht_amount')::numeric, 0) > 0 THEN '2140' END),
    'rebate_eligible',  COALESCE((j->>'rebate_eligible')::boolean, false),
    'rebate_manual_override', COALESCE((j->>'rebate_manual_override')::boolean, false),
    'is_non_saudi_vendor', COALESCE((j->>'is_non_saudi_vendor')::boolean, false),
    'service_inside_ksa', COALESCE((j->>'service_inside_ksa')::boolean, true),
    'is_related_party', COALESCE((j->>'is_related_party')::boolean, false),
    'spend_country',    NULLIF(btrim(j->>'spend_country'), ''),
    'spend_city',       NULLIF(btrim(j->>'spend_city'), ''),
    'service_period_from', j->>'service_period_from',
    'service_period_to',   j->>'service_period_to',
    'service_received_date', j->>'service_received_date',
    'beneficiary_id',   j->>'beneficiary_id')
$$;
REVOKE ALL ON FUNCTION public.invoice_lock_view(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_lock_view(jsonb) TO authenticated, service_role;

-- Rules for setting / changing invoices.purchase_order_id (all invoices).
CREATE OR REPLACE FUNCTION public.guard_invoice_po_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  po record;
  v_other numeric;
  v_relink boolean := TG_OP = 'UPDATE' AND NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id;
  -- a rejected / cancelled invoice sent again counts on its PO again (review N2)
  v_revive boolean := TG_OP = 'UPDATE' AND OLD.approval_status IN ('rejected', 'cancelled')
                      AND NEW.approval_status IN ('pending', 'approved');
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;          -- server jobs / SQL editor
  IF TG_OP = 'UPDATE' AND NOT v_relink AND NOT v_revive
     AND (NEW.purchase_order_id IS NULL OR COALESCE(NEW.price, 0) <= COALESCE(OLD.price, 0)) THEN
    RETURN NEW;
  END IF;
  IF v_relink AND OLD.approval_status IN ('approved', 'cancelled') THEN
    IF OLD.approval_status = 'cancelled' OR OLD.purchase_order_id IS NOT NULL OR NEW.purchase_order_id IS NULL THEN
      RAISE EXCEPTION 'invoices: the purchase order of an approved or cancelled invoice cannot be changed — only an approved invoice without a purchase order can be linked to one'
        USING ERRCODE = '42501';
    END IF;
    -- linking an approved invoice moves money from commitment: an approver decides
    IF NOT public.can_approve_invoice(OLD.project_id, COALESCE(OLD.price, 0) + COALESCE(OLD.vat_amount, 0)) THEN
      RAISE EXCEPTION 'invoices: only an approver of this organization can link an approved invoice to a purchase order'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.purchase_order_id IS NULL THEN RETURN NEW; END IF;
  -- FOR UPDATE: two links to the same PO at the same time are taken one after the other
  SELECT p.id, p.status, p.vendor_id, p.vendor_name, p.budget_code, p.amount, p.project_id
    INTO po FROM public.purchase_orders p WHERE p.id = NEW.purchase_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoices: the linked purchase order does not exist' USING ERRCODE = '23503';
  END IF;
  IF (TG_OP = 'INSERT' OR v_relink) AND NOT public.po_is_commitment(po.status) THEN
    RAISE EXCEPTION 'invoices: purchase order is % — only an approved / open purchase order can take invoices', po.status
      USING ERRCODE = '23514';
  END IF;
  -- A new invoice keeps the rules of the invoice form (174). Linking an
  -- existing invoice afterwards — or raising the amount of a linked one —
  -- must also match vendor, code and the PO's open amount.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF v_relink AND (
       (po.vendor_id IS NOT NULL AND NEW.vendor_id IS NOT NULL AND po.vendor_id <> NEW.vendor_id)
       OR ((po.vendor_id IS NULL OR NEW.vendor_id IS NULL)
           AND NULLIF(btrim(po.vendor_name), '') IS NOT NULL AND NULLIF(btrim(NEW.vendor_name), '') IS NOT NULL
           AND lower(btrim(po.vendor_name)) <> lower(btrim(NEW.vendor_name)))) THEN
    RAISE EXCEPTION 'invoices: the purchase order is for another vendor' USING ERRCODE = '23514';
  END IF;
  IF v_relink AND NULLIF(btrim(po.budget_code), '') IS NOT NULL AND NULLIF(btrim(NEW.budget_code), '') IS NOT NULL
     AND btrim(po.budget_code) <> btrim(NEW.budget_code) THEN
    RAISE EXCEPTION 'invoices: the purchase order is on budget code %, the invoice on %', po.budget_code, NEW.budget_code
      USING ERRCODE = '23514';
  END IF;
  -- the invoice must fit what is still open on a live PO (other live invoices);
  -- a PO that is no longer a commitment (cancelled / closed) has nothing to relieve
  IF NOT public.po_is_commitment(po.status) THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(sum(COALESCE(i.price, 0)), 0) INTO v_other
    FROM public.invoices i
   WHERE i.purchase_order_id = po.id AND i.id <> NEW.id
     AND i.approval_status IN ('approved', 'pending');
  IF COALESCE(NEW.price, 0) > COALESCE(po.amount, 0) - v_other + 0.005 THEN
    RAISE EXCEPTION 'invoices: the invoice (%) is more than what is still open on the purchase order (%)',
      round(COALESCE(NEW.price, 0), 2), round(GREATEST(COALESCE(po.amount, 0) - v_other, 0), 2)
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_invoice_po_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_trg_invoice_po_link ON public.invoices;
CREATE TRIGGER zz_trg_invoice_po_link
  BEFORE INSERT OR UPDATE OF purchase_order_id, price, approval_status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_po_link();

-- The app's "Link to purchase order" action. SECURITY INVOKER: the caller
-- needs the normal right to update the invoice (RLS); the triggers check
-- the rest.
CREATE OR REPLACE FUNCTION public.link_invoice_to_po(p_invoice uuid, p_po uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'link_invoice_to_po: sign in first' USING ERRCODE = '42501';
  END IF;
  IF p_po IS NULL THEN
    RAISE EXCEPTION 'link_invoice_to_po: choose a purchase order' USING ERRCODE = '22023';
  END IF;
  UPDATE public.invoices SET purchase_order_id = p_po WHERE id = p_invoice;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_invoice_to_po: invoice not found or not editable by you' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.link_invoice_to_po(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_invoice_to_po(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Contracts still in their contract currency (read only)
-- ---------------------------------------------------------------------
-- A contract whose currency is not the organization's base currency and
-- whose stored total equals the contract-currency value (days × rate for
-- cast, or the crew amount) was saved before the currency fix.
CREATE OR REPLACE FUNCTION public.contracts_not_in_base_currency(p_project uuid)
RETURNS TABLE (contract_id uuid, full_name text, kind text, ccy text, stored_total numeric,
               contract_value numeric, fx_rate numeric, expected_total numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT pe.id, pe.full_name, pe.kind, upper(pe.ccy), pr.total_amount,
         round(COALESCE(pe.shooting_days, 0) * COALESCE(pe.daily_rate, 0), 2) AS contract_value,
         p.fx_rate,
         round(pr.total_amount * p.fx_rate, 2)
    FROM public.people pe
    JOIN public.projects p ON p.id = pe.project_id
    JOIN public.organizations o ON o.id = p.organization_id
    JOIN public.payroll pr ON pr.ref_id = pe.id::text AND pr.project_id = pe.project_id
   WHERE pe.project_id = p_project
     AND NULLIF(btrim(pe.ccy), '') IS NOT NULL
     AND upper(pe.ccy) <> upper(COALESCE(NULLIF(p.base_currency, ''), o.base_currency, 'SAR'))
     AND COALESCE(p.fx_rate, 0) NOT IN (0, 1)
     AND pr.contract_cancelled_at IS NULL
     AND abs(pr.total_amount - COALESCE(pe.shooting_days, 0) * COALESCE(pe.daily_rate, 0)) < 0.01
$$;
REVOKE ALL ON FUNCTION public.contracts_not_in_base_currency(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contracts_not_in_base_currency(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Contract creator cannot be chosen by the client (review of 205)
-- ---------------------------------------------------------------------
-- The contract maker-checker (approve ≠ creator) trusts people.created_by,
-- which stamp_audit_fields only fills when it is empty: a user could save a
-- contract "created by" someone else and then approve it. The database now
-- writes the creator itself (the signed-in user — also for a restore from
-- the trash; the original creator stays in the audit history) and it
-- cannot be changed afterwards.
CREATE OR REPLACE FUNCTION public.guard_people_creator()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;               -- server jobs / imports / seeds
  IF TG_OP = 'INSERT' THEN
    -- always the signed-in user, also for a row restored from the trash: the
    -- restorer then cannot approve it either (a new contract re-using the id
    -- of a trashed one must not inherit someone else's name — review N1)
    NEW.created_by := v_uid;
  ELSIF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'people: the creator of a contract cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_people_creator() FROM PUBLIC, anon, authenticated;
-- named to run before the other BEFORE triggers (they fire in name order)
DROP TRIGGER IF EXISTS a_trg_people_creator ON public.people;
CREATE TRIGGER a_trg_people_creator
  BEFORE INSERT OR UPDATE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.guard_people_creator();
