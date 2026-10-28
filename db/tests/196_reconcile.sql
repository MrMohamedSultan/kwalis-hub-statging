-- 196 — glossary model (180) and ledger (182) on one scenario:
--   funding (USD) · invoice paid through its request · hand payment adopted · PO paid by request
--   contract instalments from payroll_instalments · petty float paid by request, receipt, return
--   cash payment · VAT paid through the old project_tax_payments name · VAT recovery · WHT remittance
--   bank charge · un-approval reversal · cancelled contract out of the cash flow
--   Checks: TB bank = Funding screen cash balance, Payments Register bank total = GL bank credits,
--   phase 2 = phase 1.
\set A  '00000000-0000-0000-0000-00000000000a'
\set B  '00000000-0000-0000-0000-00000000000b'
\set D  '00000000-0000-0000-0000-00000000000d'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P  '20000000-0000-0000-0000-000000000196'
\set I1 '61960000-0000-0000-0000-000000000001'
\set I2 '61960000-0000-0000-0000-000000000002'
\set I3 '61960000-0000-0000-0000-000000000003'
\set PO '71960000-0000-0000-0000-000000000001'
\set K1 '51960000-0000-0000-0000-000000000001'
\set K2 '51960000-0000-0000-0000-000000000002'
\set F1 '91960000-0000-0000-0000-000000000001'
\set RI '81960000-0000-0000-0000-000000000001'
\set RJ '81960000-0000-0000-0000-000000000002'
\set RP '81960000-0000-0000-0000-000000000003'
\set RF '81960000-0000-0000-0000-000000000004'
\set R1 '81960000-0000-0000-0000-000000000011'
\set R2 '81960000-0000-0000-0000-000000000012'
SELECT id AS bank FROM gl_accounts WHERE code='9100' \gset
SELECT id AS cash FROM gl_accounts WHERE code='9110' \gset
SELECT id AS ap FROM gl_accounts WHERE code='9200' \gset

-- ---------------------------------------------------------------- schema
SELECT t.eq('one treasury table: project_tax_payments is a view now', (SELECT relkind::text FROM pg_class WHERE oid = 'public.project_tax_payments'::regclass), 'v');
SELECT t.eq('the 180 table is kept (renamed), not dropped', to_regclass('public.project_tax_payments_legacy_180') IS NOT NULL, true);
SELECT t.eq('treasury kinds include VAT paid', (SELECT pg_get_constraintdef(oid) LIKE '%vat_payment%' FROM pg_constraint WHERE conname = 'treasury_movements_kind_check'), true);

-- ---------------------------------------------------------------- scenario
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status,start_date,end_date) VALUES
 (:'P', :'A', 'Reconcile test', 'REC1', :'O1', 'USD', 3.75, 'Production', '2026-09-01', '2026-12-31');
INSERT INTO project_members(project_id,user_id) VALUES (:'P', :'A'), (:'P', :'D') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,module_key,can_view,can_edit)
SELECT '30000000-0000-0000-0000-000000000001','funding',true,true
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id='30000000-0000-0000-0000-000000000001' AND module_key='funding');

-- B28: funding received in USD, booked in SAR
INSERT INTO project_funding(organization_id,project_id,funding_date,amount,status,source,kind,reference,currency,original_amount,fx_rate) VALUES
 (:'O1', :'P', '2026-09-01', 150000, 'received', 'Financier', 'Capital', 'TRF-1', 'USD', 40000, 3.75),
 (:'O1', :'P', '2026-12-01', 50000, 'expected', 'Financier', 'Capital', 'TRF-2', 'SAR', NULL, NULL);
SELECT t.eq('B28 funding keeps its currency, original amount and rate', (SELECT currency||'|'||original_amount||'|'||fx_rate::numeric(8,2)||'|'||amount FROM project_funding WHERE reference='TRF-1' AND project_id=:'P'), 'USD|40000.00|3.75|150000.00');
SELECT t.eq('funding: the kind is in the ledger description', (SELECT description FROM v_journal_lines WHERE project_id=:'P' AND event_type='funding' AND line_no=1), 'Funding — Capital — Financier — TRF-1');

-- invoices: I1 paid through its request · I2 paid by hand first, then its request · I3 paid in cash
-- 203: these invoices are approved (201: a server-written invoice otherwise starts pending)
INSERT INTO invoices(id,description,budget_code,price,vat_amount,wht_amount,date,vendor_name,invoice_no,organization_id,project_id,approval_status) VALUES
 (:'I1','Lighting kit','1403',10000,1500,500,'2026-09-05','Gaffer Co','INV-77',:'O1',:'P','approved'),
 (:'I2','Catering','1403',2000,0,0,'2026-09-06','Food Co','INV-78',:'O1',:'P','approved'),
 (:'I3','Taxi','1403',300,0,0,'2026-09-07','Taxi Co','INV-79',:'O1',:'P','approved');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,approved_at) VALUES
 (:'RI',:'O1',:'P','invoice',:'I1','Gaffer Co · INV-77',11000,11000,'SAR','approved','2026-09-08');
SELECT t.eq('A2 an approved request is no payment yet', (SELECT count(*) FROM payments WHERE source_id=:'I1'), 0::bigint);
UPDATE payment_requests SET status='paid', payment_date='2026-09-10', payment_method='Transfer' WHERE id=:'RI';
SELECT t.eq('A2 a paid invoice request writes its payments row', (SELECT count(*)||'|'||max(amount)||'|'||max(payment_date)::text||'|'||max(method) FROM payments WHERE source_id=:'I1'), '1|11000.00|2026-09-10|Transfer');
SELECT t.eq('A2 the payment is linked to its request', (SELECT payment_request_id FROM payments WHERE source_id=:'I1'), :'RI'::uuid);
SELECT t.eq('A2 the payment is in the ledger', (SELECT credit FROM v_journal_lines WHERE event_type='payment' AND parent_id=:'I1' AND gl_account_id=:'bank'), 11000.00);
UPDATE payment_requests SET payment_date='2026-09-11' WHERE id=:'RI';
SELECT t.eq('A2 a date change on the request follows (no second row)', (SELECT count(*)||'|'||max(payment_date)::text FROM payments WHERE source_id=:'I1'), '1|2026-09-11');

INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,method,notes) VALUES
 (:'O1',:'P','invoice',:'I2',2000,'2026-09-12','Transfer','recorded by hand'),
 (:'O1',:'P','invoice',:'I3',300,'2026-09-13','Cash','petty taxi');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,approved_at,payment_date,payment_method) VALUES
 (:'RJ',:'O1',:'P','invoice',:'I2','Food Co · INV-78',2000,2000,'SAR','paid','2026-09-12','2026-09-12','Transfer');
SELECT t.eq('A2 a hand payment of the same amount is adopted, not doubled', (SELECT count(*)||'|'||bool_and(payment_request_id = :'RJ'::uuid) FROM payments WHERE source_id=:'I2'), '1|true');
SELECT t.as_user(:'A');
SELECT t.denied('A2 a hand payment repeating a request payment is refused', format($$INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,method) VALUES (%L,%L,'invoice',%L,11000,'2026-09-20','Transfer')$$, :'O1', :'P', :'I1'));
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);

-- PO paid through its request
INSERT INTO purchase_orders(id,po_number,vendor_name,budget_code,amount,status,date,organization_id,project_id) VALUES
 (:'PO','REC-PO-1','Grip House','1403',4000,'approved','2026-09-03',:'O1',:'P');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,approved_at,payment_date,payment_method) VALUES
 (:'RP',:'O1',:'P','purchase_order',:'PO','Grip House · PO',4000,4000,'SAR','paid','2026-09-14','2026-09-14','Transfer');
SELECT t.eq('A2 a paid PO request writes its payment', (SELECT count(*)||'|'||max(source_type) FROM payments WHERE source_id=:'PO'), '1|purchase_order');

-- contracts: K1 gross 20,000 / net 19,000, two 50% instalments · K2 6,000 on 2101 (cancelled later)
INSERT INTO payroll(id,name,kind,total_amount,net_payable,wht_amount,budget_code,organization_id,project_id,payment_schedule) VALUES
 (:'K1','Director X','crew',20000,19000,1000,'1101',:'O1',:'P',
  '[{"id":"m1","label":"On Signing","dueDate":"2026-09-15","percent":50,"status":"Pending"},{"id":"m2","label":"On Wrap","dueDate":"2026-11-15","percent":50,"status":"Pending"}]'),
 (:'K2','Grip Y','crew',6000,NULL,0,'2101',:'O1',:'P',
  '[{"id":"m1","label":"Prep","dueDate":"2026-11-01","percent":0,"amount":2000,"status":"Pending"},{"id":"m2","label":"Wrap","dueDate":"2026-12-01","percent":0,"amount":4000,"status":"Pending"}]');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,payroll_milestone_id,source_label,total_amount,requested_amount,currency,status,approved_at) VALUES
 (:'R1',:'O1',:'P','payroll_row',:'K1','m1','Director X',19000,9500,'SAR','approved','2026-09-15');
SELECT t.eq('A1 accrual read from payroll_instalments: Dr expense amount_gross', (SELECT debit FROM v_journal_lines WHERE event_key='instalment:'||:'K1'||':m1' AND line_no=1), (SELECT amount_gross FROM payroll_instalments WHERE payroll_id=:'K1' AND milestone_id='m1'));
SELECT t.eq('A1 accrual: Cr payable = instalment amount, Cr WHT = the rest', (SELECT string_agg(credit::text, '|' ORDER BY line_no) FROM v_journal_lines WHERE event_key='instalment:'||:'K1'||':m1' AND credit > 0), '9500.00|500.00');
SELECT t.eq('A1 accrual dated approved_at', (SELECT DISTINCT entry_date FROM v_journal_lines WHERE event_key='instalment:'||:'K1'||':m1'), (SELECT approved_at::date FROM payroll_instalments WHERE payroll_id=:'K1' AND milestone_id='m1'));
SELECT t.eq('A1 a pending / requested instalment is no entry', (SELECT count(*) FROM v_journal_lines WHERE event_key IN ('instalment:'||:'K1'||':m2', 'instalment:'||:'K2'||':m1')), 0::bigint);
UPDATE payment_requests SET status='paid', payment_date='2026-09-20', payment_method='Transfer' WHERE id=:'R1';
SELECT t.eq('instalment request still pays through 160 (one row, no request link)', (SELECT count(*)||'|'||count(payment_request_id) FROM payments WHERE source_id=:'K1'), '1|0');

-- petty cash: float 3,000 paid through its request, receipt 1,000, return 500
INSERT INTO cash_advances(id,holder,total_advance,organization_id,project_id,status,approved_at) VALUES (:'F1','Runner B',3000,:'O1',:'P','open','2026-09-02');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,approved_at,payment_date,payment_method) VALUES
 (:'RF',:'O1',:'P','petty_cash',:'F1','Petty Cash — Runner B',3000,3000,'SAR','paid','2026-09-02','2026-09-02','Transfer');
SELECT t.eq('A2 the float request payment replaces the approval issue', (SELECT count(*)||'|'||bool_and(event_key LIKE 'payment:%')::text FROM (SELECT DISTINCT event_key FROM v_journal_lines WHERE project_id=:'P' AND event_type='petty_issue') x), '1|true');
INSERT INTO cash_advance_receipts(advance_id,recipient,amount,date,organization_id,project_id,budget_code,status,description,vendor) VALUES
 (:'F1','Runner B',1000,'2026-09-03',:'O1',:'P','1403','approved','Water','Shop');
INSERT INTO treasury_movements(project_id,organization_id,kind,movement_date,amount,cash_advance_id,budget_code) VALUES
 (:'P',:'O1','petty_cash_return','2026-09-25',500,:'F1',NULL),
 (:'P',:'O1','vat_recovery','2026-09-30',100,NULL,NULL),
 (:'P',:'O1','wht_remittance','2026-09-28',500,NULL,NULL),
 (:'P',:'O1','bank_charge','2026-09-30',25,NULL,'1403');

-- VAT paid through the old 180 name lands in the one table
SELECT t.as_user(:'A');
INSERT INTO project_tax_payments(organization_id, project_id, payment_date, kind, amount, reference) VALUES
 ('10000000-0000-0000-0000-000000000002', :'P', '2026-09-29', 'vat_paid', 300, 'ZATCA-Q3');
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('compatibility view writes treasury_movements (org from the project)', (SELECT kind||'|'||amount||'|'||(organization_id = :'O1'::uuid) FROM treasury_movements WHERE project_id=:'P' AND reference='ZATCA-Q3'), 'vat_payment|300.00|true');
SELECT t.eq('VAT paid: Dr VAT / Cr bank', (SELECT count(*) FROM v_journal_lines WHERE project_id=:'P' AND event_type='vat_payment' AND ((line_no=1 AND debit=300) OR (line_no=2 AND credit=300 AND gl_account_id=:'bank'))), 2::bigint);

-- ---------------------------------------------------------------- the numbers agree
SELECT t.as_user(:'A');
CREATE TEMP TABLE tb AS SELECT * FROM get_trial_balance(:'P');
CREATE TEMP TABLE fp AS SELECT get_funding_position(:'P', '2026-12-31') AS j;
CREATE TEMP TABLE reg AS SELECT * FROM get_payments_register(:'P');
CREATE TEMP TABLE gl AS SELECT * FROM get_general_ledger(:'P');
GRANT ALL ON tb, fp, reg, gl TO PUBLIC;
SELECT t.eq('TB balances', (SELECT sum(period_debit) = sum(period_credit) FROM tb), true);
-- bank = 150,000 − (11,000 + 2,000 + 4,000 + 9,500) − 3,000 float + 500 return + 100 VAT rec − 500 WHT − 25 charge − 300 VAT paid
SELECT t.eq('bank balance of the scenario', (SELECT closing FROM tb WHERE gl_code='9100'), 120275.00);
SELECT t.eq('A09/A12 TB bank balance = Funding screen cash balance', (SELECT (j->>'cash_balance')::numeric FROM fp), (SELECT closing FROM tb WHERE gl_code='9100'));
SELECT t.eq('A12 the cash balance adds up from its parts', (SELECT (j->>'funding')::numeric - (j->>'paid_from_bank')::numeric - (j->>'petty_cash_issued')::numeric + (j->>'petty_cash_returned')::numeric
  - (j->>'vat_paid')::numeric + (j->>'vat_recovered')::numeric - (j->>'wht_remitted')::numeric - (j->>'bank_charges')::numeric FROM fp), 120275.00);
SELECT t.eq('A12 parts', (SELECT concat_ws('|', j->>'funding', j->>'paid_from_bank', j->>'petty_cash_issued', j->>'petty_cash_returned', j->>'vat_paid', j->>'vat_recovered', j->>'wht_remitted', j->>'bank_charges') FROM fp),
  '150000.00|26500.00|3000.00|500.00|300.00|100.00|500.00|25.00');
SELECT t.eq('A12 cash payment is not bank: cash on hand', (SELECT (j->>'cash_on_hand')::numeric FROM fp), -300.00);
SELECT t.eq('A12 petty float balance = issued − spent − returned', (SELECT (j->>'petty_cash')::numeric FROM fp), 1500.00);
SELECT t.eq('A12 glossary Paid = every payment', (SELECT (j->>'paid')::numeric FROM fp), (SELECT sum(amount) FROM payments WHERE project_id=:'P'));
SELECT t.eq('A12 expected funding kept apart', (SELECT (j->>'funding_expected')::numeric FROM fp), 50000.00);
-- R12 Payments Register
SELECT t.eq('R12 register bank total = bank credits of those events in the General Ledger',
  (SELECT sum(net) FROM reg WHERE paid_from_code='9100'),
  (SELECT sum(credit) - sum(debit) FROM gl WHERE gl_code='9100' AND event_key IN (SELECT event_key FROM reg)));
SELECT t.eq('R12 register bank total = every bank credit', (SELECT sum(net) FROM reg WHERE paid_from_code='9100'), (SELECT sum(credit) FROM gl WHERE gl_code='9100'));
SELECT t.eq('R12 bank = funding + returns + VAT recovered − register bank total',
  (SELECT closing FROM tb WHERE gl_code='9100'), 150000 + 500 + 100 - (SELECT sum(net) FROM reg WHERE paid_from_code='9100'));
SELECT t.eq('R12 includes vendor invoices, PO, instalments, floats, receipts, WHT, VAT, charges',
  (SELECT string_agg(DISTINCT document_type, ',' ORDER BY document_type) FROM reg),
  'bank_charge,invoice,payroll,petty_cash,petty_receipt,purchase_order,vat_payment,wht_remittance');
SELECT t.eq('R12 instalment row: payee, instalment, gross / WHT / net, contract ref', (SELECT concat_ws('|', payee, instalment, gross, wht, net, budget_code, method, paid_from_code, document_ref LIKE 'REC1-CRW-%') FROM reg WHERE document_type='payroll'),
  'Director X|On Signing|10000.00|500.00|9500.00|1101|Transfer|9100|t');
SELECT t.eq('R12 invoice row: WHT share, ref of the invoice, payment ref', (SELECT concat_ws('|', gross, wht, net, document_ref LIKE 'REC1-INV-%', payment_ref LIKE 'REC1-PMT-%') FROM reg WHERE document_id=:'I1'), '11500.00|500.00|11000.00|t|t');
SELECT t.eq('R12 cash payment paid from cash on hand', (SELECT paid_from_code||'|'||method FROM reg WHERE document_id=:'I3'), '9110|Cash');
SELECT t.eq('R12 petty receipt paid from the float', (SELECT paid_from_code||'|'||net FROM reg WHERE document_type='petty_receipt'), '9120|1000.00');
SELECT t.eq('R12 date filter (WHT, VAT paid, bank charge)', (SELECT count(*) FROM get_payments_register(:'P', '2026-09-25', '2026-09-30')), 3::bigint);
-- v_ledger_transactions
SELECT t.eq('G06 reference = ref_no', (SELECT reference = ref_no AND ref_no LIKE 'REC1-INV-%' FROM v_ledger_transactions WHERE id=:'I1'), true);
SELECT t.eq('payroll appears as actual + commitment with the same id', (SELECT count(*) FROM v_ledger_transactions WHERE id=:'K1'), 2::bigint);
SELECT t.eq('row_key is unique', (SELECT count(*) = count(DISTINCT row_key) FROM v_ledger_transactions WHERE project_id=:'P'), true);
SELECT t.as_user(:'B');
SELECT t.denied('tenant B: register refused', $$SELECT * FROM get_payments_register('20000000-0000-0000-0000-000000000196')$$);
SELECT t.denied('tenant B: funding position refused', $$SELECT get_funding_position('20000000-0000-0000-0000-000000000196')$$);
SELECT t.eq('tenant B sees no treasury rows through the old name', (SELECT count(*) FROM project_tax_payments WHERE project_id='20000000-0000-0000-0000-000000000196'), 0::bigint);
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------- phase 2
SELECT t.eq('backfill posts one entry per event', ledger_backfill_project(:'P'), (SELECT count(DISTINCT event_key)::int FROM v_journal_lines WHERE project_id=:'P'));
SELECT t.eq('ledger_phases_match after backfill', ledger_phases_match(:'P'), true);
-- un-approve: approve m2, then cancel the approved request
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,payroll_milestone_id,source_label,total_amount,requested_amount,currency,status,approved_at) VALUES
 (:'R2',:'O1',:'P','payroll_row',:'K1','m2','Director X',19000,9500,'SAR','approved','2026-10-01');
SELECT t.eq('engine posts the accrual from payroll_instalments', (SELECT count(*) FROM ledger_entries WHERE event_key='instalment:'||:'K1'||':m2'), 1::bigint);
UPDATE payment_requests SET status='cancelled', cancellation_reason='approved by mistake' WHERE id=:'R2';
SELECT t.eq('A03 one accrual_reversals row', (SELECT count(*) FROM accrual_reversals WHERE source_id=:'K1' AND payroll_milestone_id='m2'), 1::bigint);
SELECT t.eq('A03 one reversing entry (no second posting from accrual_reversals)', (SELECT count(*) FROM ledger_entries WHERE event_key='instalment:'||:'K1'||':m2' AND reverses_entry_id IS NOT NULL), 1::bigint);
SELECT t.eq('A03 the reversing entry = the accrual_reversals amount', (SELECT sum(l.credit) FROM ledger_lines l JOIN ledger_entries e ON e.id=l.entry_id
   WHERE e.event_key='instalment:'||:'K1'||':m2' AND e.reverses_entry_id IS NOT NULL AND l.line_no=1),
  (SELECT amount FROM accrual_reversals WHERE source_id=:'K1' AND payroll_milestone_id='m2'));
SELECT t.eq('phases match after the un-approval', ledger_phases_match(:'P'), true);
-- a new paid request posts through the engine and keeps TB bank = cash balance
INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,approved_at,payment_date,payment_method)
VALUES (:'O1',:'P','invoice',:'I3','Taxi Co',300,100,'SAR','paid','2026-10-02','2026-10-02','Transfer');
SELECT t.eq('phase 2 = phase 1 after a request payment', ledger_phases_match(:'P'), true);
SELECT t.as_user(:'A');
SELECT t.eq('phase 2: TB bank = Funding screen cash balance', (SELECT closing FROM get_trial_balance(:'P') WHERE gl_code='9100'), (SELECT (get_funding_position(:'P','2026-12-31')->>'cash_balance')::numeric));
SELECT t.eq('phase 2: register bank total = GL bank credits', (SELECT sum(net) FROM get_payments_register(:'P') WHERE paid_from_code='9100'),
  (SELECT sum(credit - debit) FROM get_general_ledger(:'P') WHERE gl_code='9100' AND event_type NOT IN ('funding','petty_cash_return','vat_recovery')));
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------- cash flow: cancelled contract
SELECT t.as_user(:'A');
SELECT t.eq('cash flow forecasts K2 while it is active', (SELECT sum((p->>'amount')::numeric) FROM jsonb_array_elements(get_cash_flow(:'P','month',false,'none','2026-10-15')->'lines') l, jsonb_array_elements(l->'periods') p WHERE l->>'budget_code'='2101' AND p->>'kind'='forecast'), 6000.00);
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE payroll SET contract_cancelled_at = now(), contract_cancellation_reason = 'test' WHERE id = :'K2';
SELECT t.as_user(:'A');
SELECT t.eq('A04 a cancelled contract is not forecast', (SELECT COALESCE(sum((p->>'amount')::numeric), 0) FROM jsonb_array_elements(get_cash_flow(:'P','month',false,'none','2026-10-15')->'lines') l, jsonb_array_elements(l->'periods') p WHERE l->>'budget_code'='2101' AND p->>'kind'='forecast'), 0::numeric);
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------- un-paying a request removes its payment
SET session_replication_role = replica;   -- bypass the 176 "decided requests are kept" guard to simulate a reversal
UPDATE payment_requests SET status = 'approved' WHERE id = :'RP';
SET session_replication_role = origin;
SELECT public.apply_request_payment(r) FROM payment_requests r WHERE r.id = :'RP';
SELECT t.eq('a request that is no longer paid loses the payment it created', (SELECT count(*) FROM payments WHERE source_id=:'PO'), 0::bigint);
SELECT t.eq('backfill finds nothing left to fill (idempotent)', (SELECT backfill_request_payments(:'P')), 0);

-- clean up
DELETE FROM role_permissions WHERE role_id='30000000-0000-0000-0000-000000000001' AND module_key='funding';
UPDATE projects SET status = 'Archived', archived_at = now() - interval '40 days' WHERE id = :'P';
DELETE FROM projects WHERE id = :'P';
SELECT t.eq('project delete cascades everything', (SELECT count(*) FROM ledger_lines WHERE project_id=:'P') + (SELECT count(*) FROM treasury_movements WHERE project_id=:'P'), 0::bigint);
