-- =====================================================================
-- 184 — Readable reference numbers, an append-only audit trail, a
--       server-side project lock and the Budget Change Log data layer.
--
-- Spec items: G06 G07 G08 G12 D07 X15 N10 (data side of G09-G11)
--
-- Why
--   * G06  Every document was known only by its UUID. Each financial table
--     gets ref_no = <PROJECT CODE>-<TYPE>-<4 digits> (decision 17), e.g.
--     MON26-PO-0012. Types: PO INV CRW CST PC PD OT PMT FND. The counter is
--     kept per project + type in public.document_ref_counters and taken under
--     a row lock, so two documents saved in the same instant get different
--     numbers. UNIQUE (project_id, ref_no) on every table. A number is never
--     changed (trigger) and never reused (the counter only goes up; a
--     deleted document's number stays burnt). The UUID stays the internal key.
--     Purchase orders: 174 already numbered new POs <CODE>-PO-0001 from
--     po_number; that trigger now takes its number from the same counter, so
--     po_number = ref_no for every new PO without a typed number.
--   * G07  public.backfill_document_refs() numbers the rows that existed
--     before this file, by created_at per project + type, and sets the
--     counters to the last number. It fills ref_no ONLY (all user triggers on
--     the table are switched off for the update, so updated_at / updated_by
--     / approval guards are not touched). Existing POs whose po_number already
--     has the format keep it as their ref_no. NOT run by this file: the owner
--     runs it once, after a full backup:   SELECT * FROM public.backfill_document_refs();
--   * G08  public.v_document_refs: one row per document (type, id, ref_no,
--     vendor/external number kept separately, payment -> parent document) for
--     reference search and deep links. ref_no is Kwalis' own number;
--     invoices.invoice_no stays the supplier's number.
--   * G12/D07  audit_history and audit_logs become append-only: no UPDATE,
--     DELETE or TRUNCATE for anyone (grants revoked + a trigger that also
--     stops the table owner). Only the database's own foreign-key actions on
--     audit_logs (SET NULL when a user / project is removed, CASCADE when a
--     whole organization is removed) still pass.
--     public.v_audit_trail adds the plain action (create / update / delete /
--     approve / reject / pay) and the user's name to every audit row.
--   * X15  The project "Lock" was a browser flag (localStorage). It is now
--     projects.locked_at / locked_by / lock_reason, set through
--     public.set_project_lock(). While a project is locked OR archived,
--     inserting, editing or deleting its invoices, contracts (payroll), POs,
--     petty cash, per diem, overtime, payments, funding and payment requests
--     is refused by the database, unless the user holds the override:
--     platform owner, organization owner/admin, an RBAC admin role, or edit
--     on the new module "project-lock".
--   * N10  public.v_budget_change_log: every change to a budget line with the
--     line total before / after (SAR), user, date and reason. Adds the
--     nullable budget_lines.change_reason column the budget editor can fill.
--
-- ADDITIVE: new columns (nullable), one table, new functions / triggers /
-- views, one catalogue row in modules. The only existing function redefined
-- is assign_purchase_order_number() (copied from 174, numbering source
-- changed). No client row is rewritten by this file.
--
-- SECURITY: new policies, revoked grants on the audit tables and a
-- lock trigger on financial tables — apply only after owner approval.
--
-- Security review fix (secfix #29, before first apply): v_budget_change_log
-- casts audit JSON values safely (import_try_numeric, guarded boolean / uuid),
-- so one malformed audit row can no longer break the view.
--
-- Rollback (manual):
--   DROP VIEW IF EXISTS public.v_budget_change_log, public.v_audit_trail, public.v_document_refs;
--   for each table t in the lists below:
--     DROP TRIGGER IF EXISTS zz_trg_document_ref ON public.t;
--     DROP TRIGGER IF EXISTS trg_document_ref_immutable ON public.t;
--     DROP TRIGGER IF EXISTS zz_trg_project_lock ON public.t;
--   DROP TRIGGER IF EXISTS trg_audit_append_only ON public.audit_history;  (and _truncate, and on audit_logs)
--   DROP TRIGGER IF EXISTS trg_guard_project_lock_columns ON public.projects;
--   re-create assign_purchase_order_number() from db/pending/174;
--   DROP FUNCTION public.backfill_document_refs(uuid), public.next_document_ref(uuid, text),
--     public.assign_document_ref(), public.guard_document_ref(), public.enforce_project_lock(),
--     public.set_project_lock(uuid, boolean, text), public.can_override_project_lock(uuid, uuid),
--     public.guard_project_lock_columns(), public.audit_rows_append_only(), public.audit_action(text, text, jsonb),
--     public.user_display_name(uuid), public.max_used_document_ref(uuid, text, text),
--     public.document_ref_format(text, text, integer);
--   DROP TABLE public.document_ref_counters;
--   GRANT UPDATE, DELETE ON public.audit_history, public.audit_logs TO authenticated, service_role;
--   the new columns (ref_no, locked_*, change_reason) can stay (nullable, unused).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. G06 — counters
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_ref_counters (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  doc_type   text NOT NULL CHECK (doc_type IN ('PO','INV','CRW','CST','PC','PD','OT','PMT','FND')),
  last_no    integer NOT NULL DEFAULT 0 CHECK (last_no >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, doc_type)
);
-- Written by SECURITY DEFINER functions only; members may read their project's counters.
REVOKE ALL ON public.document_ref_counters FROM authenticated;
GRANT SELECT ON public.document_ref_counters TO authenticated;
GRANT ALL ON public.document_ref_counters TO service_role;
REVOKE ALL ON public.document_ref_counters FROM anon;
ALTER TABLE public.document_ref_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Project members read reference counters" ON public.document_ref_counters;
CREATE POLICY "Project members read reference counters"
  ON public.document_ref_counters FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p
                 WHERE p.id = document_ref_counters.project_id
                   AND public.can_access_project(auth.uid(), p.organization_id, p.id)));

-- MON26 + PO + 12 -> MON26-PO-0012 (5+ digits are kept whole, never truncated)
CREATE OR REPLACE FUNCTION public.document_ref_format(p_code text, p_type text, p_no integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT upper(p_code) || '-' || p_type || '-'
         || CASE WHEN length(p_no::text) >= 4 THEN p_no::text ELSE lpad(p_no::text, 4, '0') END
$$;

-- Highest number already used for this project + type, in any table
-- (and, for POs, in po_number — numbers 174 issued before this file).
CREATE OR REPLACE FUNCTION public.max_used_document_ref(p_project_id uuid, p_type text, p_code text)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_re  text := '^' || upper(p_code) || '-' || p_type || '-([0-9]+)$';
  v_max integer := 0;
  v_n   integer;
  t     text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices','payroll','purchase_orders','cash_advance_receipts','cash_advances',
                           'per_diem_ledger','overtime_entries','payments','project_funding'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT max(substring(ref_no FROM %L)::int) FROM public.%I WHERE project_id = $1 AND ref_no ~ %L',
                   v_re, t, v_re)
      INTO v_n USING p_project_id;
    v_max := GREATEST(v_max, COALESCE(v_n, 0));
  END LOOP;
  IF p_type = 'PO' THEN
    SELECT max(substring(po.po_number FROM v_re)::int) INTO v_n
      FROM public.purchase_orders po WHERE po.project_id = p_project_id AND po.po_number ~ v_re;
    v_max := GREATEST(v_max, COALESCE(v_n, 0));
  END IF;
  RETURN v_max;
END $$;

-- Takes the next number. Concurrency: an existing counter row is bumped by
-- UPDATE (row lock — a second transaction waits and then sees the new
-- value); the very first number of a type is seeded under an advisory lock
-- and inserted with ON CONFLICT, so two "first" documents cannot both get 1.
CREATE OR REPLACE FUNCTION public.next_document_ref(p_project_id uuid, p_type text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
  v_no   integer;
BEGIN
  IF p_project_id IS NULL THEN RETURN NULL; END IF;
  IF p_type NOT IN ('PO','INV','CRW','CST','PC','PD','OT','PMT','FND') THEN
    RAISE EXCEPTION 'next_document_ref: unknown document type %', p_type USING ERRCODE = '22023';
  END IF;
  SELECT NULLIF(btrim(p.code), '') INTO v_code FROM public.projects p WHERE p.id = p_project_id;
  IF v_code IS NULL THEN RETURN NULL; END IF;

  UPDATE public.document_ref_counters
     SET last_no = last_no + 1, updated_at = now()
   WHERE project_id = p_project_id AND doc_type = p_type
  RETURNING last_no INTO v_no;

  IF v_no IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('document_ref:' || p_project_id::text || ':' || p_type));
    INSERT INTO public.document_ref_counters (project_id, doc_type, last_no)
    VALUES (p_project_id, p_type, public.max_used_document_ref(p_project_id, p_type, v_code) + 1)
    ON CONFLICT (project_id, doc_type)
      DO UPDATE SET last_no = public.document_ref_counters.last_no + 1, updated_at = now()
    RETURNING last_no INTO v_no;
  END IF;
  RETURN public.document_ref_format(v_code, p_type, v_no);
END $$;
REVOKE ALL ON FUNCTION public.next_document_ref(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.max_used_document_ref(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_document_ref(uuid, text) TO service_role;

-- ---------------------------------------------------------------------
-- 2. G06 — ref_no columns, uniqueness, assignment, immutability
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices','payroll','purchase_orders','cash_advance_receipts','cash_advances',
                           'per_diem_ledger','overtime_entries','payments','project_funding'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN RAISE NOTICE '184: table % not found, skipped', t; CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS ref_no text', t);
    EXECUTE format('COMMENT ON COLUMN public.%I.ref_no IS %L', t,
                   'Kwalis reference number <PROJECT CODE>-<TYPE>-<NNNN>; set by the database, never changed (db/pending/184).');
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (project_id, ref_no) WHERE ref_no IS NOT NULL',
                   'uq_' || t || '_project_ref_no', t);
  END LOOP;
END $$;

-- Document type of a row. Payroll rows are contracts: cast -> CST, everything
-- else (crew, and the legacy vendor kind) -> CRW.
CREATE OR REPLACE FUNCTION public.assign_document_ref()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type text := TG_ARGV[0];
BEGIN
  IF TG_TABLE_NAME = 'payroll' THEN
    v_type := CASE WHEN lower(COALESCE(NEW.kind, '')) = 'cast' THEN 'CST' ELSE 'CRW' END;
  END IF;
  -- A row coming back from the Trash (restore_trash_item re-inserts the
  -- deleted row with its id) keeps the number it had. Any other value sent by
  -- a client is ignored: the database issues the number.
  IF NEW.ref_no IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.trash_items ti
        WHERE ti.table_name = TG_TABLE_NAME AND ti.record_id = NEW.id
          AND ti.restored_at IS NULL AND ti.row_data->>'ref_no' = NEW.ref_no) THEN
    RETURN NEW;
  END IF;
  NEW.ref_no := public.next_document_ref(NEW.project_id, v_type);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_document_ref()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.ref_no IS DISTINCT FROM OLD.ref_no THEN
    RAISE EXCEPTION 'The reference number % cannot be changed', COALESCE(OLD.ref_no, '(none)')
      USING ERRCODE = '42501',
            HINT = 'Reference numbers are issued by the system. Old documents are numbered by backfill_document_refs().';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('invoices','INV'), ('payroll','CRW'), ('cash_advance_receipts','PC'), ('cash_advances','PC'),
      ('per_diem_ledger','PD'), ('overtime_entries','OT'), ('payments','PMT'), ('project_funding','FND'),
      ('purchase_orders', NULL)) AS v(tbl, typ)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN CONTINUE; END IF;
    -- zz_ prefix: runs after the other BEFORE triggers (they fire by name),
    -- so project_id is final when the number is taken.
    IF r.typ IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS zz_trg_document_ref ON public.%I', r.tbl);
      EXECUTE format('CREATE TRIGGER zz_trg_document_ref BEFORE INSERT ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.assign_document_ref(%L)', r.tbl, r.typ);
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_document_ref_immutable ON public.%I', r.tbl);
    EXECUTE format('CREATE TRIGGER trg_document_ref_immutable BEFORE UPDATE OF ref_no ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.guard_document_ref()', r.tbl);
  END LOOP;
END $$;

-- Purchase orders (copied from 174; changed: the number comes from the shared
-- counter and is ALWAYS written to ref_no; po_number takes it when empty, a
-- number typed by the user is still kept in po_number).
CREATE OR REPLACE FUNCTION public.assign_purchase_order_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prefix text;
  v_next   int;
BEGIN
  IF NEW.ref_no IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.trash_items ti
        WHERE ti.table_name = 'purchase_orders' AND ti.record_id = NEW.id
          AND ti.restored_at IS NULL AND ti.row_data->>'ref_no' = NEW.ref_no) THEN
    NEW.ref_no := public.next_document_ref(NEW.project_id, 'PO');
  END IF;
  IF NEW.po_number IS NOT NULL AND btrim(NEW.po_number) <> '' THEN
    RETURN NEW;
  END IF;
  IF NEW.ref_no IS NOT NULL THEN
    NEW.po_number := NEW.ref_no;
    RETURN NEW;
  END IF;
  -- no project / no project code: the 174 behaviour
  SELECT COALESCE(NULLIF(btrim(p.code), ''), 'PO') INTO v_prefix
    FROM public.projects p WHERE p.id = NEW.project_id;
  v_prefix := upper(COALESCE(v_prefix, 'PO')) || '-PO-';
  PERFORM pg_advisory_xact_lock(hashtext('po_number:' || COALESCE(NEW.project_id::text, '')));
  SELECT COALESCE(max(substring(po.po_number FROM '([0-9]+)$')::int), 0) + 1 INTO v_next
    FROM public.purchase_orders po
   WHERE po.project_id IS NOT DISTINCT FROM NEW.project_id
     AND po.po_number LIKE v_prefix || '%'
     AND po.po_number ~ '[0-9]+$';
  NEW.po_number := v_prefix || lpad(v_next::text, 4, '0');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_purchase_order_number ON public.purchase_orders;
CREATE TRIGGER trg_purchase_order_number
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_purchase_order_number();

-- ---------------------------------------------------------------------
-- 3. G07 — backfill (run by the owner after a backup; NOT run here)
-- ---------------------------------------------------------------------
-- Numbers every row that has a project and no ref_no, by created_at (then
-- id) per project + type, after the highest number already in use, and sets
-- the counters. Existing POs whose po_number already reads <CODE>-PO-NNNN keep
-- that number. Only ref_no is written: the user triggers of each table are
-- disabled for that single UPDATE (transactional: a failure re-enables them).
-- Idempotent: a second run finds nothing to number.
CREATE OR REPLACE FUNCTION public.backfill_document_refs(p_project_id uuid DEFAULT NULL)
RETURNS TABLE (project_id uuid, doc_type text, numbered integer, last_no integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  r record;
  n integer;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'backfill_document_refs: platform owner only' USING ERRCODE = '42501';
  END IF;

  DROP TABLE IF EXISTS pg_temp._ref_backfill;
  CREATE TEMP TABLE _ref_backfill (
    tbl text, id uuid, project_id uuid, doc_type text, code text,
    created_at timestamptz, keep_ref text, new_ref text) ON COMMIT DROP;

  FOR r IN SELECT * FROM (VALUES
      ('invoices',              '''INV'''),
      ('payroll',               'CASE WHEN lower(COALESCE(t.kind, '''')) = ''cast'' THEN ''CST'' ELSE ''CRW'' END'),
      ('purchase_orders',       '''PO'''),
      ('cash_advance_receipts', '''PC'''),
      ('cash_advances',         '''PC'''),
      ('per_diem_ledger',       '''PD'''),
      ('overtime_entries',      '''OT'''),
      ('payments',              '''PMT'''),
      ('project_funding',       '''FND''')) AS v(tbl, type_expr)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format(
      'INSERT INTO _ref_backfill (tbl, id, project_id, doc_type, code, created_at)
       SELECT %L, t.id, t.project_id, %s, upper(btrim(p.code)), t.created_at
         FROM public.%I t JOIN public.projects p ON p.id = t.project_id
        WHERE t.ref_no IS NULL AND NULLIF(btrim(p.code), '''') IS NOT NULL
          AND ($1 IS NULL OR t.project_id = $1)',
      r.tbl, r.type_expr, r.tbl) USING p_project_id;
  END LOOP;

  -- POs already numbered by 174 keep their number (first one wins on a duplicate).
  UPDATE _ref_backfill b SET keep_ref = po.po_number
    FROM public.purchase_orders po
   WHERE b.tbl = 'purchase_orders' AND po.id = b.id
     AND po.po_number ~ ('^' || b.code || '-PO-[0-9]{4,}$')
     AND NOT EXISTS (SELECT 1 FROM public.purchase_orders x
                      WHERE x.project_id = b.project_id AND x.ref_no = po.po_number)
     AND b.id = (SELECT b2.id FROM _ref_backfill b2 JOIN public.purchase_orders po2 ON po2.id = b2.id
                  WHERE b2.tbl = 'purchase_orders' AND b2.project_id = b.project_id
                    AND po2.po_number = po.po_number
                  ORDER BY b2.created_at, b2.id LIMIT 1);
  UPDATE _ref_backfill SET new_ref = keep_ref WHERE keep_ref IS NOT NULL;

  -- Everything else: after the highest number in use (refs, kept POs, the counter).
  WITH base AS (
    SELECT g.project_id, g.doc_type, g.code,
           GREATEST(public.max_used_document_ref(g.project_id, g.doc_type, g.code),
                    COALESCE((SELECT max(substring(k.keep_ref FROM '([0-9]+)$')::int) FROM _ref_backfill k
                               WHERE k.project_id = g.project_id AND k.doc_type = g.doc_type), 0),
                    COALESCE((SELECT c.last_no FROM public.document_ref_counters c
                               WHERE c.project_id = g.project_id AND c.doc_type = g.doc_type), 0)) AS start_no
      FROM (SELECT DISTINCT b.project_id, b.doc_type, b.code FROM _ref_backfill b) g
  ), numbered AS (
    SELECT b.tbl, b.id,
           public.document_ref_format(b.code, b.doc_type,
             base.start_no + row_number() OVER (PARTITION BY b.project_id, b.doc_type
                                                ORDER BY b.created_at, b.id)::int) AS ref
      FROM _ref_backfill b JOIN base ON base.project_id = b.project_id AND base.doc_type = b.doc_type
     WHERE b.keep_ref IS NULL
  )
  UPDATE _ref_backfill b SET new_ref = numbered.ref
    FROM numbered WHERE numbered.tbl = b.tbl AND numbered.id = b.id;

  FOR r IN SELECT DISTINCT b.tbl FROM _ref_backfill b LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', r.tbl);
    EXECUTE format('UPDATE public.%I t SET ref_no = b.new_ref FROM _ref_backfill b
                     WHERE b.tbl = %L AND b.id = t.id AND t.ref_no IS NULL', r.tbl, r.tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', r.tbl);
  END LOOP;

  -- Counters = last number in use, so the next document continues the sequence.
  FOR r IN SELECT DISTINCT b.project_id, b.doc_type, b.code FROM _ref_backfill b LOOP
    n := public.max_used_document_ref(r.project_id, r.doc_type, r.code);
    INSERT INTO public.document_ref_counters AS c (project_id, doc_type, last_no)
    VALUES (r.project_id, r.doc_type, n)
    ON CONFLICT ON CONSTRAINT document_ref_counters_pkey
      DO UPDATE SET last_no = GREATEST(c.last_no, EXCLUDED.last_no), updated_at = now();
  END LOOP;

  INSERT INTO public.audit_logs (organization_id, project_id, actor_id, category, action, severity, entity, summary, details)
  SELECT p.organization_id, p.id, v_uid, 'other', 'refs.backfilled', 'info', 'project',
         'Reference numbers assigned to existing documents',
         jsonb_build_object('rows', count(b.*))
    FROM _ref_backfill b JOIN public.projects p ON p.id = b.project_id
   GROUP BY p.organization_id, p.id;

  RETURN QUERY
  SELECT b.project_id, b.doc_type, count(*)::int,
         (SELECT c.last_no FROM public.document_ref_counters c
           WHERE c.project_id = b.project_id AND c.doc_type = b.doc_type)
    FROM _ref_backfill b GROUP BY b.project_id, b.doc_type ORDER BY 1, 2;
END $$;
REVOKE ALL ON FUNCTION public.backfill_document_refs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_document_refs(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 4. G08 — one row per document for search and deep links
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_document_refs WITH (security_invoker = on) AS
 SELECT 'invoice'::text AS source_type, i.id AS record_id, i.project_id, i.organization_id, i.ref_no,
        'INV'::text AS doc_type, i.description AS label, i.vendor_name AS counterparty,
        i.invoice_no AS external_no, NULL::text AS parent_type, NULL::uuid AS parent_id, i.created_at
   FROM public.invoices i
UNION ALL
 SELECT 'payroll', p.id, p.project_id, p.organization_id, p.ref_no,
        CASE WHEN lower(COALESCE(p.kind, '')) = 'cast' THEN 'CST' ELSE 'CRW' END,
        p.name, p.name, NULL::text, NULL::text, NULL::uuid, p.created_at
   FROM public.payroll p
UNION ALL
 SELECT 'purchase_order', po.id, po.project_id, po.organization_id, po.ref_no,
        'PO', po.description, po.vendor_name, po.po_number, NULL::text, NULL::uuid, po.created_at
   FROM public.purchase_orders po
UNION ALL
 SELECT 'petty_cash', r.id, r.project_id, r.organization_id, r.ref_no,
        'PC', r.description, COALESCE(r.vendor, r.recipient), NULL::text, 'cash_advance'::text, r.advance_id, r.created_at
   FROM public.cash_advance_receipts r
UNION ALL
 SELECT 'cash_advance', a.id, a.project_id, a.organization_id, a.ref_no,
        'PC', a.notes, a.holder, NULL::text, NULL::text, NULL::uuid, a.created_at
   FROM public.cash_advances a
UNION ALL
 SELECT 'per_diem', d.id, d.project_id, d.organization_id, d.ref_no,
        'PD', 'Per diem ' || d.period_start || ' – ' || d.period_end, pe.full_name, NULL::text, NULL::text, NULL::uuid, d.created_at
   FROM public.per_diem_ledger d LEFT JOIN public.people pe ON pe.id = d.person_id
UNION ALL
 SELECT 'overtime', o.id, o.project_id, o.organization_id, o.ref_no,
        'OT', o.notes, o.person_name, NULL::text, NULL::text, NULL::uuid, o.created_at
   FROM public.overtime_entries o
UNION ALL
 SELECT 'payment', pay.id, pay.project_id, pay.organization_id, pay.ref_no,
        'PMT', pay.notes, NULL::text, NULL::text,
        CASE pay.source_type
          WHEN 'po' THEN 'purchase_order'
          WHEN 'receipt' THEN 'petty_cash'
          WHEN 'cash_advance_receipt' THEN 'petty_cash'
          ELSE pay.source_type END,
        pay.source_id, pay.created_at
   FROM public.payments pay
UNION ALL
 SELECT 'funding', f.id, f.project_id, f.organization_id, f.ref_no,
        'FND', f.source, f.source, f.reference, NULL::text, NULL::uuid, f.created_at
   FROM public.project_funding f;
COMMENT ON VIEW public.v_document_refs IS
  'One row per financial document: Kwalis ref_no, the external/vendor number kept apart, and for payments / receipts the parent document. Security invoker: RLS of each base table applies. db/pending/184.';
GRANT SELECT ON public.v_document_refs TO authenticated;
REVOKE ALL ON public.v_document_refs FROM anon;

-- ---------------------------------------------------------------------
-- 5. G12 / D07 — names, plain actions, append-only audit tables
-- ---------------------------------------------------------------------
-- A user's display name (profile name, else e-mail), only for the caller
-- themself, users who share an organization with them, or the platform owner.
CREATE OR REPLACE FUNCTION public.user_display_name(p_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_uid IS NULL THEN NULL
    WHEN auth.uid() IS NULL OR p_uid = auth.uid() OR public.is_super_admin(auth.uid())
      OR EXISTS (SELECT 1 FROM public.organization_members a
                   JOIN public.organization_members b ON b.organization_id = a.organization_id
                  WHERE a.user_id = auth.uid() AND b.user_id = p_uid)
    THEN COALESCE((SELECT NULLIF(btrim(pr.display_name), '') FROM public.profiles pr WHERE pr.id = p_uid),
                  (SELECT u.email::text FROM auth.users u WHERE u.id = p_uid))
  END
$$;
REVOKE ALL ON FUNCTION public.user_display_name(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_display_name(uuid) TO authenticated, service_role;

-- create / update / delete / approve / reject / pay
CREATE OR REPLACE FUNCTION public.audit_action(p_table text, p_operation text, p_changed jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_operation = 'DELETE' THEN 'delete'
    WHEN p_operation = 'INSERT' THEN CASE WHEN p_table = 'payments' THEN 'pay' ELSE 'create' END
    WHEN lower(COALESCE(p_changed->'status'->>'to', p_changed->'payment_status'->>'to', '')) = 'paid'
      OR (p_changed ? 'executed_at' AND p_changed->'executed_at'->'to' <> 'null'::jsonb)
      OR (p_changed ? 'paid_at' AND p_changed->'paid_at'->'to' <> 'null'::jsonb) THEN 'pay'
    WHEN lower(COALESCE(p_changed->'status'->>'to', p_changed->'contract_status'->>'to', '')) IN ('approved', 'issued')
      OR (p_changed ? 'approved_at' AND p_changed->'approved_at'->'to' <> 'null'::jsonb) THEN 'approve'
    WHEN lower(COALESCE(p_changed->'status'->>'to', p_changed->'contract_status'->>'to', '')) = 'rejected'
      OR (p_changed ? 'rejected_at' AND p_changed->'rejected_at'->'to' <> 'null'::jsonb) THEN 'reject'
    ELSE 'update'
  END
$$;

CREATE OR REPLACE VIEW public.v_audit_trail WITH (security_invoker = on) AS
 SELECT ah.id, ah.created_at, ah.table_name, ah.record_id, ah.organization_id, ah.project_id,
        ah.operation, public.audit_action(ah.table_name, ah.operation, ah.changed_fields) AS action,
        ah.actor_id, public.user_display_name(ah.actor_id) AS actor_name, ah.changed_fields
   FROM public.audit_history ah;
COMMENT ON VIEW public.v_audit_trail IS
  'audit_history with the plain action (create/update/delete/approve/reject/pay) and the user name. db/pending/184.';
GRANT SELECT ON public.v_audit_trail TO authenticated;
REVOKE ALL ON public.v_audit_trail FROM anon;

CREATE OR REPLACE FUNCTION public.audit_rows_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_LEVEL = 'ROW' AND TG_TABLE_NAME = 'audit_logs' THEN
    -- the foreign keys of audit_logs: ON DELETE SET NULL (user, project)
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - ARRAY['actor_id','project_id','organization_id'])
           = (to_jsonb(OLD) - ARRAY['actor_id','project_id','organization_id'])
       AND (NEW.actor_id IS NULL OR NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id)
       AND (NEW.project_id IS NULL OR NEW.project_id IS NOT DISTINCT FROM OLD.project_id)
       AND (NEW.organization_id IS NULL OR NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id)
       AND (NEW.actor_id IS NULL OR NEW.project_id IS NULL OR NEW.organization_id IS NULL) THEN
      RETURN NEW;
    END IF;
    -- ... and ON DELETE CASCADE when the whole organization is removed
    IF TG_OP = 'DELETE' AND OLD.organization_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'The audit trail is append-only: % rows cannot be changed or deleted', TG_TABLE_NAME
    USING ERRCODE = '42501';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_history','audit_logs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_append_only ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_append_only BEFORE UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.audit_rows_append_only()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_append_only_truncate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_append_only_truncate BEFORE TRUNCATE ON public.%I
                    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_append_only()', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated, service_role', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 6. X15 — project lock in the database
-- ---------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS locked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by   uuid,
  ADD COLUMN IF NOT EXISTS lock_reason text;
DO $$ BEGIN
  ALTER TABLE public.projects ADD CONSTRAINT projects_lock_reason_len CHECK (lock_reason IS NULL OR length(lock_reason) <= 500);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The "special permission": grantable per role in Role Management.
INSERT INTO public.modules (key, label, icon, route_path, parent_key, sort_order, layer, is_active)
VALUES ('project-lock', 'Project Lock Override', 'Lock', NULL, 'directories-admin', 90, 'operational', true)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_override_project_lock(p_org uuid, p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
       public.is_super_admin(auth.uid())
    OR (p_org IS NOT NULL AND public.is_org_admin(auth.uid(), p_org))
    OR (p_org IS NOT NULL AND public.is_admin(p_org, p_project))
    OR (public.can_edit('project-lock') AND public.can_access_project(auth.uid(), p_org, p_project)))
$$;
REVOKE ALL ON FUNCTION public.can_override_project_lock(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_override_project_lock(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_project_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids uuid[];
  pr    record;
BEGIN
  -- service role / SQL editor / seeds (no signed-in user) are not stopped
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  v_ids := CASE TG_OP
             WHEN 'INSERT' THEN ARRAY[NEW.project_id]
             WHEN 'DELETE' THEN ARRAY[OLD.project_id]
             ELSE ARRAY[NEW.project_id, OLD.project_id] END;
  FOR pr IN SELECT p.id, p.organization_id, p.code, p.status, p.locked_at
              FROM public.projects p WHERE p.id = ANY (v_ids) LOOP
    IF (pr.locked_at IS NOT NULL OR pr.status = 'Archived')
       AND NOT public.can_override_project_lock(pr.organization_id, pr.id) THEN
      RAISE EXCEPTION 'Project % is % — no new or changed transactions are allowed',
        pr.code, CASE WHEN pr.status = 'Archived' THEN 'archived' ELSE 'locked' END
        USING ERRCODE = '42501',
              HINT = 'Ask an administrator to unlock the project, or for the "Project Lock Override" permission.';
    END IF;
  END LOOP;
  -- a project removed in the same statement (30-day purge cascade) is not found: allowed
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices','payroll','purchase_orders','cash_advance_receipts','cash_advances',
                           'per_diem_ledger','overtime_entries','payments','project_funding',
                           'payment_requests','payroll_payments'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS zz_trg_project_lock ON public.%I', t);
    EXECUTE format('CREATE TRIGGER zz_trg_project_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.enforce_project_lock()', t);
  END LOOP;
END $$;

-- Only lock-holders may change the lock columns (the projects UPDATE policy
-- lets other editors change the project row itself).
CREATE OR REPLACE FUNCTION public.guard_project_lock_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.locked_at IS DISTINCT FROM OLD.locked_at OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
          OR NEW.lock_reason IS DISTINCT FROM OLD.lock_reason)
     AND NOT public.can_override_project_lock(OLD.organization_id, OLD.id) THEN
    RAISE EXCEPTION 'Only an administrator can lock or unlock a project' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_project_lock_columns ON public.projects;
CREATE TRIGGER trg_guard_project_lock_columns
  BEFORE UPDATE OF locked_at, locked_by, lock_reason ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_lock_columns();

CREATE OR REPLACE FUNCTION public.set_project_lock(p_project_id uuid, p_locked boolean, p_reason text DEFAULT NULL)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  pr    public.projects%ROWTYPE;
  v_at  timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'set_project_lock: not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO pr FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_project(v_uid, pr.organization_id, pr.id)
     OR NOT public.can_override_project_lock(pr.organization_id, pr.id) THEN
    RAISE EXCEPTION 'set_project_lock: project not found or not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NOT NULL AND length(p_reason) > 500 THEN
    RAISE EXCEPTION 'set_project_lock: the reason is longer than 500 characters' USING ERRCODE = '22023';
  END IF;
  v_at := CASE WHEN p_locked THEN COALESCE(pr.locked_at, now()) END;
  UPDATE public.projects
     SET locked_at = v_at,
         locked_by = CASE WHEN p_locked THEN COALESCE(pr.locked_by, v_uid) END,
         lock_reason = CASE WHEN p_locked THEN NULLIF(btrim(COALESCE(p_reason, pr.lock_reason, '')), '') END
   WHERE id = pr.id;
  INSERT INTO public.audit_logs (organization_id, project_id, actor_id, category, action, severity, entity, summary, details)
  VALUES (pr.organization_id, pr.id, v_uid, 'other',
          CASE WHEN p_locked THEN 'project.locked' ELSE 'project.unlocked' END, 'warning', 'project',
          CASE WHEN p_locked THEN 'Project locked: ' ELSE 'Project unlocked: ' END || pr.code,
          jsonb_build_object('reason', p_reason));
  RETURN v_at;
END $$;
REVOKE ALL ON FUNCTION public.set_project_lock(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_project_lock(uuid, boolean, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. N10 — Budget Change Log
-- ---------------------------------------------------------------------
ALTER TABLE public.budget_lines ADD COLUMN IF NOT EXISTS change_reason text;
DO $$ BEGIN
  ALTER TABLE public.budget_lines ADD CONSTRAINT budget_lines_change_reason_len
    CHECK (change_reason IS NULL OR length(change_reason) <= 500);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.budget_lines.change_reason IS
  'Why the line was last changed; written with the edit and read back from the audit trail by v_budget_change_log.';

-- secfix #29: safe casts — one malformed audit row must not break the view
CREATE OR REPLACE VIEW public.v_budget_change_log WITH (security_invoker = on) AS
 SELECT ah.id,
        ah.created_at AS changed_at,
        ah.organization_id,
        ah.project_id,
        ah.record_id AS budget_line_id,
        ah.operation,
        public.audit_action('budget_lines', ah.operation, ah.changed_fields) AS action,
        ah.actor_id,
        public.user_display_name(ah.actor_id) AS actor_name,
        COALESCE(ah.new_row->>'main_code', ah.old_row->>'main_code') AS budget_code,
        COALESCE(ah.new_row->>'description', ah.old_row->>'description') AS description,
        bv.version_name,
        bv.status AS version_status,
        CASE WHEN ah.old_row IS NULL THEN NULL ELSE round(public.budget_line_total_sar(
          public.import_try_numeric(ah.old_row->>'amount'), public.import_try_numeric(ah.old_row->>'rate'), public.import_try_numeric(ah.old_row->>'x'),
          public.import_try_numeric(ah.old_row->>'prep'), public.import_try_numeric(ah.old_row->>'shooting'), public.import_try_numeric(ah.old_row->>'wrap'),
          ah.old_row->>'unit', ah.old_row->>'currency', (lower(ah.old_row->>'excluded') IN ('true', 't', '1')), pr.fx_rate), 2) END AS before_sar,
        CASE WHEN ah.new_row IS NULL THEN NULL ELSE round(public.budget_line_total_sar(
          public.import_try_numeric(ah.new_row->>'amount'), public.import_try_numeric(ah.new_row->>'rate'), public.import_try_numeric(ah.new_row->>'x'),
          public.import_try_numeric(ah.new_row->>'prep'), public.import_try_numeric(ah.new_row->>'shooting'), public.import_try_numeric(ah.new_row->>'wrap'),
          ah.new_row->>'unit', ah.new_row->>'currency', (lower(ah.new_row->>'excluded') IN ('true', 't', '1')), pr.fx_rate), 2) END AS after_sar,
        CASE WHEN ah.operation = 'UPDATE' AND NOT (ah.changed_fields ? 'change_reason') THEN NULL
             ELSE NULLIF(btrim(COALESCE(ah.new_row->>'change_reason', ah.old_row->>'change_reason')), '') END AS reason,
        ah.changed_fields
   FROM public.audit_history ah
   LEFT JOIN public.projects pr ON pr.id = ah.project_id
   LEFT JOIN public.budget_versions bv
     ON bv.id = CASE WHEN COALESCE(ah.new_row->>'version_id', ah.old_row->>'version_id')
                          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     THEN COALESCE(ah.new_row->>'version_id', ah.old_row->>'version_id')::uuid END
  WHERE ah.table_name = 'budget_lines';
COMMENT ON VIEW public.v_budget_change_log IS
  'N10 Budget Change Log: each budget line change with the line total before/after in SAR, user, date and reason. db/pending/184.';
GRANT SELECT ON public.v_budget_change_log TO authenticated;
REVOKE ALL ON public.v_budget_change_log FROM anon;
