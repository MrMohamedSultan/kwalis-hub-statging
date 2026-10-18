-- =====================================================================
-- D18 — Overhead: company staff charged to a project without a production contract
--   table public.project_overhead_staff
--   RPC   public.get_overhead(project, from, to)
--
-- ADDITIVE: one table, two functions, one trigger. Replaces the idea behind
-- the GOSI & Localization tab; touches nothing that exists.
--
-- Open decision Q2 (should overhead count inside Actual on the Cost Report
-- and Top Sheet?) is NOT taken here: overhead stays a separate report and is
-- not added to v_ledger_transactions.
--
-- Rollback:
--   DROP FUNCTION public.get_overhead(uuid, date, date);
--   DROP TABLE    public.project_overhead_staff;
--   DROP FUNCTION public.stamp_project_overhead_staff();
-- =====================================================================
CREATE TABLE public.project_overhead_staff (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id)      ON DELETE CASCADE,
  employee_name   text NOT NULL CHECK (length(btrim(employee_name)) BETWEEN 1 AND 200),
  person_id       uuid REFERENCES public.people(id) ON DELETE SET NULL,
  position        text CHECK (position IS NULL OR length(position) <= 200),
  department      text CHECK (department IS NULL OR length(department) <= 200),
  -- full monthly cost to the company (salary + allowances + employer GOSI), SAR
  monthly_cost    numeric(14,2) NOT NULL CHECK (monthly_cost >= 0),
  allocation_pct  numeric(5,2)  NOT NULL CHECK (allocation_pct > 0 AND allocation_pct <= 100),
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  budget_code     text CHECK (budget_code IS NULL OR length(btrim(budget_code)) BETWEEN 1 AND 64),
  notes           text CHECK (notes IS NULL OR length(notes) <= 2000),
  deleted_at      timestamptz,
  deleted_by      uuid,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_overhead_staff_dates_check CHECK (end_date >= start_date)
);
CREATE INDEX idx_project_overhead_staff_project ON public.project_overhead_staff (project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_project_overhead_staff_person  ON public.project_overhead_staff (organization_id, person_id) WHERE deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON public.project_overhead_staff TO authenticated;
GRANT ALL ON public.project_overhead_staff TO service_role;
REVOKE ALL ON public.project_overhead_staff FROM anon;

ALTER TABLE public.project_overhead_staff ENABLE ROW LEVEL SECURITY;

-- Salaries: the table itself is readable and writable only by members of the
-- project who hold Edit on "reports". Everyone else reads through
-- get_overhead(), which hides monthly_cost. Rows are never hard-deleted by
-- users (no DELETE grant) — soft delete via deleted_at.
CREATE POLICY "Report editors can read overhead staff"
  ON public.project_overhead_staff FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('reports'));
CREATE POLICY "Report editors can insert overhead staff"
  ON public.project_overhead_staff FOR INSERT TO authenticated
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('reports'));
CREATE POLICY "Report editors can update overhead staff"
  ON public.project_overhead_staff FOR UPDATE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('reports'))
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('reports'));

CREATE OR REPLACE FUNCTION public.stamp_project_overhead_staff()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = NEW.project_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_overhead_staff: project % not found', NEW.project_id USING ERRCODE = '23503';
  END IF;
  NEW.organization_id := v_org;
  NEW.employee_name   := btrim(NEW.employee_name);
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
CREATE TRIGGER trg_stamp_project_overhead_staff
  BEFORE INSERT OR UPDATE ON public.project_overhead_staff
  FOR EACH ROW EXECUTE FUNCTION public.stamp_project_overhead_staff();
CREATE TRIGGER trg_audit_history_project_overhead_staff
  AFTER INSERT OR UPDATE OR DELETE ON public.project_overhead_staff
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- ---------------------------------------------------------------------
-- get_overhead
-- ---------------------------------------------------------------------
-- months          = overlap of [start_date, end_date] with [p_from, p_to], counted
--                   month by month as overlapped days / days in that month
--                   (a full calendar month = 1, partial months pro rata).
-- allocated_cost  = monthly_cost x allocation_pct x months
-- budget          = approved budget of the row's budget_code (whole code)
-- variance        = budget - allocated cost of ALL staff on that code in the period
-- over_allocated  = the same person is allocated above 100% across the
--                   organization's projects on some day of the row's window
--
-- SECURITY DEFINER because it must serve readers who may not read the salary
-- table directly; it checks project access itself and returns monthly_cost
-- only to callers holding Edit on "reports".
CREATE OR REPLACE FUNCTION public.get_overhead(
  p_project_id uuid,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  employee              text,
  "position"            text,
  department            text,
  monthly_cost          numeric,
  allocation_pct        numeric,
  start_date            date,
  end_date              date,
  months                numeric,
  allocated_cost        numeric,
  budget_code           text,
  budget                numeric,
  variance              numeric,
  over_allocated        boolean,
  total_allocation_pct  numeric,
  notes                 text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid; v_fx numeric; v_can_see_cost boolean; v_from date; v_to date;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'get_overhead: p_project_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'get_overhead: p_from is after p_to' USING ERRCODE = '22023';
  END IF;
  SELECT p.organization_id, p.fx_rate INTO v_org, v_fx FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id)
     OR NOT (public.can_view('reports') OR public.can_edit('reports')) THEN
    RAISE EXCEPTION 'get_overhead: access denied' USING ERRCODE = '42501';
  END IF;
  v_can_see_cost := public.can_edit('reports');
  v_from := COALESCE(p_from, '-infinity'::date);
  v_to   := COALESCE(p_to,   'infinity'::date);

  RETURN QUERY
  WITH staff AS (
    SELECT s.*,
           GREATEST(s.start_date, v_from) AS w_from,
           LEAST(s.end_date, v_to)        AS w_to
    FROM public.project_overhead_staff s
    WHERE s.project_id = p_project_id AND s.deleted_at IS NULL
  ),
  calc AS (
    SELECT s.id,
           COALESCE((
             SELECT sum(
                      (LEAST(s.w_to, (m + interval '1 month - 1 day')::date)
                       - GREATEST(s.w_from, m::date) + 1)::numeric
                      / extract(day FROM (m + interval '1 month - 1 day'))::numeric)
             FROM generate_series(date_trunc('month', s.w_from::timestamp),
                                  date_trunc('month', s.w_to::timestamp),
                                  interval '1 month') AS m
           ), 0) AS months
    FROM staff s
    WHERE s.w_from <= s.w_to
  ),
  costed AS (
    SELECT s.*, COALESCE(c.months, 0) AS months,
           round(s.monthly_cost * s.allocation_pct / 100 * COALESCE(c.months, 0), 2) AS allocated_cost
    FROM staff s LEFT JOIN calc c ON c.id = s.id
  ),
  code_budget AS (
    SELECT bl.main_code AS code,
           sum(public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap,
                                            bl.unit, bl.currency, bl.excluded, v_fx)) AS budget
    FROM public.v_active_budget_lines bl
    WHERE bl.project_id = p_project_id
    GROUP BY bl.main_code
  ),
  code_alloc AS (
    SELECT c.budget_code AS code, sum(c.allocated_cost) AS allocated
    FROM costed c GROUP BY c.budget_code
  ),
  -- peak total allocation of the same person across ALL projects of the org,
  -- evaluated at every date where one of their allocations starts
  peak AS (
    SELECT c.id,
           (SELECT max(tot) FROM (
              SELECT (SELECT sum(o2.allocation_pct)
                      FROM public.project_overhead_staff o2
                      WHERE o2.organization_id = v_org AND o2.deleted_at IS NULL
                        AND (CASE WHEN c.person_id IS NOT NULL THEN o2.person_id = c.person_id
                                  ELSE o2.person_id IS NULL
                                       AND lower(btrim(o2.employee_name)) = lower(btrim(c.employee_name)) END)
                        AND o2.start_date <= pt.d AND o2.end_date >= pt.d) AS tot
              FROM (SELECT o.start_date AS d
                    FROM public.project_overhead_staff o
                    WHERE o.organization_id = v_org AND o.deleted_at IS NULL
                      AND (CASE WHEN c.person_id IS NOT NULL THEN o.person_id = c.person_id
                                ELSE o.person_id IS NULL
                                     AND lower(btrim(o.employee_name)) = lower(btrim(c.employee_name)) END)
                      AND o.start_date <= c.end_date AND o.end_date >= c.start_date
                      AND o.start_date >= c.start_date
                    UNION SELECT c.start_date) pt
            ) x) AS peak_pct
    FROM costed c
  )
  SELECT c.id,
         c.employee_name,
         c.position,
         c.department,
         CASE WHEN v_can_see_cost THEN c.monthly_cost END,
         c.allocation_pct,
         c.start_date,
         c.end_date,
         round(c.months, 4),
         c.allocated_cost,
         c.budget_code,
         round(cb.budget, 2),
         CASE WHEN cb.budget IS NOT NULL THEN round(cb.budget - ca.allocated, 2) END,
         COALESCE(pk.peak_pct, c.allocation_pct) > 100,
         COALESCE(pk.peak_pct, c.allocation_pct),
         c.notes
  FROM costed c
  LEFT JOIN code_budget cb ON cb.code = c.budget_code
  LEFT JOIN code_alloc  ca ON ca.code IS NOT DISTINCT FROM c.budget_code
  LEFT JOIN peak pk        ON pk.id = c.id
  ORDER BY c.department NULLS LAST, c.employee_name, c.start_date;
END;
$$;

REVOKE ALL ON FUNCTION public.get_overhead(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_overhead(uuid, date, date) TO authenticated, service_role;
