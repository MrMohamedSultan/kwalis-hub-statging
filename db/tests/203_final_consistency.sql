-- 203 — final consistency after 201: rebate_transactions, GSR and the
-- payments register count approved invoices only; the 7099 company-WHT
-- rows of decision 12 follow their contract in the GSR.
\set A  '00000000-0000-0000-0000-00000000000a'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P  '20000000-0000-0000-0000-000000000203'
\set PX '50000000-0000-0000-0000-000000000203'
\set R1 '80000000-0000-0000-0000-000000000203'
\set IA '60000000-0000-0000-0000-000000002031'
\set IP '60000000-0000-0000-0000-000000002032'
\set IR '60000000-0000-0000-0000-000000002033'
\set IC '60000000-0000-0000-0000-000000002034'

-- ---------------- fixture (as the server: statuses set directly) ----------------
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status) VALUES
 (:'P', :'A', 'Final consistency', 'FIN3', :'O1', 'SAR', 1, 'Production');
INSERT INTO project_members(project_id,user_id) VALUES (:'P', :'A') ON CONFLICT DO NOTHING;
INSERT INTO budget_lines(project_id,organization_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency) VALUES
 (:'P', :'O1', '1400', '1403', '1400', 'Lead actor', 1, 8000, 1, 'Package', 'SAR'),
 (:'P', :'O1', '2100', '2101', '2100', 'Camera', 1, 10000, 1, 'Package', 'SAR');
-- Exclusive contract: 7,000 net, gross 7,368.42 → 7099 carries 368.42 once approved
INSERT INTO payroll(id,name,kind,total_amount,net_payable,wht_amount,wht_percent,wht_treatment,budget_code,organization_id,project_id,spend_country,spend_city,payment_schedule)
VALUES (:'PX','Final Actor','cast',7368.42,7000,368.42,5,'exclusive','1403',:'O1',:'P','Saudi Arabia','Riyadh',
 '[{"id":"m1","label":"All","percent":100,"dueDate":"2026-10-01","status":"Pending"}]');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,payroll_milestone_id,source_label,total_amount,requested_amount,currency,status,approved_at)
VALUES (:'R1',:'O1',:'P','payroll_row',:'PX','m1','Final Actor',7000,7000,'SAR','approved','2026-10-02');
INSERT INTO invoices(id,description,budget_code,price,vat_amount,date,vendor_name,invoice_no,organization_id,project_id,spend_country,spend_city,approval_status) VALUES
 (:'IA','Approved rental','2101',1000,150,'2026-10-05','Cam Co','F-A',:'O1',:'P','Saudi Arabia','Riyadh','approved'),
 (:'IP','Pending rental', '2101', 500, 75,'2026-10-06','Cam Co','F-P',:'O1',:'P','Saudi Arabia','Riyadh','pending'),
 (:'IR','Rejected rental','2101', 300, 45,'2026-10-07','Cam Co','F-R',:'O1',:'P','Saudi Arabia','Riyadh','rejected'),
 (:'IC','Cancelled rental','2101',200, 30,'2026-10-08','Cam Co','F-C',:'O1',:'P','Saudi Arabia','Riyadh','cancelled');
-- a payment on the approved invoice, and one written by an import on the pending one
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,method) VALUES
 (:'O1',:'P','invoice',:'IA',1150,'2026-10-09','Transfer'),
 (:'O1',:'P','invoice',:'IP',100,'2026-10-09','Transfer');

SELECT t.as_user(:'A');
-- ================================================================ 1. rebate_transactions
SELECT t.eq('rebate: approved invoices only', (SELECT string_agg(source_id::text, ',') FROM rebate_transactions(:'P') WHERE source = 'invoice'), :'IA');
SELECT t.eq('rebate: the contract is still listed', (SELECT count(*) FROM rebate_transactions(:'P') WHERE source = 'payroll'), 1::bigint);

-- ================================================================ 2. get_gsr
SELECT t.eq('7099 company WHT is Actual in the ledger', (SELECT sum(amount) FROM v_ledger_transactions WHERE project_id = :'P' AND source_type = 'payroll_wht' AND entry_kind = 'actual'), 368.42);
SELECT t.eq('GSR total = ledger Actual (approved invoice + contract incl. 7099)', (SELECT sum(amount_excl_vat) FROM get_gsr(:'P')),
  (SELECT round(sum(amount), 2) FROM v_ledger_transactions WHERE project_id = :'P' AND entry_kind = 'actual'));
SELECT t.eq('GSR total = 1,000 + 7,368.42', (SELECT sum(amount_excl_vat) FROM get_gsr(:'P')), 8368.42);
SELECT t.eq('GSR: the 7099 row takes its contract''s place (nothing Unspecified)', (SELECT count(*) FROM get_gsr(:'P') WHERE city = 'Unspecified' OR country = 'Unspecified'), 0::bigint);
SELECT t.eq('GSR: contract + its 7099 WHT under Labour', (SELECT sum(amount_excl_vat) FROM get_gsr(:'P') WHERE spend_type = 'Labour'), 7368.42);

-- ================================================================ 3. get_gsr_payments
SELECT t.eq('GSR payments: only the approved invoice''s payment', (SELECT string_agg(source_id::text, ',') FROM get_gsr_payments(:'P') WHERE source_type = 'invoice'), :'IA');

-- ================================================================ 4. get_payments_register
SELECT t.eq('register: only the approved invoice''s payment', (SELECT string_agg(document_id::text, ',') FROM get_payments_register(:'P') WHERE document_type = 'invoice'), :'IA');
SELECT t.eq('register: its amount', (SELECT net FROM get_payments_register(:'P') WHERE document_id = :'IA'), 1150.00);
RESET ROLE;

-- tenant isolation unchanged
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
SELECT set_config('role', 'authenticated', false);
SELECT t.denied('outsider: rebate_transactions', format($$SELECT * FROM rebate_transactions(%L)$$, :'P'));
SELECT t.denied('outsider: get_gsr', format($$SELECT * FROM get_gsr(%L)$$, :'P'));
SELECT t.denied('outsider: get_gsr_payments', format($$SELECT * FROM get_gsr_payments(%L)$$, :'P'));
SELECT t.denied('outsider: get_payments_register', format($$SELECT * FROM get_payments_register(%L)$$, :'P'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
