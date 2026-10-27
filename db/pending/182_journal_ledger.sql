-- =====================================================================
-- 182 — Double-entry general ledger (phase 1 view + phase 2 posted ledger),
--       explicit budget code → GL account map, treasury movements, bank
--       reconciliation, Trial Balance / General Ledger / Daily Cash Position.
--
-- Spec items: A06 A07 A08 A10 A11 A13 R01 R02 R03 R04 N01 N11 (D10 GL/TB part)
-- Decisions followed: 1 (contract = commitment, approved instalment = actual,
-- payment = separate entry), 2 (after approval no edit, un-approval = automatic
-- reversing entry), 3, 4 (phase 1 view, phase 2 tables + engine), 12.
--
-- The client's example workbook with the journal rules
-- (Kwalis_GL_Journal_Example_MON26.xlsx) was not available; the rules below
-- are derived from the glossary, decisions 1-4/12 and the trial balance
-- template (accounts Bank / Project Cost / Advances / Funder / VAT / Vendors).
--
-- JOURNAL RULES (amounts in the record currency, SAR)
-- ┌──────────────────────────────┬───────────────────────────────────────────┬────────────────────────────────────────────┐
-- │ Event                        │ Debit                                     │ Credit                                     │
-- ├──────────────────────────────┼───────────────────────────────────────────┼────────────────────────────────────────────┤
-- │ Contract signed / PO approved│ — no entry (commitment only)              │ —                                          │
-- │ Instalment Approved (or Paid)│ Expense account of its budget code (gross)│ 9200 Accounts Payable (net)                │
-- │                              │                                           │ 9210 WHT Payable (gross − net)             │
-- │ Instalment un-approved       │ automatic reversing entry of the above    │                                            │
-- │ Invoice recorded (= approved │ Expense account (excl. VAT)               │ 9200 Accounts Payable (incl. VAT − WHT)    │
-- │  — invoices have no status)  │ 9220 VAT Recoverable (VAT)                │ 9210 WHT Payable (WHT)                     │
-- │ Overtime approved (not in a  │ Expense account                           │ 9200 Accounts Payable                      │
-- │  payroll run)                │                                           │                                            │
-- │ Per diem paid                │ Expense account                           │ 9120 Petty Cash (from a float) / else 9200 │
-- │ Payment (payments row)       │ 9200 Accounts Payable                     │ 9100 Bank · 9110 Cash (method Cash) ·      │
-- │                              │                                           │ 9120 Petty Cash (invoice paid by petty cash│
-- │ Funding received             │ 9100 Bank                                 │ 9300 Production Funding                    │
-- │ Petty cash float issued      │ 9120 Petty Cash                           │ 9100 Bank (9110 when paid in cash)         │
-- │  (payments recorded against  │                                           │                                            │
-- │  the float; else the approved│                                           │                                            │
-- │  float amount on approval)   │                                           │                                            │
-- │ Petty cash receipt approved  │ Expense account                           │ 9120 Petty Cash                            │
-- │ Petty cash returned to bank  │ 9100 Bank                                 │ 9120 Petty Cash                            │
-- │ WHT remitted to ZATCA        │ 9210 WHT Payable                          │ 9100 Bank                                  │
-- │ VAT recovered from ZATCA     │ 9100 Bank                                 │ 9220 VAT Recoverable                       │
-- │ Bank charge                  │ Expense account of its budget code        │ 9100 Bank                                  │
-- └──────────────────────────────┴───────────────────────────────────────────┴────────────────────────────────────────────┘
-- Every entry balances (Σ debit = Σ credit). A negative document amount
-- (credit note) flips the side. The expense account is the row's own
-- gl_account_id when it is an expense account, else derive_gl_account()
-- (174): organization map → platform map → range default → GL-4400. So no
-- ledger line is ever Uncategorized.
-- Decision 12 (WHT charged to 7099 instead of inside the contract line) is
-- still open: WHT is part of the gross expense of the instalment's own code.
--
-- WHAT THIS FILE ADDS
--   A08  gl_accounts 9210 WHT Payable (balance sheet, outside budget codes;
--        2140 stays as it is). Platform default rows in budget_code_gl_map
--        (organization_id NULL, two-digit prefixes 10-79) written from the
--        174 range defaults, so the map is explicit and editable; an
--        organization row still wins. GL account derived on insert / budget
--        code change for payroll and petty cash receipts (invoices: 174).
--   A06  v_payroll_instalments, v_ledger_system_accounts and v_journal_lines
--        (security_invoker): the journal computed from today's tables, no
--        data change.
--   A07  ledger_projects, ledger_entries, ledger_lines (read-only for
--        members; only the engine writes). Entries are immutable (no UPDATE,
--        no DELETE except when the whole project is deleted); corrections are
--        reversing entries. Unbalanced entries are rejected by a deferred
--        constraint trigger. Engine: ledger_sync_event / ledger_sync_source,
--        AFTER triggers on every source table, active only for projects that
--        were initialised with ledger_backfill_project() — a one-time function
--        the owner runs AFTER A BACKUP (never run by this file).
--        ledger_compare_phases() / ledger_phases_match() prove phase 2 =
--        phase 1. ledger_resync_project() re-applies the rules (e.g. after a
--        GL map change) by reversing + reposting what changed.
--   A10/A11/R04  treasury_movements: WHT remittance, VAT recovery, petty
--        cash return, bank charge.
--   A13  bank_statement_lines + get_bank_reconciliation().
--   R01-R04/N01/N11  get_general_ledger, get_trial_balance,
--        get_daily_cash_position — read phase 2 once a project is
--        initialised, phase 1 before.
--
-- Not changed: v_ledger_transactions, get_cost_by_gl_account (other than
-- that they now see the platform map rows), payments, payment requests.
--
-- KNOWN GAP (approvals/AP batches): a non-instalment payment request marked
-- "paid" on Payment Approvals (invoice / PO / petty cash) writes no payments
-- row (only instalments do, via 160). The ledger follows payments, so such a
-- payment is not in the ledger until a payments row is recorded.
--
-- SECURITY: new tables with RLS, SECURITY DEFINER engine, triggers on
-- financial tables — per SECURITY.md apply only after owner approval.
--
-- Rollback (in this order):
--   DROP TRIGGER trg_ledger_sync ON public.invoices, public.payroll, public.payments,
--     public.project_funding, public.cash_advances, public.cash_advance_receipts,
--     public.overtime_entries, public.per_diem_ledger, public.treasury_movements;   (one per table)
--   DROP TRIGGER trg_derive_gl_account ON public.payroll, public.cash_advance_receipts;
--   DROP FUNCTION public.get_bank_reconciliation(uuid, date), public.get_daily_cash_position(uuid, date, date),
--     public.get_general_ledger(uuid, date, date, uuid), public.get_trial_balance(uuid, date, date),
--     public.ledger_project_lines(uuid), public.ledger_phases_match(uuid), public.ledger_compare_phases(uuid),
--     public.ledger_resync_project(uuid), public.ledger_backfill_project(uuid), public.ledger_on_source_change(),
--     public.ledger_sync_source(uuid[], text), public.ledger_sync_event(uuid, text, uuid, text),
--     public.ledger_check_entry_balanced(), public.ledger_immutable(), public.ledger_derive_gl_account(),
--     public.ledger_expense_account(uuid, text, uuid), public.ledger_to_sar(numeric, text, numeric, uuid),
--     public.stamp_treasury_row();
--   DROP VIEW public.v_journal_lines, public.v_payroll_instalments, public.v_ledger_system_accounts;
--   DROP TABLE public.bank_statement_lines, public.treasury_movements,
--     public.ledger_lines, public.ledger_entries, public.ledger_projects;
--   DELETE FROM public.budget_code_gl_map WHERE organization_id IS NULL AND notes = 'default (182)';
--   DELETE FROM public.gl_accounts WHERE code = '9210';   (only if no line uses it)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Chart of accounts + explicit budget code map (A08)
-- ---------------------------------------------------------------------
INSERT INTO public.gl_accounts (code, name, category, description, account_type) VALUES
  ('9210','WHT Payable','Balance Sheet','Withholding tax deducted from payees, owed to ZATCA until remitted.','wht_payable')
ON CONFLICT (code) DO NOTHING;

-- Platform defaults: one row per two-digit section, from the 174 range rule.
INSERT INTO public.budget_code_gl_map (organization_id, budget_code_prefix, gl_account_id, notes)
SELECT NULL, s.prefix, g.id, 'default (182)'
  FROM (SELECT lpad(n::text, 2, '0') AS prefix FROM generate_series(10, 79) n) s
  JOIN public.gl_accounts g ON g.code = public.default_gl_code_for_budget_code(s.prefix || '00') AND g.is_active
 WHERE NOT EXISTS (SELECT 1 FROM public.budget_code_gl_map m
                    WHERE m.organization_id IS NULL AND m.budget_code_prefix = s.prefix);

-- Expense account of a document: its own account when that is an expense
-- account, else derived from the budget code (never NULL).
CREATE OR REPLACE FUNCTION public.ledger_expense_account(p_org uuid, p_budget_code text, p_own uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT g.id FROM public.gl_accounts g WHERE g.id = p_own AND g.account_type = 'expense'),
    public.derive_gl_account(p_org, p_budget_code))
$$;

-- Amount in SAR: SAR as is; a stored rate other than 1; else the project rate.
CREATE OR REPLACE FUNCTION public.ledger_to_sar(p_amount numeric, p_currency text, p_fx numeric, p_project uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT round(CASE
    WHEN upper(COALESCE(NULLIF(p_currency, ''), 'SAR')) = 'SAR' THEN COALESCE(p_amount, 0)
    WHEN p_fx IS NOT NULL AND p_fx > 0 AND p_fx <> 1 THEN COALESCE(p_amount, 0) * p_fx
    ELSE public.payment_request_amount_sar(COALESCE(p_amount, 0), p_currency, p_project)
  END, 2)
$$;

-- GL account derived from the budget code on contracts and receipts (invoices: 174).
CREATE OR REPLACE FUNCTION public.ledger_derive_gl_account()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.gl_account_id IS NULL AND NULLIF(btrim(COALESCE(NEW.budget_code, '')), '') IS NOT NULL THEN
    NEW.gl_account_id := public.derive_gl_account(NEW.organization_id, NEW.budget_code);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_derive_gl_account ON public.payroll;
CREATE TRIGGER trg_derive_gl_account
  BEFORE INSERT OR UPDATE OF budget_code ON public.payroll
  FOR EACH ROW EXECUTE FUNCTION public.ledger_derive_gl_account();
DROP TRIGGER IF EXISTS trg_derive_gl_account ON public.cash_advance_receipts;
CREATE TRIGGER trg_derive_gl_account
  BEFORE INSERT OR UPDATE OF budget_code ON public.cash_advance_receipts
  FOR EACH ROW EXECUTE FUNCTION public.ledger_derive_gl_account();

-- ---------------------------------------------------------------------
-- 2. Treasury movements (A10 A11 R04) and bank statement lines (A13)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.treasury_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('wht_remittance','vat_recovery','petty_cash_return','bank_charge')),
  movement_date   date NOT NULL,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  cash_advance_id uuid REFERENCES public.cash_advances(id) ON DELETE SET NULL,
  budget_code     text CHECK (budget_code IS NULL OR length(budget_code) <= 64),
  reference       text CHECK (reference IS NULL OR length(reference) <= 200),
  notes           text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT treasury_return_needs_float CHECK (kind <> 'petty_cash_return' OR cash_advance_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_treasury_movements_project ON public.treasury_movements (project_id, movement_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.treasury_movements TO authenticated;
GRANT ALL ON public.treasury_movements TO service_role;
REVOKE ALL ON public.treasury_movements FROM anon;
ALTER TABLE public.treasury_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project members read treasury movements" ON public.treasury_movements;
CREATE POLICY "Project members read treasury movements"
  ON public.treasury_movements FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));
DROP POLICY IF EXISTS "Funding editors insert treasury movements" ON public.treasury_movements;
CREATE POLICY "Funding editors insert treasury movements"
  ON public.treasury_movements FOR INSERT TO authenticated
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'));
DROP POLICY IF EXISTS "Funding editors update treasury movements" ON public.treasury_movements;
CREATE POLICY "Funding editors update treasury movements"
  ON public.treasury_movements FOR UPDATE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'))
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'));
DROP POLICY IF EXISTS "Funding editors delete treasury movements" ON public.treasury_movements;
CREATE POLICY "Funding editors delete treasury movements"
  ON public.treasury_movements FOR DELETE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'));

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  value_date        date NOT NULL,
  reference         text CHECK (reference IS NULL OR length(reference) <= 200),
  narrative         text CHECK (narrative IS NULL OR length(narrative) <= 500),
  amount            numeric(14,2) NOT NULL CHECK (amount <> 0),        -- + money in, − money out
  balance           numeric(14,2),                                     -- running balance printed on the statement
  matched_event_key text CHECK (matched_event_key IS NULL OR length(matched_event_key) <= 200),
  matched_by        uuid,
  matched_at        timestamptz,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_project ON public.bank_statement_lines (project_id, value_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statement_lines TO authenticated;
GRANT ALL ON public.bank_statement_lines TO service_role;
REVOKE ALL ON public.bank_statement_lines FROM anon;
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project members read bank statement lines" ON public.bank_statement_lines;
CREATE POLICY "Project members read bank statement lines"
  ON public.bank_statement_lines FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));
DROP POLICY IF EXISTS "Funding editors insert bank statement lines" ON public.bank_statement_lines;
CREATE POLICY "Funding editors insert bank statement lines"
  ON public.bank_statement_lines FOR INSERT TO authenticated
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'));
DROP POLICY IF EXISTS "Funding editors update bank statement lines" ON public.bank_statement_lines;
CREATE POLICY "Funding editors update bank statement lines"
  ON public.bank_statement_lines FOR UPDATE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'))
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'));
DROP POLICY IF EXISTS "Funding editors delete bank statement lines" ON public.bank_statement_lines;
CREATE POLICY "Funding editors delete bank statement lines"
  ON public.bank_statement_lines FOR DELETE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id) AND public.can_edit('funding'));

-- Organization follows the project; creator / matcher stamped; a petty cash
-- return must point at a float of the same project.
CREATE OR REPLACE FUNCTION public.stamp_treasury_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.projects WHERE id = NEW.project_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION '%: project not found', TG_TABLE_NAME USING ERRCODE = '23503';
  END IF;
  NEW.organization_id := v_org;
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  ELSE
    NEW.created_by := OLD.created_by;
  END IF;
  IF TG_TABLE_NAME = 'treasury_movements' THEN
    IF NEW.cash_advance_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.cash_advances ca WHERE ca.id = NEW.cash_advance_id AND ca.project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'treasury_movements: the petty cash float is not part of this project' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'bank_statement_lines' THEN
    IF TG_OP = 'INSERT' OR NEW.matched_event_key IS DISTINCT FROM OLD.matched_event_key THEN
      NEW.matched_by := CASE WHEN NEW.matched_event_key IS NULL THEN NULL ELSE auth.uid() END;
      NEW.matched_at := CASE WHEN NEW.matched_event_key IS NULL THEN NULL ELSE now() END;
    ELSE
      NEW.matched_by := OLD.matched_by;
      NEW.matched_at := OLD.matched_at;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stamp_treasury_row() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_stamp_treasury_row ON public.treasury_movements;
CREATE TRIGGER trg_stamp_treasury_row BEFORE INSERT OR UPDATE ON public.treasury_movements
  FOR EACH ROW EXECUTE FUNCTION public.stamp_treasury_row();
DROP TRIGGER IF EXISTS trg_stamp_treasury_row ON public.bank_statement_lines;
CREATE TRIGGER trg_stamp_treasury_row BEFORE INSERT OR UPDATE ON public.bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.stamp_treasury_row();
DROP TRIGGER IF EXISTS trg_audit_history_treasury_movements ON public.treasury_movements;
CREATE TRIGGER trg_audit_history_treasury_movements AFTER INSERT OR UPDATE OR DELETE ON public.treasury_movements
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();
DROP TRIGGER IF EXISTS trg_audit_history_bank_statement_lines ON public.bank_statement_lines;
CREATE TRIGGER trg_audit_history_bank_statement_lines AFTER INSERT OR UPDATE OR DELETE ON public.bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- ---------------------------------------------------------------------
-- 3. Phase 1 — the journal as a view (A06)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ledger_system_accounts WITH (security_invoker = on) AS
SELECT (array_agg(id) FILTER (WHERE code = '9100'))[1] AS bank,
       (array_agg(id) FILTER (WHERE code = '9110'))[1] AS cash,
       (array_agg(id) FILTER (WHERE code = '9120'))[1] AS petty,
       (array_agg(id) FILTER (WHERE code = '9200'))[1] AS payable,
       (array_agg(id) FILTER (WHERE code = '9210'))[1] AS wht,
       (array_agg(id) FILTER (WHERE code = '9220'))[1] AS vat,
       (array_agg(id) FILTER (WHERE code = '9300'))[1] AS funding
  FROM public.gl_accounts
 WHERE code IN ('9100','9110','9120','9200','9210','9220','9300');

-- One row per contract instalment, with its net / gross / WHT split and the
-- date it became Actual (approval of its payment request).
CREATE OR REPLACE VIEW public.v_payroll_instalments WITH (security_invoker = on) AS
SELECT p.id AS payroll_id,
       e->>'id' AS milestone_id,
       t.ord::int AS ord,
       COALESCE(NULLIF(e->>'label', ''), 'P' || t.ord) AS label,
       COALESCE(NULLIF(e->>'status', ''), 'Pending') AS status,
       NULLIF(e->>'dueDate', '') AS due_date,
       public.payroll_milestone_amount(e, COALESCE(p.net_payable, p.total_amount)) AS net_amount,
       CASE WHEN p.net_payable IS NOT NULL AND p.net_payable > 0 AND p.total_amount > p.net_payable
            THEN round(public.payroll_milestone_amount(e, p.net_payable) * p.total_amount / p.net_payable, 2)
            ELSE public.payroll_milestone_amount(e, COALESCE(p.net_payable, p.total_amount)) END AS gross_amount,
       COALESCE(
         (SELECT max(COALESCE(q.approved_at, q.updated_at))::date
            FROM public.payment_requests q
           WHERE q.source_type = 'payroll_row' AND q.source_id = p.id
             AND q.payroll_milestone_id = e->>'id' AND q.status IN ('approved', 'paid')),
         CASE WHEN NULLIF(e->>'paidDate', '') ~ '^\d{4}-\d{2}-\d{2}' THEN left(e->>'paidDate', 10)::date END,
         p.created_at::date) AS approved_on,
       p.organization_id,
       p.project_id
  FROM public.payroll p
  CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(p.payment_schedule) = 'array' THEN p.payment_schedule ELSE '[]'::jsonb END)
         WITH ORDINALITY AS t(e, ord)
 WHERE e->>'id' IS NOT NULL;

COMMENT ON VIEW public.v_payroll_instalments IS
  'Contract instalments (payroll.payment_schedule) as rows: net = instalment amount, gross = net grossed up by the contract''s total/net ratio, approved_on = approval of its payment request. db/pending/182.';

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
  -- instalment Approved / Paid: Dr expense (gross) / Cr payable (net) + Cr WHT
  SELECT 'instalment:' || p.id || ':' || mi.milestone_id, 'instalment', 'payroll',
         p.id, NULL::uuid, p.organization_id, p.project_id, mi.approved_on, l.line_no, l.gl, l.amt,
         p.name, p.budget_code, mi.label,
         'Instalment — ' || p.name || ' — ' || COALESCE(NULLIF(pe."position", ''), p.kind) || ' / ' || mi.label,
         NULL::text, mi.status, false
    FROM public.payroll p
    JOIN public.v_payroll_instalments mi ON mi.payroll_id = p.id
    LEFT JOIN public.people pe
           ON p.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND pe.id = p.ref_id::uuid
    CROSS JOIN public.v_ledger_system_accounts s
    CROSS JOIN LATERAL (VALUES
      (1, public.ledger_expense_account(p.organization_id, p.budget_code, p.gl_account_id), mi.gross_amount),
      (2, s.payable, -mi.net_amount),
      (3, s.wht,     -(mi.gross_amount - mi.net_amount))) l(line_no, gl, amt)
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
         pay.id, pay.source_id, pay.organization_id, pay.project_id, pay.payment_date, l.line_no, l.gl, l.amt,
         x.party, x.budget_code, x.reference,
         CASE WHEN x.is_float THEN 'Petty cash issue — ' || COALESCE(x.party, '?')
              ELSE 'Payment — ' || COALESCE(x.doc_type, pay.source_type) || ' — ' || COALESCE(x.party, 'Unknown source')
                   || COALESCE(' — ' || NULLIF(x.detail, ''), '') END,
         x.department, 'Paid', x.qpe
    FROM public.payments pay
    CROSS JOIN public.v_ledger_system_accounts s
    LEFT JOIN public.invoices inv ON pay.source_type = 'invoice' AND inv.id = pay.source_id
    LEFT JOIN public.payroll pr ON pay.source_type = 'payroll' AND pr.id = pay.source_id
    LEFT JOIN public.v_payroll_instalments pmi ON pr.id IS NOT NULL AND pmi.payroll_id = pr.id AND pmi.milestone_id = pay.payroll_milestone_id
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
       COALESCE(inv.invoice_no, pmi.label, po.po_number, NULLIF(pay.notes, '')) AS reference,
       COALESCE(inv.description, pmi.label, po.description, NULLIF(pay.notes, '')) AS detail,
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
  -- funding received: Dr bank / Cr funding
  SELECT 'funding:' || f.id, 'funding', 'project_funding', f.id, NULL::uuid, f.organization_id, f.project_id,
         f.funding_date, l.line_no, l.gl, l.amt, COALESCE(NULLIF(f.source, ''), 'Funding'), NULL::text, f.reference,
         'Funding — ' || COALESCE(NULLIF(f.source, ''), 'Funding') || COALESCE(' — ' || NULLIF(f.reference, ''), ''),
         NULL::text, 'Received', false
    FROM public.project_funding f
    CROSS JOIN public.v_ledger_system_accounts s
    CROSS JOIN LATERAL (VALUES (1, s.bank, round(f.amount, 2)), (2, s.funding, -round(f.amount, 2))) l(line_no, gl, amt)
   WHERE f.status = 'received'
  UNION ALL
  -- treasury movements
  SELECT 'treasury:' || tm.id, tm.kind, 'treasury_movements', tm.id, tm.cash_advance_id, tm.organization_id, tm.project_id,
         tm.movement_date, l.line_no, l.gl, l.amt,
         CASE tm.kind WHEN 'petty_cash_return' THEN ca.holder WHEN 'bank_charge' THEN 'Bank' ELSE 'ZATCA' END,
         tm.budget_code, tm.reference,
         CASE tm.kind WHEN 'wht_remittance' THEN 'WHT remittance — ZATCA'
                      WHEN 'vat_recovery' THEN 'VAT recovery — ZATCA'
                      WHEN 'petty_cash_return' THEN 'Petty cash return — ' || COALESCE(ca.holder, '?')
                      ELSE 'Bank charge' END || COALESCE(' — ' || NULLIF(tm.notes, ''), ''),
         NULL::text, 'Posted', false
    FROM public.treasury_movements tm
    LEFT JOIN public.cash_advances ca ON ca.id = tm.cash_advance_id
    CROSS JOIN public.v_ledger_system_accounts s
    CROSS JOIN LATERAL (VALUES
      (1, CASE tm.kind WHEN 'wht_remittance' THEN s.wht
                       WHEN 'bank_charge' THEN public.ledger_expense_account(tm.organization_id, tm.budget_code, NULL)
                       ELSE s.bank END, round(tm.amount, 2)),
      (2, CASE tm.kind WHEN 'vat_recovery' THEN s.vat
                       WHEN 'petty_cash_return' THEN s.petty
                       ELSE s.bank END, -round(tm.amount, 2))) l(line_no, gl, amt)
) j
WHERE j.amt <> 0 AND j.project_id IS NOT NULL;

COMMENT ON VIEW public.v_journal_lines IS
  'Phase 1 general ledger (decision 4): two or more debit/credit lines per financial event, computed from the current tables. Rules in db/pending/182. Σ debit = Σ credit per event_key.';

-- ---------------------------------------------------------------------
-- 4. Phase 2 — posted ledger (A07)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ledger_projects (
  project_id      uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  backfilled_at   timestamptz NOT NULL DEFAULT now(),
  backfilled_by   uuid,
  entries_created integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entry_no          integer NOT NULL,
  event_key         text NOT NULL,
  event_type        text NOT NULL,
  source_table      text,
  source_id         uuid,
  parent_id         uuid,
  entry_date        date NOT NULL,
  description       text,
  origin            text NOT NULL DEFAULT 'engine' CHECK (origin IN ('engine', 'backfill', 'resync')),
  reverses_entry_id uuid REFERENCES public.ledger_entries(id),
  posted_at         timestamptz NOT NULL DEFAULT now(),
  posted_by         uuid,
  UNIQUE (project_id, entry_no)
);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_event ON public.ledger_entries (project_id, event_key);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_source ON public.ledger_entries (source_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_parent ON public.ledger_entries (parent_id) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_one_reversal ON public.ledger_entries (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ledger_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id        uuid NOT NULL REFERENCES public.ledger_entries(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  line_no         integer NOT NULL,
  gl_account_id   uuid NOT NULL REFERENCES public.gl_accounts(id),
  debit           numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit          numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  party           text,
  budget_code     text,
  reference       text,
  description     text,
  department      text,
  status          text,
  qpe_eligible    boolean NOT NULL DEFAULT false,
  CONSTRAINT ledger_lines_one_side CHECK ((debit = 0) <> (credit = 0)),
  UNIQUE (entry_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_ledger_lines_project_account ON public.ledger_lines (project_id, gl_account_id);

-- members read; nobody writes through the Data API (the engine is SECURITY DEFINER)
GRANT SELECT ON public.ledger_projects, public.ledger_entries, public.ledger_lines TO authenticated;
GRANT ALL ON public.ledger_projects, public.ledger_entries, public.ledger_lines TO service_role;
REVOKE ALL ON public.ledger_projects, public.ledger_entries, public.ledger_lines FROM anon;
ALTER TABLE public.ledger_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_lines    ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Project members read ledger state" ON public.ledger_projects;
CREATE POLICY "Project members read ledger state" ON public.ledger_projects FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));
DROP POLICY IF EXISTS "Project members read ledger entries" ON public.ledger_entries;
CREATE POLICY "Project members read ledger entries" ON public.ledger_entries FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));
DROP POLICY IF EXISTS "Project members read ledger lines" ON public.ledger_lines;
CREATE POLICY "Project members read ledger lines" ON public.ledger_lines FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));

-- Immutable: corrections are reversing entries. Rows go only with their project.
CREATE OR REPLACE FUNCTION public.ledger_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = OLD.project_id) THEN
    RETURN OLD;                                   -- project deleted: cascade
  END IF;
  RAISE EXCEPTION 'The ledger is immutable: % on % is refused — post a reversing entry instead', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_ledger_entries_immutable ON public.ledger_entries;
CREATE TRIGGER trg_ledger_entries_immutable BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.ledger_immutable();
DROP TRIGGER IF EXISTS trg_ledger_lines_immutable ON public.ledger_lines;
CREATE TRIGGER trg_ledger_lines_immutable BEFORE UPDATE OR DELETE ON public.ledger_lines
  FOR EACH ROW EXECUTE FUNCTION public.ledger_immutable();

-- Balanced entries only: checked at commit, once all lines are in.
CREATE OR REPLACE FUNCTION public.ledger_check_entry_balanced()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_entry uuid := (to_jsonb(NEW)->>(CASE WHEN TG_TABLE_NAME = 'ledger_entries' THEN 'id' ELSE 'entry_id' END))::uuid;
  v_dr numeric; v_cr numeric; v_n int; v_bad int;
BEGIN
  SELECT COALESCE(sum(l.debit), 0), COALESCE(sum(l.credit), 0), count(*),
         count(*) FILTER (WHERE l.project_id IS DISTINCT FROM e.project_id OR l.organization_id IS DISTINCT FROM e.organization_id)
    INTO v_dr, v_cr, v_n, v_bad
    FROM public.ledger_entries e LEFT JOIN public.ledger_lines l ON l.entry_id = e.id
   WHERE e.id = v_entry;
  IF v_n < 2 OR v_dr <> v_cr OR v_dr = 0 THEN
    RAISE EXCEPTION 'Unbalanced ledger entry %: % lines, debit %, credit %', v_entry, v_n, v_dr, v_cr
      USING ERRCODE = '23514';
  END IF;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Ledger entry %: lines belong to another project', v_entry USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_ledger_entry_balanced ON public.ledger_entries;
CREATE CONSTRAINT TRIGGER trg_ledger_entry_balanced AFTER INSERT ON public.ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ledger_check_entry_balanced();
DROP TRIGGER IF EXISTS trg_ledger_line_balanced ON public.ledger_lines;
CREATE CONSTRAINT TRIGGER trg_ledger_line_balanced AFTER INSERT ON public.ledger_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ledger_check_entry_balanced();

-- The engine: bring one event's posted entry in line with the rules.
--   nothing posted, rule gives lines           → post the entry
--   posted entry differs (date / accounts / amounts) → reverse it, post the new one
--   posted, rule gives nothing (un-approved, deleted) → reverse it
CREATE OR REPLACE FUNCTION public.ledger_sync_event(p_project uuid, p_event_key text, p_source_id uuid, p_origin text DEFAULT 'engine')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_active public.ledger_entries%ROWTYPE;
  v_exp    jsonb;
  v_date   date;
  v_same   boolean;
  v_no     int;
  v_id     uuid;
  v_n      int := 0;
  v_hdr    jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ledger:' || p_project::text));

  SELECT jsonb_agg(to_jsonb(v) ORDER BY v.line_no) INTO v_exp
    FROM public.v_journal_lines v
   WHERE v.source_id = p_source_id AND v.event_key = p_event_key AND v.project_id = p_project;
  v_hdr := v_exp->0;
  v_date := (v_hdr->>'entry_date')::date;

  SELECT e.* INTO v_active FROM public.ledger_entries e
   WHERE e.project_id = p_project AND e.event_key = p_event_key AND e.reverses_entry_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_entry_id = e.id)
   ORDER BY e.entry_no DESC LIMIT 1;

  IF v_active.id IS NULL THEN
    v_same := v_exp IS NULL;
  ELSIF v_exp IS NULL THEN
    v_same := false;
  ELSE
    v_same := v_active.entry_date = v_date AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT x.gl_account_id, sum(x.debit - x.credit) AS net
          FROM jsonb_to_recordset(v_exp) AS x(gl_account_id uuid, debit numeric, credit numeric)
         GROUP BY x.gl_account_id) a
      FULL JOIN (
        SELECT l.gl_account_id, sum(l.debit - l.credit) AS net
          FROM public.ledger_lines l WHERE l.entry_id = v_active.id GROUP BY l.gl_account_id) b
        ON a.gl_account_id = b.gl_account_id
       WHERE COALESCE(a.net, 0) <> COALESCE(b.net, 0));
  END IF;
  IF v_same THEN RETURN 0; END IF;

  IF v_active.id IS NOT NULL THEN
    SELECT COALESCE(max(entry_no), 0) + 1 INTO v_no FROM public.ledger_entries WHERE project_id = p_project;
    INSERT INTO public.ledger_entries (organization_id, project_id, entry_no, event_key, event_type, source_table,
                                       source_id, parent_id, entry_date, description, origin, reverses_entry_id, posted_by)
    VALUES (v_active.organization_id, p_project, v_no, p_event_key, v_active.event_type, v_active.source_table,
            v_active.source_id, v_active.parent_id, GREATEST(v_active.entry_date, CURRENT_DATE),
            'Reversal of #' || v_active.entry_no || ' — ' || COALESCE(v_active.description, ''), p_origin, v_active.id, auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO public.ledger_lines (entry_id, organization_id, project_id, line_no, gl_account_id, debit, credit,
                                     party, budget_code, reference, description, department, status, qpe_eligible)
    SELECT v_id, l.organization_id, l.project_id, l.line_no, l.gl_account_id, l.credit, l.debit,
           l.party, l.budget_code, l.reference, 'Reversal — ' || COALESCE(l.description, ''), l.department, 'Reversed', l.qpe_eligible
      FROM public.ledger_lines l WHERE l.entry_id = v_active.id;
    v_n := v_n + 1;
  END IF;

  IF v_exp IS NOT NULL THEN
    SELECT COALESCE(max(entry_no), 0) + 1 INTO v_no FROM public.ledger_entries WHERE project_id = p_project;
    INSERT INTO public.ledger_entries (organization_id, project_id, entry_no, event_key, event_type, source_table,
                                       source_id, parent_id, entry_date, description, origin, posted_by)
    VALUES ((v_hdr->>'organization_id')::uuid, p_project, v_no, p_event_key, v_hdr->>'event_type', v_hdr->>'source_table',
            p_source_id, NULLIF(v_hdr->>'parent_id', '')::uuid, v_date, v_hdr->>'description', p_origin, auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO public.ledger_lines (entry_id, organization_id, project_id, line_no, gl_account_id, debit, credit,
                                     party, budget_code, reference, description, department, status, qpe_eligible)
    SELECT v_id, x.organization_id, x.project_id, x.line_no, x.gl_account_id, x.debit, x.credit,
           x.party, x.budget_code, x.reference, x.description, x.department, x.status, x.qpe_eligible
      FROM jsonb_to_recordset(v_exp) AS x(organization_id uuid, project_id uuid, line_no int, gl_account_id uuid,
             debit numeric, credit numeric, party text, budget_code text, reference text, description text,
             department text, status text, qpe_eligible boolean);
    v_n := v_n + 1;
  END IF;
  RETURN v_n;
END $$;

-- Every event of the given documents (as document, as parent, or already posted).
CREATE OR REPLACE FUNCTION public.ledger_sync_source(p_ids uuid[], p_origin text DEFAULT 'engine')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k record; v_n int := 0;
BEGIN
  FOR k IN
    SELECT DISTINCT u.project_id, u.event_key, u.source_id
      FROM (SELECT v.project_id, v.event_key, v.source_id FROM public.v_journal_lines v
             WHERE v.source_id = ANY (p_ids) OR v.parent_id = ANY (p_ids)
            UNION
            SELECT e.project_id, e.event_key, e.source_id FROM public.ledger_entries e
             WHERE e.source_id = ANY (p_ids) OR e.parent_id = ANY (p_ids)) u
      JOIN public.ledger_projects lp ON lp.project_id = u.project_id
      JOIN public.projects pr ON pr.id = u.project_id
  LOOP
    v_n := v_n + public.ledger_sync_event(k.project_id, k.event_key, k.source_id, p_origin);
  END LOOP;
  RETURN v_n;
END $$;

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
  v_ids := ARRAY[(COALESCE(n, o)->>'id')::uuid];
  IF TG_TABLE_NAME = 'payments' THEN              -- a payment against a float replaces its approval entry
    v_ids := v_ids || ARRAY[(n->>'source_id')::uuid, (o->>'source_id')::uuid];
  END IF;
  PERFORM public.ledger_sync_source(array_remove(v_ids, NULL));
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices','payroll','payments','project_funding','cash_advances',
                           'cash_advance_receipts','overtime_entries','per_diem_ledger','treasury_movements'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_ledger_sync ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_ledger_sync AFTER INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.ledger_on_source_change()', t);
  END LOOP;
END $$;

-- Who may initialise / resync a project's ledger: SQL editor (no user), super admin, org admin.
CREATE OR REPLACE FUNCTION public.ledger_assert_admin(p_project uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.projects WHERE id = p_project;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ledger: project not found' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid())
     AND NOT public.is_org_admin(auth.uid(), v_org) THEN
    RAISE EXCEPTION 'ledger: only an organization admin can do this' USING ERRCODE = '42501';
  END IF;
  RETURN v_org;
END $$;

-- ONE-TIME backfill (A07). Not run by this file: the owner runs it per
-- project AFTER A BACKUP:  SELECT public.ledger_backfill_project('<project id>');
-- then checks:             SELECT public.ledger_phases_match('<project id>');
CREATE OR REPLACE FUNCTION public.ledger_backfill_project(p_project uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; k record; v_n int := 0;
BEGIN
  v_org := public.ledger_assert_admin(p_project);
  IF EXISTS (SELECT 1 FROM public.ledger_projects WHERE project_id = p_project) THEN
    RAISE EXCEPTION 'ledger: this project''s ledger was already generated — use ledger_resync_project()' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ledger_projects (project_id, organization_id, backfilled_by) VALUES (p_project, v_org, auth.uid());
  FOR k IN
    SELECT v.event_key, v.source_id, min(v.entry_date) AS d
      FROM public.v_journal_lines v WHERE v.project_id = p_project
     GROUP BY v.event_key, v.source_id ORDER BY d, v.event_key
  LOOP
    v_n := v_n + public.ledger_sync_event(p_project, k.event_key, k.source_id, 'backfill');
  END LOOP;
  UPDATE public.ledger_projects SET entries_created = v_n WHERE project_id = p_project;
  RETURN v_n;
END $$;

-- Re-apply the rules to every event of an initialised project (after a GL map change).
CREATE OR REPLACE FUNCTION public.ledger_resync_project(p_project uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k record; v_n int := 0;
BEGIN
  PERFORM public.ledger_assert_admin(p_project);
  IF NOT EXISTS (SELECT 1 FROM public.ledger_projects WHERE project_id = p_project) THEN
    RAISE EXCEPTION 'ledger: run ledger_backfill_project() first' USING ERRCODE = '22023';
  END IF;
  FOR k IN
    SELECT DISTINCT u.event_key, u.source_id FROM (
      SELECT v.event_key, v.source_id FROM public.v_journal_lines v WHERE v.project_id = p_project
      UNION SELECT e.event_key, e.source_id FROM public.ledger_entries e WHERE e.project_id = p_project) u
  LOOP
    v_n := v_n + public.ledger_sync_event(p_project, k.event_key, k.source_id, 'resync');
  END LOOP;
  RETURN v_n;
END $$;

-- Phase 2 = phase 1: net per account and per event, all dates.
CREATE OR REPLACE FUNCTION public.ledger_compare_phases(p_project uuid)
RETURNS TABLE (gl_account_id uuid, gl_code text, gl_name text, phase1_net numeric, phase2_net numeric, difference numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ledger_assert_admin(p_project);
  RETURN QUERY
  SELECT COALESCE(a.gl, b.gl), g.code, g.name, COALESCE(a.net, 0), COALESCE(b.net, 0), COALESCE(b.net, 0) - COALESCE(a.net, 0)
    FROM (SELECT v.gl_account_id AS gl, sum(v.debit - v.credit) AS net FROM public.v_journal_lines v
           WHERE v.project_id = p_project GROUP BY 1) a
    FULL JOIN (SELECT l.gl_account_id AS gl, sum(l.debit - l.credit) AS net FROM public.ledger_lines l
                WHERE l.project_id = p_project GROUP BY 1) b ON a.gl = b.gl
    LEFT JOIN public.gl_accounts g ON g.id = COALESCE(a.gl, b.gl)
   ORDER BY g.code;
END $$;

CREATE OR REPLACE FUNCTION public.ledger_phases_match(p_project uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ledger_assert_admin(p_project);
  RETURN NOT EXISTS (SELECT 1 FROM public.ledger_compare_phases(p_project) c WHERE c.difference <> 0)
     AND NOT EXISTS (                                   -- and event by event
       SELECT 1 FROM
         (SELECT v.event_key, v.gl_account_id, sum(v.debit - v.credit) AS net FROM public.v_journal_lines v
           WHERE v.project_id = p_project GROUP BY 1, 2) a
         FULL JOIN
         (SELECT e.event_key, l.gl_account_id, sum(l.debit - l.credit) AS net
            FROM public.ledger_lines l JOIN public.ledger_entries e ON e.id = l.entry_id
           WHERE l.project_id = p_project GROUP BY 1, 2) b
         ON a.event_key = b.event_key AND a.gl_account_id = b.gl_account_id
        WHERE COALESCE(a.net, 0) <> COALESCE(b.net, 0));
END $$;

-- ---------------------------------------------------------------------
-- 5. Reports (R01-R04, N01, N11, A13) — phase 2 when initialised, else phase 1
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_project_lines(p_project uuid)
RETURNS TABLE (entry_ref text, entry_seq bigint, event_key text, event_type text, entry_date date, line_no integer,
               gl_account_id uuid, debit numeric, credit numeric, party text, budget_code text, reference text,
               description text, department text, status text, qpe_eligible boolean, is_reversal boolean, phase integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT 'JE-' || lpad(e.entry_no::text, 5, '0'), e.entry_no::bigint, e.event_key, e.event_type, e.entry_date, l.line_no,
         l.gl_account_id, l.debit, l.credit, l.party, l.budget_code, l.reference, l.description, l.department,
         l.status, l.qpe_eligible, e.reverses_entry_id IS NOT NULL, 2
    FROM public.ledger_lines l JOIN public.ledger_entries e ON e.id = l.entry_id
   WHERE l.project_id = p_project
     AND EXISTS (SELECT 1 FROM public.ledger_projects lp WHERE lp.project_id = p_project)
  UNION ALL
  SELECT NULL, dense_rank() OVER (ORDER BY v.entry_date, v.event_key), v.event_key, v.event_type, v.entry_date, v.line_no,
         v.gl_account_id, v.debit, v.credit, v.party, v.budget_code, v.reference, v.description, v.department,
         v.status, v.qpe_eligible, false, 1
    FROM public.v_journal_lines v
   WHERE v.project_id = p_project
     AND NOT EXISTS (SELECT 1 FROM public.ledger_projects lp WHERE lp.project_id = p_project)
$$;

CREATE OR REPLACE FUNCTION public.ledger_assert_member(p_project uuid, p_fn text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  IF p_project IS NULL THEN
    RAISE EXCEPTION '%: p_project_id is required', p_fn USING ERRCODE = '22004';
  END IF;
  SELECT organization_id INTO v_org FROM public.projects WHERE id = p_project;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_access_project(auth.uid(), v_org, p_project) THEN
    RAISE EXCEPTION '%: access denied', p_fn USING ERRCODE = '42501';
  END IF;
END $$;

-- N01 Trial Balance: per account opening (before p_from), period debit/credit, closing (to p_to).
-- Balances are signed: positive = debit balance, negative = credit balance.
CREATE OR REPLACE FUNCTION public.get_trial_balance(p_project_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (gl_account_id uuid, gl_code text, gl_name text, account_type text, category text,
               opening numeric, period_debit numeric, period_credit numeric, closing numeric, phase integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM public.ledger_assert_member(p_project_id, 'get_trial_balance');
  RETURN QUERY
  WITH l AS (SELECT * FROM public.ledger_project_lines(p_project_id) x WHERE p_to IS NULL OR x.entry_date <= p_to),
  a AS (
    SELECT l.gl_account_id AS gl,
           sum(CASE WHEN p_from IS NOT NULL AND l.entry_date < p_from THEN l.debit - l.credit ELSE 0 END) AS op,
           sum(CASE WHEN p_from IS NULL OR l.entry_date >= p_from THEN l.debit ELSE 0 END) AS dr,
           sum(CASE WHEN p_from IS NULL OR l.entry_date >= p_from THEN l.credit ELSE 0 END) AS cr,
           max(l.phase) AS ph
      FROM l GROUP BY l.gl_account_id)
  SELECT a.gl, g.code, g.name, g.account_type, g.category,
         round(a.op, 2), round(a.dr, 2), round(a.cr, 2), round(a.op + a.dr - a.cr, 2), a.ph::int
    FROM a LEFT JOIN public.gl_accounts g ON g.id = a.gl
   ORDER BY (g.account_type = 'expense') DESC, g.code;
END $$;

-- R01-R04 General Ledger: lines with running balance per account (opening included).
CREATE OR REPLACE FUNCTION public.get_general_ledger(p_project_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL,
                                                     p_account uuid DEFAULT NULL)
RETURNS TABLE (entry_ref text, entry_seq bigint, event_key text, event_type text, entry_date date, line_no integer,
               gl_account_id uuid, gl_code text, gl_name text, debit numeric, credit numeric, running_balance numeric,
               party text, budget_code text, reference text, description text, department text, status text,
               qpe_eligible boolean, is_reversal boolean, phase integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM public.ledger_assert_member(p_project_id, 'get_general_ledger');
  RETURN QUERY
  WITH l AS (SELECT * FROM public.ledger_project_lines(p_project_id) x
              WHERE (p_account IS NULL OR x.gl_account_id = p_account) AND (p_to IS NULL OR x.entry_date <= p_to)),
  op AS (SELECT l.gl_account_id AS gl, sum(l.debit - l.credit) AS bal FROM l
          WHERE p_from IS NOT NULL AND l.entry_date < p_from GROUP BY 1),
  cur AS (SELECT l.*, round(COALESCE(op.bal, 0) + sum(l.debit - l.credit) OVER (
                   PARTITION BY l.gl_account_id ORDER BY l.entry_date, l.entry_seq, l.line_no
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2) AS rb
            FROM l LEFT JOIN op ON op.gl = l.gl_account_id
           WHERE p_from IS NULL OR l.entry_date >= p_from)
  SELECT c.entry_ref, c.entry_seq, c.event_key, c.event_type, c.entry_date, c.line_no, c.gl_account_id, g.code, g.name,
         c.debit, c.credit, c.rb, c.party, c.budget_code, c.reference, c.description, c.department, c.status,
         c.qpe_eligible, c.is_reversal, c.phase
    FROM cur c LEFT JOIN public.gl_accounts g ON g.id = c.gl_account_id
   ORDER BY g.code, c.entry_date, c.entry_seq, c.line_no;
END $$;

-- N11 / D10 Daily Cash Position: bank, cash and petty cash per day with movement.
CREATE OR REPLACE FUNCTION public.get_daily_cash_position(p_project_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (day date, account_type text, gl_code text, gl_name text, opening numeric, cash_in numeric,
               cash_out numeric, closing numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM public.ledger_assert_member(p_project_id, 'get_daily_cash_position');
  RETURN QUERY
  WITH l AS (SELECT x.entry_date, x.debit, x.credit, g.account_type AS t, g.code, g.name
               FROM public.ledger_project_lines(p_project_id) x
               JOIN public.gl_accounts g ON g.id = x.gl_account_id
              WHERE g.account_type IN ('bank', 'cash', 'petty_cash') AND (p_to IS NULL OR x.entry_date <= p_to)),
  d AS (SELECT l.entry_date AS dy, l.t, l.code, l.name, sum(l.debit) AS i, sum(l.credit) AS o
          FROM l GROUP BY 1, 2, 3, 4),
  r AS (SELECT d.*, sum(d.i - d.o) OVER (PARTITION BY d.code ORDER BY d.dy) AS cl FROM d)
  SELECT r.dy, r.t, r.code, r.name, round(r.cl - r.i + r.o, 2), round(r.i, 2), round(r.o, 2), round(r.cl, 2)
    FROM r WHERE p_from IS NULL OR r.dy >= p_from
   ORDER BY r.dy, r.code;
END $$;

-- A13 Bank reconciliation: statement balance vs book balance (account 9100),
-- the difference and the unmatched items that explain it.
CREATE OR REPLACE FUNCTION public.get_bank_reconciliation(p_project_id uuid, p_as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_as_of date := COALESCE(p_as_of, CURRENT_DATE);
  v_bank uuid;
  v_book numeric; v_stmt numeric; v_stmt_sum numeric; v_last_bal numeric;
  v_ub jsonb; v_us jsonb; v_ub_sum numeric; v_us_sum numeric; v_bk jsonb;
BEGIN
  PERFORM public.ledger_assert_member(p_project_id, 'get_bank_reconciliation');
  SELECT bank INTO v_bank FROM public.v_ledger_system_accounts;

  SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v_bk FROM (
    SELECT x.event_key, min(x.entry_date) AS entry_date, (array_agg(x.description ORDER BY x.entry_seq DESC))[1] AS description,
           (array_agg(x.party ORDER BY x.entry_seq DESC))[1] AS party,
           (array_agg(x.reference ORDER BY x.entry_seq DESC))[1] AS reference,
           sum(x.debit - x.credit) AS net
      FROM public.ledger_project_lines(p_project_id) x
     WHERE x.gl_account_id = v_bank AND x.entry_date <= v_as_of
     GROUP BY x.event_key) q;

  SELECT COALESCE(sum((e->>'net')::numeric), 0) INTO v_book FROM jsonb_array_elements(v_bk) e;
  SELECT COALESCE(sum(s.amount), 0) INTO v_stmt_sum FROM public.bank_statement_lines s
   WHERE s.project_id = p_project_id AND s.value_date <= v_as_of;
  SELECT s.balance INTO v_last_bal FROM public.bank_statement_lines s
   WHERE s.project_id = p_project_id AND s.value_date <= v_as_of
   ORDER BY s.value_date DESC, s.created_at DESC LIMIT 1;
  v_stmt := COALESCE(v_last_bal, v_stmt_sum);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('event_key', b.event_key, 'entry_date', b.entry_date,
           'description', b.description, 'party', b.party, 'reference', b.reference, 'amount', round(b.net, 2))
           ORDER BY b.entry_date, b.event_key), '[]'::jsonb), COALESCE(sum(b.net), 0)
    INTO v_ub, v_ub_sum
    FROM jsonb_to_recordset(v_bk) AS b(event_key text, entry_date date, description text, party text, reference text, net numeric)
   WHERE b.net <> 0
     AND NOT EXISTS (SELECT 1 FROM public.bank_statement_lines s
                      WHERE s.project_id = p_project_id AND s.matched_event_key = b.event_key AND s.value_date <= v_as_of);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'value_date', s.value_date, 'reference', s.reference,
           'narrative', s.narrative, 'amount', s.amount, 'balance', s.balance) ORDER BY s.value_date, s.created_at), '[]'::jsonb),
         COALESCE(sum(s.amount), 0)
    INTO v_us, v_us_sum
    FROM public.bank_statement_lines s
   WHERE s.project_id = p_project_id AND s.value_date <= v_as_of
     AND (s.matched_event_key IS NULL
          OR NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_bk) AS b(event_key text, entry_date date, description text, party text, reference text, net numeric) WHERE b.event_key = s.matched_event_key));

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'book_balance', round(v_book, 2),
    'statement_balance', round(v_stmt, 2),
    'statement_from_balance_column', v_last_bal IS NOT NULL,
    'difference', round(v_stmt - v_book, 2),
    'unmatched_book', v_ub,
    'unmatched_book_total', round(v_ub_sum, 2),
    'unmatched_statement', v_us,
    'unmatched_statement_total', round(v_us_sum, 2),
    -- 0 when the difference is fully explained by the unmatched items
    'unexplained', round((v_stmt - v_book) - (v_us_sum - v_ub_sum) - (v_stmt - v_stmt_sum), 2));
END $$;

-- ---------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ledger_sync_event(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_sync_source(uuid[], text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_on_source_change()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_immutable()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_check_entry_balanced()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_assert_admin(uuid)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_backfill_project(uuid)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_resync_project(uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_compare_phases(uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_phases_match(uuid)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_project_lines(uuid)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_assert_member(uuid, text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_trial_balance(uuid, date, date)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_general_ledger(uuid, date, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_daily_cash_position(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_bank_reconciliation(uuid, date)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_expense_account(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_to_sar(numeric, text, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_assert_admin(uuid), public.ledger_backfill_project(uuid),
  public.ledger_resync_project(uuid), public.ledger_compare_phases(uuid), public.ledger_phases_match(uuid),
  public.ledger_project_lines(uuid), public.ledger_assert_member(uuid, text),
  public.get_trial_balance(uuid, date, date), public.get_general_ledger(uuid, date, date, uuid),
  public.get_daily_cash_position(uuid, date, date), public.get_bank_reconciliation(uuid, date),
  public.ledger_expense_account(uuid, text, uuid), public.ledger_to_sar(numeric, text, numeric, uuid)
  TO authenticated, service_role;
GRANT SELECT ON public.v_journal_lines, public.v_payroll_instalments, public.v_ledger_system_accounts TO authenticated, service_role;
REVOKE ALL ON public.v_journal_lines, public.v_payroll_instalments, public.v_ledger_system_accounts FROM anon;
