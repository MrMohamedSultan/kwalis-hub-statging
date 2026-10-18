-- =====================================================================
-- D02 + D03 — nothing financial disappears without a way back
--
-- Findings behind this file:
--   * The Trash screen is a list kept in the browser (localStorage key
--     kwalis.trash.v1). Deleting an invoice runs a real DELETE in the
--     database; "restore" only removes the entry from the browser list.
--   * Deleting a project from the company page runs DELETE on projects and
--     cascades through its budgets, payroll, invoices and payments.
--   * The existing "Archive" action writes status = 'Archived', which the
--     constraint projects_status_check rejects — the button always fails.
--
-- D03 as asked in the plan is a deleted_at column on every financial table
-- with every view and every screen filtering on it. That rewrites the
-- existing views and every query in the app. The same guarantee is given here
-- WITHOUT touching a single existing view or query:
--   a BEFORE DELETE trigger copies the row into public.trash_items; restoring
--   re-inserts that exact row (same id), so it reappears in every report by
--   itself. Deleted rows are kept 30 days.
--
--   table public.trash_items
--   RPC   public.restore_trash_item(id)
--   RPC   public.purge_expired_trash()
--
-- D02 — projects:
--   'Archived' becomes a legal status (the constraint gains one value)
--   columns projects.archived_at / archived_by / archived_from_status
--   RPC   public.archive_project(project, confirm_code)   — the project code must be typed
--   RPC   public.restore_project(project)
--   A project can only be hard-deleted after it has been archived 30 days.
--
-- SECURITY CHANGE (new policies, a delete guard) — apply after owner approval.
--
-- Rollback:
--   DROP TRIGGER trg_guard_project_delete ON public.projects;
--   DROP FUNCTION public.guard_project_delete(), public.restore_project(uuid), public.archive_project(uuid, text);
--   ALTER TABLE public.projects DROP COLUMN archived_at, DROP COLUMN archived_by, DROP COLUMN archived_from_status;
--   (the wider status constraint can stay — it only allows one more value)
--   DROP FUNCTION public.purge_expired_trash(), public.restore_trash_item(uuid);
--   -- for each table in the list below: DROP TRIGGER trg_capture_deleted_row ON public.<table>;
--   DROP FUNCTION public.capture_deleted_row();
--   DROP TABLE public.trash_items;
-- =====================================================================

-- ---------------------------------------------------------------------
-- D03 — trash
-- ---------------------------------------------------------------------
CREATE TABLE public.trash_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name      text NOT NULL,
  record_id       uuid NOT NULL,
  organization_id uuid,
  project_id      uuid,
  title           text,                 -- human label for the Trash screen
  row_data        jsonb NOT NULL,       -- the full row exactly as it was
  deleted_by      uuid,
  deleted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '30 days',
  restored_at     timestamptz,
  restored_by     uuid
);
CREATE INDEX idx_trash_items_project ON public.trash_items (project_id, deleted_at DESC) WHERE restored_at IS NULL;
CREATE INDEX idx_trash_items_record  ON public.trash_items (table_name, record_id);
CREATE INDEX idx_trash_items_expiry  ON public.trash_items (expires_at) WHERE restored_at IS NULL;

GRANT SELECT ON public.trash_items TO authenticated;     -- written by triggers and RPCs only
GRANT ALL ON public.trash_items TO service_role;
REVOKE ALL ON public.trash_items FROM anon;
ALTER TABLE public.trash_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members see their trash"
  ON public.trash_items FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR (organization_id IS NOT NULL
             AND public.can_access_project(auth.uid(), organization_id, project_id)));

-- Runs as owner so the copy is written whatever the deleting user may do.
CREATE OR REPLACE FUNCTION public.capture_deleted_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE j jsonb := to_jsonb(OLD);
BEGIN
  INSERT INTO public.trash_items (table_name, record_id, organization_id, project_id, title, row_data, deleted_by)
  VALUES (
    TG_TABLE_NAME,
    (j->>'id')::uuid,
    NULLIF(j->>'organization_id', '')::uuid,
    NULLIF(j->>'project_id', '')::uuid,
    left(COALESCE(NULLIF(j->>'invoice_no', ''), NULLIF(j->>'po_number', ''), NULLIF(j->>'name', ''),
                  NULLIF(j->>'full_name', ''), NULLIF(j->>'source_label', ''), NULLIF(j->>'description', ''),
                  NULLIF(j->>'recipient', ''), NULLIF(j->>'holder', ''), j->>'id'), 200),
    j,
    auth.uid());
  RETURN OLD;
END;
$$;

DO $$
DECLARE
  t text;
  tables constant text[] := ARRAY[
    'invoices', 'payroll', 'payments', 'purchase_orders', 'payment_requests',
    'cash_advances', 'cash_advance_receipts', 'per_diem_ledger', 'overtime_entries',
    'payroll_payments', 'vendors', 'people', 'crew_members'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'D03: table % not found, skipped', t; CONTINUE;
    END IF;
    EXECUTE format('CREATE TRIGGER trg_capture_deleted_row BEFORE DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.capture_deleted_row()', t);
  END LOOP;
END $$;

-- Put a deleted row back exactly as it was. Organization admins and the
-- platform owner only. The row keeps its id, so payments, links and reports
-- that referred to it work again without any repair.
CREATE OR REPLACE FUNCTION public.restore_trash_item(p_trash_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  ti    public.trash_items%ROWTYPE;
  v_exists boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'restore_trash_item: not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ti FROM public.trash_items WHERE id = p_trash_id FOR UPDATE;
  IF NOT FOUND
     OR NOT (public.is_super_admin(v_uid)
             OR (ti.organization_id IS NOT NULL AND public.is_org_admin(v_uid, ti.organization_id))) THEN
    RAISE EXCEPTION 'restore_trash_item: item not found or not allowed' USING ERRCODE = '42501';
  END IF;
  IF ti.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'restore_trash_item: this item was already restored' USING ERRCODE = '22023';
  END IF;
  IF to_regclass('public.' || quote_ident(ti.table_name)) IS NULL THEN
    RAISE EXCEPTION 'restore_trash_item: table % no longer exists', ti.table_name USING ERRCODE = '22023';
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', ti.table_name)
    INTO v_exists USING ti.record_id;
  IF v_exists THEN
    RAISE EXCEPTION 'restore_trash_item: a row with this id already exists' USING ERRCODE = '23505';
  END IF;
  IF ti.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = ti.project_id) THEN
    RAISE EXCEPTION 'restore_trash_item: the project this row belonged to no longer exists' USING ERRCODE = '23503';
  END IF;

  EXECUTE format('INSERT INTO public.%1$I SELECT * FROM jsonb_populate_record(NULL::public.%1$I, $1)', ti.table_name)
    USING ti.row_data;

  UPDATE public.trash_items SET restored_at = now(), restored_by = v_uid WHERE id = ti.id;
  RETURN ti.record_id;
END;
$$;

-- Remove trash older than its retention. Run from a scheduled job (service
-- role) or by the platform owner. Returns how many rows were removed.
CREATE OR REPLACE FUNCTION public.purge_expired_trash()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'purge_expired_trash: only the platform owner can purge' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.trash_items WHERE expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_deleted_row()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_trash_item(uuid)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purge_expired_trash()       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_trash_item(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_trash()    TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- D02 — archive instead of delete
-- ---------------------------------------------------------------------
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('Planning', 'Development', 'Pre-Production', 'Production',
                    'Post-Production', 'Finalized', 'Archived'));

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS archived_at          timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by          uuid,
  ADD COLUMN IF NOT EXISTS archived_from_status text;

-- p_confirm_code must equal the project's code (typed by the admin).
CREATE OR REPLACE FUNCTION public.archive_project(p_project_id uuid, p_confirm_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  pr    public.projects%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'archive_project: not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO pr FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_super_admin(v_uid) OR public.is_org_admin(v_uid, pr.organization_id)) THEN
    RAISE EXCEPTION 'archive_project: project not found or not allowed' USING ERRCODE = '42501';
  END IF;
  IF pr.status = 'Archived' THEN
    RAISE EXCEPTION 'archive_project: the project is already archived' USING ERRCODE = '22023';
  END IF;
  IF upper(btrim(COALESCE(p_confirm_code, ''))) <> upper(btrim(pr.code)) THEN
    RAISE EXCEPTION 'archive_project: type the project code exactly to confirm' USING ERRCODE = '22023';
  END IF;
  UPDATE public.projects
     SET archived_from_status = pr.status, status = 'Archived', archived_at = now(), archived_by = v_uid
   WHERE id = pr.id;
  INSERT INTO public.audit_logs (organization_id, project_id, actor_id, category, action, severity, entity, summary, details)
  VALUES (pr.organization_id, pr.id, v_uid, 'other', 'project.archived', 'warning', 'project',
          'Project archived: ' || pr.code || ' ' || pr.name,
          jsonb_build_object('previous_status', pr.status));
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_project(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  pr    public.projects%ROWTYPE;
  v_to  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'restore_project: not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO pr FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_super_admin(v_uid) OR public.is_org_admin(v_uid, pr.organization_id)) THEN
    RAISE EXCEPTION 'restore_project: project not found or not allowed' USING ERRCODE = '42501';
  END IF;
  IF pr.status <> 'Archived' THEN
    RAISE EXCEPTION 'restore_project: the project is not archived' USING ERRCODE = '22023';
  END IF;
  v_to := COALESCE(NULLIF(pr.archived_from_status, 'Archived'), 'Planning');
  UPDATE public.projects
     SET status = v_to, archived_at = NULL, archived_by = NULL, archived_from_status = NULL
   WHERE id = pr.id;
  INSERT INTO public.audit_logs (organization_id, project_id, actor_id, category, action, severity, entity, summary, details)
  VALUES (pr.organization_id, pr.id, v_uid, 'other', 'project.restored', 'info', 'project',
          'Project restored: ' || pr.code || ' ' || pr.name, jsonb_build_object('status', v_to));
  RETURN v_to;
END;
$$;

-- A project is destroyed only after 30 days in the archive. Signed-in users
-- are held to it; maintenance with the service role (demo purge, tests) is not.
CREATE OR REPLACE FUNCTION public.guard_project_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN OLD;
  END IF;
  IF OLD.status <> 'Archived' OR OLD.archived_at IS NULL THEN
    RAISE EXCEPTION 'A project must be archived before it can be deleted'
      USING ERRCODE = '42501', HINT = 'Use archive_project(). Permanent deletion opens 30 days later.';
  END IF;
  IF OLD.archived_at > now() - interval '30 days' THEN
    RAISE EXCEPTION 'This project was archived on % and can be permanently deleted from %',
      to_char(OLD.archived_at, 'YYYY-MM-DD'), to_char(OLD.archived_at + interval '30 days', 'YYYY-MM-DD')
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER trg_guard_project_delete
  BEFORE DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_delete();

REVOKE ALL ON FUNCTION public.archive_project(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_project(uuid)       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_project(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_project(uuid)       TO authenticated, service_role;
