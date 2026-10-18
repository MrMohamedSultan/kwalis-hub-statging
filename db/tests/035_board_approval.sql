\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-00000000000d'
\set E '00000000-0000-0000-0000-00000000000e'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P1 '20000000-0000-0000-0000-000000000001'
SET session_replication_role = replica;
-- a big request raised by accountant A, a small one too
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,total_amount,requested_amount,currency,status,requested_by) VALUES
 ('80000000-0000-0000-0000-000000000010',:'O1',:'P1','payroll_row','50000000-0000-0000-0000-000000000001',135539.47,50001,'SAR','waiting_approval',:'A'),
 ('80000000-0000-0000-0000-000000000011',:'O1',:'P1','payroll_row','50000000-0000-0000-0000-000000000002',107500,50000,'SAR','waiting_approval',:'A'),
 ('80000000-0000-0000-0000-000000000012',:'O1',:'P1','payroll_row','50000000-0000-0000-0000-000000000002',107500,50002,'SAR','waiting_approval',:'A');
-- C becomes a project executive; an owner F for org1
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000f','owner@org1.test');
INSERT INTO profiles(id) VALUES ('00000000-0000-0000-0000-00000000000f');
INSERT INTO organization_members(organization_id,user_id,role) VALUES (:'O1','00000000-0000-0000-0000-00000000000f','owner');
SET session_replication_role = origin;
UPDATE project_members SET executive_title = (SELECT (enum_range(NULL::executive_title_enum))[1]) WHERE project_id=:'P1' AND user_id=:'C';
-- shipped state: limit off, nothing changes
SELECT t.eq('limit ships switched off', public.payment_board_approval_limit(), NULL::numeric);
SELECT t.as_user(:'A');
SELECT t.denied('a member cannot set the limit', $$UPDATE platform_settings SET value='1' WHERE key='payment_board_approval_above_sar'$$);
SELECT t.as_user(:'E');
SELECT t.denied('limit must be a positive amount', $$UPDATE platform_settings SET value='-5' WHERE key='payment_board_approval_above_sar'$$);
UPDATE platform_settings SET value='50000' WHERE key='payment_board_approval_above_sar';
SELECT t.eq('super admin turned the limit on', public.payment_board_approval_limit(), 50000::numeric);
SELECT t.eq('who changed the setting is recorded', (SELECT updated_by FROM platform_settings WHERE key='payment_board_approval_above_sar'), :'E'::uuid);
-- acceptance: 50,001 needs an additional approval; 50,000 does not
SELECT t.as_user(:'D');
SELECT t.eq('50,001 is flagged as needing board approval', public.payment_request_needs_board_approval('80000000-0000-0000-0000-000000000010'), true);
SELECT t.eq('50,000 is not', public.payment_request_needs_board_approval('80000000-0000-0000-0000-000000000011'), false);
SELECT t.denied('50,001 cannot be approved without board approval', $$UPDATE payment_requests SET status='approved' WHERE id='80000000-0000-0000-0000-000000000010'$$);
UPDATE payment_requests SET status='approved' WHERE id='80000000-0000-0000-0000-000000000011';
SELECT t.eq('exactly 50,000 approves normally', (SELECT status FROM payment_requests WHERE id='80000000-0000-0000-0000-000000000011'), 'approved');
SELECT t.denied('an admin who is not owner/executive cannot give board approval', $$SELECT board_approve_payment_request('80000000-0000-0000-0000-000000000010')$$);
SELECT t.denied('board approvals cannot be inserted directly', $$INSERT INTO payment_request_board_approvals(payment_request_id, organization_id, approved_by) VALUES ('80000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000d')$$);
SELECT t.as_user(:'A');
SELECT t.denied('the requester cannot board-approve own request', $$SELECT board_approve_payment_request('80000000-0000-0000-0000-000000000010')$$);
SELECT t.as_user(:'B');
SELECT t.denied('another tenant cannot board-approve', $$SELECT board_approve_payment_request('80000000-0000-0000-0000-000000000010')$$);
-- project executive C gives the board approval
SELECT t.as_user(:'C');
SELECT board_approve_payment_request('80000000-0000-0000-0000-000000000010', 'Agreed at board') IS NOT NULL AS board_ok \gset
SELECT t.eq('project executive gave board approval', :'board_ok'::boolean, true);
SELECT t.as_user(:'D');
SELECT t.eq('no longer flagged', public.payment_request_needs_board_approval('80000000-0000-0000-0000-000000000010'), false);
SELECT t.denied('amount cannot be raised after board approval', $$UPDATE payment_requests SET requested_amount = 90000 WHERE id='80000000-0000-0000-0000-000000000010'$$);
UPDATE payment_requests SET status='approved' WHERE id='80000000-0000-0000-0000-000000000010';
SELECT t.eq('now the normal approver can approve', (SELECT status||'|'||(approved_by = :'D'::uuid)::text FROM payment_requests WHERE id='80000000-0000-0000-0000-000000000010'), 'approved|true');
-- the same person cannot be both the board approver and the final approver
SELECT t.as_user('00000000-0000-0000-0000-00000000000f');
SELECT board_approve_payment_request('80000000-0000-0000-0000-000000000012') IS NOT NULL AS b2 \gset
SELECT t.denied('owner who gave board approval cannot also be the final approver', $$UPDATE payment_requests SET status='approved' WHERE id='80000000-0000-0000-0000-000000000012'$$);
SELECT t.as_user(:'D');
UPDATE payment_requests SET status='approved' WHERE id='80000000-0000-0000-0000-000000000012';
SELECT t.eq('a different approver completes it', (SELECT status FROM payment_requests WHERE id='80000000-0000-0000-0000-000000000012'), 'approved');
RESET ROLE;
SELECT t.eq('board approvals are audited', (SELECT count(*) FROM audit_history WHERE table_name='payment_request_board_approvals'), 2::bigint);
-- switch the limit back off so later tests see the shipped state
UPDATE platform_settings SET value = NULL WHERE key='payment_board_approval_above_sar';
