\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set D '00000000-0000-0000-0000-00000000000d'
\set P3 '20000000-0000-0000-0000-000000000003'
\set O1 '10000000-0000-0000-0000-000000000001'
SET session_replication_role = replica;
UPDATE invoices SET spend_city = 'Riyadh' WHERE id = 'c1000000-0000-0000-0000-000000000001';
UPDATE invoices SET spend_country = 'Jordan', spend_city = 'Amman' WHERE id = 'c1000000-0000-0000-0000-000000000003';
UPDATE payroll  SET spend_country = 'KSA', spend_city = 'AlUla' WHERE id = 'd1000000-0000-0000-0000-000000000002';
INSERT INTO locations(project_id, organization_id, name, city, shoot_days) VALUES (:'P3', :'O1', 'Old town', 'Riyadh', 6), (:'P3', :'O1', 'Studio', 'riyadh ', 4), (:'P3', :'O1', 'Canyon', 'AlUla', 9);
SET session_replication_role = origin;
SELECT t.as_user(:'A');
CREATE TEMP TABLE g AS SELECT * FROM get_gsr(:'P3');
GRANT ALL ON g TO PUBLIC;
SELECT t.eq('total = Actual excl. VAT', (SELECT sum(amount_excl_vat) FROM g), (SELECT round(sum(amount),2) FROM v_ledger_transactions WHERE project_id=:'P3' AND entry_kind='actual'));
SELECT t.eq('percentages add to 100', (SELECT round(sum(pct)) FROM g), 100::numeric);
SELECT t.eq('explicit country/city wins (Jordan/Amman)', (SELECT amount_excl_vat FROM g WHERE country='Jordan' AND city='Amman'), 4000.00);
SELECT t.eq('country falls back to the vendor (Saudi Arabia / Riyadh)', (SELECT amount_excl_vat FROM g WHERE country='Saudi Arabia' AND city='Riyadh'), 20000.00);
SELECT t.eq('KSA normalised to Saudi Arabia', (SELECT count(*) FROM g WHERE country IN ('KSA','Saudi')), 0::bigint);
SELECT t.eq('foreign crew working in KSA: spent in Saudi Arabia, International party', (SELECT local_intl||'|'||amount_excl_vat::text FROM g WHERE city='AlUla'), 'International|30000.00');
SELECT t.eq('French vendor spend under France', (SELECT sum(amount_excl_vat) FROM g WHERE country='France'), 15000.00);
SELECT t.eq('no place recorded -> Unspecified, never guessed', (SELECT sum(amount_excl_vat) FROM g WHERE country='Unspecified'), 9500.00);
SELECT t.eq('payroll defaults to Labour', (SELECT count(*) FROM g WHERE city='AlUla' AND spend_type='Labour'), 1::bigint);
SELECT t.eq('invoices default to Vendors', (SELECT spend_type FROM g WHERE country='Jordan'), 'Vendors');
SELECT t.eq('shoot days summed per city, case/space-insensitive', (SELECT max(shoot_days) FROM g WHERE city='Riyadh'), 10);
SELECT t.eq('shoot days for AlUla', (SELECT max(shoot_days) FROM g WHERE city='AlUla'), 9);
SELECT t.eq('category from the top sheet section', (SELECT bool_and(category IN ('ATL','Production','Post','Other','Adjustments')) FROM g), true);
SELECT t.eq('period filter', (SELECT sum(amount_excl_vat) FROM get_gsr(:'P3','2026-07-01','2026-07-31')), 60000.00);
-- spend-type mapping by budget code
SELECT t.as_user(:'D');
INSERT INTO gsr_spend_type_map(organization_id, budget_code_prefix, spend_type) VALUES (:'O1', '2101', 'Rentals');
SELECT t.denied('unknown spend type rejected', $$INSERT INTO gsr_spend_type_map(organization_id, budget_code_prefix, spend_type) VALUES ('10000000-0000-0000-0000-000000000001','2102','Bananas')$$);
SELECT t.as_user(:'A');
SELECT t.eq('mapping re-labels code 2101', (SELECT spend_type FROM get_gsr(:'P3') WHERE country='Jordan'), 'Rentals');
SELECT t.eq('total unchanged by mapping', (SELECT sum(amount_excl_vat) FROM get_gsr(:'P3')), (SELECT sum(amount_excl_vat) FROM g));
SELECT t.denied('plain member cannot write the mapping', $$INSERT INTO gsr_spend_type_map(organization_id, budget_code_prefix, spend_type) VALUES ('10000000-0000-0000-0000-000000000001','14','Labour')$$);
SELECT t.as_user(:'B');
SELECT t.denied('tenant B refused', $$SELECT * FROM get_gsr('20000000-0000-0000-0000-000000000003')$$);
SELECT t.eq('tenant B sees no org1 mapping', (SELECT count(*) FROM gsr_spend_type_map), 0::bigint);
RESET ROLE;
