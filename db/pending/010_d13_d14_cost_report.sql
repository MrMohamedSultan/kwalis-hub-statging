-- =====================================================================
-- D14 + D13 — Cost Report data layer
--   D14: table  public.cost_report_etc         (manual ETC per budget code)
--   D13: RPC    public.get_cost_report(project, from, to)
--
-- ADDITIVE ONLY. Creates one table, two functions and one trigger.
-- Does not alter, drop or rewrite any existing table, view, function,
-- policy or row.
--
-- Manual rollback:
--   DROP FUNCTION IF EXISTS public.get_cost_report(uuid, date, date);
--   DROP TABLE    IF EXISTS public.cost_report_etc;
--   DROP FUNCTION IF EXISTS public.stamp_cost_report_etc();
-- =====================================================================

-- ---------------------------------------------------------------------
-- D14 — cost_report_etc
-- ---------------------------------------------------------------------
-- 1) CREATE TABLE
CREATE TABLE public.cost_report_etc (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id)      ON DELETE CASCADE,
  budget_code     text NOT NULL CHECK (length(btrim(budget_code)) BETWEEN 1 AND 64),
  etc_amount      numeric(14,2) NOT NULL CHECK (etc_amount >= 0),
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_report_etc_project_code_key UNIQUE (project_id, budget_code)
);

COMMENT ON TABLE public.cost_report_etc IS
  'Manual Estimate-To-Complete per budget code, in the organization base currency (SAR). A missing row means "use the default": GREATEST(estimate - actual - committed, 0).';

-- 2) GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_report_etc TO authenticated;
GRANT ALL ON public.cost_report_etc TO service_role;
REVOKE ALL ON public.cost_report_etc FROM anon;

-- 3) ENABLE RLS
ALTER TABLE public.cost_report_etc ENABLE ROW LEVEL SECURITY;

-- 4) POLICIES — tenant scope through can_access_project; writes also need
--    Edit on the "reports" module.
CREATE POLICY "Project members can read cost report ETC"
  ON public.cost_report_etc FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));

CREATE POLICY "Report editors can insert cost report ETC"
  ON public.cost_report_etc FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_project(auth.uid(), organization_id, project_id)
    AND public.can_edit('reports')
  );

CREATE POLICY "Report editors can update cost report ETC"
  ON public.cost_report_etc FOR UPDATE TO authenticated
  USING (
    public.can_access_project(auth.uid(), organization_id, project_id)
    AND public.can_edit('reports')
  )
  WITH CHECK (
    public.can_access_project(auth.uid(), organization_id, project_id)
    AND public.can_edit('reports')
  );

CREATE POLICY "Report editors can delete cost report ETC"
  ON public.cost_report_etc FOR DELETE TO authenticated
  USING (
    public.can_access_project(auth.uid(), organization_id, project_id)
    AND public.can_edit('reports')
  );

-- updated_by / updated_at are set by the database, never by the client.
-- organization_id is always taken from the project, so a client cannot file
-- a row under another tenant.
CREATE OR REPLACE FUNCTION public.stamp_cost_report_etc()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = NEW.project_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'cost_report_etc: project % not found', NEW.project_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.organization_id := v_org;
  NEW.budget_code     := btrim(NEW.budget_code);
  NEW.etc_amount      := round(NEW.etc_amount, 2);
  NEW.updated_by      := auth.uid();
  NEW.updated_at      := now();
  IF TG_OP = 'UPDATE' THEN
    NEW.project_id := OLD.project_id;   -- a row never moves between projects
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stamp_cost_report_etc
  BEFORE INSERT OR UPDATE ON public.cost_report_etc
  FOR EACH ROW EXECUTE FUNCTION public.stamp_cost_report_etc();

-- ---------------------------------------------------------------------
-- D13 — get_cost_report(p_project_id, p_from, p_to)
-- ---------------------------------------------------------------------
-- One row per budget code. All amounts are in the record currency (SAR),
-- exactly as v_budget_code_position returns them; the UI converts for
-- display with the existing SAR/USD switch. Nothing is converted twice.
--
--   estimate      approved budget for the code   (v_budget_code_position.budget_sar)
--   actual        cost incurred                  (v_budget_code_position.actual_sar)
--   committed     open commitments               (v_budget_code_position.committed_sar)
--   paid_period   payments with p_from <= payment_date <= p_to
--   paid_to_date  payments with payment_date <= p_to   (all payments when p_to is null)
--   etc           manual value from cost_report_etc, else GREATEST(estimate-actual-committed, 0)
--   efc           actual + committed + etc
--   variance      estimate - efc            (negative = over budget)
--
-- Payments are resolved to a budget code through their source document, the
-- same way v_paid_by_budget_code does. A payment whose source cannot be
-- resolved is NOT dropped: it is returned on a row with budget_code NULL so
-- the paid totals always equal the payments ledger.
--
-- SECURITY INVOKER + explicit access check. The function runs with the
-- caller's own rights, so row-level security on every table still applies,
-- and on top of that a caller without access to the project gets an
-- exception instead of an empty report.
CREATE OR REPLACE FUNCTION public.get_cost_report(
  p_project_id uuid,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
RETURNS TABLE (
  "group"         text,
  topsheet_code   text,
  topsheet_name   text,
  budget_code     text,
  description     text,
  estimate        numeric,
  paid_period     numeric,
  paid_to_date    numeric,
  actual          numeric,
  committed       numeric,
  etc             numeric,
  efc             numeric,
  variance        numeric,
  etc_is_manual   boolean,
  etc_updated_at  timestamptz,
  etc_updated_by  uuid
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'get_cost_report: p_project_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'get_cost_report: p_from is after p_to' USING ERRCODE = '22023';
  END IF;

  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;

  IF v_org IS NULL
     OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_cost_report: access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH pos AS (
    SELECT bcp.budget_code   AS code,
           bcp.budget_sar    AS estimate,
           bcp.actual_sar    AS actual,
           bcp.committed_sar AS committed
    FROM public.v_budget_code_position bcp
    WHERE bcp.project_id = p_project_id
  ),
  pay AS (
    SELECT COALESCE(inv.budget_code, po.budget_code, pr.budget_code,
                    r.budget_code, ot.budget_code, pdl.budget_code) AS code,
           pm.amount,
           pm.payment_date
    FROM public.payments pm
    LEFT JOIN public.invoices inv ON inv.id = pm.source_id AND pm.source_type = 'invoice'
    LEFT JOIN public.purchase_orders po ON po.id = pm.source_id
          AND pm.source_type IN ('purchase_order', 'po')
    LEFT JOIN public.payroll pr ON pr.id = pm.source_id AND pm.source_type = 'payroll'
    LEFT JOIN public.cash_advance_receipts r ON r.id = pm.source_id
          AND pm.source_type IN ('petty_cash', 'cash_advance', 'cash_advance_receipt', 'receipt')
    LEFT JOIN public.overtime_entries ot ON ot.id = pm.source_id AND pm.source_type = 'overtime'
    LEFT JOIN public.per_diem_ledger pdl ON pdl.id = pm.source_id AND pm.source_type = 'per_diem'
    WHERE pm.project_id = p_project_id
  ),
  paid AS (
    SELECT pay.code,
           COALESCE(sum(pay.amount) FILTER (
             WHERE (p_from IS NULL OR pay.payment_date >= p_from)
               AND (p_to   IS NULL OR pay.payment_date <= p_to)), 0) AS paid_period,
           COALESCE(sum(pay.amount) FILTER (
             WHERE (p_to IS NULL OR pay.payment_date <= p_to)), 0)   AS paid_to_date
    FROM pay
    GROUP BY pay.code
  ),
  -- Union + group rather than FULL JOIN: codes can be NULL (unresolved
  -- payments, uncoded ledger rows) and must still line up on one row.
  codes AS (
    SELECT u.code,
           sum(u.estimate)     AS estimate,
           sum(u.actual)       AS actual,
           sum(u.committed)    AS committed,
           sum(u.paid_period)  AS paid_period,
           sum(u.paid_to_date) AS paid_to_date
    FROM (
      SELECT pos.code, pos.estimate, pos.actual, pos.committed,
             0::numeric AS paid_period, 0::numeric AS paid_to_date
      FROM pos
      UNION ALL
      SELECT paid.code, 0::numeric, 0::numeric, 0::numeric,
             paid.paid_period, paid.paid_to_date
      FROM paid
    ) u
    GROUP BY u.code
    -- v_budget_code_position emits an all-zero row with a NULL code whenever
    -- the project has payments (payment ledger rows carry no code). Keep the
    -- NULL-code row only when it actually holds money.
    HAVING u.code IS NOT NULL
        OR sum(u.estimate) <> 0 OR sum(u.actual) <> 0 OR sum(u.committed) <> 0
        OR sum(u.paid_period) <> 0 OR sum(u.paid_to_date) <> 0
  ),
  -- Top Sheet account + description for a code, from the active budget lines.
  -- A code has many lines; take the most frequent top sheet account and the
  -- master chart description (falling back to the first line's description).
  line_meta AS (
    SELECT bl.main_code AS code,
           mode() WITHIN GROUP (ORDER BY bl.topsheet_code) AS topsheet_code,
           min(bl.description)                             AS line_description
    FROM public.v_active_budget_lines bl
    WHERE bl.project_id = p_project_id
    GROUP BY bl.main_code
  ),
  master AS (
    SELECT DISTINCT ON (mb.budget_code)
           mb.budget_code AS code, mb.description, mb.topsheet_code
    FROM public.master_budget mb
    ORDER BY mb.budget_code, mb.is_header NULLS LAST
  )
  SELECT
    COALESCE(ts.section, 'Other')                                        AS "group",
    ts.code                                                              AS topsheet_code,
    ts.name                                                              AS topsheet_name,
    c.code                                                               AS budget_code,
    COALESCE(m.description, lm.line_description)                         AS description,
    round(c.estimate, 2)                                                 AS estimate,
    round(c.paid_period, 2)                                              AS paid_period,
    round(c.paid_to_date, 2)                                             AS paid_to_date,
    round(c.actual, 2)                                                   AS actual,
    round(c.committed, 2)                                                AS committed,
    round(COALESCE(e.etc_amount,
                   GREATEST(c.estimate - c.actual - c.committed, 0)), 2) AS etc,
    round(c.actual + c.committed
          + COALESCE(e.etc_amount,
                     GREATEST(c.estimate - c.actual - c.committed, 0)), 2) AS efc,
    round(c.estimate
          - (c.actual + c.committed
             + COALESCE(e.etc_amount,
                        GREATEST(c.estimate - c.actual - c.committed, 0))), 2) AS variance,
    (e.id IS NOT NULL)                                                   AS etc_is_manual,
    e.updated_at                                                         AS etc_updated_at,
    e.updated_by                                                         AS etc_updated_by
  FROM codes c
  LEFT JOIN line_meta lm ON lm.code = c.code
  LEFT JOIN master m     ON m.code  = c.code
  LEFT JOIN public.budget_topsheet_accounts ts
         ON ts.code = COALESCE(lm.topsheet_code, m.topsheet_code)
  LEFT JOIN public.cost_report_etc e
         ON e.project_id = p_project_id AND e.budget_code = c.code
  ORDER BY ts.display_order NULLS LAST, c.code NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_cost_report(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cost_report(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_cost_report(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cost_report(uuid, date, date) TO service_role;

COMMENT ON FUNCTION public.get_cost_report(uuid, date, date) IS
  'Cost Report (N02): one row per budget code with estimate, paid this period, paid to date, actual, committed, ETC, EFC and variance. Amounts in SAR.';
