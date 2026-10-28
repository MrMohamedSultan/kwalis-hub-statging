-- =====================================================================
-- 196 — Reconcile the glossary model (180) with the double-entry ledger
--       (182), one treasury table, request payments, report RPCs.
--
-- Why: 180 and 182 were built in parallel. 182 posted instalments from its
-- own reading of the payroll JSON, 180 has the instalment rows
-- (payroll_instalments) and the reversal log (accrual_reversals); 180 kept
-- VAT / WHT cash movements in project_tax_payments, 182 kept WHT
-- remittance / VAT recovery / petty cash return / bank charges in
-- treasury_movements; the Funding screen cash balance and the Trial
-- Balance bank account were computed two different ways.
--
-- What changes
--   1. Ledger rules read the glossary model:
--      * instalment accruals come from public.payroll_instalments
--        (status Approved / Paid, dated approved_at, Dr expense amount_gross,
--        Cr payable amount, Cr WHT the difference). A ledger trigger on
--        payroll_instalments posts / reverses as soon as the row changes.
--      * reversing entries: the engine already reverses an accrual whose
--        instalment is no longer Approved / Paid (same amounts, dated the
--        day of the change). accrual_reversals stays the audit record of the
--        un-approval; it is NOT posted a second time (the DB test proves the
--        reversal entry equals the accrual_reversals amount).
--      * funding: project_funding rows with status 'received'; the kind is
--        part of the description. New columns currency / original_amount /
--        fx_rate (B28): amount stays the SAR booked amount.
--      * ONE treasury table: public.treasury_movements (the richer one —
--        it carries the petty cash float and the budget code) gets the kind
--        'vat_payment'. Rows of project_tax_payments are copied into it
--        (vat_paid → vat_payment, vat_recovered → vat_recovery,
--        wht_remitted → wht_remittance), the old table is renamed
--        project_tax_payments_legacy_180 (kept, not deleted) and
--        project_tax_payments becomes a compatibility VIEW over
--        treasury_movements (insert / update / delete still work through it).
--      * get_funding_position(): the cash balance is the balance of the
--        bank account in the ledger (9100) — the same lines the Trial
--        Balance adds up — with its parts (funding, paid from the bank,
--        petty cash floats issued / returned, VAT paid / recovered, WHT
--        remitted, bank charges). Cash on hand (9110) and the petty cash
--        floats (9120) are returned beside it.
--   2. A non-instalment payment request (invoice / PO / petty cash float)
--      that becomes "paid" writes its payments row (like 160 does for
--      instalments). A payment already recorded by hand for the same
--      document and amount is adopted instead of duplicated, and a hand
--      payment that repeats a request payment is refused. Old paid requests
--      are filled by backfill_request_payments() — NOT run by this file.
--   3. v_ledger_transactions (copy of 180): reference = COALESCE(ref_no, …),
--      new columns ref_no and row_key (id:entry_kind — payroll rows appear
--      twice, actual + commitment, with the same id).
--   4. get_cash_flow (copy of 110): a cancelled contract forecasts only its
--      approved, unpaid instalments.
--   5. New report RPCs: get_payments_register (R12, from the ledger lines
--      that take money out of the bank / cash / petty cash).
--
-- SECURITY: new trigger functions, views read by the app, a renamed table
-- and SECURITY DEFINER triggers on payments — per SECURITY.md apply only
-- after owner approval.
--
-- Owner steps after applying (after a backup):
--   SELECT public.backfill_request_payments();          -- old paid invoice / PO / petty requests
--   for every project already initialised by 182:
--   SELECT public.ledger_resync_project('<project id>'); -- re-apply the rules
--   SELECT public.ledger_phases_match('<project id>');   -- must be true
--
-- Security review fix (secfix #6, before first apply): apply_request_payment
-- adopts / updates and refuse_duplicate_request_payment compares only
-- payments of the request's (payment's) own organization and project.
--
-- Rollback (in this order):
--   DROP TRIGGER trg_ledger_sync ON public.payroll_instalments;
--   DROP TRIGGER trg_payment_request_payment ON public.payment_requests;
--   DROP TRIGGER trg_payments_no_duplicate_request ON public.payments;
--   DROP TRIGGER zz_trg_project_lock ON public.treasury_movements;
--   DROP FUNCTION public.get_payments_register(uuid, date, date), public.backfill_request_payments(uuid),
--     public.sync_payment_from_request(), public.refuse_duplicate_request_payment(),
--     public.apply_request_payment(public.payment_requests), public.project_tax_payments_write();
--   DROP VIEW public.project_tax_payments;
--   ALTER TABLE public.project_tax_payments_legacy_180 RENAME TO project_tax_payments;
--   DELETE FROM public.treasury_movements WHERE legacy_tax_payment_id IS NOT NULL;
--   UPDATE public.treasury_movements SET kind = 'wht_remittance' WHERE kind = 'vat_payment'; (or delete them)
--   re-run db/pending/182 (v_journal_lines, v_payroll_instalments, ledger_on_source_change,
--     treasury_movements kind check), 180 (v_ledger_transactions, get_funding_position),
--     110 (get_cash_flow);
--   DELETE FROM public.payments WHERE payment_request_id IS NOT NULL AND notes LIKE 'Payment request:%';
--   ALTER TABLE public.payments DROP COLUMN payment_request_id;
--   ALTER TABLE public.treasury_movements DROP COLUMN legacy_tax_payment_id;
--   ALTER TABLE public.project_funding DROP COLUMN currency, DROP COLUMN original_amount, DROP COLUMN fx_rate;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
-- B28: the currency the funding was received in (amount stays SAR)
ALTER TABLE public.project_funding ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SAR';
ALTER TABLE public.project_funding ADD COLUMN IF NOT EXISTS original_amount numeric(14,2);
ALTER TABLE public.project_funding ADD COLUMN IF NOT EXISTS fx_rate numeric(18,8);
ALTER TABLE public.project_funding DROP CONSTRAINT IF EXISTS project_funding_currency_check;
ALTER TABLE public.project_funding ADD CONSTRAINT project_funding_currency_check
  CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE public.project_funding DROP CONSTRAINT IF EXISTS project_funding_fx_check;
ALTER TABLE public.project_funding ADD CONSTRAINT project_funding_fx_check
  CHECK ((original_amount IS NULL OR original_amount > 0) AND (fx_rate IS NULL OR fx_rate > 0));
COMMENT ON COLUMN public.project_funding.currency IS 'Currency the money was received in (B28). amount is always the SAR booked amount.';
COMMENT ON COLUMN public.project_funding.original_amount IS 'Amount in currency when it is not SAR (B28).';
COMMENT ON COLUMN public.project_funding.fx_rate IS 'SAR per 1 unit of currency applied when booking (B28).';

-- one treasury table: VAT paid joins the kinds; link to the migrated tax row
ALTER TABLE public.treasury_movements DROP CONSTRAINT IF EXISTS treasury_movements_kind_check;
ALTER TABLE public.treasury_movements ADD CONSTRAINT treasury_movements_kind_check
  CHECK (kind IN ('wht_remittance', 'vat_recovery', 'vat_payment', 'petty_cash_return', 'bank_charge'));
ALTER TABLE public.treasury_movements ADD COLUMN IF NOT EXISTS legacy_tax_payment_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_movements_legacy_tax
  ON public.treasury_movements (legacy_tax_payment_id) WHERE legacy_tax_payment_id IS NOT NULL;
COMMENT ON TABLE public.treasury_movements IS
  'Bank movements without a document of their own: VAT paid to / recovered from ZATCA, WHT remitted, petty cash returned to the bank, bank charges. The one table for these (db/pending/196 merged project_tax_payments into it). SAR.';

-- a locked project refuses new treasury movements too (184 rule)
DROP TRIGGER IF EXISTS zz_trg_project_lock ON public.treasury_movements;
CREATE TRIGGER zz_trg_project_lock BEFORE INSERT OR UPDATE OR DELETE ON public.treasury_movements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_lock();

-- request payments (A2)
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_request_id uuid
  REFERENCES public.payment_requests(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_payment_request
  ON public.payments (payment_request_id) WHERE payment_request_id IS NOT NULL;
COMMENT ON COLUMN public.payments.payment_request_id IS
  'The paid payment request this payment came from (invoice / PO / petty cash requests, db/pending/196). Instalments link by payroll_milestone_id (160).';

-- ---------------------------------------------------------------------
-- 2. project_tax_payments → treasury_movements (data copied, table kept)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'project_tax_payments' AND c.relkind = 'r') THEN
    INSERT INTO public.treasury_movements
      (organization_id, project_id, kind, movement_date, amount, reference, notes, created_by, created_at,
       legacy_tax_payment_id)
    SELECT t.organization_id, t.project_id,
           CASE t.kind WHEN 'vat_paid' THEN 'vat_payment' WHEN 'vat_recovered' THEN 'vat_recovery' ELSE 'wht_remittance' END,
           t.payment_date, t.amount, t.reference, t.notes, t.created_by, t.created_at, t.id
      FROM public.project_tax_payments t
     WHERE NOT EXISTS (SELECT 1 FROM public.treasury_movements m WHERE m.legacy_tax_payment_id = t.id);
    ALTER TABLE public.project_tax_payments RENAME TO project_tax_payments_legacy_180;
    COMMENT ON TABLE public.project_tax_payments_legacy_180 IS
      'Frozen copy of the 180 tax payments table. Its rows were copied to treasury_movements (legacy_tax_payment_id) by db/pending/196. Not read by the app.';
    REVOKE INSERT, UPDATE, DELETE ON public.project_tax_payments_legacy_180 FROM authenticated;
  END IF;
END $$;

-- compatibility view: the 180 shape, over the one table
CREATE OR REPLACE VIEW public.project_tax_payments WITH (security_invoker = on) AS
SELECT m.id, m.organization_id, m.project_id,
       m.movement_date AS payment_date,
       CASE m.kind WHEN 'vat_payment' THEN 'vat_paid' WHEN 'vat_recovery' THEN 'vat_recovered' ELSE 'wht_remitted' END AS kind,
       m.amount, m.reference, m.notes, m.created_by, NULL::uuid AS updated_by, m.created_at, m.updated_at
  FROM public.treasury_movements m
 WHERE m.kind IN ('vat_payment', 'vat_recovery', 'wht_remittance');
COMMENT ON VIEW public.project_tax_payments IS
  'Compatibility view (db/pending/196): VAT paid / recovered and WHT remitted, read from and written to public.treasury_movements.';

-- writes through the view land in treasury_movements (RLS of that table applies: SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.project_tax_payments_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_kind text;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_kind := CASE NEW.kind WHEN 'vat_paid' THEN 'vat_payment' WHEN 'vat_recovered' THEN 'vat_recovery'
                            WHEN 'wht_remitted' THEN 'wht_remittance' END;
    IF v_kind IS NULL THEN
      RAISE EXCEPTION 'project_tax_payments: kind must be vat_paid, vat_recovered or wht_remitted' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.treasury_movements (id, organization_id, project_id, kind, movement_date, amount, reference, notes)
    VALUES (COALESCE(NEW.id, gen_random_uuid()), NEW.organization_id, NEW.project_id, v_kind, NEW.payment_date,
            NEW.amount, NEW.reference, NEW.notes);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.treasury_movements
       SET kind = v_kind, movement_date = NEW.payment_date, amount = NEW.amount,
           reference = NEW.reference, notes = NEW.notes
     WHERE id = OLD.id;
    RETURN NEW;
  ELSE
    DELETE FROM public.treasury_movements WHERE id = OLD.id;
    RETURN OLD;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.project_tax_payments_write() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_project_tax_payments_write ON public.project_tax_payments;
CREATE TRIGGER trg_project_tax_payments_write INSTEAD OF INSERT OR UPDATE OR DELETE ON public.project_tax_payments
  FOR EACH ROW EXECUTE FUNCTION public.project_tax_payments_write();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_tax_payments TO authenticated;
GRANT ALL ON public.project_tax_payments TO service_role;
REVOKE ALL ON public.project_tax_payments FROM anon;

-- ---------------------------------------------------------------------
-- 3. Ledger rules (phase 1 view) — copy of 182, changes marked "196"
-- ---------------------------------------------------------------------
-- 196: the instalment rows of 180 (same columns as the 182 view)
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
       pi.project_id
  FROM public.payroll_instalments pi
  JOIN public.payroll p ON p.id = pi.payroll_id;
COMMENT ON VIEW public.v_payroll_instalments IS
  'Contract instalments for the ledger, read from public.payroll_instalments (180): net = instalment amount, gross = share of the contract value, approved_on = approval of its payment request. db/pending/196.';

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
  UNION ALL
  -- 196: instalment Approved / Paid, from payroll_instalments:
  --      Dr expense (amount_gross) / Cr payable (amount) + Cr WHT (difference), dated approved_at
  SELECT 'instalment:' || p.id || ':' || mi.milestone_id, 'instalment', 'payroll',
         p.id, NULL::uuid, p.organization_id, p.project_id,
         COALESCE(mi.approved_at::date, mi.paid_date, p.created_at::date), l.line_no, l.gl, l.amt,
         p.name, p.budget_code, COALESCE(mi.label, 'P' || mi.seq),
         'Instalment — ' || p.name || ' — ' || COALESCE(NULLIF(pe."position", ''), p.kind) || ' / ' || COALESCE(mi.label, 'P' || mi.seq),
         NULL::text, mi.status, false
    FROM public.payroll p
    JOIN public.payroll_instalments mi ON mi.payroll_id = p.id
    LEFT JOIN public.people pe
           ON p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND pe.id = p.ref_id::uuid
    CROSS JOIN public.v_ledger_system_accounts s
    CROSS JOIN LATERAL (VALUES
      (1, public.ledger_expense_account(p.organization_id, p.budget_code, p.gl_account_id), round(mi.amount_gross, 2)),
      (2, s.payable, -round(mi.amount, 2)),
      (3, s.wht,     -(round(mi.amount_gross, 2) - round(mi.amount, 2)))) l(line_no, gl, amt)
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
  'Phase 1 general ledger (decision 4): two or more debit/credit lines per financial event, computed from the current tables. Rules in db/pending/182, instalments / funding / treasury per db/pending/196. Σ debit = Σ credit per event_key.';

-- 196: the engine also follows payroll_instalments (its row id is the payroll id)
CREATE OR REPLACE FUNCTION public.ledger_on_source_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_ids uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ledger_projects lp
                  WHERE lp.project_id IN ((n->>'project_id')::uuid, (o->>'project_id')::uuid)) THEN
    RETURN NULL;                                  -- ledger not initialised for this project
  END IF;
  IF TG_TABLE_NAME = 'payroll_instalments' THEN   -- 196
    v_ids := ARRAY[(n->>'payroll_id')::uuid, (o->>'payroll_id')::uuid];
  ELSE
    v_ids := ARRAY[(COALESCE(n, o)->>'id')::uuid];
  END IF;
  IF TG_TABLE_NAME = 'payments' THEN              -- a payment against a float replaces its approval entry
    v_ids := v_ids || ARRAY[(n->>'source_id')::uuid, (o->>'source_id')::uuid];
  END IF;
  PERFORM public.ledger_sync_source(array_remove(v_ids, NULL));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.ledger_on_source_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ledger_sync ON public.payroll_instalments;
CREATE TRIGGER trg_ledger_sync AFTER INSERT OR UPDATE OR DELETE ON public.payroll_instalments
  FOR EACH ROW EXECUTE FUNCTION public.ledger_on_source_change();


-- ---------------------------------------------------------------------
-- 4. Funding position = the bank account of the ledger (A09 / A12)
-- ---------------------------------------------------------------------
-- Cash figures of a project as of a date (default today). SAR.
--   cash_balance     balance of 9100 Bank in the ledger (= Trial Balance) =
--                    funding − paid_from_bank − petty_cash_issued + petty_cash_returned
--                    − vat_paid + vat_recovered − wht_remitted − bank_charges
--   paid             every payment (payments ledger, glossary Paid)
--   paid_from_bank   payments that left the bank account (not cash / petty cash)
--   cash_on_hand     balance of 9110 Cash on hand; petty_cash = 9120 floats
--   upcoming         approved, not paid yet: unpaid invoice balances
--                    (net payable incl. VAT less WHT) + Approved instalments
--   expected_balance cash_balance − upcoming
--   actual / commitment / payable (= actual − paid) as in v_project_position
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
   WHERE i.project_id = p_project_id;
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

-- ---------------------------------------------------------------------
-- 5. A2 — paid invoice / PO / petty cash requests reach the payments ledger
-- ---------------------------------------------------------------------
-- One payments row per paid request: updated when the request changes,
-- removed when it is no longer paid (its ledger entry is then reversed).
-- A payment recorded by hand for the same document and amount is adopted.
CREATE OR REPLACE FUNCTION public.apply_request_payment(r public.payment_requests)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_types  text[];
  v_amount numeric;
  v_date   date;
  v_method text;
  v_id     uuid;
BEGIN
  IF r.payroll_milestone_id IS NOT NULL OR r.source_type NOT IN ('invoice', 'purchase_order', 'petty_cash') THEN
    RETURN NULL;                                   -- instalments: 160 / 176
  END IF;
  v_types := CASE r.source_type WHEN 'invoice' THEN ARRAY['invoice']
                                WHEN 'purchase_order' THEN ARRAY['purchase_order', 'po']
                                ELSE ARRAY['petty_cash', 'cash_advance'] END;

  IF r.status IS DISTINCT FROM 'paid' THEN
    -- no longer paid: the row it created goes, a hand row it adopted is released
    DELETE FROM public.payments WHERE payment_request_id = r.id AND notes LIKE 'Payment request:%';
    UPDATE public.payments SET payment_request_id = NULL, updated_at = now() WHERE payment_request_id = r.id;
    RETURN NULL;
  END IF;

  v_amount := round(public.payment_request_amount_sar(r.requested_amount, r.currency, r.project_id), 2);
  v_date   := COALESCE(r.payment_date, r.executed_at::date, CURRENT_DATE);
  v_method := CASE WHEN r.payment_method IN ('Cash', 'Transfer', 'Check', 'Card', 'Bank') THEN r.payment_method ELSE 'Transfer' END;

  UPDATE public.payments
     SET amount = v_amount, payment_date = v_date, method = v_method,
         proof_path = COALESCE(r.proof_path, proof_path), updated_at = now()
   WHERE payment_request_id = r.id
     AND organization_id = r.organization_id                               -- secfix #6
     AND project_id IS NOT DISTINCT FROM r.project_id
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- adopt a payment recorded by hand for this document with the same amount
  -- (secfix #6: only a payment of the request's own organization and project)
  UPDATE public.payments
     SET payment_request_id = r.id, updated_at = now()
   WHERE id = (SELECT p.id FROM public.payments p
                WHERE p.source_id = r.source_id AND p.source_type = ANY (v_types)
                  AND p.organization_id = r.organization_id
                  AND p.project_id IS NOT DISTINCT FROM r.project_id
                  AND p.payment_request_id IS NULL AND p.payroll_milestone_id IS NULL
                  AND p.amount = v_amount
                ORDER BY p.payment_date, p.created_at LIMIT 1)
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.payments
    (organization_id, project_id, source_type, source_id, amount, payment_date, method, proof_path, notes,
     recorded_by, payment_request_id)
  VALUES
    (r.organization_id, r.project_id, r.source_type, r.source_id, v_amount, v_date, v_method, r.proof_path,
     left('Payment request: ' || COALESCE(NULLIF(r.source_label, ''), r.source_type), 500),
     COALESCE(r.executed_by, auth.uid()), r.id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_request_payment(public.payment_requests) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_payment_from_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.status IS DISTINCT FROM 'paid' THEN
    RETURN NEW;                                    -- nothing paid moved
  END IF;
  PERFORM public.apply_request_payment(NEW);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_payment_from_request() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payment_request_payment ON public.payment_requests;
CREATE TRIGGER trg_payment_request_payment
  AFTER INSERT OR UPDATE OF status, payment_date, payment_method, requested_amount, proof_path ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_payment_from_request();

-- A hand payment that repeats a request payment (same document, same amount) is refused.
CREATE OR REPLACE FUNCTION public.refuse_duplicate_request_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ref text;
BEGIN
  IF NEW.payment_request_id IS NOT NULL OR NEW.payroll_milestone_id IS NOT NULL OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(p.ref_no, p.id::text) INTO v_ref FROM public.payments p
   WHERE p.source_id = NEW.source_id AND p.payment_request_id IS NOT NULL AND p.amount = NEW.amount
     AND p.organization_id = NEW.organization_id                           -- secfix #6
     AND p.project_id IS NOT DISTINCT FROM NEW.project_id
     AND p.id IS DISTINCT FROM NEW.id
   LIMIT 1;
  IF v_ref IS NOT NULL THEN
    RAISE EXCEPTION 'This payment is already recorded from its payment request (%)', v_ref
      USING ERRCODE = '23505', HINT = 'Payments of approved requests are recorded automatically when the request is marked paid.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.refuse_duplicate_request_payment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payments_no_duplicate_request ON public.payments;
CREATE TRIGGER trg_payments_no_duplicate_request
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.refuse_duplicate_request_payment();

-- ONE-TIME fill for requests paid before this file. Not run here: the owner
-- runs it AFTER A BACKUP:  SELECT public.backfill_request_payments();
CREATE OR REPLACE FUNCTION public.backfill_request_payments(p_project_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_requests%ROWTYPE; v_n int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'backfill_request_payments: platform owner only' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT * FROM public.payment_requests q
            WHERE q.status = 'paid' AND q.payroll_milestone_id IS NULL
              AND q.source_type IN ('invoice', 'purchase_order', 'petty_cash')
              AND (p_project_id IS NULL OR q.project_id = p_project_id)
              AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.payment_request_id = q.id)
            ORDER BY q.payment_date NULLS LAST, q.created_at LOOP
    IF public.apply_request_payment(r) IS NOT NULL THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.backfill_request_payments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_request_payments(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 6. R12 — Payments Register: every event that takes money out of the bank,
--    cash on hand or a petty cash float, from the ledger lines (so its bank
--    total is the bank credits of the General Ledger)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_payments_register(p_project_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (event_key text, event_type text, payment_date date, payment_ref text, payee text,
               document_type text, document_id uuid, document_ref text, instalment text, budget_code text,
               method text, paid_from_code text, paid_from_name text, gross numeric, wht numeric, net numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM public.ledger_assert_member(p_project_id, 'get_payments_register');
  RETURN QUERY
  WITH l AS (
    SELECT x.*, g.code AS gl_code, g.name AS gl_name, g.account_type
      FROM public.ledger_project_lines(p_project_id) x
      JOIN public.gl_accounts g ON g.id = x.gl_account_id
     WHERE x.event_type IN ('payment', 'petty_issue', 'wht_remittance', 'vat_payment', 'bank_charge',
                            'petty_receipt', 'per_diem')),
  -- the cash account each event pays from (credited by its original lines)
  src AS (
    SELECT DISTINCT ON (l.event_key) l.event_key, l.gl_account_id AS from_gl, l.gl_code, l.gl_name
      FROM l
     WHERE l.account_type IN ('bank', 'cash', 'petty_cash') AND l.credit > 0 AND NOT l.is_reversal
     ORDER BY l.event_key, l.entry_seq),
  ev AS (
    SELECT l.event_key, min(l.event_type) AS et,
           COALESCE(min(l.entry_date) FILTER (WHERE NOT l.is_reversal), min(l.entry_date)) AS d,
           (array_agg(l.party ORDER BY l.is_reversal, l.entry_seq DESC, l.line_no))[1] AS party,
           (array_agg(l.budget_code ORDER BY l.is_reversal, l.entry_seq DESC, l.line_no))[1] AS code,
           s.gl_code, s.gl_name,
           sum(l.credit - l.debit) FILTER (WHERE l.gl_account_id = s.from_gl) AS net
      FROM l JOIN src s ON s.event_key = l.event_key
     GROUP BY l.event_key, s.gl_code, s.gl_name),
  d AS (
    SELECT ev.*, split_part(ev.event_key, ':', 1) AS prefix,
           NULLIF(split_part(ev.event_key, ':', 2), '')::uuid AS src_id
      FROM ev
     WHERE ev.net <> 0
       AND (p_from IS NULL OR ev.d >= p_from) AND (p_to IS NULL OR ev.d <= p_to))
  SELECT d.event_key, d.et, d.d,
         COALESCE(pay.ref_no, ca.ref_no, rc.ref_no, pdl.ref_no, NULLIF(tm.reference, '')),
         COALESCE(d.party, inv.vendor_name, pr.name, po.vendor_name, fl.holder),
         CASE d.prefix
           WHEN 'payment' THEN CASE WHEN pay.source_type IN ('purchase_order', 'po') THEN 'purchase_order'
                                    WHEN pay.source_type IN ('petty_cash', 'cash_advance', 'receipt', 'cash_advance_receipt') THEN 'petty_cash'
                                    ELSE pay.source_type END
           WHEN 'treasury' THEN tm.kind
           WHEN 'petty_issue' THEN 'petty_cash'
           WHEN 'petty_receipt' THEN 'petty_receipt'
           ELSE d.prefix END,
         CASE d.prefix WHEN 'payment' THEN pay.source_id WHEN 'treasury' THEN tm.id ELSE d.src_id END,
         COALESCE(inv.ref_no, inv.invoice_no, pr.ref_no, po.ref_no, po.po_number, fl.ref_no, ca.ref_no, rc.ref_no, pdl.ref_no),
         COALESCE(pi.label, CASE WHEN pi.seq IS NOT NULL THEN 'P' || pi.seq END),
         COALESCE(d.code, inv.budget_code, pr.budget_code, po.budget_code, tm.budget_code),
         CASE WHEN pay.id IS NOT NULL THEN pay.method
              WHEN d.prefix IN ('petty_receipt', 'per_diem') THEN 'Petty cash'
              ELSE 'Transfer' END,
         d.gl_code, d.gl_name,
         round(d.net + w.wht, 2), round(w.wht, 2), round(d.net, 2)
    FROM d
    LEFT JOIN public.payments pay ON d.prefix = 'payment' AND pay.id = d.src_id
    LEFT JOIN public.invoices inv ON pay.source_type = 'invoice' AND inv.id = pay.source_id
    LEFT JOIN public.payroll pr ON pay.source_type = 'payroll' AND pr.id = pay.source_id
    LEFT JOIN public.payroll_instalments pi ON pr.id IS NOT NULL AND pi.payroll_id = pr.id AND pi.milestone_id = pay.payroll_milestone_id
    LEFT JOIN public.purchase_orders po ON pay.source_type IN ('purchase_order', 'po') AND po.id = pay.source_id
    LEFT JOIN public.cash_advances fl ON pay.source_type IN ('petty_cash', 'cash_advance') AND fl.id = pay.source_id
    LEFT JOIN public.cash_advances ca ON d.prefix = 'petty_issue' AND ca.id = d.src_id
    LEFT JOIN public.cash_advance_receipts rc ON d.prefix = 'petty_receipt' AND rc.id = d.src_id
    LEFT JOIN public.per_diem_ledger pdl ON d.prefix = 'per_diem' AND pdl.id = d.src_id
    LEFT JOIN public.treasury_movements tm ON d.prefix = 'treasury' AND tm.id = d.src_id
    CROSS JOIN LATERAL (SELECT CASE
        -- instalment: its WHT share of what was paid
        WHEN pi.payroll_id IS NOT NULL AND pi.amount > 0
          THEN (pi.amount_gross - pi.amount) * d.net / pi.amount
        -- invoice: WHT share of the net payable
        WHEN inv.id IS NOT NULL AND COALESCE(inv.wht_amount, 0) > 0
             AND COALESCE(inv.price, 0) + COALESCE(inv.vat_amount, 0) - inv.wht_amount > 0
          THEN inv.wht_amount * d.net / (COALESCE(inv.price, 0) + COALESCE(inv.vat_amount, 0) - inv.wht_amount)
        ELSE 0 END AS wht) w
   ORDER BY d.d, d.event_key;
END $$;
REVOKE ALL ON FUNCTION public.get_payments_register(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payments_register(uuid, date, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_payments_register(uuid, date, date) IS
  'Payments Register (R12): one row per payment out of the bank / cash / petty cash in the ledger (payments, petty cash floats and receipts, per diem from a float, WHT remittances, VAT payments, bank charges) with payee, document and instalment, method, paid-from account, gross / WHT / net. Σ net on 9100 = bank credits of those events in the General Ledger. db/pending/196.';

-- ---------------------------------------------------------------------
-- 7. v_ledger_transactions — copy of 180; changes marked "196"
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ledger_transactions WITH (security_invoker = on) AS
 SELECT i.id,
    'invoice'::text AS source_type,
    i.id AS source_id,
    'actual'::text AS entry_kind,
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
    NULL::text AS status,
    COALESCE(i.rebate_eligible, false) AS qfe_eligible,
    i.organization_id,
    i.project_id,
    i.created_at,
    COALESCE(i.wht_amount, 0::numeric) AS wht_amount,
    i.ref_no AS ref_no,                                                  -- 196
    i.id::text || ':' || 'actual' AS row_key                       -- 196
   FROM public.invoices i
     LEFT JOIN public.organizations org ON org.id = i.organization_id
UNION ALL
 -- 180: payroll = Actual for Approved / Paid instalments only
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
    pc.actual AS amount,
    0::numeric AS vat_amount,
    pc.actual AS total,
    org.base_currency AS currency,
    'Approved'::text AS status,
    false AS qfe_eligible,
    p.organization_id,
    p.project_id,
    p.created_at,
    CASE WHEN COALESCE(p.total_amount, 0) > 0
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
  WHERE COALESCE(p.ref_id, '') NOT LIKE 'invoice:%'
    AND pc.actual <> 0
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
    GREATEST(COALESCE(p.total_amount, 0::numeric) - pc.actual, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    GREATEST(COALESCE(p.total_amount, 0::numeric) - pc.actual, 0::numeric) AS total,
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
  WHERE COALESCE(p.ref_id, '') NOT LIKE 'invoice:%'
    AND p.contract_cancelled_at IS NULL
    AND COALESCE(p.total_amount, 0::numeric) - pc.actual > 0
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
    COALESCE(r.amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(r.amount, 0::numeric) AS total,
    COALESCE(r.currency, org.base_currency) AS currency,
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
    COALESCE(ot.amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(ot.amount, 0::numeric) AS total,
    COALESCE(ot.currency, org.base_currency) AS currency,
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
    COALESCE(d.total_amount, 0::numeric) AS amount,
    0::numeric AS vat_amount,
    COALESCE(d.total_amount, 0::numeric) AS total,
    COALESCE(d.currency, org.base_currency) AS currency,
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
     LEFT JOIN public.invoices ci ON ci.id = cr.invoice_id
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
     LEFT JOIN public.invoices ai ON ai.id = ac.invoice_id
  WHERE COALESCE(ac.total_amount, 0) > 0;
COMMENT ON VIEW public.v_ledger_transactions IS
  'One row per cost document and kind. actual = invoices, approved / paid contract instalments (scaled to the gross contract value), approved petty-cash receipts, overtime, per diem; commitment = the rest of each contract (none once cancelled), purchase orders (net of invoices raised on them, commitment states only), car rentals and accommodation (net of their linked invoice); payment = payments ledger. A payroll row can appear twice (actual + commitment) with the same id: key rows by row_key (id:entry_kind). reference = the Kwalis ref_no when the document has one. Amounts in SAR. Redefined by db/pending/196.';

-- ---------------------------------------------------------------------
-- 8. get_cash_flow — copy of 110; change marked "196"
-- ---------------------------------------------------------------------
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
-- 9. Grants
-- ---------------------------------------------------------------------
GRANT SELECT ON public.v_journal_lines, public.v_payroll_instalments TO authenticated, service_role;
REVOKE ALL ON public.v_journal_lines, public.v_payroll_instalments FROM anon;
GRANT SELECT ON public.v_ledger_transactions TO authenticated, service_role;
REVOKE ALL ON public.v_ledger_transactions FROM anon;
