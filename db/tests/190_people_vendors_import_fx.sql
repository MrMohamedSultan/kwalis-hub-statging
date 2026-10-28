-- 190 — person profiles, vendor → invoice, dated FX rates, budget import checks
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set O1 '10000000-0000-0000-0000-000000000001'
\set O2 '10000000-0000-0000-0000-000000000002'
\set P1 '20000000-0000-0000-0000-000000000001'
\set P2 '20000000-0000-0000-0000-000000000002'
\set C1 '19000000-0000-0000-0000-000000000001'
\set C2 '19000000-0000-0000-0000-000000000002'
\set C3 '19000000-0000-0000-0000-000000000003'
\set C4 '19000000-0000-0000-0000-000000000004'
\set L1 '19000000-0000-0000-0000-000000000011'
\set L2 '19000000-0000-0000-0000-000000000012'
\set L3 '19000000-0000-0000-0000-000000000013'
\set L4 '19000000-0000-0000-0000-000000000014'
\set V1 '19000000-0000-0000-0000-000000000021'
\set V2 '19000000-0000-0000-0000-000000000022'

-- ── E01: legacy contracts (written before 190, no triggers) ───────────
SET session_replication_role = replica;
INSERT INTO people(id,kind,full_name,nationality,id_number,organization_id,project_id,ccy,created_at) VALUES
 (:'L1','crew','Mohammed Abdullah Alajmi','Saudi Arabia','1055500001',:'O1',:'P1','SAR','2026-01-01'),
 (:'L2','crew','Moahmmed Abdullah AlAjami','Saudi Arabia',' 1055500001 ',:'O1',:'P1','SAR','2026-01-02'),
 (:'L3','cast','Mohamed Abdulla Alajmi','Saudi Arabia','',:'O1',:'P1','SAR','2026-01-03'),
 (:'L4','cast','Sara Ali','Egypt','2055500003',:'O1',:'P1','SAR','2026-01-04');
SET session_replication_role = origin;

-- dry run: nothing written, the plan is listed
SELECT t.eq('dry run lists the 4 unlinked contracts', (SELECT count(*) FROM persons_backfill(:'O1') WHERE contract_id IN (:'L1',:'L2',:'L3',:'L4')), 4::bigint);
SELECT t.eq('dry run: same ID → linked, not a second profile', (SELECT action FROM persons_backfill(:'O1') WHERE contract_id = :'L2'), 'linked_by_id');
SELECT t.eq('dry run: no ID → own profile (never matched by name)', (SELECT action FROM persons_backfill(:'O1') WHERE contract_id = :'L3'), 'created_no_id');
SELECT t.eq('dry run wrote nothing', (SELECT count(*) FROM people WHERE id IN (:'L1',:'L2',:'L3',:'L4') AND person_id IS NOT NULL), 0::bigint);
-- apply (owner, SQL editor)
SELECT count(*) FROM persons_backfill(:'O1', true);
SELECT t.eq('exact ID match → one profile for two contracts', (SELECT count(DISTINCT person_id) FROM people WHERE id IN (:'L1',:'L2')), 1::bigint);
SELECT t.eq('look-alike name without ID → separate profile', (SELECT (SELECT person_id FROM people WHERE id=:'L3') <> (SELECT person_id FROM people WHERE id=:'L1')), true);
SELECT t.eq('backfill leaves contract names as they were', (SELECT full_name FROM people WHERE id = :'L2'), 'Moahmmed Abdullah AlAjami');
SELECT t.eq('profile takes the first contract''s name', (SELECT ps.full_name FROM persons ps JOIN people pe ON pe.person_id = ps.id WHERE pe.id = :'L2'), 'Mohammed Abdullah Alajmi');
SELECT t.eq('backfill is idempotent', (SELECT count(*) FROM persons_backfill(:'O1', true) WHERE contract_id IN (:'L1',:'L2',:'L3',:'L4')), 0::bigint);

-- ── E01: contracts saved by the app ───────────────────────────────────
SELECT t.as_user(:'A');
SELECT t.denied('a member cannot run the backfill', $$SELECT * FROM persons_backfill('10000000-0000-0000-0000-000000000001', true)$$);
INSERT INTO people(id,kind,full_name,nationality,id_number,id_type,bank,bank_country,iban,organization_id,project_id,ccy)
VALUES (:'C1','crew','Khalid Omar','Saudi Arabia','1055500002','national_id','Al Rajhi Bank','Saudi Arabia','SA0380000000608010167519',:'O1',:'P1','SAR');
SELECT t.eq('new contract gets a profile', (SELECT person_id IS NOT NULL FROM people WHERE id = :'C1'), true);
SELECT person_id AS pk FROM people WHERE id = :'C1' \gset
SELECT t.eq('profile carries the identity', (SELECT full_name || '|' || id_number || '|' || nationality FROM persons WHERE id = :'pk'), 'Khalid Omar|1055500002|Saudi Arabia');
SELECT t.eq('profile keeps the bank as default', (SELECT bank FROM persons WHERE id = :'pk'), 'Al Rajhi Bank');
-- second contract typed with another spelling but the SAME ID → same person, profile name
INSERT INTO people(id,kind,full_name,nationality,id_number,organization_id,project_id,ccy)
VALUES (:'C2','cast','Khaled Omer','Saudi Arabia','1055500002',:'O1',:'P1','SAR');
SELECT t.eq('same ID number → linked to the existing profile', (SELECT person_id FROM people WHERE id = :'C2'), :'pk'::uuid);
SELECT t.eq('...and takes the profile spelling', (SELECT full_name FROM people WHERE id = :'C2'), 'Khalid Omar');
SELECT t.eq('...and the default bank', (SELECT bank || '|' || iban FROM people WHERE id = :'C2'), 'Al Rajhi Bank|SA0380000000608010167519');
SELECT t.eq('still one profile for that ID', (SELECT count(*) FROM persons WHERE organization_id = :'O1' AND id_number_key = '1055500002'), 1::bigint);
-- third contract picked from the list with empty identity fields
INSERT INTO people(id,kind,full_name,organization_id,project_id,ccy,person_id)
VALUES (:'C3','crew','',:'O1',:'P1','SAR',:'pk');
SELECT t.eq('picked person fills the empty fields', (SELECT full_name || '|' || id_number || '|' || nationality FROM people WHERE id = :'C3'), 'Khalid Omar|1055500002|Saudi Arabia');
-- correcting the name on one contract updates the profile and the other contracts
UPDATE people SET full_name = 'Khalid Omar Alharbi', phone_number = '+966500000000' WHERE id = :'C1';
SELECT t.eq('profile follows the contract edit', (SELECT full_name || '|' || phone_number FROM persons WHERE id = :'pk'), 'Khalid Omar Alharbi|+966500000000');
SELECT t.eq('other contracts follow the profile', (SELECT count(*) FROM people WHERE person_id = :'pk' AND full_name = 'Khalid Omar Alharbi' AND phone_number = '+966500000000'), 3::bigint);
-- an untouched field on a contract does not undo the profile
UPDATE people SET daily_rate = 900 WHERE id = :'C2';
SELECT t.eq('rate edit keeps the identity', (SELECT full_name FROM people WHERE id = :'C2'), 'Khalid Omar Alharbi');
-- contract-only fields stay per contract
SELECT t.eq('rate is per contract', (SELECT daily_rate FROM people WHERE id = :'C1'), 0::numeric);
-- profile edited directly → contracts follow
UPDATE persons SET nationality = 'Saudi Arabia', email = 'khalid@example.com' WHERE id = :'pk';
SELECT t.eq('profile edit reaches every contract', (SELECT count(*) FROM people WHERE person_id = :'pk' AND email = 'khalid@example.com'), 3::bigint);
-- the same ID on another person is refused with a readable message
INSERT INTO people(id,kind,full_name,nationality,id_number,organization_id,project_id,ccy)
VALUES (:'C4','crew','Other Person','Egypt','A7654321',:'O1',:'P1','SAR');
SELECT t.denied('ID number already on another profile', $$UPDATE people SET id_number = '1055500002' WHERE id = '19000000-0000-0000-0000-000000000004'$$);
SELECT t.eq('...and nothing changed', (SELECT id_number FROM people WHERE id = :'C4'), 'A7654321');
SELECT t.denied('a member cannot merge profiles', format($$SELECT persons_merge(%L, %L)$$, (SELECT person_id FROM people WHERE id = :'L1'), (SELECT person_id FROM people WHERE id = :'L3')));
-- tenant isolation
SELECT t.as_user(:'B');
SELECT t.eq('other organization sees no profile of org 1', (SELECT count(*) FROM persons WHERE organization_id = :'O1'), 0::bigint);
SELECT t.denied('cannot attach a contract to another organization''s person',
  format($$INSERT INTO people(kind,full_name,organization_id,project_id,ccy,person_id) VALUES ('crew','x','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','SAR',%L)$$, :'pk'));
SELECT t.denied('cannot edit another organization''s person', format($$UPDATE persons SET full_name = 'hack' WHERE id = %L$$, :'pk'));
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('org 1 profile untouched', (SELECT full_name FROM persons WHERE id = :'pk'), 'Khalid Omar Alharbi');

-- ── merge (owner) ─────────────────────────────────────────────────────
SELECT person_id AS keep FROM people WHERE id = :'L1' \gset
SELECT person_id AS dropp FROM people WHERE id = :'L3' \gset
SELECT t.eq('merge moves 1 contract', persons_merge(:'keep', :'dropp'), 1);
SELECT t.eq('merged contract on the kept profile', (SELECT person_id FROM people WHERE id = :'L3'), :'keep'::uuid);
SELECT t.eq('merged contract takes the kept identity', (SELECT full_name || '|' || id_number FROM people WHERE id = :'L3'), 'Mohammed Abdullah Alajmi|1055500001');
SELECT t.eq('dropped profile removed', (SELECT count(*) FROM persons WHERE id = :'dropp'), 0::bigint);
SELECT t.eq('one person, three contracts', (SELECT count(*) FROM people WHERE person_id = :'keep'), 3::bigint);
SELECT t.denied('profiles with different ID numbers are not merged', format($$SELECT persons_merge(%L, %L)$$, :'keep', (SELECT person_id FROM people WHERE id = :'L4')));

-- ── E05: vendor profile → invoice ─────────────────────────────────────
INSERT INTO vendors(id,name,organization_id,project_id,cr_no,vat_no,company_nationality,bank_country,bank_name,tax_residency,related_party,related_party_note)
VALUES (:'V1','Gulf Lights LLC',:'O1',:'P1','1010101010','300000000000003','United Arab Emirates','United Arab Emirates','Emirates NBD','non_resident',true,'Owned by the producer''s brother'),
       (:'V2','Other Org Vendor',:'O2',:'P2','9','9','Saudi Arabia','Saudi Arabia','SNB','resident',false,null);
SELECT t.as_user(:'A');
INSERT INTO invoices(id,description,vendor_name,price,organization_id,project_id,budget_code,date)
VALUES ('19000000-0000-0000-0000-000000000031','Lighting package','gulf lights llc ',10000,:'O1',:'P1','1403','2026-10-10');
SELECT t.eq('invoice linked to the vendor by name', (SELECT vendor_id FROM invoices WHERE id = '19000000-0000-0000-0000-000000000031'), :'V1'::uuid);
SELECT t.eq('invoice inherits CR / VAT / country / residency / bank',
  (SELECT concat_ws('|', vendor_cr_no, vendor_vat_no, vendor_country, vendor_tax_residency, vendor_bank_country, vendor_bank_name) FROM invoices WHERE id = '19000000-0000-0000-0000-000000000031'),
  '1010101010|300000000000003|United Arab Emirates|non_resident|United Arab Emirates|Emirates NBD');
SELECT t.eq('invoice inherits the related-party flag and note', (SELECT is_related_party::text || '|' || related_party_note FROM invoices WHERE id = '19000000-0000-0000-0000-000000000031'), 'true|Owned by the producer''s brother');
SELECT t.denied('vendor of another organization refused',
  $$INSERT INTO invoices(description,vendor_id,price,organization_id,project_id) VALUES ('x','19000000-0000-0000-0000-000000000022',1,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')$$);
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE vendors SET vat_no = '300000000000099' WHERE id = :'V1';
SELECT t.eq('later vendor edit does not rewrite the invoice', (SELECT vendor_vat_no FROM invoices WHERE id = '19000000-0000-0000-0000-000000000031'), '300000000000003');
SELECT t.denied('vendor tax_residency checked', $$UPDATE vendors SET tax_residency = 'x' WHERE id = '19000000-0000-0000-0000-000000000021'$$);

-- ── D03: dated rates with a source ────────────────────────────────────
SELECT t.as_user('00000000-0000-0000-0000-00000000000c');
SELECT t.denied('a member without Funding edit cannot add a rate',
  $$INSERT INTO project_currency_rates(project_id,organization_id,currency,rate_date,rate,source) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','EUR','2026-10-01',4.1,'sama')$$);
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
-- user A's role has Funding edit (db/tests/110)
SELECT t.as_user(:'A');
-- organization is taken from the project, whatever the client sends
INSERT INTO project_currency_rates(project_id,organization_id,currency,rate_date,rate,source,source_ref)
VALUES (:'P1',:'O1','eur','2026-10-01',4.1,'sama','SAMA daily rates 2026-10-01'),
       (:'P1',:'O1','EUR','2026-10-15',4.2,'bank','Bank advice 778'),
       (:'P1',:'O1','USD','2026-10-01',3.75,'sama',null);
SELECT t.eq('rate on a date = latest on or before it', (SELECT rate || '|' || source || '|' || rate_date FROM project_rate_on(:'P1','EUR','2026-10-10')), '4.100000|sama|2026-10-01');
SELECT t.eq('later rate from its date', (SELECT rate || '|' || source FROM project_rate_on(:'P1','eur','2026-10-20')), '4.200000|bank');
SELECT t.eq('no rate before the first entry', (SELECT count(*) FROM project_rate_on(:'P1','EUR','2026-09-01')), 0::bigint);
SELECT t.denied('one rate per currency and day', $$INSERT INTO project_currency_rates(project_id,organization_id,currency,rate_date,rate) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','EUR','2026-10-01',4.3)$$);
SELECT t.denied('rate must be positive', $$INSERT INTO project_currency_rates(project_id,organization_id,currency,rate_date,rate) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','EUR','2026-10-02',0)$$);
SELECT t.denied('base currency is not a foreign rate', $$INSERT INTO project_currency_rates(project_id,organization_id,currency,rate_date,rate) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','SAR','2026-10-02',1)$$);
-- a USD and a EUR expense, stored in SAR with the rate source and date
INSERT INTO invoices(id,description,vendor_name,price,amount_original,currency,fx_rate,fx_rate_source,fx_rate_date,organization_id,project_id,budget_code,date) VALUES
 ('19000000-0000-0000-0000-000000000041','USD expense','Cash',round(1000*3.75,2),1000,'USD',3.75,'sama','2026-10-01',:'O1',:'P1','1403','2026-10-05'),
 ('19000000-0000-0000-0000-000000000042','EUR expense','Cash',round(1000*4.1,2),1000,'EUR',4.1,'sama','2026-10-01',:'O1',:'P1','1403','2026-10-10');
SELECT t.eq('SAR total of the two expenses', (SELECT sum(price) FROM invoices WHERE id IN ('19000000-0000-0000-0000-000000000041','19000000-0000-0000-0000-000000000042')), 7850.00);
SELECT t.eq('rate source and date kept on the invoice', (SELECT fx_rate_source || '|' || fx_rate_date FROM invoices WHERE id = '19000000-0000-0000-0000-000000000042'), 'sama|2026-10-01');
SELECT t.denied('unknown rate source refused', $$UPDATE invoices SET fx_rate_source = 'guess' WHERE id = '19000000-0000-0000-0000-000000000042'$$);
SELECT t.as_user(:'B');
SELECT t.eq('other organization sees no project rates', (SELECT count(*) FROM project_currency_rates WHERE project_id = :'P1'), 0::bigint);
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('organization stamped from the project', (SELECT count(*) FROM project_currency_rates WHERE project_id = :'P1' AND organization_id = :'O1'), 3::bigint);

-- ── E13 / D01: budget import checks ───────────────────────────────────
SELECT t.as_user(:'A');
CREATE TEMP TABLE iv AS SELECT * FROM import_budget_validate(:'P1', $$[
  {"row":2,"header_code":"1100","main_code":"1101","description":"Head  Writer ","amount":1,"rate":30000,"x":1,"unit":"Package","currency":"USD"},
  {"row":3,"header_code":"1100","main_code":"1101","description":" head writer","amount":1,"rate":30000,"x":1,"unit":"Package","currency":"USD"},
  {"row":4,"header_code":"5111","main_code":"5105","description":"مونتاج الحلقات","amount":1,"rate":15000.07,"x":1,"unit":"Flat","currency":"SAR"},
  {"row":5,"header_code":"5000-5400","main_code":"6101","description":"Outside range","amount":1,"rate":10,"x":1,"unit":"Flat","currency":"SAR"},
  {"row":6,"header_code":"1400","main_code":"1403","description":"ممثل مساعد","amount":1,"rate":1000,"x":10,"unit":"Day","currency":"SAR"}
]$$::jsonb);
GRANT ALL ON iv TO PUBLIC;
SELECT t.eq('spaces inside the description collapsed', (SELECT description FROM iv WHERE row_no = 2), 'Head Writer');
SELECT t.eq('duplicate found despite extra spaces', (SELECT duplicate_of FROM iv WHERE row_no = 3), 2);
SELECT t.eq('Header > Main swapped', (SELECT header_code || '/' || main_code FROM iv WHERE row_no = 4), '5105/5111');
SELECT t.eq('...with a warning, not an error', (SELECT status FROM iv WHERE row_no = 4), 'warning');
SELECT t.eq('swap explained', (SELECT bool_or(m LIKE '%swapped%') FROM iv, unnest(messages) m WHERE row_no = 4), true);
SELECT t.eq('main outside the header range warned', (SELECT bool_or(m LIKE '%outside header range%') FROM iv, unnest(messages) m WHERE row_no = 5), true);
SELECT t.eq('Arabic description kept as is', (SELECT description FROM iv WHERE row_no = 6), 'ممثل مساعد');
SELECT t.eq('Arabic row imports cleanly', (SELECT status FROM iv WHERE row_no = 6), 'ok');
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
