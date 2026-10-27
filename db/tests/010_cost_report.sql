\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set P1 '20000000-0000-0000-0000-000000000001'
\set P2 '20000000-0000-0000-0000-000000000002'
SELECT t.as_user(:'A');
CREATE TEMP TABLE r AS SELECT * FROM get_cost_report(:'P1','2026-09-01','2026-09-30');
GRANT ALL ON r TO PUBLIC;
SELECT t.eq('one row per code (4 lines of 1101 -> 1 row)', (SELECT count(*) FROM r WHERE budget_code='1101'), 1::bigint);
SELECT t.eq('1101 estimate = active version only (draft 999,999 ignored)', (SELECT estimate FROM r WHERE budget_code='1101'), 315000.00);
-- 180 glossary: a contract is a commitment; only what was approved / paid on it is actual
SELECT t.eq('1101 actual = paid on the contracts', (SELECT actual FROM r WHERE budget_code='1101'), 2000.00);
SELECT t.eq('1101 commitment = rest of the contracts', (SELECT committed FROM r WHERE budget_code='1101'), 241039.47);
SELECT t.eq('1101 paid in Sep 2026 = 0', (SELECT paid_period FROM r WHERE budget_code='1101'), 0.00);
SELECT t.eq('1101 paid to date = 2,000', (SELECT paid_to_date FROM r WHERE budget_code='1101'), 2000.00);
SELECT t.eq('1101 default ETC = estimate-actual-committed', (SELECT etc FROM r WHERE budget_code='1101'), 71960.53);
SELECT t.eq('1403 actual = invoice 5,000 + petty cash 800', (SELECT actual FROM r WHERE budget_code='1403'), 5800.00);
SELECT t.eq('1403 committed = PO 3,000', (SELECT committed FROM r WHERE budget_code='1403'), 3000.00);
SELECT t.eq('1403 group from top sheet', (SELECT "group" FROM r WHERE budget_code='1403'), 'ATL');
SELECT t.eq('unbudgeted code 7003 shows as overspend', (SELECT variance FROM r WHERE budget_code='7003'), -1200.00);
SELECT t.eq('unresolvable payment kept on a NULL-code row', (SELECT paid_to_date FROM r WHERE budget_code IS NULL), 400.00);
SELECT t.eq('total estimate', (SELECT sum(estimate) FROM r), 335000.00);
SELECT t.eq('total paid_to_date = payments ledger', (SELECT sum(paid_to_date) FROM r), (SELECT sum(amount) FROM payments WHERE project_id=:'P1'));
SELECT t.eq('total actual = ledger actuals', (SELECT sum(actual) FROM r), (SELECT round(sum(amount),2) FROM v_ledger_transactions WHERE project_id=:'P1' AND entry_kind='actual'));
SELECT t.eq('EFC = actual + committed + ETC on every row', (SELECT count(*) FROM r WHERE efc <> actual + committed + etc), 0::bigint);
SELECT t.eq('variance = estimate - EFC on every row', (SELECT count(*) FROM r WHERE variance <> estimate - efc), 0::bigint);
-- period only moves the paid columns
SELECT t.eq('Oct 2025 period: paid_period 2,000', (SELECT sum(paid_period) FROM get_cost_report(:'P1','2025-10-01','2025-10-31')), 2000.00);
SELECT t.eq('Oct 2025 period: actual unchanged', (SELECT sum(actual) FROM get_cost_report(:'P1','2025-10-01','2025-10-31')), (SELECT sum(actual) FROM r));
SELECT t.eq('no dates = project to date', (SELECT sum(paid_period) FROM get_cost_report(:'P1')), 3900.00);
SELECT t.denied('from > to is rejected', $$SELECT * FROM get_cost_report('20000000-0000-0000-0000-000000000001','2026-10-01','2026-09-01')$$);
-- ETC edit: stamped by the database, client-supplied org / updated_by ignored
INSERT INTO cost_report_etc(organization_id, project_id, budget_code, etc_amount, updated_by)
VALUES ('10000000-0000-0000-0000-000000000002', :'P1', '1403', 9000, :'B');
SELECT t.eq('ETC org forced to the project''s org', (SELECT organization_id FROM cost_report_etc WHERE budget_code='1403'), '10000000-0000-0000-0000-000000000001'::uuid);
SELECT t.eq('ETC updated_by = caller', (SELECT updated_by FROM cost_report_etc WHERE budget_code='1403'), :'A'::uuid);
SELECT t.eq('manual ETC drives EFC', (SELECT efc FROM get_cost_report(:'P1') WHERE budget_code='1403'), 17800.00);
SELECT t.eq('manual ETC flagged', (SELECT etc_is_manual FROM get_cost_report(:'P1') WHERE budget_code='1403'), true);
SELECT t.denied('negative ETC rejected', $$UPDATE cost_report_etc SET etc_amount = -1 WHERE budget_code='1403'$$);
-- viewer without edit on reports
SELECT t.as_user(:'C');
SELECT t.eq('viewer C can read the report', (SELECT count(*) > 0 FROM get_cost_report(:'P1')), true);
SELECT t.denied('viewer C cannot insert ETC', $$INSERT INTO cost_report_etc(organization_id, project_id, budget_code, etc_amount) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','1101',1)$$);
SELECT t.denied('viewer C cannot update ETC', $$UPDATE cost_report_etc SET etc_amount = 1$$);
SELECT t.denied('viewer C cannot delete ETC', $$DELETE FROM cost_report_etc$$);
-- other tenant
SELECT t.as_user(:'B');
SELECT t.denied('tenant B refused on P1', $$SELECT * FROM get_cost_report('20000000-0000-0000-0000-000000000001')$$);
SELECT t.eq('tenant B sees no ETC rows of P1', (SELECT count(*) FROM cost_report_etc), 0::bigint);
SELECT t.denied('tenant B cannot write ETC into P1', $$INSERT INTO cost_report_etc(organization_id, project_id, budget_code, etc_amount) VALUES ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','1101',1)$$);
SELECT t.eq('tenant B gets only its own project', (SELECT sum(estimate) FROM get_cost_report(:'P2')), 777777.00);
RESET ROLE; SET ROLE anon;
SELECT t.denied('anon refused on the function', $$SELECT * FROM public.get_cost_report('20000000-0000-0000-0000-000000000001')$$);
SELECT t.denied('anon refused on the table', $$SELECT * FROM public.cost_report_etc$$);
RESET ROLE;
DELETE FROM cost_report_etc;
