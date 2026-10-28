\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set P1 '20000000-0000-0000-0000-000000000001'
-- D12: link the 135,539.47 payroll row to "Head Writer", and the invoice to "Actor A"
SELECT id AS l_head  FROM budget_lines WHERE description='Head Writer' \gset
SELECT id AS l_actor FROM budget_lines WHERE description='Actor A' \gset
SELECT id AS l_draft FROM budget_lines WHERE description='DRAFT ONLY' \gset
SELECT id AS l_other FROM budget_lines WHERE description='Secret budget' \gset
SELECT t.as_user(:'A');
UPDATE payroll  SET linked_budget_line_id = :'l_head'  WHERE id='50000000-0000-0000-0000-000000000001';
UPDATE invoices SET linked_budget_line_id = :'l_actor' WHERE id='60000000-0000-0000-0000-000000000001';
SELECT t.denied('link to a line of another code refused', format($$UPDATE payroll SET linked_budget_line_id = %L WHERE id='50000000-0000-0000-0000-000000000002'$$, :'l_actor'));
RESET ROLE;
SELECT t.denied('link to a line of another project refused', format($$UPDATE payroll SET linked_budget_line_id = %L WHERE id='50000000-0000-0000-0000-000000000002'$$, :'l_other'));
SELECT t.as_user(:'A');
CREATE TEMP TABLE bt AS SELECT * FROM get_budget_tracking(:'P1');
GRANT ALL ON bt TO PUBLIC;
SELECT t.eq('one row per active line + unassigned rows', (SELECT count(*) FROM bt WHERE line_id IS NOT NULL), 6::bigint);
-- 180 glossary: the linked contract is Actual for what was paid on it, Commitment for the rest
SELECT t.eq('Head Writer carries only its own payroll', (SELECT actual::text||'/'||committed::text FROM bt WHERE line_id=:'l_head'), '2000.00/133539.47');
SELECT t.eq('the other 3 lines of 1101 show no spend (no repetition)', (SELECT sum(actual) FROM bt WHERE budget_code='1101' AND line_id IS NOT NULL AND line_id<>:'l_head'), 0.00);
SELECT t.eq('unlinked payroll sits once on the 1101 unassigned row', (SELECT actual::text||'/'||committed::text FROM bt WHERE budget_code='1101' AND line_id IS NULL), '0.00/107500.00');
SELECT t.eq('paid follows the linked source', (SELECT paid FROM bt WHERE line_id=:'l_head'), 2000.00);
-- 196: the invoice request paid in 020 (1,000) now writes its payments row
SELECT t.eq('Actor A: invoice actual + its payments', (SELECT actual::text||'/'||paid::text FROM bt WHERE line_id=:'l_actor'), '5000.00/2500.00');
SELECT t.eq('1403 unassigned: petty cash actual, PO committed', (SELECT actual::text||'/'||committed::text FROM bt WHERE budget_code='1403' AND line_id IS NULL), '800.00/3000.00');
SELECT t.eq('remaining = budget - actual - committed', (SELECT count(*) FROM bt WHERE remaining <> budget-actual-committed), 0::bigint);
-- acceptance: totals equal the Cost Report
SELECT t.eq('budget total = cost report', (SELECT sum(budget) FROM bt), (SELECT sum(estimate) FROM get_cost_report(:'P1')));
SELECT t.eq('actual total = cost report', (SELECT sum(actual) FROM bt), (SELECT sum(actual) FROM get_cost_report(:'P1')));
SELECT t.eq('committed total = cost report', (SELECT sum(committed) FROM bt), (SELECT sum(committed) FROM get_cost_report(:'P1')));
SELECT t.eq('paid total = cost report', (SELECT sum(paid) FROM bt), (SELECT sum(paid_to_date) FROM get_cost_report(:'P1')));
SELECT t.eq('per code: lines + unassigned = cost report actual', (SELECT count(*) FROM (SELECT budget_code, sum(actual) a FROM bt GROUP BY 1) x JOIN get_cost_report(:'P1') c ON c.budget_code IS NOT DISTINCT FROM x.budget_code WHERE x.a <> c.actual), 0::bigint);
-- line drill-down
-- 180: one contract = an actual row (paid part) + a commitment row (the rest)
SELECT t.eq('line transactions: the payroll row as actual + commitment', (SELECT string_agg(entry_kind, ',' ORDER BY entry_kind) FROM get_line_transactions(:'l_head')), 'actual,commitment');
SELECT t.eq('line transaction source label', (SELECT DISTINCT source FROM get_line_transactions(:'l_head')), 'Payroll');
SELECT t.eq('open commitment is not flagged paid', (SELECT is_paid FROM get_line_transactions(:'l_head') WHERE entry_kind='commitment'), false);
SELECT t.eq('code drill-down (unassigned only) on 1403', (SELECT count(*) FROM get_code_transactions(:'P1','1403')), 2::bigint);
SELECT t.eq('code drill-down (all) on 1403', (SELECT count(*) FROM get_code_transactions(:'P1','1403', false)), 3::bigint);
SELECT t.eq('unassigned drill-down sums to the unassigned row', (SELECT sum(amount) FILTER (WHERE entry_kind='commitment') FROM get_code_transactions(:'P1','1101')), 107500.00);
-- a link to a draft line does not move spend onto the draft
RESET ROLE; SET session_replication_role = replica;
UPDATE payroll SET linked_budget_line_id = :'l_draft' WHERE id='50000000-0000-0000-0000-000000000002';
SET session_replication_role = origin;
SELECT t.as_user(:'A');
SELECT t.eq('row linked to a draft line stays unassigned', (SELECT committed FROM get_budget_tracking(:'P1') WHERE budget_code='1101' AND line_id IS NULL), 107500.00);
SELECT t.as_user(:'B');
SELECT t.denied('tenant B refused: tracking', $$SELECT * FROM get_budget_tracking('20000000-0000-0000-0000-000000000001')$$);
SELECT t.denied('tenant B refused: line transactions', format($$SELECT * FROM get_line_transactions(%L)$$, :'l_head'));
SELECT t.denied('tenant B refused: code transactions', $$SELECT * FROM get_code_transactions('20000000-0000-0000-0000-000000000001','1101')$$);
SELECT t.eq('tenant B sees no link rows of P1', (SELECT count(*) FROM v_ledger_line_links WHERE project_id=:'P1'), 0::bigint);
RESET ROLE;
SET session_replication_role = replica;
UPDATE payroll SET linked_budget_line_id = NULL WHERE id='50000000-0000-0000-0000-000000000002';
SET session_replication_role = origin;
