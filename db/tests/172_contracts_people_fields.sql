-- 172 — contract fields on people: columns, checks, backfill, tenant access
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P1 '20000000-0000-0000-0000-000000000001'
\set N1 '72000000-0000-0000-0000-000000000001'
\set N2 '72000000-0000-0000-0000-000000000002'
\set N3 '72000000-0000-0000-0000-000000000003'

SET session_replication_role = replica;
INSERT INTO people(id,kind,full_name,nationality,id_number,organization_id,project_id,shooting_days,daily_rate,ccy) VALUES
 (:'N1','crew','Saudi crew','Saudi Arabia','1012345678',:'O1',:'P1',10,700,'SAR'),
 (:'N2','cast','Resident actor','Egypt',' 2012345678 ',:'O1',:'P1',10,700,'SAR'),
 (:'N3','cast','Foreign actor','Egypt','A1234567',:'O1',:'P1',10,700,'USD');
INSERT INTO payroll(name,kind,ref_id,total_amount,wht_percent,wht_amount,net_payable,organization_id,project_id) VALUES
 ('Foreign actor','cast',:'N3',7000,5,350,6650,:'O1',:'P1');
SET session_replication_role = origin;

-- re-apply the pending file: proves idempotency and runs the backfill on these rows
\ir ../pending/172_contracts_people_fields.sql

SELECT t.eq('national ID backfilled', (SELECT id_type FROM people WHERE id = :'N1'), 'national_id');
SELECT t.eq('iqama backfilled (trimmed)', (SELECT id_type FROM people WHERE id = :'N2'), 'iqama');
SELECT t.eq('passport left for the user', (SELECT id_type FROM people WHERE id = :'N3'), NULL::text);
SELECT t.eq('wht_rate taken from the contract payroll', (SELECT wht_rate FROM people WHERE id = :'N3'), 5.00::numeric(5,2));
SELECT t.eq('no WHT → rate stays empty', (SELECT wht_rate FROM people WHERE id = :'N1'), NULL::numeric);
SELECT t.eq('residency not guessed in the DB', (SELECT count(*) FROM people WHERE tax_residency IS NOT NULL AND id IN (:'N1',:'N2',:'N3')), 0::bigint);
SELECT t.eq('existing values untouched', (SELECT id_number || '|' || nationality || '|' || daily_rate FROM people WHERE id = :'N2'), ' 2012345678 |Egypt|700');
SELECT t.eq('wht_treatment defaults to inclusive', (SELECT wht_treatment FROM people WHERE id = :'N3'), 'inclusive');

-- checks on the new columns
SELECT t.denied('tax_residency only resident / non_resident', $$UPDATE people SET tax_residency = 'maybe' WHERE id = '72000000-0000-0000-0000-000000000001'$$);
SELECT t.denied('id_type only the three types', $$UPDATE people SET id_type = 'licence' WHERE id = '72000000-0000-0000-0000-000000000001'$$);
SELECT t.denied('wht_rate below 100', $$UPDATE people SET wht_rate = 100 WHERE id = '72000000-0000-0000-0000-000000000001'$$);
SELECT t.denied('wht_treatment only inclusive / exclusive', $$UPDATE people SET wht_treatment = 'other' WHERE id = '72000000-0000-0000-0000-000000000001'$$);
SELECT t.denied('payroll wht_treatment checked too', $$UPDATE payroll SET wht_treatment = 'other' WHERE ref_id = '72000000-0000-0000-0000-000000000003'$$);

-- the project member saves the confirmed fields (exclusive 5% on 7,000 net)
SELECT t.as_user(:'A');
UPDATE people SET tax_residency = 'non_resident', wht_service_type = 'default', wht_rate = 5,
                  wht_treatment = 'exclusive', id_type = 'passport', mother_saudi = false, related_party = true
 WHERE id = :'N3';
UPDATE payroll SET wht_treatment = 'exclusive', total_amount = 7368.42, wht_amount = 368.42, net_payable = 7000
 WHERE ref_id = :'N3';
SELECT t.eq('member saved the contract fields', (SELECT tax_residency || '|' || wht_treatment || '|' || id_type || '|' || related_party FROM people WHERE id = :'N3'), 'non_resident|exclusive|passport|true');
SELECT t.eq('stored figures match the gross-up', (SELECT total_amount - wht_amount = net_payable FROM payroll WHERE ref_id = :'N3'), true);
RESET ROLE;

-- other tenant cannot see or change them
SELECT t.as_user(:'B');
SELECT t.eq('other tenant sees none of these contracts', (SELECT count(*) FROM people WHERE id IN (:'N1',:'N2',:'N3')), 0::bigint);
SELECT t.denied('other tenant cannot confirm residency', $$UPDATE people SET tax_residency = 'resident' WHERE id = '72000000-0000-0000-0000-000000000003'$$);
RESET ROLE;
