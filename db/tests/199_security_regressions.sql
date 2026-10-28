-- 199 — regressions for the security review of db/pending 171–198.
-- Every HIGH finding is replayed as a normal signed-in user and must now be
-- refused (or give nothing away); the legitimate flow next to it must still
-- work. Runs in one transaction and rolls back.
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-00000000000d'
\set O1 '10000000-0000-0000-0000-000000000001'
\set O2 '10000000-0000-0000-0000-000000000002'
\set P1 '20000000-0000-0000-0000-000000000001'
\set P2 '20000000-0000-0000-0000-000000000002'
\set P9 'e1990000-0000-0000-0000-000000000009'
\set RA 'e1990000-0000-0000-0000-000000000101'
\set RB 'e1990000-0000-0000-0000-000000000102'
\set RA3 'e1990000-0000-0000-0000-000000000103'
\set RA2 'e1990000-0000-0000-0000-000000000104'
\set RB2 'e1990000-0000-0000-0000-000000000105'
\set PEA 'e1990000-0000-0000-0000-000000000201'
\set PEB 'e1990000-0000-0000-0000-000000000202'
\set X9 'e1990000-0000-0000-0000-000000000301'
\set XA 'e1990000-0000-0000-0000-000000000302'
\set XA9 'e1990000-0000-0000-0000-000000000303'
\set XS 'e1990000-0000-0000-0000-000000000304'
\set IV1 'e1990000-0000-0000-0000-000000000401'
\set IV2 'e1990000-0000-0000-0000-000000000402'
\set R1 'e1990000-0000-0000-0000-000000000501'
\set R2 'e1990000-0000-0000-0000-000000000502'
\set R3 'e1990000-0000-0000-0000-000000000503'
\set R4 'e1990000-0000-0000-0000-000000000504'
\set RX 'e1990000-0000-0000-0000-000000000505'
BEGIN;
-- ------------------------------------------------------------------ fixtures
-- (as the database owner, no signed-in user: app triggers run, user guards skip)
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status) VALUES
 (:'P9',:'D','Org1 other project','SEC9',:'O1','SAR',1,'Production');
INSERT INTO payroll(id,ref_id,name,kind,total_amount,budget_code,organization_id,project_id,payment_schedule) VALUES
 (:'RA','SEC-A','Own crew','crew',3000,'1101',:'O1',:'P1','[{"id":"m1","label":"Signing","dueDate":"2026-10-01","percent":0,"amount":1000,"status":"Pending"},{"id":"m2","label":"Wrap","dueDate":"2026-11-01","percent":0,"amount":2000,"status":"Pending"}]'),
 (:'RA3','SEC-A3','Own crew 3','crew',500,'1101',:'O1',:'P1','[{"id":"m1","label":"Once","dueDate":"2026-10-01","percent":0,"amount":500,"status":"Pending"}]'),
 (:'RB','SEC-B','Victim crew','crew',5000,'1101',:'O2',:'P2','[{"id":"run","label":"Run","dueDate":"2026-10-01","percent":0,"amount":5000,"status":"Pending"}]');
-- contracts with bank details (own project / other tenant)
INSERT INTO people(id,kind,full_name,organization_id,project_id,iban,bank,bank_country) VALUES
 (:'PEA','crew','Own Payee',:'O1',:'P1','SA0000OWNIBAN','Own Bank','Saudi Arabia'),
 (:'PEB','crew','Victim Payee',:'O2',:'P2','DE0000VICTIMIBAN','Victim Bank','Germany');
INSERT INTO payroll(id,ref_id,name,kind,total_amount,budget_code,organization_id,project_id) VALUES
 (:'RA2',:'PEA','Own Payee','crew',100,'1101',:'O1',:'P1'),
 (:'RB2',:'PEB','Victim Payee','crew',100,'1101',:'O2',:'P2');
-- person profiles: one only in P9 (A is not a member), one in P1 + P9, one only in P1
INSERT INTO people(id,kind,full_name,id_number,phone_number,organization_id,project_id,iban,bank) VALUES
 (:'X9','crew','Hidden Person','1099900009','+966511111111',:'O1',:'P9','SA0000HIDDEN','Hidden Bank'),
 (:'XA','crew','Shared Person','1099900010',NULL,:'O1',:'P1',NULL,NULL),
 (:'XA9','crew','Shared Person','1099900010',NULL,:'O1',:'P9',NULL,NULL),
 (:'XS','crew','Solo Person','1099900011',NULL,:'O1',:'P1',NULL,NULL);
-- vendors and invoices (own / other tenant)
INSERT INTO vendors(name,organization_id,project_id,bank_name,bank_country,iban) VALUES
 ('Own Vendor',:'O1',:'P1','Own Vendor Bank','Saudi Arabia','SA0000OWNVENDOR'),
 ('Secret Vendor',:'O2',:'P2','Secret Bank','France','FR0000SECRET');
INSERT INTO invoices(id,description,budget_code,price,vat_amount,date,vendor_name,organization_id,project_id) VALUES
 (:'IV1','Own invoice','1403',1000,0,'2026-10-01','Own Vendor',:'O1',:'P1'),
 (:'IV2','Victim invoice','1403',1000,0,'2026-10-01','Secret Vendor',:'O2',:'P2');
UPDATE invoices SET approval_status = 'approved' WHERE approval_status = 'pending' AND created_by IS NULL;  -- 201: fixture invoices approved (a recorded invoice is only a Commitment)

-- ============================================================ HIGH #1
-- a member inserts a request that is already approved / paid, with forged stamps
SELECT t.as_user(:'A');
SELECT t.denied('#1 a request cannot be inserted already paid', format($$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,payroll_milestone_id,total_amount,requested_amount,currency,status,requested_by,approved_by,approved_at,executed_by,executed_at)
  VALUES (%L,%L,'payroll_row',%L,'m1',3000,1000,'SAR','paid',%L,%L,now(),%L,now())$$, :'O1', :'P1', :'RA', :'A', :'D', :'D'));
SELECT t.denied('#1 a request cannot be inserted already approved', format($$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,payroll_milestone_id,total_amount,requested_amount,currency,status,requested_by,approved_by,approved_at)
  VALUES (%L,%L,'payroll_row',%L,'m1',3000,1000,'SAR','approved',%L,%L,now())$$, :'O1', :'P1', :'RA', :'A', :'D'));
SELECT t.eq('#1 the instalment was not touched', (SELECT payment_schedule->0->>'status' FROM payroll WHERE id = :'RA'), 'Pending');
SELECT t.eq('#1 no payment was created', (SELECT count(*) FROM payments WHERE source_id = :'RA'), 0::bigint);
-- legitimate: waiting request; forged stamps are dropped
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,payroll_milestone_id,total_amount,requested_amount,currency,status,requested_by,submitted_at,approved_by,approved_at,executed_by)
VALUES (:'R1',:'O1',:'P1','payroll_row',:'RA','Own crew · Signing','m1',3000,1000,'SAR','waiting_approval',:'A',now(),:'D',now(),:'D');
SELECT t.eq('#1 legit: request waits, forged stamps cleared', (SELECT status||'|'||(approved_by IS NULL AND approved_at IS NULL AND executed_by IS NULL)::text FROM payment_requests WHERE id = :'R1'), 'waiting_approval|true');
SELECT t.eq('#1 legit: instalment shows Requested', (SELECT payment_schedule->0->>'status' FROM payroll WHERE id = :'RA'), 'Hold');
SELECT t.as_user(:'D');
SELECT t.eq('#1 legit: the admin approves', (public.approve_payment_request_step(:'R1')->>'status'), 'approved');
SELECT t.eq('#1 legit: instalment Approved', (SELECT payment_schedule->0->>'status' FROM payroll WHERE id = :'RA'), 'Approved');

-- ============================================================ HIGH #2
-- what a request pays cannot be re-pointed (at another tenant's contract)
SELECT t.as_user(:'A');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,payroll_milestone_id,total_amount,requested_amount,currency,status,requested_by,submitted_at)
VALUES (:'R2',:'O1',:'P1','payroll_row',:'RA','Own crew · Wrap','m2',3000,2000,'SAR','waiting_approval',:'A',now());
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,payroll_milestone_id,total_amount,requested_amount,currency,status,requested_by)
VALUES (:'R3',:'O1',:'P1','payroll_row',:'RA3','Own crew 3','m1',500,500,'SAR','draft',:'A');
SELECT t.denied('#2 requester cannot re-point a draft at another tenant''s contract', format($$UPDATE payment_requests SET source_id = %L WHERE id = %L$$, :'RB', :'R3'));
UPDATE payment_requests SET notes = 'edited draft' WHERE id = :'R3';
SELECT t.eq('#2 legit: requester still edits the draft', (SELECT notes FROM payment_requests WHERE id = :'R3'), 'edited draft');
SELECT t.as_user(:'D');
SELECT t.denied('#2 admin cannot re-point a waiting request', format($$UPDATE payment_requests SET source_id = %L WHERE id = %L$$, :'RB', :'R2'));
SELECT t.denied('#2 admin cannot move a request to another organization', format($$UPDATE payment_requests SET organization_id = %L WHERE id = %L$$, :'O2', :'R2'));
SELECT t.denied('#2 the amount of a submitted request is frozen', format($$UPDATE payment_requests SET requested_amount = 1999 WHERE id = %L$$, :'R2'));
SELECT t.eq('#2 legit: admin approves the request as raised', (public.approve_payment_request_step(:'R2')->>'status'), 'approved');
SELECT t.eq('#2 legit: own instalment Approved', (SELECT payment_schedule->1->>'status' FROM payroll WHERE id = :'RA'), 'Approved');
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('#2 the other tenant''s instalment is untouched', (SELECT payment_schedule->0->>'status' FROM payroll WHERE id = :'RB'), 'Pending');
SELECT t.eq('#2 no payment on the other tenant''s contract', (SELECT count(*) FROM payments WHERE source_id = :'RB'), 0::bigint);

-- ============================================================ HIGH #3
-- a request carrying another organization's id (project of mine) is refused,
-- so that organization's admins are never notified / asked to approve it
SELECT count(*) AS b_notes FROM notifications WHERE user_id = :'B' \gset
SELECT t.as_user(:'A');
SELECT t.denied('#3 request with another organization''s id is refused', format($$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,requested_by)
  VALUES (%L,%L,'invoice',%L,'Pay me',1000,900,'SAR','waiting_approval',%L)$$, :'O2', :'P1', :'IV1', :'A'));
-- (a source type without a document table, so only the policy / 200 can stop it)
SELECT t.denied('#3 ... also when the document is not checked (vendor_contract)', format($$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,requested_by)
  VALUES (%L,%L,'vendor_contract',gen_random_uuid(),'Pay me',1000,900,'SAR','waiting_approval',%L)$$, :'O2', :'P1', :'A'));
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('#3 no notification reached the other organization', (SELECT count(*) FROM notifications WHERE user_id = :'B'), :'b_notes'::bigint);
SELECT t.as_user(:'A');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,requested_by,submitted_at)
VALUES (:'R4',:'O1',:'P1','invoice',:'IV1','Own invoice',1000,1000,'SAR','waiting_approval',:'A',now());
SELECT t.eq('#3 legit: request in my own organization is accepted', (SELECT count(*) FROM payment_requests WHERE id = :'R4'), 1::bigint);
SELECT t.as_user(:'D');
SELECT t.eq('#3 legit: my admin was notified', (SELECT count(*) > 0 FROM notifications WHERE user_id = :'D' AND metadata->>'payment_request_id' = :'R4'), true);

-- ============================================================ HIGH #4
-- person profiles (ID number, IBAN, phone) follow the project scope of contracts
SELECT person_id AS x9p FROM people WHERE id = :'X9' \gset
SELECT person_id AS xap FROM people WHERE id = :'XA' \gset
SELECT person_id AS xsp FROM people WHERE id = :'XS' \gset
SELECT t.as_user(:'A');
SELECT t.eq('#4 a member cannot read a profile whose contracts are all in other projects', (SELECT count(*) FROM persons WHERE id = :'x9p'), 0::bigint);
SELECT t.denied('#4 ... nor edit it', format($$UPDATE persons SET full_name = 'hack', iban = 'XX' WHERE id = %L$$, :'x9p'));
SELECT t.denied('#4 ... nor attach a new contract to it by id', format($$INSERT INTO people(kind,full_name,person_id,organization_id,project_id) VALUES ('crew','Probe',%L,%L,%L)$$, :'x9p', :'O1', :'P1'));
INSERT INTO people(id,kind,full_name,id_number,organization_id,project_id) VALUES
 ('e1990000-0000-0000-0000-000000000399','crew','Probe','1099900009',:'O1',:'P1');
SELECT t.eq('#4 typing the ID number of a hidden profile links nothing and copies no bank / phone',
  (SELECT (person_id IS NULL)::text||'|'||COALESCE(iban,'-')||'|'||COALESCE(phone_number,'-')||'|'||full_name FROM people WHERE id = 'e1990000-0000-0000-0000-000000000399'), 'true|-|-|Probe');
SELECT t.denied('#4 renaming a person who also has contracts in a project I cannot open', format($$UPDATE people SET full_name = 'Renamed by A' WHERE id = %L$$, :'XA'));
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('#4 the contract in the other project is untouched', (SELECT full_name FROM people WHERE id = :'XA9'), 'Shared Person');
SELECT t.eq('#4 the hidden profile is untouched', (SELECT full_name||'|'||iban FROM persons WHERE id = :'x9p'), 'Hidden Person|SA0000HIDDEN');
SELECT t.as_user(:'A');
SELECT t.eq('#4 legit: a member reads the profile of a person of their project', (SELECT count(*) FROM persons WHERE id = :'xsp'), 1::bigint);
UPDATE people SET phone_number = '+966522222222' WHERE id = :'XS';
SELECT t.eq('#4 legit: editing a contract still updates its profile', (SELECT phone_number FROM persons WHERE id = :'xsp'), '+966522222222');
SELECT t.as_user(:'D');
SELECT t.eq('#4 legit: an org admin reads every profile of the organization', (SELECT count(*) FROM persons WHERE id IN (:'x9p', :'xap')), 2::bigint);
UPDATE people SET full_name = 'Shared Person Renamed' WHERE id = :'XA';
SELECT t.eq('#4 legit: an org admin renames the person everywhere', (SELECT full_name FROM people WHERE id = :'XA9'), 'Shared Person Renamed');

-- ============================================================ HIGH #5
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.payroll_legacy_paid('50000000-0000-0000-0000-000000000001', '[]', '[]', 0) AS paid_all \gset
SELECT t.eq('#5 (fixture) the contract has payments', :'paid_all'::numeric > 0, true);
SELECT t.as_user(:'B');
SELECT t.eq('#5 another tenant gets nothing from payroll_legacy_paid', public.payroll_legacy_paid('50000000-0000-0000-0000-000000000001', '[]', '[]', 0), 0::numeric);
SELECT t.as_user(:'A');
SELECT t.eq('#5 legit: the project member gets the paid amount', public.payroll_legacy_paid('50000000-0000-0000-0000-000000000001', '[]', '[]', 0), :'paid_all'::numeric);

-- ============================================================ HIGH #6
SELECT t.as_user(:'A');
SELECT t.denied('#6 a request cannot point at another tenant''s invoice', format($$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,requested_by)
  VALUES (%L,%L,'invoice',%L,'x',1000,1000,'SAR','waiting_approval',%L)$$, :'O1', :'P1', :'IV2', :'A'));
-- a request of tenant A that already points at B's invoice (made before this
-- fix) is paid: B's hand payment is neither adopted nor rewritten
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO payments(id,organization_id,project_id,source_type,source_id,amount,payment_date,notes)
VALUES ('e1990000-0000-0000-0000-000000000601',:'O2',:'P2','invoice',:'IV2',1000,'2026-10-02','B paid by hand');
SET session_replication_role = replica;
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,requested_by,payment_date)
VALUES (:'RX',:'O1',:'P1','invoice',:'IV2','legacy cross-tenant',1000,1000,'SAR','paid',:'A','2026-10-03');
SET session_replication_role = origin;
SELECT public.apply_request_payment(r) IS NOT NULL AS applied FROM payment_requests r WHERE r.id = :'RX' \gset
SELECT t.eq('#6 B''s hand payment is not adopted by A''s request', (SELECT payment_request_id IS NULL AND notes = 'B paid by hand' FROM payments WHERE id = 'e1990000-0000-0000-0000-000000000601'), true);
SELECT t.eq('#6 A''s request payment stays in A''s project', (SELECT project_id FROM payments WHERE payment_request_id = :'RX'), :'P1'::uuid);
SELECT t.as_user(:'B');
INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date,notes)
VALUES (:'O2',:'P2','invoice',:'IV2',1000,'2026-10-04','B second hand payment');
SELECT t.eq('#6 B is not blocked (and shown A''s reference) by A''s request payment', (SELECT count(*) FROM payments WHERE source_id = :'IV2' AND notes = 'B second hand payment'), 1::bigint);
-- legitimate: own invoice request approved and paid -> one payment, a hand duplicate is refused
SELECT t.as_user(:'D');
SELECT public.approve_payment_request_step(:'R4') ->> 'status' AS r4 \gset
UPDATE payment_requests SET status = 'paid', payment_date = '2026-10-05', payment_method = 'Transfer' WHERE id = :'R4';
SELECT t.eq('#6 legit: paid request wrote its payment', (SELECT count(*) FROM payments WHERE payment_request_id = :'R4' AND project_id = :'P1'), 1::bigint);
SELECT t.as_user(:'A');
SELECT t.denied('#6 legit: a hand payment repeating it is still refused', format($$INSERT INTO payments(organization_id,project_id,source_type,source_id,amount,payment_date) VALUES (%L,%L,'invoice',%L,1000,'2026-10-06')$$, :'O1', :'P1', :'IV1'));

-- ============================================================ HIGH #7 / #8
-- a payment in my project that names another tenant's contract / invoice
-- must not copy that tenant's IBAN, bank name or bank country
SELECT t.as_user(:'A');
INSERT INTO payments(id,organization_id,project_id,source_type,source_id,amount,payment_date,notes) VALUES
 ('e1990000-0000-0000-0000-000000000701',:'O1',:'P1','payroll',:'RB2',10,'2026-10-07','probe payroll'),
 ('e1990000-0000-0000-0000-000000000703',:'O1',:'P1','payroll',:'RA2',10,'2026-10-07','own payroll'),
 ('e1990000-0000-0000-0000-000000000704',:'O1',:'P1','invoice',:'IV1',10,'2026-10-07','own invoice');
-- 201: a payment naming another tenant's invoice is refused outright (approved invoice of this project required)
SELECT t.denied('#7/#8 (201) payment on another tenant''s invoice refused', format($$INSERT INTO payments(id,organization_id,project_id,source_type,source_id,amount,payment_date,notes) VALUES ('e1990000-0000-0000-0000-000000000702',%L,%L,'invoice',%L,10,'2026-10-07','probe invoice')$$, :'O1', :'P1', :'IV2'));
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('#7 no IBAN copied from another tenant''s contract', (SELECT payee_iban FROM payments WHERE id = 'e1990000-0000-0000-0000-000000000701'), NULL::text);
SELECT t.eq('#7 no IBAN copied from another tenant''s vendor', (SELECT payee_iban FROM payments WHERE id = 'e1990000-0000-0000-0000-000000000702'), NULL::text);
SELECT t.eq('#8 no bank name / country copied from another tenant''s contract', (SELECT COALESCE(bank_name,'-')||'|'||COALESCE(bank_country,'-') FROM payments WHERE id = 'e1990000-0000-0000-0000-000000000701'), '-|-');
SELECT t.eq('#8 no bank name / country copied from another tenant''s vendor', COALESCE((SELECT COALESCE(bank_name,'-')||'|'||COALESCE(bank_country,'-') FROM payments WHERE id = 'e1990000-0000-0000-0000-000000000702'), '-|-'), '-|-');
SELECT t.eq('#8 snapshot function: another project''s invoice gives nothing', (SELECT COALESCE(bank_name,'-') FROM public.payment_snapshot_values('invoice', :'IV2', 10, :'P1')), '-');
SELECT t.eq('#7 legit: own contract IBAN is captured', (SELECT payee_iban FROM payments WHERE id = 'e1990000-0000-0000-0000-000000000703'), 'SA0000OWNIBAN');
SELECT t.eq('#7 legit: own vendor IBAN is captured', (SELECT payee_iban FROM payments WHERE id = 'e1990000-0000-0000-0000-000000000704'), 'SA0000OWNVENDOR');
SELECT t.eq('#8 legit: own contract bank snapshot', (SELECT bank_name||'|'||bank_country FROM payments WHERE id = 'e1990000-0000-0000-0000-000000000703'), 'Own Bank|Saudi Arabia');
SELECT t.eq('#8 legit: own vendor bank snapshot', (SELECT bank_name||'|'||bank_country FROM payments WHERE id = 'e1990000-0000-0000-0000-000000000704'), 'Own Vendor Bank|Saudi Arabia');

-- ============================================================ MEDIUM / LOW
-- #9 an invoice cannot claim another organization (and so its vendors)
SELECT t.as_user(:'A');
SELECT t.denied('#9 invoice with another organization''s id is refused', format($$INSERT INTO invoices(description,budget_code,price,date,vendor_name,organization_id,project_id) VALUES ('x','1403',1,'2026-10-01','Secret Vendor',%L,%L)$$, :'O2', :'P1'));
-- #10 editing a contract that existed before 190 does not link / rewrite it
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
SET session_replication_role = replica;
INSERT INTO people(id,kind,full_name,id_number,phone_number,organization_id,project_id) VALUES
 ('e1990000-0000-0000-0000-000000000398','crew','Old Spelling','1099900011','+966500000001',:'O1',:'P1');
SET session_replication_role = origin;
SELECT t.as_user(:'A');
UPDATE people SET position = 'Grip' WHERE id = 'e1990000-0000-0000-0000-000000000398';
SELECT t.eq('#10 an old unlinked contract keeps its own identity on edit', (SELECT (person_id IS NULL)::text||'|'||full_name||'|'||phone_number FROM people WHERE id = 'e1990000-0000-0000-0000-000000000398'), 'true|Old Spelling|+966500000001');
-- #11 no chain: a plain member cannot approve by a direct UPDATE
SELECT t.as_user(:'C');
SELECT t.denied('#11 a member cannot approve without a chain', format($$UPDATE payment_requests SET status = 'approved' WHERE id = %L$$, :'R3'));
-- #12 reversing a run never touches another tenant's payroll with the same prefix
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO payroll(id,ref_id,name,kind,total_amount,budget_code,organization_id,project_id,payment_schedule) VALUES
 ('e1990000-0000-0000-0000-000000000801','PR-f1990000-abcd','Victim run line','crew',700,'1101',:'O2',:'P2','[{"id":"run","label":"Run","dueDate":"2026-10-01","percent":0,"amount":700,"status":"Pending"}]');
SET session_replication_role = replica;
INSERT INTO payroll_runs(id,organization_id,project_id,label,kind,period_start,period_end,status,currency)
VALUES ('f1990000-0000-0000-0000-000000000001',:'O1',:'P1','Attacker run','crew','2026-10-01','2026-10-31','posted','SAR');
SET session_replication_role = origin;
SELECT t.as_user(:'D');
SELECT public.reverse_payroll_run('f1990000-0000-0000-0000-000000000001', 'test') IS NOT NULL AS rev \gset
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('#12 the other tenant''s payroll row is untouched', (SELECT jsonb_array_length(payment_schedule)||'|'||(contract_cancelled_at IS NULL)::text FROM payroll WHERE id = 'e1990000-0000-0000-0000-000000000801'), '1|true');
-- #13 a 21-32 character budget code can be saved (QPE suggestion widened)
SELECT t.as_user(:'A');
INSERT INTO budget_lines(project_id,organization_id,version_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency)
VALUES (:'P1',:'O1','40000000-0000-0000-0000-000000000001','1100','1101-LONG-CODE-ABCDEFGHIJKLMN','1100','long code',1,1,1,'Package','SAR');
SELECT t.eq('#13 long budget code accepted and mapped', (SELECT count(*) FROM budget_code_qpe_map WHERE project_id = :'P1' AND budget_code = '1101-LONG-CODE-ABCDEFGHIJKLMN'), 1::bigint);
-- #15 an organization whose stored logo is not a URL can still save its settings
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
ALTER TABLE organizations DISABLE TRIGGER trg_org_logo_url_safe;
UPDATE organizations SET logo_url = 'legacy-logo.png' WHERE id = :'O1';
ALTER TABLE organizations ENABLE TRIGGER trg_org_logo_url_safe;
SELECT t.as_user(:'D');
UPDATE organizations SET date_format = 'yyyy-MM-dd' WHERE id = :'O1';
SELECT t.eq('#15 other settings save despite an old logo value', (SELECT date_format FROM organizations WHERE id = :'O1'), 'yyyy-MM-dd');
SELECT t.denied('#15 a new unsafe logo is still refused', format($$UPDATE organizations SET logo_url = 'javascript:alert(1)' WHERE id = %L$$, :'O1'));
-- #16 the attachments archive is a function, not a view on storage.objects
RESET ROLE;
SELECT t.eq('#16 no view depends on storage.objects', (SELECT count(*) FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid JOIN pg_class v ON v.oid = rw.ev_class
  WHERE d.refobjid = 'storage.objects'::regclass AND v.relnamespace = 'public'::regnamespace), 0::bigint);
-- #17 a supporting-document link takes its project from the document
SELECT t.as_user(:'A');
SELECT t.denied('#17 cannot claim the link slot of another tenant''s invoice', format($$INSERT INTO supporting_document_links(organization_id,project_id,source_kind,source_id,url) VALUES (%L,%L,'invoice',%L,'https://evil.example.com')$$, :'O1', :'P1', :'IV2'));
INSERT INTO supporting_document_links(organization_id,project_id,source_kind,source_id,url) VALUES (:'O2',:'P1','invoice',:'IV1','https://drive.example.com/own.pdf');
SELECT t.eq('#17 legit: link stamped with the document''s org / project', (SELECT organization_id::text||'|'||project_id::text FROM supporting_document_links WHERE source_id = :'IV1'), :'O1'||'|'||:'P1');
-- #19 FX helpers read the rate through RLS
SELECT t.as_user(:'B');
SELECT t.eq('#19 another tenant does not get P1''s rate', public.payment_request_amount_sar(100, 'USD', :'P1'), 100::numeric);
SELECT t.as_user(:'A');
SELECT t.eq('#19 legit: member converts with the project rate', public.payment_request_amount_sar(100, 'USD', :'P1'), 375.00);
-- #20 validation does not reveal another tenant's contract
SELECT t.as_user(:'A');
SELECT t.eq('#20 error does not mention the foreign instalment', (SELECT t.denied('x', format($$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,payroll_milestone_id,total_amount,requested_amount,currency,status,requested_by) VALUES (%L,%L,'payroll_row',%L,'m2',5000,1,'SAR','waiting_approval',%L)$$, :'O1', :'P1', :'RB', :'A')) LIKE '%not found in this project%'), true);
-- #21 qpe_source_project is internal
SELECT t.denied('#21 qpe_source_project is not callable by users', format($$SELECT public.qpe_source_project('invoice', %L)$$, :'IV2'));
-- #22 octet-stream is not an allowed upload type
RESET ROLE;
SELECT t.eq('#22 bucket limits keep no octet-stream', (SELECT count(*) FROM storage.buckets WHERE 'application/octet-stream' = ANY (allowed_mime_types)), 0::bigint);
-- #23 an org admin acts only on requests of projects they can open
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
SET session_replication_role = replica;
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,requested_by)
VALUES ('e1990000-0000-0000-0000-000000000506',:'O1',:'P9','invoice',:'IV1','P9 request',1000,10,'SAR','draft',:'C');
SET session_replication_role = origin;
DELETE FROM project_members WHERE project_id = :'P9' AND user_id = :'D';
SELECT t.as_user(:'D');
SELECT t.denied('#23 admin without access to P9 cannot delete its request', $$DELETE FROM payment_requests WHERE id = 'e1990000-0000-0000-0000-000000000506'$$);
-- #18 deleting an organization removes its ledger
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO organizations(id,name,slug,base_currency) VALUES ('e1990000-0000-0000-0000-00000000a001','Doomed Org','doomed-org','SAR');
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status) VALUES
 ('e1990000-0000-0000-0000-00000000a002',:'D','Doomed project','DOOM','e1990000-0000-0000-0000-00000000a001','SAR',1,'Production');
INSERT INTO ledger_entries(id,organization_id,project_id,entry_no,event_key,event_type,entry_date,description)
VALUES ('e1990000-0000-0000-0000-00000000a003','e1990000-0000-0000-0000-00000000a001','e1990000-0000-0000-0000-00000000a002',1,'test:1','funding','2026-10-01','test');
INSERT INTO ledger_lines(entry_id,organization_id,project_id,line_no,gl_account_id,debit,credit) VALUES
 ('e1990000-0000-0000-0000-00000000a003','e1990000-0000-0000-0000-00000000a001','e1990000-0000-0000-0000-00000000a002',1,(SELECT id FROM gl_accounts WHERE code='9100'),50,0),
 ('e1990000-0000-0000-0000-00000000a003','e1990000-0000-0000-0000-00000000a001','e1990000-0000-0000-0000-00000000a002',2,(SELECT id FROM gl_accounts WHERE code='9200'),0,50);
SELECT t.denied('#18 the ledger itself stays immutable', $$DELETE FROM ledger_lines WHERE entry_id = 'e1990000-0000-0000-0000-00000000a003'$$);
DELETE FROM organizations WHERE id = 'e1990000-0000-0000-0000-00000000a001';
SELECT t.eq('#18 organization delete removed its ledger', (SELECT count(*) FROM ledger_entries WHERE organization_id = 'e1990000-0000-0000-0000-00000000a001'), 0::bigint);
ROLLBACK;
