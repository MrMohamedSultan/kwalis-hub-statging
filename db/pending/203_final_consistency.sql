-- =====================================================================
-- 203 — Final consistency after 201 (invoice approval, decision 12).
--
-- Why: db/pending/201 made an invoice count as Actual only once another
-- user approves it (pending = Commitment, rejected / cancelled = nowhere)
-- and moved the company-borne WHT of Exclusive contracts to budget code
-- 7099 as new v_ledger_transactions rows (source_type 'payroll_wht').
-- Four report functions read invoices / the ledger by their own rules and
-- did not follow:
--
-- 1. rebate_transactions (197) — the single Film Commission eligibility
--    source — listed EVERY invoice, so a pending, rejected or cancelled
--    invoice counted in QPE / claimable rebate. Now: approved invoices
--    only. Everything that reads it follows without being redefined
--    (get_film_commission_rebate, get_budget_by_region of 201, the GL /
--    petty cash QPE columns of 202's app code).
-- 2. get_gsr (100) — amounts were already approved-only (it reads
--    entry_kind = 'actual' of v_ledger_transactions, which 201 gives an
--    invoice only once approved), but the new 'payroll_wht' rows did not
--    match their contract's place / nationality and fell into
--    "Unspecified" / spend type "Other". Now a 7099 WHT row takes its
--    contract's place, nationality and spend type (Labour unless the
--    organization maps 7099 to another spend type), so the GSR total still
--    equals the Actual of the ledger.
-- 3. get_gsr_payments (198) and 4. get_payments_register (196) — a
--    payment on an invoice that is not approved is still listed (it is real
--    cash out and a bank credit in the General Ledger, so the R12 tie-out
--    "Σ net on 9100 = GL bank credits" keeps holding) but flagged with the
--    new last column invoice_not_approved = true, and the screens show it.
--    201 already refuses such a payment for signed-in users
--    (trg_payments_invoice_approved) and refuses to cancel an invoice that
--    has payments, so on normal data no row is flagged; it only happens for
--    rows written by the service role / imports (auth.uid() IS NULL). They
--    should be fixed (approve the invoice) — ask the accountant if any appear.
--
-- Consumers of source_type = 'payroll' in v_ledger_transactions (reviewed):
--   * views by budget code / totals (v_budget_code_position,
--     v_project_position, v_paid_by_code, v_source_totals_by_code,
--     get_budget_tracking, get_cost_report(_detail), get_cost_by_gl_account
--     amounts) have no source_type filter: the 7099 rows are included.
--   * get_cost_by_gl_account counts a 7099 row as an "other" document and
--     get_line_transactions / get_code_transactions label it 'Payroll_Wht'
--     (initcap); neither is called by the app — left unchanged.
--   * app code (budget-actuals, BudgetLineActualsModal, tax-cash) already
--     handles 'payroll_wht' (201 branch).
--
-- Nothing else changes: no table, column, policy, grant or data. All four
-- functions stay SECURITY INVOKER with their access checks. 3 and 4 are
-- dropped and re-created (their result gains a column; nothing in the
-- database depends on them), with their REVOKE / GRANT lines.
--
-- Rollback: re-run the function definitions (with their REVOKE / GRANT /
-- COMMENT lines) from db/pending/197 §7 (rebate_transactions), 100
-- (get_gsr); for 198 (get_gsr_payments) and 196 §6 (get_payments_register)
-- first DROP FUNCTION public.get_gsr_payments(uuid, date, date) /
-- public.get_payments_register(uuid, date, date) (the result type changes back).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. rebate_transactions — copy of 197 (incl. secfix edits); change marked 203
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rebate_transactions(p_project_id uuid)
RETURNS TABLE (
  source            text,       -- invoice | petty_cash | payroll | overtime | per_diem
  source_id         uuid,
  ref_no            text,       -- Kwalis reference (184)
  doc_no            text,       -- supplier invoice number
  entry_date        date,
  period_from       date,
  period_to         date,
  party             text,
  person_id         uuid,
  person_kind       text,
  vendor_id         uuid,
  nationality       text,
  mother_saudi      boolean,
  vendor_cr         text,
  budget_code       text,
  cost_group        text,
  qpe_category      text,
  mapping_status    text,       -- approved | suggested
  status            text,
  rule              text,       -- override | legacy_override | code_mapping | period | service | person | vendor | airline | cash | mapping | receipt
  reason            text,
  override_reason   text,
  override_by       uuid,
  override_at       timestamptz,
  description       text,
  currency          text,
  amount_excl_vat   numeric,
  vat_amount        numeric,
  amount_total      numeric,
  actual_excl       numeric,
  paid              numeric,
  paid_excl         numeric,
  claimable_excl    numeric,
  payments_count    integer,
  cash_paid         numeric,
  max_cash_payment  numeric,
  payment_methods   text,
  bank_refs         text,
  first_payment_date date,
  last_payment_date date,
  payee_iban        text,
  has_source_doc    boolean,
  has_payment_proof boolean,
  has_id_doc        boolean,
  documented        boolean,
  related_party     boolean,
  related_party_note text,
  po_ref            text,
  po_total          numeric,
  in_period         text,       -- inside | partial | outside | unknown
  spend_country     text,
  spend_city        text,
  flags             text[]
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_org uuid; v_fx numeric; s public.project_rebate_settings;
  c_logistics constant text := $r$hotel|accommod|lodging|per\s*diem|flight|airfare|air\s*ticket|transport|vehicle|car\s*rent|driver|shuttle|logist$r$;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'rebate_transactions: p_project_id is required' USING ERRCODE = '22004';
  END IF;
  SELECT p.organization_id, p.fx_rate INTO v_org, v_fx FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'rebate_transactions: access denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.project_rebate_settings rs WHERE rs.project_id = p_project_id;

  RETURN QUERY
  WITH pay AS (
    SELECT CASE WHEN pm.source_type IN ('petty_cash', 'cash_advance_receipt', 'receipt') THEN 'petty_cash'
                ELSE pm.source_type END AS st,
           pm.source_id AS sid,
           sum(pm.amount) AS paid,
           count(*)::int AS n,
           sum(pm.amount) FILTER (WHERE pm.method = 'Cash') AS cash,
           max(pm.amount) FILTER (WHERE pm.method = 'Cash') AS max_cash,
           string_agg(DISTINCT pm.method, ', ') AS methods,
           string_agg(DISTINCT pm.bank_reference, ', ') FILTER (WHERE pm.bank_reference IS NOT NULL) AS refs,
           min(pm.payment_date) AS first_date,
           max(pm.payment_date) AS last_date,
           string_agg(DISTINCT pm.payee_iban, ', ') FILTER (WHERE pm.payee_iban IS NOT NULL) AS iban,
           bool_and(pm.proof_path IS NOT NULL OR pm.bank_reference IS NOT NULL) AS all_proof
    FROM public.payments pm
    WHERE pm.project_id = p_project_id
    GROUP BY 1, 2
  ),
  -- persons of the project (payroll rows point at people.id through ref_id)
  ppl AS (
    SELECT pe.* FROM public.people pe WHERE pe.project_id = p_project_id
  ),
  base AS (
    -- invoices
    SELECT 'invoice'::text AS src, i.id AS sid, i.ref_no AS ref, NULLIF(btrim(i.invoice_no), '') AS docno,
           i.date AS edate,
           COALESCE(i.service_period_from, i.date) AS pfrom,
           COALESCE(i.service_period_to, i.service_received_date, i.date) AS pto,
           COALESCE(NULLIF(btrim(i.vendor_name), ''), i.description, '—') AS party,
           -- Rule A: logistics with a named beneficiary follows the person
           CASE WHEN concat_ws(' ', i.description, i.department, i.budget_code) ~* c_logistics THEN b.id END AS pid,
           CASE WHEN concat_ws(' ', i.description, i.department, i.budget_code) ~* c_logistics THEN b.kind END AS pkind,
           v.id AS vid, v.company_nationality AS vnat, v.cr_no AS vcr,
           CASE WHEN concat_ws(' ', i.description, i.department, i.budget_code) ~* c_logistics THEN b.nationality END AS bnat,
           CASE WHEN concat_ws(' ', i.description, i.department, i.budget_code) ~* c_logistics THEN b.mother_saudi END AS bmother,
           COALESCE(i.is_non_saudi_vendor, false) AS non_saudi_vendor,
           COALESCE(i.service_inside_ksa, true) AS inside_ksa,
           COALESCE(i.rebate_manual_override, false) AS legacy_override,
           i.budget_code AS code, i.description AS descr, COALESCE(i.currency, 'SAR') AS ccy,
           COALESCE(i.price, 0) AS excl,
           CASE WHEN COALESCE(i.vat_amount, 0) <> 0 THEN i.vat_amount
                WHEN i.vatable AND COALESCE(i.vat_treatment, 'standard') = 'standard'
                  THEN round(COALESCE(i.price, 0) * COALESCE(s.vat_rate_pct, 15) / 100, 2)
                ELSE 0 END AS vat,
           COALESCE(i.price, 0) AS actual,
           NULL::numeric AS pay_basis_hint,
           (COALESCE(i.invoice_url, i.attachment_url, i.receipt_url) IS NOT NULL) AS src_doc,
           NULL::boolean AS id_doc,
           i.is_related_party AS rel, i.related_party_note AS rel_note,
           COALESCE(po.ref_no, po.po_number) AS po_ref, po.amount AS po_total,
           i.spend_country AS scountry, i.spend_city AS scity,
           i.net_payable AS net,
           (COALESCE(i.currency, 'SAR') <> 'SAR') AS foreign_ccy,
           (i.payment_method IN ('cash', 'petty_cash')) AS doc_cash
    FROM public.invoices i
    LEFT JOIN LATERAL (
      SELECT vv.id, vv.company_nationality, vv.cr_no FROM public.vendors vv
      WHERE vv.organization_id = i.organization_id AND lower(vv.name) = lower(i.vendor_name)
      ORDER BY (vv.project_id = i.project_id) DESC NULLS LAST, vv.created_at
      LIMIT 1
    ) v ON true
    LEFT JOIN ppl b ON b.id = i.beneficiary_id
    LEFT JOIN public.purchase_orders po ON po.id = i.purchase_order_id
    WHERE i.project_id = p_project_id
      AND i.approval_status = 'approved'                                  -- 203: pending / rejected / cancelled are not QPE

    UNION ALL
    -- approved petty cash receipts (money already spent from a float)
    SELECT 'petty_cash', rc.id, rc.ref_no, NULL, rc.date, rc.date, rc.date,
           COALESCE(NULLIF(btrim(rc.vendor), ''), rc.recipient, '—'),
           NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::boolean,
           false, true, false,
           rc.budget_code, COALESCE(rc.description, rc.recipient), COALESCE(rc.currency, 'SAR'),
           round(COALESCE(rc.amount, 0) * COALESCE(NULLIF(rc.fx_rate, 0), 1), 2), 0::numeric,
           round(COALESCE(rc.amount, 0) * COALESCE(NULLIF(rc.fx_rate, 0), 1), 2),
           NULL::numeric,
           (rc.attachment_path IS NOT NULL), NULL::boolean,
           NULL::boolean, NULL::text, NULL::text, NULL::numeric,
           rc.spend_country, rc.spend_city, NULL::numeric, (COALESCE(rc.currency, 'SAR') <> 'SAR'), true
    FROM public.cash_advance_receipts rc
    WHERE rc.project_id = p_project_id AND rc.status = 'approved'

    UNION ALL
    -- crew / cast / vendor contracts
    SELECT 'payroll', p.id, p.ref_no, NULL, COALESCE(pe.start_date, p.created_at::date),
           pe.start_date, pe.end_date, p.name,
           pe.id, COALESCE(pe.kind, p.kind), NULL::uuid, NULL::text, NULL::text,
           pe.nationality, pe.mother_saudi,
           false, true, false,
           p.budget_code, COALESCE(pe.position, p.kind), 'SAR',
           COALESCE(p.total_amount, 0), 0::numeric,
           public.payroll_contract_actual(p.payment_schedule, p.total_amount, p.net_payable,
             CASE WHEN jsonb_array_length(COALESCE(p.payment_schedule, '[]'::jsonb)) = 0
                  THEN public.payroll_legacy_paid(p.id, p.payments, p.percents, p.total_amount) ELSE 0 END),
           NULL::numeric,
           (pe.contract_path IS NOT NULL OR pe.attachment_url IS NOT NULL), (pe.id_attachment_path IS NOT NULL),
           pe.related_party, NULL::text, NULL::text, NULL::numeric,
           p.spend_country, p.spend_city, p.net_payable, false, false
    FROM public.payroll p
    LEFT JOIN LATERAL (
      SELECT pp.* FROM ppl pp
      WHERE pp.id::text = p.ref_id OR (COALESCE(p.ref_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-' AND pp.full_name = p.name)
      ORDER BY (pp.id::text = p.ref_id) DESC, pp.created_at LIMIT 1
    ) pe ON true
    WHERE p.project_id = p_project_id AND COALESCE(p.ref_id, '') NOT LIKE 'invoice:%'

    UNION ALL
    -- approved / paid overtime
    SELECT 'overtime', o.id, o.ref_no, NULL, o.work_date, o.work_date, o.work_date,
           COALESCE(pe.full_name, o.person_name),
           pe.id, COALESCE(pe.kind, o.person_kind), NULL::uuid, NULL::text, NULL::text,
           pe.nationality, pe.mother_saudi,
           false, true, false,
           o.budget_code, 'Overtime', COALESCE(o.currency, 'SAR'),
           COALESCE(o.amount, 0) + COALESCE(o.adjustment, 0), 0::numeric,
           COALESCE(o.amount, 0) + COALESCE(o.adjustment, 0),
           NULL::numeric,
           true, (pe.id_attachment_path IS NOT NULL),
           pe.related_party, NULL::text, NULL::text, NULL::numeric,
           NULL::text, NULL::text, NULL::numeric, (COALESCE(o.currency, 'SAR') <> 'SAR'), false
    FROM public.overtime_entries o
    LEFT JOIN ppl pe ON pe.id = o.person_id
    WHERE o.project_id = p_project_id AND o.status IN ('approved', 'paid')

    UNION ALL
    -- per diem (part of the wage, Film Commission rules sheet)
    SELECT 'per_diem', d.id, d.ref_no, NULL, d.period_start, d.period_start, d.period_end,
           COALESCE(pe.full_name, '—'),
           pe.id, pe.kind, NULL::uuid, NULL::text, NULL::text,
           pe.nationality, pe.mother_saudi,
           false, true, false,
           d.budget_code, 'Per diem', COALESCE(d.currency, 'SAR'),
           COALESCE(d.total_amount, 0), 0::numeric,
           CASE WHEN d.status = 'paid' THEN COALESCE(d.total_amount, 0) ELSE 0 END,
           NULL::numeric,
           (d.receipt_path IS NOT NULL), (pe.id_attachment_path IS NOT NULL),
           pe.related_party, NULL::text, NULL::text, NULL::numeric,
           NULL::text, NULL::text, NULL::numeric, (COALESCE(d.currency, 'SAR') <> 'SAR'), false
    FROM public.per_diem_ledger d
    LEFT JOIN ppl pe ON pe.id = d.person_id
    WHERE d.project_id = p_project_id
  ),
  enriched AS (
    SELECT b.*,
           public.budget_cost_group(b.code) AS grp,
           m.status AS m_status,
           COALESCE(m.qpe_category, CASE WHEN m.id IS NULL THEN sg.category END) AS m_cat,
           COALESCE(m.ineligible_reason, CASE WHEN m.id IS NULL THEN sg.reason END) AS m_reason,
           ov.eligible AS ov_eligible, ov.qpe_category AS ov_cat, ov.ineligible_reason AS ov_reason,
           ov.reason AS ov_text, ov.set_by AS ov_by, ov.set_at AS ov_at,
           pd.paid AS p_paid, pd.n AS p_n, pd.cash AS p_cash, pd.max_cash AS p_max_cash, pd.methods AS p_methods,
           pd.refs AS p_refs, pd.first_date AS p_first, pd.last_date AS p_last, pd.iban AS p_iban,
           pd.all_proof AS p_all_proof,
           public.rebate_period_position(b.pfrom, b.pto, s.production_period_from, s.production_period_to) AS inper
    FROM base b
    LEFT JOIN public.budget_code_qpe_map m ON m.project_id = p_project_id AND m.budget_code = b.code
    LEFT JOIN LATERAL (SELECT * FROM public.qpe_suggest(b.code, NULL)) sg ON m.id IS NULL
    LEFT JOIN public.qpe_overrides ov ON ov.source_type = b.src AND ov.source_id = b.sid AND ov.active
    LEFT JOIN pay pd ON pd.st = b.src AND pd.sid = b.sid
  ),
  money AS (
    SELECT e.*,
           -- petty cash receipts are money already spent (from the float)
           CASE WHEN e.src = 'petty_cash' THEN e.excl ELSE COALESCE(e.p_paid, 0) END AS paid_amt,
           -- an invoice settled in cash / from a float is cash even when recorded as one payment
           CASE WHEN e.src = 'petty_cash' THEN e.excl
                WHEN e.doc_cash IS TRUE THEN COALESCE(e.p_paid, 0) ELSE COALESCE(e.p_cash, 0) END AS cash_amt,
           CASE WHEN e.src = 'petty_cash' THEN e.excl
                WHEN e.doc_cash IS TRUE THEN e.p_paid ELSE e.p_max_cash END AS max_cash_amt,
           CASE WHEN e.src IN ('payroll', 'overtime', 'per_diem') THEN true ELSE false END AS is_person_src,
           -- the category used: wages sources take a wages category of their group
           CASE
             WHEN e.ov_eligible IS TRUE AND e.ov_cat IS NOT NULL THEN e.ov_cat
             WHEN e.m_cat IS NULL THEN NULL
             WHEN e.src IN ('payroll', 'overtime', 'per_diem')
                  AND NOT COALESCE((SELECT c.is_wages FROM public.qpe_categories c WHERE c.code = e.m_cat), false)
               THEN CASE WHEN e.grp = 'ATL' THEN CASE WHEN e.pkind = 'cast' THEN 'cast_fees' ELSE 'atl_wages' END ELSE 'btl_wages' END
             ELSE e.m_cat
           END AS cat
    FROM enriched e
  ),
  decided AS (
    SELECT m.*, c.cash_forbidden, c.special_rule, c.is_wages,
           person_ok.ok AS person_ok, person_ok.why AS person_why,
           d.st, d.rl, d.rs
    FROM money m
    LEFT JOIN public.qpe_categories c ON c.code = m.cat
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN public.is_saudi_nationality(m.bnat) THEN 'yes'
               WHEN m.bmother IS TRUE THEN 'yes'
               WHEN btrim(COALESCE(m.bnat, '')) = '' THEN 'unknown'
               ELSE 'no' END AS ok,
             CASE
               WHEN public.is_saudi_nationality(m.bnat) THEN 'person_saudi'
               WHEN m.bmother IS TRUE THEN 'person_saudi_mother'
               WHEN btrim(COALESCE(m.bnat, '')) = '' THEN 'nationality_missing'
               ELSE 'foreign_wages' END AS why
    ) person_ok
    CROSS JOIN LATERAL (
      SELECT x.st, x.rl, x.rs FROM (VALUES
        -- 1. a reasoned override wins
        (1, CASE WHEN m.ov_eligible IS NOT NULL THEN CASE WHEN m.ov_eligible THEN 'eligible' ELSE 'not_eligible' END END,
            'override', CASE WHEN m.ov_eligible THEN 'override_eligible' ELSE COALESCE(m.ov_reason, 'other') END),
        -- 2. the old invoice toggle had no reason: review it
        (2, CASE WHEN m.legacy_override THEN 'needs_review' END, 'legacy_override', 'override_without_reason'),
        -- 3. the code is not eligible (development, taxes, marketing …)
        (3, CASE WHEN m.m_reason IS NOT NULL THEN 'not_eligible' END, 'code_mapping', m.m_reason),
        -- 4. official production period
        (4, CASE WHEN m.inper = 'outside' THEN 'not_eligible' END, 'period', 'outside_period'),
        -- 5. service rendered outside KSA
        (5, CASE WHEN NOT m.inside_ksa THEN 'not_eligible' END, 'service', 'travel_outside_ksa'),
        -- 6. wages / per diem / logistics for a person: Saudi or Saudi mother
        (6, CASE WHEN m.is_person_src AND m.pid IS NULL THEN 'needs_review' END, 'person', 'person_not_linked'),
        (7, CASE WHEN m.pid IS NOT NULL AND person_ok.ok = 'no' THEN 'not_eligible'
                 WHEN m.pid IS NOT NULL AND person_ok.ok = 'unknown' THEN 'needs_review' END, 'person',
            CASE WHEN m.is_person_src THEN person_ok.why
                 WHEN person_ok.ok = 'no' THEN 'beneficiary_not_saudi' ELSE person_ok.why END),
        -- 8. vendor (invoices that are not decided by a person)
        (8, CASE WHEN m.src = 'invoice' AND m.pid IS NULL
                      AND (m.non_saudi_vendor OR (btrim(COALESCE(m.vnat, '')) <> '' AND NOT public.is_saudi_nationality(m.vnat)))
                 THEN 'not_eligible' END, 'vendor', 'foreign_vendor'),
        (9, CASE WHEN m.src = 'invoice' AND m.pid IS NULL AND btrim(COALESCE(m.vcr, '')) = ''
                 THEN 'needs_review' END, 'vendor', 'vendor_no_cr'),
        -- 9. special categories
        (10, CASE WHEN c.special_rule = 'national_airline' AND NOT public.is_national_airline(m.party) THEN 'not_eligible' END,
             'airline', 'non_national_airline'),
        -- 10. cash rules
        (11, CASE WHEN m.cash_amt > 0 AND (COALESCE(c.cash_forbidden, false) OR m.src IN ('payroll', 'overtime'))
                  THEN 'not_eligible' END, 'cash', 'cash_not_allowed'),
        (12, CASE WHEN s.cash_limit_per_txn_sar IS NOT NULL AND COALESCE(m.max_cash_amt, 0) > s.cash_limit_per_txn_sar
                  THEN 'needs_review' END, 'cash', 'cash_over_txn_limit'),
        -- 11. partly outside the production period
        (13, CASE WHEN m.inper = 'partial' THEN 'needs_review' END, 'period', 'partly_outside_period'),
        -- 12. no category at all (no budget code)
        (14, CASE WHEN m.cat IS NULL THEN 'needs_review' END, 'mapping', 'no_budget_code'),
        -- 13. the mapping is only a system suggestion
        (15, CASE WHEN COALESCE(m.m_status, 'suggested') <> 'approved' THEN 'needs_review' END, 'mapping', 'mapping_not_approved'),
        -- eligible: say which rule made it eligible
        (99, 'eligible',
             CASE WHEN m.pid IS NOT NULL THEN 'person' WHEN m.src = 'invoice' THEN 'vendor' ELSE 'receipt' END,
             CASE WHEN m.pid IS NOT NULL THEN person_ok.why WHEN m.src = 'invoice' THEN 'vendor_saudi_cr' ELSE 'petty_cash_receipt' END)
      ) x(ord, st, rl, rs)
      WHERE x.st IS NOT NULL
      ORDER BY x.ord LIMIT 1
    ) d
  )
  SELECT d.src, d.sid, d.ref, d.docno, d.edate, d.pfrom, d.pto, d.party, d.pid, d.pkind, d.vid,
         COALESCE(d.bnat, d.vnat), d.bmother, NULLIF(btrim(COALESCE(d.vcr, '')), ''),
         d.code, d.grp, d.cat, COALESCE(d.m_status, 'suggested'),
         d.st, d.rl, d.rs,
         CASE WHEN d.ov_eligible IS NOT NULL THEN d.ov_text END, d.ov_by, d.ov_at,
         d.descr, d.ccy,
         round(d.excl, 2), round(d.vat, 2), round(d.excl + d.vat, 2),
         round(d.actual, 2),
         round(d.paid_amt, 2),
         round(pe.paid_excl, 2),
         round(CASE WHEN d.st = 'eligible' AND dc.documented THEN pe.paid_excl ELSE 0 END, 2),
         CASE WHEN d.src = 'petty_cash' THEN 1 ELSE COALESCE(d.p_n, 0) END,
         round(d.cash_amt, 2), round(d.max_cash_amt, 2),
         CASE WHEN d.src = 'petty_cash' THEN 'Cash' ELSE d.p_methods END,
         d.p_refs,
         CASE WHEN d.src = 'petty_cash' THEN d.edate ELSE d.p_first END,
         CASE WHEN d.src = 'petty_cash' THEN d.edate ELSE d.p_last END,
         d.p_iban,
         d.src_doc,
         CASE WHEN d.src = 'petty_cash' THEN d.src_doc ELSE COALESCE(d.p_all_proof, false) END,
         d.id_doc,
         dc.documented,
         d.rel, d.rel_note, d.po_ref, d.po_total,
         d.inper, d.scountry, d.scity,
         array_remove(ARRAY[
           CASE WHEN NOT d.src_doc THEN 'source_document_missing' END,
           CASE WHEN d.paid_amt > 0 AND d.src <> 'petty_cash' AND NOT COALESCE(d.p_all_proof, false) THEN 'payment_proof_missing' END,
           CASE WHEN d.id_doc IS FALSE THEN 'id_document_missing' END,
           CASE WHEN d.paid_amt > 0 AND d.src <> 'petty_cash' AND d.p_refs IS NULL AND COALESCE(d.p_methods, '') <> 'Cash' THEN 'bank_reference_missing' END,
           CASE WHEN d.src = 'invoice' AND d.pid IS NULL AND d.vcr IS NULL THEN 'vendor_cr_missing' END,
           CASE WHEN d.is_person_src AND d.rel IS NULL THEN 'related_party_unanswered' END,
           CASE WHEN d.foreign_ccy THEN 'fx_sama_rate_check' END,
           CASE WHEN d.inper = 'unknown' THEN 'production_period_unknown' END
         ], NULL)
  FROM decided d
  CROSS JOIN LATERAL (
    SELECT LEAST(d.excl, d.paid_amt * d.excl /
             NULLIF(CASE WHEN d.src = 'invoice' THEN COALESCE(d.net, d.excl + d.vat)
                         WHEN d.src = 'payroll' THEN COALESCE(NULLIF(d.net, 0), d.excl)
                         ELSE d.excl END, 0)) AS paid_excl
  ) pe0
  CROSS JOIN LATERAL (SELECT COALESCE(pe0.paid_excl, 0) AS paid_excl) pe
  CROSS JOIN LATERAL (
    SELECT (d.src_doc
            AND (d.id_doc IS NOT FALSE)
            AND (d.src = 'petty_cash' OR d.paid_amt = 0 OR COALESCE(d.p_all_proof, false))) AS documented
  ) dc
  ORDER BY d.edate NULLS LAST, d.src, d.ref NULLS LAST, d.sid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rebate_transactions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebate_transactions(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.rebate_transactions(uuid) IS
  'E12 single Film Commission eligibility source: one row per APPROVED invoice (db/pending/201 approval; 203) / approved petty-cash receipt / contract / overtime / per diem with QPE category, status (eligible / not_eligible / needs_review), the deciding rule, paid (payments table), documents and flags. Every section of get_film_commission_rebate reads it. db/pending/197; approved invoices only since db/pending/203.';

-- ---------------------------------------------------------------------
-- 2. get_gsr — copy of 100; changes marked 203
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_gsr(
  p_project_id uuid,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
RETURNS TABLE (
  country         text,
  city            text,
  category        text,
  spend_type      text,
  local_intl      text,
  amount_excl_vat numeric,
  pct             numeric,
  shoot_days      integer,
  transactions    integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_org uuid;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'get_gsr: p_project_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'get_gsr: p_from is after p_to' USING ERRCODE = '22023';
  END IF;
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_gsr: access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH place AS (   -- recorded place + nationality of each source row
    SELECT 'invoice'::text AS st, i.id,
           COALESCE(NULLIF(btrim(i.spend_country), ''), NULLIF(btrim(v.company_nationality), '')) AS country,
           NULLIF(btrim(i.spend_city), '') AS city,
           CASE WHEN COALESCE(i.is_non_saudi_vendor, false) THEN true
                WHEN btrim(COALESCE(v.company_nationality, '')) <> ''
                  THEN lower(btrim(v.company_nationality)) NOT IN ('saudi arabia', 'saudi', 'ksa')
                ELSE false END AS is_foreign
    FROM public.invoices i
    LEFT JOIN LATERAL (
      SELECT vv.company_nationality FROM public.vendors vv
      WHERE vv.organization_id = i.organization_id AND lower(vv.name) = lower(i.vendor_name)
      ORDER BY (vv.project_id = i.project_id) DESC NULLS LAST, vv.created_at LIMIT 1
    ) v ON true
    WHERE i.project_id = p_project_id
    UNION ALL
    SELECT 'payroll', p.id,
           COALESCE(NULLIF(btrim(p.spend_country), ''), NULLIF(btrim(pe.country), '')),
           NULLIF(btrim(p.spend_city), ''),
           (btrim(COALESCE(pe.nationality, '')) <> ''
            AND lower(btrim(pe.nationality)) NOT IN ('saudi arabia', 'saudi', 'ksa'))
    FROM public.payroll p
    LEFT JOIN LATERAL (
      SELECT pp.country, pp.nationality FROM public.people pp
      WHERE pp.project_id = p.project_id AND pp.full_name = p.name
      ORDER BY pp.created_at LIMIT 1
    ) pe ON true
    WHERE p.project_id = p_project_id
    UNION ALL
    SELECT 'petty_cash', r.id,
           NULLIF(btrim(r.spend_country), ''), NULLIF(btrim(r.spend_city), ''), false
    FROM public.cash_advance_receipts r
    WHERE r.project_id = p_project_id
    UNION ALL
    SELECT 'per_diem', d.id, NULLIF(btrim(pe.country), ''), NULL::text,
           (btrim(COALESCE(pe.nationality, '')) <> ''
            AND lower(btrim(pe.nationality)) NOT IN ('saudi arabia', 'saudi', 'ksa'))
    FROM public.per_diem_ledger d
    LEFT JOIN public.people pe ON pe.id = d.person_id
    WHERE d.project_id = p_project_id
    UNION ALL
    SELECT 'overtime', ot.id, NULLIF(btrim(pe.country), ''), NULL::text,
           (btrim(COALESCE(pe.nationality, '')) <> ''
            AND lower(btrim(pe.nationality)) NOT IN ('saudi arabia', 'saudi', 'ksa'))
    FROM public.overtime_entries ot
    LEFT JOIN public.people pe ON pe.id = ot.person_id
    WHERE ot.project_id = p_project_id
  ),
  code_section AS (
    SELECT bl.main_code AS code, mode() WITHIN GROUP (ORDER BY ts.section) AS section
    FROM public.v_active_budget_lines bl
    JOIN public.budget_topsheet_accounts ts ON ts.code = bl.topsheet_code
    WHERE bl.project_id = p_project_id
    GROUP BY bl.main_code
  ),
  led AS (
    SELECT CASE WHEN lower(COALESCE(pl.country, '')) IN ('saudi', 'ksa', 'saudi arabia') THEN 'Saudi Arabia'
                ELSE COALESCE(pl.country, 'Unspecified') END              AS country,
           COALESCE(pl.city, 'Unspecified')                               AS city,
           COALESCE(cs.section, 'Other')                                  AS category,
           public.resolve_gsr_spend_type(v_org, t.budget_code, sx.st) AS spend_type,   -- 203
           CASE WHEN COALESCE(pl.is_foreign, false) THEN 'International' ELSE 'Local' END AS local_intl,
           t.amount
    FROM public.v_ledger_transactions t
    -- 203: the company-borne WHT of a contract (decision 12, 7099) is spent
    -- where its contract is: same place / nationality / spend type
    CROSS JOIN LATERAL (SELECT CASE WHEN t.source_type = 'payroll_wht' THEN 'payroll'
                                    ELSE t.source_type END AS st) sx
    LEFT JOIN place pl ON pl.st = sx.st AND pl.id = t.source_id
    LEFT JOIN code_section cs ON cs.code = t.budget_code
    WHERE t.project_id = p_project_id
      AND t.entry_kind = 'actual'   -- 201: an invoice is 'actual' only once approved
      AND (p_from IS NULL OR t.entry_date >= p_from)
      AND (p_to   IS NULL OR t.entry_date <= p_to)
  ),
  agg AS (
    SELECT l.country, l.city, l.category, l.spend_type, l.local_intl,
           sum(l.amount) AS amount, count(*)::int AS n
    FROM led l GROUP BY 1, 2, 3, 4, 5
  ),
  tot AS (SELECT NULLIF(sum(a.amount), 0) AS total FROM agg a),
  days AS (
    SELECT lower(btrim(lo.city)) AS city_key, sum(COALESCE(lo.shoot_days, 0))::int AS shoot_days
    FROM public.locations lo
    WHERE lo.project_id = p_project_id AND btrim(COALESCE(lo.city, '')) <> ''
    GROUP BY 1
  )
  SELECT a.country, a.city, a.category, a.spend_type, a.local_intl,
         round(a.amount, 2),
         round(a.amount / tot.total * 100, 2),
         d.shoot_days,
         a.n
  FROM agg a
  CROSS JOIN tot
  LEFT JOIN days d ON d.city_key = lower(a.city)
  ORDER BY (a.country = 'Unspecified'), a.country, (a.city = 'Unspecified'), a.city, a.category, a.spend_type, a.local_intl;
END;
$$;
REVOKE ALL ON FUNCTION public.get_gsr(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gsr(uuid, date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. get_gsr_payments — copy of 198; changes marked 203
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_gsr_payments(uuid, date, date);   -- 203: new column invoice_not_approved
CREATE FUNCTION public.get_gsr_payments(p_project_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
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
  method          text,
  invoice_not_approved boolean   -- 203: a payment on an invoice that is not approved (shown, flagged)
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
         pm.method,
         (inv.id IS NOT NULL AND inv.approval_status IS DISTINCT FROM 'approved')   -- 203
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
-- 4. get_payments_register — copy of 196; changes marked 203
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_payments_register(uuid, date, date);   -- 203: new column invoice_not_approved
CREATE FUNCTION public.get_payments_register(p_project_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (event_key text, event_type text, payment_date date, payment_ref text, payee text,
               document_type text, document_id uuid, document_ref text, instalment text, budget_code text,
               method text, paid_from_code text, paid_from_name text, gross numeric, wht numeric, net numeric,
               invoice_not_approved boolean)   -- 203
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM public.ledger_assert_member(p_project_id, 'get_payments_register');
  RETURN QUERY
  WITH l AS (
    SELECT x.*, g.code AS gl_code, g.name AS gl_name, g.account_type
      FROM public.ledger_project_lines(p_project_id) x
      JOIN public.gl_accounts g ON g.id = x.gl_account_id
     WHERE x.event_type IN ('payment', 'petty_issue', 'wht_remittance', 'vat_payment', 'bank_charge',
                            'petty_receipt', 'per_diem')),
  -- the cash account each event pays from (credited by its original lines)
  src AS (
    SELECT DISTINCT ON (l.event_key) l.event_key, l.gl_account_id AS from_gl, l.gl_code, l.gl_name
      FROM l
     WHERE l.account_type IN ('bank', 'cash', 'petty_cash') AND l.credit > 0 AND NOT l.is_reversal
     ORDER BY l.event_key, l.entry_seq),
  ev AS (
    SELECT l.event_key, min(l.event_type) AS et,
           COALESCE(min(l.entry_date) FILTER (WHERE NOT l.is_reversal), min(l.entry_date)) AS d,
           (array_agg(l.party ORDER BY l.is_reversal, l.entry_seq DESC, l.line_no))[1] AS party,
           (array_agg(l.budget_code ORDER BY l.is_reversal, l.entry_seq DESC, l.line_no))[1] AS code,
           s.gl_code, s.gl_name,
           sum(l.credit - l.debit) FILTER (WHERE l.gl_account_id = s.from_gl) AS net
      FROM l JOIN src s ON s.event_key = l.event_key
     GROUP BY l.event_key, s.gl_code, s.gl_name),
  d AS (
    SELECT ev.*, split_part(ev.event_key, ':', 1) AS prefix,
           NULLIF(split_part(ev.event_key, ':', 2), '')::uuid AS src_id
      FROM ev
     WHERE ev.net <> 0
       AND (p_from IS NULL OR ev.d >= p_from) AND (p_to IS NULL OR ev.d <= p_to))
  SELECT d.event_key, d.et, d.d,
         COALESCE(pay.ref_no, ca.ref_no, rc.ref_no, pdl.ref_no, NULLIF(tm.reference, '')),
         COALESCE(d.party, inv.vendor_name, pr.name, po.vendor_name, fl.holder),
         CASE d.prefix
           WHEN 'payment' THEN CASE WHEN pay.source_type IN ('purchase_order', 'po') THEN 'purchase_order'
                                    WHEN pay.source_type IN ('petty_cash', 'cash_advance', 'receipt', 'cash_advance_receipt') THEN 'petty_cash'
                                    ELSE pay.source_type END
           WHEN 'treasury' THEN tm.kind
           WHEN 'petty_issue' THEN 'petty_cash'
           WHEN 'petty_receipt' THEN 'petty_receipt'
           ELSE d.prefix END,
         CASE d.prefix WHEN 'payment' THEN pay.source_id WHEN 'treasury' THEN tm.id ELSE d.src_id END,
         COALESCE(inv.ref_no, inv.invoice_no, pr.ref_no, po.ref_no, po.po_number, fl.ref_no, ca.ref_no, rc.ref_no, pdl.ref_no),
         COALESCE(pi.label, CASE WHEN pi.seq IS NOT NULL THEN 'P' || pi.seq END),
         COALESCE(d.code, inv.budget_code, pr.budget_code, po.budget_code, tm.budget_code),
         CASE WHEN pay.id IS NOT NULL THEN pay.method
              WHEN d.prefix IN ('petty_receipt', 'per_diem') THEN 'Petty cash'
              ELSE 'Transfer' END,
         d.gl_code, d.gl_name,
         round(d.net + w.wht, 2), round(w.wht, 2), round(d.net, 2),
         (inv.id IS NOT NULL AND inv.approval_status IS DISTINCT FROM 'approved')   -- 203
    FROM d
    LEFT JOIN public.payments pay ON d.prefix = 'payment' AND pay.id = d.src_id
    LEFT JOIN public.invoices inv ON pay.source_type = 'invoice' AND inv.id = pay.source_id
    LEFT JOIN public.payroll pr ON pay.source_type = 'payroll' AND pr.id = pay.source_id
    LEFT JOIN public.payroll_instalments pi ON pr.id IS NOT NULL AND pi.payroll_id = pr.id AND pi.milestone_id = pay.payroll_milestone_id
    LEFT JOIN public.purchase_orders po ON pay.source_type IN ('purchase_order', 'po') AND po.id = pay.source_id
    LEFT JOIN public.cash_advances fl ON pay.source_type IN ('petty_cash', 'cash_advance') AND fl.id = pay.source_id
    LEFT JOIN public.cash_advances ca ON d.prefix = 'petty_issue' AND ca.id = d.src_id
    LEFT JOIN public.cash_advance_receipts rc ON d.prefix = 'petty_receipt' AND rc.id = d.src_id
    LEFT JOIN public.per_diem_ledger pdl ON d.prefix = 'per_diem' AND pdl.id = d.src_id
    LEFT JOIN public.treasury_movements tm ON d.prefix = 'treasury' AND tm.id = d.src_id
    CROSS JOIN LATERAL (SELECT CASE
        -- instalment: its WHT share of what was paid
        WHEN pi.payroll_id IS NOT NULL AND pi.amount > 0
          THEN (pi.amount_gross - pi.amount) * d.net / pi.amount
        -- invoice: WHT share of the net payable
        WHEN inv.id IS NOT NULL AND COALESCE(inv.wht_amount, 0) > 0
             AND COALESCE(inv.price, 0) + COALESCE(inv.vat_amount, 0) - inv.wht_amount > 0
          THEN inv.wht_amount * d.net / (COALESCE(inv.price, 0) + COALESCE(inv.vat_amount, 0) - inv.wht_amount)
        ELSE 0 END AS wht) w
   ORDER BY d.d, d.event_key;
END $$;
REVOKE ALL ON FUNCTION public.get_payments_register(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payments_register(uuid, date, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_payments_register(uuid, date, date) IS
  'Payments Register (R12): one row per payment out of the bank / cash / petty cash in the ledger (payments, petty cash floats and receipts, per diem from a float, WHT remittances, VAT payments, bank charges) with payee, document and instalment, method, paid-from account, gross / WHT / net. Σ net on 9100 = bank credits of those events in the General Ledger. db/pending/196; since db/pending/203 a payment on an invoice that is not approved (db/pending/201) is listed with invoice_not_approved = true.';
