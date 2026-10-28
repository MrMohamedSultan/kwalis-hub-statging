-- =====================================================================
-- 197 — Film Commission rebate: per-project settings, shooting schedule,
--       one eligibility source (QPE), merged rebate report, crew/cast lists
--
-- Spec items R16 R17 R18 R19 R20 R21 R22 E06 E10 E11 E12 D17 D18 N04,
-- client decisions 9 (rate per project, locked like the FX rate),
-- 10 (writers on 1101 = development costs, not eligible) and 11 (one
-- "Film Commission Rebate" report with sections), and the Film Commission
-- rules sheet ("قواعد الهيئة").
--
-- Why
--   * E10 / decision 9  The rebate rate was hard-coded (40% in Reports, 35% on
--     the dashboard). public.project_rebate_settings holds, per project: rebate
--     rate %, rebate cap (SAR, excl. VAT), Film Commission agreement number /
--     date / duration, the official production period, cash limits (% of QPE
--     and per transaction), VAT rate, working days per week + weekly off days.
--     The FX rate stays where it is (projects.fx_rate + fx_rate_audit_log).
--     Only an administrator can change the settings (set_project_rebate_settings,
--     SECURITY DEFINER; the table has no INSERT/UPDATE grant); once approved
--     (approve_project_rebate_settings) a change needs a written reason. Every
--     change lands in audit_history (old/new values, user, reason).
--   * E11  public.project_shoot_days: the actual shoot days (date, status,
--     location, region). A postponed day keeps its first date in
--     original_date. project_shoot_dates() / project_shoot_day_count() are the
--     helpers for this report and for Live Balance.
--   * E12 / E06 / R18 / D17  ONE eligibility source. Each budget code of a
--     project maps either to a Film Commission QPE category (public.qpe_categories)
--     or to a non-eligibility reason (public.budget_code_qpe_map). The system
--     suggests a mapping when a budget line is saved (trigger) or on demand
--     (suggest_qpe_mapping); the accountant approves it (set_qpe_mapping).
--     Writers / script / story rights / research (1000–1199) are suggested
--     as "development costs — not eligible" (decision 10). Every transaction
--     inherits the mapping of its budget code; a single transaction can be
--     overridden with a mandatory reason (public.qpe_overrides,
--     set_qpe_override / clear_qpe_override). public.rebate_transactions() applies
--     the rules once — every section of the report reads it:
--       person (wages, overtime, per diem): Saudi, or resident with a Saudi
--         mother (people.mother_saudi, 172). Other nationalities: not eligible.
--         No nationality recorded: needs review.
--       vendor: no vendor record / no commercial registration (CR) on file ->
--         needs review, NOT eligible by default (E06 — the old "Rule B" said
--         "assumed eligible"); vendor flagged / recorded as non-Saudi -> not
--         eligible.
--       service outside KSA, outside the official production period, flights
--         not on a national carrier, cash for wages / rent / accommodation /
--         flights / insurance / professional services -> not eligible;
--         a cash payment above the per-transaction limit -> needs review.
--       a code whose mapping is only a suggestion -> needs review until the
--         accountant approves it.
--   * R16 / R17  Paid comes from public.payments only (the Payments Register),
--     with the bank transfer reference, date, IBAN and number of payments.
--     payments gains bank_reference and payee_iban (filled on insert from the
--     "ref …" text the instalment trigger writes and from the payee's IBAN).
--     Two figures: expected rebate (on the QPE budget / on contracts) and
--     claimable rebate (paid + eligible + documented);
--     rebate = least(rate × QPE, cap).
--   * R19  Payroll rows carry ref_no (184) as crew member number, the real
--     position, a salary breakdown (basic / housing / overtime / per diem),
--     the related-party answer (missing = flagged), documents, and a working
--     period checked against the official production period.
--   * R20 / R22 / D18  get_film_commission_rebate() returns every section of the
--     merged report: claim summary, general expenses (form 5.6), payroll
--     (form 5.7), budget (estimate vs actual QPE by ATL/BTL/... and by KSA
--     region, SAR excl. VAT, variance = estimate − actual: positive = saving),
--     Saudi headcount and trainees (people.is_trainee), eligibility log,
--     related parties, documents index and change logs.
--   * N04  get_crew_cast_list(): crew / cast list without amounts; phone and
--     e-mail only for users who may edit crew / cast contracts.
--   * E06 in 080: get_qfe_ledger / get_sfc_rebate (080, not used by the app)
--     are redefined with the same vendor-CR rule and the project's rate, so
--     no function in the database still says "assumed eligible".
--
-- ADDITIVE: new tables (5), nullable columns (people.is_trainee,
-- payments.bank_reference, payments.payee_iban), new functions and triggers.
-- Redefined: get_qfe_ledger, get_sfc_rebate (copied from 080, marked "197").
-- No existing client row is rewritten; nothing is backfilled.
--
-- SECURITY: new tables with RLS + policies, SECURITY DEFINER write RPCs that
-- check the caller — apply only after owner approval (SECURITY.md).
--
-- Security review fixes (secfix, before first apply):
--   #7  payments_rebate_defaults looks the payee IBAN up only inside the
--       payment's organization / project (vendors: same project or org-wide);
--   #13 budget_code_qpe_map.budget_code allows 64 characters (was 20; import
--       allows 32) and longer codes are skipped instead of failing the write;
--   #21 qpe_source_project is not executable by authenticated (internal).
--
-- Rollback (manual, in this order):
--   DROP TRIGGER IF EXISTS trg_budget_lines_qpe_suggest ON public.budget_lines;
--   DROP TRIGGER IF EXISTS trg_payments_rebate_defaults ON public.payments;
--   DROP FUNCTION public.get_crew_cast_list(uuid, text), public.get_film_commission_rebate(uuid, text[]),
--     public.rebate_transactions(uuid), public.rebate_amount(numeric, numeric, numeric),
--     public.set_qpe_override(uuid, text, uuid, boolean, text, text, text),
--     public.clear_qpe_override(uuid, text, uuid, text), public.set_qpe_mapping(uuid, text, text, text, text, text),
--     public.suggest_qpe_mapping(uuid), public.budget_lines_qpe_suggest(), public.qpe_suggest(text, text),
--     public.can_approve_qpe(uuid), public.set_project_rebate_settings(uuid, jsonb, text),
--     public.approve_project_rebate_settings(uuid, boolean, text), public.can_admin_rebate_settings(uuid),
--     public.project_shoot_dates(uuid, date, date), public.project_shoot_day_count(uuid, date, date),
--     public.shoot_days_keep_original(), public.count_working_days(date, date, smallint[]),
--     public.rebate_period_position(date, date, date, date), public.budget_cost_group(text),
--     public.is_saudi_nationality(text), public.is_national_airline(text), public.payments_rebate_defaults();
--   DROP TABLE public.qpe_overrides, public.budget_code_qpe_map, public.project_shoot_days,
--     public.project_rebate_settings, public.qpe_categories;
--   re-run db/pending/080 (get_qfe_ledger, get_sfc_rebate);
--   the new columns can stay (nullable, unused).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Small pure helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_saudi_nationality(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(btrim(COALESCE(p, ''))) IN ('saudi', 'saudi arabia', 'ksa', 'sa', 'سعودي', 'السعودية', 'المملكة العربية السعودية')
$$;

-- National carriers (Film Commission: flights are eligible only on national airlines).
CREATE OR REPLACE FUNCTION public.is_national_airline(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(p, '') ~* $r$saudia|saudi arabian airlines|flynas|flyadeal|riyadh air|الخطوط السعودية|السعودية للطيران|طيران ناس|فلاي ناس|فلاي أديل|طيران الرياض$r$
$$;

-- Cost-report category of a budget code (same ranges as the Cost Report).
CREATE OR REPLACE FUNCTION public.budget_cost_group(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN n IS NULL           THEN 'OTHER'
    WHEN n < 2000            THEN 'ATL'
    WHEN n < 5000            THEN 'BTL'
    WHEN n < 5500            THEN 'POST'
    WHEN n < 6000            THEN 'OTHER'   -- 5500 publicity & marketing
    WHEN n < 6100            THEN 'MUSIC'
    WHEN n < 6200            THEN 'VFX'
    ELSE 'OTHER'
  END
  FROM (SELECT CASE WHEN btrim(COALESCE(p_code, '')) ~ '^[0-9]{3,5}' THEN substring(btrim(p_code) FROM '^[0-9]{4}')::int END AS n) x
$$;

-- Days in [from, to] that are not weekly off days (0 = Sunday … 6 = Saturday).
CREATE OR REPLACE FUNCTION public.count_working_days(p_from date, p_to date, p_off smallint[])
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN 0 ELSE
    (SELECT count(*)::int FROM generate_series(p_from, p_to, interval '1 day') d
      WHERE NOT (extract(dow FROM d)::smallint = ANY (COALESCE(p_off, '{}'::smallint[]))))
  END
$$;

-- Where a date range sits against the official production period:
-- inside | partial | outside | unknown (no period or no dates).
CREATE OR REPLACE FUNCTION public.rebate_period_position(p_from date, p_to date, p_pf date, p_pt date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_pf IS NULL OR p_pt IS NULL THEN 'unknown'
    WHEN COALESCE(p_from, p_to) IS NULL THEN 'unknown'
    WHEN COALESCE(p_to, p_from) < p_pf OR COALESCE(p_from, p_to) > p_pt THEN 'outside'
    WHEN COALESCE(p_from, p_to) >= p_pf AND COALESCE(p_to, p_from) <= p_pt THEN 'inside'
    ELSE 'partial'
  END
$$;

-- rebate = least(rate × QPE, cap); NULL when no rate is set.
CREATE OR REPLACE FUNCTION public.rebate_amount(p_rate_pct numeric, p_qpe numeric, p_cap numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p_rate_pct IS NULL THEN NULL
    ELSE round(LEAST(GREATEST(COALESCE(p_qpe, 0), 0) * p_rate_pct / 100,
                     COALESCE(p_cap, 'Infinity'::numeric)), 2) END
$$;

-- ---------------------------------------------------------------------
-- 1. QPE category catalogue (shared, read-only for users)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qpe_categories (
  code           text PRIMARY KEY CHECK (code ~ '^[a-z_]{2,40}$'),
  label_en       text NOT NULL,
  label_ar       text NOT NULL,
  cost_group     text NOT NULL CHECK (cost_group IN ('ATL', 'BTL', 'POST', 'MUSIC', 'VFX', 'OTHER')),
  is_wages       boolean NOT NULL DEFAULT false,
  cash_forbidden boolean NOT NULL DEFAULT false,   -- Film Commission: never paid in cash
  special_rule   text CHECK (special_rule IS NULL OR special_rule IN ('national_airline', 'saudi_insurer')),
  sort_order     integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.qpe_categories IS
  'Film Commission QPE categories (Qualified Production Expenditure). Catalogue; budget codes map to one of these or to a non-eligibility reason (db/pending/197).';
GRANT SELECT ON public.qpe_categories TO authenticated;
GRANT ALL ON public.qpe_categories TO service_role;
REVOKE ALL ON public.qpe_categories FROM anon;
ALTER TABLE public.qpe_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Signed-in users read QPE categories" ON public.qpe_categories;
CREATE POLICY "Signed-in users read QPE categories" ON public.qpe_categories
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Super admins manage QPE categories" ON public.qpe_categories;
CREATE POLICY "Super admins manage QPE categories" ON public.qpe_categories
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

INSERT INTO public.qpe_categories (code, label_en, label_ar, cost_group, is_wages, cash_forbidden, special_rule, sort_order) VALUES
  ('atl_wages',             'ATL wages (Saudi)',                         'أجور فوق الخط (سعوديون)',              'ATL',   true,  true,  NULL, 10),
  ('cast_fees',             'Cast fees (Saudi)',                         'أجور الممثلين (سعوديون)',              'ATL',   true,  true,  NULL, 20),
  ('btl_wages',             'BTL crew wages (Saudi)',                    'أجور الطاقم تحت الخط (سعوديون)',        'BTL',   true,  true,  NULL, 30),
  ('equipment_rental',      'Equipment rental (camera, lighting, grip)', 'تأجير المعدات (كاميرا، إضاءة، معدات)',   'BTL',   false, false, NULL, 40),
  ('set_construction',      'Set construction & art department',         'بناء الديكور وقسم الفن',                'BTL',   false, false, NULL, 50),
  ('wardrobe_makeup',       'Wardrobe, hair & make-up',                  'الأزياء والشعر والمكياج',               'BTL',   false, false, NULL, 60),
  ('locations',             'Location fees',                             'رسوم مواقع التصوير',                    'BTL',   false, true,  NULL, 70),
  ('accommodation',         'Accommodation in KSA',                      'السكن داخل المملكة',                    'BTL',   false, true,  NULL, 80),
  ('transport',             'Local transportation & vehicles',           'النقل المحلي والمركبات',                'BTL',   false, false, NULL, 90),
  ('catering',              'Catering & craft services',                 'الإعاشة والضيافة',                      'BTL',   false, false, NULL, 100),
  ('flights_national',      'Flights (national carrier)',                'الطيران (الناقل الوطني)',               'BTL',   false, true,  'national_airline', 110),
  ('production_office',     'Production office & supplies',              'مكتب الإنتاج والمستلزمات',              'BTL',   false, true,  NULL, 120),
  ('production_services',   'Local production services',                 'خدمات إنتاج محلية',                     'BTL',   false, true,  NULL, 130),
  ('post_production',       'Post-production in KSA',                    'ما بعد الإنتاج داخل المملكة',           'POST',  false, true,  NULL, 140),
  ('music_sound',           'Music & sound',                             'الموسيقى والصوت',                       'MUSIC', false, true,  NULL, 150),
  ('vfx',                   'Visual effects in KSA',                     'المؤثرات البصرية داخل المملكة',         'VFX',   false, true,  NULL, 160),
  ('insurance_saudi',       'Insurance (Saudi insurer)',                 'التأمين (شركة تأمين سعودية)',           'OTHER', false, true,  'saudi_insurer', 170),
  ('professional_services', 'Professional services (legal, accounting)', 'الخدمات المهنية (قانونية، محاسبية)',    'OTHER', false, true,  NULL, 180),
  ('other_qualifying',      'Other qualifying services',                 'خدمات مؤهلة أخرى',                      'OTHER', false, false, NULL, 190)
ON CONFLICT (code) DO NOTHING;

-- Non-eligibility reasons (Film Commission rules sheet) — the CHECK below is the list.
--   development, damage, travel_outside_ksa, government_fees, taxes, finance_interest,
--   deferred_payments, capital_assets, marketing_distribution, software,
--   fx_differences, overheads, flight_change_penalties, foreign_wages, other

-- ---------------------------------------------------------------------
-- 2. E10 — per-project Film Commission settings
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_rebate_settings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id              uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  rebate_rate_pct         numeric(5,2)  CHECK (rebate_rate_pct IS NULL OR (rebate_rate_pct >= 0 AND rebate_rate_pct <= 100)),
  rebate_cap_sar          numeric(16,2) CHECK (rebate_cap_sar IS NULL OR rebate_cap_sar >= 0),       -- excl. VAT
  fc_agreement_no         text CHECK (fc_agreement_no IS NULL OR length(fc_agreement_no) <= 100),
  fc_agreement_date       date,
  fc_agreement_months     integer CHECK (fc_agreement_months IS NULL OR (fc_agreement_months > 0 AND fc_agreement_months <= 120)),
  production_period_from  date,
  production_period_to    date,
  cash_limit_pct_of_qpe   numeric(5,2)  CHECK (cash_limit_pct_of_qpe IS NULL OR (cash_limit_pct_of_qpe >= 0 AND cash_limit_pct_of_qpe <= 100)),
  cash_limit_per_txn_sar  numeric(14,2) CHECK (cash_limit_per_txn_sar IS NULL OR cash_limit_per_txn_sar >= 0),
  vat_rate_pct            numeric(5,2) NOT NULL DEFAULT 15 CHECK (vat_rate_pct >= 0 AND vat_rate_pct <= 100),
  work_days_per_week      smallint NOT NULL DEFAULT 5 CHECK (work_days_per_week BETWEEN 1 AND 7),
  weekly_off_days         smallint[] NOT NULL DEFAULT '{5,6}',   -- 0 = Sunday … 6 = Saturday (KSA: Fri + Sat)
  approved_at             timestamptz,
  approved_by             uuid,
  change_reason           text CHECK (change_reason IS NULL OR length(change_reason) <= 1000),
  created_by              uuid,
  updated_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_rebate_settings_period_chk
    CHECK (production_period_from IS NULL OR production_period_to IS NULL OR production_period_from <= production_period_to),
  CONSTRAINT project_rebate_settings_off_days_chk
    CHECK (weekly_off_days <@ '{0,1,2,3,4,5,6}'::smallint[]
           AND cardinality(weekly_off_days) = 7 - work_days_per_week)
);
COMMENT ON TABLE public.project_rebate_settings IS
  'Film Commission settings per project (E10, decision 9): rate, cap, agreement, official production period, cash limits, VAT, working week. Written only through set_project_rebate_settings / approve_project_rebate_settings (admin). db/pending/197.';
GRANT SELECT ON public.project_rebate_settings TO authenticated;      -- writes: RPCs only
GRANT ALL ON public.project_rebate_settings TO service_role;
REVOKE ALL ON public.project_rebate_settings FROM anon;
ALTER TABLE public.project_rebate_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Project members read rebate settings" ON public.project_rebate_settings;
CREATE POLICY "Project members read rebate settings" ON public.project_rebate_settings
  FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));
DROP TRIGGER IF EXISTS trg_stamp_project_rebate_settings ON public.project_rebate_settings;
CREATE TRIGGER trg_stamp_project_rebate_settings
  BEFORE INSERT OR UPDATE ON public.project_rebate_settings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_project_funding();
DROP TRIGGER IF EXISTS trg_audit_history_project_rebate_settings ON public.project_rebate_settings;
CREATE TRIGGER trg_audit_history_project_rebate_settings
  AFTER INSERT OR UPDATE OR DELETE ON public.project_rebate_settings
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- "Administrator" for these settings: platform super admin, organization
-- owner/admin, or an RBAC admin role in the organization.
CREATE OR REPLACE FUNCTION public.can_admin_rebate_settings(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = p_project_id
       AND (public.is_super_admin(auth.uid())
            OR (p.organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), p.organization_id))
            OR (p.organization_id IS NOT NULL AND public.is_admin(p.organization_id, p.id))))
$$;

-- Save settings. p_values: any subset of the editable columns, e.g.
--   {"rebate_rate_pct": 40, "rebate_cap_sar": 5000000, "production_period_from": "2026-06-01", …}
-- Keys not given keep their value; a key given as null clears it.
CREATE OR REPLACE FUNCTION public.set_project_rebate_settings(p_project_id uuid, p_values jsonb, p_reason text DEFAULT NULL)
RETURNS public.project_rebate_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row   public.project_rebate_settings;
  v_new   public.project_rebate_settings;
  v_org   uuid;
  v_key   text;
  c_keys  constant text[] := ARRAY['rebate_rate_pct','rebate_cap_sar','fc_agreement_no','fc_agreement_date',
    'fc_agreement_months','production_period_from','production_period_to','cash_limit_pct_of_qpe',
    'cash_limit_per_txn_sar','vat_rate_pct','work_days_per_week','weekly_off_days'];
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_admin_rebate_settings(p_project_id) THEN
    RAISE EXCEPTION 'Only an administrator can change the Film Commission settings of this project'
      USING ERRCODE = '42501';
  END IF;
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'set_project_rebate_settings: p_values must be a JSON object' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_values) LOOP
    IF NOT v_key = ANY (c_keys) THEN
      RAISE EXCEPTION 'set_project_rebate_settings: unknown setting "%"', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_reason IS NOT NULL AND length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'Reason is too long (max 1000 characters)' USING ERRCODE = '22023';
  END IF;
  SELECT organization_id INTO v_org FROM public.projects WHERE id = p_project_id;
  SELECT * INTO v_row FROM public.project_rebate_settings WHERE project_id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.project_rebate_settings (organization_id, project_id) VALUES (v_org, p_project_id)
    RETURNING * INTO v_row;
  END IF;
  -- merge: current row + given keys
  v_new := jsonb_populate_record(v_row, p_values
             || jsonb_build_object('change_reason', NULLIF(btrim(COALESCE(p_reason, '')), '')));
  IF v_row.approved_at IS NOT NULL
     AND (to_jsonb(v_new) - ARRAY['change_reason','updated_at','updated_by'])
         IS DISTINCT FROM (to_jsonb(v_row) - ARRAY['change_reason','updated_at','updated_by'])
     AND length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'These settings are approved and locked — give a reason for the change (at least 5 characters)'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.project_rebate_settings s SET
    rebate_rate_pct        = v_new.rebate_rate_pct,
    rebate_cap_sar         = v_new.rebate_cap_sar,
    fc_agreement_no        = NULLIF(btrim(v_new.fc_agreement_no), ''),
    fc_agreement_date      = v_new.fc_agreement_date,
    fc_agreement_months    = v_new.fc_agreement_months,
    production_period_from = v_new.production_period_from,
    production_period_to   = v_new.production_period_to,
    cash_limit_pct_of_qpe  = v_new.cash_limit_pct_of_qpe,
    cash_limit_per_txn_sar = v_new.cash_limit_per_txn_sar,
    vat_rate_pct           = COALESCE(v_new.vat_rate_pct, 15),
    work_days_per_week     = COALESCE(v_new.work_days_per_week, 5),
    weekly_off_days        = COALESCE(v_new.weekly_off_days, '{5,6}'),
    change_reason          = v_new.change_reason
  WHERE s.id = v_row.id
  RETURNING * INTO v_new;
  RETURN v_new;
END;
$$;

-- Approve (lock) or un-approve the settings. Un-approving needs a reason.
CREATE OR REPLACE FUNCTION public.approve_project_rebate_settings(p_project_id uuid, p_approve boolean DEFAULT true, p_reason text DEFAULT NULL)
RETURNS public.project_rebate_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.project_rebate_settings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_admin_rebate_settings(p_project_id) THEN
    RAISE EXCEPTION 'Only an administrator can approve the Film Commission settings' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.project_rebate_settings WHERE project_id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Save the Film Commission settings before approving them' USING ERRCODE = '22023';
  END IF;
  IF p_approve AND v_row.rebate_rate_pct IS NULL THEN
    RAISE EXCEPTION 'Set the rebate rate before approving the settings' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Give a reason to unlock approved settings (at least 5 characters)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.project_rebate_settings SET
    approved_at   = CASE WHEN p_approve THEN now() ELSE NULL END,
    approved_by   = CASE WHEN p_approve THEN auth.uid() ELSE NULL END,
    change_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.can_admin_rebate_settings(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_project_rebate_settings(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_project_rebate_settings(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_admin_rebate_settings(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_project_rebate_settings(uuid, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_project_rebate_settings(uuid, boolean, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. E11 — shooting schedule
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_shoot_days (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  shoot_date      date NOT NULL,
  status          text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'shot', 'postponed', 'cancelled')),
  original_date   date,            -- first planned date, kept when the day is moved
  location        text CHECK (location IS NULL OR length(location) <= 200),
  region          text CHECK (region IS NULL OR length(region) <= 100),   -- region inside KSA
  unit            text CHECK (unit IS NULL OR length(unit) <= 60),        -- main / second unit
  notes           text CHECK (notes IS NULL OR length(notes) <= 1000),
  change_reason   text CHECK (change_reason IS NULL OR length(change_reason) <= 500),
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_shoot_days_active
  ON public.project_shoot_days (project_id, shoot_date, COALESCE(unit, ''))
  WHERE status IN ('planned', 'shot');
CREATE INDEX IF NOT EXISTS idx_project_shoot_days_project ON public.project_shoot_days (project_id, shoot_date);
COMMENT ON TABLE public.project_shoot_days IS
  'E11 actual shooting schedule: one row per shoot day (planned / shot / postponed / cancelled). Read by the Film Commission report and Live Balance through project_shoot_dates(). db/pending/197.';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_shoot_days TO authenticated;
GRANT ALL ON public.project_shoot_days TO service_role;
REVOKE ALL ON public.project_shoot_days FROM anon;
ALTER TABLE public.project_shoot_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Project members read shoot days" ON public.project_shoot_days;
CREATE POLICY "Project members read shoot days" ON public.project_shoot_days
  FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));
DROP POLICY IF EXISTS "Schedule editors insert shoot days" ON public.project_shoot_days;
CREATE POLICY "Schedule editors insert shoot days" ON public.project_shoot_days
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id)
              AND (public.can_edit_timeline(auth.uid(), project_id) OR public.can_edit('production-logistics')));
DROP POLICY IF EXISTS "Schedule editors update shoot days" ON public.project_shoot_days;
CREATE POLICY "Schedule editors update shoot days" ON public.project_shoot_days
  FOR UPDATE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id)
         AND (public.can_edit_timeline(auth.uid(), project_id) OR public.can_edit('production-logistics')))
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id)
              AND (public.can_edit_timeline(auth.uid(), project_id) OR public.can_edit('production-logistics')));
DROP POLICY IF EXISTS "Schedule editors delete shoot days" ON public.project_shoot_days;
CREATE POLICY "Schedule editors delete shoot days" ON public.project_shoot_days
  FOR DELETE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id)
         AND (public.can_edit_timeline(auth.uid(), project_id) OR public.can_edit('production-logistics')));

CREATE OR REPLACE FUNCTION public.shoot_days_keep_original()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_date := COALESCE(NEW.original_date, NEW.shoot_date);
  ELSE
    NEW.original_date := COALESCE(OLD.original_date, OLD.shoot_date);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_stamp_project_shoot_days ON public.project_shoot_days;
CREATE TRIGGER trg_stamp_project_shoot_days
  BEFORE INSERT OR UPDATE ON public.project_shoot_days
  FOR EACH ROW EXECUTE FUNCTION public.stamp_project_funding();
DROP TRIGGER IF EXISTS trg_shoot_days_keep_original ON public.project_shoot_days;
CREATE TRIGGER trg_shoot_days_keep_original
  BEFORE INSERT OR UPDATE ON public.project_shoot_days
  FOR EACH ROW EXECUTE FUNCTION public.shoot_days_keep_original();
DROP TRIGGER IF EXISTS trg_audit_history_project_shoot_days ON public.project_shoot_days;
CREATE TRIGGER trg_audit_history_project_shoot_days
  AFTER INSERT OR UPDATE OR DELETE ON public.project_shoot_days
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- Active shoot days (planned or shot), numbered in date order.
CREATE OR REPLACE FUNCTION public.project_shoot_dates(p_project_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (shoot_date date, day_no integer, status text, location text, region text, unit text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT x.shoot_date, x.day_no, x.status, x.location, x.region, x.unit
  FROM (
    SELECT d.shoot_date, (row_number() OVER (ORDER BY d.shoot_date, d.unit NULLS FIRST))::int AS day_no,
           d.status, d.location, d.region, d.unit
    FROM public.project_shoot_days d
    WHERE d.project_id = p_project_id AND d.status IN ('planned', 'shot')
  ) x
  WHERE (p_from IS NULL OR x.shoot_date >= p_from) AND (p_to IS NULL OR x.shoot_date <= p_to)
  ORDER BY x.shoot_date, x.unit NULLS FIRST
$$;

-- Number of distinct active shoot dates in a range (a second unit on the same day counts once).
CREATE OR REPLACE FUNCTION public.project_shoot_day_count(p_project_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT count(DISTINCT d.shoot_date)::int
  FROM public.project_shoot_days d
  WHERE d.project_id = p_project_id AND d.status IN ('planned', 'shot')
    AND (p_from IS NULL OR d.shoot_date >= p_from) AND (p_to IS NULL OR d.shoot_date <= p_to)
$$;
REVOKE ALL ON FUNCTION public.project_shoot_dates(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.project_shoot_day_count(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_shoot_dates(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.project_shoot_day_count(uuid, date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. E12 — budget code → QPE category / non-eligibility reason
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.budget_code_qpe_map (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  budget_code        text NOT NULL,     -- length check below (secfix #13)
  qpe_category       text REFERENCES public.qpe_categories(code),
  ineligible_reason  text CHECK (ineligible_reason IS NULL OR ineligible_reason IN (
                       'development', 'damage', 'travel_outside_ksa', 'government_fees', 'taxes',
                       'finance_interest', 'deferred_payments', 'capital_assets', 'marketing_distribution',
                       'software', 'fx_differences', 'overheads', 'flight_change_penalties',
                       'foreign_wages', 'other')),
  status             text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'approved')),
  suggestion_basis   text,          -- why the system suggested it (code range / description)
  note               text CHECK (note IS NULL OR length(note) <= 1000),
  change_reason      text CHECK (change_reason IS NULL OR length(change_reason) <= 1000),
  approved_by        uuid,
  approved_at        timestamptz,
  created_by         uuid,
  updated_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_code_qpe_map_one_of CHECK ((qpe_category IS NULL) <> (ineligible_reason IS NULL)),
  CONSTRAINT budget_code_qpe_map_unique UNIQUE (project_id, budget_code)
);
-- secfix #13: budget codes are up to 32 characters on import (190) and free
-- text elsewhere; 64 here, and longer codes are simply not mapped
ALTER TABLE public.budget_code_qpe_map DROP CONSTRAINT IF EXISTS budget_code_qpe_map_budget_code_check;
ALTER TABLE public.budget_code_qpe_map DROP CONSTRAINT IF EXISTS budget_code_qpe_map_budget_code_len;
ALTER TABLE public.budget_code_qpe_map ADD CONSTRAINT budget_code_qpe_map_budget_code_len
  CHECK (length(budget_code) BETWEEN 1 AND 64);
COMMENT ON TABLE public.budget_code_qpe_map IS
  'E12 single eligibility source: each budget code of a project -> Film Commission QPE category or non-eligibility reason. Suggested by the system, approved by the accountant (set_qpe_mapping). Transactions inherit it. db/pending/197.';
GRANT SELECT ON public.budget_code_qpe_map TO authenticated;            -- writes: RPCs / trigger only
GRANT ALL ON public.budget_code_qpe_map TO service_role;
REVOKE ALL ON public.budget_code_qpe_map FROM anon;
ALTER TABLE public.budget_code_qpe_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Project members read QPE mapping" ON public.budget_code_qpe_map;
CREATE POLICY "Project members read QPE mapping" ON public.budget_code_qpe_map
  FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));
DROP TRIGGER IF EXISTS trg_audit_history_budget_code_qpe_map ON public.budget_code_qpe_map;
CREATE TRIGGER trg_audit_history_budget_code_qpe_map
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_code_qpe_map
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- What the system suggests for a budget code (code range first, description second).
CREATE OR REPLACE FUNCTION public.qpe_suggest(p_code text, p_description text DEFAULT NULL)
RETURNS TABLE (category text, reason text, basis text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH x AS (
    SELECT CASE WHEN btrim(COALESCE(p_code, '')) ~ '^[0-9]{4}' THEN substring(btrim(p_code) FROM '^[0-9]{4}')::int END AS n,
           lower(COALESCE(p_description, '')) AS d
  )
  SELECT r.category, r.reason, r.basis FROM x CROSS JOIN LATERAL (
    SELECT * FROM (VALUES
      -- decision 10 + rules sheet: script, writers, story rights, research = development
      (CASE WHEN x.n BETWEEN 1000 AND 1199 THEN NULL END, CASE WHEN x.n BETWEEN 1000 AND 1199 THEN 'development' END, 'code 1000-1199: development / script'),
      (NULL, CASE WHEN x.d ~ $r$writer|script|screenplay|story rights|copyright|option|research|كاتب|سيناريو$r$ THEN 'development' END, 'description: writing / story rights'),
      (NULL, CASE WHEN x.n = 7099 OR x.d ~ $r$withholding|\mvat\M|tax\M|zatca|ضريبة$r$ THEN 'taxes' END, 'taxes / withholding'),
      (NULL, CASE WHEN x.n BETWEEN 5500 AND 5599 OR x.d ~ $r$publicity|marketing|distribution|trailer|poster|تسويق$r$ THEN 'marketing_distribution' END, 'marketing & distribution'),
      (NULL, CASE WHEN x.d ~ $r$interest|finance fee|bank charge|loan|completion bond$r$ OR x.n BETWEEN 7900 AND 7999 THEN 'finance_interest' END, 'finance / completion bond'),
      (NULL, CASE WHEN x.d ~ $r$software|licen[cs]e fee|subscription$r$ THEN 'software' END, 'software'),
      (NULL, CASE WHEN x.d ~ $r$government fee|visa|iqama|permit fee|رسوم حكومية$r$ THEN 'government_fees' END, 'government fees'),
      (NULL, CASE WHEN x.d ~ $r$overhead|head office|corporate$r$ OR x.n BETWEEN 7400 AND 7499 OR x.n BETWEEN 8000 AND 8999 THEN 'overheads' END, 'overheads'),
      (CASE WHEN x.d ~ $r$flight|airfare|air ticket|طيران$r$ THEN 'flights_national' END, NULL, 'description: flights'),
      (CASE WHEN x.d ~ $r$hotel|accommod|lodging|apartment|villa|سكن$r$ THEN 'accommodation' END, NULL, 'description: accommodation'),
      (CASE WHEN x.n BETWEEN 1200 AND 1399 THEN 'atl_wages' END, NULL, 'code 1200-1399: producers / direction'),
      (CASE WHEN x.n BETWEEN 1400 AND 1599 THEN 'cast_fees' END, NULL, 'code 1400-1599: cast'),
      (CASE WHEN x.n BETWEEN 1600 AND 1699 THEN 'transport' END, NULL, 'code 1600: ATL travel & living'),
      (CASE WHEN x.n BETWEEN 2000 AND 2199 THEN 'btl_wages' END, NULL, 'code 2000-2199: production staff / extras'),
      (CASE WHEN x.n BETWEEN 2200 AND 2599 THEN 'set_construction' END, NULL, 'code 2200-2599: art department'),
      (CASE WHEN x.n BETWEEN 2600 AND 2699 THEN 'transport' END, NULL, 'code 2600: picture vehicles'),
      (CASE WHEN x.n BETWEEN 2700 AND 2899 THEN 'wardrobe_makeup' END, NULL, 'code 2700-2899: wardrobe / make-up'),
      (CASE WHEN x.n BETWEEN 2900 AND 3299 OR x.n BETWEEN 3500 AND 3599 THEN 'equipment_rental' END, NULL, 'code 2900-3299 / 3500: grip, light, camera, sound, aerial'),
      (CASE WHEN x.n BETWEEN 3300 AND 3399 THEN 'set_construction' END, NULL, 'code 3300: special effects'),
      (CASE WHEN x.n BETWEEN 3400 AND 3499 THEN 'locations' END, NULL, 'code 3400: locations'),
      (CASE WHEN x.n BETWEEN 3600 AND 3699 THEN 'transport' END, NULL, 'code 3600: transportation'),
      (CASE WHEN x.n BETWEEN 3700 AND 3799 THEN 'production_office' END, NULL, 'code 3700: production office'),
      (CASE WHEN x.n BETWEEN 3800 AND 3899 THEN 'post_production' END, NULL, 'code 3800: lab & media'),
      (CASE WHEN x.n BETWEEN 3900 AND 3999 THEN 'accommodation' END, NULL, 'code 3900: BTL travel & living'),
      (CASE WHEN x.n BETWEEN 4000 AND 4999 THEN 'production_services' END, NULL, 'code 4000-4999: special units / tests / virtual production'),
      (CASE WHEN x.n BETWEEN 5000 AND 5499 THEN 'post_production' END, NULL, 'code 5000-5499: post-production'),
      (CASE WHEN x.n BETWEEN 6000 AND 6099 THEN 'music_sound' END, NULL, 'code 6000: music'),
      (CASE WHEN x.n BETWEEN 6100 AND 6199 THEN 'vfx' END, NULL, 'code 6100: visual effects'),
      (CASE WHEN x.n BETWEEN 7200 AND 7299 OR x.d ~ $r$insur$r$ THEN 'insurance_saudi' END, NULL, 'insurance'),
      (CASE WHEN x.d ~ $r$legal|lawyer|account|audit|محام|محاسب$r$ THEN 'professional_services' END, NULL, 'description: legal / accounting'),
      (CASE WHEN x.n BETWEEN 7000 AND 7099 THEN 'production_office' END, NULL, 'code 7000: administration'),
      ('other_qualifying', NULL, 'no specific rule — review')
    ) v(category, reason, basis)
    WHERE v.category IS NOT NULL OR v.reason IS NOT NULL
    LIMIT 1
  ) r
$$;

CREATE OR REPLACE FUNCTION public.can_approve_qpe(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = p_project_id
       AND public.can_access_project(auth.uid(), p.organization_id, p.id)
       AND (public.can_admin_rebate_settings(p.id) OR public.can_edit('accounting') OR public.can_edit('reports')))
$$;

-- Suggest a mapping for every budget code of the active budget (and every code
-- used by a transaction) that has none yet. Never touches existing rows.
CREATE OR REPLACE FUNCTION public.suggest_qpe_mapping(p_project_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; n integer;
BEGIN
  SELECT organization_id INTO v_org FROM public.projects WHERE id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'suggest_qpe_mapping: access denied' USING ERRCODE = '42501';
  END IF;
  WITH codes AS (
    SELECT bl.main_code AS code, min(bl.description) AS descr FROM public.v_active_budget_lines bl
     WHERE bl.project_id = p_project_id AND btrim(COALESCE(bl.main_code, '')) <> '' GROUP BY 1
    UNION SELECT i.budget_code, NULL FROM public.invoices i WHERE i.project_id = p_project_id AND btrim(COALESCE(i.budget_code, '')) <> ''
    UNION SELECT p.budget_code, NULL FROM public.payroll p WHERE p.project_id = p_project_id AND btrim(COALESCE(p.budget_code, '')) <> ''
    UNION SELECT r.budget_code, NULL FROM public.cash_advance_receipts r WHERE r.project_id = p_project_id AND btrim(COALESCE(r.budget_code, '')) <> ''
  ), one AS (
    SELECT c.code, max(COALESCE(c.descr, mb.description)) AS descr
    FROM codes c LEFT JOIN public.master_budget mb ON mb.budget_code = c.code AND mb.organization_id IS NULL
    GROUP BY c.code
  ), ins AS (
    INSERT INTO public.budget_code_qpe_map (organization_id, project_id, budget_code, qpe_category, ineligible_reason, status, suggestion_basis, created_by)
    SELECT v_org, p_project_id, o.code, s.category, s.reason, 'suggested', s.basis, auth.uid()
    FROM one o CROSS JOIN LATERAL public.qpe_suggest(o.code, o.descr) s
    WHERE length(o.code) <= 64                                           -- secfix #13
    ON CONFLICT (project_id, budget_code) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$$;

-- On budget upload / edit: suggest a mapping for a new code (accountant approves later).
CREATE OR REPLACE FUNCTION public.budget_lines_qpe_suggest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.project_id IS NULL OR btrim(COALESCE(NEW.main_code, '')) = ''
     OR length(NEW.main_code) > 64 THEN                                  -- secfix #13
    RETURN NEW;
  END IF;
  INSERT INTO public.budget_code_qpe_map (organization_id, project_id, budget_code, qpe_category, ineligible_reason, status, suggestion_basis, created_by)
  SELECT p.organization_id, NEW.project_id, NEW.main_code, s.category, s.reason, 'suggested', s.basis, auth.uid()
  FROM public.projects p CROSS JOIN LATERAL public.qpe_suggest(NEW.main_code, NEW.description) s
  WHERE p.id = NEW.project_id AND p.organization_id IS NOT NULL
  ON CONFLICT (project_id, budget_code) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_budget_lines_qpe_suggest ON public.budget_lines;
CREATE TRIGGER trg_budget_lines_qpe_suggest
  AFTER INSERT OR UPDATE OF main_code ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.budget_lines_qpe_suggest();

-- Accountant approves / changes the mapping of one code.
-- Exactly one of p_category / p_reason. Changing an approved mapping needs p_change_reason.
CREATE OR REPLACE FUNCTION public.set_qpe_mapping(
  p_project_id uuid, p_budget_code text, p_category text, p_reason text,
  p_note text DEFAULT NULL, p_change_reason text DEFAULT NULL)
RETURNS public.budget_code_qpe_map
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_old public.budget_code_qpe_map; v_row public.budget_code_qpe_map;
BEGIN
  IF NOT public.can_approve_qpe(p_project_id) THEN
    RAISE EXCEPTION 'You are not allowed to approve the Film Commission eligibility mapping' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_budget_code, '')) = '' OR length(btrim(p_budget_code)) > 64 THEN   -- secfix #13
    RAISE EXCEPTION 'A budget code is required' USING ERRCODE = '22023';
  END IF;
  IF (NULLIF(btrim(COALESCE(p_category, '')), '') IS NULL) = (NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'Choose either a QPE category or a non-eligibility reason' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 1000 OR p_change_reason IS NOT NULL AND length(p_change_reason) > 1000 THEN
    RAISE EXCEPTION 'Text is too long (max 1000 characters)' USING ERRCODE = '22023';
  END IF;
  SELECT organization_id INTO v_org FROM public.projects WHERE id = p_project_id;
  SELECT * INTO v_old FROM public.budget_code_qpe_map
   WHERE project_id = p_project_id AND budget_code = btrim(p_budget_code) FOR UPDATE;
  IF FOUND AND v_old.status = 'approved'
     AND (v_old.qpe_category IS DISTINCT FROM NULLIF(btrim(COALESCE(p_category, '')), '')
          OR v_old.ineligible_reason IS DISTINCT FROM NULLIF(btrim(COALESCE(p_reason, '')), ''))
     AND length(btrim(COALESCE(p_change_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'This code is already approved — give a reason for the change (at least 5 characters)' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.budget_code_qpe_map AS m (organization_id, project_id, budget_code, qpe_category, ineligible_reason,
         status, note, change_reason, approved_by, approved_at, created_by, updated_by, updated_at)
  VALUES (v_org, p_project_id, btrim(p_budget_code), NULLIF(btrim(COALESCE(p_category, '')), ''),
          NULLIF(btrim(COALESCE(p_reason, '')), ''), 'approved', NULLIF(btrim(COALESCE(p_note, '')), ''),
          NULLIF(btrim(COALESCE(p_change_reason, '')), ''), auth.uid(), now(), auth.uid(), auth.uid(), now())
  ON CONFLICT (project_id, budget_code) DO UPDATE SET
    qpe_category = EXCLUDED.qpe_category, ineligible_reason = EXCLUDED.ineligible_reason,
    status = 'approved', note = COALESCE(EXCLUDED.note, m.note), change_reason = EXCLUDED.change_reason,
    approved_by = auth.uid(), approved_at = now(), updated_by = auth.uid(), updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. E12 — per-transaction override (mandatory reason, audited)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qpe_overrides (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_type       text NOT NULL CHECK (source_type IN ('invoice', 'payroll', 'petty_cash', 'overtime', 'per_diem')),
  source_id         uuid NOT NULL,
  eligible          boolean NOT NULL,
  qpe_category      text REFERENCES public.qpe_categories(code),
  ineligible_reason text CHECK (ineligible_reason IS NULL OR ineligible_reason IN (
                      'development', 'damage', 'travel_outside_ksa', 'government_fees', 'taxes',
                      'finance_interest', 'deferred_payments', 'capital_assets', 'marketing_distribution',
                      'software', 'fx_differences', 'overheads', 'flight_change_penalties',
                      'foreign_wages', 'other')),
  reason            text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 1000),
  active            boolean NOT NULL DEFAULT true,
  cleared_reason    text CHECK (cleared_reason IS NULL OR length(cleared_reason) <= 1000),
  set_by            uuid,
  set_at            timestamptz NOT NULL DEFAULT now(),
  cleared_by        uuid,
  cleared_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qpe_overrides_active ON public.qpe_overrides (source_type, source_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_qpe_overrides_project ON public.qpe_overrides (project_id);
COMMENT ON TABLE public.qpe_overrides IS
  'E12 eligibility override of ONE transaction, with a mandatory reason; cleared overrides stay (active = false) for the audit trail. db/pending/197.';
GRANT SELECT ON public.qpe_overrides TO authenticated;                  -- writes: RPCs only
GRANT ALL ON public.qpe_overrides TO service_role;
REVOKE ALL ON public.qpe_overrides FROM anon;
ALTER TABLE public.qpe_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Project members read QPE overrides" ON public.qpe_overrides;
CREATE POLICY "Project members read QPE overrides" ON public.qpe_overrides
  FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));
DROP TRIGGER IF EXISTS trg_audit_history_qpe_overrides ON public.qpe_overrides;
CREATE TRIGGER trg_audit_history_qpe_overrides
  AFTER INSERT OR UPDATE OR DELETE ON public.qpe_overrides
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

CREATE OR REPLACE FUNCTION public.qpe_source_project(p_source_type text, p_source_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE p_source_type
    WHEN 'invoice'    THEN (SELECT project_id FROM public.invoices WHERE id = p_source_id)
    WHEN 'payroll'    THEN (SELECT project_id FROM public.payroll WHERE id = p_source_id)
    WHEN 'petty_cash' THEN (SELECT project_id FROM public.cash_advance_receipts WHERE id = p_source_id)
    WHEN 'overtime'   THEN (SELECT project_id FROM public.overtime_entries WHERE id = p_source_id)
    WHEN 'per_diem'   THEN (SELECT project_id FROM public.per_diem_ledger WHERE id = p_source_id)
  END
$$;
REVOKE ALL ON FUNCTION public.qpe_source_project(text, uuid) FROM PUBLIC, anon, authenticated;   -- secfix #21: internal (DEFINER RPCs)

CREATE OR REPLACE FUNCTION public.set_qpe_override(
  p_project_id uuid, p_source_type text, p_source_id uuid, p_eligible boolean,
  p_category text, p_ineligible_reason text, p_reason text)
RETURNS public.qpe_overrides
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_row public.qpe_overrides;
BEGIN
  IF NOT public.can_approve_qpe(p_project_id) THEN
    RAISE EXCEPTION 'You are not allowed to override Film Commission eligibility' USING ERRCODE = '42501';
  END IF;
  IF public.qpe_source_project(p_source_type, p_source_id) IS DISTINCT FROM p_project_id THEN
    RAISE EXCEPTION 'This transaction does not belong to the project' USING ERRCODE = '22023';
  END IF;
  IF p_eligible IS NULL THEN
    RAISE EXCEPTION 'Choose eligible or not eligible' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'A reason (5 to 1000 characters) is required for an eligibility override' USING ERRCODE = '22023';
  END IF;
  SELECT organization_id INTO v_org FROM public.projects WHERE id = p_project_id;
  UPDATE public.qpe_overrides SET active = false, cleared_by = auth.uid(), cleared_at = now(),
         cleared_reason = 'Replaced by a new override'
   WHERE source_type = p_source_type AND source_id = p_source_id AND active;
  INSERT INTO public.qpe_overrides (organization_id, project_id, source_type, source_id, eligible,
         qpe_category, ineligible_reason, reason, set_by)
  VALUES (v_org, p_project_id, p_source_type, p_source_id, p_eligible,
          CASE WHEN p_eligible THEN NULLIF(btrim(COALESCE(p_category, '')), '') END,
          CASE WHEN NOT p_eligible THEN COALESCE(NULLIF(btrim(COALESCE(p_ineligible_reason, '')), ''), 'other') END,
          btrim(p_reason), auth.uid())
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_qpe_override(p_project_id uuid, p_source_type text, p_source_id uuid, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT public.can_approve_qpe(p_project_id) THEN
    RAISE EXCEPTION 'You are not allowed to override Film Commission eligibility' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'A reason (5 to 1000 characters) is required to remove an override' USING ERRCODE = '22023';
  END IF;
  UPDATE public.qpe_overrides SET active = false, cleared_by = auth.uid(), cleared_at = now(), cleared_reason = btrim(p_reason)
   WHERE project_id = p_project_id AND source_type = p_source_type AND source_id = p_source_id AND active;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.qpe_suggest(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_approve_qpe(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.suggest_qpe_mapping(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_qpe_mapping(uuid, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_qpe_override(uuid, text, uuid, boolean, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_qpe_override(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qpe_suggest(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_approve_qpe(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suggest_qpe_mapping(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_qpe_mapping(uuid, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_qpe_override(uuid, text, uuid, boolean, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_qpe_override(uuid, text, uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. New columns: trainees (headcount), payment reference + IBAN (R16)
-- ---------------------------------------------------------------------
ALTER TABLE public.people   ADD COLUMN IF NOT EXISTS is_trainee     boolean;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS bank_reference text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payee_iban     text;
COMMENT ON COLUMN public.people.is_trainee IS 'Saudi trainee (Film Commission headcount: Saudis employed / Saudi trainees). db/pending/197.';
COMMENT ON COLUMN public.payments.bank_reference IS 'Bank transfer reference number (Film Commission forms 5.6 / 5.7). Filled from the "ref …" note on insert when not given. db/pending/197.';
COMMENT ON COLUMN public.payments.payee_iban IS 'IBAN the money was sent to, captured at payment time from the payee when not given. db/pending/197.';

CREATE OR REPLACE FUNCTION public.payments_rebate_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.bank_reference IS NULL AND NEW.notes IS NOT NULL THEN
    NEW.bank_reference := NULLIF(btrim(substring(NEW.notes FROM '(?:^|·\s*)ref\s+([^·]+?)\s*$')), '');
  END IF;
  IF NEW.payee_iban IS NULL THEN
    -- secfix #7: the payee is looked up only inside the payment's own
    -- organization and project (the trigger is SECURITY DEFINER)
    NEW.payee_iban := CASE NEW.source_type
      WHEN 'payroll' THEN (
        SELECT pe.iban FROM public.payroll p
          JOIN public.people pe ON pe.project_id = p.project_id AND pe.organization_id = p.organization_id
           AND (pe.id::text = p.ref_id OR (p.ref_id !~* '^[0-9a-f]{8}-' AND pe.full_name = p.name))
         WHERE p.id = NEW.source_id
           AND p.organization_id = NEW.organization_id AND p.project_id IS NOT DISTINCT FROM NEW.project_id
         ORDER BY (pe.id::text = p.ref_id) DESC LIMIT 1)
      WHEN 'invoice' THEN (
        SELECT v.iban FROM public.invoices i JOIN public.vendors v
            ON v.organization_id = i.organization_id AND lower(v.name) = lower(i.vendor_name)
           AND (v.project_id IS NULL OR v.project_id = i.project_id)
         WHERE i.id = NEW.source_id
           AND i.organization_id = NEW.organization_id AND i.project_id IS NOT DISTINCT FROM NEW.project_id
         ORDER BY (v.project_id = i.project_id) DESC NULLS LAST, v.created_at LIMIT 1)
      WHEN 'overtime' THEN (
        SELECT pe.iban FROM public.overtime_entries o JOIN public.people pe ON pe.id = o.person_id
         WHERE o.id = NEW.source_id
           AND pe.organization_id = NEW.organization_id AND pe.project_id IS NOT DISTINCT FROM NEW.project_id)
      WHEN 'per_diem' THEN (
        SELECT pe.iban FROM public.per_diem_ledger d JOIN public.people pe ON pe.id = d.person_id
         WHERE d.id = NEW.source_id
           AND pe.organization_id = NEW.organization_id AND pe.project_id IS NOT DISTINCT FROM NEW.project_id)
      ELSE NULL END;
    NEW.payee_iban := NULLIF(btrim(COALESCE(NEW.payee_iban, '')), '');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_payments_rebate_defaults ON public.payments;
CREATE TRIGGER trg_payments_rebate_defaults
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_rebate_defaults();

-- ---------------------------------------------------------------------
-- 7. The single eligibility source: one row per transaction
-- ---------------------------------------------------------------------
-- status: eligible | not_eligible | needs_review
-- reason: key of the rule that decided (translated by the app, rebate.reason.<key>)
-- amount_excl_vat  value of the document (contract value / invoice excl. VAT), SAR
-- actual_excl      incurred (glossary Actual) excl. VAT
-- paid             money out (payments table), incl. VAT, net of WHT
-- paid_excl        the part of the QPE base that is paid: least(base, paid × base / pay basis)
-- claimable_excl   paid_excl when eligible AND documented, else 0
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
  'E12 single Film Commission eligibility source: one row per invoice / approved petty-cash receipt / contract / overtime / per diem with QPE category, status (eligible / not_eligible / needs_review), the deciding rule, paid (payments table), documents and flags. Every section of get_film_commission_rebate reads it. db/pending/197.';

-- ---------------------------------------------------------------------
-- 8. The merged Film Commission Rebate report (decision 11)
-- ---------------------------------------------------------------------
-- p_sections: NULL = everything, else any of
--   settings summary general_expenses payroll budget headcount eligibility_log
--   related_parties documents change_log mapping shoot_days
-- All amounts SAR, excl. VAT unless the key says total / vat / paid.
CREATE OR REPLACE FUNCTION public.get_film_commission_rebate(p_project_id uuid, p_sections text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
DECLARE
  v_org uuid; v_fx numeric; v_unmask boolean; v_contacts boolean;
  s public.project_rebate_settings;
  v_off smallint[]; v_result jsonb;
  want text[] := COALESCE(p_sections, ARRAY['settings','summary','general_expenses','payroll','budget','headcount',
                   'eligibility_log','related_parties','documents','change_log','mapping','shoot_days']);
BEGIN
  SELECT p.organization_id, p.fx_rate INTO v_org, v_fx FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_film_commission_rebate: access denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.project_rebate_settings rs WHERE rs.project_id = p_project_id;
  v_off := COALESCE(s.weekly_off_days, '{5,6}'::smallint[]);
  v_unmask := public.can_edit('reports') OR public.can_approve_qpe(p_project_id);

  WITH tx AS MATERIALIZED (
    SELECT * FROM public.rebate_transactions(p_project_id)
  ),
  lines AS (
    SELECT bl.main_code AS code, bl.description,
           public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap,
                                        bl.unit, bl.currency, bl.excluded, v_fx) AS budget
    FROM public.v_active_budget_lines bl
    WHERE bl.project_id = p_project_id
  ),
  codes AS (
    SELECT c.code, max(c.descr) AS descr, sum(c.budget) AS budget, sum(c.n_tx) AS n_tx
    FROM (
      SELECT l.code, l.description AS descr, l.budget, 0 AS n_tx FROM lines l
      UNION ALL SELECT t.budget_code, NULL, 0, 1 FROM tx t WHERE btrim(COALESCE(t.budget_code, '')) <> ''
    ) c WHERE btrim(COALESCE(c.code, '')) <> ''
    GROUP BY c.code
  ),
  eff AS (   -- effective mapping per code: approved / suggested row, else the live suggestion
    SELECT c.code, c.descr, round(COALESCE(c.budget, 0), 2) AS budget, c.n_tx,
           public.budget_cost_group(c.code) AS grp,
           COALESCE(m.status, 'suggested') AS status, (m.id IS NOT NULL) AS stored,
           CASE WHEN m.id IS NOT NULL THEN m.qpe_category ELSE sg.category END AS category,
           CASE WHEN m.id IS NOT NULL THEN m.ineligible_reason ELSE sg.reason END AS reason,
           COALESCE(m.suggestion_basis, sg.basis) AS basis, m.note, m.approved_by, m.approved_at
    FROM codes c
    LEFT JOIN public.budget_code_qpe_map m ON m.project_id = p_project_id AND m.budget_code = c.code
    LEFT JOIN LATERAL (SELECT * FROM public.qpe_suggest(c.code, c.descr)) sg ON true
  ),
  tot AS (
    SELECT
      COALESCE((SELECT sum(budget) FROM eff), 0) AS budget_total,
      COALESCE((SELECT sum(budget) FROM eff WHERE category IS NOT NULL), 0) AS qpe_budget,
      COALESCE(sum(amount_excl_vat) FILTER (WHERE status = 'eligible'), 0) AS qpe_contracted,
      COALESCE(sum(actual_excl)     FILTER (WHERE status = 'eligible'), 0) AS qpe_actual,
      COALESCE(sum(paid_excl)       FILTER (WHERE status = 'eligible'), 0) AS qpe_paid,
      COALESCE(sum(claimable_excl), 0) AS qpe_claimable,
      COALESCE(sum(amount_excl_vat) FILTER (WHERE status = 'needs_review'), 0) AS needs_review,
      COALESCE(sum(amount_excl_vat) FILTER (WHERE status = 'not_eligible'), 0) AS not_eligible,
      COALESCE(sum(paid_excl) FILTER (WHERE status = 'eligible' AND NOT documented), 0) AS paid_undocumented,
      COALESCE(sum(cash_paid), 0) AS cash_total,
      count(*) FILTER (WHERE s.cash_limit_per_txn_sar IS NOT NULL AND COALESCE(max_cash_payment, 0) > s.cash_limit_per_txn_sar) AS cash_over_txn,
      count(*) AS n_tx,
      count(*) FILTER (WHERE status = 'eligible') AS n_eligible,
      count(*) FILTER (WHERE status = 'needs_review') AS n_review,
      count(*) FILTER (WHERE status = 'not_eligible') AS n_not
    FROM tx
  ),
  pers AS (    -- people of the project with the first contract row per person
    SELECT pe.id, pe.kind, pe.full_name, pe.position, pe.nationality, pe.mother_saudi, pe.id_number, pe.iban,
           pe.start_date, pe.end_date, pe.housing_allowance, pe.related_party, pe.is_trainee,
           pe.contract_path, pe.id_attachment_path
    FROM public.people pe WHERE pe.project_id = p_project_id
  ),
  ppl_tx AS (
    SELECT t.*, row_number() OVER (PARTITION BY t.person_id ORDER BY t.entry_date NULLS LAST, t.source_id) AS rn
    FROM tx t WHERE t.source = 'payroll'
  ),
  extra AS (   -- overtime + per diem per person
    SELECT t.person_id,
           sum(t.amount_excl_vat) FILTER (WHERE t.source = 'overtime') AS overtime,
           sum(t.amount_excl_vat) FILTER (WHERE t.source = 'per_diem') AS per_diem,
           sum(t.paid) AS paid, sum(t.payments_count) AS n,
           string_agg(DISTINCT t.payment_methods, ', ') AS methods,
           string_agg(DISTINCT t.bank_refs, ', ') AS refs,
           max(t.last_payment_date) AS last_date
    FROM tx t WHERE t.source IN ('overtime', 'per_diem') GROUP BY t.person_id
  ),
  payroll_rows AS (
    SELECT t.*, pr.position AS p_position, pr.id_number, pr.iban AS p_iban, pr.start_date, pr.end_date,
           pr.housing_allowance, pr.kind AS p_kind,
           CASE WHEN t.rn = 1 THEN e.overtime END AS ot, CASE WHEN t.rn = 1 THEN e.per_diem END AS pd,
           CASE WHEN t.rn = 1 THEN e.paid END AS e_paid, CASE WHEN t.rn = 1 THEN e.n END AS e_n,
           CASE WHEN t.rn = 1 THEN e.refs END AS e_refs, CASE WHEN t.rn = 1 THEN e.methods END AS e_methods,
           CASE WHEN t.rn = 1 THEN e.last_date END AS e_last,
           GREATEST(pr.start_date, COALESCE(s.production_period_from, pr.start_date)) AS wf,
           LEAST(pr.end_date, COALESCE(s.production_period_to, pr.end_date)) AS wt
    FROM ppl_tx t
    LEFT JOIN pers pr ON pr.id = t.person_id
    LEFT JOIN extra e ON e.person_id = t.person_id
  ),
  ge AS (
    SELECT t.* FROM tx t WHERE t.source IN ('invoice', 'petty_cash')
  )
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'project_id', p_project_id,
    'currency', 'SAR',
    'settings', CASE WHEN 'settings' = ANY (want) THEN jsonb_build_object(
        'configured', s.id IS NOT NULL,
        'rebate_rate_pct', s.rebate_rate_pct, 'rebate_cap_sar', s.rebate_cap_sar,
        'fc_agreement_no', s.fc_agreement_no, 'fc_agreement_date', s.fc_agreement_date,
        'fc_agreement_months', s.fc_agreement_months,
        'production_period_from', s.production_period_from, 'production_period_to', s.production_period_to,
        'cash_limit_pct_of_qpe', s.cash_limit_pct_of_qpe, 'cash_limit_per_txn_sar', s.cash_limit_per_txn_sar,
        'vat_rate_pct', COALESCE(s.vat_rate_pct, 15), 'work_days_per_week', COALESCE(s.work_days_per_week, 5),
        'weekly_off_days', to_jsonb(v_off),
        'approved_at', s.approved_at, 'approved_by_name', public.user_display_name(s.approved_by),
        'fx_rate', v_fx,
        'can_admin', public.can_admin_rebate_settings(p_project_id),
        'can_approve_mapping', public.can_approve_qpe(p_project_id)) END,
    'summary', CASE WHEN 'summary' = ANY (want) THEN (
      SELECT jsonb_build_object(
        'rebate_rate_pct', s.rebate_rate_pct, 'rebate_cap_sar', s.rebate_cap_sar,
        'budget_total', round(t.budget_total, 2),
        'qpe_budget', round(t.qpe_budget, 2),
        'qpe_contracted', round(t.qpe_contracted, 2),
        'qpe_actual', round(t.qpe_actual, 2),
        'qpe_paid', round(t.qpe_paid, 2),
        'qpe_claimable', round(t.qpe_claimable, 2),
        'paid_undocumented', round(t.paid_undocumented, 2),
        'needs_review_total', round(t.needs_review, 2),
        'not_eligible_total', round(t.not_eligible, 2),
        'expected_rebate', public.rebate_amount(s.rebate_rate_pct, t.qpe_budget, s.rebate_cap_sar),
        'expected_rebate_contracts', public.rebate_amount(s.rebate_rate_pct, t.qpe_contracted, s.rebate_cap_sar),
        'claimable_rebate', public.rebate_amount(s.rebate_rate_pct, t.qpe_claimable, s.rebate_cap_sar),
        'cap_reached', s.rebate_cap_sar IS NOT NULL AND s.rebate_rate_pct IS NOT NULL
                       AND t.qpe_budget * s.rebate_rate_pct / 100 > s.rebate_cap_sar,
        'cash_total', round(t.cash_total, 2),
        'cash_pct_of_qpe', CASE WHEN t.qpe_actual > 0 THEN round(t.cash_total * 100 / t.qpe_actual, 2) END,
        'cash_limit_pct_of_qpe', s.cash_limit_pct_of_qpe,
        'cash_limit_breached', s.cash_limit_pct_of_qpe IS NOT NULL AND t.qpe_actual > 0
                               AND t.cash_total * 100 / t.qpe_actual > s.cash_limit_pct_of_qpe,
        'cash_over_txn_limit', t.cash_over_txn,
        'transactions', t.n_tx, 'eligible_count', t.n_eligible,
        'needs_review_count', t.n_review, 'not_eligible_count', t.n_not,
        'codes_total', (SELECT count(*) FROM eff),
        'codes_approved', (SELECT count(*) FROM eff WHERE status = 'approved'),
        'shoot_days', public.project_shoot_day_count(p_project_id),
        'settings_missing', to_jsonb(array_remove(ARRAY[
            CASE WHEN s.rebate_rate_pct IS NULL THEN 'rebate_rate_pct' END,
            CASE WHEN s.rebate_cap_sar IS NULL THEN 'rebate_cap_sar' END,
            CASE WHEN s.production_period_from IS NULL OR s.production_period_to IS NULL THEN 'production_period' END,
            CASE WHEN s.fc_agreement_no IS NULL THEN 'fc_agreement_no' END], NULL)),
        'settings_approved', s.approved_at IS NOT NULL)
      FROM tot t) END,
    'general_expenses', CASE WHEN 'general_expenses' = ANY (want) THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', g.source, 'source_id', g.source_id, 'ref_no', g.ref_no,
        'qpe_category', g.qpe_category, 'description', g.description, 'budget_code', g.budget_code,
        'supplier', g.party, 'supplier_nationality', g.nationality, 'vendor_cr', g.vendor_cr,
        'po_ref', g.po_ref, 'po_total', g.po_total, 'related_party', g.related_party,
        'invoice_no', COALESCE(g.doc_no, g.ref_no), 'invoice_date', g.entry_date, 'currency', g.currency,
        'amount_excl_vat', g.amount_excl_vat, 'vat_amount', g.vat_amount, 'amount_total', g.amount_total,
        'delivery_date', g.period_to,
        'paid', g.paid, 'payment_methods', g.payment_methods, 'payments_count', g.payments_count,
        'bank_refs', g.bank_refs, 'payment_date', g.last_payment_date,
        'documented', g.documented, 'status', g.status, 'reason', g.reason, 'claimable_excl', g.claimable_excl,
        'flags', to_jsonb(g.flags))
        ORDER BY g.entry_date NULLS LAST, g.ref_no)
      FROM ge g), '[]'::jsonb) END,
    'payroll', CASE WHEN 'payroll' = ANY (want) THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source_id', r.source_id, 'person_id', r.person_id, 'crew_no', r.ref_no, 'name', r.party,
        'kind', COALESCE(r.p_kind, r.person_kind), 'position', r.p_position, 'nationality', r.nationality,
        'mother_saudi', r.mother_saudi,
        'id_number', CASE WHEN r.id_number IS NULL THEN NULL WHEN v_unmask THEN r.id_number
                          ELSE '••••' || right(regexp_replace(r.id_number, '\s', '', 'g'), 4) END,
        'related_party', r.related_party, 'budget_code', r.budget_code, 'cost_group', r.cost_group,
        'qpe_category', r.qpe_category,
        'from', r.start_date, 'to', r.end_date,
        'working_days', CASE WHEN r.wf IS NOT NULL AND r.wt IS NOT NULL AND r.wt >= r.wf
                             THEN public.count_working_days(r.wf, r.wt, v_off) END,
        'calendar_days', CASE WHEN r.start_date IS NOT NULL AND r.end_date IS NOT NULL AND r.end_date >= r.start_date
                              THEN r.end_date - r.start_date + 1 END,
        'basic', r.amount_excl_vat,
        'housing', CASE WHEN r.rn = 1 AND COALESCE(r.housing_allowance, 0) > 0 AND r.wf IS NOT NULL AND r.wt >= r.wf
                        THEN round(r.housing_allowance / 30 * (r.wt - r.wf + 1), 2) ELSE 0 END,
        'transport', 0, 'telephone', 0, 'other_allowances', 0,
        'overtime', COALESCE(r.ot, 0), 'per_diem', COALESCE(r.pd, 0),
        'total_salary', r.amount_excl_vat + COALESCE(r.ot, 0) + COALESCE(r.pd, 0)
                        + CASE WHEN r.rn = 1 AND COALESCE(r.housing_allowance, 0) > 0 AND r.wf IS NOT NULL AND r.wt >= r.wf
                               THEN round(r.housing_allowance / 30 * (r.wt - r.wf + 1), 2) ELSE 0 END,
        'actual', r.actual_excl,
        'paid', r.paid + COALESCE(r.e_paid, 0),
        'payment_methods', NULLIF(concat_ws(', ', r.payment_methods, r.e_methods), ''),
        'iban', COALESCE(r.payee_iban, r.p_iban),
        'payments_count', r.payments_count + COALESCE(r.e_n, 0),
        'bank_refs', NULLIF(concat_ws(', ', r.bank_refs, r.e_refs), ''),
        'payment_date', GREATEST(r.last_payment_date, r.e_last),
        'documented', r.documented, 'status', r.status, 'reason', r.reason,
        'claimable_excl', r.claimable_excl,
        'flags', to_jsonb(r.flags || array_remove(ARRAY[
            CASE WHEN r.start_date IS NULL OR r.end_date IS NULL THEN 'working_period_missing' END,
            CASE WHEN r.end_date < r.start_date
                   OR (r.end_date - r.start_date + 1) > COALESCE(s.production_period_to - s.production_period_from + 1, 366)
                 THEN 'working_period_implausible' END,
            CASE WHEN r.in_period = 'outside' THEN 'working_period_outside' END,
            CASE WHEN r.in_period = 'partial' THEN 'working_period_partial' END,
            CASE WHEN r.p_position IS NULL THEN 'position_missing' END], NULL)))
        ORDER BY CASE COALESCE(r.p_kind, r.person_kind) WHEN 'cast' THEN 0 WHEN 'crew' THEN 1 ELSE 2 END, r.ref_no NULLS LAST, r.party)
      FROM payroll_rows r), '[]'::jsonb) END,
    'budget', CASE WHEN 'budget' = ANY (want) THEN jsonb_build_object(
      'by_group', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'group', g.grp,
          'budget_total', round(g.budget_total, 2), 'budget_qpe', round(g.budget_qpe, 2),
          'actual_total', round(g.actual_total, 2), 'actual_qpe', round(g.actual_qpe, 2),
          'variance_qpe', round(g.budget_qpe - g.actual_qpe, 2))
          ORDER BY array_position(ARRAY['ATL','BTL','POST','MUSIC','VFX','OTHER'], g.grp))
        FROM (
          SELECT k.grp,
                 COALESCE((SELECT sum(e.budget) FROM eff e WHERE e.grp = k.grp), 0) AS budget_total,
                 COALESCE((SELECT sum(e.budget) FROM eff e WHERE e.grp = k.grp AND e.category IS NOT NULL), 0) AS budget_qpe,
                 COALESCE((SELECT sum(t.actual_excl) FROM tx t WHERE t.cost_group = k.grp), 0) AS actual_total,
                 COALESCE((SELECT sum(t.actual_excl) FROM tx t WHERE t.cost_group = k.grp AND t.status = 'eligible'), 0) AS actual_qpe
          FROM unnest(ARRAY['ATL','BTL','POST','MUSIC','VFX','OTHER']) k(grp)
        ) g
        WHERE g.budget_total <> 0 OR g.actual_total <> 0), '[]'::jsonb),
      'by_region', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('region', x.region, 'actual_qpe', round(x.q, 2), 'actual_total', round(x.a, 2)) ORDER BY x.region)
        FROM (SELECT COALESCE(NULLIF(btrim(t.spend_city), ''), 'unassigned') AS region,
                     sum(t.actual_excl) FILTER (WHERE t.status = 'eligible') AS q, sum(t.actual_excl) AS a
              FROM tx t
              WHERE t.spend_country IS NULL OR public.is_saudi_nationality(t.spend_country)
              GROUP BY 1) x), '[]'::jsonb),
      'by_code', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('code', e.code, 'description', e.descr, 'group', e.grp,
                 'budget', e.budget, 'eligible', e.category IS NOT NULL,
                 'actual_qpe', round(COALESCE((SELECT sum(t.actual_excl) FROM tx t WHERE t.budget_code = e.code AND t.status = 'eligible'), 0), 2),
                 'actual_total', round(COALESCE((SELECT sum(t.actual_excl) FROM tx t WHERE t.budget_code = e.code), 0), 2))
                 ORDER BY e.code)
        FROM eff e), '[]'::jsonb)) END,
    'headcount', CASE WHEN 'headcount' = ANY (want) THEN (
      SELECT jsonb_build_object(
        'total', count(*),
        'crew', count(*) FILTER (WHERE kind = 'crew'),
        'cast', count(*) FILTER (WHERE kind = 'cast'),
        'saudi', count(*) FILTER (WHERE public.is_saudi_nationality(nationality) OR mother_saudi IS TRUE),
        'saudi_crew', count(*) FILTER (WHERE kind = 'crew' AND (public.is_saudi_nationality(nationality) OR mother_saudi IS TRUE)),
        'saudi_cast', count(*) FILTER (WHERE kind = 'cast' AND (public.is_saudi_nationality(nationality) OR mother_saudi IS TRUE)),
        'saudi_trainees', count(*) FILTER (WHERE (public.is_saudi_nationality(nationality) OR mother_saudi IS TRUE)
                                            AND (is_trainee IS TRUE OR COALESCE(position, '') ~* $r$trainee|intern|متدرب$r$)),
        'nationality_missing', count(*) FILTER (WHERE btrim(COALESCE(nationality, '')) = '' AND mother_saudi IS NOT TRUE))
      FROM pers WHERE kind IN ('crew', 'cast')) END,
    'eligibility_log', CASE WHEN 'eligibility_log' = ANY (want) THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', t.source, 'source_id', t.source_id, 'ref_no', t.ref_no, 'doc_no', t.doc_no, 'date', t.entry_date,
        'party', t.party, 'nationality', t.nationality, 'mother_saudi', t.mother_saudi,
        'budget_code', t.budget_code, 'cost_group', t.cost_group,
        'qpe_category', t.qpe_category, 'mapping_status', t.mapping_status,
        'status', t.status, 'rule', t.rule, 'reason', t.reason,
        'override_reason', t.override_reason, 'override_by_name', public.user_display_name(t.override_by), 'override_at', t.override_at,
        'amount_excl_vat', t.amount_excl_vat, 'actual_excl', t.actual_excl, 'paid', t.paid,
        'claimable_excl', t.claimable_excl, 'in_period', t.in_period, 'flags', to_jsonb(t.flags))
        ORDER BY t.entry_date NULLS LAST, t.source, t.ref_no)
      FROM tx t), '[]'::jsonb) END,
    'related_parties', CASE WHEN 'related_parties' = ANY (want) THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', x.party, 'party_type', x.ptype, 'nationality', x.nat, 'relation', x.rel,
        'transaction_types', x.types, 'total_value', round(x.total, 2), 'transactions', x.n) ORDER BY x.party)
      FROM (SELECT t.party,
                   CASE WHEN t.person_id IS NOT NULL THEN 'individual' ELSE 'company' END AS ptype,
                   max(t.nationality) AS nat, string_agg(DISTINCT t.related_party_note, '; ') AS rel,
                   string_agg(DISTINCT t.source, ', ') AS types, sum(t.amount_total) AS total, count(*) AS n
            FROM tx t WHERE t.related_party IS TRUE GROUP BY 1, 2) x), '[]'::jsonb) END,
    'documents', CASE WHEN 'documents' = ANY (want) THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', t.source, 'source_id', t.source_id, 'ref_no', t.ref_no, 'doc_no', t.doc_no, 'party', t.party,
        'status', t.status,
        'source_document', t.has_source_doc, 'payment_proof', t.has_payment_proof,
        'id_document', t.has_id_doc, 'vendor_cr', t.vendor_cr, 'bank_refs', t.bank_refs,
        'documented', t.documented, 'flags', to_jsonb(t.flags))
        ORDER BY t.documented, t.source, t.ref_no)
      FROM tx t), '[]'::jsonb) END,
    'mapping', CASE WHEN 'mapping' = ANY (want) THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', e.code, 'description', e.descr, 'group', e.grp, 'budget', e.budget, 'transactions', e.n_tx,
        'status', e.status, 'stored', e.stored, 'qpe_category', e.category, 'ineligible_reason', e.reason,
        'basis', e.basis, 'note', e.note, 'approved_at', e.approved_at,
        'approved_by_name', public.user_display_name(e.approved_by)) ORDER BY e.code)
      FROM eff e), '[]'::jsonb) END,
    'shoot_days', CASE WHEN 'shoot_days' = ANY (want) THEN COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.shoot_date) FROM public.project_shoot_dates(p_project_id) d), '[]'::jsonb) END,
    'change_log', CASE WHEN 'change_log' = ANY (want) THEN COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.changed_at DESC)
      FROM (
        SELECT * FROM (
          SELECT ah.created_at AS changed_at,
                 CASE ah.table_name
                   WHEN 'project_rebate_settings' THEN 'settings'
                   WHEN 'project_shoot_days'      THEN 'schedule'
                   WHEN 'budget_code_qpe_map'     THEN 'eligibility_mapping'
                   WHEN 'qpe_overrides'           THEN 'eligibility_override'
                   WHEN 'people'                  THEN 'crew_cast'
                 END AS area,
                 lower(ah.operation) AS operation,
                 COALESCE(ah.new_row->>'budget_code', ah.old_row->>'budget_code',
                          ah.new_row->>'shoot_date', ah.old_row->>'shoot_date',
                          ah.new_row->>'full_name', ah.old_row->>'full_name',
                          ah.new_row->>'source_type', '') AS subject,
                 ah.changed_fields - ARRAY['updated_at','updated_by','created_at','created_by'] AS changes,
                 public.user_display_name(ah.actor_id) AS user_name,
                 COALESCE(ah.new_row->>'change_reason', ah.new_row->>'reason', ah.new_row->>'cleared_reason') AS reason
          FROM public.audit_history ah
          WHERE ah.project_id = p_project_id
            AND ah.table_name IN ('project_rebate_settings', 'project_shoot_days', 'budget_code_qpe_map', 'qpe_overrides', 'people')
            AND (ah.table_name <> 'people' OR ah.operation <> 'UPDATE'
                 OR ah.changed_fields ?| ARRAY['position', 'start_date', 'end_date', 'nationality', 'mother_saudi', 'related_party', 'kind'])
          UNION ALL
          SELECT b.changed_at, 'budget', lower(b.operation), concat_ws(' ', b.budget_code, b.description),
                 jsonb_build_object('total_sar', jsonb_build_object('from', b.before_sar, 'to', b.after_sar)),
                 b.actor_name, b.reason
          FROM public.v_budget_change_log b WHERE b.project_id = p_project_id
          UNION ALL
          SELECT f.changed_at, 'fx_rate', 'update', concat(f.base_currency, '/', f.target_currency),
                 jsonb_build_object('fx_rate', jsonb_build_object('from', f.previous_rate, 'to', f.new_rate)),
                 public.user_display_name(f.changed_by), f.reason
          FROM public.fx_rate_audit_log f WHERE f.project_id = p_project_id
        ) u
        ORDER BY u.changed_at DESC
        LIMIT 5000
      ) c), '[]'::jsonb) END
  )) INTO v_result;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_film_commission_rebate(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_film_commission_rebate(uuid, text[]) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_film_commission_rebate(uuid, text[]) IS
  'Film Commission Rebate report (decision 11): claim summary, general expenses (form 5.6), payroll (form 5.7), budget (ATL/BTL, region), headcount, eligibility log, related parties, documents index, change log, mapping, shoot days — all from rebate_transactions(). SAR. db/pending/197.';

-- ---------------------------------------------------------------------
-- 9. N04 — Crew List / Cast List (no amounts)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_crew_cast_list(p_project_id uuid, p_kind text)
RETURNS TABLE (
  person_id uuid, ref_no text, full_name text, "position" text, character_name text,
  department_code text, cost_group text, nationality text, is_saudi boolean, mother_saudi boolean,
  is_trainee boolean, phone text, email text, start_date date, end_date date, contacts_visible boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE v_org uuid; v_contacts boolean;
BEGIN
  IF p_kind NOT IN ('crew', 'cast') THEN
    RAISE EXCEPTION 'get_crew_cast_list: p_kind must be crew or cast' USING ERRCODE = '22023';
  END IF;
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_crew_cast_list: access denied' USING ERRCODE = '42501';
  END IF;
  v_contacts := public.can_admin_rebate_settings(p_project_id)
                OR public.can_edit(CASE WHEN p_kind = 'cast' THEN 'cast-contracts' ELSE 'crew-contracts' END);
  RETURN QUERY
  SELECT pe.id,
         (SELECT string_agg(pr.ref_no, ', ' ORDER BY pr.ref_no) FROM public.payroll pr
           WHERE pr.project_id = p_project_id AND pr.ref_id = pe.id::text AND pr.ref_no IS NOT NULL),
         pe.full_name, pe.position, pe."character",
         CASE WHEN c.code ~ '^[0-9]{4}' THEN substring(c.code FROM '^[0-9]{2}') || '00' END,
         CASE WHEN c.code IS NULL THEN CASE WHEN pe.kind = 'cast' THEN 'ATL' END
              ELSE public.budget_cost_group(c.code) END,
         pe.nationality, public.is_saudi_nationality(pe.nationality), pe.mother_saudi, pe.is_trainee,
         CASE WHEN v_contacts THEN pe.phone_number END,
         CASE WHEN v_contacts THEN pe.email END,
         pe.start_date, pe.end_date, v_contacts
  FROM public.people pe
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      (SELECT pr.budget_code FROM public.payroll pr
        WHERE pr.project_id = p_project_id AND pr.ref_id = pe.id::text AND pr.budget_code IS NOT NULL
        ORDER BY pr.created_at LIMIT 1),
      (SELECT bl.main_code FROM public.budget_lines bl WHERE bl.id = pe.linked_budget_line_id)) AS code
  ) c ON true
  WHERE pe.project_id = p_project_id AND pe.kind = p_kind
  ORDER BY 6 NULLS LAST, pe.full_name;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_crew_cast_list(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crew_cast_list(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. 080 functions: same vendor rule (E06) and the project's rate (E10)
--     Copied from db/pending/080; changed lines marked "197".
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
        -- 197 (E06): a vendor without a commercial registration on file needs review: not eligible
        WHEN btrim(COALESCE(inv.cr_no, '')) = '' THEN false
        WHEN btrim(COALESCE(inv.v_nat, '')) <> ''
          THEN lower(btrim(inv.v_nat)) IN ('saudi', 'saudi arabia', 'ksa')
        ELSE true   -- 197: CR on file, nationality not recorded = Saudi registration
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
                  THEN 'Manual override — accountant set QPE = '
                       || CASE WHEN q.qfe THEN 'Yes' ELSE 'No' END
                       || ' (the rules would have said ' || CASE WHEN r.auto_qfe THEN 'Yes' ELSE 'No' END || ')'
                WHEN r.auto_rule = 'C' THEN 'Rule C — service rendered outside KSA is never eligible'
                WHEN r.auto_rule = 'A' THEN 'Rule A — logistics/accommodation follows beneficiary nationality (' || r.b_nat || ')'
                WHEN COALESCE(r.is_non_saudi_vendor, false) THEN 'Rule B — vendor is marked non-Saudi'
                -- 197 (E06)
                WHEN btrim(COALESCE(r.cr_no, '')) = '' THEN 'Rule B — vendor has no commercial registration on file; needs review (not eligible until confirmed)'
                WHEN btrim(COALESCE(r.v_nat, '')) <> '' THEN 'Rule B — follows vendor nationality (' || btrim(r.v_nat) || ')'
                ELSE 'Rule B — vendor has a commercial registration on file (KSA)'
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
-- 197: p_rebate_rate defaults to the project's rate (project_rebate_settings); NULL when not set.
CREATE OR REPLACE FUNCTION public.get_sfc_rebate(
  p_project_id  uuid,
  p_from        date    DEFAULT NULL,
  p_to          date    DEFAULT NULL,
  p_rebate_rate numeric DEFAULT NULL   -- 197: NULL = the project's rate (project_rebate_settings)
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
  -- 197: the project's own rate (decision 9) unless one is passed
  IF p_rebate_rate IS NULL THEN
    SELECT rs.rebate_rate_pct / 100 INTO p_rebate_rate FROM public.project_rebate_settings rs WHERE rs.project_id = p_project_id;
  END IF;
  IF p_rebate_rate IS NOT NULL AND (p_rebate_rate < 0 OR p_rebate_rate > 1) THEN
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

