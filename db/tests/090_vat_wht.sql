\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set D '00000000-0000-0000-0000-00000000000d'
\set P3 '20000000-0000-0000-0000-000000000003'
\set O1 '10000000-0000-0000-0000-000000000001'
SELECT t.as_user(:'A');
-- VAT: manual check against 3 invoices (acceptance)
SELECT t.eq('INV-001 VAT as stored', (SELECT vat FROM get_vat_report(:'P3') WHERE invoice_no='INV-001'), 3000.00);
SELECT t.eq('INV-003 vatable with 0 stored -> 15% of 4,000', (SELECT vat FROM get_vat_report(:'P3') WHERE invoice_no='INV-003'), 600.00);
SELECT t.eq('INV-004 VAT as stored', (SELECT vat FROM get_vat_report(:'P3') WHERE invoice_no='INV-004'), 450.00);
SELECT t.eq('non-vatable invoices are not listed', (SELECT count(*) FROM get_vat_report(:'P3') WHERE invoice_no IN ('INV-002','INV-006')), 0::bigint);
SELECT t.eq('all rows are input VAT', (SELECT count(*) FROM get_vat_report(:'P3') WHERE type <> 'input'), 0::bigint);
SELECT t.eq('Q3 2026 input VAT total', (SELECT sum(vat) FROM get_vat_report(:'P3','2026-Q3')), 4500.00);
SELECT t.eq('Q4 2026 has none', (SELECT count(*) FROM get_vat_report(:'P3','2026-Q4')), 0::bigint);
SELECT t.eq('vendor VAT number shown', (SELECT vat_no FROM get_vat_report(:'P3') WHERE invoice_no='INV-001'), '300012345600003');
SELECT t.eq('total = net + vat', (SELECT count(*) FROM get_vat_report(:'P3') WHERE total <> net + vat), 0::bigint);
SELECT t.denied('bad quarter rejected', $$SELECT * FROM get_vat_report('20000000-0000-0000-0000-000000000003','2026-Q5')$$);
-- WHT
CREATE TEMP TABLE w AS SELECT * FROM get_wht_report(:'P3');
GRANT ALL ON w TO PUBLIC;
SELECT t.eq('WHT rows: 2 foreign-vendor invoices + 1 foreign crew', (SELECT count(*) FROM w), 3::bigint);
SELECT t.eq('invoice uses the amount stored on the document', (SELECT wht_amount::text||'|'||rate_source FROM w WHERE source_document='INV-002'), '500.00|document');
SELECT t.eq('payroll uses its stored WHT', (SELECT wht_amount::text||'|'||rate::text FROM w WHERE party='Tunisian DOP'), '1500.00|5.00');
SELECT t.eq('country from vendor / person', (SELECT string_agg(country, ',' ORDER BY country) FROM w), 'France,France,Tunisia');
SELECT t.eq('Saudi parties are not listed', (SELECT count(*) FROM w WHERE party IN ('Saudi Actor','Riyadh Camera House')), 0::bigint);
SELECT t.eq('month filter', (SELECT sum(wht_amount) FROM get_wht_report(:'P3','2026-08')), 2000.00);
SELECT t.denied('bad month rejected', $$SELECT * FROM get_wht_report('20000000-0000-0000-0000-000000000003','2026-13')$$);
SELECT t.eq('default treatment is inclusive: budget cost = base', (SELECT wht_treatment||'|'||(budget_cost = base_amount)::text FROM w WHERE source_document='INV-002'), 'inclusive|true');
RESET ROLE; SET session_replication_role = replica;
UPDATE invoices SET wht_treatment = 'exclusive' WHERE invoice_no = 'INV-002';
SET session_replication_role = origin;
SELECT t.as_user(:'A');
SELECT t.eq('exclusive (gross-up): budget cost = base + WHT, WHT unchanged', (SELECT wht_treatment||'|'||wht_amount::text||'|'||(budget_cost - base_amount)::text FROM get_wht_report(:'P3') WHERE source_document='INV-002'), 'exclusive|500.00|500.00');
RESET ROLE; SET session_replication_role = replica;
UPDATE invoices SET wht_treatment = 'inclusive' WHERE invoice_no = 'INV-002';
SET session_replication_role = origin;
SELECT t.as_user(:'A');
-- the rate comes from the table, never from code
RESET ROLE; SET session_replication_role = replica;
UPDATE invoices SET wht_percent = 0, wht_amount = 0 WHERE id = 'c1000000-0000-0000-0000-000000000006';
SET session_replication_role = origin;
SELECT t.as_user(:'A');
SELECT t.eq('no rate on the document -> platform default 5%', (SELECT rate::text||'|'||wht_amount::text||'|'||rate_source FROM get_wht_report(:'P3') WHERE source_document='INV-006'), '5.00|250.00|rate table');
SELECT t.denied('plain member cannot change rates', $$INSERT INTO wht_rate_rules(organization_id, service_type, rate_pct) VALUES ('10000000-0000-0000-0000-000000000001','post',15)$$);
SELECT t.as_user(:'D');
INSERT INTO wht_rate_rules(organization_id, service_type, rate_pct) VALUES (:'O1', 'post', 15);
SELECT t.denied('org admin cannot change the platform default', $$UPDATE wht_rate_rules SET rate_pct = 0 WHERE organization_id IS NULL$$);
SELECT t.as_user(:'A');
SELECT t.eq('org rule for the service type now applies', (SELECT rate::text||'|'||wht_amount::text FROM get_wht_report(:'P3') WHERE source_document='INV-006'), '15.00|750.00');
SELECT t.eq('documents with their own rate are unaffected', (SELECT wht_amount FROM get_wht_report(:'P3') WHERE source_document='INV-002'), 500.00);
SELECT t.as_user(:'B');
SELECT t.denied('tenant B refused: VAT', $$SELECT * FROM get_vat_report('20000000-0000-0000-0000-000000000003')$$);
SELECT t.denied('tenant B refused: WHT', $$SELECT * FROM get_wht_report('20000000-0000-0000-0000-000000000003')$$);
SELECT t.eq('tenant B sees only the platform default rate', (SELECT count(*) FROM wht_rate_rules), 1::bigint);
SELECT t.eq('tenant B does not inherit org1''s rate', public.resolve_wht_rate('10000000-0000-0000-0000-000000000002','post'), 5.00);
RESET ROLE;
