\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set P1 '20000000-0000-0000-0000-000000000001'
SET session_replication_role = replica;
INSERT INTO role_permissions(role_id,module_key,can_view,can_edit) VALUES ('30000000-0000-0000-0000-000000000001','budget',true,true);
INSERT INTO master_budget(budget_code,description,is_header,topsheet_code) VALUES ('1100','STORY & SCRIPT',true,'1100');
SET session_replication_role = origin;
-- a file with: 2 good rows, 1 exact duplicate, 1 unknown code (warning), and 4 bad rows
\set GOOD '[{"row":2,"header_code":"1100","main_code":"1101","description":"Head Writer","amount":1,"rate":"30,000","x":1,"unit":"Package","currency":"usd"},{"row":3,"main_code":"1403","description":"Actor A","amount":1,"rate":1000,"x":10,"unit":"Day","currency":"SAR","topsheet_code":"1400"},{"row":4,"header_code":"1100","main_code":"1101","description":"head writer","amount":1,"rate":30000,"x":1,"unit":"package","currency":"USD"},{"row":5,"main_code":"8888","description":"New line not in chart","amount":2,"rate":500,"x":1,"unit":"Flat","currency":"SAR"}]'
\set BAD  '[{"row":2,"main_code":"1101","description":"ok row","amount":1,"rate":100,"currency":"SAR"},{"row":3,"description":"no code","amount":1,"rate":1},{"row":4,"main_code":"1403","description":"bad number","amount":"abc","rate":1},{"row":5,"main_code":"1403","description":"negative","amount":1,"rate":-5},{"row":6,"main_code":"1403","description":"bad currency","amount":1,"rate":5,"currency":"EUR"},{"row":7,"main_code":"1100","description":"header code used","amount":1,"rate":5,"currency":"SAR"},{"row":8,"main_code":"1403","amount":1,"rate":5}]'
SELECT t.as_user(:'A');
SELECT count(*) AS lines_before FROM budget_lines WHERE project_id = :'P1' \gset
SELECT count(*) AS versions_before FROM budget_versions WHERE project_id = :'P1' \gset
-- preview: nothing written, every row explained
CREATE TEMP TABLE pv AS SELECT import_budget_preview(:'P1', :'GOOD'::jsonb) AS j;
GRANT ALL ON pv TO PUBLIC;
SELECT t.eq('preview counts rows', (SELECT (j#>>'{summary,rows}')::int FROM pv), 4);
SELECT t.eq('no errors in the good file', (SELECT (j#>>'{summary,errors}')::int FROM pv), 0);
SELECT t.eq('exact duplicate detected (case-insensitive text)', (SELECT (j#>>'{summary,duplicates}')::int FROM pv), 1);
SELECT t.eq('duplicate points at the first row', (SELECT (r->>'duplicate_of')::int FROM pv, jsonb_array_elements(j->'rows') r WHERE (r->>'row')::int = 4), 2);
SELECT t.eq('unknown code is a warning, listed for review', (SELECT j#>>'{summary,unknown_codes}' FROM pv), '["8888"]');
SELECT t.eq('thousands separators and lowercase currency accepted', (SELECT (r->>'line_total_sar')::numeric FROM pv, jsonb_array_elements(j->'rows') r WHERE (r->>'row')::int = 2), 112500.00);
SELECT t.eq('total counts each line once (duplicate excluded)', (SELECT (j#>>'{summary,total_sar}')::numeric FROM pv), 123500.00);
SELECT t.eq('USD total at the project rate', (SELECT (j#>>'{summary,total_usd}')::numeric FROM pv), 32933.33);
SELECT t.eq('preview says it can be committed', (SELECT (j#>>'{summary,can_commit}')::boolean FROM pv), true);
SELECT t.eq('preview names the active version it will not touch', (SELECT j#>>'{summary,active_version,name}' FROM pv), 'v1.0');
SELECT t.eq('preview wrote no lines', (SELECT count(*) FROM budget_lines WHERE project_id = :'P1'), :lines_before::bigint);
SELECT t.eq('preview wrote no version', (SELECT count(*) FROM budget_versions WHERE project_id = :'P1'), :versions_before::bigint);
-- a bad file: every problem named with its row
CREATE TEMP TABLE bd AS SELECT import_budget_preview(:'P1', :'BAD'::jsonb) AS j;
GRANT ALL ON bd TO PUBLIC;
CREATE TEMP VIEW br AS SELECT (r->>'row')::int AS row, r->>'status' AS status, r->'messages' AS m FROM bd, jsonb_array_elements(j->'rows') r;
GRANT ALL ON br TO PUBLIC;
SELECT t.eq('six rows rejected', (SELECT (j#>>'{summary,errors}')::int FROM bd), 6);
SELECT t.eq('missing code reported', (SELECT m->>0 FROM br WHERE row=3), 'budget code is missing');
SELECT t.eq('non-numeric value reported with the value', (SELECT m->>0 FROM br WHERE row=4), 'amount "abc" is not a number');
SELECT t.eq('negative number reported', (SELECT m->>0 FROM br WHERE row=5), 'negative numbers are not allowed');
SELECT t.eq('unknown currency reported', (SELECT m->>0 FROM br WHERE row=6), 'currency "EUR" is not SAR or USD');
SELECT t.eq('header code refused', (SELECT status FROM br WHERE row=7), 'error');
SELECT t.eq('missing description reported', (SELECT m->>0 FROM br WHERE row=8), 'description is missing');
SELECT t.eq('bad file cannot be committed', (SELECT (j#>>'{summary,can_commit}')::boolean FROM bd), false);
SELECT t.denied('commit of a file with errors is refused as a whole', $$SELECT import_budget_commit('20000000-0000-0000-0000-000000000001', '[{"row":2,"main_code":"1101","description":"ok","amount":1,"rate":1,"currency":"SAR"},{"row":3,"description":"no code","amount":1,"rate":1}]'::jsonb)$$);
SELECT t.eq('...and nothing was written', (SELECT count(*) FROM budget_lines WHERE project_id = :'P1'), :lines_before::bigint);
SELECT t.denied('not an array rejected', $$SELECT import_budget_preview('20000000-0000-0000-0000-000000000001', '{"a":1}'::jsonb)$$);
-- commit the good file
CREATE TEMP TABLE cm AS SELECT import_budget_commit(:'P1', :'GOOD'::jsonb, 'Imported v2') AS j;
GRANT ALL ON cm TO PUBLIC;
SELECT t.eq('3 lines written, 1 duplicate skipped', (SELECT (j->>'inserted')||'/'||(j->>'skipped_duplicates') FROM cm), '3/1');
SELECT t.eq('commit total = preview total', (SELECT (j->>'total_sar')::numeric FROM cm), 123500.00);
SELECT t.eq('the new version is a draft', (SELECT status FROM budget_versions WHERE id = (SELECT (j->>'version_id')::uuid FROM cm)), 'draft');
SELECT t.eq('lines are on the new draft version only', (SELECT count(*) FROM budget_lines WHERE version_id = (SELECT (j->>'version_id')::uuid FROM cm)), 3::bigint);
SELECT t.eq('top sheet account filled from the master chart when not given', (SELECT topsheet_code FROM budget_lines WHERE version_id = (SELECT (j->>'version_id')::uuid FROM cm) AND main_code='1101'), '1100');
SELECT t.eq('who imported is recorded', (SELECT uploaded_by FROM budget_lines WHERE version_id = (SELECT (j->>'version_id')::uuid FROM cm) LIMIT 1), :'A'::uuid);
-- the approved figures did not move
SELECT t.eq('active budget total unchanged', (SELECT sum(estimate) FROM get_cost_report(:'P1')), 335000.00);
SELECT t.eq('still exactly one active version', (SELECT count(*) FROM budget_versions WHERE project_id=:'P1' AND status='active'), 1::bigint);
SELECT t.eq('with duplicates kept on request', (SELECT (import_budget_commit(:'P1', :'GOOD'::jsonb, 'Imported v3', false)->>'inserted')::int), 4);
-- permissions
SELECT t.as_user(:'C');
SELECT t.eq('a viewer may preview', (SELECT (import_budget_preview(:'P1', :'GOOD'::jsonb)#>>'{summary,rows}')::int), 4);
SELECT t.denied('a viewer cannot commit', $$SELECT import_budget_commit('20000000-0000-0000-0000-000000000001', '[{"row":2,"main_code":"1101","description":"x","amount":1,"rate":1,"currency":"SAR"}]'::jsonb)$$);
SELECT t.as_user(:'B');
SELECT t.denied('another tenant cannot preview', $$SELECT import_budget_preview('20000000-0000-0000-0000-000000000001', '[]'::jsonb)$$);
SELECT t.denied('another tenant cannot commit', $$SELECT import_budget_commit('20000000-0000-0000-0000-000000000001', '[{"row":2,"main_code":"1101","description":"x","amount":1,"rate":1,"currency":"SAR"}]'::jsonb)$$);
RESET ROLE;
