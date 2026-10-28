-- 198 — Live Balance accrual method, Company Overhead, GSR payment snapshot,
--       instalment history. Runs in one transaction and rolls back.
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P '20000000-0000-0000-0000-000000000198'
\set KE 'b1980000-0000-0000-0000-00000000000e'
\set PE 'a1980000-0000-0000-0000-00000000000e'
BEGIN;
SET session_replication_role = replica;
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status,start_date,end_date) VALUES
 (:'P',:'A','Tax & overhead scenario','TAX1',:'O1','USD',3.75,'Production','2026-09-01','2026-12-31');
INSERT INTO project_members(project_id,user_id) VALUES (:'P',:'A'),(:'P',:'C');
INSERT INTO budget_versions(id,project_id,organization_id,version_no,version_name,status) VALUES
 ('40000000-0000-0000-0000-000000000198',:'P',:'O1',1,'v1.0','active');
-- budget 100,000 SAR: 7099 (WHT) 2,000 · 2101 98,000
INSERT INTO budget_lines(project_id,organization_id,version_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency) VALUES
 (:'P',:'O1','40000000-0000-0000-0000-000000000198','7000','7099','7000','Withholding tax',1,2000,1,'Package','SAR'),
 (:'P',:'O1','40000000-0000-0000-0000-000000000198','2100','2101','2100','Camera',1,98000,1,'Package','SAR');
-- a non-resident crew member paid to an Egyptian bank in USD; a vendor with a Saudi IBAN
INSERT INTO people(id,kind,full_name,contract_status,organization_id,project_id,bank,bank_country,iban,ccy,deal_type) VALUES
 ('a1980000-0000-0000-0000-00000000000e','crew','Kais','Active',:'O1',:'P','CIB','Egypt','EG380019000500000000263180002','USD','weekly');
INSERT INTO vendors(id,name,organization_id,project_id,bank_name,iban) VALUES
 ('d1980000-0000-0000-0000-000000000001','Lens house KSA',:'O1',:'P','Al Rajhi','SA0380000000608010167519');
INSERT INTO invoices(id,invoice_no,description,budget_code,price,vat_amount,date,vendor_name,organization_id,project_id) VALUES
 ('c1980000-0000-0000-0000-000000000001','INV-198','Lens rental','2101',1000,150,'2026-10-01','Lens house KSA',:'O1',:'P');
INSERT INTO cash_advances(id,holder,total_advance,organization_id,project_id,status) VALUES
 ('e1980000-0000-0000-0000-000000000001','Runner',500,:'O1',:'P','open');
SET session_replication_role = origin;

-- ---------------------------------------------------------------- decision 16: accrual method
SELECT t.eq('accrual method suggested from deal type: daily → work days', accrual_method_suggest('daily'), 'work_days');
SELECT t.eq('weekly → weekly', accrual_method_suggest('weekly'), 'weekly');
SELECT t.eq('package / unknown → package', accrual_method_suggest('package'), 'package');
UPDATE people SET accrual_method = 'shoot_days' WHERE id = :'PE';
SELECT t.eq('accrual method editable per contract', (SELECT accrual_method FROM people WHERE id = :'PE'), 'shoot_days');
SELECT t.denied('unknown accrual method refused', $$UPDATE people SET accrual_method = 'hourly' WHERE id = 'a1980000-0000-0000-0000-00000000000e'$$);

-- ---------------------------------------------------------------- overhead months
SELECT t.eq('a full calendar month is 1', overhead_months('2026-10-01', '2026-10-31'), 1.0);
SELECT t.eq('Oct 16 – Nov 15 = 16/31 + 15/30', round(overhead_months('2026-10-16', '2026-11-15'), 4), round(16/31.0 + 0.5, 4));
SELECT t.eq('window clips the period', overhead_months('2026-09-01', '2026-12-31', '2026-10-01', '2026-10-31'), 1.0);
SELECT t.eq('no overlap = 0', overhead_months('2026-09-01', '2026-09-30', '2026-10-01', NULL), 0::numeric);

-- ---------------------------------------------------------------- decision 14: Company Overhead
SELECT t.as_user(:'A');
-- company employee: 12,000 / month incl. company GOSI share, 50% on the project, Sep–Oct
INSERT INTO project_overhead_staff(project_id, organization_id, employee_name, position, monthly_cost, allocation_pct, start_date, end_date)
VALUES (:'P', :'O1', 'Office accountant', 'Accountant', 12000, 50, '2026-09-01', '2026-10-31');
-- office rent share 4,000 / month Sep–Dec (unbudgeted); equipment 1% of budget, on 2101 (budgeted)
INSERT INTO project_overhead_items(project_id, organization_id, kind, label, basis, monthly_amount, start_date, end_date)
VALUES (:'P', :'O1', 'office_rent', 'Office rent share', 'monthly', 4000, '2026-09-01', '2026-12-31');
INSERT INTO project_overhead_items(project_id, organization_id, kind, label, basis, pct_of_budget, budget_code)
VALUES (:'P', :'O1', 'equipment', 'Company cameras', 'pct_budget', 1, '2101');
SELECT t.denied('a monthly item needs an amount and dates', $$INSERT INTO project_overhead_items(project_id, organization_id, kind, label, basis) VALUES ('20000000-0000-0000-0000-000000000198','10000000-0000-0000-0000-000000000001','office_rent','x','monthly')$$);
SELECT t.eq('staff = 12,000 × 50% × 2 months', (SELECT amount FROM get_company_overhead(:'P') WHERE kind = 'staff'), 12000.00);
SELECT t.eq('rent = 4,000 × 4 months', (SELECT amount FROM get_company_overhead(:'P') WHERE kind = 'office_rent'), 16000.00);
SELECT t.eq('equipment = 1% of the 100,000 budget', (SELECT amount FROM get_company_overhead(:'P') WHERE kind = 'equipment'), 1000.00);
SELECT t.eq('project budget returned', (SELECT DISTINCT project_budget FROM get_company_overhead(:'P')), 100000.00);
SELECT t.eq('total overhead 29,000', (SELECT sum(amount) FROM get_company_overhead(:'P')), 29000.00);
SELECT t.eq('unbudgeted overhead 28,000 (staff + rent have no budget code)', (SELECT sum(amount) FROM get_company_overhead(:'P') WHERE NOT budgeted), 28000.00);
SELECT t.eq('period filter: October only', (SELECT sum(amount) FROM get_company_overhead(:'P', '2026-10-01', '2026-10-31') WHERE kind <> 'equipment'), 6000.00 + 4000);
SELECT t.eq('editor sees the monthly cost', (SELECT monthly_amount FROM get_company_overhead(:'P') WHERE kind = 'staff'), 12000.00);
-- soft delete
UPDATE project_overhead_items SET deleted_at = now() WHERE label = 'Company cameras';
SELECT t.eq('soft-deleted item leaves the report', (SELECT count(*) FROM get_company_overhead(:'P') WHERE kind = 'equipment'), 0::bigint);
SELECT t.denied('overhead items cannot be hard-deleted', $$DELETE FROM project_overhead_items$$);
RESET ROLE;
SELECT t.as_user(:'C');   -- reports viewer, not editor
SELECT t.eq('viewer cannot read the overhead table', (SELECT count(*) FROM project_overhead_items), 0::bigint);
SELECT t.denied('viewer cannot add overhead', $$INSERT INTO project_overhead_items(project_id, organization_id, kind, label, basis, monthly_amount, start_date, end_date) VALUES ('20000000-0000-0000-0000-000000000198','10000000-0000-0000-0000-000000000001','office_rent','x','monthly',1,'2026-09-01','2026-09-30')$$);
SELECT t.eq('viewer sees overhead totals', (SELECT sum(amount) FROM get_company_overhead(:'P')), 28000.00);
SELECT t.eq('viewer does not see salaries', (SELECT monthly_amount FROM get_company_overhead(:'P') WHERE kind = 'staff'), NULL::numeric);
RESET ROLE;
SELECT t.as_user(:'B');   -- other organisation
SELECT t.denied('other tenant cannot read the overhead report', $$SELECT * FROM get_company_overhead('20000000-0000-0000-0000-000000000198')$$);
RESET ROLE;

-- ---------------------------------------------------------------- N03: GSR snapshot on the payment
-- contract: gross 1,684.21 (gross-up), WHT 84.21, net 1,600 (Kais); no schedule
INSERT INTO payroll(id,ref_id,name,kind,total_amount,wht_amount,wht_percent,net_payable,wht_treatment,budget_code,organization_id,project_id)
VALUES (:'KE','a1980000-0000-0000-0000-00000000000e','Kais','crew',1684.21,84.21,5,1600,'exclusive','2101',:'O1',:'P');
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,method)
VALUES (:'O1',:'P','payroll',:'KE',750,'2026-10-05','Transfer');
SELECT t.eq('payroll payment: bank country of the payee', (SELECT spend_country FROM payments WHERE source_id = :'KE'), 'Egypt');
SELECT t.eq('payroll payment: bank name and contract currency', (SELECT bank_name || ' ' || currency FROM payments WHERE source_id = :'KE'), 'CIB USD');
SELECT t.eq('payroll payment: original amount at the project rate', (SELECT original_amount FROM payments WHERE source_id = :'KE'), 200.00);
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,method)
VALUES (:'O1',:'P','invoice','c1980000-0000-0000-0000-000000000001',1150,'2026-10-06','Transfer');
SELECT t.eq('invoice payment: Saudi IBAN = Saudi Arabia', (SELECT spend_country FROM payments WHERE source_type = 'invoice' AND project_id = :'P'), 'Saudi Arabia');
SELECT t.eq('invoice payment in SAR', (SELECT currency || ' ' || original_amount FROM payments WHERE source_type = 'invoice' AND project_id = :'P'), 'SAR 1150.00');
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,method)
VALUES (:'O1',:'P','petty_cash','e1980000-0000-0000-0000-000000000001',500,'2026-10-07','Cash');
SELECT t.eq('petty cash = Saudi Arabia', (SELECT spend_country FROM payments WHERE source_type = 'petty_cash' AND project_id = :'P'), 'Saudi Arabia');
-- the snapshot is kept when the payee changes bank later
UPDATE people SET bank_country = 'France' WHERE id = :'PE';
SELECT t.eq('snapshot kept after the payee changes bank', (SELECT spend_country FROM payments WHERE source_id = :'KE'), 'Egypt');
SELECT t.as_user(:'A');
SELECT t.eq('GSR rows = payments of the project', (SELECT count(*) FROM get_gsr_payments(:'P')), 3::bigint);
SELECT t.eq('GSR: WHT withheld on the payment = its share of the stored WHT', (SELECT wht FROM get_gsr_payments(:'P') WHERE source_id = :'KE'), round(750 * 84.21 / 1600, 2));
SELECT t.eq('GSR: payee type crew / vendor / petty cash', (SELECT string_agg(payee_type, ',' ORDER BY payment_date) FROM get_gsr_payments(:'P')), 'crew,vendor,petty_cash');
SELECT t.eq('GSR: date filter', (SELECT count(*) FROM get_gsr_payments(:'P', '2026-10-06', '2026-10-06')), 1::bigint);
RESET ROLE;
SELECT t.as_user(:'B');
SELECT t.denied('GSR: other tenant refused', $$SELECT * FROM get_gsr_payments('20000000-0000-0000-0000-000000000198')$$);
RESET ROLE;

-- ---------------------------------------------------------------- R15: instalment history
SET session_replication_role = replica;
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,payroll_milestone_id,requested_amount,
                             status,requested_by,submitted_at,approved_by,approved_at,created_at)
VALUES ('f1980000-0000-0000-0000-000000000001',:'O1',:'P','payroll_row',:'KE','m1',800,'approved',:'A',
        '2026-10-01 09:00+03',:'C','2026-10-02 10:00+03','2026-10-01 09:00+03');
INSERT INTO payment_request_approvals(payment_request_id,organization_id,project_id,level_no,level_label,approved_by,approved_at,note)
VALUES ('f1980000-0000-0000-0000-000000000001',:'O1',:'P',1,'Production accountant',:'C','2026-10-02 10:00+03','ok');
SET session_replication_role = origin;
SELECT t.as_user(:'A');
SELECT t.eq('history: requested, level approval, approved', (SELECT string_agg(event, ',' ORDER BY at, event DESC) FROM get_instalment_history(:'KE', 'm1')), 'requested,approved_level,approved');
SELECT t.eq('history: requester name', (SELECT actor_name FROM get_instalment_history(:'KE', 'm1') WHERE event = 'requested'), user_display_name(:'A'));
SELECT t.eq('history: approver name and level', (SELECT actor_name || ' · ' || level_label FROM get_instalment_history(:'KE', 'm1') WHERE event = 'approved_level'), user_display_name(:'C') || ' · Production accountant');
RESET ROLE;
SELECT t.as_user(:'B');
SELECT t.denied('history: other tenant refused', $$SELECT * FROM get_instalment_history('b1980000-0000-0000-0000-00000000000e', 'm1')$$);
RESET ROLE;
ROLLBACK;
