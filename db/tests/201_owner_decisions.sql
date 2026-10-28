-- 201 — owner decisions: company-borne WHT on 7099 (B04 numbers), invoice
-- approval maker-checker, petty cash lock, budget regions, WHT table,
-- contracts bucket move + policy switch.
\set A  '00000000-0000-0000-0000-00000000000a'
\set B  '00000000-0000-0000-0000-00000000000b'
\set C  '00000000-0000-0000-0000-00000000000c'
\set D  '00000000-0000-0000-0000-00000000000d'
\set E  '00000000-0000-0000-0000-00000000000e'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P1 '20000000-0000-0000-0000-000000000001'
\set P2 '20000000-0000-0000-0000-000000000002'
\set P  '20000000-0000-0000-0000-000000000201'
\set PX '50000000-0000-0000-0000-000000000201'
\set PI '50000000-0000-0000-0000-000000000202'
\set R1 '80000000-0000-0000-0000-000000000201'
\set R2 '80000000-0000-0000-0000-000000000202'
\set I1 '60000000-0000-0000-0000-000000000201'
\set I2 '60000000-0000-0000-0000-000000000202'
\set I3 '60000000-0000-0000-0000-000000000203'
\set PO '70000000-0000-0000-0000-000000000201'
\set F1 '91000000-0000-0000-0000-000000000201'
\set RC '92000000-0000-0000-0000-000000000201'
SELECT id AS ap FROM gl_accounts WHERE code='9200' \gset
SELECT id AS whtacc FROM gl_accounts WHERE code='9210' \gset

-- ---------------- fixture: a fresh project with ONE budget line (no 7099 line) ----------------
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status) VALUES
 (:'P', :'A', 'Decisions test', 'DEC1', :'O1', 'USD', 3.75, 'Production');
INSERT INTO project_members(project_id,user_id) VALUES (:'P', :'A'), (:'P', :'C'), (:'P', :'D') ON CONFLICT DO NOTHING;
INSERT INTO budget_lines(project_id,organization_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency) VALUES
 (:'P', :'O1', '1400', '1403', '1400', 'Lead actor', 1, 8000, 1, 'Package', 'SAR'),
 (:'P', :'O1', '2100', '2101', '2100', 'Camera', 1, 10000, 1, 'Package', 'SAR');

-- ================================================================ 1. decision 12 (B04)
SELECT t.eq('split helper: B04 before approval', (SELECT line_commitment||'|'||wht_commitment||'|'||line_actual||'|'||wht_actual
  FROM payroll_company_wht_split(0, 7368.42, 7000, 'exclusive')), '7000.00|368.42|0.00|0.00');
SELECT t.eq('split helper: inclusive stays on the line', (SELECT line_commitment||'|'||wht_commitment
  FROM payroll_company_wht_split(0, 2000, 1900, 'inclusive')), '2000|0');
-- B04: 10 days x 700 = 7,000 net, WHT 5% Exclusive → gross 7,368.42; two instalments of 3,500 (on the net)
INSERT INTO payroll(id,name,kind,total_amount,net_payable,wht_amount,wht_percent,wht_treatment,budget_code,organization_id,project_id,payment_schedule)
VALUES (:'PX','B04 Actor','cast',7368.42,7000,368.42,5,'exclusive','1403',:'O1',:'P',
 '[{"id":"m1","label":"Half 1","percent":50,"dueDate":"2026-10-01","status":"Pending"},{"id":"m2","label":"Half 2","percent":50,"dueDate":"2026-10-15","status":"Pending"}]');
-- an Inclusive contract on 2101: 2,000 gross, 1,900 net — unchanged rule
INSERT INTO payroll(id,name,kind,total_amount,net_payable,wht_amount,wht_percent,wht_treatment,budget_code,organization_id,project_id,payment_schedule)
VALUES (:'PI','Inclusive crew','crew',2000,1900,100,5,'inclusive','2101',:'O1',:'P',
 '[{"id":"n1","label":"All","percent":100,"dueDate":"2026-10-01","status":"Pending"}]');

SELECT t.eq('instalments: net / gross / company WHT', (SELECT string_agg(amount||'/'||amount_gross||'/'||company_wht, ',' ORDER BY seq)
  FROM payroll_instalments WHERE payroll_id = :'PX'), '3500.00/3684.21/184.21,3500.00/3684.21/184.21');
SELECT t.eq('inclusive instalment: no company WHT', (SELECT company_wht FROM payroll_instalments WHERE payroll_id = :'PI'), 0.00);
SELECT t.eq('v_payroll_instalments: line share', (SELECT line_amount FROM v_payroll_instalments WHERE payroll_id = :'PX' AND milestone_id = 'm1'), 3500.00);

SELECT t.as_user(:'A');
SELECT t.eq('signed: contract line committed at the NET', (SELECT committed_sar FROM v_budget_code_position WHERE project_id = :'P' AND budget_code = '1403'), 7000.00);
SELECT t.eq('signed: 7099 committed the company-borne WHT', (SELECT committed_sar FROM v_budget_code_position WHERE project_id = :'P' AND budget_code = '7099'), 368.42);
SELECT t.eq('7099 is an unbudgeted code here', (SELECT line_count||'|'||budget_sar FROM v_budget_code_position WHERE project_id = :'P' AND budget_code = '7099'), '0|0');
SELECT t.eq('inclusive contract: whole value on its line, no 7099 row', (SELECT count(*) FROM v_ledger_transactions WHERE source_id = :'PI' AND source_type = 'payroll_wht'), 0::bigint);
SELECT t.eq('inclusive contract: line committed at the gross', (SELECT committed_sar FROM v_budget_code_position WHERE project_id = :'P' AND budget_code = '2101'), 2000.00);
RESET ROLE;

-- ledger initialised before the approvals (owner step of 182)
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('ledger initialised', ledger_backfill_project(:'P') >= 0, true);

-- m1 approved on Payment Approvals
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,payroll_milestone_id,source_label,total_amount,requested_amount,currency,status,approved_at)
VALUES (:'R1',:'O1',:'P','payroll_row',:'PX','m1','B04 Actor',7000,3500,'SAR','approved','2026-10-02');
SELECT t.as_user(:'A');
SELECT t.eq('B04 approved half: line Actual = 3,500.00', (SELECT actual_sar FROM v_budget_code_position WHERE project_id = :'P' AND budget_code = '1403'), 3500.00);
SELECT t.eq('B04 approved half: 7099 Actual = 184.21', (SELECT actual_sar FROM v_budget_code_position WHERE project_id = :'P' AND budget_code = '7099'), 184.21);
SELECT t.eq('B04 rest: line committed 3,500.00', (SELECT committed_sar FROM v_budget_code_position WHERE project_id = :'P' AND budget_code = '1403'), 3500.00);
SELECT t.eq('B04 rest: 7099 committed 184.21', (SELECT committed_sar FROM v_budget_code_position WHERE project_id = :'P' AND budget_code = '7099'), 184.21);
SELECT t.eq('contract value preserved: line + 7099 = 7,368.42', (SELECT sum(amount) FROM v_ledger_transactions WHERE source_id = :'PX' AND entry_kind IN ('actual','commitment')), 7368.42);
SELECT t.eq('7099 rows carry the WHT as wht_amount (project WHT unchanged)', (SELECT sum(wht_amount) FROM v_ledger_transactions WHERE source_id = :'PX'), 184.21);
SELECT t.eq('Cost Report shows 7099 (unbudgeted)', (SELECT budget||'|'||actual||'|'||commitment FROM get_cost_report_detail(:'P') WHERE budget_code = '7099'), '0.00|184.21|184.21');
SELECT t.eq('Cost Report: contract line at the net', (SELECT actual||'|'||commitment FROM get_cost_report_detail(:'P') WHERE budget_code = '1403'), '3500.00|3500.00');
SELECT t.eq('project totals unchanged by the split', (SELECT actual_sar||'|'||committed_sar FROM v_project_position WHERE project_id = :'P'), '3684.21|5684.21');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
-- ledger: Dr 1403 (net) + Dr 7099 (company WHT) / Cr payable (net) + Cr WHT payable
SELECT t.eq('journal: Dr contract line = net', (SELECT debit||'|'||budget_code FROM v_journal_lines WHERE event_key = 'instalment:' || :'PX' || ':m1' AND line_no = 1), '3500.00|1403');
SELECT t.eq('journal: Dr 7099 = company WHT', (SELECT debit||'|'||budget_code FROM v_journal_lines WHERE event_key = 'instalment:' || :'PX' || ':m1' AND line_no = 4), '184.21|7099');
SELECT t.eq('journal: Cr payable = net', (SELECT credit FROM v_journal_lines WHERE event_key = 'instalment:' || :'PX' || ':m1' AND gl_account_id = :'ap'), 3500.00);
SELECT t.eq('journal: Cr WHT payable = company WHT', (SELECT credit FROM v_journal_lines WHERE event_key = 'instalment:' || :'PX' || ':m1' AND gl_account_id = :'whtacc'), 184.21);
SELECT t.eq('journal: debits = credits', (SELECT sum(debit) = sum(credit) FROM v_journal_lines WHERE project_id = :'P'), true);
SELECT t.eq('engine posted the 7099 line', (SELECT sum(l.debit) FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
  WHERE e.event_key = 'instalment:' || :'PX' || ':m1' AND l.budget_code = '7099'), 184.21);
SELECT t.eq('phases match after the approval', ledger_phases_match(:'P'), true);
-- the whole contract approved
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,payroll_milestone_id,source_label,total_amount,requested_amount,currency,status,approved_at)
VALUES (:'R2',:'O1',:'P','payroll_row',:'PX','m2','B04 Actor',7000,3500,'SAR','approved','2026-10-16');
SELECT t.as_user(:'A');
SELECT t.eq('B04 fully approved: 1403 Actual 7,000.00 / 7099 Actual 368.42',
  (SELECT string_agg(budget_code||'='||actual_sar||'/'||committed_sar, ',' ORDER BY budget_code) FROM v_budget_code_position
    WHERE project_id = :'P' AND budget_code IN ('1403','7099')), '1403=7000.00/0,7099=368.42/0');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('7099 journal total = 368.42', (SELECT sum(debit) FROM v_journal_lines WHERE project_id = :'P' AND budget_code = '7099'), 368.42);
SELECT t.eq('phases match', ledger_phases_match(:'P'), true);
-- switching the contract to Inclusive puts the WHT back inside the line (resync rule)
UPDATE payroll SET wht_treatment = 'inclusive' WHERE id = :'PI';
SELECT t.eq('treatment change re-syncs the instalments', (SELECT company_wht FROM payroll_instalments WHERE payroll_id = :'PI'), 0.00);

-- ================================================================ 2. invoice approval
SELECT t.as_user(:'A');
INSERT INTO invoices(id,description,budget_code,price,vat_amount,date,vendor_name,invoice_no,organization_id,project_id)
VALUES (:'I1','Camera rental','2101',1000,150,'2026-10-05','Cam Co','INV-201',:'O1',:'P');
SELECT t.eq('a new invoice is pending, recorded by its creator', (SELECT approval_status||'|'||(created_by = :'A'::uuid)::text FROM invoices WHERE id = :'I1'), 'pending|true');
SELECT t.eq('pending invoice = Commitment', (SELECT entry_kind FROM v_ledger_transactions WHERE source_id = :'I1'), 'commitment');
SELECT t.eq('pending invoice: no journal entry', (SELECT count(*) FROM v_journal_lines WHERE source_id = :'I1'), 0::bigint);
SELECT t.denied('a new invoice cannot be created approved', format($$INSERT INTO invoices(description,budget_code,price,date,organization_id,project_id,approval_status) VALUES ('x','2101',1,'2026-10-05',%L,%L,'approved')$$, :'O1', :'P'));
SELECT t.denied('maker-checker: the creator cannot approve', format($$SELECT approve_invoice(%L)$$, :'I1'));
SELECT t.denied('maker-checker: direct update by the creator refused too', format($$UPDATE invoices SET approval_status = 'approved' WHERE id = %L$$, :'I1'));
SELECT t.denied('payment request on a pending invoice refused', format($$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status) VALUES (%L,%L,'invoice',%L,'Cam Co',1150,1150,'SAR','waiting_approval')$$, :'O1', :'P', :'I1'));
SELECT t.denied('payment on a pending invoice refused', format($$INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date) VALUES (%L,%L,'invoice',%L,100,'2026-10-06')$$, :'O1', :'P', :'I1'));
SELECT t.as_user(:'C');
SELECT t.denied('no approval chain: a plain member cannot approve', format($$SELECT approve_invoice(%L)$$, :'I1'));
SELECT t.as_user(:'D');
SELECT approve_invoice(:'I1');
SELECT t.eq('org admin approved it, stamped by the database', (SELECT approval_status||'|'||(approved_by = :'D'::uuid)::text||'|'||(approved_at IS NOT NULL)::text FROM invoices WHERE id = :'I1'), 'approved|true|true');
SELECT t.as_user(:'A');
SELECT t.eq('approved invoice = Actual', (SELECT entry_kind FROM v_ledger_transactions WHERE source_id = :'I1'), 'actual');
SELECT t.denied('approved: amount locked', format($$UPDATE invoices SET price = 2000 WHERE id = %L$$, :'I1'));
SELECT t.denied('approved: vendor locked', format($$UPDATE invoices SET vendor_name = 'Other' WHERE id = %L$$, :'I1'));
SELECT t.denied('approved: budget code locked', format($$UPDATE invoices SET budget_code = '1403' WHERE id = %L$$, :'I1'));
UPDATE invoices SET description = 'Camera rental (week 1)' WHERE id = :'I1';
SELECT t.eq('approved: a description fix is allowed', (SELECT description FROM invoices WHERE id = :'I1'), 'Camera rental (week 1)');
UPDATE invoices SET approved_by = :'A' WHERE id = :'I1';
SELECT t.eq('approved: stamps restored by the database', (SELECT approved_by FROM invoices WHERE id = :'I1'), :'D'::uuid);
SELECT t.denied('approved: cannot go back to pending', format($$UPDATE invoices SET approval_status = 'pending' WHERE id = %L$$, :'I1'));
SELECT t.denied('X08: an approved invoice cannot be deleted', format($$DELETE FROM invoices WHERE id = %L$$, :'I1'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('approval posts the accrual', (SELECT sum(debit) FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id WHERE e.source_id = :'I1'), 1150.00);
SELECT t.eq('phases match after invoice approval', ledger_phases_match(:'P'), true);
SELECT t.as_user(:'A');
SELECT t.denied('cancel needs an approver', format($$SELECT cancel_invoice(%L, 'duplicate')$$, :'I1'));
SELECT t.as_user(:'D');
SELECT t.denied('cancel needs a reason', format($$SELECT cancel_invoice(%L, '  ')$$, :'I1'));
SELECT cancel_invoice(:'I1', 'Duplicate of INV-200');
SELECT t.eq('X08: recorded cancellation', (SELECT approval_status||'|'||cancellation_reason||'|'||(cancelled_by = :'D'::uuid)::text FROM invoices WHERE id = :'I1'), 'cancelled|Duplicate of INV-200|true');
SELECT t.eq('cancelled invoice is neither Actual nor Commitment', (SELECT count(*) FROM v_ledger_transactions WHERE source_id = :'I1'), 0::bigint);
SELECT t.denied('cancelled is final', format($$UPDATE invoices SET approval_status = 'approved' WHERE id = %L$$, :'I1'));
SELECT t.denied('a cancelled invoice cannot be deleted either', format($$DELETE FROM invoices WHERE id = %L$$, :'I1'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('cancellation reverses the accrual (net zero)', (SELECT sum(l.debit) - sum(l.credit) FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
  WHERE e.source_id = :'I1' AND l.gl_account_id = :'ap'), 0.00);
SELECT t.eq('a reversing entry exists', (SELECT count(*) FROM ledger_entries WHERE source_id = :'I1' AND reverses_entry_id IS NOT NULL), 1::bigint);
SELECT t.eq('phases match after cancellation', ledger_phases_match(:'P'), true);

-- reject → correct → resubmit → approve; PO commitment follows
INSERT INTO purchase_orders(id,organization_id,project_id,vendor_name,amount,budget_code,status,po_number,date)
VALUES (:'PO',:'O1',:'P','Cam Co',5000,'2101','approved','DEC1-PO-1','2026-10-01');
SELECT t.as_user(:'A');
INSERT INTO invoices(id,description,budget_code,price,date,vendor_name,invoice_no,organization_id,project_id,purchase_order_id)
VALUES (:'I2','Camera on PO','2101',2000,'2026-10-07','Cam Co','INV-202',:'O1',:'P',:'PO');
SELECT t.eq('PO net of a pending invoice + the invoice commitment = PO value',
  (SELECT sum(amount) FROM v_ledger_transactions WHERE source_id IN (:'PO', :'I2') AND entry_kind = 'commitment'), 5000.00);
SELECT t.as_user(:'D');
SELECT t.denied('reject needs a reason', format($$SELECT reject_invoice(%L, '')$$, :'I2'));
SELECT reject_invoice(:'I2', 'Wrong amount');
SELECT t.eq('rejected: stamped', (SELECT approval_status||'|'||rejection_reason||'|'||(rejected_by = :'D'::uuid)::text FROM invoices WHERE id = :'I2'), 'rejected|Wrong amount|true');
SELECT t.eq('rejected invoice: PO is a full commitment again', (SELECT amount FROM v_ledger_transactions WHERE source_id = :'PO'), 5000.00);
SELECT t.eq('rejected invoice is not listed', (SELECT count(*) FROM v_ledger_transactions WHERE source_id = :'I2'), 0::bigint);
SELECT t.as_user(:'A');
UPDATE invoices SET price = 1800, approval_status = 'pending' WHERE id = :'I2';
SELECT t.eq('corrected and resubmitted', (SELECT approval_status||'|'||price FROM invoices WHERE id = :'I2'), 'pending|1800');
SELECT t.as_user(:'D');
SELECT approve_invoice(:'I2');
SELECT t.as_user(:'A');
SELECT t.eq('approved on the PO: PO net of it', (SELECT amount FROM v_ledger_transactions WHERE source_id = :'PO'), 3200.00);
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date) VALUES (:'O1',:'P','invoice',:'I2',500,'2026-10-08');
SELECT t.eq('payment on an approved invoice accepted', (SELECT count(*) FROM payments WHERE source_id = :'I2'), 1::bigint);
SELECT t.as_user(:'D');
SELECT t.denied('an invoice with payments cannot be cancelled', format($$SELECT cancel_invoice(%L, 'oops')$$, :'I2'));

-- approval chain: a person matching a level approves (not only org admins)
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO payment_approval_levels(organization_id, level_no, label, min_amount_sar, approver_kind, role_id)
VALUES (:'O1', 1, 'Editors', 0, 'role', '30000000-0000-0000-0000-000000000001');
SELECT t.as_user(:'C');
INSERT INTO invoices(id,description,budget_code,price,date,vendor_name,invoice_no,organization_id,project_id)
VALUES (:'I3','Grip truck','2101',700,'2026-10-09','Grip Co','INV-203',:'O1',:'P');
SELECT t.as_user(:'C');
SELECT t.denied('chain: a member outside the levels cannot approve', format($$SELECT approve_invoice(%L)$$, :'I3'));
SELECT t.as_user(:'A');
SELECT approve_invoice(:'I3');
SELECT t.eq('chain: a level approver approved it', (SELECT approval_status||'|'||(approved_by = :'A'::uuid)::text FROM invoices WHERE id = :'I3'), 'approved|true');
SELECT t.eq('can_approve_invoice answers for the caller', can_approve_invoice(:'P'), true);
SELECT t.as_user(:'B');
SELECT t.eq('another tenant is never an approver here', can_approve_invoice(:'P'), false);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
DELETE FROM payment_approval_levels WHERE organization_id = :'O1' AND level_no = 1 AND label = 'Editors';
SELECT t.as_user(:'A');
SELECT t.eq('funding: upcoming = approved unpaid invoices only', ((get_funding_position(:'P'))->>'upcoming_invoices')::numeric, 1300.00 + 700.00);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('phases match after the invoice scenarios', ledger_phases_match(:'P'), true);

-- ================================================================ 2b. petty cash receipts
INSERT INTO cash_advances(id,holder,total_advance,organization_id,project_id,status,approved_at) VALUES (:'F1','Runner',2000,:'O1',:'P','open','2026-10-01');
SELECT t.as_user(:'A');
SELECT t.denied('a receipt cannot be logged approved', format($$INSERT INTO cash_advance_receipts(advance_id,recipient,amount,date,organization_id,project_id,budget_code,status) VALUES (%L,'Runner',10,'2026-10-02',%L,%L,'2101','approved')$$, :'F1', :'O1', :'P'));
INSERT INTO cash_advance_receipts(id,advance_id,recipient,amount,date,organization_id,project_id,budget_code,status,vendor,submitted_by)
VALUES (:'RC',:'F1','Runner',300,'2026-10-02',:'O1',:'P','2101','pending','Shop',:'A');
SELECT t.as_user(:'D');
UPDATE cash_advance_receipts SET status = 'approved', approved_at = '2020-01-01' WHERE id = :'RC';
SELECT t.eq('receipt approval stamped by the database', (SELECT (approved_by = :'D'::uuid)::text||'|'||(approved_at > '2026-01-01')::text FROM cash_advance_receipts WHERE id = :'RC'), 'true|true');
SELECT t.as_user(:'A');
SELECT t.denied('approved receipt: amount locked', format($$UPDATE cash_advance_receipts SET amount = 500 WHERE id = %L$$, :'RC'));
SELECT t.denied('approved receipt: cannot go back to pending', format($$UPDATE cash_advance_receipts SET status = 'pending' WHERE id = %L$$, :'RC'));
SELECT t.denied('approved receipt: no hard delete', format($$DELETE FROM cash_advance_receipts WHERE id = %L$$, :'RC'));
SELECT t.denied('approved receipt: cancelled by an admin or its approver only', format($$SELECT cancel_petty_receipt(%L, 'wrong float')$$, :'RC'));
SELECT t.as_user(:'D');
SELECT cancel_petty_receipt(:'RC', 'Logged on the wrong float');
SELECT t.eq('receipt cancellation recorded', (SELECT status||'|'||cancellation_reason FROM cash_advance_receipts WHERE id = :'RC'), 'cancelled|Logged on the wrong float');
SELECT t.eq('cancelled receipt is not Actual', (SELECT count(*) FROM v_ledger_transactions WHERE source_id = :'RC'), 0::bigint);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('phases match after the receipt cancellation', ledger_phases_match(:'P'), true);

-- ================================================================ 2c. review fixes (sec_review2)
\set I4 '60000000-0000-0000-0000-000000000204'
\set I5 '60000000-0000-0000-0000-000000000205'
\set I6 '60000000-0000-0000-0000-000000000206'
\set I7 '60000000-0000-0000-0000-000000000207'
\set I8 '60000000-0000-0000-0000-000000000208'
\set I9 '60000000-0000-0000-0000-000000000209'
\set RD '92000000-0000-0000-0000-000000000202'
\set RL '92000000-0000-0000-0000-000000000203'
\set RP '92000000-0000-0000-0000-000000000204'
-- #1 the approver cannot change the invoice and approve it in one statement,
--    nor approve figures they changed themselves
SELECT t.as_user(:'A');
INSERT INTO invoices(id,description,budget_code,price,date,vendor_name,invoice_no,organization_id,project_id)
VALUES (:'I4','Lights','2101',400,'2026-10-10','Light Co','INV-204',:'O1',:'P');
SELECT t.eq('#1 creator is the last editor', (SELECT last_edited_by FROM invoices WHERE id = :'I4'), :'A'::uuid);
SELECT t.as_user(:'D');
SELECT t.denied('#1 approve + change the price in one UPDATE refused', format($$UPDATE invoices SET approval_status = 'approved', price = 4000 WHERE id = %L$$, :'I4'));
SELECT t.denied('#1 approve + change the vendor in one UPDATE refused', format($$UPDATE invoices SET approval_status = 'approved', vendor_name = 'Mine' WHERE id = %L$$, :'I4'));
SELECT t.denied('#1 approve + move to another project refused', format($$UPDATE invoices SET approval_status = 'approved', project_id = %L WHERE id = %L$$, :'P1', :'I4'));
UPDATE invoices SET price = 450 WHERE id = :'I4';
SELECT t.eq('#1 an approver who edits a pending invoice becomes its last editor', (SELECT last_edited_by FROM invoices WHERE id = :'I4'), :'D'::uuid);
SELECT t.denied('#1 ... and cannot approve it', format($$SELECT approve_invoice(%L)$$, :'I4'));
SELECT t.denied('#1 ... nor reject it', format($$SELECT reject_invoice(%L, 'no')$$, :'I4'));
UPDATE invoices SET last_edited_by = :'A' WHERE id = :'I4';
SELECT t.eq('#1 last_edited_by is written by the database only', (SELECT last_edited_by FROM invoices WHERE id = :'I4'), :'D'::uuid);
UPDATE invoices SET invoice_url = :'P' || '/invoices/' || :'I4' || '/scan.pdf' WHERE id = :'I4';
SELECT t.eq('#1 an attachment is not an edit', (SELECT last_edited_by FROM invoices WHERE id = :'I4'), :'D'::uuid);
SELECT t.as_user(:'E');
SELECT approve_invoice(:'I4');
SELECT t.eq('#1 legitimate: a third user approves the invoice as recorded', (SELECT approval_status||'|'||price||'|'||(approved_by = :'E'::uuid)::text FROM invoices WHERE id = :'I4'), 'approved|450|true');

-- #3 the lock covers date, GL, PO, VAT / WHT treatment, invoice no and the Film Commission inputs
SELECT t.as_user(:'A');
SELECT t.denied('#3 approved: date locked', format($$UPDATE invoices SET date = '2026-01-01' WHERE id = %L$$, :'I4'));
SELECT t.denied('#3 approved: GL account locked', format($$UPDATE invoices SET gl_account_id = %L WHERE id = %L$$, :'ap', :'I4'));
SELECT t.denied('#3 approved: purchase order locked', format($$UPDATE invoices SET purchase_order_id = %L WHERE id = %L$$, :'PO', :'I4'));
SELECT t.denied('#3 approved: VAT treatment locked', format($$UPDATE invoices SET vat_treatment = 'exempt', vatable = true WHERE id = %L$$, :'I4'));
SELECT t.denied('#3 approved: WHT treatment locked', format($$UPDATE invoices SET wht_treatment = 'exclusive' WHERE id = %L$$, :'I4'));
SELECT t.denied('#3 approved: invoice number locked', format($$UPDATE invoices SET invoice_no = 'INV-999' WHERE id = %L$$, :'I4'));
SELECT t.denied('#3 approved: rebate eligibility locked', format($$UPDATE invoices SET rebate_eligible = true WHERE id = %L$$, :'I4'));
SELECT t.denied('#3 approved: spend city locked', format($$UPDATE invoices SET spend_city = 'Riyadh' WHERE id = %L$$, :'I4'));
SELECT t.denied('#3 approved: service inside KSA locked', format($$UPDATE invoices SET service_inside_ksa = false WHERE id = %L$$, :'I4'));
SELECT t.denied('#3 approved: non-Saudi vendor flag locked', format($$UPDATE invoices SET is_non_saudi_vendor = true WHERE id = %L$$, :'I4'));
SELECT t.denied('#3 approved: service period locked', format($$UPDATE invoices SET service_period_from = '2026-09-01' WHERE id = %L$$, :'I4'));
SELECT t.denied('#3 approved: beneficiary locked', format($$UPDATE invoices SET beneficiary_id = %L WHERE id = %L$$, :'PX', :'I4'));
SELECT (department IS NULL)::text||'|'||(rebate_eligible IS NULL)::text||'|'||(service_inside_ksa IS NULL)::text AS before_nulls FROM invoices WHERE id = :'I4' \gset
-- the app saves the whole row back: unchanged values in the app's own form ('' / false / 0 for NULL) pass
UPDATE invoices SET description = 'Lights (2 days)', department = COALESCE(department, ''), rebate_eligible = COALESCE(rebate_eligible, false),
       service_inside_ksa = COALESCE(service_inside_ksa, true), is_related_party = COALESCE(is_related_party, false),
       wht_percent = COALESCE(wht_percent, 0), vat_treatment = COALESCE(vat_treatment, CASE WHEN vatable THEN 'standard' ELSE 'exempt' END)
 WHERE id = :'I4';
SELECT t.eq('#3 legitimate: a description fix with the app''s round trip is accepted', (SELECT description FROM invoices WHERE id = :'I4'), 'Lights (2 days)');
SELECT t.eq('#3 ... and the locked columns keep their stored values', (SELECT (department IS NULL)::text||'|'||(rebate_eligible IS NULL)::text||'|'||(service_inside_ksa IS NULL)::text FROM invoices WHERE id = :'I4'), :'before_nulls');

-- #2 an approved invoice holding more than 2 decimals (legacy data) stays usable
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SET session_replication_role = replica;
INSERT INTO invoices(id,description,budget_code,price,vat_amount,date,vendor_name,invoice_no,organization_id,project_id,approval_status,created_by)
VALUES (:'I5','Legacy','2101',100.005,15.0007,'2026-10-11','Old Co','INV-205',:'O1',:'P','approved',:'A');
SET session_replication_role = origin;
SELECT t.as_user(:'A');
UPDATE invoices SET description = 'Legacy (noted)', invoice_url = :'P' || '/invoices/legacy.pdf' WHERE id = :'I5';
SELECT t.eq('#2 legitimate: attachment / description on a >2-decimal approved invoice', (SELECT description||'|'||price FROM invoices WHERE id = :'I5'), 'Legacy (noted)|100.005');
SELECT t.denied('#2 its amount is still locked', format($$UPDATE invoices SET price = 101 WHERE id = %L$$, :'I5'));
SELECT t.as_user(:'D');
SELECT cancel_invoice(:'I5', 'Duplicate legacy row');
SELECT t.eq('#2 legitimate: cancel_invoice works on it', (SELECT approval_status||'|'||price FROM invoices WHERE id = :'I5'), 'cancelled|100.005');

-- #11 delete + restore from the trash keeps the original creator; the restorer cannot approve either
SELECT t.as_user(:'A');
INSERT INTO invoices(id,description,budget_code,price,date,vendor_name,invoice_no,organization_id,project_id)
VALUES (:'I6','Dolly','2101',300,'2026-10-12','Grip Co','INV-206',:'O1',:'P');
SELECT t.as_user(:'D');
DELETE FROM invoices WHERE id = :'I6';
SELECT restore_trash_item((SELECT id FROM trash_items WHERE record_id = :'I6' AND restored_at IS NULL)) IS NOT NULL AS restored \gset
SELECT t.eq('#11 restored invoice keeps its creator, restorer is last editor', (SELECT approval_status||'|'||(created_by = :'A'::uuid)::text||'|'||(last_edited_by = :'D'::uuid)::text FROM invoices WHERE id = :'I6'), 'pending|true|true');
SELECT t.denied('#11 the restorer cannot approve it', format($$SELECT approve_invoice(%L)$$, :'I6'));
SELECT t.as_user(:'A');
SELECT t.denied('#11 the original creator cannot approve it after the restore', format($$SELECT approve_invoice(%L)$$, :'I6'));
SELECT t.as_user(:'E');
SELECT approve_invoice(:'I6');
SELECT t.eq('#11 legitimate: someone else approves the restored invoice', (SELECT approval_status FROM invoices WHERE id = :'I6'), 'approved');

-- #12 a chain level applies only from its minimum amount
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO payment_approval_levels(organization_id, level_no, label, min_amount_sar, approver_kind, role_id)
VALUES (:'O1', 1, 'Big spend', 10000, 'role', '30000000-0000-0000-0000-000000000001');
SELECT t.as_user(:'C');
INSERT INTO invoices(id,description,budget_code,price,date,vendor_name,invoice_no,organization_id,project_id)
VALUES (:'I7','Small','2101',700,'2026-10-13','Grip Co','INV-207',:'O1',:'P'),
       (:'I8','Large','2101',12000,'2026-10-13','Grip Co','INV-208',:'O1',:'P');
SELECT t.as_user(:'A');
SELECT t.denied('#12 a level from 10,000 SAR does not cover a 700 SAR invoice', format($$SELECT approve_invoice(%L)$$, :'I7'));
SELECT approve_invoice(:'I8');
SELECT t.eq('#12 legitimate: the level approver approves the 12,000 SAR invoice', (SELECT approval_status FROM invoices WHERE id = :'I8'), 'approved');
SELECT t.eq('#12 can_approve_invoice by amount', can_approve_invoice(:'P', 700)::text||'|'||can_approve_invoice(:'P', 12000)::text, 'false|true');
SELECT t.as_user(:'D');
SELECT approve_invoice(:'I7');
SELECT t.eq('#12 legitimate: below every level an org admin approves', (SELECT approval_status FROM invoices WHERE id = :'I7'), 'approved');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
DELETE FROM payment_approval_levels WHERE organization_id = :'O1' AND label = 'Big spend';

-- #13 the delete guard does not depend on the caller seeing the project
SELECT t.eq('#13 delete guard uses the DEFINER project_exists', position('project_exists' in pg_get_functiondef('public.guard_invoice_delete'::regproc)) > 0
  AND position('project_exists' in pg_get_functiondef('public.guard_petty_receipt_delete'::regproc)) > 0, true);

-- #8 petty cash receipts: maker-checker and an approver role
SELECT t.as_user(:'D');
INSERT INTO cash_advance_receipts(id,advance_id,recipient,amount,date,organization_id,project_id,budget_code,status,vendor)
VALUES (:'RD',:'F1','Runner',120,'2026-10-03',:'O1',:'P','2101','pending','Kiosk');
SELECT t.eq('#8 receipt creator stamped by the database', (SELECT created_by FROM cash_advance_receipts WHERE id = :'RD'), :'D'::uuid);
SELECT t.denied('#8 the person who logged a receipt cannot approve it (even an org admin)', format($$UPDATE cash_advance_receipts SET status = 'approved' WHERE id = %L$$, :'RD'));
SELECT t.denied('#8 created_by cannot be rewritten', format($$UPDATE cash_advance_receipts SET created_by = %L WHERE id = %L$$, :'C', :'RD'));
SELECT t.as_user(:'C');
SELECT t.denied('#8 a member without the petty cash approval role cannot approve', format($$UPDATE cash_advance_receipts SET status = 'approved' WHERE id = %L$$, :'RD'));
SELECT t.as_user(:'A');
SELECT t.denied('#8 A (no petty-cash edit permission yet) cannot approve', format($$UPDATE cash_advance_receipts SET status = 'approved' WHERE id = %L$$, :'RD'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO role_permissions(role_id,module_key,can_view,can_edit) VALUES ('30000000-0000-0000-0000-000000000001','petty-cash',true,true)
  ON CONFLICT DO NOTHING;
UPDATE role_permissions SET can_edit = true WHERE role_id = '30000000-0000-0000-0000-000000000001' AND module_key = 'petty-cash';
SELECT t.as_user(:'A');
SELECT t.denied('#8 approve + change the amount in one UPDATE refused', format($$UPDATE cash_advance_receipts SET status = 'approved', amount = 999 WHERE id = %L$$, :'RD'));
UPDATE cash_advance_receipts SET status = 'approved' WHERE id = :'RD';
SELECT t.eq('#8 legitimate: a petty cash approver approves someone else''s receipt', (SELECT status||'|'||(approved_by = :'A'::uuid)::text FROM cash_advance_receipts WHERE id = :'RD'), 'approved|true');
-- a receipt logged before 201 (created_by NULL): submitted_by stands in
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SET session_replication_role = replica;
INSERT INTO cash_advance_receipts(id,advance_id,recipient,amount,date,organization_id,project_id,budget_code,status,vendor,submitted_by,currency)
VALUES (:'RL',:'F1','Runner',80,'2026-10-04',:'O1',:'P','2101','pending','Shop',:'A','SAR'),
       (:'RP',:'F1','Runner',40.004,'2026-09-04',:'O1',:'P','2101','approved','Shop',:'A','SAR');
SET session_replication_role = origin;
SELECT t.as_user(:'A');
SELECT t.denied('#8 legacy receipt: its submitter cannot approve it', format($$UPDATE cash_advance_receipts SET status = 'approved' WHERE id = %L$$, :'RL'));
SELECT t.as_user(:'D');
UPDATE cash_advance_receipts SET status = 'approved' WHERE id = :'RL';
SELECT t.eq('#8 legitimate: someone else approves the legacy receipt', (SELECT status FROM cash_advance_receipts WHERE id = :'RL'), 'approved');
-- #3 receipts: GL account and department locked once approved; #2 legacy decimals do not block
SELECT t.denied('#3 approved receipt: GL account locked', format($$UPDATE cash_advance_receipts SET gl_account_id = %L WHERE id = %L$$, :'ap', :'RD'));
SELECT t.denied('#3 approved receipt: department locked', format($$UPDATE cash_advance_receipts SET department = 'Art' WHERE id = %L$$, :'RD'));
UPDATE cash_advance_receipts SET notes = 'checked' WHERE id = :'RP';
SELECT t.eq('#2 legitimate: a note on a legacy approved receipt (amount stays as stored)', (SELECT notes||'|'||amount FROM cash_advance_receipts WHERE id = :'RP'), 'checked|40.004');
SELECT t.denied('#2 ... its amount is still locked', format($$UPDATE cash_advance_receipts SET amount = 41 WHERE id = %L$$, :'RP'));
-- #9 a receipt with a payment cannot be cancelled
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date) VALUES (:'O1',:'P','cash_advance_receipt',:'RL',80,'2026-10-05');
SELECT t.as_user(:'D');
SELECT t.denied('#9 a receipt with payments cannot be cancelled', format($$SELECT cancel_petty_receipt(%L, 'oops')$$, :'RL'));
SELECT cancel_petty_receipt(:'RD', 'Wrong float');
SELECT t.eq('#9 legitimate: a receipt without payments is cancelled', (SELECT status FROM cash_advance_receipts WHERE id = :'RD'), 'cancelled');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
DELETE FROM role_permissions WHERE role_id = '30000000-0000-0000-0000-000000000001' AND module_key = 'petty-cash';
SELECT t.eq('phases match after the review-fix scenarios', ledger_phases_match(:'P'), true);

-- ================================================================ 3. regions
SELECT t.eq('region normalise: city', ksa_region_normalize('Jeddah'), 'Makkah');
SELECT t.eq('region normalise: Arabic', ksa_region_normalize('الرياض'), 'Riyadh');
SELECT t.eq('region normalise: AlUla', ksa_region_normalize('AlUla'), 'Madinah');
SELECT t.eq('region normalise: unknown', ksa_region_normalize('Paris'), NULL::text);
SELECT t.eq('13 regions', array_length(ksa_region_list(), 1), 13);
UPDATE budget_lines SET region = 'jeddah' WHERE project_id = :'P' AND main_code = '2101';
SELECT t.eq('budget line region stored normalised', (SELECT region FROM budget_lines WHERE project_id = :'P' AND main_code = '2101'), 'Makkah');
SELECT t.denied('unknown region refused', format($$UPDATE budget_lines SET region = 'Atlantis' WHERE project_id = %L$$, :'P'));
SELECT t.eq('v_active_budget_lines exposes the region', (SELECT region FROM v_active_budget_lines WHERE project_id = :'P' AND main_code = '2101'), 'Makkah');
SELECT t.as_user(:'C');
SELECT t.denied('default region: plain member refused', format($$SELECT set_project_default_region(%L, 'Riyadh')$$, :'P'));
SELECT t.as_user(:'D');
SELECT t.eq('default region set by an admin', set_project_default_region(:'P', 'riyadh'), 'Riyadh');
SELECT t.denied('default region: unknown name refused', format($$SELECT set_project_default_region(%L, 'Mars')$$, :'P'));
SELECT t.as_user(:'A');
SELECT t.eq('estimate by region (line region, else project default)',
  (SELECT string_agg(region||'='||estimate_sar, ',' ORDER BY region) FROM get_budget_by_region(:'P')), 'Makkah=10000.00,Riyadh=8000.00');
SELECT t.eq('actual by region follows the line of the code (no spend city)',
  (SELECT actual_sar FROM get_budget_by_region(:'P') WHERE region = 'Makkah') >= 2500, true);
SELECT t.eq('budget by region: actual of other tenants never shown', (SELECT count(*) FROM get_budget_by_region(:'P') WHERE region = 'outside_ksa'), 0::bigint);
SELECT t.as_user(:'B');
SELECT t.denied('budget by region: other tenant refused', format($$SELECT * FROM get_budget_by_region(%L)$$, :'P'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
-- a budget draft keeps the regions (create_budget_draft copies the active version)
INSERT INTO budget_versions(project_id,organization_id,version_no,version_name,status)
SELECT :'P', :'O1', 1, 'v1', 'active' WHERE NOT EXISTS (SELECT 1 FROM budget_versions WHERE project_id = :'P' AND status = 'active');
UPDATE budget_lines SET version_id = (SELECT id FROM budget_versions WHERE project_id = :'P' AND status = 'active') WHERE project_id = :'P';
SELECT t.as_user(:'D');
SELECT create_budget_draft(:'P', 'v2') AS draft_id \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('draft copy keeps the region', (SELECT region FROM budget_lines WHERE version_id = :'draft_id' AND main_code = '2101'), 'Makkah');

-- ================================================================ 4. WHT table
SELECT t.eq('Saudi WHT table seeded (platform rows)', (SELECT count(*) FROM wht_rate_rules WHERE organization_id IS NULL AND notes = 'seed 201'), 11::bigint);
SELECT t.eq('management fees 20%', resolve_wht_rate(:'O1', 'management_fees'), 20.00);
SELECT t.eq('royalties 15%', resolve_wht_rate(:'O1', 'royalties'), 15.00);
SELECT t.eq('technical / consulting 5%', resolve_wht_rate(:'O1', 'technical_consulting'), 5.00);
SELECT t.eq('related party services 5% (MR 25)', resolve_wht_rate(:'O1', 'related_party_services'), 5.00);
SELECT t.eq('any other payments 15%', resolve_wht_rate(:'O1', 'other'), 15.00);
SELECT t.eq('default row kept at 5%', resolve_wht_rate(:'O1', NULL), 5.00);
SELECT t.eq('every row has a source note', (SELECT count(*) FROM wht_rate_rules WHERE organization_id IS NULL AND source_note IS NULL), 0::bigint);
SELECT t.as_user(:'D');
SELECT t.denied('org admin cannot edit the platform table', $$UPDATE wht_rate_rules SET rate_pct = 1 WHERE organization_id IS NULL AND service_type = 'rent'$$);
INSERT INTO wht_rate_rules(organization_id, service_type, rate_pct, label_en, source_note) VALUES (:'O1', 'rent', 4, 'Rent (org)', 'adviser letter');
SELECT t.eq('org row wins for its organization', resolve_wht_rate(:'O1', 'rent'), 4.00);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
DELETE FROM wht_rate_rules WHERE organization_id = :'O1' AND service_type = 'rent';

-- ================================================================ 5. contracts bucket
-- files written by old app versions (no project folder) + one orphan
INSERT INTO payments(id,organization_id,project_id,source_type,source_id,amount,payment_date,proof_path)
VALUES ('e2010000-0000-0000-0000-000000000001',:'O1',:'P','overtime','e2010000-0000-0000-0000-0000000000ff',1,'2026-10-20','payments/old-proof.pdf');
UPDATE payroll SET payment_schedule = jsonb_set(payment_schedule, '{0,proofPath}', '"payroll/b04/m1.pdf"') WHERE id = :'PX';
-- (uploaded by A, a member of the organization that references them)
INSERT INTO storage.objects(bucket_id, name, owner) VALUES
 ('contracts', 'payments/old-proof.pdf', :'A'), ('contracts', 'payroll/b04/m1.pdf', :'A'), ('contracts', 'old/orphan.pdf', NULL),
 ('contracts', :'P' || '/invoices/x/already.pdf', :'A');
-- the live org-wide read policy (195 §2) as it exists there
CREATE POLICY "Org members can read contracts" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'contracts');
SELECT t.as_user(:'D');
SELECT t.denied('only a super admin lists / moves contract files', $$SELECT * FROM move_contract_files_to_project_folders(true)$$);
SELECT t.denied('only a super admin repoints', format($$SELECT repoint_contract_file('payments/old-proof.pdf', %L)$$, :'P' || '/payments/old-proof.pdf'));
SELECT t.denied('only a super admin switches the policy', $$SELECT switch_contracts_bucket_to_project_policy(true)$$);
SELECT t.as_user(:'E');
SELECT t.eq('dry run: the plan', (SELECT string_agg(object_name||'>'||COALESCE(new_name, '-')||'>'||action, ',' ORDER BY object_name)
  FROM move_contract_files_to_project_folders(true) WHERE object_name IN ('payments/old-proof.pdf','payroll/b04/m1.pdf','old/orphan.pdf')),
  'old/orphan.pdf>->orphan,payments/old-proof.pdf>' || :'P' || '/payments/old-proof.pdf>move,payroll/b04/m1.pdf>' || :'P' || '/payroll/b04/m1.pdf>move');
SELECT t.eq('files already under a project folder are not listed', (SELECT count(*) FROM move_contract_files_to_project_folders(true) WHERE object_name LIKE :'P' || '/%'), 0::bigint);
SELECT t.eq('switch refused while files remain', switch_contracts_bucket_to_project_policy(true), 'skipped');
SELECT t.eq('org-wide policy still there', (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'Org members can read contracts'), 1::bigint);
SELECT t.denied('repoint can never point into another project', format($$SELECT repoint_contract_file('payments/old-proof.pdf', %L)$$, :'P1' || '/payments/old-proof.pdf'));
SELECT t.denied('repoint needs <project>/<old path>', format($$SELECT repoint_contract_file('payments/old-proof.pdf', %L)$$, :'P' || '/elsewhere.pdf'));
RESET ROLE;
-- the Storage API moves the bytes (simulated: the object is renamed)
UPDATE storage.objects SET name = :'P' || '/' || name WHERE bucket_id = 'contracts' AND name IN ('payments/old-proof.pdf', 'payroll/b04/m1.pdf');
SELECT t.as_user(:'E');
SELECT t.eq('moved files wait for their references', (SELECT count(*) FROM move_contract_files_to_project_folders(true) WHERE action = 'repoint'), 2::bigint);
SELECT t.eq('apply: references repointed', (SELECT count(*) FROM move_contract_files_to_project_folders(false) WHERE action = 'repointed'), 2::bigint);
SELECT t.eq('payment proof path updated', (SELECT proof_path FROM payments WHERE id = 'e2010000-0000-0000-0000-000000000001'), :'P' || '/payments/old-proof.pdf');
SELECT t.eq('payroll JSON proof path updated', (SELECT payment_schedule->0->>'proofPath' FROM payroll WHERE id = :'PX'), :'P' || '/payroll/b04/m1.pdf');
SELECT t.eq('instalment statuses untouched by the repoint', (SELECT string_agg(status, ',' ORDER BY seq) FROM payroll_instalments WHERE payroll_id = :'PX'), 'Approved,Approved');
SELECT t.eq('orphan still blocks the strict switch', switch_contracts_bucket_to_project_policy(false), 'skipped');
SELECT t.eq('switch with orphans allowed', switch_contracts_bucket_to_project_policy(true), 'switched');
SELECT t.eq('org-wide read policy dropped', (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'Org members can read contracts'), 0::bigint);
SELECT t.eq('project-scoped read policy in place', (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'Project members can read contract files by project'), 1::bigint);
-- #5 the switch tells when the org-wide policy was not there (live: dropped by migration 20260722132616)
SELECT t.eq('#5 switch when the org-wide policy is absent: not present', switch_contracts_bucket_to_project_policy(true), 'not present');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
-- #4 project folders are readable by org admins / owners who are not project members
\set F '00000000-0000-0000-0000-00000000000f'
INSERT INTO auth.users(id,email) VALUES (:'F','admin2@org1.test') ON CONFLICT DO NOTHING;
INSERT INTO profiles(id,display_name) VALUES (:'F','Org1 Admin without projects') ON CONFLICT DO NOTHING;
INSERT INTO organization_members(organization_id,user_id,role) VALUES (:'O1',:'F','admin') ON CONFLICT DO NOTHING;
GRANT SELECT, INSERT ON storage.objects TO authenticated;          -- as on Supabase
SELECT t.as_user(:'F');
SELECT t.eq('#4 org admin (not a project member) reads a moved file', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'contracts' AND name = :'P' || '/payments/old-proof.pdf'), 1::bigint);
INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('contracts', :'P' || '/payments/new-proof.pdf', :'F');
SELECT t.eq('#4 org admin (not a project member) uploads into the project folder', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'contracts' AND name = :'P' || '/payments/new-proof.pdf'), 1::bigint);
SELECT t.as_user(:'A');
SELECT t.eq('#4 legitimate: a project member reads it', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'contracts' AND name = :'P' || '/payments/old-proof.pdf'), 1::bigint);
SELECT t.as_user(:'B');
SELECT t.eq('#4 another tenant does not', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'contracts' AND name LIKE :'P' || '/%'), 0::bigint);
SELECT t.denied('#4 another tenant cannot upload into the project folder', format($$INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('contracts', %L, %L)$$, :'P' || '/x/evil.pdf', :'B'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
REVOKE SELECT, INSERT ON storage.objects FROM authenticated;
-- #6 / #14 a reference written into a row never pulls a file into that row's project
INSERT INTO storage.objects(bucket_id, name, owner) VALUES
 ('contracts', 'invoices/60000000-0000-0000-0000-000000000001/claim.pdf', :'A'),   -- names an invoice of P1
 ('contracts', 'misc/foreign.pdf', :'B'),                                           -- uploaded by another tenant
 ('contracts', 'misc/noproject.pdf', :'A'),                                         -- also referenced without a project
 ('contracts', 'invoices/' || :'I4' || '/ok.pdf', NULL);                            -- names an invoice of P
INSERT INTO payments(id,organization_id,project_id,source_type,source_id,amount,payment_date,proof_path) VALUES
 ('e2010000-0000-0000-0000-000000000002',:'O1',:'P','overtime','e2010000-0000-0000-0000-0000000000ff',1,'2026-10-20','invoices/60000000-0000-0000-0000-000000000001/claim.pdf'),
 ('e2010000-0000-0000-0000-000000000003',:'O1',:'P','overtime','e2010000-0000-0000-0000-0000000000ff',1,'2026-10-20','misc/foreign.pdf'),
 ('e2010000-0000-0000-0000-000000000004',:'O1',:'P','overtime','e2010000-0000-0000-0000-0000000000ff',1,'2026-10-20','misc/noproject.pdf'),
 ('e2010000-0000-0000-0000-000000000005',:'O1',NULL,'overtime','e2010000-0000-0000-0000-0000000000ff',1,'2026-10-20','misc/noproject.pdf'),
 ('e2010000-0000-0000-0000-000000000006',:'O1',:'P','overtime','e2010000-0000-0000-0000-0000000000ff',1,'2026-10-20','invoices/' || :'I4' || '/ok.pdf');
SELECT t.as_user(:'E');
SELECT t.eq('#6 path naming a record of another project: conflict', (SELECT action||'|'||note FROM move_contract_files_to_project_folders(true) WHERE object_name = 'invoices/60000000-0000-0000-0000-000000000001/claim.pdf'), 'conflict|other_project_record');
SELECT t.eq('#6 file uploaded by another tenant: conflict', (SELECT action||'|'||note FROM move_contract_files_to_project_folders(true) WHERE object_name = 'misc/foreign.pdf'), 'conflict|uploader_outside_org');
SELECT t.eq('#14 also referenced by a record without a project: conflict', (SELECT action||'|'||note FROM move_contract_files_to_project_folders(true) WHERE object_name = 'misc/noproject.pdf'), 'conflict|no_project');
SELECT t.denied('#14 repoint refuses it too', $$SELECT repoint_contract_file('misc/noproject.pdf', '20000000-0000-0000-0000-000000000201/misc/noproject.pdf')$$);
SELECT t.eq('#6 legitimate: a path naming a record of the same project moves', (SELECT action||'|'||new_name FROM move_contract_files_to_project_folders(true) WHERE object_name = 'invoices/' || :'I4' || '/ok.pdf'), 'move|' || :'P' || '/invoices/' || :'I4' || '/ok.pdf');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
DELETE FROM storage.objects WHERE bucket_id = 'contracts' AND (name LIKE :'P' || '/%' OR name IN ('old/orphan.pdf', 'misc/foreign.pdf', 'misc/noproject.pdf') OR name LIKE 'invoices/%');
SELECT t.eq('final: phases match', ledger_phases_match(:'P'), true);
