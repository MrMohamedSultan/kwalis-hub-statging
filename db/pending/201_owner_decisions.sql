-- =====================================================================
-- 201 — Owner decisions of 28/10: company-borne WHT on 7099, invoice
--       approval (maker-checker), contracts bucket per project, budget
--       regions, Saudi WHT rate table.
--
-- Mandate: carryover "Owner decisions (28/10)". Spec items B04 E03 R23 R24
-- D15 X08 X09 N05 (Film Commission budget by region), decision 12.
--
-- 1. Decision 12 — company-borne WHT is charged to budget line 7099.
--    On an Exclusive (gross-up) contract (payroll.wht_treatment =
--    'exclusive', total_amount > net_payable) the contract's own budget
--    line carries the NET and the WHT on top (gross − net) is a cost of
--    code 7099. Inclusive WHT stays inside the contract line (it is the
--    payee's tax, deducted from the gross). 7,000 net @5% exclusive →
--    gross 7,368.42: the line shows 7,000.00, 7099 shows 368.42; the two
--    always add up to the contract value.
--      * public.payroll_company_wht_split(actual, total, net, treatment):
--        the one rule (line / 7099 split of Actual and Commitment).
--      * v_ledger_transactions (copy of 199): the payroll rows carry the
--        line share; new rows source_type 'payroll_wht' (actual and
--        commitment) on budget_code '7099'. Every view built on it
--        (v_budget_code_position, v_project_position, v_paid_by_code,
--        v_source_totals_by_code, v_budget_line_financials,
--        get_budget_reconciliation, get_cost_report(_detail),
--        get_cost_by_gl_account) follows without being redefined. A
--        project with no 7099 budget line still shows code 7099 in the
--        Cost Report (an unbudgeted code, budget 0).
--      * payroll_instalments.company_wht (new column, kept by
--        sync_payroll_instalments): the part of amount_gross charged to
--        7099. amount (net) is what is paid, amount_gross − company_wht is
--        the contract line's share.
--      * v_journal_lines (copy of 196) — ledger rule for an approved
--        Exclusive instalment: Dr expense of the contract code (net) +
--        Dr expense of code 7099 (company WHT) / Cr 9200 payable (net) +
--        Cr 9210 WHT payable (company WHT). Debits = credits as before.
--        Inclusive instalments are unchanged.
--    Paid stays on the contract line (payments are the net); the 7099 WHT
--    is Payable until remitted to ZATCA (treasury_movements).
--
-- 2. Invoice approval (owner: "invoices need approval by another user
--    before they count as Actual").
--      * invoices.approval_status pending → approved | rejected,
--        approved → cancelled. Existing invoices are 'approved' (new column
--        added with that default, so no number moves); new invoices start
--        'pending'. Stamps: approved_by/at, rejected_by/at/rejection_reason,
--        cancelled_by/at/cancellation_reason.
--      * maker-checker (same rules as purchase orders in 174 and contracts in
--        176): the creator cannot approve or reject; the approver must be an
--        org admin / super admin, or — when the organization has an approval
--        chain (payment_approval_levels) — someone who matches one of its
--        levels. RPCs approve_invoice / reject_invoice / cancel_invoice.
--      * pending invoice = Commitment, approved invoice = Actual, rejected /
--        cancelled = neither (a PO / car rental / accommodation it was
--        raised on is a commitment again).
--      * approved invoices are locked (amount, VAT, WHT, net, currency, FX,
--        vendor, budget code, project); deleting one is refused — it is
--        cancelled instead (X08), with a reason, and only when no payment
--        and no open payment request exist on it. The ledger posts the
--        accrual on approval and the engine reverses it on cancellation.
--      * payment requests and payments on an invoice require it approved.
--      * get_funding_position (upcoming = approved unpaid invoices) and
--        get_cash_flow (forecast leaves out rejected / cancelled invoices)
--        are copies of 196 with that filter.
--    Petty cash receipts (already pending / approved / rejected): the
--    approval stamp is written by the database, an approved receipt is
--    locked (amount, currency, FX, code, vendor, float, date), cannot go
--    back to pending / rejected and cannot be deleted — it is cancelled
--    (new status 'cancelled', cancel_petty_receipt) by an org admin or by
--    the person who approved it.
--
-- 3. Contracts storage bucket per project.
--      * move_contract_files_to_project_folders(dry_run DEFAULT true)
--        (super admin / service role): lists the objects of bucket
--        'contracts' that are not under a <project_id>/ folder, with the
--        record that owns each one and its new path <project_id>/<old path>.
--        Moving the bytes needs the Storage API (an UPDATE of
--        storage.objects.name does not move the file), so the move itself
--        is done by the server function moveContractFilesToProjectFolders
--        (src/lib/contract-files.functions.ts, super admin only); after
--        each move it calls repoint_contract_file(old, new), which updates
--        every path column that pointed at the file in one transaction.
--        dry_run = false repoints the references of files that were
--        already moved (e.g. by hand in the dashboard).
--      * switch_contracts_bucket_to_project_policy(): only when no
--        unmoved file remains, makes sure "Project members can read
--        contract files by project" exists and drops the org-wide
--        "Org members can read contracts" (195 §2). Called once below:
--        while files remain it raises a NOTICE and changes nothing.
--
-- 4. Budget regions (Film Commission budget by region).
--      * budget_lines.region and projects.default_region: one of the 13
--        KSA regions (public.ksa_region_list()); names / main cities in
--        English or Arabic are normalised (ksa_region_normalize). A line
--        without a region uses the project default. Budget drafts copy it
--        (create_budget_draft, copy of 140). v_active_budget_lines gains
--        the column (appended).
--      * set_project_default_region(project, region) — Film Commission
--        settings admins (can_admin_rebate_settings, 197).
--      * get_budget_by_region(project): estimate vs actual (and QPE
--        actual) per region. Actual of a transaction = its spend city's
--        region, else the region of its budget code's line, else the
--        project default; spend outside KSA is its own row.
--
-- 5. WHT rates (wht_rate_rules, 090/172): new columns label_en, label_ar,
--    source_note, sort_order; platform rows for the Saudi WHT schedule
--    (management fees 20%, royalties 15%, technical / consulting 5%,
--    rent 5%, air tickets & air / sea freight 5%, international telecom 5%,
--    insurance / reinsurance 5%, dividends 5%, loan returns 5%, related
--    party services 5% (Ministerial Resolution: technical / consulting at
--    5% whoever the provider), any other payments 15%). Editable by super
--    admins (platform rows) and org admins (their own rows, which win).
--    The existing 'default' row (5%) is kept so signed contracts and the
--    form default do not change: choosing a service type gives its rate.
--
-- SECURITY: new SECURITY DEFINER functions (all derive organization /
-- project from the row's own project, never from a client-sent column),
-- triggers on financial tables, a storage policy switch — per SECURITY.md
-- apply only after owner approval.
--
-- Owner steps after applying (after a backup):
--   1. for every project initialised by 182:
--        SELECT public.ledger_resync_project('<project id>');
--        SELECT public.ledger_phases_match('<project id>');   -- must be true
--      (re-posts approved Exclusive instalments with the 7099 line; nothing
--       else changes because existing invoices are 'approved').
--   2. contracts bucket: as a super admin open Settings → Organization →
--      "Contract files" and run the dry run; review orphans / conflicts;
--      then "Move files". Or from the SQL editor:
--        SELECT * FROM public.move_contract_files_to_project_folders(true);
--      When the list is empty:
--        SELECT public.switch_contracts_bucket_to_project_policy();
--   3. Settings → Project → Film Commission: set the project's default
--      region; set a region on budget lines shot elsewhere.
--   4. Review the WHT rates with the tax adviser (Settings → Organization).
--
-- Rollback (in this order):
--   DROP TRIGGER zz_trg_invoice_approval ON public.invoices;
--   DROP TRIGGER trg_invoice_delete_guard ON public.invoices;
--   DROP TRIGGER trg_payment_request_validate_zz_invoice ON public.payment_requests;
--   DROP TRIGGER trg_payments_invoice_approved ON public.payments;
--   DROP TRIGGER zz_trg_petty_receipt_approval ON public.cash_advance_receipts;
--   DROP TRIGGER trg_petty_receipt_delete_guard ON public.cash_advance_receipts;
--   DROP TRIGGER trg_budget_lines_region ON public.budget_lines;
--   DROP TRIGGER trg_projects_default_region ON public.projects;
--   re-run db/pending/199 (v_ledger_transactions), 196 sections 3 / 4 / 8
--     (v_payroll_instalments, v_journal_lines, get_funding_position,
--     get_cash_flow), 180 section 3 (sync_payroll_instalments), 140
--     (create_budget_draft); then SELECT ledger_resync_project(id) per
--     initialised project;
--   re-create v_active_budget_lines without region (DROP + CREATE: a column
--     cannot be removed with CREATE OR REPLACE);
--   DROP FUNCTION public.approve_invoice(uuid), public.reject_invoice(uuid, text),
--     public.cancel_invoice(uuid, text), public.can_approve_invoice(uuid),
--     public.enforce_invoice_approval(), public.guard_invoice_delete(),
--     public.require_approved_invoice_for_request(), public.require_approved_invoice_for_payment(),
--     public.cancel_petty_receipt(uuid, text), public.enforce_petty_receipt_approval(),
--     public.guard_petty_receipt_delete(), public.payroll_company_wht_split(numeric, numeric, numeric, text),
--     public.get_budget_by_region(uuid), public.set_project_default_region(uuid, text),
--     public.normalize_region_column(), public.ksa_region_normalize(text), public.ksa_region_list(),
--     public.switch_contracts_bucket_to_project_policy(boolean), public.repoint_contract_file(text, text),
--     public.move_contract_files_to_project_folders(boolean), public.contract_file_refs(),
--     public.contract_files_assert_admin();
--   ALTER TABLE public.cash_advance_receipts DROP CONSTRAINT cash_advance_receipts_status_chk;
--   ALTER TABLE public.cash_advance_receipts ADD CONSTRAINT cash_advance_receipts_status_chk
--     CHECK (status = ANY (ARRAY['pending','approved','rejected']));   (after re-labelling cancelled rows)
--   the new columns can stay or be dropped: invoices.approval_status, approved_by, approved_at,
--     rejected_by, rejected_at, rejection_reason, cancelled_by, cancelled_at, cancellation_reason;
--     cash_advance_receipts.cancelled_by, cancelled_at, cancellation_reason;
--     payroll_instalments.company_wht; budget_lines.region; projects.default_region;
--     wht_rate_rules.label_en, label_ar, source_note, sort_order;
--   DELETE FROM public.wht_rate_rules WHERE organization_id IS NULL AND notes = 'seed 201';
--   (storage) re-create "Org members can read contracts" from
--     supabase/migrations/20260621114631_*.sql if it was dropped.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Decision 12 — the line / 7099 split
-- ---------------------------------------------------------------------
-- p_actual = Actual on the contract (gross basis, payroll_contract_actual).
-- Exclusive contract with WHT (total > net > 0):
--   line_actual     = actual × net / total (rounded)   → the contract line
--   wht_actual      = actual − line_actual              → 7099
--   line_commitment = net − line_actual (≤ remaining)   → the contract line
--   wht_commitment  = remaining − line_commitment       → 7099
-- so line_actual + line_commitment = net and wht_actual + wht_commitment
-- = total − net exactly. Anything else: the whole amount stays on the line.
CREATE OR REPLACE FUNCTION public.payroll_company_wht_split(
  p_actual numeric, p_total numeric, p_net numeric, p_treatment text,
  OUT line_actual numeric, OUT wht_actual numeric, OUT line_commitment numeric, OUT wht_commitment numeric)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH x AS (
    SELECT COALESCE(p_actual, 0) AS a,
           GREATEST(COALESCE(p_total, 0) - COALESCE(p_actual, 0), 0) AS rem,
           (p_treatment = 'exclusive' AND COALESCE(p_net, 0) > 0 AND COALESCE(p_total, 0) > p_net) AS cw
  ), y AS (
    SELECT x.*, CASE WHEN x.cw THEN round(x.a * p_net / p_total, 2) ELSE x.a END AS la FROM x
  ), z AS (
    SELECT y.*, CASE WHEN y.cw THEN LEAST(y.rem, GREATEST(p_net - y.la, 0)) ELSE y.rem END AS lc FROM y
  )
  SELECT z.la, z.a - z.la, z.lc, z.rem - z.lc FROM z
$$;
GRANT EXECUTE ON FUNCTION public.payroll_company_wht_split(numeric, numeric, numeric, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.payroll_company_wht_split(numeric, numeric, numeric, text) IS
  'Decision 12 (db/pending/201): split of a contract''s Actual / Commitment between its own budget line (net) and code 7099 (company-borne WHT of an Exclusive / gross-up contract).';

-- ---------------------------------------------------------------------
-- 2. payroll_instalments.company_wht (copy of 180 sync, changes "201")
-- ---------------------------------------------------------------------
ALTER TABLE public.payroll_instalments ADD COLUMN IF NOT EXISTS company_wht numeric(14,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.payroll_instalments.company_wht IS
  'Decision 12 (db/pending/201): part of amount_gross charged to budget code 7099 (company-borne WHT of an Exclusive contract, = amount_gross − amount); 0 for Inclusive contracts. The contract line carries amount_gross − company_wht.';

CREATE OR REPLACE FUNCTION public.sync_payroll_instalments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
  v_base  numeric;
  v_scale numeric;
  v_cw    boolean;                                                          -- 201
  v_org   uuid;                                                             -- 201
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;   -- rows go with the payroll row (ON DELETE CASCADE)
  END IF;
  v_total := COALESCE(NEW.total_amount, 0);
  v_base  := COALESCE(NULLIF(NEW.net_payable, 0), NEW.total_amount, 0);
  v_scale := CASE WHEN v_base > 0 THEN v_total / v_base ELSE 1 END;
  -- 201: company-borne WHT only on an Exclusive contract that carries WHT
  v_cw    := NEW.wht_treatment = 'exclusive' AND COALESCE(NEW.net_payable, 0) > 0 AND v_total > NEW.net_payable;
  -- 201: the organization comes from the contract's project, not from the row
  v_org   := COALESCE((SELECT pr.organization_id FROM public.projects pr WHERE pr.id = NEW.project_id), NEW.organization_id);

  DELETE FROM public.payroll_instalments pi
   WHERE pi.payroll_id = NEW.id
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(NEW.payment_schedule) = 'array' THEN NEW.payment_schedule ELSE '[]'::jsonb END) e
                      WHERE e->>'id' = pi.milestone_id);

  INSERT INTO public.payroll_instalments AS pi
    (payroll_id, milestone_id, organization_id, project_id, seq, label, due_date, amount, amount_gross,
     status, stored_status, payment_request_id, request_status, approved_at, paid_date, budget_code,
     contract_cancelled, company_wht, updated_at)
  SELECT NEW.id, e->>'id', v_org, NEW.project_id, ord::int,
         NULLIF(btrim(e->>'label'), ''),
         CASE WHEN COALESCE(e->>'dueDate', e->>'due_date', '') ~ '^\d{4}-\d{2}-\d{2}'
              THEN left(COALESCE(e->>'dueDate', e->>'due_date'), 10)::date END,
         am.net,
         am.gross,
         public.instalment_status_word(e->>'status'),
         e->>'status',
         q.id, q.status, q.approved_at,
         CASE WHEN e->>'status' = 'Paid' AND COALESCE(e->>'paidDate', '') ~ '^\d{4}-\d{2}-\d{2}'
              THEN left(e->>'paidDate', 10)::date END,
         NEW.budget_code,
         NEW.contract_cancelled_at IS NOT NULL,
         CASE WHEN v_cw THEN GREATEST(am.gross - am.net, 0) ELSE 0 END,    -- 201
         now()
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(NEW.payment_schedule) = 'array' THEN NEW.payment_schedule ELSE '[]'::jsonb END)
         WITH ORDINALITY AS t(e, ord)
    CROSS JOIN LATERAL (                                                    -- 201: computed once
      SELECT public.payroll_milestone_amount(e, v_base) AS net,
             round(CASE WHEN NULLIF(e->>'amount', '') IS NOT NULL THEN (e->>'amount')::numeric * v_scale
                        ELSE v_total * COALESCE(NULLIF(e->>'percent', '')::numeric, 0) / 100 END, 2) AS gross) am
    LEFT JOIN LATERAL (
      SELECT r.id, r.status, r.approved_at FROM public.payment_requests r
       WHERE r.source_type = 'payroll_row' AND r.source_id = NEW.id AND r.payroll_milestone_id = e->>'id'
         AND r.organization_id = v_org                                      -- 201: own tenant only
       ORDER BY (r.status IN ('rejected', 'cancelled')), r.created_at DESC
       LIMIT 1) q ON true
   WHERE NULLIF(e->>'id', '') IS NOT NULL
  ON CONFLICT (payroll_id, milestone_id) DO UPDATE
     SET organization_id = EXCLUDED.organization_id, project_id = EXCLUDED.project_id,
         seq = EXCLUDED.seq, label = EXCLUDED.label, due_date = EXCLUDED.due_date,
         amount = EXCLUDED.amount, amount_gross = EXCLUDED.amount_gross,
         status = EXCLUDED.status, stored_status = EXCLUDED.stored_status,
         payment_request_id = EXCLUDED.payment_request_id, request_status = EXCLUDED.request_status,
         approved_at = EXCLUDED.approved_at, paid_date = EXCLUDED.paid_date,
         budget_code = EXCLUDED.budget_code, contract_cancelled = EXCLUDED.contract_cancelled,
         company_wht = EXCLUDED.company_wht,                                -- 201
         updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_payroll_instalments() FROM PUBLIC, anon, authenticated;

-- Backfill the new column (before the ledger rules change below, so an
-- initialised ledger sees no difference yet; the owner resyncs afterwards).
UPDATE public.payroll_instalments pi
   SET company_wht = GREATEST(pi.amount_gross - pi.amount, 0)
  FROM public.payroll p
 WHERE p.id = pi.payroll_id
   AND p.wht_treatment = 'exclusive' AND COALESCE(p.net_payable, 0) > 0 AND COALESCE(p.total_amount, 0) > p.net_payable
   AND pi.company_wht IS DISTINCT FROM GREATEST(pi.amount_gross - pi.amount, 0);

-- ---------------------------------------------------------------------
-- 3. Invoice approval (maker-checker)
-- ---------------------------------------------------------------------
-- Existing invoices are approved (they already count as Actual); the column
-- is added with that default (no row is rewritten, no trigger fires), then
-- the default becomes 'pending' for new invoices.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.invoices ALTER COLUMN approval_status SET DEFAULT 'pending';
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_approval_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected', 'cancelled'));
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_approval_reasons_len;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_approval_reasons_len
  CHECK ((rejection_reason IS NULL OR length(rejection_reason) <= 1000)
     AND (cancellation_reason IS NULL OR length(cancellation_reason) <= 1000));
CREATE INDEX IF NOT EXISTS idx_invoices_project_approval ON public.invoices (project_id, approval_status);
COMMENT ON COLUMN public.invoices.approval_status IS
  'pending (recorded = Commitment) → approved (Actual, locked) | rejected; approved → cancelled (recorded cancellation instead of a delete). db/pending/201.';

-- Can the signed-in user approve / reject / cancel invoices of this project?
-- Super admin, org admin, or — when the organization has an approval chain —
-- a person matching one of its levels (and a member of the project).
-- Only answers for the caller; the organization comes from the project.
CREATE OR REPLACE FUNCTION public.can_approve_invoice(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.projects pr
     WHERE pr.id = p_project
       AND (public.is_super_admin(auth.uid())
            OR public.is_org_admin(auth.uid(), pr.organization_id)
            OR (public.can_access_project(auth.uid(), pr.organization_id, pr.id)
                AND EXISTS (SELECT 1 FROM public.payment_approval_levels l
                             WHERE l.organization_id = pr.organization_id
                               AND public.payment_approver_matches(auth.uid(), pr.organization_id, pr.id,
                                                                   l.approver_kind, l.role_id)))))
$$;
REVOKE ALL ON FUNCTION public.can_approve_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_approve_invoice(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_invoice_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old text;
  v_new text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NULL THEN                       -- server jobs / SQL editor / imports
      IF NEW.approval_status = 'approved' AND NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
      RETURN NEW;
    END IF;
    IF NEW.approval_status IN ('approved', 'cancelled') THEN
      RAISE EXCEPTION 'Maker-checker: a new invoice is recorded as pending — another user must approve it'
        USING ERRCODE = '42501';
    END IF;
    NEW.approval_status := 'pending';           -- also a rejected row restored from the trash
    NEW.created_by := v_uid;
    NEW.approved_by := NULL;  NEW.approved_at := NULL;
    NEW.rejected_by := NULL;  NEW.rejected_at := NULL;  NEW.rejection_reason := NULL;
    NEW.cancelled_by := NULL; NEW.cancelled_at := NULL; NEW.cancellation_reason := NULL;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN RETURN NEW; END IF;
  v_old := OLD.approval_status;
  v_new := NEW.approval_status;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'invoices: created_by cannot be changed' USING ERRCODE = '42501';
  END IF;

  -- X09: an approved (or cancelled) invoice is locked
  IF v_old IN ('approved', 'cancelled') AND (
       NEW.price IS DISTINCT FROM OLD.price
    OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
    OR NEW.wht_amount IS DISTINCT FROM OLD.wht_amount
    OR NEW.wht_percent IS DISTINCT FROM OLD.wht_percent
    OR NEW.net_payable IS DISTINCT FROM OLD.net_payable
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.fx_rate IS DISTINCT FROM OLD.fx_rate
    OR NEW.amount_original IS DISTINCT FROM OLD.amount_original
    OR NEW.vendor_name IS DISTINCT FROM OLD.vendor_name
    OR (OLD.vendor_id IS NOT NULL AND NEW.vendor_id IS DISTINCT FROM OLD.vendor_id)
    OR NEW.budget_code IS DISTINCT FROM OLD.budget_code
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
    RAISE EXCEPTION 'invoices: an approved invoice cannot be changed (amount, vendor, budget code) — cancel it and record a new one'
      USING ERRCODE = '42501';
  END IF;

  IF v_new IS DISTINCT FROM v_old THEN
    IF v_old = 'pending' AND v_new IN ('approved', 'rejected') THEN
      IF OLD.created_by IS NOT NULL AND OLD.created_by = v_uid THEN
        RAISE EXCEPTION 'Maker-checker: an invoice must be approved or rejected by someone other than the person who recorded it'
          USING ERRCODE = '42501';
      END IF;
      IF NOT public.can_approve_invoice(OLD.project_id) THEN
        RAISE EXCEPTION 'invoices: only an approver of this organization can approve or reject invoices'
          USING ERRCODE = '42501';
      END IF;
      IF v_new = 'approved' THEN
        NEW.approved_by := v_uid; NEW.approved_at := now();
        NEW.rejected_by := NULL;  NEW.rejected_at := NULL; NEW.rejection_reason := NULL;
      ELSE
        IF NULLIF(btrim(COALESCE(NEW.rejection_reason, '')), '') IS NULL THEN
          RAISE EXCEPTION 'invoices: a reason is required to reject an invoice' USING ERRCODE = '22023';
        END IF;
        NEW.rejection_reason := btrim(NEW.rejection_reason);
        NEW.rejected_by := v_uid; NEW.rejected_at := now();
        NEW.approved_by := NULL;  NEW.approved_at := NULL;
      END IF;
    ELSIF v_old = 'rejected' AND v_new = 'pending' THEN
      -- corrected and sent again
      NEW.rejected_by := NULL; NEW.rejected_at := NULL;
    ELSIF v_old = 'approved' AND v_new = 'cancelled' THEN
      IF NOT public.can_approve_invoice(OLD.project_id) THEN
        RAISE EXCEPTION 'invoices: only an approver of this organization can cancel an approved invoice'
          USING ERRCODE = '42501';
      END IF;
      IF NULLIF(btrim(COALESCE(NEW.cancellation_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'invoices: a reason is required to cancel an approved invoice' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.payments pm
                  WHERE pm.source_type = 'invoice' AND pm.source_id = OLD.id
                    AND pm.project_id IS NOT DISTINCT FROM OLD.project_id) THEN
        RAISE EXCEPTION 'invoices: this invoice has payments — record a refund / credit note instead of cancelling it'
          USING ERRCODE = '42501';
      END IF;
      IF EXISTS (SELECT 1 FROM public.payment_requests r
                  WHERE r.source_type = 'invoice' AND r.source_id = OLD.id
                    AND r.organization_id = OLD.organization_id
                    AND r.status NOT IN ('rejected', 'cancelled')) THEN
        RAISE EXCEPTION 'invoices: cancel or reject the payment request of this invoice first'
          USING ERRCODE = '42501';
      END IF;
      NEW.cancellation_reason := btrim(NEW.cancellation_reason);
      NEW.cancelled_by := v_uid; NEW.cancelled_at := now();
    ELSE
      RAISE EXCEPTION 'invoices: the approval status cannot go from % to %', v_old, v_new
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- same status: the stamps are written by the database only
    NEW.approved_by := OLD.approved_by;   NEW.approved_at := OLD.approved_at;
    NEW.rejected_by := OLD.rejected_by;   NEW.rejected_at := OLD.rejected_at;
    NEW.cancelled_by := OLD.cancelled_by; NEW.cancelled_at := OLD.cancelled_at;
    IF v_old IN ('approved', 'cancelled') THEN
      NEW.rejection_reason := OLD.rejection_reason;
      NEW.cancellation_reason := OLD.cancellation_reason;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_invoice_approval() FROM PUBLIC, anon, authenticated;
-- zz_: after the other BEFORE triggers (money precision, AP defaults, vendor inherit) changed NEW
DROP TRIGGER IF EXISTS zz_trg_invoice_approval ON public.invoices;
CREATE TRIGGER zz_trg_invoice_approval BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_approval();

-- X08: an approved / cancelled invoice is never deleted (a project or
-- organization being deleted takes its invoices with it).
CREATE OR REPLACE FUNCTION public.guard_invoice_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.approval_status IN ('approved', 'cancelled')
     AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    RAISE EXCEPTION 'invoices: an approved invoice cannot be deleted — cancel it instead (the cancellation is recorded)'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.guard_invoice_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_invoice_delete_guard ON public.invoices;
CREATE TRIGGER trg_invoice_delete_guard BEFORE DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_delete();

-- RPCs (SECURITY INVOKER: the row is reached through the invoices RLS, the
-- trigger above applies every rule and writes the stamps).
CREATE OR REPLACE FUNCTION public.approve_invoice(p_invoice uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  UPDATE public.invoices SET approval_status = 'approved'
   WHERE id = p_invoice AND approval_status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_invoice: no pending invoice with this id in your projects' USING ERRCODE = '22023';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.reject_invoice(p_invoice uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'reject_invoice: a reason (up to 1000 characters) is required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.invoices SET approval_status = 'rejected', rejection_reason = btrim(p_reason)
   WHERE id = p_invoice AND approval_status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reject_invoice: no pending invoice with this id in your projects' USING ERRCODE = '22023';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.cancel_invoice(p_invoice uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'cancel_invoice: a reason (up to 1000 characters) is required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.invoices SET approval_status = 'cancelled', cancellation_reason = btrim(p_reason)
   WHERE id = p_invoice AND approval_status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_invoice: no approved invoice with this id in your projects' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.approve_invoice(uuid), public.reject_invoice(uuid, text), public.cancel_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_invoice(uuid), public.reject_invoice(uuid, text), public.cancel_invoice(uuid, text) TO authenticated, service_role;

-- A payment request on an invoice needs the invoice approved. Fires after
-- trg_payment_request_validate_source (176, name order), which already
-- refused a document of another organization / project.
CREATE OR REPLACE FUNCTION public.require_approved_invoice_for_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.source_type IS DISTINCT FROM 'invoice'
     OR NEW.status IN ('rejected', 'cancelled') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id
     AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices i
                  WHERE i.id = NEW.source_id
                    AND i.organization_id = NEW.organization_id
                    AND i.project_id IS NOT DISTINCT FROM COALESCE(NEW.project_id, i.project_id)
                    AND i.approval_status = 'approved') THEN
    RAISE EXCEPTION 'Invoice not approved: a payment can be requested only after the invoice is approved'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_approved_invoice_for_request() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payment_request_validate_zz_invoice ON public.payment_requests;
CREATE TRIGGER trg_payment_request_validate_zz_invoice
  BEFORE INSERT OR UPDATE OF status, source_type, source_id ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.require_approved_invoice_for_request();

-- A payment recorded on an invoice needs the invoice approved too.
CREATE OR REPLACE FUNCTION public.require_approved_invoice_for_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.source_type IS DISTINCT FROM 'invoice' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id
     AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices i
                  WHERE i.id = NEW.source_id
                    AND i.project_id IS NOT DISTINCT FROM NEW.project_id
                    AND i.approval_status = 'approved') THEN
    RAISE EXCEPTION 'Invoice not approved: a payment can be recorded only on an approved invoice of this project'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_approved_invoice_for_payment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payments_invoice_approved ON public.payments;
CREATE TRIGGER trg_payments_invoice_approved
  BEFORE INSERT OR UPDATE OF source_type, source_id ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.require_approved_invoice_for_payment();

-- ---------------------------------------------------------------------
-- 4. Petty cash receipts: lock after approval, cancellation not delete
-- ---------------------------------------------------------------------
ALTER TABLE public.cash_advance_receipts
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE public.cash_advance_receipts DROP CONSTRAINT IF EXISTS cash_advance_receipts_status_chk;
ALTER TABLE public.cash_advance_receipts ADD CONSTRAINT cash_advance_receipts_status_chk
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]));
ALTER TABLE public.cash_advance_receipts DROP CONSTRAINT IF EXISTS cash_advance_receipts_cancellation_reason_len;
ALTER TABLE public.cash_advance_receipts ADD CONSTRAINT cash_advance_receipts_cancellation_reason_len
  CHECK (cancellation_reason IS NULL OR length(cancellation_reason) <= 1000);

CREATE OR REPLACE FUNCTION public.enforce_petty_receipt_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NULL THEN
      IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
      RETURN NEW;
    END IF;
    IF NEW.status IN ('approved', 'cancelled') THEN
      RAISE EXCEPTION 'A petty cash receipt is logged as pending — it is approved separately' USING ERRCODE = '42501';
    END IF;
    NEW.approved_by := NULL; NEW.approved_at := NULL;
    NEW.cancelled_by := NULL; NEW.cancelled_at := NULL; NEW.cancellation_reason := NULL;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN RETURN NEW; END IF;

  IF OLD.status IN ('approved', 'cancelled') AND (
       NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.fx_rate IS DISTINCT FROM OLD.fx_rate
    OR NEW.budget_code IS DISTINCT FROM OLD.budget_code
    OR NEW.vendor IS DISTINCT FROM OLD.vendor
    OR NEW.recipient IS DISTINCT FROM OLD.recipient
    OR NEW.advance_id IS DISTINCT FROM OLD.advance_id
    OR NEW.date IS DISTINCT FROM OLD.date
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
    RAISE EXCEPTION 'An approved petty cash receipt cannot be changed — cancel it and log a new one'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
      NEW.approved_by := v_uid; NEW.approved_at := now();
    ELSIF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
      NEW.approved_by := NULL; NEW.approved_at := NULL;
    ELSIF OLD.status = 'rejected' AND NEW.status = 'pending' THEN
      NULL;
    ELSIF OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
      IF NOT (public.is_super_admin(v_uid)
              OR public.is_org_admin(v_uid, (SELECT p.organization_id FROM public.projects p WHERE p.id = OLD.project_id))
              OR OLD.approved_by = v_uid) THEN
        RAISE EXCEPTION 'Only an organization admin or the approver can cancel an approved receipt' USING ERRCODE = '42501';
      END IF;
      IF NULLIF(btrim(COALESCE(NEW.cancellation_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'A reason is required to cancel an approved receipt' USING ERRCODE = '22023';
      END IF;
      NEW.cancellation_reason := btrim(NEW.cancellation_reason);
      NEW.cancelled_by := v_uid; NEW.cancelled_at := now();
    ELSE
      RAISE EXCEPTION 'A petty cash receipt cannot go from % to % (an approved receipt is cancelled, not reopened)',
        OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
  ELSE
    NEW.approved_by := OLD.approved_by;   NEW.approved_at := OLD.approved_at;
    NEW.cancelled_by := OLD.cancelled_by; NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancellation_reason := OLD.cancellation_reason;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_petty_receipt_approval() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_trg_petty_receipt_approval ON public.cash_advance_receipts;
CREATE TRIGGER zz_trg_petty_receipt_approval BEFORE INSERT OR UPDATE ON public.cash_advance_receipts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_petty_receipt_approval();

CREATE OR REPLACE FUNCTION public.guard_petty_receipt_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.status IN ('approved', 'cancelled')
     AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    RAISE EXCEPTION 'An approved petty cash receipt cannot be deleted — cancel it instead (the cancellation is recorded)'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.guard_petty_receipt_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_petty_receipt_delete_guard ON public.cash_advance_receipts;
CREATE TRIGGER trg_petty_receipt_delete_guard BEFORE DELETE ON public.cash_advance_receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_petty_receipt_delete();

CREATE OR REPLACE FUNCTION public.cancel_petty_receipt(p_receipt uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'cancel_petty_receipt: a reason (up to 1000 characters) is required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cash_advance_receipts SET status = 'cancelled', cancellation_reason = btrim(p_reason)
   WHERE id = p_receipt AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_petty_receipt: no approved receipt with this id in your projects' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cancel_petty_receipt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_petty_receipt(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Views — v_ledger_transactions (copy of 199), v_payroll_instalments and
--    v_journal_lines (copies of 196); changed lines marked "201"
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ledger_transactions WITH (security_invoker = on) AS
 SELECT i.id,
    'invoice'::text AS source_type,
    i.id AS source_id,
    CASE WHEN i.approval_status = 'approved' THEN 'actual' ELSE 'commitment' END AS entry_kind,   -- 201
    i.date AS entry_date,
    COALESCE(i.ref_no, i.invoice_no) AS reference,                    -- 196
    i.description,
    i.vendor_name AS counterparty,
    i.budget_code,
    i.gl_account_id,
    i.department,
    COALESCE(i.price, 0::numeric) AS amount,
    COALESCE(i.vat_amount, 0::numeric) AS vat_amount,
    COALESCE(i.net_payable, COALESCE(i.price, 0::numeric) + COALESCE(i.vat_amount, 0::numeric)) AS total,
    org.base_currency AS currency,
    i.approval_status AS status,                                          -- 201
    COALESCE(i.rebate_eligible, false) AS qfe_eligible,
    i.organization_id,
    i.project_id,
    i.created_at,
    COALESCE(i.wht_amount, 0::numeric) AS wht_amount,
    i.ref_no AS ref_no,                                                  -- 196
    i.id::text || ':' || CASE WHEN i.approval_status = 'approved' THEN 'actual' ELSE 'commitment' END AS row_key   -- 201
   FROM public.invoices i
     LEFT JOIN public.organizations org ON org.id = i.organization_id
  WHERE i.approval_status IN ('approved', 'pending')                       -- 201: rejected / cancelled count nowhere
UNION ALL
 -- 180: payroll = Actual for Approved / Paid instalments only
 -- 201 (decision 12): an Exclusive (gross-up) contract carries its NET share on
 --     its own line; the company-borne WHT share is the payroll_wht row below
 SELECT p.id,
    'payroll'::text AS source_type,
    p.id AS source_id,
    'actual'::text AS entry_kind,
    p.created_at::date AS entry_date,
    COALESCE(p.ref_no, CASE                                               -- 196
            WHEN p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN NULL::text
            ELSE p.ref_id
        END) AS reference,
    p.kind AS description,
    p.name AS counterparty,
    p.budget_code,
    p.gl_account_id,
    NULL::text AS department,
    sp.line_actual AS amount,                                             -- 201
    0::numeric AS vat_amount,
    sp.line_actual AS total,                                              -- 201
    org.base_currency AS currency,
    'Approved'::text AS status,
    false AS qfe_eligible,
    p.organization_id,
    p.project_id,
    p.created_at,
    CASE WHEN sp.wht_actual <> 0 THEN 0::numeric                          -- 201: the WHT is on the 7099 row
         WHEN COALESCE(p.total_amount, 0) > 0
         THEN round(COALESCE(p.wht_amount, 0::numeric) * pc.actual / p.total_amount, 2)
         ELSE 0::numeric END AS wht_amount,
    p.ref_no AS ref_no,                                                  -- 196
    p.id::text || ':' || 'actual' AS row_key                       -- 196
   FROM public.payroll p
     LEFT JOIN public.organizations org ON org.id = p.organization_id
     CROSS JOIN LATERAL (SELECT public.payroll_contract_actual(p.payment_schedule, p.total_amount, p.net_payable,
                                  CASE WHEN jsonb_array_length(COALESCE(p.payment_schedule, '[]'::jsonb)) = 0
                                       THEN public.payroll_legacy_paid(p.id, p.payments, p.percents, p.total_amount)
                                       ELSE 0 END) AS actual) pc
     CROSS JOIN LATERAL public.payroll_company_wht_split(pc.actual, p.total_amount, p.net_payable, p.wht_treatment) sp   -- 201
  WHERE COALESCE(p.ref_id, '') NOT LIKE 'invoice:%'
    AND pc.actual <> 0
UNION ALL
 -- 201: company-borne WHT of the approved part, charged to budget code 7099
 SELECT p.id,
    'payroll_wht'::text AS source_type,
    p.id AS source_id,
    'actual'::text AS entry_kind,
    p.created_at::date AS entry_date,
    COALESCE(p.ref_no, CASE
            WHEN p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN NULL::text
            ELSE p.ref_id
        END) AS reference,
    p.kind AS description,
    p.name AS counterparty,
    '7099'::text AS budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    sp.wht_actual AS amount,
    0::numeric AS vat_amount,
    sp.wht_actual AS total,
    org.base_currency AS currency,
    'Approved'::text AS status,
    false AS qfe_eligible,
    p.organization_id,
    p.project_id,
    p.created_at,
    sp.wht_actual AS wht_amount,
    p.ref_no AS ref_no,
    p.id::text || ':wht:' || 'actual' AS row_key
   FROM public.payroll p
     LEFT JOIN public.organizations org ON org.id = p.organization_id
     CROSS JOIN LATERAL (SELECT public.payroll_contract_actual(p.payment_schedule, p.total_amount, p.net_payable,
                                  CASE WHEN jsonb_array_length(COALESCE(p.payment_schedule, '[]'::jsonb)) = 0
                                       THEN public.payroll_legacy_paid(p.id, p.payments, p.percents, p.total_amount)
                                       ELSE 0 END) AS actual) pc
     CROSS JOIN LATERAL public.payroll_company_wht_split(pc.actual, p.total_amount, p.net_payable, p.wht_treatment) sp
  WHERE COALESCE(p.ref_id, '') NOT LIKE 'invoice:%'
    AND sp.wht_actual <> 0
UNION ALL
 -- 180: payroll = Commitment for the rest of the contract (none once cancelled)
 SELECT p.id,
    'payroll'::text AS source_type,
    p.id AS source_id,
    'commitment'::text AS entry_kind,
    p.created_at::date AS entry_date,
    COALESCE(p.ref_no, CASE                                               -- 196
            WHEN p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN NULL::text
            ELSE p.ref_id
        END) AS reference,
    p.kind AS description,
    p.name AS counterparty,
    p.budget_code,
    p.gl_account_id,
    NULL::text AS department,
    sp.line_commitment AS amount,                                         -- 201
    0::numeric AS vat_amount,
    sp.line_commitment AS total,                                          -- 201
    org.base_currency AS currency,
    'Pending'::text AS status,
    false AS qfe_eligible,
    p.organization_id,
    p.project_id,
    p.created_at,
    0::numeric AS wht_amount,
    p.ref_no AS ref_no,                                                  -- 196
    p.id::text || ':' || 'commitment' AS row_key                       -- 196
   FROM public.payroll p
     LEFT JOIN public.organizations org ON org.id = p.organization_id
     CROSS JOIN LATERAL (SELECT public.payroll_contract_actual(p.payment_schedule, p.total_amount, p.net_payable,
                                  CASE WHEN jsonb_array_length(COALESCE(p.payment_schedule, '[]'::jsonb)) = 0
                                       THEN public.payroll_legacy_paid(p.id, p.payments, p.percents, p.total_amount)
                                       ELSE 0 END) AS actual) pc
     CROSS JOIN LATERAL public.payroll_company_wht_split(pc.actual, p.total_amount, p.net_payable, p.wht_treatment) sp   -- 201
  WHERE COALESCE(p.ref_id, '') NOT LIKE 'invoice:%'
    AND p.contract_cancelled_at IS NULL
    AND sp.line_commitment > 0
UNION ALL
 -- 201: company-borne WHT of the rest of the contract, committed on 7099
 SELECT p.id,
    'payroll_wht'::text AS source_type,
    p.id AS source_id,
    'commitment'::text AS entry_kind,
    p.created_at::date AS entry_date,
    COALESCE(p.ref_no, CASE
            WHEN p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN NULL::text
            ELSE p.ref_id
        END) AS reference,
    p.kind AS description,
    p.name AS counterparty,
    '7099'::text AS budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    sp.wht_commitment AS amount,
    0::numeric AS vat_amount,
    sp.wht_commitment AS total,
    org.base_currency AS currency,
    'Pending'::text AS status,
    false AS qfe_eligible,
    p.organization_id,
    p.project_id,
    p.created_at,
    0::numeric AS wht_amount,
    p.ref_no AS ref_no,
    p.id::text || ':wht:' || 'commitment' AS row_key
   FROM public.payroll p
     LEFT JOIN public.organizations org ON org.id = p.organization_id
     CROSS JOIN LATERAL (SELECT public.payroll_contract_actual(p.payment_schedule, p.total_amount, p.net_payable,
                                  CASE WHEN jsonb_array_length(COALESCE(p.payment_schedule, '[]'::jsonb)) = 0
                                       THEN public.payroll_legacy_paid(p.id, p.payments, p.percents, p.total_amount)
                                       ELSE 0 END) AS actual) pc
     CROSS JOIN LATERAL public.payroll_company_wht_split(pc.actual, p.total_amount, p.net_payable, p.wht_treatment) sp
  WHERE COALESCE(p.ref_id, '') NOT LIKE 'invoice:%'
    AND p.contract_cancelled_at IS NULL
    AND sp.wht_commitment > 0
UNION ALL
 SELECT po.id,
    'purchase_order'::text AS source_type,
    po.id AS source_id,
    'commitment'::text AS entry_kind,
    po.date AS entry_date,
    COALESCE(po.ref_no, po.po_number) AS reference,                   -- 196
    po.description,
    po.vendor_name AS counterparty,
    po.budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    GREATEST(COALESCE(po.amount, 0::numeric) - COALESCE(inv.invoiced, 0::numeric), 0::numeric) AS amount,
    0::numeric AS vat_amount,
    GREATEST(COALESCE(po.amount, 0::numeric) - COALESCE(inv.invoiced, 0::numeric), 0::numeric) AS total,
    org.base_currency AS currency,
    po.status,
    false AS qfe_eligible,
    po.organization_id,
    po.project_id,
    po.created_at,
    0::numeric AS wht_amount,
    po.ref_no AS ref_no,                                                  -- 196
    po.id::text || ':' || 'commitment' AS row_key                       -- 196
   FROM public.purchase_orders po
     LEFT JOIN public.organizations org ON org.id = po.organization_id
     LEFT JOIN LATERAL (
       SELECT sum(COALESCE(i2.price, 0::numeric)) AS invoiced
         FROM public.invoices i2 WHERE i2.purchase_order_id = po.id
            AND i2.approval_status IN ('approved', 'pending')        -- 201
     ) inv ON true
  WHERE public.po_is_commitment(po.status)
UNION ALL
 SELECT r.id,
    'petty_cash'::text AS source_type,
    r.id AS source_id,
    'actual'::text AS entry_kind,
    r.date AS entry_date,
    r.ref_no AS reference,                                              -- 196
    r.description,
    COALESCE(r.vendor, r.recipient) AS counterparty,
    r.budget_code,
    r.gl_account_id,
    r.department,
    public.amount_to_sar(r.amount, COALESCE(r.currency, 'SAR'), r.project_id) AS amount,         -- 199
    0::numeric AS vat_amount,
    public.amount_to_sar(r.amount, COALESCE(r.currency, 'SAR'), r.project_id) AS total,          -- 199
    COALESCE(org.base_currency, 'SAR') AS currency,                                               -- 199
    r.status,
    false AS qfe_eligible,
    r.organization_id,
    r.project_id,
    r.created_at,
    0::numeric AS wht_amount,
    r.ref_no AS ref_no,                                                  -- 196
    r.id::text || ':' || 'actual' AS row_key                       -- 196
   FROM public.cash_advance_receipts r
     LEFT JOIN public.organizations org ON org.id = r.organization_id
  WHERE r.status = 'approved'                                               -- 180
UNION ALL
 SELECT ot.id,
    'overtime'::text AS source_type,
    ot.id AS source_id,
    'actual'::text AS entry_kind,
    ot.work_date AS entry_date,
    ot.ref_no AS reference,                                              -- 196
    NULL::text AS description,
    ot.person_name AS counterparty,
    ot.budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    public.amount_to_sar(ot.amount, COALESCE(ot.currency, 'SAR'), ot.project_id) AS amount,      -- 199
    0::numeric AS vat_amount,
    public.amount_to_sar(ot.amount, COALESCE(ot.currency, 'SAR'), ot.project_id) AS total,       -- 199
    COALESCE(org.base_currency, 'SAR') AS currency,                                               -- 199
    ot.status,
    false AS qfe_eligible,
    ot.organization_id,
    ot.project_id,
    ot.created_at,
    0::numeric AS wht_amount,
    ot.ref_no AS ref_no,                                                  -- 196
    ot.id::text || ':' || 'actual' AS row_key                       -- 196
   FROM public.overtime_entries ot
     LEFT JOIN public.organizations org ON org.id = ot.organization_id
UNION ALL
 SELECT d.id,
    'per_diem'::text AS source_type,
    d.id AS source_id,
    'actual'::text AS entry_kind,
    d.period_start AS entry_date,
    d.ref_no AS reference,                                              -- 196
    'Per diem '::text || d.period_start || ' – '::text || d.period_end AS description,
    pe.full_name AS counterparty,
    d.budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    public.amount_to_sar(d.total_amount, COALESCE(d.currency, 'SAR'), d.project_id) AS amount,   -- 199
    0::numeric AS vat_amount,
    public.amount_to_sar(d.total_amount, COALESCE(d.currency, 'SAR'), d.project_id) AS total,    -- 199
    COALESCE(org.base_currency, 'SAR') AS currency,                                               -- 199
    d.status,
    false AS qfe_eligible,
    d.organization_id,
    d.project_id,
    d.created_at,
    0::numeric AS wht_amount,
    d.ref_no AS ref_no,                                                  -- 196
    d.id::text || ':' || 'actual' AS row_key                       -- 196
   FROM public.per_diem_ledger d
     LEFT JOIN public.people pe ON pe.id = d.person_id
     LEFT JOIN public.organizations org ON org.id = d.organization_id
UNION ALL
 SELECT pay.id,
    'payment'::text AS source_type,
    pay.source_id,
    'payment'::text AS entry_kind,
    pay.payment_date AS entry_date,
    pay.ref_no AS reference,                                              -- 196
    pay.source_type || ' payment'::text AS description,
    NULL::text AS counterparty,
    NULL::text AS budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    COALESCE(pay.amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(pay.amount, 0::numeric) AS total,
    org.base_currency AS currency,
    NULL::text AS status,
    false AS qfe_eligible,
    pay.organization_id,
    pay.project_id,
    pay.created_at,
    0::numeric AS wht_amount,
    pay.ref_no AS ref_no,                                                  -- 196
    pay.id::text || ':' || 'payment' AS row_key                       -- 196
   FROM public.payments pay
     LEFT JOIN public.organizations org ON org.id = pay.organization_id
UNION ALL
 SELECT cr.id,
    'car_rental'::text AS source_type,
    cr.id AS source_id,
    'commitment'::text AS entry_kind,
    cr.rental_start_date AS entry_date,
    cr.license_plate AS reference,
    cr.make_model AS description,
    cr.vendor_name AS counterparty,
    COALESCE(NULLIF(cr.budget_code, ''), bl.main_code) AS budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    GREATEST(round(COALESCE(cr.total_amount, 0::numeric)
                   * CASE WHEN upper(cr.currency) = 'USD' THEN COALESCE(pr.fx_rate, 3.75) ELSE 1 END, 2)
             - COALESCE(ci.price, 0::numeric), 0::numeric) AS amount,
    0::numeric AS vat_amount,
    GREATEST(round(COALESCE(cr.total_amount, 0::numeric)
                   * CASE WHEN upper(cr.currency) = 'USD' THEN COALESCE(pr.fx_rate, 3.75) ELSE 1 END, 2)
             - COALESCE(ci.price, 0::numeric), 0::numeric) AS total,
    org.base_currency AS currency,
    NULL::text AS status,
    false AS qfe_eligible,
    COALESCE(cr.organization_id, pr.organization_id) AS organization_id,
    cr.project_id,
    cr.created_at,
    0::numeric AS wht_amount,
    NULL::text AS ref_no,                                                  -- 196
    cr.id::text || ':' || 'commitment' AS row_key                       -- 196
   FROM public.car_rentals cr
     LEFT JOIN public.projects pr ON pr.id = cr.project_id
     LEFT JOIN public.organizations org ON org.id = COALESCE(cr.organization_id, pr.organization_id)
     LEFT JOIN public.budget_lines bl ON bl.id = cr.linked_budget_line_id
     LEFT JOIN public.invoices ci ON ci.id = cr.invoice_id AND ci.approval_status IN ('approved', 'pending')   -- 201
  WHERE COALESCE(cr.total_amount, 0) > 0
UNION ALL
 SELECT ac.id,
    'accommodation'::text AS source_type,
    ac.id AS source_id,
    'commitment'::text AS entry_kind,
    ac.check_in_date AS entry_date,
    ac.room_number AS reference,
    COALESCE(ac.hotel_name, 'Accommodation') || ' · ' || COALESCE(pe.full_name, '') AS description,
    COALESCE(ac.vendor_name, ac.hotel_name) AS counterparty,
    COALESCE(NULLIF(ac.budget_code, ''), bl.main_code) AS budget_code,
    NULL::uuid AS gl_account_id,
    NULL::text AS department,
    GREATEST(round(COALESCE(ac.total_amount, 0::numeric)
                   * CASE WHEN upper(ac.currency) = 'USD' THEN COALESCE(pr.fx_rate, 3.75) ELSE 1 END, 2)
             - COALESCE(ai.price, 0::numeric), 0::numeric) AS amount,
    0::numeric AS vat_amount,
    GREATEST(round(COALESCE(ac.total_amount, 0::numeric)
                   * CASE WHEN upper(ac.currency) = 'USD' THEN COALESCE(pr.fx_rate, 3.75) ELSE 1 END, 2)
             - COALESCE(ai.price, 0::numeric), 0::numeric) AS total,
    org.base_currency AS currency,
    NULL::text AS status,
    false AS qfe_eligible,
    COALESCE(ac.organization_id, pr.organization_id) AS organization_id,
    ac.project_id,
    ac.created_at,
    0::numeric AS wht_amount,
    NULL::text AS ref_no,                                                  -- 196
    ac.id::text || ':' || 'commitment' AS row_key                       -- 196
   FROM public.accommodations ac
     LEFT JOIN public.projects pr ON pr.id = ac.project_id
     LEFT JOIN public.organizations org ON org.id = COALESCE(ac.organization_id, pr.organization_id)
     LEFT JOIN public.people pe ON pe.id = ac.person_id
     LEFT JOIN public.budget_lines bl ON bl.id = ac.linked_budget_line_id
     LEFT JOIN public.invoices ai ON ai.id = ac.invoice_id AND ai.approval_status IN ('approved', 'pending')   -- 201
  WHERE COALESCE(ac.total_amount, 0) > 0;
COMMENT ON VIEW public.v_ledger_transactions IS
  'One row per cost document and kind. actual = APPROVED invoices, approved / paid contract instalments, approved petty-cash receipts, overtime, per diem; commitment = invoices still pending approval, the rest of each contract (none once cancelled), purchase orders (net of the pending / approved invoices raised on them, commitment states only), car rentals and accommodation (net of their linked invoice); payment = payments ledger. Decision 12 (db/pending/201): on an Exclusive (gross-up) contract the contract line carries the net and the company-borne WHT is a separate source_type payroll_wht row on budget code 7099 (actual and commitment). Rejected / cancelled invoices are not listed. Key rows by row_key. Amounts in SAR. Redefined by db/pending/201.';

-- 201: + line_amount / company_wht (appended)
CREATE OR REPLACE VIEW public.v_payroll_instalments WITH (security_invoker = on) AS
SELECT pi.payroll_id,
       pi.milestone_id,
       pi.seq AS ord,
       COALESCE(pi.label, 'P' || pi.seq) AS label,
       pi.status,
       pi.due_date::text AS due_date,
       pi.amount::numeric AS net_amount,
       pi.amount_gross::numeric AS gross_amount,
       COALESCE(pi.approved_at::date, pi.paid_date, p.created_at::date) AS approved_on,
       pi.organization_id,
       pi.project_id,
       (pi.amount_gross - pi.company_wht)::numeric AS line_amount,
       pi.company_wht::numeric AS company_wht
  FROM public.payroll_instalments pi
  JOIN public.payroll p ON p.id = pi.payroll_id;
COMMENT ON VIEW public.v_payroll_instalments IS
  'Contract instalments for the ledger, read from public.payroll_instalments (180): net = instalment amount (paid), gross = share of the contract value, line_amount = share carried by the contract''s budget line, company_wht = share charged to 7099 (decision 12, db/pending/201).';

CREATE OR REPLACE VIEW public.v_journal_lines WITH (security_invoker = on) AS
SELECT j.event_key, j.event_type, j.source_table, j.source_id, j.parent_id,
       j.organization_id, j.project_id, j.entry_date, j.line_no, j.gl_account_id,
       round(GREATEST(j.amt, 0), 2)  AS debit,
       round(GREATEST(-j.amt, 0), 2) AS credit,
       j.party, j.budget_code, j.reference, j.description, j.department, j.status,
       COALESCE(j.qpe_eligible, false) AS qpe_eligible
FROM (
  -- invoice: Dr expense (excl. VAT) + Dr VAT / Cr payable (incl. VAT − WHT) + Cr WHT
  SELECT 'invoice:' || i.id AS event_key, 'invoice'::text AS event_type, 'invoices'::text AS source_table,
         i.id AS source_id, NULL::uuid AS parent_id, i.organization_id, i.project_id,
         COALESCE(i.date, i.created_at::date) AS entry_date, l.line_no, l.gl AS gl_account_id, l.amt,
         i.vendor_name AS party, i.budget_code, i.invoice_no AS reference,
         'Invoice — ' || COALESCE(i.vendor_name, '?') || COALESCE(' — ' || NULLIF(i.description, ''), '') AS description,
         i.department, 'Approved'::text AS status, i.rebate_eligible AS qpe_eligible
    FROM public.invoices i
    CROSS JOIN public.v_ledger_system_accounts s
    CROSS JOIN LATERAL (VALUES
      (1, public.ledger_expense_account(i.organization_id, i.budget_code, i.gl_account_id), round(COALESCE(i.price, 0), 2)),
      (2, s.vat,     round(COALESCE(i.vat_amount, 0), 2)),
      (3, s.payable, -(round(COALESCE(i.price, 0), 2) + round(COALESCE(i.vat_amount, 0), 2) - round(COALESCE(i.wht_amount, 0), 2))),
      (4, s.wht,     -round(COALESCE(i.wht_amount, 0), 2))) l(line_no, gl, amt)
   WHERE i.approval_status = 'approved'                                   -- 201: posted on approval, reversed on cancellation
  UNION ALL
  -- 196: instalment Approved / Paid, from payroll_instalments:
  --      Dr expense (amount_gross) / Cr payable (amount) + Cr WHT (difference), dated approved_at
  SELECT 'instalment:' || p.id || ':' || mi.milestone_id, 'instalment', 'payroll',
         p.id, NULL::uuid, p.organization_id, p.project_id,
         COALESCE(mi.approved_at::date, mi.paid_date, p.created_at::date), l.line_no, l.gl, l.amt,
         p.name, l.code, COALESCE(mi.label, 'P' || mi.seq),                  -- 201: 7099 line carries its own code
         'Instalment — ' || p.name || ' — ' || COALESCE(NULLIF(pe."position", ''), p.kind) || ' / ' || COALESCE(mi.label, 'P' || mi.seq),
         NULL::text, mi.status, false
    FROM public.payroll p
    JOIN public.payroll_instalments mi ON mi.payroll_id = p.id
    LEFT JOIN public.people pe
           ON p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND pe.id = p.ref_id::uuid
    CROSS JOIN public.v_ledger_system_accounts s
    CROSS JOIN LATERAL (VALUES
      -- 201 (decision 12): Exclusive contract = Dr contract line (net) + Dr 7099 (company-borne WHT)
      (1, public.ledger_expense_account(p.organization_id, p.budget_code, p.gl_account_id),
          round(mi.amount_gross, 2) - COALESCE(mi.company_wht, 0), p.budget_code),
      (2, s.payable, -round(mi.amount, 2), p.budget_code),
      (3, s.wht,     -(round(mi.amount_gross, 2) - round(mi.amount, 2)), p.budget_code),
      (4, public.ledger_expense_account(p.organization_id, '7099', NULL), COALESCE(mi.company_wht, 0), '7099'::text)
    ) l(line_no, gl, amt, code)
   WHERE mi.status IN ('Approved', 'Paid')
  UNION ALL
  -- overtime approved outside a payroll run (a run turns it into an instalment)
  SELECT 'overtime:' || ot.id, 'overtime', 'overtime_entries', ot.id, NULL::uuid, ot.organization_id, ot.project_id,
         ot.work_date, l.line_no, l.gl, l.amt, ot.person_name, ot.budget_code, NULL::text,
         'Overtime — ' || ot.person_name || ' — ' || ot.work_date, NULL::text, initcap(ot.status), false
    FROM public.overtime_entries ot
    CROSS JOIN public.v_ledger_system_accounts s
    CROSS JOIN LATERAL (SELECT public.ledger_to_sar(ot.amount, ot.currency, NULL, ot.project_id) AS v) a
    CROSS JOIN LATERAL (VALUES
      (1, public.ledger_expense_account(ot.organization_id, ot.budget_code, NULL), a.v),
      (2, s.payable, -a.v)) l(line_no, gl, amt)
   WHERE ot.status IN ('approved', 'paid') AND ot.payroll_run_id IS NULL
  UNION ALL
  -- per diem paid: from a float (petty cash) or owed (payable)
  SELECT 'per_diem:' || d.id, 'per_diem', 'per_diem_ledger', d.id, d.cash_advance_id, d.organization_id, d.project_id,
         d.period_start, l.line_no, l.gl, l.amt, pe.full_name, d.budget_code, NULL::text,
         'Per diem — ' || COALESCE(pe.full_name, '?') || ' — ' || d.period_start || ' → ' || d.period_end,
         NULL::text, 'Paid', false
    FROM public.per_diem_ledger d
    LEFT JOIN public.people pe ON pe.id = d.person_id
    CROSS JOIN public.v_ledger_system_accounts s
    CROSS JOIN LATERAL (SELECT public.ledger_to_sar(d.total_amount, d.currency, NULL, d.project_id) AS v) a
    CROSS JOIN LATERAL (VALUES
      (1, public.ledger_expense_account(d.organization_id, d.budget_code, NULL), a.v),
      (2, CASE WHEN d.cash_advance_id IS NOT NULL THEN s.petty ELSE s.payable END, -a.v)) l(line_no, gl, amt)
   WHERE d.status = 'paid'
  UNION ALL
  -- petty cash receipt approved: Dr expense / Cr petty cash
  SELECT 'petty_receipt:' || r.id, 'petty_receipt', 'cash_advance_receipts', r.id, r.advance_id, r.organization_id, r.project_id,
         COALESCE(r.date, r.approved_at::date, r.created_at::date), l.line_no, l.gl, l.amt,
         COALESCE(NULLIF(r.vendor, ''), r.recipient), r.budget_code, NULL::text,
         'Petty cash receipt — ' || COALESCE(NULLIF(r.vendor, ''), r.recipient) || COALESCE(' — ' || NULLIF(r.description, ''), ''),
         r.department, 'Approved', false
    FROM public.cash_advance_receipts r
    CROSS JOIN public.v_ledger_system_accounts s
    CROSS JOIN LATERAL (SELECT public.ledger_to_sar(r.amount, r.currency, r.fx_rate, r.project_id) AS v) a
    CROSS JOIN LATERAL (VALUES
      (1, public.ledger_expense_account(r.organization_id, r.budget_code, r.gl_account_id), a.v),
      (2, s.petty, -a.v)) l(line_no, gl, amt)
   WHERE r.status = 'approved'
  UNION ALL
  -- petty cash float issued on approval (only when no payment was recorded against it)
  SELECT 'petty_issue:' || ca.id, 'petty_issue', 'cash_advances', ca.id, NULL::uuid, ca.organization_id, ca.project_id,
         COALESCE(ca.approved_at, ca.issued_at, ca.created_at)::date, l.line_no, l.gl, l.amt,
         ca.holder, NULL::text, NULL::text, 'Petty cash issue — ' || ca.holder, NULL::text, 'Issued', false
    FROM public.cash_advances ca
    CROSS JOIN public.v_ledger_system_accounts s
    CROSS JOIN LATERAL (SELECT public.ledger_to_sar(ca.total_advance, ca.currency, ca.fx_rate, ca.project_id) AS v) a
    CROSS JOIN LATERAL (VALUES (1, s.petty, a.v), (2, s.bank, -a.v)) l(line_no, gl, amt)
   WHERE ca.status IN ('open', 'approved', 'closed')
     AND NOT EXISTS (SELECT 1 FROM public.payments px
                      WHERE px.source_id = ca.id AND px.source_type IN ('petty_cash', 'cash_advance'))
  UNION ALL
  -- payments: Dr payable / Cr bank (cash, petty cash); payments against a float issue it
  SELECT 'payment:' || pay.id, CASE WHEN x.is_float THEN 'petty_issue' ELSE 'payment' END, 'payments',
         pay.id, pay.source_id, pay.organization_id, pay.project_id,
         COALESCE(pay.payment_date, pay.created_at::date), l.line_no, l.gl, l.amt,                -- 196: never undated
         x.party, x.budget_code, x.reference,
         CASE WHEN x.is_float THEN 'Petty cash issue — ' || COALESCE(x.party, '?')
              ELSE 'Payment — ' || COALESCE(x.doc_type, pay.source_type) || ' — ' || COALESCE(x.party, 'Unknown source')
                   || COALESCE(' — ' || NULLIF(x.detail, ''), '') END,
         x.department, 'Paid', x.qpe
    FROM public.payments pay
    CROSS JOIN public.v_ledger_system_accounts s
    LEFT JOIN public.invoices inv ON pay.source_type = 'invoice' AND inv.id = pay.source_id
    LEFT JOIN public.payroll pr ON pay.source_type = 'payroll' AND pr.id = pay.source_id
    LEFT JOIN public.payroll_instalments pmi                                                         -- 196
           ON pr.id IS NOT NULL AND pmi.payroll_id = pr.id AND pmi.milestone_id = pay.payroll_milestone_id
    LEFT JOIN public.purchase_orders po ON pay.source_type IN ('purchase_order', 'po') AND po.id = pay.source_id
    LEFT JOIN public.overtime_entries ot ON pay.source_type = 'overtime' AND ot.id = pay.source_id
    LEFT JOIN public.per_diem_ledger pd ON pay.source_type = 'per_diem' AND pd.id = pay.source_id
    LEFT JOIN public.people pdp ON pdp.id = pd.person_id
    LEFT JOIN public.cash_advance_receipts rc ON pay.source_type IN ('receipt', 'cash_advance_receipt') AND rc.id = pay.source_id
    LEFT JOIN public.cash_advances fl ON pay.source_type IN ('petty_cash', 'cash_advance', 'receipt', 'cash_advance_receipt')
                                     AND fl.id = COALESCE(rc.advance_id, pay.source_id)
    CROSS JOIN LATERAL (SELECT
       pay.source_type IN ('petty_cash', 'cash_advance', 'receipt', 'cash_advance_receipt') AS is_float,
       CASE pay.source_type WHEN 'invoice' THEN 'Invoice' WHEN 'payroll' THEN 'Instalment'
            WHEN 'purchase_order' THEN 'Purchase order' WHEN 'po' THEN 'Purchase order'
            WHEN 'overtime' THEN 'Overtime' WHEN 'per_diem' THEN 'Per diem' ELSE 'Petty cash' END AS doc_type,
       COALESCE(inv.vendor_name, pr.name, po.vendor_name, ot.person_name, pdp.full_name, fl.holder) AS party,
       COALESCE(inv.budget_code, pr.budget_code, po.budget_code, ot.budget_code, pd.budget_code, rc.budget_code) AS budget_code,
       COALESCE(inv.invoice_no, COALESCE(pmi.label, 'P' || pmi.seq), po.po_number, NULLIF(pay.notes, '')) AS reference,
       COALESCE(inv.description, COALESCE(pmi.label, 'P' || pmi.seq), po.description, NULLIF(pay.notes, '')) AS detail,
       COALESCE(inv.department, rc.department) AS department,
       COALESCE(inv.rebate_eligible, false) AS qpe,
       CASE WHEN pay.method = 'Cash' THEN s.cash
            WHEN inv.payment_method = 'petty_cash' THEN s.petty
            ELSE s.bank END AS credit_account) x
    CROSS JOIN LATERAL (VALUES
      (1, CASE WHEN x.is_float THEN s.petty ELSE s.payable END, round(COALESCE(pay.amount, 0), 2)),
      (2, CASE WHEN x.is_float THEN CASE WHEN pay.method = 'Cash' THEN s.cash ELSE s.bank END
               ELSE x.credit_account END, -round(COALESCE(pay.amount, 0), 2))) l(line_no, gl, amt)
  UNION ALL
  -- funding received: Dr bank / Cr funding (196: the kind in the description)
  SELECT 'funding:' || f.id, 'funding', 'project_funding', f.id, NULL::uuid, f.organization_id, f.project_id,
         f.funding_date, l.line_no, l.gl, l.amt, COALESCE(NULLIF(f.source, ''), 'Funding'), NULL::text, f.reference,
         'Funding — ' || COALESCE(NULLIF(f.kind, '') || ' — ', '') || COALESCE(NULLIF(f.source, ''), 'Funding')
           || COALESCE(' — ' || NULLIF(f.reference, ''), ''),
         NULL::text, 'Received', false
    FROM public.project_funding f
    CROSS JOIN public.v_ledger_system_accounts s
    CROSS JOIN LATERAL (VALUES (1, s.bank, round(f.amount, 2)), (2, s.funding, -round(f.amount, 2))) l(line_no, gl, amt)
   WHERE f.status = 'received'
  UNION ALL
  -- treasury movements (196: + VAT paid to ZATCA: Dr VAT / Cr bank)
  SELECT 'treasury:' || tm.id, tm.kind, 'treasury_movements', tm.id, tm.cash_advance_id, tm.organization_id, tm.project_id,
         tm.movement_date, l.line_no, l.gl, l.amt,
         CASE tm.kind WHEN 'petty_cash_return' THEN ca.holder WHEN 'bank_charge' THEN 'Bank' ELSE 'ZATCA' END,
         tm.budget_code, tm.reference,
         CASE tm.kind WHEN 'wht_remittance' THEN 'WHT remittance — ZATCA'
                      WHEN 'vat_recovery' THEN 'VAT recovery — ZATCA'
                      WHEN 'vat_payment' THEN 'VAT payment — ZATCA'
                      WHEN 'petty_cash_return' THEN 'Petty cash return — ' || COALESCE(ca.holder, '?')
                      ELSE 'Bank charge' END || COALESCE(' — ' || NULLIF(tm.notes, ''), ''),
         NULL::text, 'Posted', false
    FROM public.treasury_movements tm
    LEFT JOIN public.cash_advances ca ON ca.id = tm.cash_advance_id
    CROSS JOIN public.v_ledger_system_accounts s
    CROSS JOIN LATERAL (VALUES
      (1, CASE tm.kind WHEN 'wht_remittance' THEN s.wht
                       WHEN 'vat_payment' THEN s.vat
                       WHEN 'bank_charge' THEN public.ledger_expense_account(tm.organization_id, tm.budget_code, NULL)
                       ELSE s.bank END, round(tm.amount, 2)),
      (2, CASE tm.kind WHEN 'vat_recovery' THEN s.vat
                       WHEN 'petty_cash_return' THEN s.petty
                       ELSE s.bank END, -round(tm.amount, 2))) l(line_no, gl, amt)
) j
WHERE j.amt <> 0 AND j.project_id IS NOT NULL;

COMMENT ON VIEW public.v_journal_lines IS
  'Phase 1 general ledger (decision 4): two or more debit/credit lines per financial event, computed from the current tables. Rules in db/pending/182, instalments / funding / treasury per db/pending/196; invoices posted on approval and company-borne WHT on 7099 per db/pending/201. Σ debit = Σ credit per event_key.';

GRANT SELECT ON public.v_journal_lines, public.v_payroll_instalments, public.v_ledger_transactions TO authenticated, service_role;
REVOKE ALL ON public.v_journal_lines, public.v_payroll_instalments, public.v_ledger_transactions FROM anon;

-- ---------------------------------------------------------------------
-- 6. Funding position / cash flow (copies of 196) — invoice approval
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_funding_position(p_project_id uuid, p_as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org   uuid;
  v_as_of date := COALESCE(p_as_of, current_date);
  v_exp   numeric; v_paid numeric;
  v_inv   numeric; v_inst numeric;
  b       record;
  pos     record;
BEGIN
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_funding_position: access denied' USING ERRCODE = '42501';
  END IF;

  -- the ledger lines on the cash accounts (phase 2 once initialised, else phase 1)
  WITH l AS (
    SELECT x.event_type, x.debit - x.credit AS net, g.code
      FROM public.ledger_project_lines(p_project_id) x
      JOIN public.gl_accounts g ON g.id = x.gl_account_id
     WHERE g.code IN ('9100', '9110', '9120') AND x.entry_date <= v_as_of)
  SELECT
    COALESCE(sum(net) FILTER (WHERE code = '9100'), 0)                                         AS bank,
    COALESCE(sum(net) FILTER (WHERE code = '9110'), 0)                                         AS cash,
    COALESCE(sum(net) FILTER (WHERE code = '9120'), 0)                                         AS petty,
    COALESCE(sum(net) FILTER (WHERE code = '9100' AND event_type = 'funding'), 0)              AS funding,
    -COALESCE(sum(net) FILTER (WHERE code = '9100' AND event_type = 'payment'), 0)             AS paid_bank,
    -COALESCE(sum(net) FILTER (WHERE code = '9100' AND event_type = 'petty_issue'), 0)         AS petty_issued,
    COALESCE(sum(net) FILTER (WHERE code = '9100' AND event_type = 'petty_cash_return'), 0)    AS petty_returned,
    -COALESCE(sum(net) FILTER (WHERE code = '9100' AND event_type = 'vat_payment'), 0)         AS vat_paid,
    COALESCE(sum(net) FILTER (WHERE code = '9100' AND event_type = 'vat_recovery'), 0)         AS vat_recovered,
    -COALESCE(sum(net) FILTER (WHERE code = '9100' AND event_type = 'wht_remittance'), 0)      AS wht_remitted,
    -COALESCE(sum(net) FILTER (WHERE code = '9100' AND event_type = 'bank_charge'), 0)         AS bank_charges
    INTO b
    FROM l;

  SELECT COALESCE(sum(amount) FILTER (WHERE NOT (status = 'received' AND funding_date <= v_as_of)), 0)
    INTO v_exp
    FROM public.project_funding WHERE project_id = p_project_id;
  SELECT COALESCE(sum(amount), 0) INTO v_paid
    FROM public.payments WHERE project_id = p_project_id AND (payment_date IS NULL OR payment_date <= v_as_of);

  SELECT COALESCE(sum(GREATEST(COALESCE(i.net_payable, COALESCE(i.price, 0) + COALESCE(i.vat_amount, 0) - COALESCE(i.wht_amount, 0))
                               - COALESCE(pd.paid, 0), 0)), 0)
    INTO v_inv
    FROM public.invoices i
    LEFT JOIN LATERAL (SELECT sum(pm.amount) AS paid FROM public.payments pm
                        WHERE pm.source_type = 'invoice' AND pm.source_id = i.id) pd ON true
   WHERE i.project_id = p_project_id
     AND i.approval_status = 'approved';                                   -- 201: only approved invoices are owed
  SELECT COALESCE(sum(pi.amount), 0) INTO v_inst
    FROM public.payroll_instalments pi
   WHERE pi.project_id = p_project_id AND pi.status = 'Approved';

  SELECT * INTO pos FROM public.v_project_position vp WHERE vp.project_id = p_project_id;

  RETURN jsonb_build_object(
    'as_of', v_as_of, 'currency', 'SAR', 'source', 'ledger',
    'funding', round(b.funding, 2), 'funding_expected', round(v_exp, 2),
    'paid', round(v_paid, 2),
    'paid_from_bank', round(b.paid_bank, 2),
    'paid_not_from_bank', round(v_paid - b.paid_bank - b.petty_issued, 2),
    'petty_cash_issued', round(b.petty_issued, 2), 'petty_cash_returned', round(b.petty_returned, 2),
    'vat_paid', round(b.vat_paid, 2), 'vat_recovered', round(b.vat_recovered, 2),
    'wht_remitted', round(b.wht_remitted, 2), 'bank_charges', round(b.bank_charges, 2),
    'cash_balance', round(b.bank, 2),
    'cash_on_hand', round(b.cash, 2), 'petty_cash', round(b.petty, 2),
    'upcoming_invoices', round(v_inv, 2), 'upcoming_instalments', round(v_inst, 2),
    'upcoming', round(v_inv + v_inst, 2),
    'expected_balance', round(b.bank - v_inv - v_inst, 2),
    'actual', round(COALESCE(pos.actual_sar, 0), 2),
    'commitment', round(COALESCE(pos.committed_sar, 0), 2),
    'payable', round(COALESCE(pos.payable_sar, 0), 2),
    'has_funding', b.funding > 0,
    'overdrawn', b.bank < 0,
    'payments_exceed_funding', v_paid > b.funding);
END;
$$;

REVOKE ALL ON FUNCTION public.get_funding_position(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_funding_position(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_cash_flow(
  p_project_id  uuid,
  p_grain       text    DEFAULT 'week',
  p_include_vat boolean DEFAULT false,
  p_spread      text    DEFAULT 'even',
  p_as_of       date    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid; v_fx numeric; v_start date; v_end date;
  v_today date := COALESCE(p_as_of, current_date);
  v_step interval; v_cur date; v_last date; v_first date; v_result jsonb;
BEGIN
  IF p_grain NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'get_cash_flow: p_grain must be day, week or month' USING ERRCODE = '22023';
  END IF;
  IF p_spread NOT IN ('even', 'end', 'none') THEN
    RAISE EXCEPTION 'get_cash_flow: p_spread must be even, end or none' USING ERRCODE = '22023';
  END IF;
  SELECT p.organization_id, p.fx_rate, p.start_date, p.end_date
    INTO v_org, v_fx, v_start, v_end
  FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_cash_flow: access denied' USING ERRCODE = '42501';
  END IF;

  v_step := ('1 ' || p_grain)::interval;
  v_cur  := date_trunc(p_grain, v_today::timestamp)::date;
  -- last period of the project; never before the current period
  v_last := GREATEST(date_trunc(p_grain, COALESCE(v_end, v_today)::timestamp)::date, v_cur);

  WITH
  budget AS (
    SELECT bl.main_code AS code,
           sum(public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap,
                                            bl.unit, bl.currency, bl.excluded, v_fx)) AS budget,
           mode() WITHIN GROUP (ORDER BY bl.topsheet_code) AS topsheet_code,
           min(bl.description) AS line_description
    FROM public.v_active_budget_lines bl
    WHERE bl.project_id = p_project_id
    GROUP BY bl.main_code
  ),
  -- payments with their budget code and normalised source key
  pay AS (
    SELECT COALESCE(inv.budget_code, po.budget_code, pr.budget_code,
                    r.budget_code, ot.budget_code, pdl.budget_code) AS code,
           CASE WHEN pm.source_type IN ('purchase_order', 'po') THEN 'purchase_order'
                WHEN pm.source_type IN ('petty_cash', 'cash_advance', 'cash_advance_receipt', 'receipt') THEN 'petty_cash'
                ELSE pm.source_type END AS st,
           pm.source_id, pm.amount, pm.payment_date
    FROM public.payments pm
    LEFT JOIN public.invoices inv ON inv.id = pm.source_id AND pm.source_type = 'invoice'
    LEFT JOIN public.purchase_orders po ON po.id = pm.source_id AND pm.source_type IN ('purchase_order', 'po')
    LEFT JOIN public.payroll pr ON pr.id = pm.source_id AND pm.source_type = 'payroll'
    LEFT JOIN public.cash_advance_receipts r ON r.id = pm.source_id
          AND pm.source_type IN ('petty_cash', 'cash_advance', 'cash_advance_receipt', 'receipt')
    LEFT JOIN public.overtime_entries ot ON ot.id = pm.source_id AND pm.source_type = 'overtime'
    LEFT JOIN public.per_diem_ledger pdl ON pdl.id = pm.source_id AND pm.source_type = 'per_diem'
    WHERE pm.project_id = p_project_id
  ),
  paid_src AS (SELECT pay.st, pay.source_id, sum(pay.amount) AS paid FROM pay GROUP BY 1, 2),
  -- unpaid contract instalments, capped so a contract never forecasts more
  -- than what is still owed on it
  sched AS (
    SELECT p.id, p.budget_code AS code,
           GREATEST(COALESCE(p.total_amount, 0) - COALESCE(ps.paid, 0), 0) AS outstanding,
           CASE WHEN COALESCE(e.elem->>'dueDate', e.elem->>'due_date', '') ~ '^\d{4}-\d{2}-\d{2}'
                  THEN left(COALESCE(e.elem->>'dueDate', e.elem->>'due_date'), 10)::date END AS due,
           COALESCE(NULLIF(e.elem->>'amount', '')::numeric,
                    COALESCE(p.total_amount, 0) * COALESCE(NULLIF(e.elem->>'percent', '')::numeric, 0) / 100) AS amt,
           e.ord
    FROM public.payroll p
    LEFT JOIN paid_src ps ON ps.st = 'payroll' AND ps.source_id = p.id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.payment_schedule) = 'array' THEN p.payment_schedule ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS e(elem, ord)
    WHERE p.project_id = p_project_id
      AND COALESCE(e.elem->>'status', 'Pending') <> 'Paid'
      -- 196: a cancelled contract forecasts only what was approved on it
      -- (decision 3: approved instalments stay Actual and are still owed)
      AND (p.contract_cancelled_at IS NULL OR e.elem->>'status' = 'Approved')
  ),
  sched_capped AS (
    SELECT s.code, s.due,
           GREATEST(LEAST(s.amt, s.outstanding - COALESCE(
             sum(s.amt) OVER (PARTITION BY s.id ORDER BY s.due NULLS LAST, s.ord
                              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)), 0) AS amt
    FROM sched s
    WHERE s.due IS NOT NULL AND s.amt > 0
  ),
  dated AS (
    -- contract instalments
    SELECT sc.code, GREATEST(sc.due, v_today) AS d, sc.amt AS amount FROM sched_capped sc WHERE sc.amt > 0
    UNION ALL
    -- unpaid invoice balances
    SELECT i.budget_code, GREATEST(COALESCE(i.date, v_today), v_today),
           GREATEST(COALESCE(i.price, 0)
                    + CASE WHEN p_include_vat THEN
                             CASE WHEN COALESCE(i.vat_amount, 0) > 0 THEN i.vat_amount
                                  WHEN i.vatable THEN round(COALESCE(i.price, 0) * 0.15, 2) ELSE 0 END
                           ELSE 0 END
                    - COALESCE(ps.paid, 0), 0)
    FROM public.invoices i
    LEFT JOIN paid_src ps ON ps.st = 'invoice' AND ps.source_id = i.id
    WHERE i.project_id = p_project_id
      AND i.approval_status IN ('approved', 'pending')                     -- 201: rejected / cancelled are not owed
    UNION ALL
    -- open purchase orders
    SELECT po.budget_code, GREATEST(COALESCE(po.date, v_today), v_today),
           GREATEST(COALESCE(po.amount, 0) - COALESCE(ps.paid, 0), 0)
    FROM public.purchase_orders po
    LEFT JOIN paid_src ps ON ps.st = 'purchase_order' AND ps.source_id = po.id
    WHERE po.project_id = p_project_id
      AND COALESCE(po.status, '') NOT IN ('Cancelled', 'cancelled', 'Rejected', 'rejected')
  ),
  dated_p AS (
    SELECT d.code, date_trunc(p_grain, d.d::timestamp)::date AS ps, sum(d.amount) AS amount
    FROM dated d WHERE d.amount > 0 GROUP BY 1, 2
  ),
  paid_code AS (SELECT pay.code, sum(pay.amount) AS paid FROM pay GROUP BY pay.code),
  dated_code AS (SELECT dp.code, sum(dp.amount) AS dated FROM dated_p dp GROUP BY dp.code),
  codes AS (
    SELECT c.code,
           COALESCE(b.budget, 0)  AS budget,
           COALESCE(pc.paid, 0)   AS paid,
           COALESCE(dc.dated, 0)  AS dated,
           b.topsheet_code, b.line_description
    FROM (SELECT code FROM budget UNION SELECT code FROM paid_code UNION SELECT code FROM dated_code) c
    LEFT JOIN budget b      ON b.code  IS NOT DISTINCT FROM c.code
    LEFT JOIN paid_code pc  ON pc.code IS NOT DISTINCT FROM c.code
    LEFT JOIN dated_code dc ON dc.code IS NOT DISTINCT FROM c.code
  ),
  resid AS (
    SELECT c.code, GREATEST(c.budget - c.paid - c.dated, 0) AS residual
    FROM codes c
  ),
  spread_periods AS (
    SELECT gs::date AS ps, row_number() OVER (ORDER BY gs) AS rn, count(*) OVER () AS n
    FROM generate_series(v_cur::timestamp, v_last::timestamp, v_step) gs
  ),
  spread AS (
    SELECT r.code, sp.ps,
           CASE
             WHEN p_spread = 'end'  THEN CASE WHEN sp.rn = sp.n THEN r.residual ELSE 0 END
             WHEN p_spread = 'even' THEN
               CASE WHEN sp.rn < sp.n THEN round(r.residual / sp.n, 2)
                    ELSE r.residual - round(r.residual / sp.n, 2) * (sp.n - 1) END
           END AS amount
    FROM resid r CROSS JOIN spread_periods sp
    WHERE p_spread <> 'none' AND r.residual > 0
  ),
  ev AS (   -- every money cell: code x period x kind
    SELECT pay.code, date_trunc(p_grain, pay.payment_date::timestamp)::date AS ps,
           'actual'::text AS kind, sum(pay.amount) AS amount
    FROM pay WHERE pay.payment_date IS NOT NULL GROUP BY 1, 2
    UNION ALL
    SELECT u.code, u.ps, 'forecast', sum(u.amount)
    FROM (SELECT dp.code, dp.ps, dp.amount FROM dated_p dp
          UNION ALL
          SELECT s.code, s.ps, s.amount FROM spread s WHERE s.amount > 0) u
    GROUP BY 1, 2
  ),
  fund AS (
    SELECT date_trunc(p_grain, f.funding_date::timestamp)::date AS ps, sum(f.amount) AS amount
    FROM public.project_funding f WHERE f.project_id = p_project_id GROUP BY 1
  ),
  bounds AS (
    SELECT LEAST(COALESCE((SELECT min(ev.ps) FROM ev), v_cur),
                 COALESCE((SELECT min(fund.ps) FROM fund), v_cur),
                 date_trunc(p_grain, COALESCE(v_start, v_today)::timestamp)::date, v_cur) AS first_p,
           GREATEST(COALESCE((SELECT max(ev.ps) FROM ev), v_last),
                    COALESCE((SELECT max(fund.ps) FROM fund), v_last), v_last) AS last_p
  ),
  per AS (
    SELECT gs::date AS ps FROM bounds, generate_series(bounds.first_p::timestamp, bounds.last_p::timestamp, v_step) gs
  ),
  tot AS (
    SELECT per.ps,
           COALESCE((SELECT sum(ev.amount) FROM ev WHERE ev.ps = per.ps), 0)     AS outflow,
           COALESCE((SELECT fund.amount FROM fund WHERE fund.ps = per.ps), 0)    AS funding
    FROM per
  ),
  tot2 AS (
    SELECT t.ps, t.outflow, t.funding,
           sum(t.funding - t.outflow) OVER (ORDER BY t.ps) AS closing
    FROM tot t
  ),
  master AS (
    SELECT DISTINCT ON (mb.budget_code) mb.budget_code AS code, mb.description, mb.topsheet_code
    FROM public.master_budget mb ORDER BY mb.budget_code, mb.is_header NULLS LAST
  ),
  line_json AS (
    SELECT c.code, ts.display_order,
           jsonb_build_object(
             'header',       COALESCE(ts.section, 'Other'),
             'sub_account',  CASE WHEN ts.code IS NOT NULL THEN ts.code || ' · ' || ts.name END,
             'budget_code',  c.code,
             'description',  COALESCE(m.description, c.line_description),
             'budget',       round(c.budget, 2),
             'paid_to_date', round(c.paid, 2),
             'remaining',    round(c.budget - c.paid, 2),
             'over_budget',  (c.paid + c.dated > c.budget + 0.005),
             'periods',      COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('period_start', ev.ps, 'amount', round(ev.amount, 2), 'kind', ev.kind)
                                  ORDER BY ev.ps, ev.kind)
                 FROM ev WHERE ev.code IS NOT DISTINCT FROM c.code AND ev.amount <> 0), '[]'::jsonb)
           ) AS j
    FROM codes c
    LEFT JOIN master m ON m.code = c.code
    LEFT JOIN public.budget_topsheet_accounts ts ON ts.code = COALESCE(c.topsheet_code, m.topsheet_code)
    WHERE c.code IS NOT NULL OR c.paid <> 0 OR c.dated <> 0
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'grain', p_grain, 'as_of', v_today, 'current_period', v_cur,
      'first_period', (SELECT first_p FROM bounds), 'last_period', (SELECT last_p FROM bounds),
      'include_vat', p_include_vat, 'spread', p_spread, 'currency', 'SAR',
      'has_funding', EXISTS (SELECT 1 FROM fund)),
    'lines',  COALESCE((SELECT jsonb_agg(lj.j ORDER BY lj.display_order NULLS LAST, lj.code NULLS LAST) FROM line_json lj), '[]'::jsonb),
    'totals', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                           'period_start', t.ps,
                           'outflow', round(t.outflow, 2),
                           'funding', round(t.funding, 2),
                           'opening', round(t.closing - t.funding + t.outflow, 2),
                           'closing', round(t.closing, 2)) ORDER BY t.ps)
                        FROM tot2 t), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_cash_flow(uuid, text, boolean, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_flow(uuid, text, boolean, text, date) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 7. Budget regions (KSA)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ksa_region_list()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY['Riyadh', 'Makkah', 'Madinah', 'Eastern Province', 'Asir', 'Tabuk', 'Hail',
               'Northern Borders', 'Jazan', 'Najran', 'Al Bahah', 'Al Jawf', 'Qassim']::text[]
$$;
GRANT EXECUTE ON FUNCTION public.ksa_region_list() TO authenticated, service_role;

-- Region name or main city (English / Arabic) → the region; NULL when unknown.
-- Same table as src/lib/ksa-regions.ts.
CREATE OR REPLACE FUNCTION public.ksa_region_normalize(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH k AS (SELECT lower(btrim(regexp_replace(regexp_replace(COALESCE(p, ''), '[’''`]', '', 'g'), '[\s_\-]+', ' ', 'g'))) AS v)
  SELECT CASE
    WHEN v IN ('riyadh', 'ar riyadh', 'al riyadh', 'riyadh region', 'الرياض', 'منطقة الرياض', 'diriyah', 'الدرعية', 'al kharj', 'الخرج') THEN 'Riyadh'
    WHEN v IN ('makkah', 'mecca', 'makkah al mukarramah', 'makkah region', 'مكة', 'مكة المكرمة', 'منطقة مكة المكرمة',
               'jeddah', 'jiddah', 'جدة', 'taif', 'al taif', 'الطائف', 'rabigh', 'رابغ') THEN 'Makkah'
    WHEN v IN ('madinah', 'medina', 'al madinah', 'madinah region', 'المدينة', 'المدينة المنورة', 'منطقة المدينة المنورة',
               'alula', 'al ula', 'العلا', 'yanbu', 'ينبع') THEN 'Madinah'
    WHEN v IN ('eastern province', 'eastern', 'eastern region', 'ash sharqiyah', 'الشرقية', 'المنطقة الشرقية',
               'dammam', 'الدمام', 'khobar', 'al khobar', 'الخبر', 'dhahran', 'الظهران', 'jubail', 'الجبيل',
               'al ahsa', 'al hasa', 'hofuf', 'الأحساء', 'الاحساء', 'qatif', 'القطيف') THEN 'Eastern Province'
    WHEN v IN ('asir', 'aseer', 'عسير', 'منطقة عسير', 'abha', 'أبها', 'ابها', 'khamis mushait', 'خميس مشيط') THEN 'Asir'
    WHEN v IN ('tabuk', 'تبوك', 'منطقة تبوك', 'neom', 'نيوم') THEN 'Tabuk'
    WHEN v IN ('hail', 'حائل', 'منطقة حائل') THEN 'Hail'
    WHEN v IN ('northern borders', 'northern border', 'al hudud ash shamaliyah', 'الحدود الشمالية', 'منطقة الحدود الشمالية',
               'arar', 'عرعر') THEN 'Northern Borders'
    WHEN v IN ('jazan', 'jizan', 'gizan', 'جازان', 'جيزان', 'منطقة جازان') THEN 'Jazan'
    WHEN v IN ('najran', 'نجران', 'منطقة نجران') THEN 'Najran'
    WHEN v IN ('al bahah', 'al baha', 'bahah', 'baha', 'الباحة', 'منطقة الباحة') THEN 'Al Bahah'
    WHEN v IN ('al jawf', 'jawf', 'al jouf', 'jouf', 'الجوف', 'منطقة الجوف', 'sakaka', 'سكاكا') THEN 'Al Jawf'
    WHEN v IN ('qassim', 'al qassim', 'al qasim', 'القصيم', 'منطقة القصيم', 'buraydah', 'buraidah', 'بريدة', 'unaizah', 'عنيزة') THEN 'Qassim'
  END FROM k
$$;
GRANT EXECUTE ON FUNCTION public.ksa_region_normalize(text) TO authenticated, service_role;

ALTER TABLE public.budget_lines ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS default_region text;
ALTER TABLE public.budget_lines DROP CONSTRAINT IF EXISTS budget_lines_region_check;
ALTER TABLE public.budget_lines ADD CONSTRAINT budget_lines_region_check
  CHECK (region IS NULL OR region = ANY (ARRAY['Riyadh', 'Makkah', 'Madinah', 'Eastern Province', 'Asir', 'Tabuk', 'Hail',
                                               'Northern Borders', 'Jazan', 'Najran', 'Al Bahah', 'Al Jawf', 'Qassim']));
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_default_region_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_default_region_check
  CHECK (default_region IS NULL OR default_region = ANY (ARRAY['Riyadh', 'Makkah', 'Madinah', 'Eastern Province', 'Asir', 'Tabuk', 'Hail',
                                                               'Northern Borders', 'Jazan', 'Najran', 'Al Bahah', 'Al Jawf', 'Qassim']));
COMMENT ON COLUMN public.budget_lines.region IS 'KSA region where the line is spent (Film Commission budget by region). NULL = the project default region. db/pending/201.';
COMMENT ON COLUMN public.projects.default_region IS 'Default KSA region of the project''s budget lines (Film Commission budget by region). db/pending/201.';

-- "Jeddah" / "الرياض" typed or imported → the region name the CHECK accepts.
CREATE OR REPLACE FUNCTION public.normalize_region_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    NEW.default_region := COALESCE(public.ksa_region_normalize(NEW.default_region), NULLIF(btrim(COALESCE(NEW.default_region, '')), ''));
  ELSE
    NEW.region := COALESCE(public.ksa_region_normalize(NEW.region), NULLIF(btrim(COALESCE(NEW.region, '')), ''));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_budget_lines_region ON public.budget_lines;
CREATE TRIGGER trg_budget_lines_region BEFORE INSERT OR UPDATE OF region ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.normalize_region_column();
DROP TRIGGER IF EXISTS trg_projects_default_region ON public.projects;
CREATE TRIGGER trg_projects_default_region BEFORE INSERT OR UPDATE OF default_region ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.normalize_region_column();

-- v_active_budget_lines (live definition) + region, appended
CREATE OR REPLACE VIEW public.v_active_budget_lines WITH (security_invoker = on) AS
 SELECT id, header_code, main_code, description, amount, rate, unit, x, "group", created_at,
    prep, shooting, wrap, notes, currency, organization_id, topsheet_code, excluded, project_id,
    upload_batch_id, uploaded_at, uploaded_by, character_id, name, rebate_eligible, version_id,
    region                                                                    -- 201
   FROM public.budget_lines bl
  WHERE (EXISTS (SELECT 1 FROM public.budget_versions bv WHERE bv.id = bl.version_id AND bv.status = 'active'))
     OR (bl.version_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.budget_versions bv2 WHERE bv2.project_id = bl.project_id));
REVOKE ALL ON public.v_active_budget_lines FROM anon;

-- create_budget_draft (copy of 140) + region
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
      topsheet_code, notes, rebate_eligible, character_id,
      region                                                                  -- 201
    )
    SELECT bl.project_id, bl.organization_id, _new, bl.header_code, bl.main_code, bl.description, bl.name, bl."group",
      bl.amount, bl.rate, bl.currency, bl.unit, bl.x, bl.prep, bl.shooting, bl.wrap, bl.excluded,
      bl.topsheet_code, bl.notes, bl.rebate_eligible, bl.character_id,
      bl.region
    FROM public.budget_lines bl WHERE bl.version_id = _src;
  END IF;
  RETURN _new;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_project_default_region(p_project uuid, p_region text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_region text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_admin_rebate_settings(p_project) THEN
    RAISE EXCEPTION 'set_project_default_region: not allowed' USING ERRCODE = '42501';
  END IF;
  v_region := NULLIF(btrim(COALESCE(p_region, '')), '');
  IF v_region IS NOT NULL THEN
    v_region := public.ksa_region_normalize(v_region);
    IF v_region IS NULL THEN
      RAISE EXCEPTION 'set_project_default_region: unknown region %', p_region USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.projects SET default_region = v_region WHERE id = p_project;
  RETURN v_region;
END $$;
REVOKE ALL ON FUNCTION public.set_project_default_region(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_project_default_region(uuid, text) TO authenticated, service_role;

-- Film Commission budget section: estimate vs actual by region.
CREATE OR REPLACE FUNCTION public.get_budget_by_region(p_project_id uuid)
RETURNS TABLE (region text, estimate_sar numeric, actual_sar numeric, actual_qpe_sar numeric,
               variance_sar numeric, line_count integer, transaction_count integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE v_org uuid; v_fx numeric; v_def text;
BEGIN
  SELECT p.organization_id, p.fx_rate, p.default_region INTO v_org, v_fx, v_def
    FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'get_budget_by_region: access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH lines AS (
    SELECT bl.main_code AS code, COALESCE(bl.region, v_def) AS rgn,
           public.budget_line_total_sar(bl.amount, bl.rate, bl.x, bl.prep, bl.shooting, bl.wrap,
                                        bl.unit, bl.currency, bl.excluded, v_fx) AS budget
      FROM public.v_active_budget_lines bl
     WHERE bl.project_id = p_project_id
  ),
  code_region AS (     -- region of a code = region of its largest line
    SELECT DISTINCT ON (l.code) l.code, l.rgn
      FROM lines l WHERE l.rgn IS NOT NULL
     ORDER BY l.code, l.budget DESC NULLS LAST, l.rgn
  ),
  tx AS (
    SELECT t.actual_excl, t.status,
           CASE WHEN btrim(COALESCE(t.spend_country, '')) <> '' AND NOT public.is_saudi_nationality(t.spend_country)
                  THEN 'outside_ksa'
                ELSE COALESCE(public.ksa_region_normalize(t.spend_city), cr.rgn, v_def, 'unassigned') END AS rgn
      FROM public.rebate_transactions(p_project_id) t
      LEFT JOIN code_region cr ON cr.code = t.budget_code
     WHERE NOT (t.source = 'invoice' AND EXISTS (SELECT 1 FROM public.invoices i
                                                  WHERE i.id = t.source_id AND i.approval_status <> 'approved'))
  ),
  est AS (SELECT COALESCE(l.rgn, 'unassigned') AS rgn, sum(l.budget) AS e, count(*) AS n FROM lines l GROUP BY 1),
  act AS (SELECT tx.rgn, sum(tx.actual_excl) AS a, sum(tx.actual_excl) FILTER (WHERE tx.status = 'eligible') AS q,
                 count(*) AS n FROM tx GROUP BY 1)
  SELECT COALESCE(e.rgn, a.rgn),
         round(COALESCE(e.e, 0), 2), round(COALESCE(a.a, 0), 2), round(COALESCE(a.q, 0), 2),
         round(COALESCE(e.e, 0) - COALESCE(a.a, 0), 2),
         COALESCE(e.n, 0)::int, COALESCE(a.n, 0)::int
    FROM est e
    FULL JOIN act a ON a.rgn = e.rgn
   WHERE COALESCE(e.e, 0) <> 0 OR COALESCE(a.a, 0) <> 0
   ORDER BY array_position(public.ksa_region_list() || ARRAY['outside_ksa', 'unassigned'], COALESCE(e.rgn, a.rgn));
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_budget_by_region(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_budget_by_region(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_budget_by_region(uuid) IS
  'Film Commission budget by region (db/pending/201): estimate (line region, else project default) vs actual excl. VAT (spend city region, else the region of the budget code''s line, else project default; spend outside KSA = outside_ksa). Approved invoices only. SAR.';

-- ---------------------------------------------------------------------
-- 8. Saudi WHT rate table (editable)
-- ---------------------------------------------------------------------
ALTER TABLE public.wht_rate_rules
  ADD COLUMN IF NOT EXISTS label_en text,
  ADD COLUMN IF NOT EXISTS label_ar text,
  ADD COLUMN IF NOT EXISTS source_note text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;
ALTER TABLE public.wht_rate_rules DROP CONSTRAINT IF EXISTS wht_rate_rules_labels_len;
ALTER TABLE public.wht_rate_rules ADD CONSTRAINT wht_rate_rules_labels_len
  CHECK ((label_en IS NULL OR length(label_en) <= 120) AND (label_ar IS NULL OR length(label_ar) <= 120)
     AND (source_note IS NULL OR length(source_note) <= 500));
COMMENT ON COLUMN public.wht_rate_rules.source_note IS 'Where the rate comes from (db/pending/201 seeds: ZATCA WHT schedule — verify with tax adviser).';

INSERT INTO public.wht_rate_rules (organization_id, service_type, rate_pct, notes, label_en, label_ar, source_note, sort_order, created_by)
VALUES
  (NULL, 'management_fees',        20.00, 'seed 201', 'Management fees',                              'أتعاب الإدارة',                        'ZATCA WHT schedule — verify with tax adviser', 10, NULL),
  (NULL, 'royalties',              15.00, 'seed 201', 'Royalties',                                    'الإتاوات وحقوق الامتياز',              'ZATCA WHT schedule — verify with tax adviser', 20, NULL),
  (NULL, 'technical_consulting',    5.00, 'seed 201', 'Technical and consulting services',            'الخدمات الفنية والاستشارية',           'ZATCA WHT schedule — verify with tax adviser', 30, NULL),
  (NULL, 'rent',                    5.00, 'seed 201', 'Rent',                                         'الإيجار',                              'ZATCA WHT schedule — verify with tax adviser', 40, NULL),
  (NULL, 'air_tickets_freight',     5.00, 'seed 201', 'Air tickets, air and sea freight',             'تذاكر الطيران والشحن الجوي والبحري',   'ZATCA WHT schedule — verify with tax adviser', 50, NULL),
  (NULL, 'international_telecom',   5.00, 'seed 201', 'International telecommunications',             'الاتصالات الدولية',                    'ZATCA WHT schedule — verify with tax adviser', 60, NULL),
  (NULL, 'insurance_reinsurance',   5.00, 'seed 201', 'Insurance and reinsurance premiums',           'أقساط التأمين وإعادة التأمين',         'ZATCA WHT schedule — verify with tax adviser', 70, NULL),
  (NULL, 'dividends',               5.00, 'seed 201', 'Dividends',                                    'توزيعات الأرباح',                      'ZATCA WHT schedule — verify with tax adviser', 80, NULL),
  (NULL, 'loan_returns',            5.00, 'seed 201', 'Loan returns',                                 'عوائد القروض',                         'ZATCA WHT schedule — verify with tax adviser', 90, NULL),
  (NULL, 'related_party_services',  5.00, 'seed 201', 'Services paid to a related party',             'خدمات مدفوعة لطرف مرتبط',              'ZATCA WHT schedule — verify with tax adviser. The legacy rule taxed related-party services at 15%; Ministerial Resolution 25 sets 5% for technical and consulting services whoever the provider, so 5% is used.', 100, NULL),
  (NULL, 'other',                  15.00, 'seed 201', 'Any other payments',                           'أي مدفوعات أخرى',                      'ZATCA WHT schedule — verify with tax adviser', 110, NULL)
ON CONFLICT ((COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)), service_type) DO NOTHING;

-- the 090 default row: labels / note only where empty (its rate is kept)
UPDATE public.wht_rate_rules
   SET label_en = COALESCE(label_en, 'Default (no service type chosen)'),
       label_ar = COALESCE(label_ar, 'افتراضي (بدون نوع خدمة)'),
       source_note = COALESCE(source_note, 'Rate the app applied before the table existed. Choose the service type to apply the ZATCA rate; any other payments are 15%.'),
       sort_order = CASE WHEN sort_order = 1000 THEN 0 ELSE sort_order END
 WHERE organization_id IS NULL AND service_type = 'default'
   AND (label_en IS NULL OR label_ar IS NULL OR source_note IS NULL OR sort_order = 1000);

-- ---------------------------------------------------------------------
-- 9. Contracts bucket: files into project folders, then a project-scoped read
-- ---------------------------------------------------------------------
-- Only the SQL editor / service role (no signed-in user) or a super admin.
CREATE OR REPLACE FUNCTION public.contract_files_assert_admin()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'contract files: only a platform super admin can do this' USING ERRCODE = '42501';
  END IF;
END $$;

-- Every column that holds a path of the contracts bucket, with its record.
CREATE OR REPLACE FUNCTION public.contract_file_refs()
RETURNS TABLE (owner_table text, owner_id uuid, project_id uuid, path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'per_diem_ledger', d.id, d.project_id, d.receipt_path FROM public.per_diem_ledger d WHERE COALESCE(d.receipt_path, '') <> ''
  UNION ALL
  SELECT 'payment_requests', r.id, r.project_id, r.proof_path FROM public.payment_requests r WHERE COALESCE(r.proof_path, '') <> ''
  UNION ALL
  SELECT 'payments', x.id, x.project_id, x.proof_path FROM public.payments x WHERE COALESCE(x.proof_path, '') <> ''
  UNION ALL
  SELECT 'payroll', pa.id, pa.project_id, e.v
    FROM public.payroll pa
    CROSS JOIN LATERAL (
      SELECT DISTINCT s.v FROM (
        SELECT NULLIF(x->>'proofPath', '') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pa.payment_schedule) = 'array' THEN pa.payment_schedule ELSE '[]'::jsonb END) x
        UNION ALL SELECT NULLIF(x->>'receiptPath', '') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pa.payment_schedule) = 'array' THEN pa.payment_schedule ELSE '[]'::jsonb END) x
        UNION ALL SELECT NULLIF(x->>'proofPath', '') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pa.ledger) = 'array' THEN pa.ledger ELSE '[]'::jsonb END) x
        UNION ALL SELECT NULLIF(x->>'proof_path', '') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pa.ledger) = 'array' THEN pa.ledger ELSE '[]'::jsonb END) x
        UNION ALL SELECT NULLIF(x #>> '{}', '') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pa.receipts) = 'array' THEN pa.receipts ELSE '[]'::jsonb END) x
                   WHERE jsonb_typeof(x) = 'string'
      ) s(v) WHERE s.v IS NOT NULL) e
  UNION ALL
  SELECT 'people', pe.id, pe.project_id, v.path
    FROM public.people pe
    CROSS JOIN LATERAL (VALUES (pe.contract_path), (pe.id_attachment_path), (pe.iban_attachment_path)) v(path)
   WHERE COALESCE(v.path, '') <> ''
  UNION ALL
  SELECT 'crew_members', c.id, c.project_id, c.contract_path FROM public.crew_members c WHERE COALESCE(c.contract_path, '') <> ''
  UNION ALL
  SELECT 'picture_assets', a.id, a.project_id, v.path
    FROM public.picture_assets a
    CROSS JOIN LATERAL (VALUES (a.contract_file_path), (a.owner_id_doc_path), (a.vehicle_license_path)) v(path)
   WHERE COALESCE(v.path, '') <> ''
  UNION ALL
  SELECT 'invoices', i.id, i.project_id, v.path
    FROM public.invoices i
    CROSS JOIN LATERAL (VALUES (i.invoice_url), (i.receipt_url)) v(path)
   WHERE COALESCE(v.path, '') <> '' AND v.path !~* '^[a-z]+://'
$$;

-- The plan. action:
--   move      object not under a project folder, one owning project → move it to new_name
--   repoint   the object is already at new_name, references still point at the old path
--   conflict  the object is referenced by records of different projects (moved by nobody)
--   orphan    no record references the object (left where it is)
-- dry_run = false: performs the 'repoint' rows (action becomes 'repointed').
-- The bytes of 'move' rows are moved by the Storage API (server function
-- moveContractFilesToProjectFolders), which then calls repoint_contract_file.
CREATE OR REPLACE FUNCTION public.move_contract_files_to_project_folders(dry_run boolean DEFAULT true)
RETURNS TABLE (object_name text, new_name text, owner_table text, owner_id uuid, project_id uuid, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE r record;
BEGIN
  PERFORM public.contract_files_assert_admin();
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  FOR r IN
    WITH refs AS (
      SELECT f.* FROM public.contract_file_refs() f
       WHERE f.project_id IS NOT NULL
         AND split_part(f.path, '/', 1) IS DISTINCT FROM f.project_id::text
    ),
    obj AS (
      SELECT o.name FROM storage.objects o
       WHERE o.bucket_id = 'contracts'
         AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id::text = lower(split_part(o.name, '/', 1)))
    ),
    by_obj AS (
      SELECT obj.name,
             count(DISTINCT refs.project_id) AS n_proj,
             (array_agg(refs.project_id ORDER BY refs.owner_table, refs.owner_id))[1] AS pid,
             (array_agg(refs.owner_table ORDER BY refs.owner_table, refs.owner_id))[1] AS otab,
             (array_agg(refs.owner_id ORDER BY refs.owner_table, refs.owner_id))[1] AS oid
        FROM obj LEFT JOIN refs ON refs.path = obj.name
       GROUP BY obj.name
    ),
    moved AS (          -- references whose file already sits under the project folder
      SELECT DISTINCT ON (refs.path) refs.path, refs.project_id AS pid, refs.owner_table AS otab, refs.owner_id AS oid
        FROM refs
       WHERE EXISTS (SELECT 1 FROM storage.objects o2
                      WHERE o2.bucket_id = 'contracts' AND o2.name = refs.project_id::text || '/' || refs.path)
         AND NOT EXISTS (SELECT 1 FROM storage.objects o3 WHERE o3.bucket_id = 'contracts' AND o3.name = refs.path)
       ORDER BY refs.path, refs.owner_table, refs.owner_id
    )
    SELECT b.name AS object_name,
           CASE WHEN b.n_proj = 1 THEN b.pid::text || '/' || b.name END AS new_name,
           b.otab AS owner_table, b.oid AS owner_id, CASE WHEN b.n_proj = 1 THEN b.pid END AS project_id,
           CASE WHEN b.n_proj = 0 THEN 'orphan' WHEN b.n_proj > 1 THEN 'conflict' ELSE 'move' END AS action
      FROM by_obj b
    UNION ALL
    SELECT m.path, m.pid::text || '/' || m.path, m.otab, m.oid, m.pid, 'repoint' FROM moved m
    ORDER BY 6, 1
  LOOP
    object_name := r.object_name; new_name := r.new_name; owner_table := r.owner_table;
    owner_id := r.owner_id; project_id := r.project_id; action := r.action;
    IF NOT dry_run AND r.action = 'repoint' THEN
      PERFORM public.repoint_contract_file(r.object_name, r.new_name);
      action := 'repointed';
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

-- Repoint every reference of one moved file (one transaction). p_new must be
-- <project id>/<p_old> and every record referencing p_old must belong to
-- that project — a path can never be pointed into another project.
CREATE OR REPLACE FUNCTION public.repoint_contract_file(p_old text, p_new text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_pid uuid; v_n int := 0; v_k int;
BEGIN
  PERFORM public.contract_files_assert_admin();
  IF COALESCE(p_old, '') = '' OR COALESCE(p_new, '') = '' OR length(p_new) > 1024 THEN
    RAISE EXCEPTION 'repoint_contract_file: old and new path are required' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_pid := split_part(p_new, '/', 1)::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'repoint_contract_file: the new path must start with the project id' USING ERRCODE = '22023';
  END;
  IF p_new <> v_pid::text || '/' || p_old OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_pid) THEN
    RAISE EXCEPTION 'repoint_contract_file: the new path must be <project id>/<old path>' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.contract_file_refs() f WHERE f.path = p_old AND f.project_id IS DISTINCT FROM v_pid) THEN
    RAISE EXCEPTION 'repoint_contract_file: % is referenced by records of another project', p_old USING ERRCODE = '42501';
  END IF;

  UPDATE public.per_diem_ledger SET receipt_path = p_new WHERE receipt_path = p_old AND project_id = v_pid;
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  UPDATE public.payment_requests SET proof_path = p_new WHERE proof_path = p_old AND project_id = v_pid;
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  UPDATE public.payments SET proof_path = p_new WHERE proof_path = p_old AND project_id = v_pid;
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  UPDATE public.crew_members SET contract_path = p_new WHERE contract_path = p_old AND project_id = v_pid;
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  UPDATE public.people
     SET contract_path = CASE WHEN contract_path = p_old THEN p_new ELSE contract_path END,
         id_attachment_path = CASE WHEN id_attachment_path = p_old THEN p_new ELSE id_attachment_path END,
         iban_attachment_path = CASE WHEN iban_attachment_path = p_old THEN p_new ELSE iban_attachment_path END
   WHERE project_id = v_pid AND p_old IN (contract_path, id_attachment_path, iban_attachment_path);
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  UPDATE public.picture_assets
     SET contract_file_path = CASE WHEN contract_file_path = p_old THEN p_new ELSE contract_file_path END,
         owner_id_doc_path = CASE WHEN owner_id_doc_path = p_old THEN p_new ELSE owner_id_doc_path END,
         vehicle_license_path = CASE WHEN vehicle_license_path = p_old THEN p_new ELSE vehicle_license_path END
   WHERE project_id = v_pid AND p_old IN (contract_file_path, owner_id_doc_path, vehicle_license_path);
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  UPDATE public.invoices
     SET invoice_url = CASE WHEN invoice_url = p_old THEN p_new ELSE invoice_url END,
         receipt_url = CASE WHEN receipt_url = p_old THEN p_new ELSE receipt_url END
   WHERE project_id = v_pid AND p_old IN (invoice_url, receipt_url);
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;

  -- payroll JSON (proof paths only; not a user edit of the schedule)
  PERFORM set_config('kwalis.milestone_sync', 'repoint_contract_file', true);
  UPDATE public.payroll pa
     SET payment_schedule = CASE WHEN jsonb_typeof(pa.payment_schedule) = 'array' THEN (
           SELECT COALESCE(jsonb_agg(
                    CASE WHEN x->>'proofPath' = p_old THEN jsonb_set(x, '{proofPath}', to_jsonb(p_new)) ELSE x END
                    || CASE WHEN x->>'receiptPath' = p_old THEN jsonb_build_object('receiptPath', p_new) ELSE '{}'::jsonb END
                    ORDER BY o), '[]'::jsonb)
             FROM jsonb_array_elements(pa.payment_schedule) WITH ORDINALITY t(x, o)) ELSE pa.payment_schedule END,
         ledger = CASE WHEN jsonb_typeof(pa.ledger) = 'array' THEN (
           SELECT COALESCE(jsonb_agg(
                    CASE WHEN x->>'proofPath' = p_old THEN jsonb_set(x, '{proofPath}', to_jsonb(p_new)) ELSE x END
                    || CASE WHEN x->>'proof_path' = p_old THEN jsonb_build_object('proof_path', p_new) ELSE '{}'::jsonb END
                    ORDER BY o), '[]'::jsonb)
             FROM jsonb_array_elements(pa.ledger) WITH ORDINALITY t(x, o)) ELSE pa.ledger END,
         receipts = CASE WHEN jsonb_typeof(pa.receipts) = 'array' THEN (
           SELECT COALESCE(jsonb_agg(CASE WHEN x #>> '{}' = p_old AND jsonb_typeof(x) = 'string' THEN to_jsonb(p_new) ELSE x END
                                     ORDER BY o), '[]'::jsonb)
             FROM jsonb_array_elements(pa.receipts) WITH ORDINALITY t(x, o)) ELSE pa.receipts END
   WHERE pa.project_id = v_pid
     AND EXISTS (SELECT 1 FROM public.contract_file_refs() f
                  WHERE f.owner_table = 'payroll' AND f.owner_id = pa.id AND f.path = p_old);
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  PERFORM set_config('kwalis.milestone_sync', '', true);
  RETURN v_n;
END;
$fn$;

-- The policy switch (195 §2), only when no file is left outside a project
-- folder. p_ignore_orphans = true lets unreferenced files stay where they
-- are (after the switch only super admins / the service role read them).
CREATE OR REPLACE FUNCTION public.switch_contracts_bucket_to_project_policy(p_ignore_orphans boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_left int; v_orphans int;
BEGIN
  PERFORM public.contract_files_assert_admin();
  IF to_regclass('storage.objects') IS NULL THEN RETURN 'no storage schema'; END IF;
  SELECT count(*) FILTER (WHERE m.action IN ('move', 'repoint', 'conflict')),
         count(*) FILTER (WHERE m.action = 'orphan')
    INTO v_left, v_orphans
    FROM public.move_contract_files_to_project_folders(true) m;
  IF v_left > 0 OR (v_orphans > 0 AND NOT p_ignore_orphans) THEN
    RAISE NOTICE '201: % contract file(s) still outside a project folder and % unreferenced — the org-wide read policy is kept. Move them first (move_contract_files_to_project_folders).', v_left, v_orphans;
    RETURN 'skipped';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname = 'Project members can read contract files by project') THEN
    EXECUTE $p$CREATE POLICY "Project members can read contract files by project" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'contracts'
             AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             AND public.can_access_project(auth.uid(), NULL, ((storage.foldername(name))[1])::uuid))$p$;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS "Org members can read contracts" ON storage.objects';
  RETURN 'switched';
END;
$fn$;

REVOKE ALL ON FUNCTION public.contract_files_assert_admin(), public.contract_file_refs(),
  public.move_contract_files_to_project_folders(boolean), public.repoint_contract_file(text, text),
  public.switch_contracts_bucket_to_project_policy(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contract_file_refs() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.move_contract_files_to_project_folders(boolean), public.repoint_contract_file(text, text),
  public.switch_contracts_bucket_to_project_policy(boolean), public.contract_files_assert_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contract_file_refs() TO service_role;

-- Switch now if nothing is left to move (NOTICE and no change otherwise).
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    RAISE NOTICE '201 contracts bucket policy: %', public.switch_contracts_bucket_to_project_policy(false);
  END IF;
END $$;
