-- =====================================================================
-- Fix — a new budget draft loses the Top Sheet mapping of every line
--
-- CHANGES AN EXISTING FUNCTION (create_budget_draft). It is the only file in
-- db/pending that does; review it on its own.
--
-- Found while building the budget import: create_budget_draft() copies the
-- active version's lines into the new draft but leaves out four columns —
--     topsheet_code · notes · rebate_eligible · character_id
-- So every draft made from an approved budget has no Top Sheet account on
-- any line. Once that draft is published, the Top Sheet Cost Report puts the
-- whole budget under "unassigned", the cost reports lose their grouping, and
-- the rebate flag and line notes are gone.
--
-- The function below is the existing one, unchanged except for the four
-- columns added to the copy. Same name, arguments, return type, security and
-- grants.
--
-- Rollback: re-run the original definition from
--   supabase/migrations/20260828155312_8d7b3b86-515f-4d03-bfdf-b7a8a2eb194b.sql (section 7).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_budget_draft(_project uuid, _name text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid; _no int; _src uuid; _new uuid;
BEGIN
  SELECT organization_id INTO _org FROM public.projects WHERE id = _project;
  IF NOT public.can_access_project(auth.uid(), _org, _project) THEN
    RAISE EXCEPTION 'Not authorized for this project';
  END IF;
  SELECT COALESCE(max(version_no), 0) + 1 INTO _no FROM public.budget_versions WHERE project_id = _project;
  SELECT id INTO _src FROM public.budget_versions WHERE project_id = _project AND status = 'active' LIMIT 1;

  INSERT INTO public.budget_versions (project_id, organization_id, version_no, version_name, status, created_by)
  VALUES (_project, _org, _no, COALESCE(NULLIF(_name, ''), 'v' || _no || ' (Draft)'), 'draft', auth.uid())
  RETURNING id INTO _new;

  IF _src IS NOT NULL THEN
    INSERT INTO public.budget_lines (
      project_id, organization_id, version_id, header_code, main_code, description, name, "group",
      amount, rate, currency, unit, x, prep, shooting, wrap, excluded,
      topsheet_code, notes, rebate_eligible, character_id            -- were not copied before
    )
    SELECT bl.project_id, bl.organization_id, _new, bl.header_code, bl.main_code, bl.description, bl.name, bl."group",
      bl.amount, bl.rate, bl.currency, bl.unit, bl.x, bl.prep, bl.shooting, bl.wrap, bl.excluded,
      bl.topsheet_code, bl.notes, bl.rebate_eligible, bl.character_id
    FROM public.budget_lines bl WHERE bl.version_id = _src;
  END IF;
  RETURN _new;
END;
$$;
