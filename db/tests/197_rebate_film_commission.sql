-- 197 — Film Commission rebate: settings, schedule, QPE mapping, overrides,
-- the single eligibility source and the merged report.
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-0000000000d1'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P '20000000-0000-0000-0000-000000000197'
\set V4 '40000000-0000-0000-0000-000000000197'
SET session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES (:'D','admin@org1.test');
INSERT INTO profiles(id) VALUES (:'D');
INSERT INTO organization_members(organization_id,user_id,role) VALUES (:'O1',:'D','admin');
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status,start_date,end_date) VALUES
 (:'P',:'A','Rebate 197','RB197',:'O1','SAR',3.75,'Production','2026-06-01','2026-12-31');
INSERT INTO project_members(project_id,user_id) VALUES (:'P',:'A'),(:'P',:'C');
INSERT INTO budget_versions(id,project_id,organization_id,version_no,version_name,status) VALUES (:'V4',:'P',:'O1',1,'v1.0','active');
INSERT INTO budget_lines(project_id,organization_id,version_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency) VALUES
 (:'P',:'O1',:'V4','1100','1101','1100','Writers',1,50000,1,'Package','SAR'),
 (:'P',:'O1',:'V4','1400','1403','1400','Lead cast',1,100000,1,'Package','SAR'),
 (:'P',:'O1',:'V4','3100','3101','3100','Camera',1,80000,1,'Package','SAR'),
 (:'P',:'O1',:'V4','5500','5501','5500','Marketing',1,10000,1,'Package','SAR');
INSERT INTO vendors(id,name,organization_id,project_id,company_nationality,cr_no,iban) VALUES
 ('f1970000-0000-0000-0000-0000000000a1','Riyadh Rentals',:'O1',:'P','Saudi Arabia','1010','SA0100'),
 ('f1970000-0000-0000-0000-0000000000a2','No CR Trading',:'O1',:'P',NULL,NULL,NULL),
 ('f1970000-0000-0000-0000-0000000000a3','Dubai Grip LLC',:'O1',:'P','UAE','AE1',NULL);
INSERT INTO people(id,kind,full_name,nationality,mother_saudi,id_number,organization_id,project_id,position,"character",start_date,end_date,iban,contract_path,id_attachment_path,related_party,is_trainee,phone_number,email) VALUES
 ('f1970000-0000-0000-0000-0000000000e1','crew','Saudi Gaffer','Saudi Arabia',NULL,'1012345678',:'O1',:'P','Gaffer',NULL,'2026-06-01','2026-06-30','SA1100','c1','i1',false,true,'0500','g@x.test'),
 ('f1970000-0000-0000-0000-0000000000e2','crew','Mother Saudi DOP','Egypt',true,'2098765432',:'O1',:'P','DOP',NULL,'2026-06-01','2026-07-15','SA2200','c2','i2',true,false,NULL,NULL),
 ('f1970000-0000-0000-0000-0000000000e3','crew','Foreign Grip','Egypt',false,'EG3',:'O1',:'P','Grip',NULL,'2026-06-01','2026-06-30',NULL,'c3','i3',false,false,NULL,NULL),
 ('f1970000-0000-0000-0000-0000000000e4','crew','Saudi Writer','Saudi Arabia',NULL,'1000000004',:'O1',:'P','Writer',NULL,'2026-06-01','2026-08-30',NULL,'c4','i4',false,false,NULL,NULL),
 ('f1970000-0000-0000-0000-0000000000e5','crew','Unknown Nat',NULL,NULL,NULL,:'O1',:'P',NULL,NULL,'2024-01-01','2026-08-26',NULL,'c5','i5',NULL,false,NULL,NULL),
 ('f1970000-0000-0000-0000-0000000000e6','cast','Saudi Lead','Saudi Arabia',NULL,'1000000006',:'O1',:'P','Lead','Hero','2026-07-01','2026-08-30',NULL,'c6','i6',false,false,'0566','lead@x.test');
INSERT INTO payroll(id,ref_id,ref_no,name,kind,total_amount,budget_code,organization_id,project_id) VALUES
 ('f1970000-0000-0000-0000-0000000000f1','f1970000-0000-0000-0000-0000000000e1','RB197-CRW-0001','Saudi Gaffer','crew',30000,'3101',:'O1',:'P'),
 ('f1970000-0000-0000-0000-0000000000f2','f1970000-0000-0000-0000-0000000000e2','RB197-CRW-0002','Mother Saudi DOP','crew',40000,'3101',:'O1',:'P'),
 ('f1970000-0000-0000-0000-0000000000f3','f1970000-0000-0000-0000-0000000000e3','RB197-CRW-0003','Foreign Grip','crew',20000,'3101',:'O1',:'P'),
 ('f1970000-0000-0000-0000-0000000000f4','f1970000-0000-0000-0000-0000000000e4','RB197-CRW-0004','Saudi Writer','crew',50000,'1101',:'O1',:'P'),
 ('f1970000-0000-0000-0000-0000000000f5','f1970000-0000-0000-0000-0000000000e5','RB197-CRW-0005','Unknown Nat','crew',10000,'3101',:'O1',:'P'),
 ('f1970000-0000-0000-0000-0000000000f6','f1970000-0000-0000-0000-0000000000e6','RB197-CST-0001','Saudi Lead','cast',100000,'1403',:'O1',:'P');
-- 203: these invoices are approved (201: a server-written invoice otherwise starts pending)
INSERT INTO invoices(id,ref_no,invoice_no,description,department,budget_code,price,vatable,vat_amount,date,vendor_name,organization_id,project_id,invoice_url,rebate_manual_override,rebate_eligible,approval_status) VALUES
 ('f1970000-0000-0000-0000-0000000000b1','RB197-INV-0001','S-100','ARRI camera package','Camera','3101',20000,true,3000,'2026-07-01','Riyadh Rentals',:'O1',:'P','u1',false,false,'approved'),
 ('f1970000-0000-0000-0000-0000000000b2','RB197-INV-0002','S-200','Grip truck','Grip','3101',5000,false,0,'2026-07-02','No CR Trading',:'O1',:'P','u2',false,false,'approved'),
 ('f1970000-0000-0000-0000-0000000000b3','RB197-INV-0003','S-300','Grip package','Grip','3101',7000,false,0,'2026-07-03','Dubai Grip LLC',:'O1',:'P','u3',false,false,'approved'),
 ('f1970000-0000-0000-0000-0000000000b4','RB197-INV-0004','S-400','Camera prep','Camera','3101',3000,false,0,'2025-12-01','Riyadh Rentals',:'O1',:'P','u4',false,false,'approved'),
 ('f1970000-0000-0000-0000-0000000000b5','RB197-INV-0005','S-500','Ads','Marketing','5501',1000,false,0,'2026-07-05','Riyadh Rentals',:'O1',:'P','u5',false,false,'approved'),
 ('f1970000-0000-0000-0000-0000000000b6','RB197-INV-0006','S-600','Filters','Camera','3101',500,false,0,'2026-07-06','Riyadh Rentals',:'O1',:'P','u6',true,true,'approved');
INSERT INTO cash_advances(id,holder,total_advance,organization_id,project_id,status) VALUES ('f1970000-0000-0000-0000-0000000000c0','Runner',10000,:'O1',:'P','open');
INSERT INTO cash_advance_receipts(id,ref_no,advance_id,recipient,department,amount,date,organization_id,project_id,budget_code,status,attachment_path) VALUES
 ('f1970000-0000-0000-0000-0000000000c1','RB197-PC-0001','f1970000-0000-0000-0000-0000000000c0','Local shop','Camera',600,'2026-07-02',:'O1',:'P','3101','approved','a1'),
 ('f1970000-0000-0000-0000-0000000000c2','RB197-PC-0002','f1970000-0000-0000-0000-0000000000c0','Big cash buy','Camera',6000,'2026-07-03',:'O1',:'P','3101','approved','a2'),
 ('f1970000-0000-0000-0000-0000000000c3','RB197-PC-0003','f1970000-0000-0000-0000-0000000000c0','Pending one','Camera',999,'2026-07-03',:'O1',:'P','3101','pending','a3');
INSERT INTO overtime_entries(id,ref_no,organization_id,project_id,person_id,person_name,work_date,amount,budget_code,status) VALUES
 ('f1970000-0000-0000-0000-0000000000d1','RB197-OT-0001',:'O1',:'P','f1970000-0000-0000-0000-0000000000e1','Saudi Gaffer','2026-06-10',1000,'3101','approved');
SET session_replication_role = origin;
-- payments with triggers on (bank reference + IBAN captured on insert)
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,method,notes,proof_path) VALUES
 (:'O1',:'P','payroll','f1970000-0000-0000-0000-0000000000f1',30000,'2026-06-30','Transfer','Milestone: Final · ref TRX-1',NULL),
 (:'O1',:'P','payroll','f1970000-0000-0000-0000-0000000000f2',20000,'2026-06-30','Transfer',NULL,'proof2'),
 (:'O1',:'P','payroll','f1970000-0000-0000-0000-0000000000f3',20000,'2026-06-30','Transfer',NULL,'proof3'),
 (:'O1',:'P','payroll','f1970000-0000-0000-0000-0000000000f6',50000,'2026-07-30','Cash',NULL,'proof6'),
 (:'O1',:'P','invoice','f1970000-0000-0000-0000-0000000000b1',23000,'2026-07-10','Transfer',NULL,'proofb1');
SELECT t.eq('bank reference taken from the instalment note', (SELECT bank_reference FROM payments WHERE source_id='f1970000-0000-0000-0000-0000000000f1'), 'TRX-1');
SELECT t.eq('payee IBAN captured from the person', (SELECT payee_iban FROM payments WHERE source_id='f1970000-0000-0000-0000-0000000000f1'), 'SA1100');
SELECT t.eq('payee IBAN captured from the vendor', (SELECT payee_iban FROM payments WHERE source_id='f1970000-0000-0000-0000-0000000000b1'), 'SA0100');

-- pure helpers
SELECT t.eq('rebate = rate x QPE under the cap', rebate_amount(40, 100000, 50000), 40000.00);
SELECT t.eq('rebate capped', rebate_amount(40, 200000, 50000), 50000.00);
SELECT t.eq('no rate -> no rebate', rebate_amount(NULL, 200000, 50000), NULL::numeric);
SELECT t.eq('June 2026 working days, Fri+Sat off', count_working_days('2026-06-01','2026-06-30','{5,6}'), 22);
SELECT t.eq('period inside', rebate_period_position('2026-06-02','2026-06-03','2026-06-01','2026-12-31'), 'inside');
SELECT t.eq('period partial', rebate_period_position('2026-05-02','2026-06-03','2026-06-01','2026-12-31'), 'partial');
SELECT t.eq('period outside', rebate_period_position('2025-05-02','2025-06-03','2026-06-01','2026-12-31'), 'outside');
SELECT t.eq('writers 1101 suggested as development (decision 10)', (SELECT reason FROM qpe_suggest('1101','Writers')), 'development');
SELECT t.eq('camera suggested as equipment rental', (SELECT category FROM qpe_suggest('3101','Camera')), 'equipment_rental');
SELECT t.eq('marketing not eligible', (SELECT reason FROM qpe_suggest('5501',NULL)), 'marketing_distribution');
SELECT t.eq('national airline recognised', is_national_airline('Saudia Airlines'), true);
SELECT t.eq('cost group of 1403', budget_cost_group('1403'), 'ATL');

-- ── E10 settings: admin only, locked after approval, audited ──────────
SELECT t.as_user(:'A');
SELECT t.denied('non-admin cannot set the rebate rate', $$SELECT set_project_rebate_settings('20000000-0000-0000-0000-000000000197','{"rebate_rate_pct":40}')$$);
SELECT t.denied('no direct table writes', $$INSERT INTO project_rebate_settings(organization_id,project_id,rebate_rate_pct) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000197',40)$$);
SELECT t.as_user(:'D');
SELECT t.eq('admin saves the settings', (SELECT rebate_rate_pct FROM set_project_rebate_settings(:'P',
  '{"rebate_rate_pct":40,"rebate_cap_sar":50000,"production_period_from":"2026-06-01","production_period_to":"2026-12-31","cash_limit_pct_of_qpe":10,"cash_limit_per_txn_sar":5000,"fc_agreement_no":"FC-1"}'::jsonb)), 40.00);
SELECT t.denied('unknown setting refused', $$SELECT set_project_rebate_settings('20000000-0000-0000-0000-000000000197','{"rate":40}')$$);
SELECT t.denied('off days must match the working week', $$SELECT set_project_rebate_settings('20000000-0000-0000-0000-000000000197','{"work_days_per_week":6}')$$);
SELECT t.eq('admin approves', (SELECT approved_at IS NOT NULL FROM approve_project_rebate_settings(:'P', true)), true);
SELECT t.denied('locked: change without a reason refused', $$SELECT set_project_rebate_settings('20000000-0000-0000-0000-000000000197','{"rebate_rate_pct":35}')$$);
SELECT t.eq('locked: same values need no reason', (SELECT rebate_rate_pct FROM set_project_rebate_settings(:'P','{"rebate_rate_pct":40}')), 40.00);
SELECT t.eq('locked: change with a reason', (SELECT rebate_rate_pct FROM set_project_rebate_settings(:'P','{"rebate_rate_pct":35}','Agreement addendum 2')), 35.00);
SELECT t.eq('back to 40 with a reason', (SELECT rebate_rate_pct FROM set_project_rebate_settings(:'P','{"rebate_rate_pct":40}','Addendum withdrawn')), 40.00);
RESET ROLE;
SELECT t.eq('every change is in the audit trail', (SELECT count(*) FROM audit_history WHERE table_name='project_rebate_settings' AND project_id=:'P' AND changed_fields ? 'rebate_rate_pct'), 3::bigint);
SELECT t.eq('audit keeps the reason', (SELECT new_row->>'change_reason' FROM audit_history WHERE table_name='project_rebate_settings' AND project_id=:'P' AND changed_fields->'rebate_rate_pct'->>'to' = '35.00'), 'Agreement addendum 2');

-- ── E11 shooting schedule ─────────────────────────────────────────────
SELECT t.as_user(:'A');
INSERT INTO project_shoot_days(project_id, shoot_date, location, region) VALUES
 (:'P','2026-06-10','Studio 1','Riyadh'),(:'P','2026-06-11','Studio 1','Riyadh'),(:'P','2026-06-12','Desert','AlUla');
SELECT t.eq('3 shoot days', project_shoot_day_count(:'P'), 3);
UPDATE project_shoot_days SET shoot_date='2026-06-20', status='planned', change_reason='Rain' WHERE project_id=:'P' AND shoot_date='2026-06-12';
SELECT t.eq('postponed day keeps its first date', (SELECT original_date::text FROM project_shoot_days WHERE project_id=:'P' AND shoot_date='2026-06-20'), '2026-06-12');
UPDATE project_shoot_days SET status='cancelled' WHERE project_id=:'P' AND shoot_date='2026-06-11';
SELECT t.eq('cancelled day not counted', project_shoot_day_count(:'P'), 2);
SELECT t.eq('days numbered', (SELECT string_agg(day_no::text||'@'||shoot_date, ',') FROM project_shoot_dates(:'P')), '1@2026-06-10,2@2026-06-20');
SELECT t.as_user(:'B');
SELECT t.denied('other tenant cannot add shoot days', $$INSERT INTO project_shoot_days(project_id, shoot_date) VALUES ('20000000-0000-0000-0000-000000000197','2026-06-30')$$);
SELECT t.eq('other tenant sees no shoot days', (SELECT count(*) FROM project_shoot_days WHERE project_id=:'P'), 0::bigint);

-- ── E12 mapping: system suggests, accountant approves ────────────────
SELECT t.as_user(:'A');
SELECT t.eq('suggestions for every code', suggest_qpe_mapping(:'P'), 4);
SELECT t.eq('suggest is idempotent', suggest_qpe_mapping(:'P'), 0);
SELECT t.eq('1101 suggested not eligible', (SELECT ineligible_reason||'/'||status FROM budget_code_qpe_map WHERE project_id=:'P' AND budget_code='1101'), 'development/suggested');
SELECT t.eq('before approval: everything is needs review or not eligible', (SELECT count(*) FROM rebate_transactions(:'P') WHERE status='eligible'), 0::bigint);
SELECT set_qpe_mapping(:'P','3101','equipment_rental',NULL);
SELECT set_qpe_mapping(:'P','1403','cast_fees',NULL);
SELECT t.denied('category and reason together refused', $$SELECT set_qpe_mapping('20000000-0000-0000-0000-000000000197','3101','equipment_rental','other')$$);
SELECT t.denied('approved mapping changed without reason refused', $$SELECT set_qpe_mapping('20000000-0000-0000-0000-000000000197','3101',NULL,'overheads')$$);
SELECT t.as_user(:'C');
SELECT t.denied('viewer cannot approve the mapping', $$SELECT set_qpe_mapping('20000000-0000-0000-0000-000000000197','5501','other_qualifying',NULL)$$);
SELECT t.denied('viewer cannot override', $$SELECT set_qpe_override('20000000-0000-0000-0000-000000000197','invoice','f1970000-0000-0000-0000-0000000000b2',true,NULL,NULL,'Looks fine to me')$$);

-- ── the single eligibility source ────────────────────────────────────
SELECT t.as_user(:'A');
CREATE TEMP TABLE rt AS SELECT * FROM rebate_transactions(:'P');
GRANT ALL ON rt TO PUBLIC;
SELECT t.eq('one row per document (pending receipt excluded)', (SELECT count(*) FROM rt), 15::bigint);
SELECT t.eq('Saudi crew eligible', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-CRW-0001'), 'eligible/person_saudi');
SELECT t.eq('payroll wages take a wages category', (SELECT qpe_category FROM rt WHERE ref_no='RB197-CRW-0001'), 'btl_wages');
SELECT t.eq('Saudi mother eligible', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-CRW-0002'), 'eligible/person_saudi_mother');
SELECT t.eq('foreign crew not eligible', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-CRW-0003'), 'not_eligible/foreign_wages');
SELECT t.eq('writer on 1101 not eligible (decision 10)', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-CRW-0004'), 'not_eligible/development');
SELECT t.eq('no nationality: needs review', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-CRW-0005'), 'needs_review/nationality_missing');
SELECT t.eq('wages paid in cash not eligible', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-CST-0001'), 'not_eligible/cash_not_allowed');
SELECT t.eq('Saudi vendor with CR eligible', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-INV-0001'), 'eligible/vendor_saudi_cr');
SELECT t.eq('E06 vendor without CR: needs review, not eligible', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-INV-0002'), 'needs_review/vendor_no_cr');
SELECT t.eq('foreign vendor not eligible', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-INV-0003'), 'not_eligible/foreign_vendor');
SELECT t.eq('outside the production period', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-INV-0004'), 'not_eligible/outside_period');
SELECT t.eq('marketing code not eligible', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-INV-0005'), 'not_eligible/marketing_distribution');
SELECT t.eq('old toggle without reason: review', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-INV-0006'), 'needs_review/override_without_reason');
SELECT t.eq('petty cash receipt eligible', (SELECT status FROM rt WHERE ref_no='RB197-PC-0001'), 'eligible');
SELECT t.eq('cash over the per-transaction limit: review', (SELECT status||'/'||reason FROM rt WHERE ref_no='RB197-PC-0002'), 'needs_review/cash_over_txn_limit');
SELECT t.eq('overtime follows the person', (SELECT status FROM rt WHERE ref_no='RB197-OT-0001'), 'eligible');
SELECT t.eq('R16 paid from payments, not the contract value', (SELECT paid FROM rt WHERE ref_no='RB197-CRW-0002'), 20000.00);
SELECT t.eq('R16 bank reference and IBAN on the row', (SELECT bank_refs||'/'||payee_iban FROM rt WHERE ref_no='RB197-CRW-0001'), 'TRX-1/SA1100');
SELECT t.eq('invoice paid share excludes VAT', (SELECT paid_excl FROM rt WHERE ref_no='RB197-INV-0001'), 20000.00);
SELECT t.eq('bank reference counts as payment proof', (SELECT documented FROM rt WHERE ref_no='RB197-CRW-0001'), true);
DROP TABLE rt;

-- override with reason (E12) — audited
SELECT t.denied('override without a real reason refused', $$SELECT set_qpe_override('20000000-0000-0000-0000-000000000197','invoice','f1970000-0000-0000-0000-0000000000b2',true,NULL,NULL,'ok')$$);
SELECT t.denied('override of another project''s document refused', $$SELECT set_qpe_override('20000000-0000-0000-0000-000000000197','invoice','60000000-0000-0000-0000-000000000001',true,NULL,NULL,'Different project')$$);
SELECT t.eq('override recorded', (SELECT eligible FROM set_qpe_override(:'P','invoice','f1970000-0000-0000-0000-0000000000b2',true,NULL,NULL,'CR checked on the MoC portal')), true);
SELECT t.eq('override wins', (SELECT status||'/'||rule FROM rebate_transactions(:'P') WHERE ref_no='RB197-INV-0002'), 'eligible/override');
SELECT t.eq('override reason shown', (SELECT override_reason FROM rebate_transactions(:'P') WHERE ref_no='RB197-INV-0002'), 'CR checked on the MoC portal');

-- ── the merged report ────────────────────────────────────────────────
CREATE TEMP TABLE r AS SELECT get_film_commission_rebate(:'P') AS j;
GRANT ALL ON r TO PUBLIC;
SELECT t.eq('QPE budget (approved / eligible codes)', (SELECT (j#>>'{summary,qpe_budget}')::numeric FROM r), 180000.00);
SELECT t.eq('expected rebate capped', (SELECT (j#>>'{summary,expected_rebate}')::numeric || '/' || (j#>>'{summary,cap_reached}') FROM r), '50000.00/true');
SELECT t.eq('QPE on contracts', (SELECT (j#>>'{summary,qpe_contracted}')::numeric FROM r), 96600.00);
SELECT t.eq('QPE actual', (SELECT (j#>>'{summary,qpe_actual}')::numeric FROM r), 76600.00);
SELECT t.eq('claimable QPE = paid + eligible + documented', (SELECT (j#>>'{summary,qpe_claimable}')::numeric FROM r), 70600.00);
SELECT t.eq('claimable rebate = 40% of it', (SELECT (j#>>'{summary,claimable_rebate}')::numeric FROM r), 28240.00);
SELECT t.eq('cash limit breached', (SELECT (j#>>'{summary,cash_limit_breached}')::boolean FROM r), true);
SELECT t.eq('cash over per-transaction limit', (SELECT (j#>>'{summary,cash_over_txn_limit}')::int FROM r), 2);
SELECT t.eq('same eligible number in every section: eligibility log', (SELECT sum((e->>'claimable_excl')::numeric) FROM r, jsonb_array_elements(j->'eligibility_log') e), 70600.00);
SELECT t.eq('same eligible number: 5.6 + 5.7 sections', (SELECT sum((e->>'claimable_excl')::numeric) FROM r, jsonb_array_elements(j->'general_expenses') e)
                                                     + (SELECT sum((e->>'claimable_excl')::numeric) FROM r, jsonb_array_elements(j->'payroll') e)
                                                     + (SELECT claimable_excl FROM rebate_transactions(:'P') WHERE source='overtime'), 70600.00);
SELECT t.eq('5.7 crew number is ref_no, not a UUID', (SELECT count(*) FROM r, jsonb_array_elements(j->'payroll') e WHERE e->>'crew_no' ~* '^[0-9a-f]{8}-'), 0::bigint);
SELECT t.eq('5.7 real position', (SELECT e->>'position' FROM r, jsonb_array_elements(j->'payroll') e WHERE e->>'crew_no'='RB197-CRW-0002'), 'DOP');
SELECT t.eq('5.7 working days within the period, off days excluded', (SELECT (e->>'working_days')::int FROM r, jsonb_array_elements(j->'payroll') e WHERE e->>'crew_no'='RB197-CRW-0001'), 22);
SELECT t.eq('5.7 overtime in the salary breakdown', (SELECT (e->>'overtime')::numeric||'/'||(e->>'total_salary')::numeric FROM r, jsonb_array_elements(j->'payroll') e WHERE e->>'crew_no'='RB197-CRW-0001'), '1000.00/31000.00');
SELECT t.eq('5.7 implausible working period flagged', (SELECT e->'flags' ? 'working_period_implausible' FROM r, jsonb_array_elements(j->'payroll') e WHERE e->>'crew_no'='RB197-CRW-0005'), true);
SELECT t.eq('5.7 unanswered related party flagged', (SELECT e->'flags' ? 'related_party_unanswered' FROM r, jsonb_array_elements(j->'payroll') e WHERE e->>'crew_no'='RB197-CRW-0005'), true);
SELECT t.eq('5.6 paid + payments + reference', (SELECT (e->>'paid')||'/'||(e->>'payments_count') FROM r, jsonb_array_elements(j->'general_expenses') e WHERE e->>'ref_no'='RB197-INV-0001'), '23000.00/1');
SELECT t.eq('budget BTL estimate vs actual QPE, variance = estimate - actual', (SELECT (e->>'budget_qpe')||'/'||(e->>'actual_qpe')||'/'||(e->>'variance_qpe') FROM r, jsonb_array_elements(j#>'{budget,by_group}') e WHERE e->>'group'='BTL'), '80000.00/76600.00/3400.00');
SELECT t.eq('headcount: Saudis incl. Saudi mother, trainees', (SELECT (j#>>'{headcount,total}')||'/'||(j#>>'{headcount,saudi}')||'/'||(j#>>'{headcount,saudi_trainees}') FROM r), '6/4/1');
SELECT t.eq('related parties listed', (SELECT string_agg(e->>'name', ',') FROM r, jsonb_array_elements(j->'related_parties') e), 'Mother Saudi DOP');
SELECT t.eq('change log has the settings change with its reason', (SELECT count(*) FROM r, jsonb_array_elements(j->'change_log') e WHERE e->>'area'='settings' AND e->>'reason'='Agreement addendum 2'), 1::bigint);
SELECT t.eq('change log has the postponed shoot day', (SELECT count(*) FROM r, jsonb_array_elements(j->'change_log') e WHERE e->>'area'='schedule' AND e->>'reason'='Rain'), 1::bigint);
SELECT t.eq('change log has the override', (SELECT count(*) FROM r, jsonb_array_elements(j->'change_log') e WHERE e->>'area'='eligibility_override'), 1::bigint);
SELECT t.eq('sections filter', (SELECT get_film_commission_rebate(:'P', ARRAY['summary']) ? 'payroll'), false);
SELECT t.eq('schedule in the report', (SELECT jsonb_array_length(j->'shoot_days') FROM r), 2);

-- viewer: same numbers, masked IDs
SELECT t.as_user(:'C');
SELECT t.eq('viewer gets the same claimable QPE', (SELECT (get_film_commission_rebate(:'P', ARRAY['summary'])#>>'{summary,qpe_claimable}')::numeric), 70600.00);
SELECT t.eq('viewer sees masked ID numbers', (SELECT e->>'id_number' FROM jsonb_array_elements(get_film_commission_rebate(:'P', ARRAY['payroll'])->'payroll') e WHERE e->>'crew_no'='RB197-CRW-0001'), '••••5678');

-- ── N04 crew / cast lists ────────────────────────────────────────────
SELECT t.eq('crew list without contacts for a viewer', (SELECT count(*) FILTER (WHERE phone IS NOT NULL)||'/'||count(*) FROM get_crew_cast_list(:'P','crew')), '0/5');
SELECT t.as_user(:'D');
SELECT t.eq('admin sees contacts', (SELECT phone FROM get_crew_cast_list(:'P','cast')), '0566');
SELECT t.eq('cast list: Saudi + ATL + role', (SELECT is_saudi::text||'/'||cost_group||'/'||character_name FROM get_crew_cast_list(:'P','cast')), 'true/ATL/Hero');

-- ── tenant isolation ─────────────────────────────────────────────────
SELECT t.as_user(:'B');
SELECT t.denied('tenant B: transactions', $$SELECT * FROM rebate_transactions('20000000-0000-0000-0000-000000000197')$$);
SELECT t.denied('tenant B: report', $$SELECT get_film_commission_rebate('20000000-0000-0000-0000-000000000197')$$);
SELECT t.denied('tenant B: crew list', $$SELECT * FROM get_crew_cast_list('20000000-0000-0000-0000-000000000197','crew')$$);
SELECT t.denied('tenant B: suggest', $$SELECT suggest_qpe_mapping('20000000-0000-0000-0000-000000000197')$$);
SELECT t.eq('tenant B reads no settings', (SELECT count(*) FROM project_rebate_settings WHERE project_id=:'P'), 0::bigint);
SELECT t.eq('tenant B reads no mapping', (SELECT count(*) FROM budget_code_qpe_map WHERE project_id=:'P'), 0::bigint);
RESET ROLE;

-- budget upload suggests a mapping automatically
INSERT INTO budget_lines(project_id,organization_id,version_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency) VALUES
 (:'P',:'O1',:'V4','3600','3601','3600','Vans',1,1000,1,'Package','SAR');
SELECT t.eq('new budget code suggested on upload', (SELECT qpe_category||'/'||status FROM budget_code_qpe_map WHERE project_id=:'P' AND budget_code='3601'), 'transport/suggested');
