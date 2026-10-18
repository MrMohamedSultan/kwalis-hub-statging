-- =====================================================================
-- D20 — VAT and Withholding Tax reports, split and read from the database
--   table public.wht_rate_rules
--   RPC   public.get_vat_report(project, quarter)
--   RPC   public.get_wht_report(project, month)
--
-- Open decision Q5 (WHT rates per service type, treatment of foreign crew)
-- is NOT taken here. The rate table ships with ONE row: the 5% default the
-- app applies today. Once the tax adviser's table is approved, add rows —
-- no code change. Nothing in the functions hardcodes a rate.
--
-- ADDITIVE. Rollback:
--   DROP FUNCTION public.get_wht_report(uuid, text);
--   DROP FUNCTION public.get_vat_report(uuid, text);
--   DROP FUNCTION public.resolve_wht_rate(uuid, text);
--   DROP TABLE    public.wht_rate_rules;
-- =====================================================================
CREATE TABLE public.wht_rate_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,  -- NULL = platform default
  service_type    text NOT NULL CHECK (service_type = lower(btrim(service_type)) AND length(service_type) BETWEEN 1 AND 100),
  rate_pct        numeric(5,2) NOT NULL CHECK (rate_pct >= 0 AND rate_pct <= 100),
  notes           text CHECK (notes IS NULL OR length(notes) <= 500),
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wht_rate_rules_org_service_key
  ON public.wht_rate_rules (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), service_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wht_rate_rules TO authenticated;
GRANT ALL ON public.wht_rate_rules TO service_role;
REVOKE ALL ON public.wht_rate_rules FROM anon;
ALTER TABLE public.wht_rate_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their WHT rates and platform defaults"
  ON public.wht_rate_rules FOR SELECT TO authenticated
  USING (organization_id IS NULL OR public.is_super_admin(auth.uid())
         OR public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Admins insert WHT rates"
  ON public.wht_rate_rules FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid())
              OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)));
CREATE POLICY "Admins update WHT rates"
  ON public.wht_rate_rules FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)))
  WITH CHECK (public.is_super_admin(auth.uid())
              OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)));
CREATE POLICY "Admins delete WHT rates"
  ON public.wht_rate_rules FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)));

CREATE TRIGGER wht_rate_rules_set_updated_at
  BEFORE UPDATE ON public.wht_rate_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_audit_history_wht_rate_rules
  AFTER INSERT OR UPDATE OR DELETE ON public.wht_rate_rules
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- The one row that reproduces today's behaviour.
INSERT INTO public.wht_rate_rules (organization_id, service_type, rate_pct, notes, created_by)
VALUES (NULL, 'default', 5.00, 'Rate the app applied before this table existed. Replace/extend after decision Q5.', NULL);

-- Rate for a service type: the organization's rule, else the platform rule for
-- that service type, else the organization's default, else the platform default.
CREATE OR REPLACE FUNCTION public.resolve_wht_rate(p_org uuid, p_service_type text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT r.rate_pct
  FROM public.wht_rate_rules r
  WHERE (r.organization_id = p_org OR r.organization_id IS NULL)
    AND r.service_type IN (lower(btrim(COALESCE(p_service_type, ''))), 'default')
  ORDER BY (r.service_type <> 'default') DESC,
           (r.organization_id IS NOT NULL) DESC
  LIMIT 1
$$;

-- ---------------------------------------------------------------------
-- get_vat_report(project, quarter)      quarter = 'YYYY-Qn' (NULL = all dates)
-- ---------------------------------------------------------------------
-- One row per invoice carrying VAT. type is 'input' (VAT paid to suppliers,
-- recoverable). The platform records no sales, so there are no 'output' rows
-- today; the column exists so the screen and the ZATCA layout do not change
-- when sales are added.
CREATE OR REPLACE FUNCTION public.get_vat_report(p_project_id uuid, p_quarter text DEFAULT NULL)
RETURNS TABLE (
  date        date,
  invoice_no  text,
  vendor      text,
  vat_no      text,
  net         numeric,
  vat         numeric,
  total       numeric,
  type        text,
  budget_code text,
  invoice_id  uuid
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_org uuid; v_from date; v_to date; v_y int; v_q int;
BEGIN
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_vat_report: access denied' USING ERRCODE = '42501';
  END IF;
  IF p_quarter IS NOT NULL THEN
    IF p_quarter !~ '^[0-9]{4}-Q[1-4]$' THEN
      RAISE EXCEPTION 'get_vat_report: p_quarter must look like 2026-Q3' USING ERRCODE = '22023';
    END IF;
    v_y := substring(p_quarter FROM 1 FOR 4)::int;
    v_q := substring(p_quarter FROM 7 FOR 1)::int;
    v_from := make_date(v_y, (v_q - 1) * 3 + 1, 1);
    v_to   := (v_from + interval '3 months - 1 day')::date;
  END IF;

  RETURN QUERY
  SELECT i.date,
         NULLIF(btrim(i.invoice_no), ''),
         i.vendor_name,
         v.vat_no,
         round(COALESCE(i.price, 0), 2),
         round(x.vat, 2),
         round(COALESCE(i.price, 0) + x.vat, 2),
         'input'::text,
         i.budget_code,
         i.id
  FROM public.invoices i
  LEFT JOIN LATERAL (
    SELECT NULLIF(vv.vat_no, '') AS vat_no
    FROM public.vendors vv
    WHERE vv.organization_id = i.organization_id AND lower(vv.name) = lower(i.vendor_name)
    ORDER BY (vv.project_id = i.project_id) DESC NULLS LAST, vv.created_at
    LIMIT 1
  ) v ON true
  CROSS JOIN LATERAL (
    SELECT CASE WHEN COALESCE(i.vat_amount, 0) > 0 THEN i.vat_amount
                WHEN i.vatable THEN round(COALESCE(i.price, 0) * 0.15, 2)
                ELSE 0 END AS vat
  ) x
  WHERE i.project_id = p_project_id
    AND x.vat > 0
    AND (p_quarter IS NULL OR (i.date >= v_from AND i.date <= v_to))
  ORDER BY i.date NULLS LAST, i.invoice_no, i.id;
END;
$$;

-- ---------------------------------------------------------------------
-- get_wht_report(project, month)        month = 'YYYY-MM' (NULL = all dates)
-- ---------------------------------------------------------------------
-- A row is listed when withholding applies to it:
--   invoice : vendor flagged non-Saudi, or a WHT amount/percent stored on it
--   payroll : a WHT amount/percent stored on it, or the person (matched by
--             name, as today) has a non-Saudi nationality
-- rate   = the percent stored on the document, else resolve_wht_rate()
-- wht    = the amount stored on the document, else base x rate
-- rate_source tells which of the two was used.
-- wht_treatment (live column, added 2026-08-04): inclusive = WHT is deducted
-- from the agreed amount; exclusive = paid on top (gross-up), so the cost to
-- the budget is base + wht. budget_cost shows that figure; it is the same
-- rule as calculateWht() in src/components/contracts/WhtTreatmentSelector.tsx.
DROP FUNCTION IF EXISTS public.get_wht_report(uuid, text);
CREATE FUNCTION public.get_wht_report(p_project_id uuid, p_month text DEFAULT NULL)
RETURNS TABLE (
  party            text,
  country          text,
  service_type     text,
  base_amount      numeric,
  rate             numeric,
  wht_amount       numeric,
  source_document  text,
  source           text,      -- Invoice | Payroll
  date             date,
  rate_source      text,      -- document | rate table
  source_id        uuid,
  wht_treatment    text,      -- inclusive | exclusive
  budget_cost      numeric    -- base, or base + wht when exclusive
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_org uuid; v_from date; v_to date;
BEGIN
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_wht_report: access denied' USING ERRCODE = '42501';
  END IF;
  IF p_month IS NOT NULL THEN
    IF p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
      RAISE EXCEPTION 'get_wht_report: p_month must look like 2026-09' USING ERRCODE = '22023';
    END IF;
    v_from := to_date(p_month || '-01', 'YYYY-MM-DD');
    v_to   := (v_from + interval '1 month - 1 day')::date;
  END IF;

  RETURN QUERY
  WITH src AS (
    SELECT 'Invoice'::text AS source, i.id, i.vendor_name AS party,
           NULLIF(btrim(v.company_nationality), '') AS country,
           COALESCE(NULLIF(btrim(i.department), ''), 'General') AS service_type,
           COALESCE(i.price, 0) AS base,
           NULLIF(i.wht_percent, 0) AS doc_pct,
           NULLIF(i.wht_amount, 0)  AS doc_amt,
           NULLIF(btrim(i.invoice_no), '') AS doc,
           i.date AS d,
           i.wht_treatment AS treat
    FROM public.invoices i
    LEFT JOIN LATERAL (
      SELECT vv.company_nationality FROM public.vendors vv
      WHERE vv.organization_id = i.organization_id AND lower(vv.name) = lower(i.vendor_name)
      ORDER BY (vv.project_id = i.project_id) DESC NULLS LAST, vv.created_at LIMIT 1
    ) v ON true
    WHERE i.project_id = p_project_id
      AND (COALESCE(i.is_non_saudi_vendor, false) OR COALESCE(i.wht_amount, 0) > 0 OR COALESCE(i.wht_percent, 0) > 0)
    UNION ALL
    SELECT 'Payroll', p.id, p.name,
           NULLIF(btrim(pe.nationality), ''),
           CASE WHEN p.kind = 'cast' THEN 'Cast performance' ELSE 'Crew service' END,
           COALESCE(p.total_amount, 0),
           NULLIF(p.wht_percent, 0),
           NULLIF(p.wht_amount, 0),
           CASE WHEN p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-' THEN NULL ELSE NULLIF(btrim(p.ref_id), '') END,
           p.created_at::date,
           p.wht_treatment
    FROM public.payroll p
    LEFT JOIN LATERAL (
      SELECT pp.nationality FROM public.people pp
      WHERE pp.project_id = p.project_id AND pp.full_name = p.name
      ORDER BY pp.created_at LIMIT 1
    ) pe ON true
    WHERE p.project_id = p_project_id
      AND (COALESCE(p.wht_amount, 0) > 0 OR COALESCE(p.wht_percent, 0) > 0
           OR (btrim(COALESCE(pe.nationality, '')) <> '' AND lower(pe.nationality) <> 'saudi arabia'))
  )
  SELECT s.party, s.country, s.service_type,
         round(s.base, 2),
         round(r.rate, 2),
         round(COALESCE(s.doc_amt, s.base * r.rate / 100), 2),
         s.doc, s.source, s.d,
         CASE WHEN s.doc_pct IS NOT NULL OR s.doc_amt IS NOT NULL THEN 'document' ELSE 'rate table' END,
         s.id,
         s.treat,
         round(s.base + CASE WHEN s.treat = 'exclusive' THEN COALESCE(s.doc_amt, s.base * r.rate / 100) ELSE 0 END, 2)
  FROM src s
  CROSS JOIN LATERAL (
    SELECT COALESCE(s.doc_pct,
                    CASE WHEN s.doc_amt IS NOT NULL AND s.base > 0 THEN round(s.doc_amt / s.base * 100, 2) END,
                    public.resolve_wht_rate(v_org, s.service_type)) AS rate
  ) r
  WHERE (p_month IS NULL OR (s.d >= v_from AND s.d <= v_to))
  ORDER BY s.d NULLS LAST, s.source, s.party;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_wht_rate(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_vat_report(uuid, text)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_wht_report(uuid, text)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_wht_rate(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_vat_report(uuid, text)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_wht_report(uuid, text)   TO authenticated, service_role;
