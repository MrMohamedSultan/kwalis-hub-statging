-- =====================================================================
-- D21 — budget code -> GL account mapping, instead of "Uncategorized"
--   table public.budget_code_gl_map
--   RPC   public.resolve_gl_account(org, budget_code)
--   RPC   public.get_cost_by_gl_account(project, from, to)
--
-- Today a cost row lands under "Uncategorized" whenever its own
-- gl_account_id is empty (all 12 payroll rows on the live project). The GL
-- chart (gl_accounts) is a shared catalogue and is NOT renumbered or edited:
-- this adds a separate mapping table, as the audit sheet asks.
--
-- A row keeps its own gl_account_id when it has one. Otherwise the account is
-- looked up from its budget code: the organization's own mapping first, then
-- the platform default (organization_id IS NULL). Most specific prefix wins,
-- so "14" can map a whole section and "1403" one code.
--
-- The table starts EMPTY: which budget code belongs to which GL account is an
-- accounting decision. Until rows are entered the report still says
-- Uncategorized, exactly as today.
--
-- ADDITIVE. Rollback:
--   DROP FUNCTION public.get_cost_by_gl_account(uuid, date, date);
--   DROP FUNCTION public.resolve_gl_account(uuid, text);
--   DROP TABLE    public.budget_code_gl_map;
-- =====================================================================
CREATE TABLE public.budget_code_gl_map (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid REFERENCES public.organizations(id) ON DELETE CASCADE,  -- NULL = platform default
  budget_code_prefix text NOT NULL CHECK (budget_code_prefix ~ '^[0-9A-Za-z._-]{1,64}$'),
  gl_account_id      uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE CASCADE,
  notes              text CHECK (notes IS NULL OR length(notes) <= 500),
  created_by         uuid DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX budget_code_gl_map_org_prefix_key
  ON public.budget_code_gl_map (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), budget_code_prefix);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_code_gl_map TO authenticated;
GRANT ALL ON public.budget_code_gl_map TO service_role;
REVOKE ALL ON public.budget_code_gl_map FROM anon;
ALTER TABLE public.budget_code_gl_map ENABLE ROW LEVEL SECURITY;

-- read: platform defaults + the caller's own organizations
CREATE POLICY "Members read their GL mapping and platform defaults"
  ON public.budget_code_gl_map FOR SELECT TO authenticated
  USING (organization_id IS NULL
         OR public.is_super_admin(auth.uid())
         OR public.is_org_member(auth.uid(), organization_id));
-- write: organization admins for their organization, super admin for defaults
CREATE POLICY "Admins insert GL mapping"
  ON public.budget_code_gl_map FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid())
              OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)));
CREATE POLICY "Admins update GL mapping"
  ON public.budget_code_gl_map FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)))
  WITH CHECK (public.is_super_admin(auth.uid())
              OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)));
CREATE POLICY "Admins delete GL mapping"
  ON public.budget_code_gl_map FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id)));

CREATE TRIGGER budget_code_gl_map_set_updated_at
  BEFORE UPDATE ON public.budget_code_gl_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_audit_history_budget_code_gl_map
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_code_gl_map
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- The GL account a budget code maps to for an organization (NULL = unmapped).
CREATE OR REPLACE FUNCTION public.resolve_gl_account(p_org uuid, p_budget_code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.gl_account_id
  FROM public.budget_code_gl_map m
  WHERE p_budget_code IS NOT NULL
    AND btrim(p_budget_code) LIKE m.budget_code_prefix || '%'
    AND (m.organization_id = p_org OR m.organization_id IS NULL)
  ORDER BY (m.organization_id IS NOT NULL) DESC,   -- the organization's own rule first
           length(m.budget_code_prefix) DESC        -- then the most specific prefix
  LIMIT 1
$$;

-- Cost by GL account, on the approved definitions:
--   actual    = v_ledger_transactions entry_kind 'actual'      (payroll is ACTUAL, not committed)
--   committed = v_ledger_transactions entry_kind 'commitment'
--   paid      = payments, within the period
-- p_from / p_to filter actual and committed on entry_date and paid on payment_date.
CREATE OR REPLACE FUNCTION public.get_cost_by_gl_account(
  p_project_id uuid,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
RETURNS TABLE (
  gl_account_id   uuid,
  gl_code         text,
  gl_name         text,
  category        text,
  actual          numeric,
  committed       numeric,
  paid            numeric,
  invoice_count   integer,
  payroll_count   integer,
  receipt_count   integer,
  other_count     integer,
  mapped_by_code  integer   -- rows that got their account from the mapping table
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_org uuid;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'get_cost_by_gl_account: p_project_id is required' USING ERRCODE = '22004';
  END IF;
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_cost_by_gl_account: access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH led AS (
    SELECT t.source_type, t.source_id, t.entry_kind, t.amount,
           COALESCE(t.gl_account_id, public.resolve_gl_account(v_org, t.budget_code)) AS gl_id,
           (t.gl_account_id IS NULL AND public.resolve_gl_account(v_org, t.budget_code) IS NOT NULL) AS via_map
    FROM public.v_ledger_transactions t
    WHERE t.project_id = p_project_id
      AND t.entry_kind IN ('actual', 'commitment')
      AND (p_from IS NULL OR t.entry_date >= p_from)
      AND (p_to   IS NULL OR t.entry_date <= p_to)
  ),
  src_gl AS (   -- account of every source row, whatever its date: payments follow their source
    SELECT t.source_type, t.source_id,
           COALESCE(t.gl_account_id, public.resolve_gl_account(v_org, t.budget_code)) AS gl_id
    FROM public.v_ledger_transactions t
    WHERE t.project_id = p_project_id AND t.entry_kind IN ('actual', 'commitment')
  ),
  pay AS (
    SELECT s.gl_id, pm.amount
    FROM public.payments pm
    LEFT JOIN src_gl s
           ON s.source_id = pm.source_id
          AND s.source_type = CASE WHEN pm.source_type IN ('purchase_order', 'po') THEN 'purchase_order'
                                   WHEN pm.source_type IN ('petty_cash', 'cash_advance', 'cash_advance_receipt', 'receipt')
                                     THEN 'petty_cash' ELSE pm.source_type END
    WHERE pm.project_id = p_project_id
      AND (p_from IS NULL OR pm.payment_date >= p_from)
      AND (p_to   IS NULL OR pm.payment_date <= p_to)
  ),
  agg AS (
    SELECT u.gl_id,
           sum(u.actual) AS actual, sum(u.committed) AS committed, sum(u.paid) AS paid,
           sum(u.inv)::int AS inv, sum(u.pr)::int AS pr, sum(u.rc)::int AS rc, sum(u.oth)::int AS oth,
           sum(u.via)::int AS via
    FROM (
      SELECT led.gl_id,
             CASE WHEN led.entry_kind = 'actual' THEN led.amount ELSE 0 END AS actual,
             CASE WHEN led.entry_kind = 'commitment' THEN led.amount ELSE 0 END AS committed,
             0::numeric AS paid,
             (led.source_type = 'invoice')::int AS inv,
             (led.source_type = 'payroll')::int AS pr,
             (led.source_type = 'petty_cash')::int AS rc,
             (led.source_type NOT IN ('invoice', 'payroll', 'petty_cash'))::int AS oth,
             led.via_map::int AS via
      FROM led
      UNION ALL
      SELECT pay.gl_id, 0, 0, pay.amount, 0, 0, 0, 0, 0 FROM pay
    ) u
    GROUP BY u.gl_id
  )
  SELECT g.id, COALESCE(g.code, '—'), COALESCE(g.name, 'Uncategorized'), g.category,
         round(a.actual, 2), round(a.committed, 2), round(a.paid, 2),
         a.inv, a.pr, a.rc, a.oth, a.via
  FROM agg a
  LEFT JOIN public.gl_accounts g ON g.id = a.gl_id
  ORDER BY (g.id IS NULL), g.code;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_gl_account(uuid, text)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_cost_by_gl_account(uuid, date, date)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_gl_account(uuid, text)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cost_by_gl_account(uuid, date, date)  TO authenticated, service_role;
