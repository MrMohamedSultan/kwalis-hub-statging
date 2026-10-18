\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set P1 '20000000-0000-0000-0000-000000000001'
-- another tenant must see nothing of project P1 through the reporting views
SELECT t.as_user(:'B');
SELECT t.eq('B sees 0 rows of P1 in v_budget_code_position', (SELECT count(*) FROM v_budget_code_position WHERE project_id = :'P1'), 0::bigint);
SELECT t.eq('B sees 0 rows of P1 in v_project_position',     (SELECT count(*) FROM v_project_position     WHERE project_id = :'P1'), 0::bigint);
SELECT t.eq('B sees 0 rows of P1 in v_active_budget_lines',  (SELECT count(*) FROM v_active_budget_lines  WHERE project_id = :'P1'), 0::bigint);
SELECT t.eq('B sees 0 rows of P1 in budget_line_actuals',    (SELECT count(*) FROM budget_line_actuals WHERE project_id = :'P1'), 0::bigint);
-- a legitimate member still gets the dashboard figures
SELECT t.as_user(:'A');
SELECT t.eq('A still reads P1 budget',  (SELECT round(sum(budget_sar),2) FROM v_budget_code_position WHERE project_id = :'P1'), 335000.00);
SELECT t.eq('A still reads P1 actual',  (SELECT round(actual_sar,2) FROM v_project_position WHERE project_id = :'P1'), 250039.47);
SELECT t.eq('A still reads active lines (draft excluded)', (SELECT count(*) FROM v_active_budget_lines WHERE project_id = :'P1'), 6::bigint);
RESET ROLE;
SET ROLE anon;
SELECT t.denied('anon cannot select v_budget_code_position', 'SELECT 1 FROM public.v_budget_code_position LIMIT 1');
RESET ROLE;
