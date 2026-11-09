-- 205 — report group modules, one-transaction contract save, invoice → PO
-- link, contracts still in their contract currency.
\set A  '00000000-0000-0000-0000-00000000000a'
\set B  '00000000-0000-0000-0000-00000000000b'
\set C  '00000000-0000-0000-0000-00000000000c'
\set D  '00000000-0000-0000-0000-00000000000d'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P  '20000000-0000-0000-0000-000000000205'
\set K1 '41000000-0000-0000-0000-000000000205'
\set K2 '41000000-0000-0000-0000-000000000206'
\set K3 '41000000-0000-0000-0000-000000000207'
\set PO '70000000-0000-0000-0000-000000000250'
\set PO2 '70000000-0000-0000-0000-000000000251'
\set PO3 '70000000-0000-0000-0000-000000000252'
\set I1 '61000000-0000-0000-0000-000000000250'
\set I2 '61000000-0000-0000-0000-000000000251'
\set I3 '61000000-0000-0000-0000-000000000252'

SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status) VALUES
 (:'P', :'A', 'Close old items', 'COI5', :'O1', 'USD', 3.75, 'Production');
INSERT INTO project_members(project_id,user_id) VALUES (:'P', :'A'), (:'P', :'C'), (:'P', :'D') ON CONFLICT DO NOTHING;
INSERT INTO budget_lines(project_id,organization_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency) VALUES
 (:'P', :'O1', '2100', '2101', '2100', 'Camera', 1, 50000, 1, 'Package', 'SAR'),
 (:'P', :'O1', '2200', '2201', '2200', 'Grip', 1, 50000, 1, 'Package', 'SAR');

-- ================================================================ 1. report group modules
SELECT t.eq('five report group modules', (SELECT count(*) FROM modules WHERE key LIKE 'reports-%'), 5::bigint);
SELECT t.eq('a role with reports view got every group (seed role T Editor)',
  (SELECT count(*) FROM role_permissions WHERE role_id = '30000000-0000-0000-0000-000000000001' AND module_key LIKE 'reports-%' AND can_view AND can_edit), 5::bigint);
SELECT t.eq('read-only reports role stays read-only per group',
  (SELECT bool_and(can_view AND NOT can_edit) FROM role_permissions WHERE role_id = '30000000-0000-0000-0000-000000000002' AND module_key LIKE 'reports-%'), true);
SELECT t.eq('system Producer: no Accounting / Cash groups',
  (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE r.slug = 'producer' AND r.is_system AND rp.module_key IN ('reports-accounting','reports-cash')), 0::bigint);
SELECT t.eq('system Producer keeps Budget & Cost if it had Reports',
  (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE r.slug = 'producer' AND r.is_system AND rp.module_key = 'reports-budget-cost')
  = (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE r.slug = 'producer' AND r.is_system AND rp.module_key = 'reports'), true);
SELECT t.as_user(:'A');
SELECT t.eq('can_view on a group module (A)', can_view('reports-payables'), true);
SELECT t.denied('only a super admin adds modules',
  $$INSERT INTO modules(key,label) VALUES ('reports-x','x')$$);
RESET role;

-- ================================================================ 2. contract in one transaction
SELECT t.as_user(:'A');
SELECT t.eq('new contract saved (people + payroll)',
  save_new_contract(
    jsonb_build_object('id', :'K1', 'kind', 'crew', 'full_name', 'Test Gaffer', 'project_id', :'P',
                       'organization_id', :'O1', 'ccy', 'SAR', 'shooting_days', 10, 'daily_rate', 500),
    jsonb_build_object('id', gen_random_uuid(), 'ref_id', :'K1', 'name', 'Test Gaffer', 'kind', 'crew',
                       'total_amount', 5000, 'payments', '[]'::jsonb, 'receipts', '[]'::jsonb,
                       'percents', '[]'::jsonb, 'ledger', '[]'::jsonb, 'payment_schedule', '[]'::jsonb,
                       'budget_code', '2101', 'project_id', :'P', 'organization_id', :'O1')),
  :'K1'::uuid);
SELECT t.eq('both rows exist',
  (SELECT count(*) FROM people WHERE id = :'K1') + (SELECT count(*) FROM payroll WHERE ref_id = :'K1'), 2::bigint);
SELECT t.eq('defaults kept (created_at / payments default not nulled)',
  (SELECT created_at IS NOT NULL FROM people WHERE id = :'K1'), true);
-- the payroll row is refused (bad wht_treatment) → the people row must not stay
SELECT t.denied('a failing payroll row aborts the whole save',
  format($$SELECT save_new_contract(%L::jsonb, %L::jsonb)$$,
    jsonb_build_object('id', :'K2', 'kind', 'cast', 'full_name', 'Half Saved', 'project_id', :'P', 'organization_id', :'O1'),
    jsonb_build_object('ref_id', :'K2', 'name', 'Half Saved', 'kind', 'cast', 'total_amount', 1,
                       'wht_treatment', 'bogus', 'project_id', :'P', 'organization_id', :'O1')));
SELECT t.eq('nothing left behind after the failed save', (SELECT count(*) FROM people WHERE id = :'K2'), 0::bigint);
SELECT t.denied('payroll of another contract refused',
  format($$SELECT save_new_contract(%L::jsonb, %L::jsonb)$$,
    jsonb_build_object('id', :'K2', 'kind', 'cast', 'full_name', 'X', 'project_id', :'P'),
    jsonb_build_object('ref_id', :'K1', 'name', 'X', 'kind', 'cast', 'project_id', :'P')));
SELECT t.denied('the generic helper only writes the contract tables',
  format($$SELECT insert_row_from_jsonb('public.invoices'::regclass, %L::jsonb)$$, jsonb_build_object('price', 1)));
SELECT t.as_user(:'B');
SELECT t.denied('another tenant cannot save a contract into this project',
  format($$SELECT save_new_contract(%L::jsonb, %L::jsonb)$$,
    jsonb_build_object('id', :'K3', 'kind', 'crew', 'full_name', 'Intruder', 'project_id', :'P', 'organization_id', :'O1'),
    jsonb_build_object('ref_id', :'K3', 'name', 'Intruder', 'kind', 'crew', 'total_amount', 1, 'project_id', :'P', 'organization_id', :'O1')));
RESET role;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('intruder wrote nothing', (SELECT count(*) FROM people WHERE id = :'K3'), 0::bigint);

-- the creator is written by the database (review of 205)
SELECT t.as_user(:'C');
SELECT save_new_contract(
  jsonb_build_object('id', :'K3', 'kind', 'crew', 'full_name', 'Self Approver', 'project_id', :'P',
                     'organization_id', :'O1', 'created_by', :'A', 'contract_status', 'Signed - Awaiting Review'),
  jsonb_build_object('ref_id', :'K3', 'name', 'Self Approver', 'kind', 'crew', 'total_amount', 50000,
                     'project_id', :'P', 'organization_id', :'O1'));
SELECT t.eq('created_by sent by the client is replaced by the real creator', (SELECT created_by FROM people WHERE id = :'K3'), :'C'::uuid);
SELECT t.denied('the creator cannot be changed afterwards', format($$UPDATE people SET created_by = %L WHERE id = %L$$, :'A', :'K3'));
SELECT t.denied('so the creator still cannot approve his own contract', format($$UPDATE people SET contract_status = 'Active' WHERE id = %L$$, :'K3'));
RESET role;
SELECT set_config('request.jwt.claim.sub', '', false);

-- ================================================================ 3. invoice → PO link
SELECT t.as_user(:'A');
INSERT INTO purchase_orders(id,organization_id,project_id,vendor_name,amount,budget_code,status,po_number,date) VALUES
 (:'PO', :'O1',:'P','Lens Co',1000,'2101','Draft','COI5-PO-1','2026-10-01'),
 (:'PO2',:'O1',:'P','Lens Co',300,'2101','Draft','COI5-PO-2','2026-10-01'),
 (:'PO3',:'O1',:'P','Other Co',5000,'2101','Draft','COI5-PO-3','2026-10-01');
SELECT t.as_user(:'D');
UPDATE purchase_orders SET status = 'Approved' WHERE id IN (:'PO', :'PO2', :'PO3');
SELECT t.as_user(:'A');
INSERT INTO invoices(id,description,budget_code,price,date,vendor_name,invoice_no,organization_id,project_id) VALUES
 (:'I1','Lens rental','2101',1000,'2026-10-05','Lens Co','INV-2051',:'O1',:'P'),
 (:'I2','Lens rental 2','2201',100,'2026-10-06','Lens Co','INV-2052',:'O1',:'P');
SELECT t.as_user(:'D');
SELECT approve_invoice(:'I1');
SELECT t.as_user(:'A');
SELECT t.eq('before linking: PO 1,000 still a commitment while the invoice is actual',
  (SELECT sum(total) FROM v_ledger_transactions WHERE source_id = :'PO' AND entry_kind = 'commitment'), 1000::numeric);
SELECT t.denied('linking an APPROVED invoice needs an invoice approver (A is not)', format($$SELECT link_invoice_to_po(%L, %L)$$, :'I1', :'PO'));
SELECT t.as_user(:'D');
SELECT t.denied('PO of another vendor refused', format($$SELECT link_invoice_to_po(%L, %L)$$, :'I1', :'PO3'));
SELECT t.denied('invoice bigger than the open PO amount refused', format($$SELECT link_invoice_to_po(%L, %L)$$, :'I1', :'PO2'));
SELECT link_invoice_to_po(:'I1', :'PO');
SELECT t.as_user(:'A');
SELECT t.denied('PO on another budget code refused', format($$SELECT link_invoice_to_po(%L, %L)$$, :'I2', :'PO'));
SELECT t.eq('approved invoice linked to its PO', (SELECT purchase_order_id FROM invoices WHERE id = :'I1'), :'PO'::uuid);
SELECT t.eq('after linking: the PO commitment is relieved (no double count)',
  (SELECT COALESCE(sum(total), 0) FROM v_ledger_transactions WHERE source_id = :'PO' AND entry_kind = 'commitment'), 0::numeric);
SELECT t.eq('the invoice stays approved', (SELECT approval_status FROM invoices WHERE id = :'I1'), 'approved');
SELECT t.denied('the PO of an approved invoice cannot be changed again', format($$UPDATE invoices SET purchase_order_id = %L WHERE id = %L$$, :'PO2', :'I1'));
SELECT t.denied('… nor removed', format($$UPDATE invoices SET purchase_order_id = NULL WHERE id = %L$$, :'I1'));
SELECT t.denied('amounts of an approved invoice are still locked', format($$UPDATE invoices SET price = 5 WHERE id = %L$$, :'I1'));
-- a pending invoice can be linked / moved freely within the rules
UPDATE invoices SET budget_code = '2101' WHERE id = :'I2';
SELECT link_invoice_to_po(:'I2', :'PO2');
SELECT t.denied('raising a linked pending invoice above the open PO amount refused',
  format($$UPDATE invoices SET price = 999999 WHERE id = %L$$, :'I2'));
UPDATE invoices SET price = 150 WHERE id = :'I2';
SELECT t.eq('a linked pending invoice can still be raised within the PO', (SELECT price FROM invoices WHERE id = :'I2'), 150::numeric);
UPDATE invoices SET purchase_order_id = NULL WHERE id = :'I2';
SELECT t.eq('a pending invoice can be unlinked', (SELECT purchase_order_id IS NULL FROM invoices WHERE id = :'I2'), true);
SELECT t.as_user(:'D');
SELECT cancel_purchase_order(:'PO2', 'not needed');
SELECT t.as_user(:'A');
SELECT t.denied('a cancelled PO takes no invoice', format($$SELECT link_invoice_to_po(%L, %L)$$, :'I2', :'PO2'));
SELECT t.denied('a new invoice cannot be raised on a cancelled PO',
  format($$INSERT INTO invoices(id,description,budget_code,price,date,vendor_name,invoice_no,organization_id,project_id,purchase_order_id) VALUES (%L,'x','2101',1,'2026-10-07','Lens Co','INV-2053',%L,%L,%L)$$,
    :'I3', :'O1', :'P', :'PO2'));
SELECT t.as_user(:'B');
SELECT t.denied('another tenant cannot link', format($$SELECT link_invoice_to_po(%L, %L)$$, :'I2', :'PO'));
RESET role;

-- ================================================================ 4. contracts still in contract currency
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO people(id,kind,full_name,organization_id,project_id,ccy,shooting_days,daily_rate)
VALUES (:'K2','cast','Old USD Actor',:'O1',:'P','USD',4,500);
INSERT INTO payroll(ref_id,name,kind,total_amount,project_id,organization_id)
VALUES (:'K2','Old USD Actor','cast',2000,:'P',:'O1');
SELECT t.as_user(:'A');
SELECT t.eq('old USD contract listed with its expected SAR total',
  (SELECT full_name||'|'||stored_total||'|'||expected_total FROM contracts_not_in_base_currency(:'P')), 'Old USD Actor|2000|7500.00');
SELECT t.as_user(:'B');
SELECT t.eq('another tenant sees nothing', (SELECT count(*) FROM contracts_not_in_base_currency(:'P')), 0::bigint);
RESET role;
SELECT set_config('request.jwt.claim.sub', '', false);
