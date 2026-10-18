-- =====================================================================
-- D19 — one Saudi Film Commission rebate (QFE) source for the whole platform
--   fn    public.qfe_qpe_type(text, kind, payroll_kind)     QPE category label
--   RPC   public.get_qfe_ledger(project, from, to)          transaction-level trail
--   RPC   public.get_sfc_rebate(project, from, to)          summary + ledger + estimated vs actual
--
-- Today three report tabs compute three different numbers in the browser
-- (63,800 / 0 / 0 on the live project). The eligibility rules below are a
-- line-for-line port of the ones the "Saudi Film Commission Rebate" tab
-- already uses (src/lib/qfe-rules.ts + src/lib/qfeLedger.ts) — the tab the
-- audit sheet names as the reference — so the single number is that one:
--
--   Invoice    manual override            -> the accountant's rebate_eligible flag
--              Rule C  service outside KSA -> not eligible
--              Rule A  logistics/accommodation with a named beneficiary
--                                          -> follows the beneficiary's nationality
--              Rule B  vendor flagged non-Saudi -> not eligible
--                      vendor nationality known -> eligible if Saudi
--                      otherwise                -> eligible
--   Payroll    eligible unless the person is non-Saudi or the row is tagged
--              international / travel / foreign ...
--   Petty cash eligible unless tagged international / travel / foreign ...
--
-- Base amount is always EXCLUDING VAT. Amounts in SAR.
--
-- Two things the browser version did that are deliberately NOT ported:
--   * "paid" is read from the payments ledger only. The old tab also assumed
--     invoices.payment_term % as paid when no payment existed.
--   * payroll -> person is still matched by name, because payroll rows carry
--     no person key. It is the one remaining name match and is reported per
--     row in person_matched, so unmatched rows are visible instead of silent.
--
-- ADDITIVE: three functions. Rollback:
--   DROP FUNCTION public.get_sfc_rebate(uuid, date, date, numeric);
--   DROP FUNCTION public.get_qfe_ledger(uuid, date, date);
--   DROP FUNCTION public.qfe_qpe_type(text, text, text);
-- =====================================================================

CREATE OR REPLACE FUNCTION public.qfe_qpe_type(p_text text, p_kind text, p_payroll_kind text DEFAULT NULL)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN p_kind = 'Payroll' THEN
      CASE WHEN p_payroll_kind = 'cast' THEN 'Cast Fees (Local)' ELSE 'Crew Wages (Local)' END
    WHEN t ~ $r$camera|lens|arri|red\s|sony\s|dop\y|dp\y$r$ THEN 'Camera Equipment Rental'
    WHEN t ~ $r$light|grip|gaffer|hmi|kino|dimmer$r$ THEN 'Lighting & Grip Rental'
    WHEN t ~ $r$set|art\s*dep|construction|carpent|paint|scenic|props?$r$ THEN 'Set Construction & Art Department'
    WHEN t ~ $r$wardrobe|costume|tailor|makeup|hair|sfx\s*makeup$r$ THEN 'Wardrobe, Hair & Makeup'
    WHEN t ~ $r$transport|vehicle|car\s*rent|driver|fuel|logistics$r$ THEN 'Transportation & Vehicles'
    WHEN t ~ $r$location|permit|scout|fee\y$r$ THEN 'Location Fees & Permits'
    WHEN t ~ $r$hotel|accommod|lodging|villa|apartment$r$ THEN 'Accommodation (KSA)'
    WHEN t ~ $r$cater|craft|meal|food|coffee$r$ THEN 'Catering & Craft Services'
    WHEN t ~ $r$edit|colou?r|grade|vfx|visual\s*effect|post[-\s]?prod|di\y|sound\s*mix|foley|adr$r$ THEN 'Post-Production Services'
    WHEN t ~ $r$music|composer|score|licen[cs]e$r$ THEN 'Music & Sound Licensing'
    WHEN t ~ $r$insur|legal|law|counsel|clearance$r$ THEN 'Insurance & Legal'
    WHEN t ~ $r$production\s*service|line\s*producer|prod\s*co|fixer$r$ THEN 'Local Production Services'
    WHEN t ~ $r$office|stationery|supplies|misc$r$ THEN 'Office & Production Supplies'
    ELSE 'Other Qualifying Services'
  END
  FROM (SELECT lower(coalesce(p_text, '')) AS t) x
$fn$;

-- ---------------------------------------------------------------------
-- get_qfe_ledger — one row per invoice / payroll row / petty cash receipt
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_qfe_ledger(
  p_project_id uuid,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
RETURNS TABLE (
  source            text,      -- Invoice | Payroll | Petty Cash
  source_id         uuid,
  reference         text,      -- human document number, never a UUID
  party             text,
  official_id       text,      -- CR / VAT / national ID; masked to last 4 without Edit on reports
  category          text,
  qpe_type          text,
  entry_date        date,
  nationality       text,
  local_intl        text,      -- Local (KSA) | Foreign
  amount_excl_vat   numeric,
  vat_amount        numeric,
  amount            numeric,
  qfe               boolean,
  qfe_rule          text,      -- Rule A | Rule B | Rule C | Manual Override
  qfe_reason        text,
  has_supporting_doc boolean,
  paid_total        numeric,
  balance           numeric,
  payment_status    text,      -- Paid | Partially Paid | Unpaid
  budget_code       text,
  person_matched    boolean    -- payroll only: a people row with this name was found
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
  v_unmask boolean;
  c_logistics constant text := $r$hotel|accommod|lodging|travel|per\s*diem|flight|airfare|air\s*ticket|transport|vehicle|car\s*rent|driver|shuttle|logist$r$;
  c_non_qfe   constant text := $r$international|travel|import|foreign|abroad|non-?qpe|non-?qfe$r$;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'get_qfe_ledger: p_project_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'get_qfe_ledger: p_from is after p_to' USING ERRCODE = '22023';
  END IF;
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_qfe_ledger: access denied' USING ERRCODE = '42501';
  END IF;
  v_unmask := public.can_edit('reports');

  RETURN QUERY
  WITH paid AS (
    SELECT CASE WHEN pm.source_type IN ('petty_cash', 'cash_advance', 'cash_advance_receipt', 'receipt')
                  THEN 'petty_cash' ELSE pm.source_type END AS st,
           pm.source_id, sum(pm.amount) AS paid
    FROM public.payments pm
    WHERE pm.project_id = p_project_id
    GROUP BY 1, 2
  ),
  inv AS (
    SELECT i.*,
           v.company_nationality AS v_nat, v.cr_no, v.vat_no,
           b.nationality AS b_nat,
           (COALESCE(i.service_inside_ksa, true)) AS inside_ksa,
           (concat_ws(' ', i.description, i.department, i.budget_code) ~* c_logistics) AS is_logistics
    FROM public.invoices i
    LEFT JOIN LATERAL (
      SELECT vv.company_nationality, vv.cr_no, vv.vat_no
      FROM public.vendors vv
      WHERE vv.organization_id = i.organization_id
        AND lower(vv.name) = lower(i.vendor_name)
      ORDER BY (vv.project_id = i.project_id) DESC NULLS LAST, vv.created_at
      LIMIT 1
    ) v ON true
    LEFT JOIN public.people b ON b.id = i.beneficiary_id
    WHERE i.project_id = p_project_id
      AND (p_from IS NULL OR i.date >= p_from)
      AND (p_to   IS NULL OR i.date <= p_to)
  ),
  inv_rule AS (
    SELECT inv.*,
      CASE
        WHEN NOT inv.inside_ksa THEN 'C'
        WHEN inv.is_logistics AND COALESCE(inv.b_nat, '') <> '' THEN 'A'
        ELSE 'B'
      END AS auto_rule,
      CASE
        WHEN NOT inv.inside_ksa THEN false
        WHEN inv.is_logistics AND COALESCE(inv.b_nat, '') <> ''
          THEN lower(btrim(inv.b_nat)) IN ('saudi', 'saudi arabia', 'ksa')
        WHEN COALESCE(inv.is_non_saudi_vendor, false) THEN false
        WHEN btrim(COALESCE(inv.v_nat, '')) <> ''
          THEN lower(btrim(inv.v_nat)) IN ('saudi', 'saudi arabia', 'ksa')
        ELSE true
      END AS auto_qfe
    FROM inv
  ),
  rows AS (
    -- invoices
    SELECT 'Invoice'::text AS source, r.id AS source_id,
           NULLIF(btrim(r.invoice_no), '') AS reference,
           COALESCE(r.vendor_name, r.description, '—') AS party,
           NULLIF(concat_ws(' · ', NULLIF(r.cr_no, ''), NULLIF(r.vat_no, '')), '') AS official_id,
           COALESCE(NULLIF(r.department, ''), r.budget_code,
                    public.qfe_qpe_type(concat_ws(' ', r.description, r.department, r.vendor_name), 'Invoice')) AS category,
           public.qfe_qpe_type(concat_ws(' ', r.description, r.department, r.vendor_name), 'Invoice') AS qpe_type,
           r.date AS entry_date,
           q.qfe,
           COALESCE(NULLIF(btrim(r.v_nat), ''),
                    CASE WHEN q.qfe THEN 'Saudi Arabia' ELSE 'Foreign / Non-KSA' END) AS nationality,
           CASE WHEN btrim(COALESCE(r.v_nat, '')) <> ''
                  THEN (lower(btrim(r.v_nat)) NOT IN ('saudi arabia', 'saudi'))
                ELSE (concat_ws(' ', r.description, r.department, r.vendor_name) ~* c_non_qfe)
           END AS is_foreign,
           COALESCE(r.price, 0) AS excl,
           -- stored VAT when there is one; a vatable invoice saved with 0 VAT
           -- falls back to 15%, which is what the old tab always assumed
           CASE WHEN COALESCE(r.vat_amount, 0) > 0 THEN r.vat_amount
                WHEN r.vatable THEN round(COALESCE(r.price, 0) * 0.15, 2)
                ELSE 0 END AS vat,
           CASE WHEN COALESCE(r.rebate_manual_override, false) THEN 'Manual Override'
                ELSE 'Rule ' || r.auto_rule END AS qfe_rule,
           CASE WHEN COALESCE(r.rebate_manual_override, false)
                  THEN 'Manual override — accountant set QFE = '
                       || CASE WHEN q.qfe THEN 'Yes' ELSE 'No' END
                       || ' (the rules would have said ' || CASE WHEN r.auto_qfe THEN 'Yes' ELSE 'No' END || ')'
                WHEN r.auto_rule = 'C' THEN 'Rule C — service rendered outside KSA is never eligible'
                WHEN r.auto_rule = 'A' THEN 'Rule A — logistics/accommodation follows beneficiary nationality (' || r.b_nat || ')'
                WHEN COALESCE(r.is_non_saudi_vendor, false) THEN 'Rule B — vendor is marked non-Saudi'
                WHEN btrim(COALESCE(r.v_nat, '')) <> '' THEN 'Rule B — follows vendor nationality (' || btrim(r.v_nat) || ')'
                ELSE 'Rule B — vendor nationality unknown; treated as a KSA vendor'
           END AS qfe_reason,
           (COALESCE(r.invoice_url, r.attachment_url, r.receipt_url) IS NOT NULL) AS has_doc,
           'invoice'::text AS pay_key,
           r.budget_code,
           NULL::boolean AS person_matched
    FROM inv_rule r
    CROSS JOIN LATERAL (
      SELECT CASE WHEN COALESCE(r.rebate_manual_override, false)
                    THEN COALESCE(r.rebate_eligible, false) ELSE r.auto_qfe END AS qfe
    ) q

    UNION ALL
    -- payroll
    SELECT 'Payroll', p.id,
           CASE WHEN p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN NULL ELSE NULLIF(btrim(p.ref_id), '') END,
           p.name,
           NULLIF(pe.id_number, ''),
           CASE p.kind WHEN 'cast' THEN 'Cast Payroll' WHEN 'vendor' THEN 'Vendor Payroll' ELSE 'Crew Payroll' END,
           public.qfe_qpe_type(p.name, 'Payroll', p.kind),
           p.created_at::date,
           (NOT fx.is_foreign AND NOT (concat_ws(' ', p.name, p.kind) ~* c_non_qfe)),
           COALESCE(NULLIF(btrim(pe.nationality), ''),
                    CASE WHEN fx.is_foreign THEN 'Foreign' ELSE 'Saudi Arabia' END),
           fx.is_foreign,
           COALESCE(p.total_amount, 0),
           0::numeric,
           'Rule A',
           'Rule A — payroll follows the person''s nationality ('
             || COALESCE(NULLIF(btrim(pe.nationality), ''), 'not recorded — treated as KSA') || ')',
           NULL::boolean,
           'payroll',
           p.budget_code,
           (pe.id IS NOT NULL)
    FROM public.payroll p
    LEFT JOIN LATERAL (
      SELECT pp.id, pp.nationality, pp.id_number
      FROM public.people pp
      WHERE pp.project_id = p.project_id AND pp.full_name = p.name
      ORDER BY pp.created_at
      LIMIT 1
    ) pe ON true
    CROSS JOIN LATERAL (
      SELECT (btrim(COALESCE(pe.nationality, '')) <> ''
              AND lower(pe.nationality) NOT IN ('saudi arabia', 'saudi')) AS is_foreign
    ) fx
    WHERE p.project_id = p_project_id
      AND (p_from IS NULL OR p.created_at::date >= p_from)
      AND (p_to   IS NULL OR p.created_at::date <= p_to)

    UNION ALL
    -- petty cash receipts
    SELECT 'Petty Cash', rc.id,
           NULL::text,
           COALESCE(rc.recipient, '—'),
           NULL::text,
           COALESCE(NULLIF(rc.department, ''), rc.budget_code, 'Petty Cash'),
           public.qfe_qpe_type(concat_ws(' ', rc.recipient, rc.department), 'Petty Cash'),
           rc.date,
           NOT (concat_ws(' ', rc.recipient, rc.department) ~* c_non_qfe),
           'Saudi Arabia',
           false,
           COALESCE(rc.amount, 0),
           0::numeric,
           'Rule B',
           CASE WHEN concat_ws(' ', rc.recipient, rc.department) ~* c_non_qfe
                  THEN 'Rule B — petty cash tagged travel / foreign; not eligible'
                ELSE 'Rule B — petty cash receipt for local (KSA) spend' END,
           (rc.attachment_path IS NOT NULL),
           'petty_cash',
           rc.budget_code,
           NULL::boolean
    FROM public.cash_advance_receipts rc
    WHERE rc.project_id = p_project_id
      AND (p_from IS NULL OR rc.date >= p_from)
      AND (p_to   IS NULL OR rc.date <= p_to)
  )
  SELECT r.source, r.source_id, r.reference, r.party,
         CASE WHEN r.official_id IS NULL THEN NULL
              WHEN v_unmask THEN r.official_id
              ELSE '••••' || right(regexp_replace(r.official_id, '\s', '', 'g'), 4) END,
         r.category, r.qpe_type, r.entry_date, r.nationality,
         CASE WHEN r.is_foreign THEN 'Foreign' ELSE 'Local (KSA)' END,
         round(r.excl, 2), round(r.vat, 2), round(r.excl + r.vat, 2),
         r.qfe, r.qfe_rule, r.qfe_reason, r.has_doc,
         round(pd.paid, 2),
         round(GREATEST(r.excl + r.vat - pd.paid, 0), 2),
         CASE WHEN r.excl + r.vat > 0 AND r.excl + r.vat - pd.paid < 0.005 THEN 'Paid'
              WHEN pd.paid > 0.005 THEN 'Partially Paid'
              ELSE 'Unpaid' END,
         r.budget_code, r.person_matched
  FROM rows r
  CROSS JOIN LATERAL (
    -- a petty cash receipt is money already spent
    SELECT CASE WHEN r.source = 'Petty Cash' THEN r.excl
                ELSE COALESCE((SELECT p2.paid FROM paid p2
                               WHERE p2.st = r.pay_key AND p2.source_id = r.source_id), 0) END AS paid
  ) pd
  ORDER BY r.entry_date DESC NULLS LAST, r.source, r.source_id;
END;
$fn$;

-- ---------------------------------------------------------------------
-- get_sfc_rebate — everything the SFC Rebate page needs, in one call
-- ---------------------------------------------------------------------
-- {
--   "summary": { total_budget, qfe_total, non_qfe_total, rebate_rate, projected_rebate,
--                eligible_rows, total_rows, unmatched_payroll_rows },
--   "ledger":  [ ...get_qfe_ledger rows... ],
--   "estimated_vs_actual": [ { group, estimated_eligible_budget, actual_eligible_spend, variance } ]
-- }
-- estimated_eligible_budget = approved budget lines flagged rebate_eligible.
-- p_rebate_rate defaults to 0.40 (the 40% the app shows today).
CREATE OR REPLACE FUNCTION public.get_sfc_rebate(
  p_project_id  uuid,
  p_from        date    DEFAULT NULL,
  p_to          date    DEFAULT NULL,
  p_rebate_rate numeric DEFAULT 0.40
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid; v_fx numeric; v_result jsonb;
BEGIN
  IF p_rebate_rate IS NULL OR p_rebate_rate < 0 OR p_rebate_rate > 1 THEN
    RAISE EXCEPTION 'get_sfc_rebate: p_rebate_rate must be between 0 and 1' USING ERRCODE = '22023';
  END IF;
  SELECT p.organization_id, p.fx_rate INTO v_org, v_fx FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_sfc_rebate: access denied' USING ERRCODE = '42501';
  END IF;

  WITH led AS (
    SELECT * FROM public.get_qfe_ledger(p_project_id, p_from, p_to)
  ),
  lines AS (
    SELECT bl.main_code AS code, bl.topsheet_code, COALESCE(bl.rebate_eligible, false) AS eligible,
           public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap,
                                        bl.unit, bl.currency, bl.excluded, v_fx) AS budget
    FROM public.v_active_budget_lines bl
    WHERE bl.project_id = p_project_id
  ),
  code_section AS (
    SELECT l.code, mode() WITHIN GROUP (ORDER BY ts.section) AS section
    FROM lines l JOIN public.budget_topsheet_accounts ts ON ts.code = l.topsheet_code
    GROUP BY l.code
  ),
  est AS (
    SELECT COALESCE(ts.section, 'Other') AS section, sum(l.budget) FILTER (WHERE l.eligible) AS est
    FROM lines l LEFT JOIN public.budget_topsheet_accounts ts ON ts.code = l.topsheet_code
    GROUP BY 1
  ),
  act AS (
    SELECT COALESCE(cs.section, 'Other') AS section, sum(led.amount_excl_vat) FILTER (WHERE led.qfe) AS act
    FROM led LEFT JOIN code_section cs ON cs.code = led.budget_code
    GROUP BY 1
  ),
  eva AS (
    SELECT COALESCE(e.section, a.section) AS section,
           round(COALESCE(e.est, 0), 2) AS est, round(COALESCE(a.act, 0), 2) AS act
    FROM est e FULL JOIN act a ON a.section = e.section
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'total_budget',     round(COALESCE((SELECT sum(budget) FROM lines), 0), 2),
      'qfe_total',        round(COALESCE((SELECT sum(amount_excl_vat) FILTER (WHERE qfe) FROM led), 0), 2),
      'non_qfe_total',    round(COALESCE((SELECT sum(amount_excl_vat) FILTER (WHERE NOT qfe) FROM led), 0), 2),
      'rebate_rate',      p_rebate_rate,
      'projected_rebate', round(COALESCE((SELECT sum(amount_excl_vat) FILTER (WHERE qfe) FROM led), 0) * p_rebate_rate, 2),
      'eligible_rows',    (SELECT count(*) FILTER (WHERE qfe) FROM led),
      'total_rows',       (SELECT count(*) FROM led),
      'unmatched_payroll_rows', (SELECT count(*) FILTER (WHERE person_matched IS FALSE) FROM led),
      'currency',         'SAR'
    ),
    'ledger', COALESCE((SELECT jsonb_agg(to_jsonb(led) ORDER BY led.entry_date DESC NULLS LAST, led.source, led.source_id) FROM led), '[]'::jsonb),
    'estimated_vs_actual', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'group', eva.section,
               'estimated_eligible_budget', eva.est,
               'actual_eligible_spend', eva.act,
               'variance', eva.est - eva.act) ORDER BY eva.section)
      FROM eva WHERE eva.est <> 0 OR eva.act <> 0), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.qfe_qpe_type(text, text, text)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_qfe_ledger(uuid, date, date)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_sfc_rebate(uuid, date, date, numeric)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qfe_qpe_type(text, text, text)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_qfe_ledger(uuid, date, date)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sfc_rebate(uuid, date, date, numeric)   TO authenticated, service_role;
