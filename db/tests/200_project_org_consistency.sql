-- 200 — a row's project always belongs to the row's organization.
-- Runs in one transaction and rolls back.
\set A '00000000-0000-0000-0000-00000000000a'
\set O1 '10000000-0000-0000-0000-000000000001'
\set O2 '10000000-0000-0000-0000-000000000002'
\set P1 '20000000-0000-0000-0000-000000000001'
BEGIN;
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
-- every base table with both columns carries the trigger, views none
SELECT t.eq('trigger on every table with organization_id + project_id',
  (SELECT count(*) FROM information_schema.columns c
     JOIN information_schema.columns c2 ON c2.table_schema = c.table_schema AND c2.table_name = c.table_name
                                       AND c2.column_name = 'project_id' AND c2.data_type = 'uuid'
     JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
                                      AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND c.data_type = 'uuid'
      AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = ('public.' || quote_ident(c.table_name))::regclass
                                                  AND g.tgname = 'zzz_trg_project_org_consistency')), 0::bigint);
SELECT t.eq('a few known tables are covered', (SELECT count(DISTINCT tgrelid) FROM pg_trigger WHERE tgname = 'zzz_trg_project_org_consistency'
  AND tgrelid IN ('public.payments'::regclass, 'public.people'::regclass, 'public.invoices'::regclass, 'public.payment_requests'::regclass, 'public.persons'::regclass)), 4::bigint);
SELECT t.eq('no existing mismatches in the test data', (SELECT count(*) FROM public.project_org_mismatches()), 0::bigint);

-- a project member sends another organization's id with a row of their project
SELECT t.as_user(:'A');
SELECT t.denied('payment with another organization''s id refused', format($$INSERT INTO payments(organization_id,project_id,source_type,source_id,amount) VALUES (%L,%L,'invoice',gen_random_uuid(),5)$$, :'O2', :'P1'));
SELECT t.denied('contract with another organization''s id refused', format($$INSERT INTO people(kind,full_name,organization_id,project_id) VALUES ('crew','Cross',%L,%L)$$, :'O2', :'P1'));
SELECT t.denied('vendor with another organization''s id refused', format($$INSERT INTO vendors(name,organization_id,project_id) VALUES ('Cross vendor',%L,%L)$$, :'O2', :'P1'));
SELECT t.denied('moving a row to another organization refused', format($$UPDATE invoices SET organization_id = %L WHERE id = '60000000-0000-0000-0000-000000000001'$$, :'O2'));
-- legitimate writes
INSERT INTO vendors(id,name,organization_id,project_id) VALUES ('e2000000-0000-0000-0000-000000000001','Own vendor 200',:'O1',:'P1');
SELECT t.eq('row with the right organization accepted', (SELECT count(*) FROM vendors WHERE id = 'e2000000-0000-0000-0000-000000000001'), 1::bigint);
INSERT INTO payments(id,organization_id,project_id,source_type,source_id,amount,notes) VALUES ('e2000000-0000-0000-0000-000000000002',NULL,:'P1','invoice','60000000-0000-0000-0000-000000000002',7,'org filled');
SELECT t.eq('missing organization is filled from the project', (SELECT organization_id FROM payments WHERE id = 'e2000000-0000-0000-0000-000000000002'), :'O1'::uuid);
UPDATE vendors SET bank_name = 'B' WHERE id = 'e2000000-0000-0000-0000-000000000001';
SELECT t.eq('ordinary update of a consistent row works', (SELECT bank_name FROM vendors WHERE id = 'e2000000-0000-0000-0000-000000000001'), 'B');

-- an existing mismatched row (written before 200) is listed and cannot be updated until fixed
RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
SET session_replication_role = replica;
INSERT INTO vendors(id,name,organization_id,project_id) VALUES ('e2000000-0000-0000-0000-000000000003','Legacy cross',:'O2',:'P1');
SET session_replication_role = origin;
SELECT t.eq('the check lists the legacy row', (SELECT table_name||'|'||row_key FROM public.project_org_mismatches()), 'vendors|e2000000-0000-0000-0000-000000000003');
SELECT t.denied('an update of a mismatched row is refused', $$UPDATE vendors SET bank_name = 'x' WHERE id = 'e2000000-0000-0000-0000-000000000003'$$);
UPDATE vendors SET organization_id = :'O1' WHERE id = 'e2000000-0000-0000-0000-000000000003';
SELECT t.eq('the owner fix (org = project''s org) is accepted', (SELECT count(*) FROM public.project_org_mismatches()), 0::bigint);
-- a project id that matches no project (deleted project, table without FK) is left alone
INSERT INTO audit_history(table_name, operation, record_id, organization_id, project_id)
VALUES ('test', 'INSERT', gen_random_uuid(), :'O2', 'e2000000-0000-0000-0000-0000000000ff');
SELECT t.eq('unknown project ids are not refused', (SELECT count(*) FROM audit_history WHERE project_id = 'e2000000-0000-0000-0000-0000000000ff'), 1::bigint);
SELECT t.denied('the check function is not callable by users', $$SET LOCAL role authenticated; SELECT * FROM public.project_org_mismatches()$$);
ROLLBACK;
