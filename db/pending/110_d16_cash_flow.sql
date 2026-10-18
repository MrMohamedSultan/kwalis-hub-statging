-- =====================================================================
-- D16 — Cash Flow report data layer
--   table public.project_funding           (money received / expected in)
--   RPC   public.get_cash_flow(project, grain, include_vat, spread, as_of)
--
-- "Funding & Cash Flow" has no database table today — its totals live in the
-- browser store. This adds the missing table and one function that returns
-- the whole report as JSON.
--
-- ADDITIVE: one table, one trigger function, one RPC.
--
-- Open decision Q3 is NOT taken; both of its halves are parameters:
--   p_include_vat  false (default) = ex-VAT, like the budget · true = invoices incl. VAT
--   p_spread       how the part of the budget with no dated commitment is laid out:
--                  'even' (default) = equal instalments from the current period
--                                     to the project's end date
--                  'end'            = all in the project's last period
--                  'none'           = not forecast (lines then do NOT add up to the budget)
--
-- What the report is made of, per budget code (amounts in SAR):
--   actual    payments, by payment_date                         -> kind 'actual'
--   forecast  unpaid contract instalments (payroll.payment_schedule) on their due date
--             unpaid invoice balances and open purchase orders on their own date
--             the rest of the budget, per p_spread                -> kind 'forecast'
--   Anything dated in the past and still unpaid is due now: it is placed in
--   the current period.
--
-- Acceptance rule from the plan: paid_to_date + future periods = budget for
-- every line. That holds whenever dated commitments fit inside the budget.
-- When they exceed it the line is returned with over_budget = true and its
-- periods add up to more than the budget — the overrun is shown, not hidden.
--
-- Known limit (see pending-items 52/53): an invoice raised against a purchase
-- order is not linked to it, so both can be forecast. It disappears once the
-- invoice is paid, and the over_budget flag makes it visible meanwhile.
--
-- Rollback:
--   DROP FUNCTION public.get_cash_flow(uuid, text, boolean, text, date);
--   DROP TABLE    public.project_funding;
--   DROP FUNCTION public.stamp_project_funding();
-- =====================================================================
CREATE TABLE public.project_funding (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id)      ON DELETE CASCADE,
  funding_date    date NOT NULL,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),   -- SAR
  status          text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'received')),
  source          text CHECK (source IS NULL OR length(source) <= 200),
  reference       text CHECK (reference IS NULL OR length(reference) <= 200),
  notes           text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_funding_project_date ON public.project_funding (project_id, funding_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_funding TO authenticated;
GRANT ALL ON public.project_funding TO service_role;
REVOKE ALL ON public.project_funding FROM anon;
ALTER TABLE public.project_funding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can read funding"
  ON public.project_funding FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));
CREATE POLICY "Funding editors can insert funding"
  ON public.project_funding FOR INSERT TO authenticated
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'));
CREATE POLICY "Funding editors can update funding"
  ON public.project_funding FOR UPDATE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'))
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'));
CREATE POLICY "Funding editors can delete funding"
  ON public.project_funding FOR DELETE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'));

CREATE OR REPLACE FUNCTION public.stamp_project_funding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = NEW.project_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_funding: project % not found', NEW.project_id USING ERRCODE = '23503';
  END IF;
  NEW.organization_id := v_org;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid(); NEW.created_at := now();
  ELSE
    NEW.project_id := OLD.project_id; NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_stamp_project_funding
  BEFORE INSERT OR UPDATE ON public.project_funding
  FOR EACH ROW EXECUTE FUNCTION public.stamp_project_funding();
CREATE TRIGGER trg_audit_history_project_funding
  AFTER INSERT OR UPDATE OR DELETE ON public.project_funding
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- ---------------------------------------------------------------------
-- get_cash_flow
-- ---------------------------------------------------------------------
-- Returns:
-- {
--   "meta":   { grain, as_of, current_period, first_period, last_period, include_vat, spread, currency },
--   "lines":  [ { header, sub_account, budget_code, description, budget, paid_to_date, remaining,
--                 over_budget, periods: [ { period_start, amount, kind } ] } ],
--   "totals": [ { period_start, outflow, funding, opening, closing } ]     -- every period, in order
-- }
-- periods of a line list only the periods that carry money.
-- opening of the first period is 0; closing = opening + funding - outflow.
CREATE OR REPLACE FUNCTION public.get_cash_flow(
  p_project_id  uuid,
  p_grain       text    DEFAULT 'week',
  p_include_vat boolean DEFAULT false,
  p_spread      text    DEFAULT 'even',
  p_as_of       date    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid; v_fx numeric; v_start date; v_end date;
  v_today date := COALESCE(p_as_of, current_date);
  v_step interval; v_cur date; v_last date; v_first date; v_result jsonb;
BEGIN
  IF p_grain NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'get_cash_flow: p_grain must be day, week or month' USING ERRCODE = '22023';
  END IF;
  IF p_spread NOT IN ('even', 'end', 'none') THEN
    RAISE EXCEPTION 'get_cash_flow: p_spread must be even, end or none' USING ERRCODE = '22023';
  END IF;
  SELECT p.organization_id, p.fx_rate, p.start_date, p.end_date
    INTO v_org, v_fx, v_start, v_end
  FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_cash_flow: access denied' USING ERRCODE = '42501';
  END IF;

  v_step := ('1 ' || p_grain)::interval;
  v_cur  := date_trunc(p_grain, v_today::timestamp)::date;
  -- last period of the project; never before the current period
  v_last := GREATEST(date_trunc(p_grain, COALESCE(v_end, v_today)::timestamp)::date, v_cur);

  WITH
  budget AS (
    SELECT bl.main_code AS code,
           sum(public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap,
                                            bl.unit, bl.currency, bl.excluded, v_fx)) AS budget,
           mode() WITHIN GROUP (ORDER BY bl.topsheet_code) AS topsheet_code,
           min(bl.description) AS line_description
    FROM public.v_active_budget_lines bl
    WHERE bl.project_id = p_project_id
    GROUP BY bl.main_code
  ),
  -- payments with their budget code and normalised source key
  pay AS (
    SELECT COALESCE(inv.budget_code, po.budget_code, pr.budget_code,
                    r.budget_code, ot.budget_code, pdl.budget_code) AS code,
           CASE WHEN pm.source_type IN ('purchase_order', 'po') THEN 'purchase_order'
                WHEN pm.source_type IN ('petty_cash', 'cash_advance', 'cash_advance_receipt', 'receipt') THEN 'petty_cash'
                ELSE pm.source_type END AS st,
           pm.source_id, pm.amount, pm.payment_date
    FROM public.payments pm
    LEFT JOIN public.invoices inv ON inv.id = pm.source_id AND pm.source_type = 'invoice'
    LEFT JOIN public.purchase_orders po ON po.id = pm.source_id AND pm.source_type IN ('purchase_order', 'po')
    LEFT JOIN public.payroll pr ON pr.id = pm.source_id AND pm.source_type = 'payroll'
    LEFT JOIN public.cash_advance_receipts r ON r.id = pm.source_id
          AND pm.source_type IN ('petty_cash', 'cash_advance', 'cash_advance_receipt', 'receipt')
    LEFT JOIN public.overtime_entries ot ON ot.id = pm.source_id AND pm.source_type = 'overtime'
    LEFT JOIN public.per_diem_ledger pdl ON pdl.id = pm.source_id AND pm.source_type = 'per_diem'
    WHERE pm.project_id = p_project_id
  ),
  paid_src AS (SELECT pay.st, pay.source_id, sum(pay.amount) AS paid FROM pay GROUP BY 1, 2),
  -- unpaid contract instalments, capped so a contract never forecasts more
  -- than what is still owed on it
  sched AS (
    SELECT p.id, p.budget_code AS code,
           GREATEST(COALESCE(p.total_amount, 0) - COALESCE(ps.paid, 0), 0) AS outstanding,
           CASE WHEN COALESCE(e.elem->>'dueDate', e.elem->>'due_date', '') ~ '^\d{4}-\d{2}-\d{2}'
                  THEN left(COALESCE(e.elem->>'dueDate', e.elem->>'due_date'), 10)::date END AS due,
           COALESCE(NULLIF(e.elem->>'amount', '')::numeric,
                    COALESCE(p.total_amount, 0) * COALESCE(NULLIF(e.elem->>'percent', '')::numeric, 0) / 100) AS amt,
           e.ord
    FROM public.payroll p
    LEFT JOIN paid_src ps ON ps.st = 'payroll' AND ps.source_id = p.id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.payment_schedule) = 'array' THEN p.payment_schedule ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS e(elem, ord)
    WHERE p.project_id = p_project_id
      AND COALESCE(e.elem->>'status', 'Pending') <> 'Paid'
  ),
  sched_capped AS (
    SELECT s.code, s.due,
           GREATEST(LEAST(s.amt, s.outstanding - COALESCE(
             sum(s.amt) OVER (PARTITION BY s.id ORDER BY s.due NULLS LAST, s.ord
                              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)), 0) AS amt
    FROM sched s
    WHERE s.due IS NOT NULL AND s.amt > 0
  ),
  dated AS (
    -- contract instalments
    SELECT sc.code, GREATEST(sc.due, v_today) AS d, sc.amt AS amount FROM sched_capped sc WHERE sc.amt > 0
    UNION ALL
    -- unpaid invoice balances
    SELECT i.budget_code, GREATEST(COALESCE(i.date, v_today), v_today),
           GREATEST(COALESCE(i.price, 0)
                    + CASE WHEN p_include_vat THEN
                             CASE WHEN COALESCE(i.vat_amount, 0) > 0 THEN i.vat_amount
                                  WHEN i.vatable THEN round(COALESCE(i.price, 0) * 0.15, 2) ELSE 0 END
                           ELSE 0 END
                    - COALESCE(ps.paid, 0), 0)
    FROM public.invoices i
    LEFT JOIN paid_src ps ON ps.st = 'invoice' AND ps.source_id = i.id
    WHERE i.project_id = p_project_id
    UNION ALL
    -- open purchase orders
    SELECT po.budget_code, GREATEST(COALESCE(po.date, v_today), v_today),
           GREATEST(COALESCE(po.amount, 0) - COALESCE(ps.paid, 0), 0)
    FROM public.purchase_orders po
    LEFT JOIN paid_src ps ON ps.st = 'purchase_order' AND ps.source_id = po.id
    WHERE po.project_id = p_project_id
      AND COALESCE(po.status, '') NOT IN ('Cancelled', 'cancelled', 'Rejected', 'rejected')
  ),
  dated_p AS (
    SELECT d.code, date_trunc(p_grain, d.d::timestamp)::date AS ps, sum(d.amount) AS amount
    FROM dated d WHERE d.amount > 0 GROUP BY 1, 2
  ),
  paid_code AS (SELECT pay.code, sum(pay.amount) AS paid FROM pay GROUP BY pay.code),
  dated_code AS (SELECT dp.code, sum(dp.amount) AS dated FROM dated_p dp GROUP BY dp.code),
  codes AS (
    SELECT c.code,
           COALESCE(b.budget, 0)  AS budget,
           COALESCE(pc.paid, 0)   AS paid,
           COALESCE(dc.dated, 0)  AS dated,
           b.topsheet_code, b.line_description
    FROM (SELECT code FROM budget UNION SELECT code FROM paid_code UNION SELECT code FROM dated_code) c
    LEFT JOIN budget b      ON b.code  IS NOT DISTINCT FROM c.code
    LEFT JOIN paid_code pc  ON pc.code IS NOT DISTINCT FROM c.code
    LEFT JOIN dated_code dc ON dc.code IS NOT DISTINCT FROM c.code
  ),
  resid AS (
    SELECT c.code, GREATEST(c.budget - c.paid - c.dated, 0) AS residual
    FROM codes c
  ),
  spread_periods AS (
    SELECT gs::date AS ps, row_number() OVER (ORDER BY gs) AS rn, count(*) OVER () AS n
    FROM generate_series(v_cur::timestamp, v_last::timestamp, v_step) gs
  ),
  spread AS (
    SELECT r.code, sp.ps,
           CASE
             WHEN p_spread = 'end'  THEN CASE WHEN sp.rn = sp.n THEN r.residual ELSE 0 END
             WHEN p_spread = 'even' THEN
               CASE WHEN sp.rn < sp.n THEN round(r.residual / sp.n, 2)
                    ELSE r.residual - round(r.residual / sp.n, 2) * (sp.n - 1) END
           END AS amount
    FROM resid r CROSS JOIN spread_periods sp
    WHERE p_spread <> 'none' AND r.residual > 0
  ),
  ev AS (   -- every money cell: code x period x kind
    SELECT pay.code, date_trunc(p_grain, pay.payment_date::timestamp)::date AS ps,
           'actual'::text AS kind, sum(pay.amount) AS amount
    FROM pay WHERE pay.payment_date IS NOT NULL GROUP BY 1, 2
    UNION ALL
    SELECT u.code, u.ps, 'forecast', sum(u.amount)
    FROM (SELECT dp.code, dp.ps, dp.amount FROM dated_p dp
          UNION ALL
          SELECT s.code, s.ps, s.amount FROM spread s WHERE s.amount > 0) u
    GROUP BY 1, 2
  ),
  fund AS (
    SELECT date_trunc(p_grain, f.funding_date::timestamp)::date AS ps, sum(f.amount) AS amount
    FROM public.project_funding f WHERE f.project_id = p_project_id GROUP BY 1
  ),
  bounds AS (
    SELECT LEAST(COALESCE((SELECT min(ev.ps) FROM ev), v_cur),
                 COALESCE((SELECT min(fund.ps) FROM fund), v_cur),
                 date_trunc(p_grain, COALESCE(v_start, v_today)::timestamp)::date, v_cur) AS first_p,
           GREATEST(COALESCE((SELECT max(ev.ps) FROM ev), v_last),
                    COALESCE((SELECT max(fund.ps) FROM fund), v_last), v_last) AS last_p
  ),
  per AS (
    SELECT gs::date AS ps FROM bounds, generate_series(bounds.first_p::timestamp, bounds.last_p::timestamp, v_step) gs
  ),
  tot AS (
    SELECT per.ps,
           COALESCE((SELECT sum(ev.amount) FROM ev WHERE ev.ps = per.ps), 0)     AS outflow,
           COALESCE((SELECT fund.amount FROM fund WHERE fund.ps = per.ps), 0)    AS funding
    FROM per
  ),
  tot2 AS (
    SELECT t.ps, t.outflow, t.funding,
           sum(t.funding - t.outflow) OVER (ORDER BY t.ps) AS closing
    FROM tot t
  ),
  master AS (
    SELECT DISTINCT ON (mb.budget_code) mb.budget_code AS code, mb.description, mb.topsheet_code
    FROM public.master_budget mb ORDER BY mb.budget_code, mb.is_header NULLS LAST
  ),
  line_json AS (
    SELECT c.code, ts.display_order,
           jsonb_build_object(
             'header',       COALESCE(ts.section, 'Other'),
             'sub_account',  CASE WHEN ts.code IS NOT NULL THEN ts.code || ' · ' || ts.name END,
             'budget_code',  c.code,
             'description',  COALESCE(m.description, c.line_description),
             'budget',       round(c.budget, 2),
             'paid_to_date', round(c.paid, 2),
             'remaining',    round(c.budget - c.paid, 2),
             'over_budget',  (c.paid + c.dated > c.budget + 0.005),
             'periods',      COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('period_start', ev.ps, 'amount', round(ev.amount, 2), 'kind', ev.kind)
                                  ORDER BY ev.ps, ev.kind)
                 FROM ev WHERE ev.code IS NOT DISTINCT FROM c.code AND ev.amount <> 0), '[]'::jsonb)
           ) AS j
    FROM codes c
    LEFT JOIN master m ON m.code = c.code
    LEFT JOIN public.budget_topsheet_accounts ts ON ts.code = COALESCE(c.topsheet_code, m.topsheet_code)
    WHERE c.code IS NOT NULL OR c.paid <> 0 OR c.dated <> 0
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'grain', p_grain, 'as_of', v_today, 'current_period', v_cur,
      'first_period', (SELECT first_p FROM bounds), 'last_period', (SELECT last_p FROM bounds),
      'include_vat', p_include_vat, 'spread', p_spread, 'currency', 'SAR',
      'has_funding', EXISTS (SELECT 1 FROM fund)),
    'lines',  COALESCE((SELECT jsonb_agg(lj.j ORDER BY lj.display_order NULLS LAST, lj.code NULLS LAST) FROM line_json lj), '[]'::jsonb),
    'totals', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                           'period_start', t.ps,
                           'outflow', round(t.outflow, 2),
                           'funding', round(t.funding, 2),
                           'opening', round(t.closing - t.funding + t.outflow, 2),
                           'closing', round(t.closing, 2)) ORDER BY t.ps)
                        FROM tot2 t), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_cash_flow(uuid, text, boolean, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_flow(uuid, text, boolean, text, date) TO authenticated, service_role;
