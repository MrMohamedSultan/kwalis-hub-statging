-- 206 — board approval of the budget, version by version: only the producer /
-- admins send, only assigned board members decide (never the sender), an
-- approved budget is locked, a change goes through a new draft that replaces
-- the active budget once approved.
\set A  '00000000-0000-0000-0000-00000000000a'
\set B  '00000000-0000-0000-0000-00000000000b'
\set C  '00000000-0000-0000-0000-00000000000c'
\set D  '00000000-0000-0000-0000-00000000000d'
\set E  '00000000-0000-0000-0000-00000000000e'
\set F  '20600000-0000-0000-0000-0000000000f1'
\set G  '20600000-0000-0000-0000-0000000000f2'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P  '20000000-0000-0000-0000-000000000206'
\set P2 '20000000-0000-0000-0000-000000000207'
\set OTH '20000000-0000-0000-0000-000000000002'
\set V1 '40000000-0000-0000-0000-000000000206'
\set V9 '40000000-0000-0000-0000-000000000207'
\set V10 '40000000-0000-0000-0000-000000000208'

-- ---------------------------------------------------------------- setup
SET session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES (:'F','board1@org1.test'), (:'G','board2@org1.test');
INSERT INTO profiles(id,display_name) VALUES (:'F','Board One'), (:'G','Board Two');
INSERT INTO organization_members(organization_id,user_id,role) VALUES (:'O1',:'F','member'), (:'O1',:'G','member');
SET session_replication_role = origin;
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status) VALUES
 (:'P', :'D', 'Board approval test', 'BRD1', :'O1', 'USD', 3.75, 'Pre-Production'),
 (:'P2', :'D', 'Never approved', 'BRD2', :'O1', 'USD', 3.75, 'Pre-Production');
INSERT INTO project_members(project_id,user_id,role,executive_title) VALUES
 (:'P', :'A', 'producer', NULL), (:'P', :'C', 'member', NULL),
 (:'P', :'F', 'member', 'Board Member'), (:'P', :'G', 'member', 'Board Member'),
 (:'P2', :'A', 'member', NULL)
ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, executive_title = EXCLUDED.executive_title;
UPDATE project_members SET role = 'admin' WHERE project_id IN (:'P', :'P2') AND user_id = :'D';
INSERT INTO budget_versions(id,project_id,organization_id,version_no,version_name,status) VALUES
 (:'V1', :'P', :'O1', 1, 'v1.0', 'active'), (:'V9', :'P2', :'O1', 1, 'v1.0', 'active'),
 (:'V10', :'P2', :'O1', 2, 'v2.0', 'draft');
INSERT INTO budget_lines(project_id,organization_id,version_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency) VALUES
 (:'P', :'O1', :'V1', '2100', '2101', '2100', 'Camera', 1, 1000, 1, 'Package', 'SAR'),
 (:'P', :'O1', :'V1', '2200', '2201', '2200', 'Lights', 1, 500, 1, 'Package', 'SAR'),
 (:'P2', :'O1', :'V9', '2100', '2101', '2100', 'Camera', 1, 10, 1, 'Package', 'SAR'),
 (:'P2', :'O1', :'V10', '2100', '2101', '2100', 'Camera', 1, 20, 1, 'Package', 'SAR');

-- ---------------------------------------------------------------- who may send
SELECT t.as_user(:'C');
SELECT t.denied('a plain project member cannot send the budget', format($$SELECT submit_budget_for_approval(%L, %L)$$, :'P', :'V1'));
SELECT t.as_user(:'F');
SELECT t.denied('a board member cannot send the budget', format($$SELECT submit_budget_for_approval(%L, %L)$$, :'P', :'V1'));
SELECT t.as_user(:'B');
SELECT t.denied('another tenant cannot send the budget', format($$SELECT submit_budget_for_approval(%L, %L)$$, :'P', :'V1'));
SELECT t.as_user(:'A');
SELECT t.denied('approvers must hold an executive title', format($$SELECT submit_budget_for_approval(%L, %L, ARRAY[%L]::uuid[])$$, :'P', :'V1', :'C'));
SELECT t.denied('the sender cannot be an approver', format($$SELECT submit_budget_for_approval(%L, %L, ARRAY[%L, %L]::uuid[])$$, :'P', :'V1', :'A', :'F'));
SELECT t.denied('approvers must be members of the project', format($$SELECT submit_budget_for_approval(%L, %L, ARRAY[%L]::uuid[])$$, :'P', :'V1', :'B'));
SELECT t.denied('a version of another project is refused', format($$SELECT submit_budget_for_approval(%L, %L)$$, :'P', :'V9'));

-- ---------------------------------------------------------------- 1. the active budget
SELECT submit_budget_for_approval(:'P', :'V1', NULL, 'First budget') AS r1 \gset
SELECT t.eq('producer sent the active budget: pending, all board members asked',
  (SELECT status||'|'||kind||'|'||line_count||'|'||total_sar FROM budget_approval_requests WHERE id = :'r1'), 'pending|active|2|1500.00');
SELECT t.eq('two approvers (the board members)', (SELECT count(*) FROM budget_approval_decisions WHERE request_id = :'r1'), 2::bigint);
SELECT t.eq('project budget is Pending Approval', (SELECT budget_status::text FROM projects WHERE id = :'P'), 'Pending Approval');
SELECT t.denied('only one pending request per project', format($$SELECT submit_budget_for_approval(%L, %L)$$, :'P', :'V1'));
SELECT t.denied('pending active budget: the producer cannot edit it', format($$UPDATE budget_lines SET rate = 1 WHERE version_id = %L$$, :'V1'));
SELECT t.as_user(:'D');
SELECT t.denied('pending active budget: an org/project admin cannot edit it', format($$UPDATE budget_lines SET rate = 1 WHERE version_id = %L$$, :'V1'));
SELECT t.denied('org admin cannot write the budget status directly', format($$UPDATE projects SET budget_status = 'Locked/Approved' WHERE id = %L$$, :'P'));
SELECT t.as_user(:'F');
SELECT t.eq('the board member was notified', (SELECT count(*) FROM notifications WHERE user_id = :'F' AND metadata->>'request_id' = :'r1'), 1::bigint);
SELECT t.eq('the board member sees the request', (SELECT count(*) FROM budget_approval_requests WHERE id = :'r1'), 1::bigint);
SELECT t.eq('the board member sees the summary', (SELECT sum(total_sar) FROM budget_version_summary(:'V1')), 1500.00::numeric);
SELECT t.as_user(:'A');
SELECT t.denied('the sender cannot approve', format($$SELECT decide_budget_approval(%L, 'approved')$$, :'r1'));
SELECT t.as_user(:'C');
SELECT t.denied('a non-approver cannot decide', format($$SELECT decide_budget_approval(%L, 'approved')$$, :'r1'));
SELECT t.as_user(:'B');
SELECT t.denied('another tenant cannot decide', format($$SELECT decide_budget_approval(%L, 'approved')$$, :'r1'));
SELECT t.eq('another tenant sees no request', (SELECT count(*) FROM budget_approval_requests WHERE project_id = :'P'), 0::bigint);
SELECT t.eq('another tenant gets no summary', (SELECT count(*) FROM budget_version_summary(:'V1')), 0::bigint);
SELECT t.as_user(:'F');
SELECT t.denied('reject needs a reason', format($$SELECT decide_budget_approval(%L, 'rejected', '  ')$$, :'r1'));
SELECT t.denied('unknown decision refused', format($$SELECT decide_budget_approval(%L, 'maybe')$$, :'r1'));
SELECT t.eq('first approval: still pending', decide_budget_approval(:'r1', 'approved'), 'pending');
SELECT t.denied('an approver decides only once', format($$SELECT decide_budget_approval(%L, 'rejected', 'changed my mind')$$, :'r1'));
SELECT t.denied('a board member cannot write a decision directly', format($$UPDATE budget_approval_decisions SET decision = 'approved' WHERE request_id = %L$$, :'r1'));
SELECT t.as_user(:'G');
SELECT t.eq('last approval: approved', decide_budget_approval(:'r1', 'approved'), 'approved');
SELECT t.eq('budget Locked/Approved, locked by the last approver',
  (SELECT budget_status::text||'|'||(budget_locked_by = :'G'::uuid)::text||'|'||(budget_locked_at IS NOT NULL)::text FROM projects WHERE id = :'P'),
  'Locked/Approved|true|true');
SELECT t.eq('request approved', (SELECT status FROM budget_approval_requests WHERE id = :'r1'), 'approved');
SELECT t.as_user(:'A');
SELECT t.eq('the sender was notified of the approval', (SELECT count(*) FROM notifications WHERE user_id = :'A' AND metadata->>'event' = 'budget_approval_approved' AND metadata->>'request_id' = :'r1'), 1::bigint);

-- ---------------------------------------------------------------- 2. locked
SELECT t.denied('locked active version: producer cannot edit', format($$UPDATE budget_lines SET rate = 1 WHERE version_id = %L$$, :'V1'));
SELECT t.denied('locked active version: producer cannot add a line', format($$INSERT INTO budget_lines(project_id,organization_id,version_id,header_code,main_code,description,amount,rate,currency) VALUES (%L,%L,%L,'2100','2102','x',1,1,'SAR')$$, :'P', :'O1', :'V1'));
SELECT t.denied('locked active budget cannot be sent again', format($$SELECT submit_budget_for_approval(%L, %L)$$, :'P', :'V1'));
SELECT t.as_user(:'D');
SELECT t.denied('locked active version: project admin cannot edit', format($$UPDATE budget_lines SET rate = 1 WHERE version_id = %L$$, :'V1'));
SELECT t.denied('locked active version: project admin cannot delete', format($$DELETE FROM budget_lines WHERE version_id = %L$$, :'V1'));
SELECT t.denied('version status cannot be written directly', format($$UPDATE budget_versions SET status = 'archived' WHERE id = %L$$, :'V1'));
SELECT t.denied('an active version cannot be inserted next to the active one', format($$INSERT INTO budget_versions(project_id,organization_id,version_no,version_name,status) VALUES (%L,%L,9,'x','active')$$, :'P', :'O1'));
SELECT t.as_user(:'E');
UPDATE budget_lines SET notes = 'platform fix' WHERE version_id = :'V1' AND main_code = '2101';
SELECT t.eq('super admin keeps the escape hatch', (SELECT notes FROM budget_lines WHERE version_id = :'V1' AND main_code = '2101'), 'platform fix');

-- ---------------------------------------------------------------- 3. a new draft
SELECT t.as_user(:'F');
SELECT t.denied('a board member cannot create a draft', format($$SELECT create_budget_draft(%L, 'x')$$, :'P'));
SELECT t.as_user(:'A');
SELECT create_budget_draft(:'P', 'v2 revision') AS v2 \gset
SELECT create_budget_draft(:'P', 'v3 blank', true) AS v3 \gset
SELECT t.eq('copied draft has the lines', (SELECT count(*) FROM budget_lines WHERE version_id = :'v2'), 2::bigint);
SELECT t.eq('blank draft starts empty (not linked to anything)', (SELECT count(*) FROM budget_lines WHERE version_id = :'v3'), 0::bigint);
UPDATE budget_lines SET rate = 2000 WHERE version_id = :'v2' AND main_code = '2101';
SELECT t.eq('draft stays editable by the producer while the active budget is locked', (SELECT rate FROM budget_lines WHERE version_id = :'v2' AND main_code = '2101'), 2000::numeric);
SELECT t.denied('an empty draft cannot be sent', format($$SELECT submit_budget_for_approval(%L, %L)$$, :'P', :'v3'));
SELECT t.as_user(:'C');
UPDATE budget_lines SET notes = 'member note' WHERE version_id = :'v2' AND main_code = '2201';
SELECT t.eq('draft editable by a project member', (SELECT notes FROM budget_lines WHERE version_id = :'v2' AND main_code = '2201'), 'member note');
SELECT t.as_user(:'F');
SELECT t.denied('a board member cannot edit a draft', format($$UPDATE budget_lines SET rate = 1 WHERE version_id = %L$$, :'v2'));
SELECT t.as_user(:'D');
SELECT t.denied('direct publish of a draft refused once the budget is approved', format($$SELECT publish_budget_version(%L)$$, :'v2'));
SELECT t.as_user(:'A');
SELECT submit_budget_for_approval(:'P', :'v2', ARRAY[:'F']::uuid[]) AS r2 \gset
SELECT t.eq('request on a draft leaves the locked status', (SELECT budget_status::text FROM projects WHERE id = :'P'), 'Locked/Approved');
SELECT t.denied('a draft under review is frozen', format($$UPDATE budget_lines SET rate = 1 WHERE version_id = %L$$, :'v2'));
SELECT t.denied('a draft under review cannot be deleted', format($$DELETE FROM budget_versions WHERE id = %L$$, :'v2'));
SELECT t.as_user(:'G');
SELECT t.denied('a board member not asked on this request cannot decide', format($$SELECT decide_budget_approval(%L, 'approved')$$, :'r2'));
SELECT t.as_user(:'F');
SELECT t.eq('reject with a reason', decide_budget_approval(:'r2', 'rejected', 'Camera too expensive'), 'rejected');
SELECT t.eq('rejected request keeps the reason; active budget still locked',
  (SELECT r.status||'|'||r.decision_reason||'|'||p.budget_status::text FROM budget_approval_requests r JOIN projects p ON p.id = r.project_id WHERE r.id = :'r2'),
  'rejected|Camera too expensive|Locked/Approved');
SELECT t.eq('v1 is still the active budget', (SELECT status FROM budget_versions WHERE id = :'V1'), 'active');
SELECT t.as_user(:'A');
SELECT t.eq('the sender was notified of the rejection', (SELECT count(*) FROM notifications WHERE user_id = :'A' AND metadata->>'event' = 'budget_approval_rejected'), 1::bigint);
UPDATE budget_lines SET rate = 1800 WHERE version_id = :'v2' AND main_code = '2101';
SELECT t.eq('after a rejection the draft is editable again', (SELECT rate FROM budget_lines WHERE version_id = :'v2' AND main_code = '2101'), 1800::numeric);
SELECT submit_budget_for_approval(:'P', :'v2') AS r3 \gset
SELECT t.as_user(:'F');
SELECT decide_budget_approval(:'r3', 'approved');
SELECT t.eq('draft not promoted before every approver approved', (SELECT status FROM budget_versions WHERE id = :'v2'), 'draft');
SELECT t.as_user(:'G');
SELECT t.eq('all approved', decide_budget_approval(:'r3', 'approved'), 'approved');
SELECT t.eq('approved draft is the active budget, the old one archived',
  (SELECT string_agg(version_name||'='||status, ',' ORDER BY version_no) FROM budget_versions WHERE project_id = :'P' AND id IN (:'V1', :'v2')),
  'v1.0=archived,v2 revision=active');
SELECT t.eq('project budget locked', (SELECT budget_status::text FROM projects WHERE id = :'P'), 'Locked/Approved');
SELECT t.eq('financial views read the new budget', (SELECT budget_sar FROM v_project_position WHERE project_id = :'P'), 2300::numeric);
SELECT t.as_user(:'D');
SELECT t.denied('archived version is read-only', format($$UPDATE budget_lines SET rate = 1 WHERE version_id = %L$$, :'V1'));
SELECT t.denied('new active version locked for the admin', format($$UPDATE budget_lines SET rate = 1 WHERE version_id = %L$$, :'v2'));

-- ---------------------------------------------------------------- 4. withdraw
SELECT t.as_user(:'A');
INSERT INTO budget_lines(project_id,organization_id,version_id,header_code,main_code,description,amount,rate,unit,currency)
VALUES (:'P', :'O1', :'v3', '2100', '2101', 'Camera only', 1, 900, 'Package', 'SAR');
SELECT submit_budget_for_approval(:'P', :'v3') AS r4 \gset
SELECT t.as_user(:'C');
SELECT t.denied('a plain member cannot withdraw', format($$SELECT cancel_budget_approval(%L)$$, :'r4'));
SELECT t.as_user(:'A');
SELECT cancel_budget_approval(:'r4', 'wrong file');
SELECT t.eq('withdrawn', (SELECT status FROM budget_approval_requests WHERE id = :'r4'), 'cancelled');
SELECT t.as_user(:'F');
SELECT t.denied('no decision on a withdrawn request', format($$SELECT decide_budget_approval(%L, 'approved')$$, :'r4'));

-- ---------------------------------------------------------------- 5. isolation and old projects
SELECT t.as_user(:'F');
SELECT t.eq('a board member cannot read another project''s budget', (SELECT count(*) FROM budget_lines WHERE project_id = :'OTH'), 0::bigint);
SELECT t.eq('a board member cannot read a project of his org he is not on', (SELECT count(*) FROM budget_lines WHERE project_id = :'P2'), 0::bigint);
SELECT t.eq('nor its versions', (SELECT count(*) FROM budget_versions WHERE project_id = :'P2'), 0::bigint);
SELECT t.as_user(:'D');
SELECT publish_budget_version(:'V10');
SELECT t.eq('a project that never used approvals still publishes directly', (SELECT status FROM budget_versions WHERE id = :'V10'), 'active');
SELECT t.as_user(:'E');
UPDATE projects SET budget_status = 'Draft' WHERE id = :'P2';
SELECT t.eq('super admin can still set the status', (SELECT budget_status::text FROM projects WHERE id = :'P2'), 'Draft');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

-- =====================================================================
-- Security review fixes (H1, M2, M3, L2–L7)
-- =====================================================================
\set P3 '20000000-0000-0000-0000-000000000208'
\set P5 '20000000-0000-0000-0000-000000000209'
\set V31 '40000000-0000-0000-0000-000000000231'
\set V32 '40000000-0000-0000-0000-000000000232'
\set V51 '40000000-0000-0000-0000-000000000251'
INSERT INTO projects(id,owner_id,name,code,organization_id,currency,fx_rate,status) VALUES
 (:'P3', :'D', 'Board fixes', 'BRD3', :'O1', 'USD', 3.75, 'Pre-Production'),
 (:'P5', :'D', 'Legacy approval', 'BRD5', :'O1', 'USD', 3.75, 'Pre-Production');
INSERT INTO project_members(project_id,user_id,role,executive_title) VALUES
 (:'P3', :'A', 'producer', NULL), (:'P3', :'C', 'member', NULL),
 (:'P3', :'F', 'member', 'Board Member'), (:'P3', :'G', 'member', 'Board Member'),
 (:'P5', :'A', 'producer', NULL), (:'P5', :'C', 'member', NULL), (:'P5', :'G', 'member', 'Board Member')
ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, executive_title = EXCLUDED.executive_title;
UPDATE project_members SET role = 'admin' WHERE project_id IN (:'P3', :'P5') AND user_id = :'D';
INSERT INTO budget_versions(id,project_id,organization_id,version_no,version_name,status) VALUES
 (:'V31', :'P3', :'O1', 1, 'v1.0', 'active'), (:'V32', :'P3', :'O1', 2, 'v2.0', 'draft'),
 (:'V51', :'P5', :'O1', 1, 'v1.0', 'active');
INSERT INTO budget_lines(project_id,organization_id,version_id,header_code,main_code,topsheet_code,description,amount,rate,x,unit,currency) VALUES
 (:'P3', :'O1', :'V31', '2100', '2101', '2100', 'Camera', 1, 100, 1, 'Package', 'USD'),
 (:'P3', :'O1', :'V32', '2100', '2101', '2100', 'Camera', 1, 200, 1, 'Package', 'USD'),
 (:'P5', :'O1', :'V51', '2100', '2101', '2100', 'Camera', 1, 300, 1, 'Package', 'SAR');

-- ---------------------------------------------------------------- H1
SELECT t.as_user(:'D');
SELECT t.eq('H1 good: a project without board members and requests publishes directly', can_publish_budget_directly(:'P2'), true);
SELECT t.eq('H1: a project with a board member never publishes directly', can_publish_budget_directly(:'P3'), false);
SELECT t.denied('H1: direct publish refused while the project has a board member', format($$SELECT publish_budget_version(%L)$$, :'V32'));
SELECT t.as_user(:'A');
SELECT submit_budget_for_approval(:'P3', :'V32', ARRAY[:'F']::uuid[]) AS r5 \gset
SELECT t.as_user(:'F');
SELECT decide_budget_approval(:'r5', 'rejected', 'Not now');
SELECT t.eq('H1: rejected draft request leaves the project in Draft', (SELECT budget_status::text FROM projects WHERE id = :'P3'), 'Draft');
SELECT t.as_user(:'E');
UPDATE project_members SET executive_title = NULL WHERE project_id = :'P3' AND user_id IN (:'F', :'G');
SELECT t.as_user(:'D');
SELECT t.denied('H1: a rejected draft cannot be published directly (the project had a request)', format($$SELECT publish_budget_version(%L)$$, :'V32'));
SELECT t.eq('H1: still a draft', (SELECT status FROM budget_versions WHERE id = :'V32'), 'draft');
SELECT t.as_user(:'E');
UPDATE project_members SET executive_title = 'Board Member' WHERE project_id = :'P3' AND user_id IN (:'F', :'G');

-- ---------------------------------------------------------------- M2
SELECT t.as_user(:'D');
SELECT t.denied('M2: fx rate of a locked budget cannot change', format($$UPDATE projects SET fx_rate = 10 WHERE id = %L$$, :'P'));
SELECT t.denied('M2: currency of a locked budget cannot change', format($$UPDATE projects SET currency = 'EUR' WHERE id = %L$$, :'P'));
SELECT t.eq('M2: locked total unchanged', (SELECT fx_rate FROM projects WHERE id = :'P'), 3.75::numeric);
UPDATE projects SET fx_rate = 3.80 WHERE id = :'P2';
SELECT t.eq('M2 good: fx of a project in Draft without a pending request still changes', (SELECT fx_rate FROM projects WHERE id = :'P2'), 3.80::numeric);
SELECT t.as_user(:'A');
SELECT submit_budget_for_approval(:'P3', :'V32', ARRAY[:'F', :'G']::uuid[]) AS r6 \gset
SELECT t.as_user(:'D');
SELECT t.denied('M2: fx frozen while a draft request is pending', format($$UPDATE projects SET fx_rate = 5 WHERE id = %L$$, :'P3'));
SELECT t.as_user(:'E');
UPDATE projects SET fx_rate = 3.75 WHERE id = :'P';
SELECT t.eq('M2 good: super admin may still correct it', (SELECT fx_rate FROM projects WHERE id = :'P'), 3.75::numeric);

-- ---------------------------------------------------------------- L2
SELECT t.as_user(:'E');
SELECT t.denied('L2: a line of a version under review cannot change, even for the platform owner', format($$UPDATE budget_lines SET rate = 1 WHERE version_id = %L$$, :'V32'));
SELECT t.denied('L2: no line added to a version under review', format($$INSERT INTO budget_lines(project_id,organization_id,version_id,header_code,main_code,description,amount,rate,currency) VALUES (%L,%L,%L,'2100','2102','x',1,1,'SAR')$$, :'P3', :'O1', :'V32'));
SELECT t.eq('L2 good: request total is the frozen version total', (SELECT total_sar FROM budget_approval_requests WHERE id = :'r6'), 750.00::numeric);
SELECT t.eq('L2: the line lock trigger is installed', (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_trg_budget_line_version_lock'), 1::bigint);

-- ---------------------------------------------------------------- M3
-- (a) an approver whose title was removed cannot decide
SELECT t.as_user(:'E');
UPDATE project_members SET executive_title = NULL WHERE project_id = :'P3' AND user_id = :'G';
SELECT t.as_user(:'G');
SELECT t.denied('M3a: an approver without an executive title any more cannot decide', format($$SELECT decide_budget_approval(%L, 'approved')$$, :'r6'));
SELECT t.as_user(:'F');
SELECT t.eq('M3a good: an approver still holding the title decides', decide_budget_approval(:'r6', 'approved'), 'pending');
-- (b) an approver who wrote lines of the version cannot decide
SELECT t.as_user(:'E');
UPDATE project_members SET executive_title = 'Board Member' WHERE project_id = :'P3' AND user_id = :'G';
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO audit_history(table_name, record_id, organization_id, project_id, actor_id, operation, new_row)
SELECT 'budget_lines', bl.id, :'O1', :'P3', :'G', 'UPDATE', jsonb_build_object('version_id', :'V32')
  FROM budget_lines bl WHERE bl.version_id = :'V32' LIMIT 1;
SELECT t.as_user(:'G');
SELECT t.denied('M3b: an approver who edited a line of the version cannot approve it', format($$SELECT decide_budget_approval(%L, 'approved')$$, :'r6'));
SELECT t.as_user(:'A');
SELECT cancel_budget_approval(:'r6', 'restart');
-- C writes a line of the draft, then becomes a board member
SELECT t.as_user(:'C');
UPDATE budget_lines SET notes = 'C was here' WHERE version_id = :'V32';
SELECT t.as_user(:'E');
UPDATE project_members SET executive_title = 'Board Member' WHERE project_id = :'P3' AND user_id = :'C';
SELECT t.as_user(:'A');
SELECT t.denied('M3b: an editor of the version cannot be named approver', format($$SELECT submit_budget_for_approval(%L, %L, ARRAY[%L]::uuid[])$$, :'P3', :'V32', :'C'));
SELECT submit_budget_for_approval(:'P3', :'V32') AS r7 \gset
SELECT t.eq('M3b good: default approvers leave out every editor of the version (C, G)',
  (SELECT string_agg(approver_id::text, ',') FROM budget_approval_decisions WHERE request_id = :'r7'), :'F');
SELECT t.as_user(:'C');
SELECT t.denied('M3b: the editor is not an approver of the request', format($$SELECT decide_budget_approval(%L, 'approved')$$, :'r7'));
SELECT t.as_user(:'F');
SELECT t.eq('M3b good: an approver who never wrote the version approves', decide_budget_approval(:'r7', 'approved'), 'approved');
SELECT t.eq('M3b good: draft promoted', (SELECT status FROM budget_versions WHERE id = :'V32'), 'active');

-- ---------------------------------------------------------------- L4
SELECT t.as_user(:'F');
SELECT t.denied('L4: a board member cannot rename a version', format($$UPDATE budget_versions SET version_name = 'hacked' WHERE id = %L$$, :'V1'));
SELECT t.denied('L4: a board member cannot insert a version', format($$INSERT INTO budget_versions(project_id,organization_id,version_no,version_name,status) VALUES (%L,%L,99,'F draft','draft')$$, :'P', :'O1'));
SELECT t.as_user(:'A');
UPDATE budget_versions SET version_name = 'v3 renamed' WHERE id = :'v3';
SELECT t.eq('L4 good: the producer renames a draft', (SELECT version_name FROM budget_versions WHERE id = :'v3'), 'v3 renamed');

-- ---------------------------------------------------------------- L5
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('L5: authenticated cannot write or truncate the request tables',
  has_table_privilege('authenticated', 'public.budget_approval_requests', 'INSERT,UPDATE,DELETE,TRUNCATE')
  OR has_table_privilege('authenticated', 'public.budget_approval_decisions', 'INSERT,UPDATE,DELETE,TRUNCATE'), false);
SELECT t.eq('L5: anon has nothing on them',
  has_table_privilege('anon', 'public.budget_approval_requests', 'SELECT,TRUNCATE')
  OR has_table_privilege('anon', 'public.budget_approval_decisions', 'SELECT,TRUNCATE'), false);
SELECT t.eq('L5 good: authenticated reads them (RLS)',
  has_table_privilege('authenticated', 'public.budget_approval_requests', 'SELECT')
  AND has_table_privilege('authenticated', 'public.budget_approval_decisions', 'SELECT'), true);
SELECT t.as_user(:'A');
SELECT t.denied('L5: truncate refused', 'TRUNCATE public.budget_approval_decisions');

-- ---------------------------------------------------------------- L6
SELECT t.as_user(:'B');
SELECT t.denied('L6: is_budget_executive is not callable by clients', format($$SELECT is_budget_executive(%L, %L)$$, :'F', :'P'));
SELECT t.denied('L6: can_submit_budget is not callable by clients', format($$SELECT can_submit_budget(%L, %L)$$, :'A', :'P'));
SELECT t.eq('L6 good: can_publish_budget_directly answers only for an accessible project', can_publish_budget_directly(:'P2'), false);
SELECT t.as_user(:'A');
SELECT t.eq('L6 good: internal use still works (draft edit through the policy)', (SELECT count(*) FROM budget_lines WHERE version_id = :'v3'), 1::bigint);

-- ---------------------------------------------------------------- L7
SELECT t.as_user(:'D');
SELECT t.denied('L7: an org admin cannot log an event in another user''s name', format($$INSERT INTO budget_status_events(project_id, organization_id, actor_id, action) VALUES (%L, %L, %L, 'note')$$, :'P', :'O1', :'A'));
SELECT t.denied('L7: an org admin cannot forge an approval event', format($$INSERT INTO budget_status_events(project_id, organization_id, actor_id, action, to_status) VALUES (%L, %L, %L, 'approver_approved', 'approved')$$, :'P', :'O1', :'D'));
SELECT t.denied('L7: an org admin cannot forge a status change', format($$INSERT INTO budget_status_events(project_id, organization_id, actor_id, action, to_status) VALUES (%L, %L, %L, 'status_change', 'Locked/Approved')$$, :'P', :'O1', :'D'));
INSERT INTO budget_status_events(project_id, organization_id, actor_id, action, note) VALUES (:'P', :'O1', :'D', 'note', 'checked');
SELECT t.eq('L7 good: an org admin logs an own note', (SELECT count(*) FROM budget_status_events WHERE project_id = :'P' AND action = 'note' AND actor_id = :'D'), 1::bigint);
SELECT t.eq('L7 good: the functions still log their events', (SELECT count(*) FROM budget_status_events WHERE project_id = :'P3' AND action = 'approval_submitted') >= 3, true);

-- ---------------------------------------------------------------- L3 legacy backfill
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO budget_approvers(project_id, organization_id, user_id) VALUES
 (:'P5', :'O1', :'A'), (:'P5', :'O1', :'G'), (:'P5', :'O1', :'C'), (:'P5', :'O1', :'B');
UPDATE projects SET budget_status = 'Pending Approval' WHERE id = :'P5';
-- the old flow logged who moved it (the sender)
INSERT INTO budget_status_events(project_id, organization_id, actor_id, action, from_status, to_status, created_at)
VALUES (:'P5', :'O1', :'A', 'status_change', 'Draft', 'Pending Approval', now() + interval '1 second');
SELECT t.eq('L3: backfill carries the legacy approval over once', budget_approval_backfill_legacy(), 1);
SELECT t.eq('L3: backfill is idempotent', budget_approval_backfill_legacy(), 0);
SELECT t.eq('L3: the sender comes from the last move to Pending Approval',
  (SELECT submitted_by FROM budget_approval_requests WHERE project_id = :'P5' AND status = 'pending'), :'A'::uuid);
SELECT t.eq('L3: only approvers with access and an executive title are kept (not the sender, a plain member or another tenant)',
  (SELECT string_agg(d.approver_id::text, ',') FROM budget_approval_decisions d
     JOIN budget_approval_requests r ON r.id = d.request_id WHERE r.project_id = :'P5'), :'G');
SELECT id AS r8 FROM budget_approval_requests WHERE project_id = :'P5' AND status = 'pending' \gset
SELECT t.as_user(:'A');
SELECT t.denied('L3: the old sender cannot approve the carried-over request', format($$SELECT decide_budget_approval(%L, 'approved')$$, :'r8'));
SELECT t.as_user(:'G');
SELECT t.eq('L3 good: the kept board member approves it', decide_budget_approval(:'r8', 'approved'), 'approved');
SELECT t.eq('L3 good: legacy budget locked', (SELECT budget_status::text FROM projects WHERE id = :'P5'), 'Locked/Approved');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
