\set A '00000000-0000-0000-0000-00000000000a'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-00000000000d'
\set P1 '20000000-0000-0000-0000-000000000001'
\set P2 '20000000-0000-0000-0000-000000000002'
\set O1 '10000000-0000-0000-0000-000000000001'
\set I1 '18400000-0000-0000-0000-000000000001'
\set I2 '18400000-0000-0000-0000-000000000002'
\set PO1 '18400000-0000-0000-0000-000000000003'
\set LEG '18400000-0000-0000-0000-000000000004'
\set LEGPO '18400000-0000-0000-0000-000000000005'
CREATE OR REPLACE FUNCTION t.as_system() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', '', false); PERFORM set_config('role', 'postgres', false); END $$;
SELECT t.as_system();

-- ===================================================================
-- G07 first: the rows that existed before 184 (seed + earlier test files
-- that wrote with triggers off) are numbered by the backfill, and nothing
-- else moves. Two legacy rows are added the way old data looks: no ref_no,
-- one PO already numbered by 174.
-- ===================================================================
SET session_replication_role = replica;
INSERT INTO invoices(id, description, budget_code, price, date, organization_id, project_id, created_at)
VALUES (:'LEG', 'Legacy invoice', '1403', 250, '2026-10-10', :'O1', :'P1', '2020-01-01');
INSERT INTO purchase_orders(id, po_number, vendor_name, budget_code, amount, status, organization_id, project_id, created_at)
VALUES (:'LEGPO', 'MON26-PO-0050', 'Old vendor', '1403', 100, 'Draft', :'O1', :'P1', '2020-01-02');
SET session_replication_role = origin;
SELECT t.eq('legacy rows have no number yet', (SELECT count(*) FROM invoices WHERE ref_no IS NULL AND project_id = :'P1') > 0, true);

CREATE TEMP TABLE snap AS
SELECT 'ledger'::text AS k, project_id::text AS p, count(*)::numeric AS n, sum(amount) AS s1, sum(total) AS s2
  FROM v_ledger_transactions GROUP BY project_id
UNION ALL
SELECT 'position', project_id::text, count(*), sum(actual_sar), sum(committed_sar) FROM v_budget_code_position GROUP BY project_id;
CREATE TEMP TABLE rowhash AS
SELECT 'invoices' AS tbl, md5(string_agg((to_jsonb(x) - 'ref_no')::text, '|' ORDER BY x.id)) AS h FROM invoices x
UNION ALL SELECT 'payroll', md5(string_agg((to_jsonb(x) - 'ref_no')::text, '|' ORDER BY x.id)) FROM payroll x
UNION ALL SELECT 'purchase_orders', md5(string_agg((to_jsonb(x) - 'ref_no')::text, '|' ORDER BY x.id)) FROM purchase_orders x
UNION ALL SELECT 'payments', md5(string_agg((to_jsonb(x) - 'ref_no')::text, '|' ORDER BY x.id)) FROM payments x
UNION ALL SELECT 'cash_advance_receipts', md5(string_agg((to_jsonb(x) - 'ref_no')::text, '|' ORDER BY x.id)) FROM cash_advance_receipts x;
SELECT count(*) AS audit0 FROM audit_history \gset

SELECT count(*) AS bf_groups FROM backfill_document_refs() \gset
SELECT t.eq('backfill numbered something', :bf_groups > 0, true);
SELECT t.eq('no document of a coded project is left without a number',
  (SELECT count(*) FROM v_document_refs r JOIN projects p ON p.id = r.project_id WHERE r.ref_no IS NULL), 0::bigint);
SELECT t.eq('no duplicate reference number in any project',
  (SELECT count(*) FROM (SELECT project_id, ref_no FROM v_document_refs WHERE ref_no IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) d), 0::bigint);
SELECT t.eq('every number has the format', (SELECT bool_and(ref_no ~ ('^' || p.code || '-(PO|INV|CRW|CST|PC|PD|OT|PMT|FND)-[0-9]{4,}$'))
  FROM v_document_refs r JOIN projects p ON p.id = r.project_id), true);
SELECT t.eq('document count unchanged', (SELECT count(*) FROM snap s WHERE s.k = 'ledger'
  AND s.n = (SELECT count(*) FROM v_ledger_transactions v WHERE v.project_id::text IS NOT DISTINCT FROM s.p)), (SELECT count(*) FROM snap WHERE k = 'ledger'));
SELECT t.eq('ledger totals unchanged', (SELECT count(*) FROM snap s WHERE s.k = 'ledger'
  AND (s.s1, s.s2) = (SELECT sum(amount), sum(total) FROM v_ledger_transactions v WHERE v.project_id::text IS NOT DISTINCT FROM s.p)), (SELECT count(*) FROM snap WHERE k = 'ledger'));
SELECT t.eq('budget position totals unchanged', (SELECT count(*) FROM snap s WHERE s.k = 'position'
  AND (s.s1, s.s2) = (SELECT sum(actual_sar), sum(committed_sar) FROM v_budget_code_position v WHERE v.project_id::text IS NOT DISTINCT FROM s.p)), (SELECT count(*) FROM snap WHERE k = 'position'));
SELECT t.eq('only ref_no was written (every other column identical, updated_at included)',
  (SELECT count(*) FROM rowhash h WHERE h.h = CASE h.tbl
     WHEN 'invoices' THEN (SELECT md5(string_agg((to_jsonb(x) - 'ref_no')::text, '|' ORDER BY x.id)) FROM invoices x)
     WHEN 'payroll' THEN (SELECT md5(string_agg((to_jsonb(x) - 'ref_no')::text, '|' ORDER BY x.id)) FROM payroll x)
     WHEN 'purchase_orders' THEN (SELECT md5(string_agg((to_jsonb(x) - 'ref_no')::text, '|' ORDER BY x.id)) FROM purchase_orders x)
     WHEN 'payments' THEN (SELECT md5(string_agg((to_jsonb(x) - 'ref_no')::text, '|' ORDER BY x.id)) FROM payments x)
     ELSE (SELECT md5(string_agg((to_jsonb(x) - 'ref_no')::text, '|' ORDER BY x.id)) FROM cash_advance_receipts x) END), 5::bigint);
SELECT t.eq('backfill did not write row-level audit noise', (SELECT count(*) FROM audit_history), :audit0::bigint);
SELECT t.eq('PO already numbered by 174 keeps its number', (SELECT ref_no FROM purchase_orders WHERE id = :'LEGPO'), 'MON26-PO-0050');
SELECT t.eq('oldest invoice numbered first', (SELECT ref_no FROM invoices WHERE id = :'LEG') <
  ALL (SELECT ref_no FROM invoices WHERE id = '60000000-0000-0000-0000-000000000002'), true);
SELECT t.eq('seed payroll (cast/crew) gets CRW', (SELECT ref_no LIKE 'MON26-CRW-%' FROM payroll WHERE id = '50000000-0000-0000-0000-000000000001'), true);
SELECT t.eq('other tenant numbered with its own code', (SELECT ref_no LIKE 'OTH1-%' FROM payroll WHERE id = '50000000-0000-0000-0000-000000000009'), true);
SELECT t.eq('counter = last number', (SELECT last_no FROM document_ref_counters WHERE project_id = :'P1' AND doc_type = 'PO') >= 50, true);
SELECT t.eq('second run numbers nothing', (SELECT count(*) FROM backfill_document_refs()), 0::bigint);
SELECT t.as_user(:'A');
SELECT t.denied('an ordinary user cannot run the backfill', $$SELECT * FROM backfill_document_refs()$$);
SELECT t.denied('an ordinary user cannot burn numbers', $$SELECT next_document_ref('20000000-0000-0000-0000-000000000001', 'INV')$$);

-- ===================================================================
-- G06: numbers for new documents
-- ===================================================================
SELECT last_no AS inv0 FROM document_ref_counters WHERE project_id = :'P1' AND doc_type = 'INV' \gset
INSERT INTO invoices(id, description, budget_code, price, date, organization_id, project_id, ref_no)
VALUES (:'I1', 'Lens rental', '1403', 1000, '2026-10-10', :'O1', :'P1', 'MON26-INV-9999');
INSERT INTO invoices(id, description, budget_code, price, date, organization_id, project_id)
VALUES (:'I2', 'Lens rental 2', '1403', 500, '2026-10-10', :'O1', :'P1');
SELECT t.eq('new invoice takes the next number', (SELECT ref_no FROM invoices WHERE id = :'I1'), document_ref_format('MON26', 'INV', :inv0 + 1));
SELECT t.eq('a number sent by the client is ignored', (SELECT count(*) FROM invoices WHERE ref_no = 'MON26-INV-9999'), 0::bigint);
SELECT t.eq('two invoices, two numbers', (SELECT count(DISTINCT ref_no) FROM invoices WHERE id IN (:'I1', :'I2')), 2::bigint);
SELECT t.eq('vendor invoice number stays separate', (SELECT invoice_no IS NULL FROM invoices WHERE id = :'I1'), true);
SELECT t.denied('ref_no cannot be edited', $$UPDATE invoices SET ref_no = 'MON26-INV-0001' WHERE id = '18400000-0000-0000-0000-000000000001'$$);
SELECT t.denied('ref_no cannot be cleared', $$UPDATE invoices SET ref_no = NULL WHERE id = '18400000-0000-0000-0000-000000000001'$$);
UPDATE invoices SET price = 1200 WHERE id = :'I1';
SELECT t.eq('other edits keep the number', (SELECT ref_no FROM invoices WHERE id = :'I1'), document_ref_format('MON26', 'INV', :inv0 + 1));
-- PO: number from the shared counter, also used as po_number (continues after the kept 0050)
INSERT INTO purchase_orders(id, project_id, organization_id, po_number, vendor_name, amount, status)
VALUES (:'PO1', :'P1', :'O1', '', 'Camera Co', 300, 'Draft');
SELECT t.eq('PO continues after the highest PO number', (SELECT substring(ref_no FROM '[0-9]+$')::int > 50 FROM purchase_orders WHERE id = :'PO1'), true);
SELECT t.eq('PO number = reference number', (SELECT po_number = ref_no FROM purchase_orders WHERE id = :'PO1'), true);
INSERT INTO purchase_orders(project_id, organization_id, po_number, vendor_name, amount, status)
VALUES (:'P1', :'O1', 'VENDOR-REF-7', 'Typed Co', 10, 'Draft');
SELECT t.eq('typed PO number kept, ref_no still issued', (SELECT ref_no LIKE 'MON26-PO-%' FROM purchase_orders WHERE po_number = 'VENDOR-REF-7'), true);
-- contract types, payment, funding
SELECT t.as_system();
INSERT INTO payroll(id, name, kind, total_amount, budget_code, organization_id, project_id)
VALUES ('18400000-0000-0000-0000-000000000006', 'Lead actor', 'cast', 1000, '1403', :'O1', :'P1');
SELECT t.eq('cast contract -> CST', (SELECT ref_no LIKE 'MON26-CST-%' FROM payroll WHERE id = '18400000-0000-0000-0000-000000000006'), true);
INSERT INTO payments(organization_id, project_id, source_type, source_id, amount, payment_date)
VALUES (:'O1', :'P1', 'invoice', :'I1', 100, '2026-10-20');
SELECT t.eq('payment -> PMT and its parent is the invoice',
  (SELECT ref_no LIKE 'MON26-PMT-%' AND parent_type = 'invoice' AND parent_id = :'I1' FROM v_document_refs WHERE source_type = 'payment' AND parent_id = :'I1'), true);
INSERT INTO project_funding(project_id, funding_date, amount, reference) VALUES (:'P1', '2026-10-01', 5000, 'BANK-77');
SELECT t.eq('funding -> FND, bank reference kept apart',
  (SELECT ref_no LIKE 'MON26-FND-%' AND external_no = 'BANK-77' FROM v_document_refs WHERE source_type = 'funding' AND external_no = 'BANK-77'), true);
SELECT t.denied('even the owner cannot change a number', $$UPDATE payroll SET ref_no = 'X' WHERE id = '18400000-0000-0000-0000-000000000006'$$);
SELECT t.eq('1 -> 0001, 12345 kept whole', document_ref_format('mon26', 'PO', 1) || ' ' || document_ref_format('MON26', 'PO', 12345), 'MON26-PO-0001 MON26-PO-12345');
-- deleted number is never reused
SELECT last_no AS inv1 FROM document_ref_counters WHERE project_id = :'P1' AND doc_type = 'INV' \gset
DELETE FROM invoices WHERE id = :'I2';
INSERT INTO invoices(description, budget_code, price, date, organization_id, project_id) VALUES ('After delete', '1403', 1, '2026-10-10', :'O1', :'P1');
SELECT t.eq('a deleted number is not reused', (SELECT ref_no FROM invoices WHERE description = 'After delete'), document_ref_format('MON26', 'INV', :inv1 + 1));
-- restoring from the Trash brings the old number back
SELECT t.as_user(:'D');
SELECT restore_trash_item((SELECT id FROM trash_items WHERE table_name = 'invoices' AND record_id = :'I2'));
SELECT t.eq('restored invoice keeps its number', (SELECT ref_no FROM invoices WHERE id = :'I2'), document_ref_format('MON26', 'INV', :inv0 + 2));
-- G08 search: partial reference across the project
SELECT t.as_user(:'A');
SELECT t.eq('partial reference search finds the PO', (SELECT count(*) FROM v_document_refs WHERE project_id = :'P1' AND ref_no ILIKE '%PO-0050%'), 1::bigint);
SELECT t.as_user('00000000-0000-0000-0000-00000000000b');
SELECT t.eq('another tenant sees none of these numbers', (SELECT count(*) FROM v_document_refs WHERE project_id = :'P1'), 0::bigint);
SELECT t.eq('another tenant cannot read the counters', (SELECT count(*) FROM document_ref_counters WHERE project_id = :'P1'), 0::bigint);

-- ===================================================================
-- G12 / D07: who, when, before -> after; append-only
-- ===================================================================
SELECT t.as_user(:'A');
SELECT t.eq('create row with the user name', (SELECT action || ' ' || actor_name FROM v_audit_trail WHERE table_name = 'invoices' AND record_id = :'I1' AND operation = 'INSERT'), 'create Accountant A');
SELECT t.eq('amount edit shows from/to', (SELECT changed_fields->'price'->>'from' || '->' || (changed_fields->'price'->>'to') FROM v_audit_trail
  WHERE table_name = 'invoices' AND record_id = :'I1' AND action = 'update'), '1000->1200');
SELECT t.eq('approve', audit_action('payment_requests', 'UPDATE', '{"status":{"from":"waiting_approval","to":"approved"}}'), 'approve');
SELECT t.eq('pay', audit_action('payment_requests', 'UPDATE', '{"status":{"from":"approved","to":"paid"}}'), 'pay');
SELECT t.eq('reject', audit_action('payment_requests', 'UPDATE', '{"status":{"from":"waiting_approval","to":"rejected"}}'), 'reject');
SELECT t.eq('payment insert = pay', audit_action('payments', 'INSERT', '{}'), 'pay');
SELECT t.eq('delete', audit_action('invoices', 'DELETE', '{}'), 'delete');
SELECT t.denied('user cannot edit the audit trail', $$UPDATE audit_history SET operation = 'INSERT'$$);
SELECT t.denied('user cannot delete the audit trail', $$DELETE FROM audit_history$$);
SELECT t.as_user(:'D');
SELECT t.denied('admin cannot delete the audit trail', $$DELETE FROM audit_history$$);
SELECT t.denied('admin cannot delete audit logs', $$DELETE FROM audit_logs$$);
SELECT t.as_system();
SELECT t.denied('table owner cannot update audit_history', $$UPDATE audit_history SET operation = 'INSERT' WHERE table_name = 'invoices'$$);
SELECT t.denied('table owner cannot delete audit_history', $$DELETE FROM audit_history WHERE table_name = 'invoices'$$);
SELECT t.denied('table owner cannot truncate audit_history', $$TRUNCATE audit_history$$);
SELECT t.denied('table owner cannot rewrite audit_logs', $$UPDATE audit_logs SET summary = 'x'$$);
SELECT t.denied('table owner cannot truncate audit_logs', $$TRUNCATE audit_logs$$);
-- a user leaving still works (FK ON DELETE SET NULL on audit_logs)
SET session_replication_role = replica;
INSERT INTO auth.users(id, email) VALUES ('18400000-0000-0000-0000-0000000000ff', 'leaver@org1.test');
SET session_replication_role = origin;
INSERT INTO audit_logs(organization_id, actor_id, category, action, summary) VALUES (:'O1', '18400000-0000-0000-0000-0000000000ff', 'other', 't', 'leaver');
DELETE FROM auth.users WHERE id = '18400000-0000-0000-0000-0000000000ff';
SELECT t.eq('removing a user keeps the log row, actor cleared', (SELECT actor_id IS NULL FROM audit_logs WHERE summary = 'leaver'), true);

-- ===================================================================
-- X15: project lock enforced by the database
-- ===================================================================
SELECT t.as_user(:'A');
SELECT t.denied('an accountant cannot lock the project', $$SELECT set_project_lock('20000000-0000-0000-0000-000000000001', true, 'month end')$$);
SELECT t.as_user(:'D');
SELECT t.eq('org admin locks the project', (SELECT set_project_lock(:'P1', true, 'Wrap — final cost') IS NOT NULL), true);
SELECT t.as_user(:'A');
SELECT t.denied('no new expense on a locked project', $$INSERT INTO invoices(description, budget_code, price, date, organization_id, project_id) VALUES ('Late', '1403', 9, '2026-10-10', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001')$$);
SELECT t.denied('no edit on a locked project', $$UPDATE invoices SET price = 1 WHERE id = '18400000-0000-0000-0000-000000000001'$$);
SELECT t.denied('no delete on a locked project', $$DELETE FROM invoices WHERE id = '18400000-0000-0000-0000-000000000001'$$);
SELECT t.denied('no petty cash on a locked project', $$UPDATE cash_advance_receipts SET amount = 1 WHERE id = '90000000-0000-0000-0000-000000000001'$$);
SELECT t.denied('cannot unlock by editing the project row', $$UPDATE projects SET locked_at = NULL WHERE id = '20000000-0000-0000-0000-000000000001'$$);
-- the special permission
SELECT t.as_system();
INSERT INTO role_permissions(role_id, module_key, can_view, can_edit) VALUES ('30000000-0000-0000-0000-000000000001', 'project-lock', true, true);
SELECT t.as_user(:'A');
INSERT INTO invoices(description, budget_code, price, date, organization_id, project_id) VALUES ('With override', '1403', 9, '2026-10-10', :'O1', :'P1');
SELECT t.eq('override permission allows the entry', (SELECT count(*) FROM invoices WHERE description = 'With override'), 1::bigint);
SELECT t.as_system();
DELETE FROM role_permissions WHERE module_key = 'project-lock';
SELECT t.as_user(:'D');
SELECT t.eq('org admin unlocks', (SELECT set_project_lock(:'P1', false) IS NULL), true);
SELECT t.as_user(:'A');
UPDATE invoices SET price = 1300 WHERE id = :'I1';
SELECT t.eq('unlocked project accepts edits again', (SELECT price FROM invoices WHERE id = :'I1'), 1300::numeric);
SELECT t.eq('lock and unlock are logged', (SELECT count(*) FROM audit_logs WHERE project_id = :'P1' AND action IN ('project.locked', 'project.unlocked')) >= 2, true);
-- archived project behaves like a locked one
SELECT t.as_system();
UPDATE projects SET status = 'Archived', archived_from_status = status, archived_at = now() WHERE id = :'P1';
SELECT t.as_user(:'A');
SELECT t.denied('no new expense on an archived project', $$INSERT INTO invoices(description, budget_code, price, date, organization_id, project_id) VALUES ('Late', '1403', 9, '2026-10-10', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001')$$);
SELECT t.as_system();
UPDATE projects SET status = 'Pre-Production', archived_from_status = NULL, archived_at = NULL WHERE id = :'P1';

-- ===================================================================
-- N10: Budget Change Log
-- ===================================================================
SELECT t.as_system();
UPDATE projects SET budget_status = 'Draft' WHERE id = :'P1';
SELECT t.as_user(:'A');
UPDATE budget_lines SET rate = 1500, change_reason = 'Day rate renegotiated'
 WHERE project_id = :'P1' AND description = 'Actor A';
SELECT t.eq('change log: before / after / reason / user',
  (SELECT before_sar || ' -> ' || after_sar || ' | ' || reason || ' | ' || actor_name FROM v_budget_change_log
    WHERE project_id = :'P1' AND description = 'Actor A' AND operation = 'UPDATE' ORDER BY changed_at DESC LIMIT 1),
  '10000.00 -> 15000.00 | Day rate renegotiated | Accountant A');
SELECT t.eq('change log carries the version', (SELECT version_name FROM v_budget_change_log
    WHERE project_id = :'P1' AND description = 'Actor A' AND operation = 'UPDATE' LIMIT 1), 'v1.0');
UPDATE budget_lines SET notes = 'typo' WHERE project_id = :'P1' AND description = 'Actor A';
SELECT t.eq('a later edit without a new reason shows no stale reason', (SELECT reason IS NULL FROM v_budget_change_log
    WHERE project_id = :'P1' AND description = 'Actor A' AND changed_fields ? 'notes' ORDER BY changed_at DESC LIMIT 1), true);
SELECT t.as_user('00000000-0000-0000-0000-00000000000b');
SELECT t.eq('another tenant sees no budget changes', (SELECT count(*) FROM v_budget_change_log WHERE project_id = :'P1'), 0::bigint);
SELECT t.as_system();
