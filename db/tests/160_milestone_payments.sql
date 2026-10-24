\set A '00000000-0000-0000-0000-00000000000a'
\set PR '50000000-0000-0000-0000-000000000002'
\set P1 '20000000-0000-0000-0000-000000000001'
-- Writer 2 (107,500) gets a 3-milestone schedule; nothing paid yet
UPDATE payroll SET payment_schedule = '[{"id":"m1","label":"On Signing","percent":20,"amount":null,"status":"Pending"},{"id":"m2","label":"On Wrap","percent":0,"amount":40000,"status":"Pending"},{"id":"m3","label":"P3","percent":0,"amount":46000,"status":"Pending"}]'::jsonb WHERE id = :'PR';
SELECT t.eq('no milestone payments while nothing is paid', (SELECT count(*) FROM payments WHERE source_id = :'PR'), 0::bigint);
-- a hand-recorded payroll payment of the same amount as m1 (like the backfilled 2,000 SAR)
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,method,notes)
VALUES ('10000000-0000-0000-0000-000000000001', :'P1', 'payroll', :'PR', 21500, '2026-09-01', 'Transfer', 'recorded by hand');
-- m1 paid (percent-based: 20% of 107,500 = 21,500) and m2 paid with a date
UPDATE payroll SET payment_schedule = jsonb_set(jsonb_set(payment_schedule,'{0,status}','"Paid"'),'{1}','{"id":"m2","label":"On Wrap","percent":0,"amount":40000,"status":"Paid","paidDate":"2026-10-05","paymentMethod":"Bank Transfer","paidRef":"TRX-9"}'::jsonb) WHERE id = :'PR';
SELECT t.eq('hand-recorded payment adopted, not duplicated', (SELECT count(*) FROM payments WHERE source_id = :'PR' AND amount = 21500), 1::bigint);
SELECT t.eq('adopted payment linked to m1', (SELECT payroll_milestone_id FROM payments WHERE source_id = :'PR' AND amount = 21500), 'm1');
SELECT t.eq('m2 inserted with its date', (SELECT payment_date::text FROM payments WHERE source_id = :'PR' AND payroll_milestone_id = 'm2'), '2026-10-05');
SELECT t.eq('unknown method falls back to Transfer', (SELECT method FROM payments WHERE payroll_milestone_id = 'm2'), 'Transfer');
SELECT t.eq('label carries milestone + reference', (SELECT notes FROM payments WHERE payroll_milestone_id = 'm2'), 'Milestone: On Wrap · ref TRX-9');
SELECT t.eq('paid total = 61,500', (SELECT sum(amount) FROM payments WHERE source_id = :'PR'), 61500.00);
-- re-saving the same schedule changes nothing
UPDATE payroll SET payment_schedule = payment_schedule WHERE id = :'PR';
SELECT t.eq('idempotent', (SELECT count(*) FROM payments WHERE source_id = :'PR'), 2::bigint);
-- amount edit flows through
UPDATE payroll SET payment_schedule = jsonb_set(payment_schedule,'{1,amount}','45000') WHERE id = :'PR';
SELECT t.eq('amount edit updates the payment', (SELECT amount FROM payments WHERE payroll_milestone_id = 'm2'), 45000.00);
-- reopening m2 removes its payment
UPDATE payroll SET payment_schedule = jsonb_set(payment_schedule,'{1,status}','"Pending"') WHERE id = :'PR';
SELECT t.eq('reopened milestone loses its payment', (SELECT count(*) FROM payments WHERE payroll_milestone_id = 'm2'), 0::bigint);
-- the budget code position sees the paid milestone (code 1101)
SELECT t.as_user(:'A');
SELECT t.eq('paid shows in the code position', (SELECT paid_sar >= 21500 FROM v_budget_code_position WHERE project_id = :'P1' AND budget_code = '1101'), true);
RESET ROLE;
-- deleting the contract removes its milestone payments
SET session_replication_role = origin;
DELETE FROM payroll WHERE id = :'PR';
SELECT t.eq('contract delete removes milestone payments', (SELECT count(*) FROM payments WHERE source_id = :'PR' AND payroll_milestone_id IS NOT NULL), 0::bigint);
