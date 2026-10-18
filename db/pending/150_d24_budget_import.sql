-- =====================================================================
-- D24 — budget import: preview first, then commit into a DRAFT version
--   fn    public.import_try_numeric(text)
--   fn    public.import_budget_validate(project, lines)      row-by-row checks
--   RPC   public.import_budget_preview(project, lines)       nothing is written
--   RPC   public.import_budget_commit(project, lines, name, skip_duplicates)
--
-- The audit log on the live platform shows 24 failed imports and 39 parse
-- errors: the browser parses the Excel file and writes rows straight into
-- budget_lines. This moves the checking into the database:
--
--   1. the browser reads the file and sends the rows as JSON;
--   2. import_budget_preview returns, for EVERY row, ok / warning / error
--      with the reason, plus the totals — and writes nothing;
--   3. import_budget_commit re-runs the same checks, refuses the whole file
--      if any row has an error, and otherwise writes the rows into a NEW
--      draft budget version. It never touches the active (approved) version;
--      publishing the draft stays the separate, existing step
--      (publish_budget_version).
--
-- One row of p_lines:
--   { "row": 12,                      -- row number in the file (for messages)
--     "header_code": "1100", "main_code": "1101", "description": "Head Writer",
--     "name": "...", "group": "ATL", "topsheet_code": "1100",
--     "amount": 1, "rate": 30000, "x": 1, "unit": "Package",
--     "prep": 0, "shooting": 0, "wrap": 0, "currency": "USD",
--     "notes": "...", "excluded": false }
--
-- Blocking errors : missing code or description · a value that is not a
--                   number · negative numbers · more than 2 decimals on money ·
--                   unknown currency · a code that is a header in the chart
-- Warnings        : code not in the master chart (same non-blocking warning the
--                   upload screen shows today) · unknown top sheet account ·
--                   a row identical to an earlier row (duplicate)
-- Duplicates are skipped on commit unless p_skip_duplicates is false.
--
-- ADDITIVE: four functions. No table, view or existing function is changed.
-- Rollback:
--   DROP FUNCTION public.import_budget_commit(uuid, jsonb, text, boolean);
--   DROP FUNCTION public.import_budget_preview(uuid, jsonb);
--   DROP FUNCTION public.import_budget_validate(uuid, jsonb);
--   DROP FUNCTION public.import_try_numeric(text);
-- =====================================================================

-- text -> numeric, NULL when it is not a plain number (never raises)
CREATE OR REPLACE FUNCTION public.import_try_numeric(p text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE v text := replace(btrim(COALESCE(p, '')), ',', '');
BEGIN
  IF v = '' OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RETURN NULL;
  END IF;
  RETURN v::numeric;
END;
$$;

-- ---------------------------------------------------------------------
-- import_budget_validate — one output row per input row
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_budget_validate(p_project_id uuid, p_lines jsonb)
RETURNS TABLE (
  ord            integer,   -- position in the array (1-based)
  row_no         integer,   -- "row" given by the caller, else ord
  status         text,      -- ok | warning | error
  messages       text[],
  duplicate_of   integer,   -- row_no of the earlier identical row
  header_code    text,
  main_code      text,
  description    text,
  name           text,
  "group"        text,
  topsheet_code  text,
  amount         numeric,
  rate           numeric,
  x              numeric,
  unit           text,
  prep           numeric,
  shooting       numeric,
  wrap           numeric,
  currency       text,
  notes          text,
  excluded       boolean,
  line_total_sar numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org uuid; v_fx numeric;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'budget import: p_lines must be a JSON array of rows' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) > 20000 THEN
    RAISE EXCEPTION 'budget import: too many rows (% > 20000)', jsonb_array_length(p_lines) USING ERRCODE = '22023';
  END IF;
  SELECT p.organization_id, p.fx_rate INTO v_org, v_fx FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'budget import: access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH raw AS (
    SELECT e.ord::int AS ord, e.elem
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS e(elem, ord)
  ),
  parsed AS (
    SELECT r.ord,
           COALESCE(public.import_try_numeric(r.elem->>'row')::int, r.ord) AS row_no,
           jsonb_typeof(r.elem) = 'object'                       AS is_object,
           NULLIF(btrim(r.elem->>'header_code'), '')             AS header_code,
           NULLIF(btrim(r.elem->>'main_code'), '')               AS main_code,
           NULLIF(btrim(r.elem->>'description'), '')             AS description,
           NULLIF(btrim(r.elem->>'name'), '')                    AS name,
           NULLIF(btrim(r.elem->>'group'), '')                   AS grp,
           NULLIF(btrim(r.elem->>'topsheet_code'), '')           AS topsheet_code,
           NULLIF(btrim(r.elem->>'unit'), '')                    AS unit,
           upper(NULLIF(btrim(r.elem->>'currency'), ''))         AS currency,
           NULLIF(btrim(r.elem->>'notes'), '')                   AS notes,
           COALESCE(lower(r.elem->>'excluded') IN ('true', 't', '1', 'yes'), false) AS excluded,
           -- raw text of every numeric field, and its parsed value
           NULLIF(btrim(r.elem->>'amount'), '')   AS t_amount,   public.import_try_numeric(r.elem->>'amount')   AS amount,
           NULLIF(btrim(r.elem->>'rate'), '')     AS t_rate,     public.import_try_numeric(r.elem->>'rate')     AS rate,
           NULLIF(btrim(r.elem->>'x'), '')        AS t_x,        public.import_try_numeric(r.elem->>'x')        AS x,
           NULLIF(btrim(r.elem->>'prep'), '')     AS t_prep,     public.import_try_numeric(r.elem->>'prep')     AS prep,
           NULLIF(btrim(r.elem->>'shooting'), '') AS t_shooting, public.import_try_numeric(r.elem->>'shooting') AS shooting,
           NULLIF(btrim(r.elem->>'wrap'), '')     AS t_wrap,     public.import_try_numeric(r.elem->>'wrap')     AS wrap
    FROM raw r
  ),
  master AS (
    SELECT mb.budget_code AS code,
           bool_or(COALESCE(mb.is_header, false)) AS is_header,
           min(mb.topsheet_code) AS topsheet_code
    FROM public.master_budget mb GROUP BY mb.budget_code
  ),
  -- identical rows: everything that defines the line is the same
  keyed AS (
    SELECT p.*,
           md5(concat_ws('|', p.header_code, p.main_code, lower(COALESCE(p.description, '')), lower(COALESCE(p.name, '')),
                         p.amount, p.rate, p.x, lower(COALESCE(p.unit, '')), p.prep, p.shooting, p.wrap,
                         COALESCE(p.currency, 'USD'), p.excluded)) AS k
    FROM parsed p
  ),
  dup AS (
    SELECT k.*, first_value(k.row_no) OVER (PARTITION BY k.k ORDER BY k.ord) AS first_row,
           row_number() OVER (PARTITION BY k.k ORDER BY k.ord) AS rn
    FROM keyed k
  ),
  checked AS (
    SELECT d.*, m.code IS NOT NULL AS in_master, COALESCE(m.is_header, false) AS code_is_header,
           m.topsheet_code AS master_topsheet,
           (ts.code IS NOT NULL) AS topsheet_known,
           array_remove(ARRAY[
             CASE WHEN NOT d.is_object THEN 'row is not an object' END,
             CASE WHEN d.main_code IS NULL THEN 'budget code is missing' END,
             CASE WHEN d.main_code IS NOT NULL AND d.main_code !~ '^[0-9A-Za-z._-]{1,32}$'
                    THEN 'budget code "' || left(d.main_code, 40) || '" has invalid characters' END,
             CASE WHEN d.description IS NULL THEN 'description is missing' END,
             CASE WHEN length(COALESCE(d.description, '')) > 500 THEN 'description is longer than 500 characters' END,
             CASE WHEN d.t_amount   IS NOT NULL AND d.amount   IS NULL THEN 'amount "'   || left(d.t_amount, 30)   || '" is not a number' END,
             CASE WHEN d.t_rate     IS NOT NULL AND d.rate     IS NULL THEN 'rate "'     || left(d.t_rate, 30)     || '" is not a number' END,
             CASE WHEN d.t_x        IS NOT NULL AND d.x        IS NULL THEN 'x "'        || left(d.t_x, 30)        || '" is not a number' END,
             CASE WHEN d.t_prep     IS NOT NULL AND d.prep     IS NULL THEN 'prep "'     || left(d.t_prep, 30)     || '" is not a number' END,
             CASE WHEN d.t_shooting IS NOT NULL AND d.shooting IS NULL THEN 'shooting "' || left(d.t_shooting, 30) || '" is not a number' END,
             CASE WHEN d.t_wrap     IS NOT NULL AND d.wrap     IS NULL THEN 'wrap "'     || left(d.t_wrap, 30)     || '" is not a number' END,
             CASE WHEN LEAST(COALESCE(d.amount, 0), COALESCE(d.rate, 0), COALESCE(d.x, 0), COALESCE(d.prep, 0),
                             COALESCE(d.shooting, 0), COALESCE(d.wrap, 0)) < 0 THEN 'negative numbers are not allowed' END,
             CASE WHEN d.rate IS NOT NULL AND d.rate <> round(d.rate, 2) THEN 'rate has more than 2 decimals' END,
             CASE WHEN d.currency IS NOT NULL AND d.currency NOT IN ('SAR', 'USD')
                    THEN 'currency "' || left(d.currency, 10) || '" is not SAR or USD' END,
             CASE WHEN COALESCE(m.is_header, false) THEN 'code ' || d.main_code || ' is a header account — use one of its detail codes' END
           ], NULL) AS errs,
           array_remove(ARRAY[
             CASE WHEN d.main_code IS NOT NULL AND m.code IS NULL
                    THEN 'code ' || d.main_code || ' is not in the master chart of accounts' END,
             CASE WHEN d.topsheet_code IS NOT NULL AND ts.code IS NULL
                    THEN 'top sheet account ' || d.topsheet_code || ' does not exist' END,
             CASE WHEN d.rn > 1 THEN 'identical to row ' || d.first_row || ' (duplicate)' END,
             CASE WHEN d.currency IS NULL THEN 'no currency given — treated as USD' END
           ], NULL) AS warns
    FROM dup d
    LEFT JOIN master m ON m.code = d.main_code
    LEFT JOIN public.budget_topsheet_accounts ts ON ts.code = d.topsheet_code
  )
  SELECT c.ord, c.row_no,
         CASE WHEN cardinality(c.errs) > 0 THEN 'error'
              WHEN cardinality(c.warns) > 0 THEN 'warning' ELSE 'ok' END,
         c.errs || c.warns,
         CASE WHEN c.rn > 1 THEN c.first_row END,
         c.header_code, c.main_code, c.description, c.name, c.grp,
         -- top sheet account: the one given when it exists, else the master chart's
         CASE WHEN c.topsheet_known THEN c.topsheet_code ELSE c.master_topsheet END,
         COALESCE(c.amount, 0), COALESCE(c.rate, 0), COALESCE(c.x, 0), c.unit,
         COALESCE(c.prep, 0), COALESCE(c.shooting, 0), COALESCE(c.wrap, 0),
         COALESCE(c.currency, 'USD'), c.notes, c.excluded,
         CASE WHEN cardinality(c.errs) = 0
                THEN public.budget_line_total_sar(COALESCE(c.amount, 0), COALESCE(c.rate, 0), COALESCE(c.x, 0),
                                                  COALESCE(c.prep, 0), COALESCE(c.shooting, 0), COALESCE(c.wrap, 0),
                                                  c.unit, COALESCE(c.currency, 'USD'), c.excluded, v_fx) END
  FROM checked c
  ORDER BY c.ord;
END;
$$;

-- ---------------------------------------------------------------------
-- import_budget_preview — what would happen; writes nothing
-- ---------------------------------------------------------------------
-- {
--   "summary": { rows, ok, warnings, errors, duplicates, importable,
--                total_sar, fx_rate, total_usd, unknown_codes: [...],
--                active_version: { id, name } | null, can_commit },
--   "rows": [ { row, status, messages, duplicate_of, main_code, description, line_total_sar } ]
-- }
-- total_* count the rows a commit would write (errors and duplicates excluded).
CREATE OR REPLACE FUNCTION public.import_budget_preview(p_project_id uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_result jsonb; v_fx numeric;
BEGIN
  SELECT COALESCE(NULLIF(p.fx_rate, 0), 3.75) INTO v_fx FROM public.projects p WHERE p.id = p_project_id;

  WITH v AS (SELECT * FROM public.import_budget_validate(p_project_id, p_lines)),
  good AS (SELECT * FROM v WHERE v.status <> 'error' AND v.duplicate_of IS NULL)
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'rows',        (SELECT count(*) FROM v),
      'ok',          (SELECT count(*) FROM v WHERE v.status = 'ok'),
      'warnings',    (SELECT count(*) FROM v WHERE v.status = 'warning'),
      'errors',      (SELECT count(*) FROM v WHERE v.status = 'error'),
      'duplicates',  (SELECT count(*) FROM v WHERE v.duplicate_of IS NOT NULL),
      'importable',  (SELECT count(*) FROM good),
      'total_sar',   round(COALESCE((SELECT sum(good.line_total_sar) FROM good), 0), 2),
      'fx_rate',     v_fx,
      'total_usd',   round(COALESCE((SELECT sum(good.line_total_sar) FROM good), 0) / v_fx, 2),
      'unknown_codes', COALESCE((
          SELECT jsonb_agg(DISTINCT v.main_code ORDER BY v.main_code)
          FROM v WHERE v.main_code IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.master_budget mb WHERE mb.budget_code = v.main_code)), '[]'::jsonb),
      'active_version', (SELECT jsonb_build_object('id', bv.id, 'name', bv.version_name)
                         FROM public.budget_versions bv
                         WHERE bv.project_id = p_project_id AND bv.status = 'active' LIMIT 1),
      'can_commit',  (SELECT count(*) = 0 FROM v WHERE v.status = 'error') AND (SELECT count(*) > 0 FROM good)
    ),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'row', v.row_no, 'status', v.status, 'messages', to_jsonb(v.messages),
                'duplicate_of', v.duplicate_of, 'main_code', v.main_code,
                'description', v.description, 'line_total_sar', round(v.line_total_sar, 2)) ORDER BY v.ord)
              FROM v), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------
-- import_budget_commit — all or nothing, into a new DRAFT version
-- ---------------------------------------------------------------------
-- Needs Edit on the "budget" module. Returns
--   { version_id, version_name, inserted, skipped_duplicates, total_sar, total_usd }
CREATE OR REPLACE FUNCTION public.import_budget_commit(
  p_project_id      uuid,
  p_lines           jsonb,
  p_version_name    text    DEFAULT NULL,
  p_skip_duplicates boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org uuid; v_fx numeric; v_no int; v_version uuid; v_name text;
  v_errors int; v_first text; v_rows int; v_inserted int; v_skipped int; v_total numeric;
BEGIN
  SELECT p.organization_id, COALESCE(NULLIF(p.fx_rate, 0), 3.75) INTO v_org, v_fx
  FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id)
     OR NOT public.can_edit('budget') THEN
    RAISE EXCEPTION 'budget import: you are not allowed to import a budget for this project' USING ERRCODE = '42501';
  END IF;

  -- Validate first; the same function runs again for the insert below, inside
  -- the same transaction, so both see identical data.
  SELECT count(*) FILTER (WHERE i.status = 'error'),
         (array_agg('row ' || i.row_no || ': ' || array_to_string(i.messages, '; ') ORDER BY i.ord)
            FILTER (WHERE i.status = 'error'))[1],
         count(*),
         count(*) FILTER (WHERE p_skip_duplicates AND i.duplicate_of IS NOT NULL),
         COALESCE(sum(i.line_total_sar) FILTER (WHERE NOT (p_skip_duplicates AND i.duplicate_of IS NOT NULL)), 0)
    INTO v_errors, v_first, v_rows, v_skipped, v_total
  FROM public.import_budget_validate(p_project_id, p_lines) i;
  IF v_errors > 0 THEN
    RAISE EXCEPTION 'budget import refused: % row(s) have errors (first — %). Nothing was imported.', v_errors, v_first
      USING ERRCODE = '22023';
  END IF;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'budget import refused: the file has no rows' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(max(bv.version_no), 0) + 1 INTO v_no FROM public.budget_versions bv WHERE bv.project_id = p_project_id;
  v_name := COALESCE(NULLIF(btrim(p_version_name), ''), 'v' || v_no || ' (Imported draft)');

  -- always a NEW draft: the active (approved) version is never written to
  INSERT INTO public.budget_versions (project_id, organization_id, version_no, version_name, status, created_by, notes)
  VALUES (p_project_id, v_org, v_no, left(v_name, 120), 'draft', auth.uid(),
          'Imported ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ' — ' || v_rows || ' rows in file')
  RETURNING id INTO v_version;

  INSERT INTO public.budget_lines (
    project_id, organization_id, version_id, header_code, main_code, topsheet_code, description, name, "group",
    amount, rate, x, unit, prep, shooting, wrap, currency, notes, excluded, uploaded_at, uploaded_by)
  SELECT p_project_id, v_org, v_version,
         COALESCE(i.header_code, i.main_code), i.main_code, i.topsheet_code, i.description, i.name,
         -- section: from the file, else from the master chart, else the table's own default
         COALESCE(i."group",
                  (SELECT max(mb."group") FROM public.master_budget mb WHERE mb.budget_code = i.main_code),
                  'BTL'),
         i.amount, i.rate, i.x, i.unit, i.prep, i.shooting, i.wrap, i.currency, i.notes, i.excluded, now(), auth.uid()
  FROM public.import_budget_validate(p_project_id, p_lines) i
  WHERE NOT (p_skip_duplicates AND i.duplicate_of IS NOT NULL)
  ORDER BY i.ord;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'version_id', v_version, 'version_name', v_name, 'status', 'draft',
    'inserted', v_inserted, 'skipped_duplicates', v_skipped,
    'total_sar', round(v_total, 2), 'fx_rate', v_fx, 'total_usd', round(v_total / v_fx, 2));
END;
$$;

REVOKE ALL ON FUNCTION public.import_try_numeric(text)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_budget_validate(uuid, jsonb)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_budget_preview(uuid, jsonb)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_budget_commit(uuid, jsonb, text, boolean)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_try_numeric(text)                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_budget_validate(uuid, jsonb)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_budget_preview(uuid, jsonb)               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_budget_commit(uuid, jsonb, text, boolean) TO authenticated, service_role;
