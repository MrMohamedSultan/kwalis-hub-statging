-- =====================================================================
-- SECURITY — restore security_invoker on eight reporting views
--
-- SECURITY CHANGE: per SECURITY.md this is a proposal. Apply only after
-- the owner approves it.
--
-- Problem
--   Migration 20260828155312 re-created these views with
--   CREATE OR REPLACE VIEW and no WITH (security_invoker = on). In Postgres
--   that resets the view options, so the views run with their owner's
--   rights and skip row-level security. They are granted to `authenticated`,
--   so a signed-in user of one company can read another company's budget
--   through them, although the base tables refuse the same read.
--
-- Check first (read-only). A view listed here with empty reloptions is exposed:
--   select relname, reloptions from pg_class
--   where relkind = 'v' and relnamespace = 'public'::regnamespace order by 1;
--
-- Fix: metadata only. No data, column or definition changes.
--
-- Rollback (re-opens the hole — only to diagnose a regression):
--   ALTER VIEW public.<name> RESET (security_invoker);
-- =====================================================================
ALTER VIEW public.v_active_budget_lines    SET (security_invoker = on);
ALTER VIEW public.v_budget_code_position   SET (security_invoker = on);
ALTER VIEW public.v_project_position       SET (security_invoker = on);
ALTER VIEW public.v_budget_line_financials SET (security_invoker = on);
ALTER VIEW public.budget_line_actuals      SET (security_invoker = on);
ALTER VIEW public.v_paid_by_code           SET (security_invoker = on);
ALTER VIEW public.v_source_totals_by_code  SET (security_invoker = on);
ALTER VIEW public.v_overtime_by_code       SET (security_invoker = on);

-- These views hold tenant data and have no public-read policy: anon must
-- not hold a grant on them at all.
REVOKE ALL ON public.v_active_budget_lines, public.v_budget_code_position,
              public.v_project_position, public.v_budget_line_financials,
              public.budget_line_actuals, public.v_paid_by_code,
              public.v_source_totals_by_code, public.v_overtime_by_code
  FROM anon;
