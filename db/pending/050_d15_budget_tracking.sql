-- =====================================================================
-- D15 — Budget Tracking data layer
--   view  public.v_ledger_line_links                 (cost row -> budget line)
--   RPC   public.get_budget_tracking(project)
--   RPC   public.get_line_transactions(budget_line)
--   RPC   public.get_code_transactions(project, code, unassigned_only)   [extra]
--
-- Depends on 040_d12 (invoices / payroll . linked_budget_line_id).
-- ADDITIVE: one view and three functions. Nothing existing is changed.
--
-- Doctrine: the budget is built per LINE, spend is decided per CODE. A cost
-- row is shown under a line only when it carries an explicit link to that
-- line. Everything else is reported once per code on a row with
-- line_id = NULL ("not assigned to a line"). Nothing is spread or estimated,
-- so the lines + the unassigned row of a code always add up to the code's
-- figures in get_cost_report.
--
-- Amounts are in the record currency (SAR).
--
-- Rollback:
--   DROP FUNCTION public.get_code_transactions(uuid, text, boolean);
--   DROP FUNCTION public.get_line_transactions(uuid);
--   DROP FUNCTION public.get_budget_tracking(uuid);
--   DROP VIEW     public.v_ledger_line_links;
-- =====================================================================

-- source row -> the budget line it is explicitly linked to (may be NULL)
CREATE VIEW public.v_ledger_line_links
WITH (security_invoker = on) AS
  SELECT 'invoice'::text AS source_type, i.id AS source_id, i.project_id, i.linked_budget_line_id
  FROM public.invoices i
  UNION ALL
  SELECT 'payroll', p.id, p.project_id, p.linked_budget_line_id FROM public.payroll p
  UNION ALL
  SELECT 'purchase_order', po.id, po.project_id, po.linked_budget_line_id FROM public.purchase_orders po
  UNION ALL
  SELECT 'petty_cash', r.id, r.project_id, r.linked_budget_line_id FROM public.cash_advance_receipts r
  UNION ALL
  SELECT 'per_diem', d.id, d.project_id, d.linked_budget_line_id FROM public.per_diem_ledger d
  UNION ALL
  SELECT 'overtime', ot.id, ot.project_id, NULL::uuid FROM public.overtime_entries ot;

REVOKE ALL ON public.v_ledger_line_links FROM anon;
GRANT SELECT ON public.v_ledger_line_links TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- get_budget_tracking
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_budget_tracking(p_project_id uuid)
RETURNS TABLE (
  line_id        uuid,
  budget_code    text,
  description    text,
  name           text,
  budget         numeric,
  actual         numeric,
  committed      numeric,
  paid           numeric,
  remaining      numeric,
  topsheet_code  text,
  topsheet_name  text,
  "group"        text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_fx  numeric;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'get_budget_tracking: p_project_id is required' USING ERRCODE = '22004';
  END IF;
  SELECT p.organization_id, p.fx_rate INTO v_org, v_fx FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_budget_tracking: access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH lines AS (
    SELECT bl.id, bl.main_code AS code, bl.description, bl.name, bl.topsheet_code, bl.created_at,
           public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap,
                                        bl.unit, bl.currency, bl.excluded, v_fx) AS budget
    FROM public.v_active_budget_lines bl
    WHERE bl.project_id = p_project_id
  ),
  -- every actual / commitment row, with its line when the link points at an
  -- ACTIVE line of the same code; otherwise the row stays on its code only.
  led AS (
    SELECT t.budget_code AS code,
           ln.id         AS line_id,
           t.entry_kind,
           t.amount
    FROM public.v_ledger_transactions t
    LEFT JOIN public.v_ledger_line_links k
           ON k.source_type = t.source_type AND k.source_id = t.source_id
    LEFT JOIN lines ln
           ON ln.id = k.linked_budget_line_id
          AND ln.code IS NOT DISTINCT FROM t.budget_code
    WHERE t.project_id = p_project_id
      AND t.entry_kind IN ('actual', 'commitment')
  ),
  pay AS (
    SELECT src.code, ln.id AS line_id, pm.amount
    FROM public.payments pm
    LEFT JOIN LATERAL (
      SELECT CASE WHEN pm.source_type IN ('purchase_order', 'po') THEN 'purchase_order'
                  WHEN pm.source_type IN ('petty_cash', 'cash_advance', 'cash_advance_receipt', 'receipt')
                    THEN 'petty_cash'
                  ELSE pm.source_type END AS st
    ) n ON true
    LEFT JOIN LATERAL (
      SELECT t.budget_code AS code
      FROM public.v_ledger_transactions t
      WHERE t.project_id = p_project_id
        AND t.source_type = n.st AND t.source_id = pm.source_id
        AND t.entry_kind IN ('actual', 'commitment')
      LIMIT 1
    ) src ON true
    LEFT JOIN public.v_ledger_line_links k
           ON k.source_type = n.st AND k.source_id = pm.source_id
    LEFT JOIN lines ln
           ON ln.id = k.linked_budget_line_id AND ln.code IS NOT DISTINCT FROM src.code
    WHERE pm.project_id = p_project_id
  ),
  moves AS (
    SELECT led.code, led.line_id,
           CASE WHEN led.entry_kind = 'actual'     THEN led.amount ELSE 0 END AS actual,
           CASE WHEN led.entry_kind = 'commitment' THEN led.amount ELSE 0 END AS committed,
           0::numeric AS paid
    FROM led
    UNION ALL
    SELECT pay.code, pay.line_id, 0, 0, pay.amount FROM pay
  ),
  by_line AS (
    SELECT m.line_id, sum(m.actual) AS actual, sum(m.committed) AS committed, sum(m.paid) AS paid
    FROM moves m WHERE m.line_id IS NOT NULL GROUP BY m.line_id
  ),
  by_code_unassigned AS (
    SELECT m.code, sum(m.actual) AS actual, sum(m.committed) AS committed, sum(m.paid) AS paid
    FROM moves m WHERE m.line_id IS NULL GROUP BY m.code
    HAVING sum(m.actual) <> 0 OR sum(m.committed) <> 0 OR sum(m.paid) <> 0
  ),
  code_meta AS (
    SELECT l.code,
           mode() WITHIN GROUP (ORDER BY l.topsheet_code) AS topsheet_code
    FROM lines l GROUP BY l.code
  ),
  master AS (
    SELECT DISTINCT ON (mb.budget_code) mb.budget_code AS code, mb.description, mb.topsheet_code
    FROM public.master_budget mb
    ORDER BY mb.budget_code, mb.is_header NULLS LAST
  ),
  rows AS (
    SELECT l.id AS line_id, l.code, l.description, l.name,
           l.budget,
           COALESCE(b.actual, 0)    AS actual,
           COALESCE(b.committed, 0) AS committed,
           COALESCE(b.paid, 0)      AS paid,
           COALESCE(l.topsheet_code, cm.topsheet_code) AS ts_code,
           0 AS ord, l.created_at
    FROM lines l
    LEFT JOIN by_line b    ON b.line_id = l.id
    LEFT JOIN code_meta cm ON cm.code = l.code
    UNION ALL
    SELECT NULL::uuid, u.code, NULL::text, NULL::text,
           0::numeric, u.actual, u.committed, u.paid,
           COALESCE(cm.topsheet_code, m.topsheet_code),
           1, NULL::timestamptz
    FROM by_code_unassigned u
    LEFT JOIN code_meta cm ON cm.code IS NOT DISTINCT FROM u.code
    LEFT JOIN master m     ON m.code = u.code
  )
  SELECT r.line_id,
         r.code                                             AS budget_code,
         COALESCE(r.description, m.description)             AS description,
         r.name,
         round(r.budget, 2)                                 AS budget,
         round(r.actual, 2)                                 AS actual,
         round(r.committed, 2)                              AS committed,
         round(r.paid, 2)                                   AS paid,
         round(r.budget - r.actual - r.committed, 2)        AS remaining,
         ts.code                                            AS topsheet_code,
         ts.name                                            AS topsheet_name,
         COALESCE(ts.section, 'Other')                      AS "group"
  FROM rows r
  LEFT JOIN master m ON m.code = r.code
  LEFT JOIN public.budget_topsheet_accounts ts ON ts.code = r.ts_code
  ORDER BY ts.display_order NULLS LAST, r.code NULLS LAST, r.ord, r.created_at, r.line_id;
END;
$$;

-- ---------------------------------------------------------------------
-- shared row shape for the two transaction lists
-- ---------------------------------------------------------------------
-- source: Payroll / Invoice / PO / Petty Cash / Overtime / Per Diem
-- is_paid: payments recorded against the row cover its amount
CREATE OR REPLACE FUNCTION public.get_line_transactions(p_budget_line_id uuid)
RETURNS TABLE (
  date        date,
  source      text,
  payee       text,
  reference   text,
  amount      numeric,
  is_paid     boolean,
  paid_amount numeric,
  entry_kind  text,
  source_type text,
  source_id   uuid
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org uuid; v_project uuid; v_code text;
BEGIN
  SELECT bl.project_id, bl.main_code INTO v_project, v_code
  FROM public.budget_lines bl WHERE bl.id = p_budget_line_id;
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = v_project;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, v_project) THEN
    RAISE EXCEPTION 'get_line_transactions: access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT t.entry_date,
         CASE t.source_type WHEN 'invoice' THEN 'Invoice' WHEN 'payroll' THEN 'Payroll'
              WHEN 'purchase_order' THEN 'PO' WHEN 'petty_cash' THEN 'Petty Cash'
              WHEN 'overtime' THEN 'Overtime' WHEN 'per_diem' THEN 'Per Diem'
              ELSE initcap(t.source_type) END,
         t.counterparty,
         t.reference,
         round(t.amount, 2),
         (COALESCE(pd.paid, 0) >= t.amount - 0.005 AND t.amount > 0),
         round(COALESCE(pd.paid, 0), 2),
         t.entry_kind,
         t.source_type,
         t.source_id
  FROM public.v_ledger_transactions t
  JOIN public.v_ledger_line_links k
    ON k.source_type = t.source_type AND k.source_id = t.source_id
  LEFT JOIN LATERAL (
    SELECT sum(pm.amount) AS paid
    FROM public.payments pm
    WHERE pm.project_id = v_project AND pm.source_id = t.source_id
      AND (CASE WHEN pm.source_type IN ('purchase_order', 'po') THEN 'purchase_order'
                WHEN pm.source_type IN ('petty_cash', 'cash_advance', 'cash_advance_receipt', 'receipt')
                  THEN 'petty_cash' ELSE pm.source_type END) = t.source_type
  ) pd ON true
  WHERE t.project_id = v_project
    AND t.entry_kind IN ('actual', 'commitment')
    AND k.linked_budget_line_id = p_budget_line_id
    AND t.budget_code IS NOT DISTINCT FROM v_code
  ORDER BY t.entry_date DESC NULLS LAST, t.source_type, t.source_id;
END;
$$;

-- Transactions of a budget code. With p_unassigned_only (default) it lists
-- exactly what get_budget_tracking reports on the code's line_id = NULL row.
CREATE OR REPLACE FUNCTION public.get_code_transactions(
  p_project_id      uuid,
  p_budget_code     text,
  p_unassigned_only boolean DEFAULT true
)
RETURNS TABLE (
  date        date,
  source      text,
  payee       text,
  reference   text,
  amount      numeric,
  is_paid     boolean,
  paid_amount numeric,
  entry_kind  text,
  source_type text,
  source_id   uuid,
  line_id     uuid
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_code_transactions: access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT t.entry_date,
         CASE t.source_type WHEN 'invoice' THEN 'Invoice' WHEN 'payroll' THEN 'Payroll'
              WHEN 'purchase_order' THEN 'PO' WHEN 'petty_cash' THEN 'Petty Cash'
              WHEN 'overtime' THEN 'Overtime' WHEN 'per_diem' THEN 'Per Diem'
              ELSE initcap(t.source_type) END,
         t.counterparty,
         t.reference,
         round(t.amount, 2),
         (COALESCE(pd.paid, 0) >= t.amount - 0.005 AND t.amount > 0),
         round(COALESCE(pd.paid, 0), 2),
         t.entry_kind,
         t.source_type,
         t.source_id,
         ln.id
  FROM public.v_ledger_transactions t
  LEFT JOIN public.v_ledger_line_links k
         ON k.source_type = t.source_type AND k.source_id = t.source_id
  LEFT JOIN public.v_active_budget_lines ln
         ON ln.id = k.linked_budget_line_id AND ln.project_id = p_project_id
        AND ln.main_code IS NOT DISTINCT FROM t.budget_code
  LEFT JOIN LATERAL (
    SELECT sum(pm.amount) AS paid
    FROM public.payments pm
    WHERE pm.project_id = p_project_id AND pm.source_id = t.source_id
      AND (CASE WHEN pm.source_type IN ('purchase_order', 'po') THEN 'purchase_order'
                WHEN pm.source_type IN ('petty_cash', 'cash_advance', 'cash_advance_receipt', 'receipt')
                  THEN 'petty_cash' ELSE pm.source_type END) = t.source_type
  ) pd ON true
  WHERE t.project_id = p_project_id
    AND t.entry_kind IN ('actual', 'commitment')
    AND t.budget_code IS NOT DISTINCT FROM p_budget_code
    AND (NOT p_unassigned_only OR ln.id IS NULL)
  ORDER BY t.entry_date DESC NULLS LAST, t.source_type, t.source_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_budget_tracking(uuid)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_line_transactions(uuid)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_code_transactions(uuid, text, boolean)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_budget_tracking(uuid)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_line_transactions(uuid)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_code_transactions(uuid, text, boolean) TO authenticated, service_role;
