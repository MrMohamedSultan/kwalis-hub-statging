\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set P3 '20000000-0000-0000-0000-000000000003'
\set O1 '10000000-0000-0000-0000-000000000001'
-- a dedicated project for rebate / tax / spend fixtures
SET session_replication_role = replica;
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status,start_date,end_date) VALUES
 (:'P3',:'A','Rebate fixtures','RBT1',:'O1','SAR',3.75,'Production','2026-06-01','2026-12-31');
INSERT INTO project_members(project_id,user_id) VALUES (:'P3',:'A'),(:'P3',:'C');
INSERT INTO budget_versions(id,project_id,organization_id,version_no,version_name,status) VALUES ('40000000-0000-0000-0000-000000000030',:'P3',:'O1',1,'v1.0','active');
INSERT INTO budget_lines(project_id,organization_id,version_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency,rebate_eligible) VALUES
 (:'P3',:'O1','40000000-0000-0000-0000-000000000030','1400','1403','1400','Cast',1,100000,1,'Package','SAR',true),
 (:'P3',:'O1','40000000-0000-0000-0000-000000000030','2100','2101','2100','Camera',1,50000,1,'Package','SAR',true),
 (:'P3',:'O1','40000000-0000-0000-0000-000000000030','2100','2102','2100','Not eligible line',1,30000,1,'Package','SAR',false);
INSERT INTO vendors(id,name,organization_id,project_id,company_nationality,cr_no,vat_no) VALUES
 ('a1000000-0000-0000-0000-000000000001','Riyadh Camera House',:'O1',:'P3','Saudi Arabia','1010123456','300012345600003'),
 ('a1000000-0000-0000-0000-000000000002','Paris Post SARL',:'O1',:'P3','France','FR998877',NULL);
INSERT INTO people(id,kind,full_name,nationality,id_number,organization_id,project_id,position,country) VALUES
 ('b1000000-0000-0000-0000-000000000001','cast','Saudi Actor','Saudi Arabia','1098765432',:'O1',:'P3','Lead','Saudi Arabia'),
 ('b1000000-0000-0000-0000-000000000002','crew','Tunisian DOP','Tunisia','TN5554443',:'O1',:'P3','DOP','Tunisia'),
 ('b1000000-0000-0000-0000-000000000003','crew','Egyptian Guest','Egypt','EG1',:'O1',:'P3','Guest','Egypt');
INSERT INTO invoices(id,invoice_no,description,department,budget_code,price,vatable,vat_amount,date,vendor_name,organization_id,project_id,service_inside_ksa,is_non_saudi_vendor,rebate_manual_override,rebate_eligible,beneficiary_id,wht_percent,wht_amount) VALUES
 -- Rule B, Saudi vendor: eligible
 ('c1000000-0000-0000-0000-000000000001','INV-001','ARRI camera package','Camera','2101',20000,true,3000,'2026-07-10','Riyadh Camera House',:'O1',:'P3',true,false,false,false,NULL,0,0),
 -- Rule B, French vendor: not eligible
 ('c1000000-0000-0000-0000-000000000002','INV-002','Colour grade','Post','2102',10000,false,0,'2026-08-05','Paris Post SARL',:'O1',:'P3',true,true,false,false,NULL,5,500),
 -- Rule C, outside KSA: not eligible although vendor is Saudi
 ('c1000000-0000-0000-0000-000000000003','INV-003','Lens rental abroad shoot','Camera','2101',4000,true,0,'2026-08-20','Riyadh Camera House',:'O1',:'P3',false,false,false,false,NULL,0,0),
 -- Rule A, hotel for an Egyptian beneficiary: not eligible
 ('c1000000-0000-0000-0000-000000000004','INV-004','Hotel nights','Accommodation','2101',3000,true,450,'2026-09-02','Riyadh Camera House',:'O1',:'P3',true,false,false,false,'b1000000-0000-0000-0000-000000000003',0,0),
 -- Rule A, hotel for a Saudi beneficiary: eligible
 ('c1000000-0000-0000-0000-000000000005','INV-005','Hotel nights','Accommodation','2101',2000,true,300,'2026-09-03','Riyadh Camera House',:'O1',:'P3',true,false,false,false,'b1000000-0000-0000-0000-000000000001',0,0),
 -- Manual override: accountant forces eligible on a foreign vendor
 ('c1000000-0000-0000-0000-000000000006','INV-006','VFX shots','Post','2102',5000,false,0,'2026-09-10','Paris Post SARL',:'O1',:'P3',true,true,true,true,NULL,5,250),
 -- unknown vendor, no nationality: eligible by default
 ('c1000000-0000-0000-0000-000000000007',NULL,'Catering','Catering','2101',1000,true,150,'2026-09-12','Unknown Kitchen',:'O1',:'P3',true,false,false,false,NULL,0,0);
INSERT INTO payroll(id,ref_id,name,kind,total_amount,budget_code,organization_id,project_id,created_at,wht_percent,wht_amount) VALUES
 ('d1000000-0000-0000-0000-000000000001','PR-01','Saudi Actor','cast',40000,'1403',:'O1',:'P3','2026-07-15',0,0),
 ('d1000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000002','Tunisian DOP','crew',30000,'2101',:'O1',:'P3','2026-08-15',5,1500),
 ('d1000000-0000-0000-0000-000000000003','PR-03','Nobody In People','crew',7000,'2101',:'O1',:'P3','2026-09-15',0,0);
INSERT INTO cash_advances(id,holder,total_advance,organization_id,project_id,status) VALUES ('91000000-0000-0000-0000-000000000003','Runner',5000,:'O1',:'P3','open');
INSERT INTO cash_advance_receipts(id,advance_id,recipient,department,amount,date,organization_id,project_id,budget_code,status) VALUES
 ('e1000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003','Local shop','Props',600,'2026-09-05',:'O1',:'P3','2101','approved'),
 ('e1000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000003','International travel agent','Travel',900,'2026-09-06',:'O1',:'P3','2101','approved');
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date) VALUES
 (:'O1',:'P3','invoice','c1000000-0000-0000-0000-000000000001',23000,'2026-07-20'),
 (:'O1',:'P3','payroll','d1000000-0000-0000-0000-000000000001',10000,'2026-07-25');
SET session_replication_role = origin;

SELECT t.as_user(:'A');
CREATE TEMP TABLE q AS SELECT * FROM get_qfe_ledger(:'P3');
GRANT ALL ON q TO PUBLIC;
SELECT t.eq('one row per document', (SELECT count(*) FROM q), 12::bigint);
SELECT t.eq('Rule B Saudi vendor eligible',        (SELECT qfe::text||'|'||qfe_rule FROM q WHERE reference='INV-001'), 'true|Rule B');
SELECT t.eq('Rule B flagged non-Saudi not eligible',(SELECT qfe::text||'|'||qfe_rule FROM q WHERE reference='INV-002'), 'false|Rule B');
SELECT t.eq('Rule C outside KSA not eligible',     (SELECT qfe::text||'|'||qfe_rule FROM q WHERE reference='INV-003'), 'false|Rule C');
SELECT t.eq('Rule A foreign beneficiary not eligible',(SELECT qfe::text||'|'||qfe_rule FROM q WHERE reference='INV-004'), 'false|Rule A');
SELECT t.eq('Rule A Saudi beneficiary eligible',   (SELECT qfe::text||'|'||qfe_rule FROM q WHERE reference='INV-005'), 'true|Rule A');
SELECT t.eq('manual override wins',                (SELECT qfe::text||'|'||qfe_rule FROM q WHERE reference='INV-006'), 'true|Manual Override');
SELECT t.eq('unknown vendor eligible by default',  (SELECT qfe FROM q WHERE party='Unknown Kitchen'), true);
SELECT t.eq('Saudi payroll eligible',              (SELECT qfe FROM q WHERE party='Saudi Actor'), true);
SELECT t.eq('foreign payroll not eligible',        (SELECT qfe::text||'|'||local_intl FROM q WHERE party='Tunisian DOP'), 'false|Foreign');
SELECT t.eq('payroll with no people row: eligible but flagged unmatched', (SELECT qfe::text||'|'||person_matched::text FROM q WHERE party='Nobody In People'), 'true|false');
SELECT t.eq('petty cash local eligible',           (SELECT qfe FROM q WHERE party='Local shop'), true);
SELECT t.eq('petty cash tagged international/travel not eligible', (SELECT qfe FROM q WHERE party='International travel agent'), false);
SELECT t.eq('reference is never a UUID',           (SELECT count(*) FROM q WHERE reference ~* '^[0-9a-f]{8}-'), 0::bigint);
SELECT t.eq('base excludes VAT',                   (SELECT amount_excl_vat::text||'/'||vat_amount::text||'/'||amount::text FROM q WHERE reference='INV-001'), '20000.00/3000.00/23000.00');
SELECT t.eq('VAT falls back to 15% when a vatable invoice stores 0', (SELECT vat_amount FROM q WHERE reference='INV-003'), 600.00);
SELECT t.eq('payment status from the payments ledger: paid', (SELECT payment_status FROM q WHERE reference='INV-001'), 'Paid');
SELECT t.eq('payment status: partially paid', (SELECT payment_status||'/'||balance::text FROM q WHERE party='Saudi Actor'), 'Partially Paid/30000.00');
SELECT t.eq('payment status: unpaid', (SELECT payment_status FROM q WHERE reference='INV-002'), 'Unpaid');
SELECT t.eq('QPE type classified', (SELECT qpe_type FROM q WHERE reference='INV-001'), 'Camera Equipment Rental');
SELECT t.eq('editor sees the full official id', (SELECT official_id FROM q WHERE reference='INV-001'), '1010123456 · 300012345600003');
-- the single number
\set QFE 75600.00
SELECT t.eq('QFE total = 20000+2000+5000+1000 + 40000+7000 + 600', (SELECT sum(amount_excl_vat) FILTER (WHERE qfe) FROM q), :QFE);
CREATE TEMP TABLE s AS SELECT get_sfc_rebate(:'P3') AS j;
GRANT ALL ON s TO PUBLIC;
SELECT t.eq('summary.qfe_total = ledger', (SELECT (j#>>'{summary,qfe_total}')::numeric FROM s), :QFE);
SELECT t.eq('summary.projected_rebate = 40%', (SELECT (j#>>'{summary,projected_rebate}')::numeric FROM s), 30240.00);
SELECT t.eq('summary.total_budget', (SELECT (j#>>'{summary,total_budget}')::numeric FROM s), 180000.00);
SELECT t.eq('qfe + non-qfe = all spend excl VAT', (SELECT (j#>>'{summary,qfe_total}')::numeric + (j#>>'{summary,non_qfe_total}')::numeric FROM s), (SELECT sum(amount_excl_vat) FROM q));
SELECT t.eq('unmatched payroll rows surfaced', (SELECT (j#>>'{summary,unmatched_payroll_rows}')::int FROM s), 1);
SELECT t.eq('ledger array has every row', (SELECT jsonb_array_length(j->'ledger') FROM s), 12);
SELECT t.eq('estimated vs actual: ATL', (SELECT (e->>'estimated_eligible_budget')||'/'||(e->>'actual_eligible_spend') FROM s, jsonb_array_elements(j->'estimated_vs_actual') e WHERE e->>'group'='ATL'), '100000.00/40000.00');
SELECT t.eq('estimated vs actual sums to the QFE total', (SELECT sum((e->>'actual_eligible_spend')::numeric) FROM s, jsonb_array_elements(j->'estimated_vs_actual') e), :QFE);
SELECT t.eq('period filter', (SELECT (get_sfc_rebate(:'P3','2026-07-01','2026-07-31')#>>'{summary,qfe_total}')::numeric), 60000.00);
SELECT t.eq('custom rate', (SELECT (get_sfc_rebate(:'P3',NULL,NULL,0.25)#>>'{summary,projected_rebate}')::numeric), 18900.00);
SELECT t.denied('rate above 1 rejected', $$SELECT get_sfc_rebate('20000000-0000-0000-0000-000000000003',NULL,NULL,40)$$);
-- viewer: IDs masked to the last 4
SELECT t.as_user(:'C');
SELECT t.eq('viewer sees a masked official id', (SELECT official_id FROM get_qfe_ledger(:'P3') WHERE reference='INV-001'), '••••0003');
SELECT t.eq('viewer sees a masked national id', (SELECT official_id FROM get_qfe_ledger(:'P3') WHERE party='Saudi Actor'), '••••5432');
SELECT t.eq('viewer gets the same QFE total', (SELECT (get_sfc_rebate(:'P3')#>>'{summary,qfe_total}')::numeric), :QFE);
SELECT t.as_user(:'B');
SELECT t.denied('tenant B refused: ledger', $$SELECT * FROM get_qfe_ledger('20000000-0000-0000-0000-000000000003')$$);
SELECT t.denied('tenant B refused: rebate', $$SELECT get_sfc_rebate('20000000-0000-0000-0000-000000000003')$$);
RESET ROLE;
