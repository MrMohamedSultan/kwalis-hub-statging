\set A '00000000-0000-0000-0000-00000000000a'
\set P3 '20000000-0000-0000-0000-000000000003'
-- P3's active version has 3 lines with a top sheet account, one flagged rebate-eligible false
SET session_replication_role = replica;
UPDATE budget_lines SET notes = 'keep me' WHERE project_id = :'P3' AND main_code = '1403';
SET session_replication_role = origin;
SELECT t.as_user(:'A');
SELECT create_budget_draft(:'P3', 'Draft for copy test') AS draft_id \gset
SELECT t.eq('draft has the same number of lines', (SELECT count(*) FROM budget_lines WHERE version_id = :'draft_id'), 3::bigint);
SELECT t.eq('every copied line keeps its top sheet account', (SELECT count(*) FROM budget_lines WHERE version_id = :'draft_id' AND topsheet_code IS NULL), 0::bigint);
SELECT t.eq('rebate flag copied', (SELECT count(*) FROM budget_lines WHERE version_id = :'draft_id' AND rebate_eligible), 2::bigint);
SELECT t.eq('line notes copied', (SELECT notes FROM budget_lines WHERE version_id = :'draft_id' AND main_code = '1403'), 'keep me');
SELECT t.eq('amounts identical to the source', (SELECT sum(amount * rate) FROM budget_lines WHERE version_id = :'draft_id'), 180000::numeric);
SELECT t.eq('the draft is not counted in the approved budget', (SELECT sum(estimate) FROM get_cost_report(:'P3')), 180000.00);
RESET ROLE;
DELETE FROM budget_versions WHERE id = :'draft_id';
