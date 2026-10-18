\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set P4 '20000000-0000-0000-0000-000000000004'
\set O1 '10000000-0000-0000-0000-000000000001'
SET session_replication_role = replica;
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status,start_date,end_date) VALUES
 (:'P4',:'A','Cash flow fixtures','CSH1',:'O1','SAR',3.75,'Production','2026-06-01','2026-12-31');
INSERT INTO project_members(project_id,user_id) VALUES (:'P4',:'A'),(:'P4',:'C');
INSERT INTO role_permissions(role_id,module_key,can_view,can_edit) VALUES ('30000000-0000-0000-0000-000000000001','funding',true,true);
INSERT INTO budget_versions(id,project_id,organization_id,version_no,version_name,status) VALUES ('40000000-0000-0000-0000-000000000040',:'P4',:'O1',1,'v1.0','active');
INSERT INTO budget_lines(project_id,organization_id,version_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency) VALUES
 (:'P4',:'O1','40000000-0000-0000-0000-000000000040','1100','1101','1100','Script',1,100000,1,'Package','SAR'),
 (:'P4',:'O1','40000000-0000-0000-0000-000000000040','2100','2101','2100','Camera',1,60000,1,'Package','SAR'),
 (:'P4',:'O1','40000000-0000-0000-0000-000000000040','2100','3001','2100','Tiny line',1,1000,1,'Package','SAR');
INSERT INTO payroll(id,name,kind,total_amount,budget_code,organization_id,project_id,payment_schedule) VALUES
 ('d4000000-0000-0000-0000-000000000001','Writer X','crew',40000,'1101',:'O1',:'P4',
  '[{"id":"s1","label":"On signing","dueDate":"2026-07-01","amount":10000,"status":"Paid","percent":25},
    {"id":"s2","label":"Draft","dueDate":"2026-08-15","amount":10000,"status":"Pending","percent":25},
    {"id":"s3","label":"Final","due_date":"2026-11-10","amount":null,"status":"Pending","percent":50},
    {"id":"s4","label":"No date","dueDate":"","amount":999,"status":"Pending","percent":0}]'::jsonb);
INSERT INTO invoices(id,invoice_no,description,budget_code,price,vatable,vat_amount,date,vendor_name,organization_id,project_id) VALUES
 ('c4000000-0000-0000-0000-000000000001','CF-1','Camera rental','2101',12000,true,1800,'2026-09-01','Vendor',:'O1',:'P4');
INSERT INTO purchase_orders(id,po_number,vendor_name,budget_code,amount,status,date,organization_id,project_id) VALUES
 ('f4000000-0000-0000-0000-000000000001','PO-CF1','Vendor','2101',15000,'approved','2026-10-20',:'O1',:'P4'),
 ('f4000000-0000-0000-0000-000000000002','PO-CF2','Vendor','3001',5000,'approved','2026-10-05',:'O1',:'P4'),
 ('f4000000-0000-0000-0000-000000000003','PO-CF3','Vendor','2101',77777,'Cancelled','2026-10-05',:'O1',:'P4');
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date) VALUES
 (:'O1',:'P4','payroll','d4000000-0000-0000-0000-000000000001',10000,'2026-07-03'),
 (:'O1',:'P4','invoice','c4000000-0000-0000-0000-000000000001',2000,'2026-09-05');
SET session_replication_role = origin;
SELECT t.as_user(:'A');
INSERT INTO project_funding(organization_id, project_id, funding_date, amount, status, source) VALUES
 ('10000000-0000-0000-0000-000000000002', :'P4', '2026-06-15', 50000, 'received', 'Platform'),
 (:'O1', :'P4', '2026-10-01', 80000, 'expected', 'Platform');
SELECT t.eq('funding org forced to the project''s org', (SELECT count(DISTINCT organization_id) FROM project_funding WHERE organization_id=:'O1'), 1::bigint);
CREATE TEMP TABLE cf AS SELECT get_cash_flow(:'P4','month',false,'even','2026-09-16') AS j;
GRANT ALL ON cf TO PUBLIC;
CREATE TEMP VIEW ln AS SELECT l FROM cf, jsonb_array_elements(j->'lines') l;
CREATE TEMP VIEW pr AS SELECT l->>'budget_code' AS code, (p->>'period_start')::date AS ps, (p->>'amount')::numeric AS amount, p->>'kind' AS kind FROM ln, jsonb_array_elements(l->'periods') p;
CREATE TEMP VIEW tt AS SELECT (x->>'period_start')::date ps, (x->>'outflow')::numeric outflow, (x->>'funding')::numeric funding, (x->>'opening')::numeric opening, (x->>'closing')::numeric closing FROM cf, jsonb_array_elements(j->'totals') x;
GRANT ALL ON ln, pr, tt TO PUBLIC;
SELECT t.eq('1101 paid to date', (SELECT (l->>'paid_to_date')::numeric FROM ln WHERE l->>'budget_code'='1101'), 10000.00);
SELECT t.eq('1101 remaining = budget - paid', (SELECT (l->>'remaining')::numeric FROM ln WHERE l->>'budget_code'='1101'), 90000.00);
SELECT t.eq('past payment shown as actual in its month', (SELECT amount::text||kind FROM pr WHERE code='1101' AND ps='2026-07-01'), '10000.00actual');
SELECT t.eq('overdue instalment lands in the current period + even share', (SELECT amount FROM pr WHERE code='1101' AND ps='2026-09-01' AND kind='forecast'), 25000.00);
SELECT t.eq('percent-based instalment on its due month + even share', (SELECT amount FROM pr WHERE code='1101' AND ps='2026-11-01'), 35000.00);
SELECT t.eq('months with only the even share', (SELECT string_agg(amount::text, ',' ORDER BY ps) FROM pr WHERE code='1101' AND ps IN ('2026-10-01','2026-12-01')), '15000.00,15000.00');
SELECT t.eq('nothing forecast before the current period', (SELECT count(*) FROM pr WHERE kind='forecast' AND ps < '2026-09-01'), 0::bigint);
SELECT t.eq('2101: invoice balance ex-VAT + share in Sep', (SELECT amount FROM pr WHERE code='2101' AND ps='2026-09-01' AND kind='forecast'), 18250.00);
SELECT t.eq('2101: open PO on its date + share', (SELECT amount FROM pr WHERE code='2101' AND ps='2026-10-01'), 23250.00);
SELECT t.eq('cancelled PO ignored', (SELECT count(*) FROM pr WHERE amount > 70000), 0::bigint);
-- acceptance: paid_to_date + future periods = budget on every line that is within budget
SELECT t.eq('paid + future = budget (lines within budget)', (SELECT count(*) FROM ln WHERE NOT (l->>'over_budget')::boolean AND (l->>'paid_to_date')::numeric + COALESCE((SELECT sum(amount) FROM pr WHERE pr.code = l->>'budget_code' AND kind='forecast'),0) <> (l->>'budget')::numeric), 0::bigint);
SELECT t.eq('commitment above budget is flagged, not hidden', (SELECT (l->>'over_budget')::boolean FROM ln WHERE l->>'budget_code'='3001'), true);
SELECT t.eq('over-budget line shows the real commitment', (SELECT sum(amount) FROM pr WHERE code='3001'), 5000.00);
-- totals
SELECT t.eq('one totals row per month Jun..Dec', (SELECT count(*) FROM tt), 7::bigint);
SELECT t.eq('first period opens at 0', (SELECT opening FROM tt ORDER BY ps LIMIT 1), 0.00);
SELECT t.eq('June: funding received', (SELECT closing FROM tt WHERE ps='2026-06-01'), 50000.00);
SELECT t.eq('September outflow = actual + forecast', (SELECT outflow FROM tt WHERE ps='2026-09-01'), 45250.00);
SELECT t.eq('September closes negative (funding gap)', (SELECT closing FROM tt WHERE ps='2026-09-01'), -5250.00);
SELECT t.eq('October: expected funding lifts the balance', (SELECT closing FROM tt WHERE ps='2026-10-01'), 31500.00);
SELECT t.eq('each opening = previous closing', (SELECT count(*) FROM (SELECT opening, lag(closing) OVER (ORDER BY ps) prev FROM tt) x WHERE prev IS NOT NULL AND opening <> prev), 0::bigint);
SELECT t.eq('closing = opening + funding - outflow', (SELECT count(*) FROM tt WHERE closing <> opening + funding - outflow), 0::bigint);
SELECT t.eq('total outflow = sum of all line cells', (SELECT sum(outflow) FROM tt), (SELECT sum(amount) FROM pr));
-- acceptance: switching Day / Week / Month does not change the grand total
SELECT t.eq('week grain: same grand total', (SELECT sum((x->>'outflow')::numeric) FROM jsonb_array_elements(get_cash_flow(:'P4','week',false,'even','2026-09-16')->'totals') x), (SELECT sum(outflow) FROM tt));
SELECT t.eq('day grain: same grand total', (SELECT sum((x->>'outflow')::numeric) FROM jsonb_array_elements(get_cash_flow(:'P4','day',false,'even','2026-09-16')->'totals') x), (SELECT sum(outflow) FROM tt));
SELECT t.eq('week periods start on Monday', (SELECT bool_and(extract(isodow FROM (x->>'period_start')::date) = 1) FROM jsonb_array_elements(get_cash_flow(:'P4','week',false,'even','2026-09-16')->'totals') x), true);
-- Q3 switches
SELECT t.eq('include VAT: invoice balance grows by its VAT', (SELECT sum((p->>'amount')::numeric) FROM jsonb_array_elements(get_cash_flow(:'P4','month',true,'none','2026-09-16')->'lines') l, jsonb_array_elements(l->'periods') p WHERE l->>'budget_code'='2101' AND p->>'kind'='forecast'), 26800.00);
SELECT t.eq('spread none: only dated commitments', (SELECT sum((p->>'amount')::numeric) FROM jsonb_array_elements(get_cash_flow(:'P4','month',false,'none','2026-09-16')->'lines') l, jsonb_array_elements(l->'periods') p WHERE l->>'budget_code'='1101' AND p->>'kind'='forecast'), 30000.00);
SELECT t.eq('spread end: residual in the last month', (SELECT (p->>'amount')::numeric FROM jsonb_array_elements(get_cash_flow(:'P4','month',false,'end','2026-09-16')->'lines') l, jsonb_array_elements(l->'periods') p WHERE l->>'budget_code'='1101' AND p->>'period_start'='2026-12-01'), 60000.00);
SELECT t.denied('bad grain rejected', $$SELECT get_cash_flow('20000000-0000-0000-0000-000000000004','year')$$);
SELECT t.denied('bad spread rejected', $$SELECT get_cash_flow('20000000-0000-0000-0000-000000000004','week',false,'random')$$);
-- permissions
SELECT t.as_user(:'C');
SELECT t.eq('viewer can read the report', (SELECT jsonb_array_length(get_cash_flow(:'P4','month')->'lines') > 0), true);
SELECT t.denied('viewer cannot add funding', $$INSERT INTO project_funding(organization_id, project_id, funding_date, amount) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','2026-01-01',1)$$);
SELECT t.as_user(:'B');
SELECT t.denied('tenant B refused', $$SELECT get_cash_flow('20000000-0000-0000-0000-000000000004')$$);
SELECT t.eq('tenant B sees no funding rows', (SELECT count(*) FROM project_funding), 0::bigint);
RESET ROLE;
