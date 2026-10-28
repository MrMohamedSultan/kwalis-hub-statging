-- =====================================================================
-- 199 — Polish: SAR conversion of per diem / overtime / petty-cash rows
--       in v_ledger_transactions.
--
-- Why: v_ledger_transactions (196) returned per diem, overtime and
-- approved petty-cash receipt rows in their own currency (per diem is
-- often USD), while every consumer (v_budget_code_position,
-- v_project_position, the cost report, the dashboards) adds `amount` as
-- SAR. A USD 100 per diem therefore counted as SAR 100 instead of
-- SAR 375.
--
-- What changes
--   * v_ledger_transactions: copy of 196; only the per diem, overtime and
--     petty-cash receipt branches change (marked "199"): amount / total go
--     through public.amount_to_sar(amount, currency, project) (180: SAR as
--     is, USD or the project currency at the project's locked rate, 3.75
--     when none) and currency becomes the organisation base currency, like
--     every other row. Columns, names and types are unchanged, so
--     v_budget_code_position / v_project_position need no redefinition.
--   * Nothing is written; no data changes.
--
-- Rollback: re-run section 7 of db/pending/196_reconcile.sql
-- (CREATE OR REPLACE VIEW public.v_ledger_transactions ...).
-- =====================================================================

CREATE OR REPLACE VIEW public.v_ledger_transactions WITH (security_invoker = on) AS
 SELECT i.id,
    'invoice'::text AS source_type,
    i.id AS source_id,
    'actual'::text AS entry_kind,
    i.date AS entry_date,
    COALESCE(i.ref_no, i.invoice_no) AS reference,                    -- 196
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
    COALESCE(i.wht_amount, 0::numeric) AS wht_amount,
    i.ref_no AS ref_no,                                                  -- 196
    i.id::text || ':' || 'actual' AS row_key                       -- 196
   FROM public.invoices i
     LEFT JOIN public.organizations org ON org.id = i.organization_id
UNION ALL
 -- 180: payroll = Actual for Approved / Paid instalments only
 SELECT p.id,
    'payroll'::text AS source_type,
    p.id AS source_id,
    'actual'::text AS entry_kind,
    p.created_at::date AS entry_date,
    COALESCE(p.ref_no, CASE                                               -- 196
            WHEN p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN NULL::text
            ELSE p.ref_id
        END) AS reference,
    p.kind AS description,
    p.name AS counterparty,
    p.budget_code,
    p.gl_account_id,
    NULL::text AS department,
    pc.actual AS amount,
    0::numeric AS vat_amount,
    pc.actual AS total,
    org.base_currency AS currency,
    'Approved'::text AS status,
    false AS qfe_eligible,
    p.organization_id,
    p.project_id,
    p.created_at,
    CASE WHEN COALESCE(p.total_amount, 0) > 0
         THEN round(COALESCE(p.wht_amount, 0::numeric) * pc.actual / p.total_amount, 2)
         ELSE 0::numeric END AS wht_amount,
    p.ref_no AS ref_no,                                                  -- 196
    p.id::text || ':' || 'actual' AS row_key                       -- 196
   FROM public.payroll p
     LEFT JOIN public.organizations org ON org.id = p.organization_id
     CROSS JOIN LATERAL (SELECT public.payroll_contract_actual(p.payment_schedule, p.total_amount, p.net_payable,
                                  CASE WHEN jsonb_array_length(COALESCE(p.payment_schedule, '[]'::jsonb)) = 0
                                       THEN public.payroll_legacy_paid(p.id, p.payments, p.percents, p.total_amount)
                                       ELSE 0 END) AS actual) pc
  WHERE COALESCE(p.ref_id, '') NOT LIKE 'invoice:%'
    AND pc.actual <> 0
UNION ALL
 -- 180: payroll = Commitment for the rest of the contract (none once cancelled)
 SELECT p.id,
    'payroll'::text AS source_type,
    p.id AS source_id,
    'commitment'::text AS entry_kind,
    p.created_at::date AS entry_date,
    COALESCE(p.ref_no, CASE                                               -- 196
            WHEN p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN NULL::text
            ELSE p.ref_id
        END) AS reference,
    p.kind AS description,
    p.name AS counterparty,
    p.budget_code,
    p.gl_account_id,
    NULL::text AS department,
    GREATEST(COALESCE(p.total_amount, 0::numeric) - pc.actual, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    GREATEST(COALESCE(p.total_amount, 0::numeric) - pc.actual, 0::numeric) AS total,
    org.base_currency AS currency,
    'Pending'::text AS status,
    false AS qfe_eligible,
    p.organization_id,
    p.project_id,
    p.created_at,
    0::numeric AS wht_amount,
    p.ref_no AS ref_no,                                                  -- 196
    p.id::text || ':' || 'commitment' AS row_key                       -- 196
   FROM public.payroll p
     LEFT JOIN public.organizations org ON org.id = p.organization_id
     CROSS JOIN LATERAL (SELECT public.payroll_contract_actual(p.payment_schedule, p.total_amount, p.net_payable,
                                  CASE WHEN jsonb_array_length(COALESCE(p.payment_schedule, '[]'::jsonb)) = 0
                                       THEN public.payroll_legacy_paid(p.id, p.payments, p.percents, p.total_amount)
                                       ELSE 0 END) AS actual) pc
  WHERE COALESCE(p.ref_id, '') NOT LIKE 'invoice:%'
    AND p.contract_cancelled_at IS NULL
    AND COALESCE(p.total_amount, 0::numeric) - pc.actual > 0
UNION ALL
 SELECT po.id,
    'purchase_order'::text AS source_type,
    po.id AS source_id,
    'commitment'::text AS entry_kind,
    po.date AS entry_date,
    COALESCE(po.ref_no, po.po_number) AS reference,                   -- 196
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
    0::numeric AS wht_amount,
    po.ref_no AS ref_no,                                                  -- 196
    po.id::text || ':' || 'commitment' AS row_key                       -- 196
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
    r.ref_no AS reference,                                              -- 196
    r.description,
    COALESCE(r.vendor, r.recipient) AS counterparty,
    r.budget_code,
    r.gl_account_id,
    r.department,
    public.amount_to_sar(r.amount, COALESCE(r.currency, 'SAR'), r.project_id) AS amount,         -- 199
    0::numeric AS vat_amount,
    public.amount_to_sar(r.amount, COALESCE(r.currency, 'SAR'), r.project_id) AS total,          -- 199
    COALESCE(org.base_currency, 'SAR') AS currency,                                               -- 199
    r.status,
    false AS qfe_eligible,
    r.organization_id,
    r.project_id,
    r.created_at,
    0::numeric AS wht_amount,
    r.ref_no AS ref_no,                                                  -- 196
    r.id::text || ':' || 'actual' AS row_key                       -- 196
   FROM public.cash_advance_receipts r
     LEFT JOIN public.organizations org ON org.id = r.organization_id
  WHERE r.status = 'approved'                                               -- 180
UNION ALL
 SELECT ot.id,
    'overtime'::text AS source_type,
    ot.id AS source_id,
    'actual'::text AS entry_kind,
    ot.work_date AS entry_date,
    ot.ref_no AS reference,                                              -- 196
    NULL::text AS description,
    ot.person_name AS counterparty,
    ot.budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    public.amount_to_sar(ot.amount, COALESCE(ot.currency, 'SAR'), ot.project_id) AS amount,      -- 199
    0::numeric AS vat_amount,
    public.amount_to_sar(ot.amount, COALESCE(ot.currency, 'SAR'), ot.project_id) AS total,       -- 199
    COALESCE(org.base_currency, 'SAR') AS currency,                                               -- 199
    ot.status,
    false AS qfe_eligible,
    ot.organization_id,
    ot.project_id,
    ot.created_at,
    0::numeric AS wht_amount,
    ot.ref_no AS ref_no,                                                  -- 196
    ot.id::text || ':' || 'actual' AS row_key                       -- 196
   FROM public.overtime_entries ot
     LEFT JOIN public.organizations org ON org.id = ot.organization_id
UNION ALL
 SELECT d.id,
    'per_diem'::text AS source_type,
    d.id AS source_id,
    'actual'::text AS entry_kind,
    d.period_start AS entry_date,
    d.ref_no AS reference,                                              -- 196
    'Per diem '::text || d.period_start || ' – '::text || d.period_end AS description,
    pe.full_name AS counterparty,
    d.budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    public.amount_to_sar(d.total_amount, COALESCE(d.currency, 'SAR'), d.project_id) AS amount,   -- 199
    0::numeric AS vat_amount,
    public.amount_to_sar(d.total_amount, COALESCE(d.currency, 'SAR'), d.project_id) AS total,    -- 199
    COALESCE(org.base_currency, 'SAR') AS currency,                                               -- 199
    d.status,
    false AS qfe_eligible,
    d.organization_id,
    d.project_id,
    d.created_at,
    0::numeric AS wht_amount,
    d.ref_no AS ref_no,                                                  -- 196
    d.id::text || ':' || 'actual' AS row_key                       -- 196
   FROM public.per_diem_ledger d
     LEFT JOIN public.people pe ON pe.id = d.person_id
     LEFT JOIN public.organizations org ON org.id = d.organization_id
UNION ALL
 SELECT pay.id,
    'payment'::text AS source_type,
    pay.source_id,
    'payment'::text AS entry_kind,
    pay.payment_date AS entry_date,
    pay.ref_no AS reference,                                              -- 196
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
    0::numeric AS wht_amount,
    pay.ref_no AS ref_no,                                                  -- 196
    pay.id::text || ':' || 'payment' AS row_key                       -- 196
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
    0::numeric AS wht_amount,
    NULL::text AS ref_no,                                                  -- 196
    cr.id::text || ':' || 'commitment' AS row_key                       -- 196
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
    0::numeric AS wht_amount,
    NULL::text AS ref_no,                                                  -- 196
    ac.id::text || ':' || 'commitment' AS row_key                       -- 196
   FROM public.accommodations ac
     LEFT JOIN public.projects pr ON pr.id = ac.project_id
     LEFT JOIN public.organizations org ON org.id = COALESCE(ac.organization_id, pr.organization_id)
     LEFT JOIN public.people pe ON pe.id = ac.person_id
     LEFT JOIN public.budget_lines bl ON bl.id = ac.linked_budget_line_id
     LEFT JOIN public.invoices ai ON ai.id = ac.invoice_id
  WHERE COALESCE(ac.total_amount, 0) > 0;
COMMENT ON VIEW public.v_ledger_transactions IS
  'One row per cost document and kind. actual = invoices, approved / paid contract instalments (scaled to the gross contract value), approved petty-cash receipts, overtime, per diem; commitment = the rest of each contract (none once cancelled), purchase orders (net of invoices raised on them, commitment states only), car rentals and accommodation (net of their linked invoice); payment = payments ledger. A payroll row can appear twice (actual + commitment) with the same id: key rows by row_key (id:entry_kind). reference = the Kwalis ref_no when the document has one. Amounts in SAR. Per diem, overtime and petty-cash receipts in USD / the project currency are converted with amount_to_sar (project rate). Redefined by db/pending/199.';
