\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set P1 '20000000-0000-0000-0000-000000000001'
\set P2 '20000000-0000-0000-0000-000000000002'
\set O1 '10000000-0000-0000-0000-000000000001'
\set PO '74000000-0000-0000-0000-000000000001'
\set INV '74000000-0000-0000-0000-000000000002'
-- baseline: seed PO-1 (3,000 approved on 1403) is the only commitment
SELECT t.eq('baseline commitment on 1403', (SELECT committed_sar FROM v_budget_code_position WHERE project_id = :'P1' AND budget_code = '1403'), 3000::numeric);

-- ---- B11: readable sequential PO number, B10: maker-checker ----
SELECT t.as_user(:'A');
INSERT INTO purchase_orders(id, project_id, organization_id, po_number, vendor_name, budget_code, amount, status, date)
VALUES (:'PO', :'P1', :'O1', '', 'Grip Co', '1403', 1000, 'Draft', '2026-10-01');
SELECT t.eq('PO number assigned from the project code', (SELECT po_number FROM purchase_orders WHERE id = :'PO'), 'MON26-PO-0001');
SELECT t.eq('creator recorded', (SELECT created_by FROM purchase_orders WHERE id = :'PO'), :'A'::uuid);
INSERT INTO purchase_orders(project_id, organization_id, po_number, vendor_name, amount, status)
VALUES (:'P1', :'O1', '', 'Next Co', 10, 'Draft');
SELECT t.eq('next number follows', (SELECT count(*) FROM purchase_orders WHERE po_number = 'MON26-PO-0002'), 1::bigint);
SELECT t.denied('cannot create a PO as Approved', $$INSERT INTO purchase_orders(project_id, organization_id, po_number, vendor_name, amount, status) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','', 'X', 5, 'Approved')$$);
SELECT t.denied('creator cannot approve own PO', $$UPDATE purchase_orders SET status = 'Approved' WHERE id = '74000000-0000-0000-0000-000000000001'$$);
SELECT t.eq('draft PO is not a commitment', (SELECT committed_sar FROM v_budget_code_position WHERE project_id = :'P1' AND budget_code = '1403'), 3000::numeric);
SELECT t.as_user(:'C');
UPDATE purchase_orders SET status = 'Approved' WHERE id = :'PO';
SELECT t.eq('another user approves; stamped', (SELECT approved_by FROM purchase_orders WHERE id = :'PO'), :'C'::uuid);
SELECT t.denied('approved PO amount frozen', $$UPDATE purchase_orders SET amount = 2000 WHERE id = '74000000-0000-0000-0000-000000000001'$$);
SELECT t.as_user(:'A');
SELECT t.eq('approved PO 1,000 adds to commitment', (SELECT committed_sar FROM v_budget_code_position WHERE project_id = :'P1' AND budget_code = '1403'), 4000::numeric);

-- ---- B05 / X12: invoice on the PO converts the commitment, no double count ----
SELECT actual_sar AS act0 FROM v_budget_code_position WHERE project_id = :'P1' AND budget_code = '1403' \gset
INSERT INTO invoices(id, project_id, organization_id, description, budget_code, price, vat_amount, vat_treatment, date, invoice_no, vendor_name, purchase_order_id, payment_terms)
VALUES (:'INV', :'P1', :'O1', 'Grip rental', '1403', 1000, 150, 'standard', '2026-10-05', 'G-1', 'Grip Co', :'PO', 'Net 30');
SELECT t.eq('PO commitment consumed by the invoice', (SELECT amount FROM v_ledger_transactions WHERE source_id = :'PO'), 0::numeric);
SELECT t.eq('PO + invoice on it = 1,000 in total (actual + commitment)',
  (SELECT actual_sar + committed_sar FROM v_budget_code_position WHERE project_id = :'P1' AND budget_code = '1403') - :act0 - 3000, 1000::numeric);
-- B15: due date from Net 30
SELECT t.eq('due date = invoice date + 30', (SELECT due_date::text FROM invoices WHERE id = :'INV'), '2026-11-04');
-- E09: GL account derived from the budget code (1403 -> GL-1300 Principal Cast)
SELECT t.eq('GL account derived from budget code', (SELECT g.code FROM invoices i JOIN gl_accounts g ON g.id = i.gl_account_id WHERE i.id = :'INV'), 'GL-1300');
SELECT t.eq('unknown code still gets an account', (SELECT g.code FROM gl_accounts g WHERE g.id = public.derive_gl_account(:'O1', 'ZZ')), 'GL-4400');
-- partial invoice leaves the rest committed
UPDATE invoices SET price = 600 WHERE id = :'INV';
SELECT t.eq('partial invoice leaves 400 committed', (SELECT amount FROM v_ledger_transactions WHERE source_id = :'PO'), 400::numeric);
-- cancelled PO is not a commitment
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);  -- 204: an approved PO is cancelled by an approver with a reason; here a server job
UPDATE purchase_orders SET status = 'Cancelled' WHERE id = :'PO';
SELECT t.eq('cancelled PO drops out', (SELECT count(*) FROM v_ledger_transactions WHERE source_id = :'PO'), 0::bigint);
-- a PO from another project cannot be linked
SELECT t.as_user(:'B');
INSERT INTO purchase_orders(id, project_id, organization_id, po_number, vendor_name, amount, status)
VALUES ('74000000-0000-0000-0000-000000000009', :'P2', '10000000-0000-0000-0000-000000000002', '', 'Other', 50, 'Draft');
SELECT t.eq('other project numbers its own POs', (SELECT po_number FROM purchase_orders WHERE id = '74000000-0000-0000-0000-000000000009'), 'OTH1-PO-0001');
SELECT t.as_user(:'A');
SELECT t.denied('PO of another project refused', $$UPDATE invoices SET purchase_order_id = '74000000-0000-0000-0000-000000000009' WHERE id = '74000000-0000-0000-0000-000000000002'$$);
SELECT t.denied('unknown VAT treatment refused', $$UPDATE invoices SET vat_treatment = 'half' WHERE id = '74000000-0000-0000-0000-000000000002'$$);
-- E07: VAT kept as entered (rounding difference vs 15%)
UPDATE invoices SET price = 10000, vat_amount = 1500.01 WHERE id = :'INV';
SELECT t.eq('VAT 1,500.01 stored as entered', (SELECT vat_amount FROM invoices WHERE id = :'INV'), 1500.01);

-- ---- B07: balance-sheet accounts available to petty cash ----
SELECT t.eq('bank and petty cash accounts exist', (SELECT count(*) FROM gl_accounts WHERE account_type IN ('bank','petty_cash')), 2::bigint);
SELECT t.eq('WHT account flagged', (SELECT account_type FROM gl_accounts WHERE code = '2140'), 'wht_payable');
SELECT t.eq('expense chart untouched', (SELECT count(*) FROM gl_accounts WHERE account_type = 'expense'), 25::bigint);
SELECT id AS bank_gl FROM gl_accounts WHERE code = '9100' \gset
SELECT id AS float_gl FROM gl_accounts WHERE code = '9120' \gset
RESET ROLE;
INSERT INTO people(id, kind, full_name, project_id, organization_id, is_petty_cash_custodian)
VALUES ('74000000-0000-0000-0000-000000000020', 'crew', 'QA Test One', :'P1', :'O1', true);
SELECT t.as_user(:'A');
INSERT INTO cash_advances(id, holder, total_advance, organization_id, project_id, status, person_id, funding_bank_gl_id, float_gl_id)
VALUES ('74000000-0000-0000-0000-000000000021', 'QA Test One', 3000, :'O1', :'P1', 'pending_approval', '74000000-0000-0000-0000-000000000020', :'bank_gl', :'float_gl');
SELECT t.eq('float saved with a bank account and a person', (SELECT count(*) FROM cash_advances WHERE person_id = '74000000-0000-0000-0000-000000000020' AND funding_bank_gl_id = :'bank_gl'), 1::bigint);
SELECT t.eq('issuing a float is not an expense', (SELECT count(*) FROM v_ledger_transactions WHERE source_id = '74000000-0000-0000-0000-000000000021'), 0::bigint);

-- ---- B20: car rental and accommodation are budget commitments ----
SELECT committed_sar AS c36 FROM v_budget_code_position WHERE project_id = :'P1' AND budget_code = '1403' \gset
INSERT INTO car_rentals(id, project_id, organization_id, make_model, license_plate, daily_rate, rate_type, rental_start_date, rental_end_date, budget_code)
VALUES ('74000000-0000-0000-0000-000000000030', :'P1', :'O1', 'GMC Yukon', 'ABC1234', 300, 'daily', '2026-10-01', '2026-10-10', '1403');
SELECT t.eq('car 10 days x 300', (SELECT total_amount FROM car_rentals WHERE id = '74000000-0000-0000-0000-000000000030'), 3000.00);
INSERT INTO accommodations(id, project_id, organization_id, person_id, hotel_name, check_in_date, check_out_date, nightly_rate, budget_code)
VALUES ('74000000-0000-0000-0000-000000000031', :'P1', :'O1', '74000000-0000-0000-0000-000000000020', 'Hotel', '2026-10-01', '2026-10-11', 500, '1403');
SELECT t.eq('hotel 10 nights', (SELECT nights FROM accommodations WHERE id = '74000000-0000-0000-0000-000000000031'), 10);
SELECT t.eq('hotel 10 nights x 500', (SELECT total_amount FROM accommodations WHERE id = '74000000-0000-0000-0000-000000000031'), 5000.00);
SELECT t.eq('both in the code commitment', (SELECT committed_sar FROM v_budget_code_position WHERE project_id = :'P1' AND budget_code = '1403') - :c36, 8000::numeric);
UPDATE car_rentals SET invoice_id = :'INV' WHERE id = '74000000-0000-0000-0000-000000000030';
SELECT t.eq('linked invoice converts the rental commitment', (SELECT amount FROM v_ledger_transactions WHERE source_id = '74000000-0000-0000-0000-000000000030'), 0::numeric);
SELECT t.eq('cost report sees the hotel commitment', (SELECT committed >= 5000 FROM get_cost_report(:'P1') WHERE budget_code = '1403'), true);

-- ---- tenant isolation of the new rows ----
SELECT t.as_user(:'B');
SELECT t.eq('tenant B cannot see org1 rentals in the ledger', (SELECT count(*) FROM v_ledger_transactions WHERE source_type IN ('car_rental','accommodation') AND project_id = :'P1'), 0::bigint);
RESET ROLE;
-- clean up so later files see the seed state
SET session_replication_role = replica;
DELETE FROM car_rentals WHERE id::text LIKE '74000000%';
DELETE FROM accommodations WHERE id::text LIKE '74000000%';
DELETE FROM cash_advances WHERE id::text LIKE '74000000%';
DELETE FROM people WHERE id::text LIKE '74000000%';
DELETE FROM invoices WHERE id::text LIKE '74000000%';
DELETE FROM purchase_orders WHERE id::text LIKE '74000000%' OR po_number LIKE 'MON26-PO-%';
SET session_replication_role = origin;
