-- 204 — close-out: approved PO cancelled not deleted, paid request reversed
-- with a refund entry (ledger stays balanced), platform settings, budget
-- templates.
\set A  '00000000-0000-0000-0000-00000000000a'
\set B  '00000000-0000-0000-0000-00000000000b'
\set C  '00000000-0000-0000-0000-00000000000c'
\set D  '00000000-0000-0000-0000-00000000000d'
\set E  '00000000-0000-0000-0000-00000000000e'
\set O1 '10000000-0000-0000-0000-000000000001'
\set O2 '10000000-0000-0000-0000-000000000002'
\set P  '20000000-0000-0000-0000-000000000204'
\set I1 '61000000-0000-0000-0000-000000000204'
\set PO '70000000-0000-0000-0000-000000000204'
\set PO2 '70000000-0000-0000-0000-000000000205'
\set PO3 '70000000-0000-0000-0000-000000000206'
\set R1 '80000000-0000-0000-0000-000000000204'
\set R2 '80000000-0000-0000-0000-000000000205'
\set R3 '80000000-0000-0000-0000-000000000206'
\set PO4 '70000000-0000-0000-0000-000000000207'
\set I7 '61000000-0000-0000-0000-000000000217'
SELECT id AS ap FROM gl_accounts WHERE code='9200' \gset
SELECT id AS bank FROM gl_accounts WHERE code='9100' \gset

INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status) VALUES
 (:'P', :'A', 'Closeout test', 'CLO1', :'O1', 'USD', 3.75, 'Production');
INSERT INTO project_members(project_id,user_id) VALUES (:'P', :'A'), (:'P', :'C'), (:'P', :'D') ON CONFLICT DO NOTHING;
INSERT INTO budget_lines(project_id,organization_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency) VALUES
 (:'P', :'O1', '2100', '2101', '2100', 'Camera', 1, 50000, 1, 'Package', 'SAR');
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('ledger initialised', ledger_backfill_project(:'P') >= 0, true);

-- ================================================================ 1. purchase orders
SELECT t.as_user(:'A');
INSERT INTO purchase_orders(id,organization_id,project_id,vendor_name,amount,budget_code,status,po_number,date)
VALUES (:'PO',:'O1',:'P','Cam Co',5000,'2101','Draft','CLO1-PO-1','2026-10-01'),
       (:'PO2',:'O1',:'P','Grip Co',800,'2101','Draft','CLO1-PO-2','2026-10-01');
SELECT t.eq('a new PO was never approved', (SELECT first_approved_at IS NULL FROM purchase_orders WHERE id = :'PO'), true);
SELECT t.as_user(:'D');
DELETE FROM purchase_orders WHERE id = :'PO2';
SELECT t.as_user(:'A');
SELECT t.eq('a never-approved PO can still be deleted (org admin)', (SELECT count(*) FROM purchase_orders WHERE id = :'PO2'), 0::bigint);
SELECT t.denied('cancel_purchase_order on a draft PO refused', format($$SELECT cancel_purchase_order(%L, 'not needed')$$, :'PO'));
SELECT t.as_user(:'D');
UPDATE purchase_orders SET status = 'Approved' WHERE id = :'PO';
SELECT t.eq('approval stamps the first approval', (SELECT (first_approved_at IS NOT NULL)::text||'|'||(approved_by = :'D'::uuid)::text FROM purchase_orders WHERE id = :'PO'), 'true|true');
SELECT t.denied('X08: an approved PO cannot be deleted', format($$DELETE FROM purchase_orders WHERE id = %L$$, :'PO'));
-- MED #2: an approved PO moves back to Draft only by an approver with a reason
SELECT t.denied('back to Draft needs a reason', format($$UPDATE purchase_orders SET status = 'Draft' WHERE id = %L$$, :'PO'));
SELECT t.as_user(:'C');
SELECT t.denied('back to Draft needs an approver', format($$UPDATE purchase_orders SET status = 'Draft', status_change_reason = 'fix the vendor' WHERE id = %L$$, :'PO'));
SELECT t.as_user(:'D');
UPDATE purchase_orders SET status = 'Draft', status_change_reason = '  fix the vendor ' WHERE id = :'PO';
SELECT t.eq('approver moved it back to Draft with a reason', (SELECT status||'|'||status_change_reason FROM purchase_orders WHERE id = :'PO'), 'Draft|fix the vendor');
SELECT t.eq('back to Draft keeps the first approval', (SELECT first_approved_at IS NOT NULL FROM purchase_orders WHERE id = :'PO'), true);
SELECT t.denied('X08: a once-approved PO in Draft cannot be deleted either', format($$DELETE FROM purchase_orders WHERE id = %L$$, :'PO'));
UPDATE purchase_orders SET first_approved_at = NULL WHERE id = :'PO';
SELECT t.eq('first approval cannot be cleared', (SELECT first_approved_at IS NOT NULL FROM purchase_orders WHERE id = :'PO'), true);
SELECT t.as_user(:'D');
UPDATE purchase_orders SET status = 'Approved' WHERE id = :'PO';
SELECT t.as_user(:'C');
SELECT t.denied('cancel needs an approver', format($$SELECT cancel_purchase_order(%L, 'vendor withdrew')$$, :'PO'));
SELECT t.as_user(:'D');
SELECT t.denied('cancel needs a reason (RPC)', format($$SELECT cancel_purchase_order(%L, '  ')$$, :'PO'));
SELECT t.denied('cancel needs a reason (direct update)', format($$UPDATE purchase_orders SET status = 'Cancelled' WHERE id = %L$$, :'PO'));
-- MED #3: the cancelling statement cannot change anything else
SELECT t.denied('cancel + amount change in one statement refused', format($$UPDATE purchase_orders SET status = 'Cancelled', cancellation_reason = 'vendor withdrew', amount = 1 WHERE id = %L$$, :'PO'));
SELECT t.denied('cancel + vendor change in one statement refused', format($$UPDATE purchase_orders SET status = 'Cancelled', cancellation_reason = 'vendor withdrew', vendor_name = 'Other Co' WHERE id = %L$$, :'PO'));
SELECT t.eq('nothing changed by the refused cancellations', (SELECT status||'|'||amount::text||'|'||vendor_name FROM purchase_orders WHERE id = :'PO'), 'Approved|5000|Cam Co');
-- a live invoice against the PO blocks the cancellation
SELECT t.as_user(:'A');
INSERT INTO invoices(id,description,budget_code,price,date,vendor_name,invoice_no,organization_id,project_id,purchase_order_id)
VALUES (:'I1','Camera on PO','2101',2000,'2026-10-05','Cam Co','INV-204',:'O1',:'P',:'PO');
SELECT t.as_user(:'D');
SELECT t.denied('an invoice on the PO blocks the cancellation', format($$SELECT cancel_purchase_order(%L, 'vendor withdrew')$$, :'PO'));
SELECT reject_invoice(:'I1', 'Wrong PO');
SELECT cancel_purchase_order(:'PO', 'Vendor withdrew');
SELECT t.eq('cancellation recorded, approval kept', (SELECT status||'|'||cancellation_reason||'|'||(cancelled_by = :'D'::uuid)::text||'|'||(approved_by = :'D'::uuid)::text
  FROM purchase_orders WHERE id = :'PO'), 'Cancelled|Vendor withdrew|true|true');
SELECT t.eq('cancelled PO is no commitment', (SELECT count(*) FROM v_ledger_transactions WHERE source_id = :'PO'), 0::bigint);
SELECT t.denied('a cancelled PO is locked', format($$UPDATE purchase_orders SET status = 'Approved' WHERE id = %L$$, :'PO'));
SELECT t.denied('a cancelled PO amount is locked', format($$UPDATE purchase_orders SET amount = 1 WHERE id = %L$$, :'PO'));
SELECT t.denied('a cancelled PO cannot be deleted', format($$DELETE FROM purchase_orders WHERE id = %L$$, :'PO'));
UPDATE purchase_orders SET cancellation_reason = 'other' WHERE id = :'PO';
SELECT t.eq('cancellation stamps are the database''s', (SELECT cancellation_reason FROM purchase_orders WHERE id = :'PO'), 'Vendor withdrew');
-- LOW #4: every column of a cancelled PO is locked, the notes aside
SELECT t.denied('cancelled PO description locked', format($$UPDATE purchase_orders SET description = 'x' WHERE id = %L$$, :'PO'));
SELECT t.denied('cancelled PO number locked', format($$UPDATE purchase_orders SET po_number = 'X-1' WHERE id = %L$$, :'PO'));
SELECT t.denied('cancelled PO fx rate locked', format($$UPDATE purchase_orders SET fx_rate = 2 WHERE id = %L$$, :'PO'));
SELECT t.denied('cancelled PO project locked', format($$UPDATE purchase_orders SET project_id = '20000000-0000-0000-0000-000000000001' WHERE id = %L$$, :'PO'));
UPDATE purchase_orders SET notes = 'kept for the file' WHERE id = :'PO';
SELECT t.eq('cancelled PO notes can still be written', (SELECT notes FROM purchase_orders WHERE id = :'PO'), 'kept for the file');
-- LOW #17: no request / payment on a cancelled PO
SELECT t.as_user(:'A');
SELECT t.denied('no payment request on a cancelled PO', format($$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,requested_by) VALUES (%L,%L,'purchase_order',%L,'PO',5000,100,'SAR','waiting_approval',%L)$$, :'O1', :'P', :'PO', :'A'));
SELECT t.denied('no payment on a cancelled PO', format($$INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date) VALUES (%L,%L,'purchase_order',%L,100,'2026-10-09')$$, :'O1', :'P', :'PO'));
SELECT t.as_user(:'D');
SELECT t.as_user(:'B');
SELECT t.denied('another tenant cannot cancel', format($$SELECT cancel_purchase_order(%L, 'x y z')$$, :'PO'));
-- MED #2: Closed only when fully invoiced / paid; Rejected only by an approver with a reason
SELECT t.as_user(:'A');
INSERT INTO purchase_orders(id,organization_id,project_id,vendor_name,amount,budget_code,status,po_number,date)
VALUES (:'PO3',:'O1',:'P','Light Co',1000,'2101','Draft','CLO1-PO-3','2026-10-01'),
       (:'PO4',:'O1',:'P','Truck Co',700,'2101','Draft','CLO1-PO-4','2026-10-01');
SELECT t.as_user(:'D');
UPDATE purchase_orders SET status = 'Approved' WHERE id IN (:'PO3', :'PO4');
SELECT t.as_user(:'A');
SELECT t.denied('approved PO not invoiced cannot be closed', format($$UPDATE purchase_orders SET status = 'Closed' WHERE id = %L$$, :'PO4'));
SELECT t.denied('approved PO cannot be rejected by a member', format($$UPDATE purchase_orders SET status = 'Rejected', status_change_reason = 'not needed' WHERE id = %L$$, :'PO4'));
SELECT t.as_user(:'D');
SELECT t.denied('approved PO rejected without a reason', format($$UPDATE purchase_orders SET status = 'Rejected' WHERE id = %L$$, :'PO4'));
SELECT t.as_user(:'A');
INSERT INTO invoices(id,description,budget_code,price,date,vendor_name,invoice_no,organization_id,project_id,purchase_order_id)
VALUES (:'I7','Lights on PO','2101',1000,'2026-10-05','Light Co','INV-217',:'O1',:'P',:'PO3');
SELECT t.as_user(:'D');
SELECT approve_invoice(:'I7');
SELECT t.as_user(:'A');
UPDATE purchase_orders SET status = 'Closed' WHERE id = :'PO3';
SELECT t.eq('fully invoiced PO closed', (SELECT status FROM purchase_orders WHERE id = :'PO3'), 'Closed');
-- LOW #17 (legitimate case): a request on a live approved PO
INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,requested_by)
VALUES (:'O1',:'P','purchase_order',:'PO4','Truck Co',700,100,'SAR','waiting_approval',:'A');
SELECT t.eq('request on a live PO accepted', (SELECT count(*) FROM payment_requests WHERE source_id = :'PO4'), 1::bigint);
-- LOW #12: a once-approved PO left without a project is not deletable either
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE purchase_orders SET project_id = NULL WHERE id = :'PO4';
SELECT t.as_user(:'D');
SELECT t.denied('approved PO without a project cannot be deleted', format($$DELETE FROM purchase_orders WHERE id = %L$$, :'PO4'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('backfill: seed PO approved before 204 has first_approved_at', (SELECT first_approved_at IS NOT NULL FROM purchase_orders WHERE id = '70000000-0000-0000-0000-000000000001'), true);

-- ================================================================ 2. paid request → refund
SELECT t.as_user(:'A');
INSERT INTO invoices(id,description,budget_code,price,vat_amount,date,vendor_name,invoice_no,organization_id,project_id)
VALUES ('61000000-0000-0000-0000-000000000205','Lens rental','2101',1000,150,'2026-10-06','Lens Co','INV-205',:'O1',:'P');
SELECT t.as_user(:'D');
SELECT approve_invoice('61000000-0000-0000-0000-000000000205');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,approved_at)
VALUES (:'R1',:'O1',:'P','invoice','61000000-0000-0000-0000-000000000205','Lens Co · INV-205',1150,1150,'SAR','approved','2026-10-07');
UPDATE payment_requests SET status='paid', payment_date='2026-10-08', payment_method='Transfer' WHERE id=:'R1';
SELECT id AS pay1 FROM payments WHERE payment_request_id = :'R1' \gset
SELECT t.eq('paid request wrote its payment', (SELECT amount FROM payments WHERE id = :'pay1'), 1150.00);
SELECT t.eq('phases match after the payment', ledger_phases_match(:'P'), true);

SELECT t.as_user(:'A');
-- MED #1: the request link of a payment is the database's
SELECT t.denied('a member cannot unlink the request payment', format($$UPDATE payments SET payment_request_id = NULL WHERE id = %L$$, :'pay1'));
INSERT INTO payments(id,organization_id,project_id,source_type,source_id,amount,payment_date,method)
VALUES ('62000000-0000-0000-0000-000000000204',:'O1',:'P','invoice','61000000-0000-0000-0000-000000000205',10,'2026-10-08','Cash');
SELECT t.denied('a member cannot point another payment at a paid request', $$UPDATE payments SET payment_request_id = '80000000-0000-0000-0000-000000000204' WHERE id = '62000000-0000-0000-0000-000000000204'$$);
SELECT t.eq('a hand insert cannot claim a request link', (SELECT payment_request_id FROM payments WHERE id = '62000000-0000-0000-0000-000000000204'), NULL::uuid);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
DELETE FROM payments WHERE id = '62000000-0000-0000-0000-000000000204';
SELECT t.as_user(:'A');
SELECT t.eq('the request payment is still linked', (SELECT payment_request_id FROM payments WHERE id = :'pay1'), :'R1'::uuid);
SELECT t.denied('a refund row cannot be written by hand', format($$INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,reverses_payment_id) VALUES (%L,%L,'invoice','61000000-0000-0000-0000-000000000205',-1150,'2026-10-09',%L)$$, :'O1', :'P', :'pay1'));
SELECT t.denied('a negative payment without a reversal link is refused', format($$INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date) VALUES (%L,%L,'invoice','61000000-0000-0000-0000-000000000205',-10,'2026-10-09')$$, :'O1', :'P'));
SELECT t.denied('only an org admin reverses a paid request', format($$SELECT reverse_paid_payment_request(%L, 'Vendor refunded')$$, :'R1'));
SELECT t.denied('reversal stamps cannot be written directly', format($$UPDATE payment_requests SET reversed_at = now(), reversal_reason = 'x' WHERE id = %L$$, :'R1'));
SELECT t.as_user(:'B');
SELECT t.denied('another tenant cannot reverse', format($$SELECT reverse_paid_payment_request(%L, 'Vendor refunded')$$, :'R1'));
SELECT t.as_user(:'D');
SELECT t.denied('reversal needs a reason', format($$SELECT reverse_paid_payment_request(%L, ' ')$$, :'R1'));
SELECT t.denied('refund date not before the payment', format($$SELECT reverse_paid_payment_request(%L, 'Vendor refunded', '2026-10-01')$$, :'R1'));
SELECT t.denied('refund date not in the future', format($$SELECT reverse_paid_payment_request(%L, 'Vendor refunded', CURRENT_DATE + 1)$$, :'R1'));
SELECT t.denied('refund reference up to 200 characters', format($$SELECT reverse_paid_payment_request(%L, 'Vendor refunded', NULL, repeat('x', 201))$$, :'R1'));
SELECT t.eq('reversal returns the refund', (SELECT (reverse_paid_payment_request(:'R1', 'Vendor refunded the double payment', '2026-10-10', ' CN-0042 '))->>'amount'), '-1150.00');
SELECT t.eq('refund reference kept on the request and the refund payment',
  (SELECT r.reversal_reference||'|'||p.bank_reference FROM payment_requests r JOIN payments p ON p.id = r.reversal_payment_id WHERE r.id = :'R1'), 'CN-0042|CN-0042');
SELECT t.eq('request stays paid, reversal recorded', (SELECT status||'|'||reversal_reason||'|'||(reversed_by = :'D'::uuid)::text||'|'||(reversal_payment_id IS NOT NULL)::text FROM payment_requests WHERE id = :'R1'),
  'paid|Vendor refunded the double payment|true|true');
SELECT t.eq('original payment kept + refund row', (SELECT string_agg(amount::text, ',' ORDER BY amount DESC) FROM payments WHERE source_id = '61000000-0000-0000-0000-000000000205'), '1150.00,-1150.00');
SELECT t.eq('refund points at the original', (SELECT reverses_payment_id = :'pay1'::uuid FROM payments WHERE amount < 0 AND source_id = '61000000-0000-0000-0000-000000000205'), true);
SELECT t.denied('reversed twice refused', format($$SELECT reverse_paid_payment_request(%L, 'again again')$$, :'R1'));
SELECT t.denied('a reversed request is frozen', format($$UPDATE payment_requests SET payment_date = '2026-10-11' WHERE id = %L$$, :'R1'));
-- LOW #9: a moved proof file still follows a reversed request
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE payment_requests SET proof_path = 'proofs/r1.pdf' WHERE id = :'R1';
SELECT t.as_user(:'E');
SELECT t.eq('repoint_contract_file moves the proof of a reversed request', repoint_contract_file('proofs/r1.pdf', :'P' || '/proofs/r1.pdf') >= 1, true);
SELECT t.eq('request and payment proof moved', (SELECT r.proof_path = p.proof_path AND r.proof_path = :'P' || '/proofs/r1.pdf' FROM payment_requests r JOIN payments p ON p.payment_request_id = r.id WHERE r.id = :'R1'), true);
SELECT t.as_user(:'D');
SELECT t.denied('a reversed payment cannot be deleted', format($$DELETE FROM payments WHERE id = %L$$, :'pay1'));
SELECT t.denied('a reversed payment amount is locked', format($$UPDATE payments SET amount = 1 WHERE id = %L$$, :'pay1'));
SELECT t.denied('the refund row cannot be deleted', format($$DELETE FROM payments WHERE reverses_payment_id = %L$$, :'pay1'));
SELECT t.denied('the refund row cannot be edited', format($$UPDATE payments SET amount = -1 WHERE reverses_payment_id = %L$$, :'pay1'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
-- ledger: the refund is Dr Bank / Cr AP; everything balances, both phases agree
SELECT t.eq('journal: refund debits the bank', (SELECT sum(debit) FROM v_journal_lines j JOIN payments p ON j.event_key = 'payment:' || p.id
  WHERE p.reverses_payment_id = :'pay1' AND j.gl_account_id = :'bank'), 1150.00);
SELECT t.eq('journal: refund credits payable', (SELECT sum(credit) FROM v_journal_lines j JOIN payments p ON j.event_key = 'payment:' || p.id
  WHERE p.reverses_payment_id = :'pay1' AND j.gl_account_id = :'ap'), 1150.00);
SELECT t.eq('journal: debits = credits', (SELECT sum(debit) = sum(credit) FROM v_journal_lines WHERE project_id = :'P'), true);
SELECT t.eq('engine: debits = credits', (SELECT sum(l.debit) = sum(l.credit) FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id WHERE e.project_id = :'P'), true);
SELECT t.eq('engine posted the refund', (SELECT count(*) FROM ledger_entries e JOIN payments p ON e.event_key = 'payment:' || p.id WHERE p.reverses_payment_id = :'pay1'), 1::bigint);
SELECT t.eq('phases match after the reversal', ledger_phases_match(:'P'), true);
SELECT t.eq('bank back to zero for this invoice', (SELECT sum(amount) FROM payments WHERE source_id = '61000000-0000-0000-0000-000000000205'), 0.00);
-- the invoice can be paid again through a new request
SELECT t.as_user(:'A');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,requested_by)
VALUES (:'R2',:'O1',:'P','invoice','61000000-0000-0000-0000-000000000205','Lens Co · INV-205',1150,1150,'SAR','waiting_approval',:'A');
SELECT t.eq('a reversed request does not block a new one', (SELECT status FROM payment_requests WHERE id = :'R2'), 'waiting_approval');
SELECT t.as_user(:'D');
SELECT t.denied('only paid requests are reversed', format($$SELECT reverse_paid_payment_request(%L, 'not paid yet')$$, :'R2'));
SELECT t.denied('the new request blocks cancelling the invoice', $$SELECT cancel_invoice('61000000-0000-0000-0000-000000000205', 'refunded in full')$$);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
-- LOW-MED #8: once refunded in full (and the new request withdrawn) the invoice can be cancelled
UPDATE payment_requests SET status = 'cancelled', cancellation_reason = 'not needed' WHERE id = :'R2';
SELECT t.as_user(:'D');
SELECT cancel_invoice('61000000-0000-0000-0000-000000000205', 'Refunded in full');
SELECT t.eq('fully refunded invoice cancelled', (SELECT approval_status FROM invoices WHERE id = '61000000-0000-0000-0000-000000000205'), 'cancelled');

-- MED #5: maker-checker — whoever requested, approved (any level) or paid it cannot reverse it
SELECT t.as_user(:'A');
INSERT INTO invoices(id,description,budget_code,price,date,vendor_name,invoice_no,organization_id,project_id) VALUES
 ('61000000-0000-0000-0000-000000000211','Mk 1','2101',100,'2026-10-06','Mk Co','INV-211',:'O1',:'P'),
 ('61000000-0000-0000-0000-000000000212','Mk 2','2101',100,'2026-10-06','Mk Co','INV-212',:'O1',:'P'),
 ('61000000-0000-0000-0000-000000000213','Mk 3','2101',100,'2026-10-06','Mk Co','INV-213',:'O1',:'P'),
 ('61000000-0000-0000-0000-000000000214','Mk 4','2101',100,'2026-10-06','Mk Co','INV-214',:'O1',:'P');
SELECT t.as_user(:'D');
SELECT approve_invoice(i) FROM unnest(ARRAY['61000000-0000-0000-0000-000000000211','61000000-0000-0000-0000-000000000212',
  '61000000-0000-0000-0000-000000000213','61000000-0000-0000-0000-000000000214']::uuid[]) i;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,approved_at,requested_by,approved_by,executed_by) VALUES
 ('80000000-0000-0000-0000-000000000211',:'O1',:'P','invoice','61000000-0000-0000-0000-000000000211','Mk 1',100,100,'SAR','approved','2026-10-07',:'D',NULL,NULL),
 ('80000000-0000-0000-0000-000000000212',:'O1',:'P','invoice','61000000-0000-0000-0000-000000000212','Mk 2',100,100,'SAR','approved','2026-10-07',:'A',:'D',NULL),
 ('80000000-0000-0000-0000-000000000213',:'O1',:'P','invoice','61000000-0000-0000-0000-000000000213','Mk 3',100,100,'SAR','approved','2026-10-07',:'A',NULL,NULL),
 ('80000000-0000-0000-0000-000000000214',:'O1',:'P','invoice','61000000-0000-0000-0000-000000000214','Mk 4',100,100,'SAR','approved','2026-10-07',:'A',NULL,:'D');
INSERT INTO payment_request_approvals(payment_request_id,organization_id,project_id,level_no,level_label,approved_by)
VALUES ('80000000-0000-0000-0000-000000000213',:'O1',:'P',1,'Finance',:'D');
UPDATE payment_requests SET status='paid', payment_date='2026-10-08', payment_method='Transfer'
 WHERE id IN ('80000000-0000-0000-0000-000000000211','80000000-0000-0000-0000-000000000212',
              '80000000-0000-0000-0000-000000000213','80000000-0000-0000-0000-000000000214');
SELECT t.as_user(:'D');
SELECT t.denied('the requester cannot reverse', $$SELECT reverse_paid_payment_request('80000000-0000-0000-0000-000000000211', 'Vendor refunded')$$);
SELECT t.denied('the approver cannot reverse', $$SELECT reverse_paid_payment_request('80000000-0000-0000-0000-000000000212', 'Vendor refunded')$$);
SELECT t.denied('an approver of a chain level cannot reverse', $$SELECT reverse_paid_payment_request('80000000-0000-0000-0000-000000000213', 'Vendor refunded')$$);
SELECT t.denied('the person who paid it cannot reverse', $$SELECT reverse_paid_payment_request('80000000-0000-0000-0000-000000000214', 'Vendor refunded')$$);
SELECT t.eq('nothing refunded by the refused reversals', (SELECT count(*) FROM payments WHERE amount < 0 AND source_id IN ('61000000-0000-0000-0000-000000000211',
  '61000000-0000-0000-0000-000000000212','61000000-0000-0000-0000-000000000213','61000000-0000-0000-0000-000000000214')), 0::bigint);
SELECT t.denied('an invoice with a payment (net) cannot be cancelled', $$SELECT cancel_invoice('61000000-0000-0000-0000-000000000212', 'wrong vendor')$$);
SELECT t.as_user(:'E');
SELECT t.eq('a platform owner may reverse it', (SELECT (reverse_paid_payment_request('80000000-0000-0000-0000-000000000211', 'Vendor refunded', '2026-10-09'))->>'amount'), '-100.00');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
-- instalment requests are not reversed here
INSERT INTO payroll(id,name,kind,total_amount,net_payable,budget_code,organization_id,project_id,payment_schedule)
VALUES ('51000000-0000-0000-0000-000000000204','Crew 204','crew',1000,1000,'2101',:'O1',:'P',
 '[{"id":"m1","label":"All","percent":100,"dueDate":"2026-10-01","status":"Pending"}]');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,payroll_milestone_id,source_label,total_amount,requested_amount,currency,status,approved_at)
VALUES (:'R3',:'O1',:'P','payroll_row','51000000-0000-0000-0000-000000000204','m1','Crew 204',1000,1000,'SAR','approved','2026-10-02');
UPDATE payment_requests SET status='paid', payment_date='2026-10-03', payment_method='Transfer' WHERE id=:'R3';
SELECT t.as_user(:'D');
SELECT t.denied('instalment requests are corrected on the contract', format($$SELECT reverse_paid_payment_request(%L, 'refund please')$$, :'R3'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('phases match at the end', ledger_phases_match(:'P'), true);

-- ================================================================ 3. platform settings
SELECT t.eq('platform settings seeded', (SELECT count(*) FROM platform_settings WHERE key IN ('platform_base_currency','fx_usd_to_base','fx_eur_to_base','fx_aed_to_base','default_wht_rate_pct','fiscal_year_start','default_project_limit','default_language','vat_standard_rate_pct')), 9::bigint);
SELECT t.as_user(:'D');
SELECT t.eq('members read platform settings', (SELECT value FROM platform_settings WHERE key = 'fx_usd_to_base'), '3.75');
SELECT t.denied('an org admin cannot change platform settings', $$UPDATE platform_settings SET value = '4' WHERE key = 'fx_usd_to_base'$$);
SELECT t.as_user(:'E');
UPDATE platform_settings SET value = '3.7500' WHERE key = 'fx_usd_to_base';
SELECT t.eq('super admin updates a setting, stamped', (SELECT value||'|'||(updated_by = :'E'::uuid)::text FROM platform_settings WHERE key = 'fx_usd_to_base'), '3.7500|true');
SELECT t.denied('rate must be positive', $$UPDATE platform_settings SET value = '-1' WHERE key = 'fx_eur_to_base'$$);
SELECT t.denied('fiscal year start MM-DD', $$UPDATE platform_settings SET value = '13-01' WHERE key = 'fiscal_year_start'$$);
SELECT t.denied('language en/ar', $$UPDATE platform_settings SET value = 'fr' WHERE key = 'default_language'$$);
SELECT t.denied('tax rate below 100', $$UPDATE platform_settings SET value = '150' WHERE key = 'default_wht_rate_pct'$$);
SELECT t.denied('project limit a whole number', $$UPDATE platform_settings SET value = '2.5' WHERE key = 'default_project_limit'$$);
SELECT t.denied('LOW #15: non-numeric project limit refused', $$UPDATE platform_settings SET value = 'abc' WHERE key = 'default_project_limit'$$);
SELECT t.denied('LOW #15: non-numeric rate refused', $$UPDATE platform_settings SET value = 'x1' WHERE key = 'fx_usd_to_base'$$);
SELECT t.denied('LOW #15: non-numeric approval limit refused', $$UPDATE platform_settings SET value = 'lots' WHERE key = 'payment_board_approval_above_sar'$$);
UPDATE platform_settings SET value = 'ar' WHERE key = 'default_language';
SELECT t.eq('valid value saved', (SELECT value FROM platform_settings WHERE key = 'default_language'), 'ar');
RESET ROLE;

-- ================================================================ 4. budget templates
SELECT t.as_user(:'D');
INSERT INTO budget_templates(organization_id, name, lines, is_default) VALUES
 (:'O1', 'Org One standard', '[{"group":"ATL","header_code":"1100","header_name":"SCRIPT","code":"1101","description":"SCRIPT"},
                               {"group":"BTL","header_code":"2100","header_name":"CAMERA","code":"2101","description":"CAMERA PACKAGE"}]', true);
SELECT t.eq('org admin adds a default template, stamped', (SELECT (created_by = :'D'::uuid)::text||'|'||jsonb_array_length(lines) FROM budget_templates WHERE organization_id = :'O1' AND is_default), 'true|2');
SELECT t.denied('one default per organization', format($$INSERT INTO budget_templates(organization_id, name, lines, is_default) VALUES (%L, 'Second', '[{"group":"ATL","header_code":"1100","header_name":"S","code":"1102","description":"x"}]', true)$$, :'O1'));
SELECT t.denied('bad group refused', format($$INSERT INTO budget_templates(organization_id, name, lines) VALUES (%L, 'Bad', '[{"group":"Nope","header_code":"1100","header_name":"S","code":"1102","description":"x"}]')$$, :'O1'));
SELECT t.denied('duplicate code refused', format($$INSERT INTO budget_templates(organization_id, name, lines) VALUES (%L, 'Dup', '[{"group":"ATL","header_code":"1100","code":"1101"},{"group":"ATL","header_code":"1100","code":"1101"}]')$$, :'O1'));
INSERT INTO budget_templates(organization_id, name, lines) VALUES (:'O1', 'Extra keys', '[{"group":"ATL","header_code":"1100","header_name":" S ","code":"1102","description":"x","evil":"<script>","nested":{"a":1}}]');
SELECT t.eq('LOW #14: only the known keys are stored', (SELECT lines FROM budget_templates WHERE organization_id = :'O1' AND name = 'Extra keys'),
  '[{"code":"1102","group":"ATL","description":"x","header_code":"1100","header_name":"S"}]'::jsonb);
DELETE FROM budget_templates WHERE organization_id = :'O1' AND name = 'Extra keys';
SELECT t.denied('empty template refused', format($$INSERT INTO budget_templates(organization_id, name, lines) VALUES (%L, 'Empty', '[]')$$, :'O1'));
SELECT t.as_user(:'A');
SELECT t.eq('members read their templates', (SELECT count(*) FROM budget_templates WHERE organization_id = :'O1'), 1::bigint);
SELECT t.denied('a member cannot add a template', format($$INSERT INTO budget_templates(organization_id, name, lines) VALUES (%L, 'Mine', '[{"group":"ATL","header_code":"1100","header_name":"S","code":"1102","description":"x"}]')$$, :'O1'));
SELECT t.denied('a member cannot change a template', format($$UPDATE budget_templates SET name = 'x' WHERE organization_id = %L$$, :'O1'));
SELECT t.as_user(:'B');
SELECT t.eq('another tenant sees no template', (SELECT count(*) FROM budget_templates WHERE organization_id = :'O1'), 0::bigint);
SELECT t.denied('another tenant cannot add one for Org One', format($$INSERT INTO budget_templates(organization_id, name, lines) VALUES (%L, 'Hack', '[{"group":"ATL","header_code":"1100","header_name":"S","code":"1102","description":"x"}]')$$, :'O1'));
SELECT t.as_user(:'D');
SELECT t.denied('organization of a template is fixed', format($$UPDATE budget_templates SET organization_id = %L WHERE organization_id = %L$$, :'O2', :'O1'));
DELETE FROM budget_templates WHERE organization_id = :'O1';
SELECT t.eq('org admin deletes it (built-in template again)', (SELECT count(*) FROM budget_templates WHERE organization_id = :'O1'), 0::bigint);
RESET ROLE;

-- ================================================================ 5. LOW #15 message, LOW #13 organization delete
CREATE FUNCTION pg_temp.err(stmt text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE stmt; RETURN 'no error'; EXCEPTION WHEN others THEN RETURN SQLERRM; END $f$;
SELECT t.eq('LOW #15: the check message, not a cast error', pg_temp.err($$UPDATE platform_settings SET value = 'abc' WHERE key = 'default_project_limit'$$),
  'platform_settings: the project limit must be a whole number of at least 1');

\set O3 '10000000-0000-0000-0000-000000000204'
\set P3 '20000000-0000-0000-0000-000000000214'
\set PO5 '70000000-0000-0000-0000-000000000214'
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO organizations(id,name,slug,base_currency) VALUES (:'O3','Org Gone','org-gone','SAR');
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status) VALUES (:'P3', :'E', 'Gone', 'GON1', :'O3', 'SAR', 1, 'Production');
UPDATE projects SET status = 'Archived', archived_at = now() - interval '40 days' WHERE id = :'P3';
INSERT INTO purchase_orders(id,organization_id,project_id,vendor_name,amount,budget_code,status,po_number,date,first_approved_at,cancelled_at,cancellation_reason)
VALUES (:'PO5',:'O3',:'P3','Gone Co',100,'2101','Cancelled','GON1-PO-1','2026-10-01',now(),now(),'gone');
INSERT INTO payments(id,organization_id,project_id,source_type,source_id,amount,payment_date)
VALUES ('62000000-0000-0000-0000-000000000214',:'O3',:'P3','purchase_order',:'PO5',100,'2026-10-02');
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,reverses_payment_id,reversal_reason)
VALUES (:'O3',:'P3','purchase_order',:'PO5',-100,'2026-10-03','62000000-0000-0000-0000-000000000214','gone');
-- (a decided payment request is kept by keep_decided_payment_requests, 176,
--  which also stops an organization delete by a signed-in user — not 204's)
SELECT t.as_user(:'E');
SELECT t.denied('the cancelled PO is not deletable on its own', format($$DELETE FROM purchase_orders WHERE id = %L$$, :'PO5'));
SELECT t.denied('the refunded payment is not deletable on its own', $$DELETE FROM payments WHERE id = '62000000-0000-0000-0000-000000000214'$$);
DELETE FROM organizations WHERE id = :'O3';
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('deleting the organization takes its cancelled PO and its refunded payments', (SELECT count(*) FROM purchase_orders WHERE organization_id = :'O3')
  + (SELECT count(*) FROM payments WHERE organization_id = :'O3')
  + (SELECT count(*) FROM organizations WHERE id = :'O3'), 0::bigint);
