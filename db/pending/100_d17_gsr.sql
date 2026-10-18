-- =====================================================================
-- D17 — Global Spend Report (where the production money was spent)
--   columns spend_country / spend_city on invoices, payroll, cash_advance_receipts
--   table   public.gsr_spend_type_map       (budget code -> spend type)
--   RPC     public.get_gsr(project, from, to)
--
-- Open decision Q4 (the official GSR template of the requesting platform or
-- studio) is NOT available yet. The function returns the columns agreed in
-- the plan sheet; if the template names or orders them differently only the
-- screen/export changes, not this data.
--
-- ADDITIVE: six nullable columns, one table, two functions. No backfill.
--
-- Where a place is not recorded it is reported as 'Unspecified' — never
-- guessed. Country falls back to the vendor's / person's recorded country
-- only, as the audit sheet specifies.
--
-- Rollback:
--   DROP FUNCTION public.get_gsr(uuid, date, date);
--   DROP FUNCTION public.resolve_gsr_spend_type(uuid, text, text);
--   DROP TABLE    public.gsr_spend_type_map;
--   ALTER TABLE public.invoices              DROP COLUMN spend_country, DROP COLUMN spend_city;
--   ALTER TABLE public.payroll               DROP COLUMN spend_country, DROP COLUMN spend_city;
--   ALTER TABLE public.cash_advance_receipts DROP COLUMN spend_country, DROP COLUMN spend_city;
-- =====================================================================
ALTER TABLE public.invoices              ADD COLUMN IF NOT EXISTS spend_country text, ADD COLUMN IF NOT EXISTS spend_city text;
ALTER TABLE public.payroll               ADD COLUMN IF NOT EXISTS spend_country text, ADD COLUMN IF NOT EXISTS spend_city text;
ALTER TABLE public.cash_advance_receipts ADD COLUMN IF NOT EXISTS spend_country text, ADD COLUMN IF NOT EXISTS spend_city text;

COMMENT ON COLUMN public.invoices.spend_country IS 'GSR: country where this cost was spent. NULL = fall back to the vendor''s country.';
COMMENT ON COLUMN public.payroll.spend_country  IS 'GSR: country where the work was performed. NULL = fall back to the person''s country.';

CREATE TABLE public.gsr_spend_type_map (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid REFERENCES public.organizations(id) ON DELETE CASCADE,  -- NULL = platform default
  budget_code_prefix text NOT NULL CHECK (budget_code_prefix ~ '^[0-9A-Za-z._-]{1,64}$'),
  spend_type         text NOT NULL CHECK (spend_type IN ('Labour', 'Vendors', 'Rentals', 'Travel & Accommodation', 'Other')),
  created_by         uuid DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gsr_spend_type_map_org_prefix_key
  ON public.gsr_spend_type_map (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), budget_code_prefix);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsr_spend_type_map TO authenticated;
GRANT ALL ON public.gsr_spend_type_map TO service_role;
REVOKE ALL ON public.gsr_spend_type_map FROM anon;
ALTER TABLE public.gsr_spend_type_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their spend-type mapping and platform defaults"
  ON public.gsr_spend_type_map FOR SELECT TO authenticated
  USING (organization_id IS NULL OR public.is_super_admin(auth.uid())
         OR public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Admins insert spend-type mapping"
  ON public.gsr_spend_type_map FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid())
              OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)));
CREATE POLICY "Admins update spend-type mapping"
  ON public.gsr_spend_type_map FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)))
  WITH CHECK (public.is_super_admin(auth.uid())
              OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)));
CREATE POLICY "Admins delete spend-type mapping"
  ON public.gsr_spend_type_map FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)));
CREATE TRIGGER gsr_spend_type_map_set_updated_at
  BEFORE UPDATE ON public.gsr_spend_type_map FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Spend type of a cost row: the mapping for its budget code (organization
-- rule first, most specific prefix), else a default from where the row came from.
CREATE OR REPLACE FUNCTION public.resolve_gsr_spend_type(p_org uuid, p_budget_code text, p_source_type text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT m.spend_type
     FROM public.gsr_spend_type_map m
     WHERE p_budget_code IS NOT NULL
       AND btrim(p_budget_code) LIKE m.budget_code_prefix || '%'
       AND (m.organization_id = p_org OR m.organization_id IS NULL)
     ORDER BY (m.organization_id IS NOT NULL) DESC, length(m.budget_code_prefix) DESC
     LIMIT 1),
    CASE p_source_type
      WHEN 'payroll'    THEN 'Labour'
      WHEN 'overtime'   THEN 'Labour'
      WHEN 'per_diem'   THEN 'Travel & Accommodation'
      WHEN 'invoice'    THEN 'Vendors'
      ELSE 'Other'
    END)
$$;

-- ---------------------------------------------------------------------
-- get_gsr
-- ---------------------------------------------------------------------
-- Basis: incurred cost (Actual), excluding VAT — not only what was paid.
-- One row per country / city / category / spend type / local-or-international.
--   pct        = share of the report total
--   shoot_days = shooting days recorded on the project's locations in that
--                city. It is a property of the CITY, repeated on each of the
--                city's rows: show it once per city, do not sum it.
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
           public.resolve_gsr_spend_type(v_org, t.budget_code, t.source_type) AS spend_type,
           CASE WHEN COALESCE(pl.is_foreign, false) THEN 'International' ELSE 'Local' END AS local_intl,
           t.amount
    FROM public.v_ledger_transactions t
    LEFT JOIN place pl ON pl.st = t.source_type AND pl.id = t.source_id
    LEFT JOIN code_section cs ON cs.code = t.budget_code
    WHERE t.project_id = p_project_id
      AND t.entry_kind = 'actual'
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

REVOKE ALL ON FUNCTION public.resolve_gsr_spend_type(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_gsr(uuid, date, date)                FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_gsr_spend_type(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_gsr(uuid, date, date)                TO authenticated, service_role;
