-- =====================================================================
-- 200 — A row's project always belongs to the row's organization
--
-- Why (security review of 171–198, root cause): can_access_project(uid, org,
-- proj) passes for a member of the project whatever organization id is sent
-- with the row, so every INSERT / UPDATE policy built on it accepted a row
-- with project_id = a project of mine and organization_id = ANOTHER
-- organization. SECURITY DEFINER code that trusts organization_id (approver
-- notifications, vendor / person look-ups, payment snapshots, org-admin
-- reads) then acted inside that other organization. The individual
-- functions were fixed in their own files; this file closes the class.
--
-- What it does
--   public.enforce_project_org_consistency() — BEFORE INSERT OR UPDATE
--   trigger function (SECURITY DEFINER, search_path = public): when
--   project_id is set and that project exists,
--     * organization_id NULL  -> filled with the project's organization;
--     * organization_id <> the project's organization -> the write is refused
--       (SQLSTATE 42501).
--   A project_id that points at no project (a deleted project in a table
--   without a foreign key, e.g. audit_history) is left alone.
--   The trigger "zzz_trg_project_org_consistency" is attached to EVERY base
--   table of schema public that has both organization_id and project_id
--   (uuid) columns — the list is read from information_schema when this file
--   is applied (views are skipped). can_access_project itself is NOT changed.
--   The name sorts after every other BEFORE trigger, so it checks the final
--   row: tables that already stamp organization_id from the project (cost
--   report ETC, overhead staff, funding, treasury …) keep doing so, and a
--   refused write rolls back whatever earlier triggers did.
--   A table created later needs the same trigger: re-run the DO block of
--   section 3 (idempotent).
--
-- IMPORTANT — existing rows
--   The trigger fires on writes only, so applying this file never fails on
--   existing data. But an UPDATE of an EXISTING mismatched row (any column)
--   is refused from then on, so such rows must be corrected first.
--
-- Owner steps
--   1. BEFORE applying, run this read-only check (SQL editor; it only reads
--      and prints one NOTICE per table that has mismatched rows, with up to
--      20 row ids):
--
--        DO $chk$
--        DECLARE t record; n bigint; ids text;
--        BEGIN
--          FOR t IN
--            SELECT c.table_name,
--                   EXISTS (SELECT 1 FROM information_schema.columns i
--                            WHERE i.table_schema = 'public' AND i.table_name = c.table_name
--                              AND i.column_name = 'id') AS has_id
--              FROM information_schema.columns c
--              JOIN information_schema.columns c2
--                ON c2.table_schema = c.table_schema AND c2.table_name = c.table_name
--               AND c2.column_name = 'project_id' AND c2.data_type = 'uuid'
--              JOIN information_schema.tables tb
--                ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
--               AND tb.table_type = 'BASE TABLE'
--             WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
--               AND c.data_type = 'uuid'
--             ORDER BY 1
--          LOOP
--            EXECUTE format(
--              'SELECT count(*), string_agg(x.k, '', '') FILTER (WHERE x.rn <= 20)
--                 FROM (SELECT %s AS k, row_number() OVER () AS rn
--                         FROM public.%I r JOIN public.projects p ON p.id = r.project_id
--                        WHERE r.organization_id IS DISTINCT FROM p.organization_id) x',
--              CASE WHEN t.has_id THEN 'r.id::text' ELSE 'r.ctid::text' END, t.table_name)
--              INTO n, ids;
--            IF n > 0 THEN
--              RAISE NOTICE '% : % mismatched row(s) — %', t.table_name, n, ids;
--            END IF;
--          END LOOP;
--        END $chk$;
--
--      No NOTICE = nothing to fix. Each reported row has a project of one
--      organization and organization_id of another: decide which is right
--      (normally the project's) and correct it AFTER A BACKUP, e.g.
--        UPDATE public.<table> r SET organization_id = p.organization_id
--          FROM public.projects p WHERE p.id = r.project_id AND r.id IN (...);
--      (rows created by an attack should be reviewed / deleted instead).
--   2. Apply this file. It runs the same check and prints the same NOTICEs.
--   3. After applying, the same rows can be listed any time with
--        SELECT * FROM public.project_org_mismatches();   (service role / SQL editor)
--
-- Moving a project to another organization (UPDATE projects SET
-- organization_id) is not handled here: its rows would then all mismatch.
-- The app has no such feature; do not do it by hand.
--
-- Rollback:
--   DO $$ DECLARE t record; BEGIN
--     FOR t IN SELECT tgrelid::regclass AS rel FROM pg_trigger
--               WHERE tgname = 'zzz_trg_project_org_consistency' LOOP
--       EXECUTE format('DROP TRIGGER zzz_trg_project_org_consistency ON %s', t.rel);
--     END LOOP; END $$;
--   DROP FUNCTION public.project_org_mismatches();
--   DROP FUNCTION public.enforce_project_org_consistency();
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_project_org_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = NEW.project_id;
  IF NOT FOUND OR v_org IS NULL THEN
    RETURN NEW;                       -- unknown / deleted project: nothing to compare with
  END IF;
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := v_org;
  ELSIF NEW.organization_id <> v_org THEN
    RAISE EXCEPTION '%: the project belongs to another organization', TG_TABLE_NAME
      USING ERRCODE = '42501',
            HINT = 'organization_id must be the organization of project_id.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_project_org_consistency() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Read-only listing of existing mismatches (owner / service role)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_org_mismatches()
RETURNS TABLE (table_name text, row_key text, organization_id uuid, project_id uuid,
               project_organization_id uuid)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name AS tbl,
           EXISTS (SELECT 1 FROM information_schema.columns i
                    WHERE i.table_schema = 'public' AND i.table_name = c.table_name
                      AND i.column_name = 'id') AS has_id
      FROM information_schema.columns c
      JOIN information_schema.columns c2
        ON c2.table_schema = c.table_schema AND c2.table_name = c.table_name
       AND c2.column_name = 'project_id' AND c2.data_type = 'uuid'
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
       AND tb.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND c.data_type = 'uuid'
     ORDER BY 1
  LOOP
    RETURN QUERY EXECUTE format(
      'SELECT %L::text, %s, r.organization_id, r.project_id, p.organization_id
         FROM public.%I r JOIN public.projects p ON p.id = r.project_id
        WHERE r.organization_id IS DISTINCT FROM p.organization_id',
      t.tbl, CASE WHEN t.has_id THEN 'r.id::text' ELSE 'r.ctid::text' END, t.tbl);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.project_org_mismatches() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_org_mismatches() TO service_role;

-- ---------------------------------------------------------------------
-- 3. Report existing mismatches (never fails), then attach the trigger to
--    every table that has both columns
-- ---------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT m.table_name, count(*) AS n,
                  string_agg(m.row_key, ', ') AS keys
             FROM public.project_org_mismatches() m GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE '200: % has % row(s) whose project belongs to another organization (an UPDATE of them is now refused): %',
      r.table_name, r.n, left(r.keys, 800);
  END LOOP;
END $$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name AS tbl
      FROM information_schema.columns c
      JOIN information_schema.columns c2
        ON c2.table_schema = c.table_schema AND c2.table_name = c.table_name
       AND c2.column_name = 'project_id' AND c2.data_type = 'uuid'
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
       AND tb.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND c.data_type = 'uuid'
     ORDER BY 1
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zzz_trg_project_org_consistency ON public.%I', t.tbl);
    EXECUTE format('CREATE TRIGGER zzz_trg_project_org_consistency
                      BEFORE INSERT OR UPDATE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.enforce_project_org_consistency()', t.tbl);
  END LOOP;
END $$;
