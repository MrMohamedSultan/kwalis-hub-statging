\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set P1 '20000000-0000-0000-0000-000000000001'
SELECT t.as_user(:'A');
INSERT INTO project_overhead_staff(organization_id, project_id, employee_name, position, department, monthly_cost, allocation_pct, start_date, end_date, budget_code)
VALUES ('10000000-0000-0000-0000-000000000002', :'P1', '  Sara Accountant ', 'Accountant', 'Finance', 10000, 50, '2026-07-01', '2026-09-30', '1403'),
       ('10000000-0000-0000-0000-000000000001', :'P1', 'Omar PM', 'Project Manager', 'Management', 20000, 100, '2026-09-16', '2026-12-31', NULL);
SELECT t.eq('org taken from the project, name trimmed', (SELECT organization_id::text||'|'||employee_name FROM project_overhead_staff WHERE position='Accountant'), '10000000-0000-0000-0000-000000000001|Sara Accountant');
-- acceptance: 10,000 x 50% x 3 months = 15,000
SELECT t.eq('10,000 x 50% x 3 months = 15,000', (SELECT allocated_cost FROM get_overhead(:'P1','2026-07-01','2026-09-30') WHERE employee='Sara Accountant'), 15000.00);
SELECT t.eq('months = 3 exactly', (SELECT months FROM get_overhead(:'P1','2026-07-01','2026-09-30') WHERE employee='Sara Accountant'), 3.0000);
SELECT t.eq('report window clips the staff window (Aug only = 1 month)', (SELECT allocated_cost FROM get_overhead(:'P1','2026-08-01','2026-08-31') WHERE employee='Sara Accountant'), 5000.00);
SELECT t.eq('partial month pro rata: 16-30 Sep = 15/30', (SELECT months FROM get_overhead(:'P1','2026-09-01','2026-09-30') WHERE employee='Omar PM'), 0.5000);
SELECT t.eq('partial month cost', (SELECT allocated_cost FROM get_overhead(:'P1','2026-09-01','2026-09-30') WHERE employee='Omar PM'), 10000.00);
SELECT t.eq('outside the window = 0, row still listed', (SELECT allocated_cost FROM get_overhead(:'P1','2026-01-01','2026-01-31') WHERE employee='Omar PM'), 0.00);
SELECT t.eq('budget of the code', (SELECT budget FROM get_overhead(:'P1','2026-07-01','2026-09-30') WHERE employee='Sara Accountant'), 20000.00);
SELECT t.eq('variance = budget - allocated on the code', (SELECT variance FROM get_overhead(:'P1','2026-07-01','2026-09-30') WHERE employee='Sara Accountant'), 5000.00);
SELECT t.eq('no budget code -> no budget/variance', (SELECT budget IS NULL AND variance IS NULL FROM get_overhead(:'P1') WHERE employee='Omar PM'), true);
SELECT t.eq('editor sees monthly cost', (SELECT monthly_cost FROM get_overhead(:'P1') WHERE employee='Omar PM'), 20000.00);
SELECT t.denied('allocation above 100 rejected', $$UPDATE project_overhead_staff SET allocation_pct = 101$$);
SELECT t.denied('end before start rejected', $$UPDATE project_overhead_staff SET end_date = '2020-01-01'$$);
SELECT t.denied('hard delete not permitted', $$DELETE FROM project_overhead_staff$$);
-- over-allocation across projects: same name, second row overlapping, 60% + 50%
INSERT INTO project_overhead_staff(organization_id, project_id, employee_name, monthly_cost, allocation_pct, start_date, end_date)
VALUES ('10000000-0000-0000-0000-000000000001', :'P1', 'sara accountant', 10000, 60, '2026-08-15', '2026-10-15');
SELECT t.eq('over-allocation flagged (50 + 60)', (SELECT bool_and(over_allocated) FROM get_overhead(:'P1') WHERE lower(employee)='sara accountant'), true);
SELECT t.eq('total allocation reported', (SELECT max(total_allocation_pct) FROM get_overhead(:'P1') WHERE lower(employee)='sara accountant'), 110.00);
SELECT t.eq('other staff not flagged', (SELECT over_allocated FROM get_overhead(:'P1') WHERE employee='Omar PM'), false);
-- soft delete
UPDATE project_overhead_staff SET deleted_at = '2000-01-01' WHERE employee_name='sara accountant';
SELECT t.eq('soft-deleted row leaves the report', (SELECT count(*) FROM get_overhead(:'P1')), 2::bigint);
SELECT t.eq('deleted_at / deleted_by stamped by the database', (SELECT deleted_by = :'A'::uuid AND deleted_at > now() - interval '1 minute' FROM project_overhead_staff WHERE employee_name='sara accountant'), true);
SELECT t.eq('flag clears once the overlap is gone', (SELECT over_allocated FROM get_overhead(:'P1') WHERE employee='Sara Accountant'), false);
-- viewer: sees rows through the RPC but never the salary
SELECT t.as_user(:'C');
SELECT t.eq('viewer gets the rows', (SELECT count(*) FROM get_overhead(:'P1')), 2::bigint);
SELECT t.eq('viewer gets no monthly cost', (SELECT count(*) FROM get_overhead(:'P1') WHERE monthly_cost IS NOT NULL), 0::bigint);
SELECT t.eq('viewer cannot read the salary table', (SELECT count(*) FROM project_overhead_staff), 0::bigint);
SELECT t.denied('viewer cannot add staff', $$INSERT INTO project_overhead_staff(organization_id, project_id, employee_name, monthly_cost, allocation_pct, start_date, end_date) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','X',1,1,'2026-01-01','2026-01-02')$$);
SELECT t.as_user(:'B');
SELECT t.denied('tenant B refused', $$SELECT * FROM get_overhead('20000000-0000-0000-0000-000000000001')$$);
SELECT t.eq('tenant B sees no rows in the table', (SELECT count(*) FROM project_overhead_staff), 0::bigint);
SELECT t.denied('tenant B cannot insert into P1', $$INSERT INTO project_overhead_staff(organization_id, project_id, employee_name, monthly_cost, allocation_pct, start_date, end_date) VALUES ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','X',1,1,'2026-01-01','2026-01-02')$$);
RESET ROLE; SET ROLE anon;
SELECT t.denied('anon refused', $$SELECT * FROM public.get_overhead('20000000-0000-0000-0000-000000000001')$$);
RESET ROLE;
SELECT t.eq('overhead changes are audited', (SELECT count(*) > 0 FROM audit_history WHERE table_name='project_overhead_staff'), true);
