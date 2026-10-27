\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set D '00000000-0000-0000-0000-00000000000d'
\set E '00000000-0000-0000-0000-00000000000e'
\set P1 '20000000-0000-0000-0000-000000000001'
\set O1 '10000000-0000-0000-0000-000000000001'
SELECT id AS gl_script FROM gl_accounts WHERE code='GL-1000' \gset
SELECT id AS gl_cast   FROM gl_accounts WHERE code='GL-1300' \gset
SELECT id AS gl_dir    FROM gl_accounts WHERE code='GL-1200' \gset
-- 182 seeds platform default rows (organization_id NULL) into the map; this
-- file checks the behaviour from an EMPTY map, so it starts without them.
DELETE FROM budget_code_gl_map WHERE organization_id IS NULL;
SELECT t.as_user(:'A');
-- before any mapping: everything is Uncategorized (today's behaviour)
SELECT t.eq('unmapped: one Uncategorized row', (SELECT count(*) FROM get_cost_by_gl_account(:'P1')), 1::bigint);
SELECT t.eq('unmapped: payroll counted as ACTUAL, not committed', (SELECT actual FROM get_cost_by_gl_account(:'P1') WHERE gl_account_id IS NULL), 250039.47);
SELECT t.eq('unmapped: committed = PO only', (SELECT committed FROM get_cost_by_gl_account(:'P1')), 3000.00);
SELECT t.eq('paid read from the payments ledger', (SELECT paid FROM get_cost_by_gl_account(:'P1')), 3900.00);
SELECT t.denied('plain member cannot write the mapping', format($$INSERT INTO budget_code_gl_map(organization_id, budget_code_prefix, gl_account_id) VALUES ('10000000-0000-0000-0000-000000000001','11',%L)$$, :'gl_script'));
-- platform default by super admin, org override by org admin
SELECT t.as_user(:'E');
INSERT INTO budget_code_gl_map(organization_id, budget_code_prefix, gl_account_id) VALUES (NULL, '11', :'gl_dir'), (NULL, '14', :'gl_cast');
SELECT t.as_user(:'D');
INSERT INTO budget_code_gl_map(organization_id, budget_code_prefix, gl_account_id) VALUES (:'O1', '1101', :'gl_script');
SELECT t.denied('org admin cannot write a platform default', format($$INSERT INTO budget_code_gl_map(organization_id, budget_code_prefix, gl_account_id) VALUES (NULL,'70',%L)$$, :'gl_script'));
SELECT t.denied('org admin cannot write for another org', format($$INSERT INTO budget_code_gl_map(organization_id, budget_code_prefix, gl_account_id) VALUES ('10000000-0000-0000-0000-000000000002','70',%L)$$, :'gl_script'));
SELECT t.denied('duplicate prefix for the same org refused', format($$INSERT INTO budget_code_gl_map(organization_id, budget_code_prefix, gl_account_id) VALUES ('10000000-0000-0000-0000-000000000001','1101',%L)$$, :'gl_cast'));
SELECT t.as_user(:'A');
SELECT t.eq('org rule beats platform default', public.resolve_gl_account(:'O1','1101'), :'gl_script'::uuid);
SELECT t.eq('platform default used when the org has no rule', public.resolve_gl_account(:'O1','1403'), :'gl_cast'::uuid);
SELECT t.eq('unmapped code -> NULL', public.resolve_gl_account(:'O1','7003'), NULL::uuid);
CREATE TEMP TABLE g AS SELECT * FROM get_cost_by_gl_account(:'P1');
GRANT ALL ON g TO PUBLIC;
SELECT t.eq('payroll on 1101 now under Story & Script', (SELECT actual FROM g WHERE gl_code='GL-1000'), 243039.47);
SELECT t.eq('1403 spend under Principal Cast', (SELECT actual::text||'/'||committed::text FROM g WHERE gl_code='GL-1300'), '5800.00/3000.00');
SELECT t.eq('payments follow their source row''s account', (SELECT paid FROM g WHERE gl_code='GL-1000'), 2000.00);
SELECT t.eq('only the unmapped invoice stays Uncategorized', (SELECT actual FROM g WHERE gl_account_id IS NULL), 1200.00);
SELECT t.eq('totals unchanged by mapping: actual', (SELECT sum(actual) FROM g), 250039.47);
SELECT t.eq('totals unchanged by mapping: paid = payments ledger', (SELECT sum(paid) FROM g), 3900.00);
SELECT t.eq('rows resolved through the mapping are counted', (SELECT sum(mapped_by_code) FROM g), 5::bigint);
SELECT t.eq('period filter on entry date', (SELECT COALESCE(sum(actual),0) FROM get_cost_by_gl_account(:'P1','2026-09-01','2026-09-30') WHERE gl_code='GL-1300'), 5800.00);
-- a row's own gl_account_id wins over the mapping
RESET ROLE; SET session_replication_role = replica;
UPDATE invoices SET gl_account_id = :'gl_dir' WHERE id='60000000-0000-0000-0000-000000000001';
SET session_replication_role = origin;
SELECT t.as_user(:'A');
SELECT t.eq('explicit account on the row wins', (SELECT actual FROM get_cost_by_gl_account(:'P1') WHERE gl_code='GL-1200'), 5000.00);
SELECT t.as_user(:'B');
SELECT t.denied('tenant B refused', $$SELECT * FROM get_cost_by_gl_account('20000000-0000-0000-0000-000000000001')$$);
SELECT t.eq('tenant B sees platform defaults only', (SELECT count(*) FROM budget_code_gl_map), 2::bigint);
SELECT t.eq('tenant B does not inherit org1''s rule', public.resolve_gl_account('10000000-0000-0000-0000-000000000002','1101'), :'gl_dir'::uuid);
RESET ROLE;
SET session_replication_role = replica;
UPDATE invoices SET gl_account_id = NULL WHERE id='60000000-0000-0000-0000-000000000001';
SET session_replication_role = origin;
-- 174 adds balance-sheet accounts (category 'Balance Sheet'); 070 itself adds none
SELECT t.eq('gl_accounts catalogue untouched', (SELECT count(*) FROM gl_accounts WHERE category <> 'Balance Sheet'), 26::bigint);
