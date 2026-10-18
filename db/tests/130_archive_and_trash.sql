\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-00000000000d'
\set E '00000000-0000-0000-0000-00000000000e'
\set P1 '20000000-0000-0000-0000-000000000001'
\set P4 '20000000-0000-0000-0000-000000000004'
\set INV '60000000-0000-0000-0000-000000000001'
-- baseline for "comes back in every report"
SELECT t.as_user(:'D');
SELECT actual AS a0, paid_to_date AS p0 FROM get_cost_report(:'P1') WHERE budget_code='1403' \gset
SELECT sum(actual) AS bt0 FROM get_budget_tracking(:'P1') WHERE budget_code='1403' \gset
-- delete an invoice (org admin) -> it lands in trash
DELETE FROM invoices WHERE id = :'INV';
SELECT t.eq('the invoice is gone from the table', (SELECT count(*) FROM invoices WHERE id=:'INV'), 0::bigint);
SELECT t.eq('...and from the cost report', (SELECT actual FROM get_cost_report(:'P1') WHERE budget_code='1403'), :a0::numeric - 5000);
SELECT t.eq('it is in the trash with a readable title', (SELECT title FROM trash_items WHERE record_id=:'INV'), 'Casting agency');
SELECT t.eq('trash records who deleted it', (SELECT deleted_by FROM trash_items WHERE record_id=:'INV'), :'D'::uuid);
SELECT t.eq('kept for 30 days', (SELECT expires_at = deleted_at + interval '30 days' FROM trash_items WHERE record_id=:'INV'), true);
SELECT id AS trash_id FROM trash_items WHERE record_id=:'INV' \gset
SELECT t.denied('trash cannot be edited directly', $$UPDATE trash_items SET restored_at = now()$$);
SELECT t.denied('trash cannot be emptied directly', $$DELETE FROM trash_items$$);
SELECT t.as_user(:'A');
SELECT t.eq('project members can see the trash', (SELECT count(*) FROM trash_items WHERE record_id=:'INV'), 1::bigint);
SELECT t.denied('a plain member cannot restore', format($$SELECT restore_trash_item(%L)$$, :'trash_id'));
SELECT t.as_user(:'B');
SELECT t.eq('another tenant sees nothing', (SELECT count(*) FROM trash_items), 0::bigint);
SELECT t.denied('another tenant cannot restore', format($$SELECT restore_trash_item(%L)$$, :'trash_id'));
-- restore
SELECT t.as_user(:'D');
SELECT t.eq('restore returns the original id', restore_trash_item(:'trash_id'), :'INV'::uuid);
SELECT t.eq('same row, same link to its budget line', (SELECT linked_budget_line_id IS NOT NULL AND price = 5000 FROM invoices WHERE id=:'INV'), true);
-- acceptance: it is back in every report
SELECT t.eq('back in the cost report: actual', (SELECT actual FROM get_cost_report(:'P1') WHERE budget_code='1403'), :a0::numeric);
SELECT t.eq('back in the cost report: its payment is linked again', (SELECT paid_to_date FROM get_cost_report(:'P1') WHERE budget_code='1403'), :p0::numeric);
SELECT t.eq('back in budget tracking', (SELECT sum(actual) FROM get_budget_tracking(:'P1') WHERE budget_code='1403'), :bt0::numeric);
SELECT t.eq('back in the ledger view', (SELECT count(*) FROM v_ledger_transactions WHERE source_id=:'INV' AND entry_kind='actual'), 1::bigint);
SELECT t.denied('cannot restore twice', format($$SELECT restore_trash_item(%L)$$, :'trash_id'));
RESET ROLE;
SELECT t.eq('delete and restore are both in the audit trail', (SELECT string_agg(operation, ',' ORDER BY created_at) FROM audit_history WHERE table_name='invoices' AND record_id=:'INV' AND operation IN ('DELETE','INSERT')), 'DELETE,INSERT');
-- purge
SELECT t.as_user(:'D');
SELECT t.denied('org admin cannot purge', $$SELECT purge_expired_trash()$$);
RESET ROLE;
UPDATE trash_items SET expires_at = now() - interval '1 day' WHERE record_id=:'INV';
SELECT t.as_user(:'E');
SELECT t.eq('platform owner purges expired items', purge_expired_trash(), 1);
-- D02: archive
SELECT t.as_user(:'A');
SELECT t.denied('a plain member cannot archive', $$SELECT archive_project('20000000-0000-0000-0000-000000000004','CSH1')$$);
SELECT t.as_user(:'D');
SELECT t.denied('hard delete of a live project is refused', $$DELETE FROM projects WHERE id='20000000-0000-0000-0000-000000000004'$$);
SELECT t.denied('archive needs the exact project code', $$SELECT archive_project('20000000-0000-0000-0000-000000000004','WRONG')$$);
SELECT archive_project(:'P4', ' csh1 ');
-- read back as superuser: org admin D is an explicit member of P1 only, and
-- can_access_project then hides the org's other projects from him (the known
-- inverted rule, pending-items no. 5) although he may administer them.
RESET ROLE;
SELECT t.eq('archived, previous status remembered', (SELECT status||'|'||archived_from_status||'|'||(archived_by = :'D'::uuid)::text FROM projects WHERE id=:'P4'), 'Archived|Production|true');
SELECT t.eq('all its data is still there', (SELECT count(*) > 0 FROM budget_lines WHERE project_id=:'P4'), true);
SELECT t.as_user(:'D');
SELECT t.denied('cannot archive twice', $$SELECT archive_project('20000000-0000-0000-0000-000000000004','CSH1')$$);
SELECT t.denied('an archived project cannot be deleted for 30 days', $$DELETE FROM projects WHERE id='20000000-0000-0000-0000-000000000004'$$);
SELECT t.eq('restore returns it to its previous status', restore_project(:'P4'), 'Production');
RESET ROLE;
SELECT t.eq('archive stamps cleared', (SELECT archived_at IS NULL AND archived_from_status IS NULL FROM projects WHERE id=:'P4'), true);
SELECT t.as_user(:'D');
SELECT t.denied('restore of a live project refused', $$SELECT restore_project('20000000-0000-0000-0000-000000000004')$$);
SELECT t.as_user(:'B');
SELECT t.denied('another tenant cannot archive', $$SELECT archive_project('20000000-0000-0000-0000-000000000004','CSH1')$$);
RESET ROLE;
SELECT t.eq('archive and restore are in the audit log', (SELECT string_agg(action, ',' ORDER BY created_at) FROM audit_logs WHERE project_id=:'P4' AND action LIKE 'project.%'), 'project.archived,project.restored');
-- after 30 days in the archive an admin may delete; children go to trash on the way
SELECT t.as_user(:'D'); SELECT archive_project(:'P4', 'CSH1'); RESET ROLE;
SET session_replication_role = replica; UPDATE projects SET archived_at = now() - interval '31 days' WHERE id=:'P4'; SET session_replication_role = origin;
SELECT t.as_user(:'E');
DELETE FROM projects WHERE id=:'P4';
RESET ROLE;
SELECT t.eq('after 30 days the archived project can be deleted', (SELECT count(*) FROM projects WHERE id=:'P4'), 0::bigint);
-- Finding recorded as a test: the foreign keys to projects are ON DELETE SET
-- NULL, so deleting a project does not delete its invoices / payroll /
-- payments — it leaves them behind with project_id = NULL, invisible to
-- every screen. That is why deletion is now gated behind a 30-day archive.
SELECT t.eq('a deleted project leaves its payroll row orphaned (project_id NULL)', (SELECT project_id IS NULL FROM payroll WHERE id='d4000000-0000-0000-0000-000000000001'), true);
SELECT t.eq('...and its invoice too', (SELECT project_id IS NULL FROM invoices WHERE id='c4000000-0000-0000-0000-000000000001'), true);
