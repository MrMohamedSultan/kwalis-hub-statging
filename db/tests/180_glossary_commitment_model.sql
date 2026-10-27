-- 180 — the glossary on one scenario (client spec A01–A05, A09, A12, R06, R07, B18, B19, X07)
--   budget 93,750 (one line 1,000 USD = 3,750 SAR) · contracts 16,000 · PO 1,000 + invoice 1,000 on it
--   car 3,000 · hotel 5,000 · one instalment approved, one paid
-- Runs in one transaction and rolls back.
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-00000000000d'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P '20000000-0000-0000-0000-000000000180'
\set KA 'b1800000-0000-0000-0000-00000000000a'
\set KB 'b1800000-0000-0000-0000-00000000000b'
\set PO 'f1800000-0000-0000-0000-000000000001'
\set INV 'c1800000-0000-0000-0000-000000000001'
BEGIN;
SET session_replication_role = replica;
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status,start_date,end_date) VALUES
 (:'P',:'A','Glossary scenario','GLO1',:'O1','USD',3.75,'Production','2026-09-01','2026-12-31');
INSERT INTO project_members(project_id,user_id) VALUES (:'P',:'A'),(:'P',:'C'),(:'P',:'D');
INSERT INTO role_permissions(role_id,module_key,can_view,can_edit)
SELECT '30000000-0000-0000-0000-000000000001','funding',true,true
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id='30000000-0000-0000-0000-000000000001' AND module_key='funding');
INSERT INTO budget_versions(id,project_id,organization_id,version_no,version_name,status) VALUES
 ('40000000-0000-0000-0000-000000000180',:'P',:'O1',1,'v1.0','active');
INSERT INTO budget_lines(project_id,organization_id,version_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency) VALUES
 (:'P',:'O1','40000000-0000-0000-0000-000000000180','1000','1002','1100','Producer (USD)',1,1000,1,'Package','USD'),
 (:'P',:'O1','40000000-0000-0000-0000-000000000180','1100','1101','1100','Writers',1,20000,1,'Package','SAR'),
 (:'P',:'O1','40000000-0000-0000-0000-000000000180','2100','2101','2100','Camera',1,40000,1,'Package','SAR'),
 (:'P',:'O1','40000000-0000-0000-0000-000000000180','3100','3101','2100','Hotels',1,20000,1,'Package','SAR'),
 (:'P',:'O1','40000000-0000-0000-0000-000000000180','3200','3201','2100','Cars',1,10000,1,'Package','SAR');
INSERT INTO purchase_orders(id,po_number,vendor_name,budget_code,amount,status,date,organization_id,project_id) VALUES
 (:'PO','GLO1-PO-0001','Lens house','2101',1000,'approved','2026-09-10',:'O1',:'P');
INSERT INTO invoices(id,invoice_no,description,budget_code,price,vat_amount,date,vendor_name,organization_id,project_id,purchase_order_id) VALUES
 (:'INV','INV-1','Lens rental','2101',1000,0,'2026-09-15','Lens house',:'O1',:'P',:'PO');
INSERT INTO people(id,kind,full_name,contract_status,organization_id,project_id) VALUES
 ('a1800000-0000-0000-0000-000000000001','crew','Hotel guest','Active',:'O1',:'P');
INSERT INTO car_rentals(project_id,organization_id,make_model,license_plate,daily_rate,currency,rental_start_date,rental_end_date,budget_code) VALUES
 (:'P',:'O1','Land Cruiser','ABC-1',300,'SAR','2026-10-01','2026-10-10','3201');
INSERT INTO accommodations(project_id,organization_id,person_id,hotel_name,check_in_date,check_out_date,nightly_rate,currency,budget_code) VALUES
 (:'P',:'O1','a1800000-0000-0000-0000-000000000001','Hilton','2026-10-01','2026-10-11',500,'SAR','3101');
SET session_replication_role = origin;

-- ---------------------------------------------------------------- A05: schedule rules
SELECT t.as_user(:'A');
SELECT t.denied('A05 an instalment without a name is refused', $$INSERT INTO payroll(ref_id,name,kind,total_amount,budget_code,organization_id,project_id,payment_schedule) VALUES ('w-x','X','crew',1000,'1101','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000180','[{"id":"m1","label":"","dueDate":"2026-10-01","percent":100,"amount":null,"status":"Pending"}]')$$);
SELECT t.denied('A05 an instalment without a due date is refused', $$INSERT INTO payroll(ref_id,name,kind,total_amount,budget_code,organization_id,project_id,payment_schedule) VALUES ('w-x','X','crew',1000,'1101','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000180','[{"id":"m1","label":"Signing","dueDate":"","percent":100,"amount":null,"status":"Pending"}]')$$);
SELECT t.denied('A05 a schedule that does not equal the contract is refused', $$INSERT INTO payroll(ref_id,name,kind,total_amount,budget_code,organization_id,project_id,payment_schedule) VALUES ('w-x','X','crew',6650,'1101','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000180','[{"id":"m1","label":"Signing","dueDate":"2026-10-01","percent":0,"amount":2000,"status":"Pending"}]')$$);
-- contracts 16,000: A 10,000 on 1101 (4,000 + 6,000) · B 6,000 on 2101 (2,000 + 4,000)
INSERT INTO payroll(id,ref_id,name,kind,total_amount,budget_code,organization_id,project_id,payment_schedule) VALUES
 (:'KA','writer-a','Writer A','crew',10000,'1101',:'O1',:'P',
  '[{"id":"m1","label":"Signing","dueDate":"2026-09-20","percent":0,"amount":4000,"status":"Pending"},{"id":"m2","label":"Final draft","dueDate":"2026-11-20","percent":60,"amount":null,"status":"Pending"}]'),
 (:'KB','dop-b','DOP B','crew',6000,'2101',:'O1',:'P',
  '[{"id":"m1","label":"Prep","dueDate":"2026-09-25","percent":0,"amount":2000,"status":"Pending"},{"id":"m2","label":"Wrap","dueDate":"2026-12-01","percent":0,"amount":4000,"status":"Pending"}]');
SELECT t.eq('A05 instalments are rows of their own table', (SELECT count(*) FROM payroll_instalments WHERE project_id=:'P'), 4::bigint);
SELECT t.eq('A05 instalment row carries name, due date, amount', (SELECT label||'|'||due_date||'|'||amount FROM payroll_instalments WHERE payroll_id=:'KA' AND milestone_id='m2'), 'Final draft|2026-11-20|6000.00');
SELECT t.denied('payroll_instalments is read only for the app', $$UPDATE payroll_instalments SET amount = 1$$);

-- ---------------------------------------------------------------- A01: a signed contract is a commitment
SELECT t.eq('A01 new contracts do not change Actual', (SELECT actual_sar FROM v_project_position WHERE project_id=:'P'), 1000.00);
SELECT t.eq('A01 new contracts are Commitment', (SELECT committed_sar FROM v_project_position WHERE project_id=:'P'), 16000.00 + 3000 + 5000);

-- ---------------------------------------------------------------- A02: Pending -> Requested -> Approved -> Paid
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,payroll_milestone_id,total_amount,requested_amount,status,requested_by,submitted_at) VALUES
 ('c1800000-0000-0000-0000-0000000000a1',:'O1',:'P','payroll_row',:'KA','Writer A · Signing','m1',10000,4000,'waiting_approval',:'A',now()),
 ('c1800000-0000-0000-0000-0000000000b1',:'O1',:'P','payroll_row',:'KB','DOP B · Prep','m1',6000,2000,'waiting_approval',:'A',now());
SELECT t.eq('A02 a requested instalment reads Requested', (SELECT status FROM payroll_instalments WHERE payroll_id=:'KA' AND milestone_id='m1'), 'Requested');
SELECT t.eq('A02 a requested instalment is still Commitment', (SELECT actual_sar FROM v_project_position WHERE project_id=:'P'), 1000.00);
SELECT t.as_user(:'D');
SELECT approve_payment_request_step('c1800000-0000-0000-0000-0000000000a1') IS NOT NULL AS ok1 \gset
SELECT approve_payment_request_step('c1800000-0000-0000-0000-0000000000b1') IS NOT NULL AS ok2 \gset
UPDATE payment_requests SET status='paid', payment_date='2026-10-01', payment_method='Transfer' WHERE id='c1800000-0000-0000-0000-0000000000b1';
SELECT t.eq('A02 approved / paid words on the rows', (SELECT string_agg(payroll_id::text||':'||status, ',' ORDER BY payroll_id) FROM payroll_instalments WHERE milestone_id='m1' AND project_id=:'P'), :'KA'||':Approved,'||:'KB'||':Paid');
SELECT t.eq('A02 approval date recorded on the instalment', (SELECT approved_at IS NOT NULL FROM payroll_instalments WHERE payroll_id=:'KA' AND milestone_id='m1'), true);
SELECT t.eq('A05 the paid instalment has its payment linked', (SELECT count(*) FROM payments p JOIN payroll_instalments i ON i.payroll_id = p.source_id AND i.milestone_id = p.payroll_milestone_id WHERE i.project_id=:'P'), 1::bigint);

-- ---------------------------------------------------------------- the glossary numbers
SELECT t.as_user(:'A');
CREATE TEMP TABLE pos AS SELECT * FROM v_project_position WHERE project_id=:'P';
GRANT ALL ON pos TO PUBLIC;
SELECT t.eq('Budget = 93,750 (USD line at the project rate)', (SELECT round(budget_sar,2) FROM pos), 93750.00);
SELECT t.eq('Actual = approved 4,000 + paid 2,000 + invoice 1,000', (SELECT actual_sar FROM pos), 7000.00);
SELECT t.eq('Commitment = contracts 10,000 + PO 0 + car 3,000 + hotel 5,000', (SELECT committed_sar FROM pos), 18000.00);
SELECT t.eq('Paid = money out', (SELECT paid_sar FROM pos), 2000.00);
SELECT t.eq('Payable = Actual − Paid', (SELECT payable_sar FROM pos), 5000.00);
SELECT t.eq('Remaining Budget = Budget − Actual − Commitment', (SELECT round(available_sar,2) FROM pos), 68750.00);
SELECT t.eq('X07 code view adds up to the project view', (SELECT sum(actual_sar)::text||'/'||sum(committed_sar)::text||'/'||sum(paid_sar)::text FROM v_budget_code_position WHERE project_id=:'P'), '7000.00/18000.00/2000.00');

-- ---------------------------------------------------------------- R06 / R07: Cost Report
CREATE TEMP TABLE cr AS SELECT * FROM get_cost_report_detail(:'P');
GRANT ALL ON cr TO PUBLIC;
SELECT t.eq('R07 cost report Actual = position Actual', (SELECT sum(actual) FROM cr), 7000.00);
SELECT t.eq('R07 cost report Commitment = position Commitment', (SELECT sum(commitment) FROM cr), 18000.00);
SELECT t.eq('R06 1101 row: budget / actual / commitment / remaining', (SELECT budget||'/'||actual||'/'||commitment||'/'||remaining FROM cr WHERE budget_code='1101'), '20000.00/4000.00/6000.00/10000.00');
SELECT t.eq('R06 default ETC = Remaining Budget', (SELECT etc FROM cr WHERE budget_code='1101'), 10000.00);
SELECT t.eq('R06 EFC = Actual + Commitment + ETC on every row', (SELECT count(*) FROM cr WHERE efc <> actual + commitment + etc), 0::bigint);
SELECT t.eq('R06 Variance = Budget − EFC on every row', (SELECT count(*) FROM cr WHERE variance <> budget - efc), 0::bigint);
SELECT t.eq('R06 % spent = Actual / Budget', (SELECT pct_spent FROM cr WHERE budget_code='1101'), 20.00);
SELECT t.eq('R06 payable per code', (SELECT payable FROM cr WHERE budget_code='2101'), 1000.00);
SELECT t.eq('R06 rows carry their GL account', (SELECT count(*) FROM cr WHERE budget_code IS NOT NULL AND gl_code IS NULL), 0::bigint);
INSERT INTO cost_report_etc(organization_id, project_id, budget_code, etc_amount) VALUES (:'O1', :'P', '1101', 15000);
SELECT t.eq('R06 editing ETC moves EFC and Variance', (SELECT efc||'/'||variance FROM get_cost_report_detail(:'P') WHERE budget_code='1101'), '25000.00/-5000.00');
DELETE FROM cost_report_etc WHERE project_id=:'P';
SELECT t.eq('R07 by GL account: same Actual / Commitment', (SELECT sum(actual)||'/'||sum(committed) FROM get_cost_by_gl_account(:'P')), '7000.00/18000.00');
SELECT t.eq('R07 by GL account: paid not doubled by the split contract rows', (SELECT sum(paid) FROM get_cost_by_gl_account(:'P')), 2000.00);

-- ---------------------------------------------------------------- B19: reconciliation
CREATE TEMP TABLE rec AS SELECT * FROM get_budget_reconciliation(:'P');
GRANT ALL ON rec TO PUBLIC;
SELECT t.eq('B19 USD line converted: 1,000 USD = 3,750 SAR', (SELECT project_estimate FROM rec WHERE budget_code='1002'), 3750.00);
SELECT t.eq('B19 estimate total 93,750', (SELECT sum(project_estimate) FROM rec), 93750.00);
SELECT t.eq('B19 committed = glossary Commitment (PO + invoice not doubled)', (SELECT sum(committed) FROM rec), 18000.00);
SELECT t.eq('B19 actuals = glossary Actual', (SELECT sum(actuals) FROM rec), 7000.00);
SELECT t.eq('B19 variance column = Remaining Budget', (SELECT sum(variance) FROM rec), 68750.00);
SELECT t.as_user(:'B');
SELECT t.eq('B19 other tenant gets nothing', (SELECT count(*) FROM get_budget_reconciliation('20000000-0000-0000-0000-000000000180')), 0::bigint);

-- ---------------------------------------------------------------- A09 / A12: funding & cash
SELECT t.as_user(:'A');
SELECT t.eq('A12 no funding recorded', (SELECT (get_funding_position(:'P','2026-10-28')->>'has_funding')::boolean), false);
SELECT t.eq('A09 payments without funding are flagged', (SELECT (get_funding_position(:'P','2026-10-28')->>'payments_exceed_funding')::boolean), true);
INSERT INTO project_funding(organization_id, project_id, funding_date, amount, status, source, kind) VALUES
 (:'O1', :'P', '2026-09-01', 50000, 'received', 'Financier', 'Investor Tranche'),
 (:'O1', :'P', '2026-11-01', 30000, 'expected', 'Financier', 'Investor Tranche');
INSERT INTO project_tax_payments(organization_id, project_id, payment_date, kind, amount) VALUES
 ('10000000-0000-0000-0000-000000000002', :'P', '2026-10-05', 'vat_paid', 300),
 (:'O1', :'P', '2026-10-06', 'vat_recovered', 100),
 (:'O1', :'P', '2026-10-07', 'wht_remitted', 50);
SELECT t.eq('A09 tax payment org forced to the project''s org', (SELECT count(*) FROM project_tax_payments WHERE project_id=:'P' AND organization_id=:'O1'), 3::bigint);
CREATE TEMP TABLE fp AS SELECT get_funding_position(:'P','2026-10-28') AS j;
GRANT ALL ON fp TO PUBLIC;
SELECT t.eq('A12 funding = received only', (SELECT (j->>'funding')::numeric FROM fp), 50000.00);
SELECT t.eq('A12 Cash = Funding − Paid − VAT paid + VAT recovered − WHT remitted', (SELECT (j->>'cash_balance')::numeric FROM fp), 50000.00 - 2000 - 300 + 100 - 50);
SELECT t.eq('A12 upcoming = approved instalment 4,000 + unpaid invoice 1,000', (SELECT (j->>'upcoming')::numeric FROM fp), 5000.00);
SELECT t.eq('A12 expected balance after upcoming', (SELECT (j->>'expected_balance')::numeric FROM fp), 47750.00 - 5000);
SELECT t.eq('A12 paid = payments register', (SELECT (j->>'paid')::numeric FROM fp), (SELECT sum(amount) FROM payments WHERE project_id=:'P'));
SELECT t.eq('A12 same Actual / Payable as the position', (SELECT (j->>'actual')||'/'||(j->>'payable') FROM fp), '7000.00/5000.00');
SELECT t.as_user(:'C');
SELECT t.denied('A09 viewer cannot record funding', $$INSERT INTO project_tax_payments(organization_id, project_id, payment_date, kind, amount) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000180','2026-10-01','vat_paid',1)$$);
SELECT t.as_user(:'B');
SELECT t.denied('A09 other tenant refused', $$SELECT get_funding_position('20000000-0000-0000-0000-000000000180')$$);
SELECT t.eq('A09 other tenant sees no tax rows', (SELECT count(*) FROM project_tax_payments WHERE project_id=:'P'), 0::bigint);

-- ---------------------------------------------------------------- A03: approved = frozen, un-approve reverses
SELECT t.as_user(:'A');
SELECT t.denied('A03 an approved instalment amount cannot be edited', $$UPDATE payroll SET payment_schedule = '[{"id":"m1","label":"Signing","dueDate":"2026-09-20","percent":0,"amount":5000,"status":"Approved"},{"id":"m2","label":"Final draft","dueDate":"2026-11-20","percent":0,"amount":5000,"status":"Pending"}]' WHERE id='b1800000-0000-0000-0000-00000000000a'$$);
SELECT t.denied('A03 an approved instalment cannot be renamed or re-dated', $$UPDATE payroll SET payment_schedule = jsonb_set(payment_schedule,'{0,dueDate}','"2026-12-31"') WHERE id='b1800000-0000-0000-0000-00000000000a'$$);
SELECT t.denied('A03 a paid instalment cannot be removed', $$UPDATE payroll SET payment_schedule = payment_schedule - 0 WHERE id='b1800000-0000-0000-0000-00000000000b'$$);
-- a pending instalment can still be edited (keeping the total)
UPDATE payroll SET payment_schedule = jsonb_set(payment_schedule,'{1,label}','"Final draft v2"') WHERE id=:'KA';
SELECT t.eq('a pending instalment stays editable', (SELECT label FROM payroll_instalments WHERE payroll_id=:'KA' AND milestone_id='m2'), 'Final draft v2');

-- ---------------------------------------------------------------- A04: cancel a contract
SELECT t.denied('A04 a member cannot cancel a contract', $$SELECT cancel_payroll_contract('b1800000-0000-0000-0000-00000000000a','script dropped')$$);
SELECT t.denied('A04 the cancellation stamp cannot be set by hand', $$UPDATE payroll SET contract_cancelled_at = now() WHERE id='b1800000-0000-0000-0000-00000000000a'$$);
SELECT t.as_user(:'D');
SELECT cancel_payroll_contract(:'KA','script dropped') IS NOT NULL AS c1 \gset
SELECT t.as_user(:'A');
SELECT t.eq('A04 after cancelling: Actual unchanged', (SELECT actual_sar FROM v_project_position WHERE project_id=:'P'), 7000.00);
SELECT t.eq('A04 after cancelling: Commitment drops by the unrequested 6,000', (SELECT committed_sar FROM v_project_position WHERE project_id=:'P'), 12000.00);
SELECT t.denied('A04 no new request on a cancelled contract', $$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,payroll_milestone_id,total_amount,requested_amount,status,requested_by) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000180','payroll_row','b1800000-0000-0000-0000-00000000000a','m2',10000,6000,'waiting_approval','00000000-0000-0000-0000-00000000000a')$$);
SELECT t.eq('A04 instalment rows know the contract is cancelled', (SELECT bool_and(contract_cancelled) FROM payroll_instalments WHERE payroll_id=:'KA'), true);

-- ---------------------------------------------------------------- A03: un-approve writes the reversal
SELECT t.as_user(:'D');
SELECT cancel_payment_request('c1800000-0000-0000-0000-0000000000a1','approved by mistake') IS NOT NULL AS u1 \gset
SELECT t.as_user(:'A');
SELECT t.eq('A03 un-approving writes one reversal for the ledger', (SELECT count(*)::text||'|'||max(amount)::text||'|'||max(budget_code) FROM accrual_reversals WHERE source_id=:'KA'), '1|4000.00|1101');
SELECT t.eq('A03 the reversal keeps the original approval date', (SELECT accrued_at IS NOT NULL FROM accrual_reversals WHERE source_id=:'KA'), true);
SELECT t.eq('A03 the instalment is back to Pending', (SELECT status FROM payroll_instalments WHERE payroll_id=:'KA' AND milestone_id='m1'), 'Pending');
SELECT t.eq('A03 Actual falls by the reversed instalment', (SELECT actual_sar FROM v_project_position WHERE project_id=:'P'), 3000.00);
SELECT t.denied('accrual_reversals cannot be written by the app', $$INSERT INTO accrual_reversals(organization_id,source_type,source_id,amount,net_amount) VALUES ('10000000-0000-0000-0000-000000000001','payroll_instalment','b1800000-0000-0000-0000-00000000000a',1,1)$$);
SELECT t.as_user(:'B');
SELECT t.eq('other tenant sees no reversals / instalments', (SELECT count(*) FROM accrual_reversals) + (SELECT count(*) FROM payroll_instalments WHERE project_id=:'P'), 0::bigint);

-- ---------------------------------------------------------------- payroll run lines in SAR
RESET ROLE;
SET session_replication_role = replica;
INSERT INTO payroll_runs(id,organization_id,project_id,label,kind,period_start,period_end,status,currency) VALUES
 ('e1800000-0000-0000-0000-000000000001',:'O1',:'P','Week 1','crew','2026-10-01','2026-10-07','approved','USD');
INSERT INTO payroll_run_items(id,payroll_run_id,organization_id,project_id,beneficiary_name,gross,net,currency,budget_code) VALUES
 ('f1800000-0000-0000-0000-0000000000a1','e1800000-0000-0000-0000-000000000001',:'O1',:'P','Grip',100,100,'USD','2101');
SET session_replication_role = origin;
SELECT t.as_user(:'D');
SELECT post_payroll_run('e1800000-0000-0000-0000-000000000001') IS NOT NULL AS pr1 \gset
SELECT t.eq('run line booked in SAR at the project rate', (SELECT total_amount::text||'|'||(SELECT currency FROM payment_requests q WHERE q.source_id = p.id) FROM payroll p WHERE ref_id LIKE 'PR-e1800000-%'), '375.00|SAR');
SELECT reverse_payroll_run('e1800000-0000-0000-0000-000000000001','wrong') IS NOT NULL AS rv \gset
SELECT t.eq('a reversed run leaves Commitment', (SELECT count(*) FROM v_ledger_transactions t JOIN payroll p ON p.id = t.source_id WHERE p.ref_id LIKE 'PR-e1800000-%'), 0::bigint);
RESET ROLE;
ROLLBACK;
