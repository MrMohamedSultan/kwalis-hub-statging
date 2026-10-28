-- 182 — double-entry ledger: phase 1 view, phase 2 engine, reports.
\set A  '00000000-0000-0000-0000-00000000000a'
\set B  '00000000-0000-0000-0000-00000000000b'
\set C  '00000000-0000-0000-0000-00000000000c'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P1 '20000000-0000-0000-0000-000000000001'
\set P3 '20000000-0000-0000-0000-000000000182'
\set PC '50000000-0000-0000-0000-000000000182'
\set R1 '80000000-0000-0000-0000-000000000182'
\set R2 '80000000-0000-0000-0000-000000000183'
\set I1 '60000000-0000-0000-0000-000000000182'
\set F1 '91000000-0000-0000-0000-000000000182'
SELECT id AS bank FROM gl_accounts WHERE code='9100' \gset
SELECT id AS petty FROM gl_accounts WHERE code='9120' \gset
SELECT id AS ap FROM gl_accounts WHERE code='9200' \gset
SELECT id AS wht FROM gl_accounts WHERE code='9210' \gset
SELECT id AS vat FROM gl_accounts WHERE code='9220' \gset
SELECT id AS fund FROM gl_accounts WHERE code='9300' \gset

-- every event already in the shared seed balances
SELECT t.eq('seed: every event balances', (SELECT count(*) FROM (SELECT event_key FROM v_journal_lines
  GROUP BY event_key HAVING sum(debit) <> sum(credit)) x), 0::bigint);
SELECT t.eq('seed: no line without an account', (SELECT count(*) FROM v_journal_lines WHERE gl_account_id IS NULL), 0::bigint);
SELECT t.eq('A08: no ledger line on a non-expense account for a cost', (SELECT count(*) FROM v_journal_lines v
  JOIN gl_accounts g ON g.id = v.gl_account_id WHERE v.line_no = 1 AND v.event_type IN ('invoice','instalment','petty_receipt')
  AND g.account_type <> 'expense'), 0::bigint);
SELECT t.eq('A08: any code gets an expense account', (SELECT g.account_type FROM gl_accounts g WHERE g.id = ledger_expense_account('10000000-0000-0000-0000-000000000001', 'ZZ99', NULL)), 'expense');

-- ---------------- scenario on a fresh project ----------------
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status) VALUES
 (:'P3', :'A', 'Journal test', 'JRN1', :'O1', 'USD', 3.75, 'Production');
INSERT INTO project_members(project_id,user_id) VALUES (:'P3', :'A') ON CONFLICT DO NOTHING;
INSERT INTO project_funding(organization_id,project_id,funding_date,amount,status,source,reference) VALUES
 (:'O1', :'P3', '2026-09-01', 100000, 'received', 'Financier', 'TRF-1'),
 (:'O1', :'P3', '2026-12-01', 50000, 'expected', 'Financier', 'TRF-2');
INSERT INTO invoices(id,description,budget_code,price,vat_amount,wht_amount,date,vendor_name,invoice_no,organization_id,project_id)
VALUES (:'I1','Lighting kit','1403',10000,1500,500,'2026-09-05','Gaffer Co','INV-77',:'O1',:'P3');
UPDATE invoices SET approval_status = 'approved' WHERE approval_status = 'pending' AND created_by IS NULL;  -- 201: fixture invoices approved (a recorded invoice is only a Commitment)
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,method)
VALUES (:'O1',:'P3','invoice',:'I1',11000,'2026-09-10','Transfer');
-- contract: gross 20,000, net 19,000; two 50% instalments (on the net)
INSERT INTO payroll(id,name,kind,total_amount,net_payable,wht_amount,budget_code,organization_id,project_id,payment_schedule)
VALUES (:'PC','Director X','crew',20000,19000,1000,'1101',:'O1',:'P3',
 '[{"id":"m1","label":"On Signing","percent":50,"status":"Pending"},{"id":"m2","label":"On Wrap","percent":50,"status":"Pending"}]');
SELECT t.eq('A01: a signed contract is no entry', (SELECT count(*) FROM v_journal_lines WHERE source_id = :'PC'), 0::bigint);
SELECT t.eq('A08: contract GL derived from its code', (SELECT gl_account_id IS NOT NULL FROM payroll WHERE id = :'PC'), true);
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,payroll_milestone_id,source_label,total_amount,requested_amount,currency,status,approved_at)
VALUES (:'R1',:'O1',:'P3','payroll_row',:'PC','m1','Director X',19000,9500,'SAR','approved','2026-09-15');
SELECT t.eq('instalment approved: Dr expense gross', (SELECT debit FROM v_journal_lines WHERE event_key = 'instalment:' || :'PC' || ':m1' AND line_no = 1), 10000.00);
SELECT t.eq('instalment approved: Cr payable net', (SELECT credit FROM v_journal_lines WHERE event_key = 'instalment:' || :'PC' || ':m1' AND gl_account_id = :'ap'), 9500.00);
SELECT t.eq('instalment approved: Cr WHT', (SELECT credit FROM v_journal_lines WHERE event_key = 'instalment:' || :'PC' || ':m1' AND gl_account_id = :'wht'), 500.00);
SELECT t.eq('instalment dated on approval', (SELECT DISTINCT entry_date::text FROM v_journal_lines WHERE event_key = 'instalment:' || :'PC' || ':m1'), '2026-09-15');
SELECT t.eq('R02: instalment description', (SELECT description FROM v_journal_lines WHERE event_key = 'instalment:' || :'PC' || ':m1' AND line_no = 1), 'Instalment — Director X — crew / On Signing');
UPDATE payment_requests SET status = 'paid', payment_date = '2026-09-20', payment_method = 'Transfer' WHERE id = :'R1';
SELECT t.eq('paid instalment: one payment row (160)', (SELECT count(*) FROM payments WHERE source_id = :'PC'), 1::bigint);
SELECT t.eq('R02: payment inherits party + code + instalment', (SELECT party || '|' || budget_code || '|' || reference FROM v_journal_lines
  WHERE event_type = 'payment' AND parent_id = :'PC' AND line_no = 1), 'Director X|1101|On Signing');
-- petty cash: float 3,000, receipt 1,000, return 2,000
INSERT INTO cash_advances(id,holder,total_advance,organization_id,project_id,status,approved_at) VALUES (:'F1','Runner B',3000,:'O1',:'P3','open','2026-09-02');
INSERT INTO cash_advance_receipts(advance_id,recipient,amount,date,organization_id,project_id,budget_code,status,description,vendor)
VALUES (:'F1','Runner B',1000,'2026-09-03',:'O1',:'P3','1403','approved','Water','Shop');
INSERT INTO treasury_movements(project_id,organization_id,kind,movement_date,amount,cash_advance_id) VALUES
 (:'P3',:'O1','petty_cash_return','2026-09-25',2000,:'F1'),
 (:'P3',:'O1','wht_remittance','2026-09-28',500,NULL),
 (:'P3',:'O1','vat_recovery','2026-09-30',1500,NULL);

SELECT t.eq('A06: debits = credits', (SELECT sum(debit) = sum(credit) FROM v_journal_lines WHERE project_id = :'P3'), true);
SELECT t.eq('A06: every event balanced', (SELECT count(*) FROM (SELECT event_key FROM v_journal_lines WHERE project_id = :'P3'
  GROUP BY event_key HAVING sum(debit) <> sum(credit) OR count(*) < 2) x), 0::bigint);
SELECT t.eq('R04: funding credited to its account', (SELECT credit FROM v_journal_lines WHERE project_id = :'P3' AND gl_account_id = :'fund'), 100000.00);
SELECT t.eq('expected funding is no entry', (SELECT count(*) FROM v_journal_lines WHERE project_id = :'P3' AND event_type = 'funding'), 2::bigint);
SELECT t.eq('invoice: VAT recoverable debit', (SELECT debit FROM v_journal_lines WHERE source_id = :'I1' AND gl_account_id = :'vat'), 1500.00);
SELECT t.eq('invoice: payable incl. VAT net of WHT', (SELECT credit FROM v_journal_lines WHERE source_id = :'I1' AND gl_account_id = :'ap'), 11000.00);

SELECT t.as_user(:'A');
CREATE TEMP TABLE tb AS SELECT * FROM get_trial_balance(:'P3');
GRANT ALL ON tb TO PUBLIC;
SELECT t.eq('N01: TB balances', (SELECT sum(period_debit) = sum(period_credit) AND sum(closing) = 0 FROM tb), true);
SELECT t.eq('A09: bank = funding − paid − float + return − WHT remitted + VAT recovered',
  (SELECT closing FROM tb WHERE gl_code = '9100'), (100000 - (11000 + 9500) - 3000 + 2000 - 500 + 1500)::numeric);
SELECT t.eq('A10: settled float is zero', (SELECT closing FROM tb WHERE gl_code = '9120'), 0.00);
SELECT t.eq('A11: WHT payable = not yet remitted', (SELECT closing FROM tb WHERE gl_code = '9210'), -500.00);
SELECT t.eq('VAT recoverable cleared', (SELECT closing FROM tb WHERE gl_code = '9220'), 0.00);
SELECT t.eq('payables cleared by the payments', (SELECT closing FROM tb WHERE gl_code = '9200'), 0.00);
SELECT t.eq('phase 1 before backfill', (SELECT max(phase) FROM tb), 1);
SELECT t.eq('N01: month filter opening/closing', (SELECT opening::text || '/' || closing::text FROM get_trial_balance(:'P3', '2026-09-26', '2026-09-30') WHERE gl_code = '9100'),
  (100000 - 20500 - 3000 + 2000)::text || '.00/79500.00');
SELECT t.eq('R01: running balance ends at the TB closing', (SELECT running_balance FROM get_general_ledger(:'P3', NULL, NULL, :'bank')
  ORDER BY entry_date DESC, entry_seq DESC LIMIT 1), 79500.00);
SELECT t.eq('R03: no GL line without party', (SELECT count(*) FROM get_general_ledger(:'P3') WHERE party IS NULL), 0::bigint);
SELECT t.eq('N11: daily cash closes at the bank balance', (SELECT closing FROM get_daily_cash_position(:'P3') WHERE gl_code = '9100' ORDER BY day DESC LIMIT 1), 79500.00);
SELECT t.eq('N11: opening + in − out = closing every day', (SELECT count(*) FROM get_daily_cash_position(:'P3') WHERE opening + cash_in - cash_out <> closing), 0::bigint);
SELECT t.denied('only an admin can backfill', $$SELECT ledger_backfill_project('20000000-0000-0000-0000-000000000182')$$);
SELECT t.denied('members cannot write ledger lines', format($$INSERT INTO ledger_projects(project_id, organization_id) VALUES (%L, %L)$$, :'P3', :'O1'));
SELECT t.as_user(:'B');
SELECT t.denied('tenant B: TB refused', $$SELECT * FROM get_trial_balance('20000000-0000-0000-0000-000000000182')$$);
SELECT t.eq('tenant B sees no journal lines', (SELECT count(*) FROM v_journal_lines WHERE project_id = '20000000-0000-0000-0000-000000000182'), 0::bigint);
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);

-- A13 bank reconciliation
INSERT INTO bank_statement_lines(project_id, organization_id, value_date, reference, amount, balance, matched_event_key)
SELECT :'P3', :'O1', '2026-09-01', 'TRF-1', 100000, 100000, event_key FROM v_journal_lines WHERE project_id = :'P3' AND event_type='funding' LIMIT 1;
INSERT INTO bank_statement_lines(project_id, organization_id, value_date, reference, amount, balance) VALUES
 (:'P3', :'O1', '2026-09-10', 'INV-77', -11000, 89000),
 (:'P3', :'O1', '2026-09-30', 'CHG', -25, 88975);
SELECT t.as_user(:'A');
SELECT t.eq('A13: statement balance from the statement', (get_bank_reconciliation(:'P3', '2026-09-30')->>'statement_balance')::numeric, 88975.00);
SELECT t.eq('A13: book balance', (get_bank_reconciliation(:'P3', '2026-09-30')->>'book_balance')::numeric, 79500.00);
SELECT t.eq('A13: difference explained by unmatched items', (get_bank_reconciliation(:'P3', '2026-09-30')->>'unexplained')::numeric, 0.00);
SELECT t.eq('A13: unmatched book items listed', jsonb_array_length(get_bank_reconciliation(:'P3', '2026-09-30')->'unmatched_book'), 6);
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);

-- ---------------- phase 2 ----------------
SELECT t.eq('engine idle before backfill', (SELECT count(*) FROM ledger_entries WHERE project_id = :'P3'), 0::bigint);
SELECT t.eq('A07: backfill posts one entry per event', ledger_backfill_project(:'P3'), (SELECT count(DISTINCT event_key)::int FROM v_journal_lines WHERE project_id = :'P3'));
SELECT t.denied('backfill runs once', $$SELECT ledger_backfill_project('20000000-0000-0000-0000-000000000182')$$);
SELECT t.eq('A07: phase 2 = phase 1', ledger_phases_match(:'P3'), true);
SELECT t.eq('A07: posted ledger balances', (SELECT sum(debit) = sum(credit) FROM ledger_lines WHERE project_id = :'P3'), true);
SELECT t.as_user(:'A');
SELECT t.eq('reports read phase 2 after backfill', (SELECT max(phase) FROM get_trial_balance(:'P3')), 2);
SELECT t.eq('member reads posted lines', (SELECT count(*) > 0 FROM ledger_lines WHERE project_id = :'P3'), true);
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);

-- engine: approve m2 → accrual posted; un-approve (cancel) → automatic reversal
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,payroll_milestone_id,source_label,total_amount,requested_amount,currency,status,approved_at)
VALUES (:'R2',:'O1',:'P3','payroll_row',:'PC','m2','Director X',19000,9500,'SAR','approved','2026-10-01');
SELECT t.eq('engine posts the approval', (SELECT count(*) FROM ledger_entries WHERE event_key = 'instalment:' || :'PC' || ':m2'), 1::bigint);
UPDATE payment_requests SET status = 'cancelled', cancellation_reason = 'wrong amount' WHERE id = :'R2';
SELECT t.eq('A03/decision 2: un-approval writes a reversing entry', (SELECT count(*) FROM ledger_entries WHERE event_key = 'instalment:' || :'PC' || ':m2' AND reverses_entry_id IS NOT NULL), 1::bigint);
SELECT t.eq('reversed instalment nets to zero', (SELECT sum(debit - credit) FILTER (WHERE gl_account_id = :'ap') FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id WHERE e.event_key = 'instalment:' || :'PC' || ':m2'), 0.00);
-- invoice edited → reverse + repost; deleted payment → reversed
UPDATE invoices SET price = 12000 WHERE id = :'I1';
SELECT t.eq('edit = reversal + new entry', (SELECT count(*) FROM ledger_entries WHERE source_id = :'I1'), 3::bigint);
DELETE FROM payments WHERE source_id = :'I1';
SELECT t.eq('A07: phase 2 = phase 1 after edits', ledger_phases_match(:'P3'), true);
SELECT t.eq('nothing to resync', ledger_resync_project(:'P3'), 0);
-- float paid through payments replaces its approval entry
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,method) VALUES (:'O1',:'P3','petty_cash',:'F1',3000,'2026-09-02','Transfer');
SELECT t.eq('float payment replaces the approval issue', (SELECT count(*) FROM v_journal_lines WHERE event_key = 'petty_issue:' || :'F1'), 0::bigint);
SELECT t.eq('A07: phase 2 = phase 1 after the float payment', ledger_phases_match(:'P3'), true);
-- immutability and balance
SELECT t.denied('ledger lines cannot be edited', format($$UPDATE ledger_lines SET debit = debit + 1 WHERE project_id = %L$$, :'P3'));
SELECT t.denied('ledger entries cannot be deleted', format($$DELETE FROM ledger_entries WHERE project_id = %L$$, :'P3'));
BEGIN;
SET CONSTRAINTS trg_ledger_entry_balanced, trg_ledger_line_balanced IMMEDIATE;
SELECT t.denied('an entry without lines is refused', format($$INSERT INTO ledger_entries(organization_id, project_id, entry_no, event_key, event_type, entry_date) VALUES (%L, %L, 9999, 'x', 'x', '2026-09-01')$$, :'O1', :'P3'));
SELECT t.denied('an unbalanced entry is refused', format($$WITH e AS (INSERT INTO ledger_entries(organization_id, project_id, entry_no, event_key, event_type, entry_date) VALUES (%1$L, %2$L, 9998, 'y', 'y', '2026-09-01') RETURNING id)
  INSERT INTO ledger_lines(entry_id, organization_id, project_id, line_no, gl_account_id, debit, credit)
  SELECT e.id, %1$L, %2$L, n, %3$L, CASE WHEN n = 1 THEN 100 ELSE 0 END, CASE WHEN n = 2 THEN 90 ELSE 0 END FROM e, generate_series(1, 2) n$$, :'O1', :'P3', :'bank'));
COMMIT;
SELECT t.eq('project P1 (not initialised) untouched by the engine', (SELECT count(*) FROM ledger_entries WHERE project_id = :'P1'), 0::bigint);
-- a project delete takes its ledger with it
UPDATE projects SET status = 'Archived', archived_at = now() - interval '40 days' WHERE id = :'P3';
DELETE FROM projects WHERE id = :'P3';
SELECT t.eq('project delete cascades the ledger', (SELECT count(*) FROM ledger_lines WHERE project_id = :'P3'), 0::bigint);
