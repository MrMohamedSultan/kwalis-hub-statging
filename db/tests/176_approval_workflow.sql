-- 176 — approval workflow: contract maker-checker, instalment requests,
-- approval chain, cancellations, payroll runs through Payment Approvals.
-- Runs in one transaction and rolls back, so later files see the seed state.
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-00000000000d'
\set E '00000000-0000-0000-0000-00000000000e'
\set F '00000000-0000-0000-0000-00000000000f'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P1 '20000000-0000-0000-0000-000000000001'
\set PEND 'a1760000-0000-0000-0000-000000000001'
\set POK 'a1760000-0000-0000-0000-000000000002'
\set PX 'a1760000-0000-0000-0000-000000000003'
\set RPEND 'b1760000-0000-0000-0000-000000000001'
\set ROK 'b1760000-0000-0000-0000-000000000002'
BEGIN;
-- ---------------------------------------------------------------- B12
SELECT t.as_user(:'A');
INSERT INTO people(id,kind,full_name,contract_status,organization_id,project_id) VALUES
 (:'PEND','crew','Pending Person','Pending Contract',:'O1',:'P1'),
 (:'POK','crew','Approved Person','Signed - Awaiting Review',:'O1',:'P1');
SELECT t.eq('creator is stamped', (SELECT created_by FROM people WHERE id=:'POK'), :'A'::uuid);
SELECT t.denied('B12 creator cannot approve own contract', $$UPDATE people SET contract_status='Active' WHERE id='a1760000-0000-0000-0000-000000000002'$$);
SELECT t.denied('B12 a new contract cannot start Active', $$INSERT INTO people(kind,full_name,contract_status,organization_id,project_id) VALUES ('crew','Sneaky','Active','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')$$);
SELECT t.as_user(:'D');
UPDATE people SET contract_status='Active' WHERE id=:'POK';
SELECT t.eq('B12 another user approves', (SELECT contract_status||'|'||(contract_approved_by=:'D'::uuid)::text FROM people WHERE id=:'POK'), 'Active|true');
SELECT t.as_user(:'A');
UPDATE people SET contract_approved_by=:'A' WHERE id=:'POK';
SELECT t.eq('B12 approval stamp cannot be rewritten', (SELECT contract_approved_by FROM people WHERE id=:'POK'), :'D'::uuid);

-- contracts with instalments (total 4,000: m1 1,000 flat · m2 25% = 1,000 · m3 2,000)
INSERT INTO payroll(id,ref_id,name,kind,total_amount,budget_code,organization_id,project_id,payment_schedule) VALUES
 (:'RPEND',:'PEND','Pending Person','crew',4000,'1101',:'O1',:'P1','[{"id":"m1","label":"Signing","percent":0,"amount":1000,"status":"Pending"}]'),
 (:'ROK',:'POK','Approved Person','crew',4000,'1101',:'O1',:'P1','[{"id":"m1","label":"Signing","percent":0,"amount":1000,"status":"Pending"},{"id":"m2","label":"Mid","percent":25,"amount":null,"status":"Pending"},{"id":"m3","label":"Wrap","percent":0,"amount":2000,"status":"Pending"}]');
SELECT t.denied('instalments cannot be inserted already Paid', $$INSERT INTO payroll(ref_id,name,kind,total_amount,organization_id,project_id,payment_schedule) VALUES ('x','X','crew',10,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','[{"id":"z","amount":10,"status":"Paid"}]')$$);

-- ---------------------------------------------------------------- B13
SELECT t.denied('B13 no request while the contract is not approved', $$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,payroll_milestone_id,total_amount,requested_amount,status,requested_by) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','payroll_row','b1760000-0000-0000-0000-000000000001','m1',4000,1000,'waiting_approval','00000000-0000-0000-0000-00000000000a')$$);
SELECT t.denied('B13 instalment status cannot be set to Hold by hand', $$UPDATE payroll SET payment_schedule = jsonb_set(payment_schedule,'{0,status}','"Hold"') WHERE id='b1760000-0000-0000-0000-000000000002'$$);
SELECT t.denied('B13 instalment cannot be marked Paid by hand', $$UPDATE payroll SET payment_schedule = jsonb_set(payment_schedule,'{0,status}','"Paid"') WHERE id='b1760000-0000-0000-0000-000000000002'$$);
SELECT t.denied('B13 request must equal the instalment amount', $$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,payroll_milestone_id,total_amount,requested_amount,status,requested_by) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','payroll_row','b1760000-0000-0000-0000-000000000002','m2',4000,999,'waiting_approval','00000000-0000-0000-0000-00000000000a')$$);
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,payroll_milestone_id,total_amount,requested_amount,status,requested_by,submitted_at)
VALUES ('c1760000-0000-0000-0000-000000000001',:'O1',:'P1','payroll_row',:'ROK','Approved Person · Signing','m1',4000,1000,'waiting_approval',:'A',now());
SELECT t.eq('B13 instalment shows Requested (Hold)', (SELECT payment_schedule->0->>'status' FROM payroll WHERE id=:'ROK'), 'Hold');
SELECT t.denied('B13 one open request per instalment', $$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,payroll_milestone_id,total_amount,requested_amount,status,requested_by) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','payroll_row','b1760000-0000-0000-0000-000000000002','m1',4000,1000,'waiting_approval','00000000-0000-0000-0000-00000000000a')$$);
SELECT t.denied('X09 instalment amount frozen while requested', $$UPDATE payroll SET payment_schedule = jsonb_set(payment_schedule,'{0,amount}','1500') WHERE id='b1760000-0000-0000-0000-000000000002'$$);
SELECT t.denied('requested instalment cannot be removed', $$UPDATE payroll SET payment_schedule = payment_schedule - 0 WHERE id='b1760000-0000-0000-0000-000000000002'$$);
-- the contract form re-saves the schedule without statuses: Hold is kept
UPDATE payroll SET payment_schedule = '[{"id":"m1","label":"Signing (renamed)","percent":0,"amount":1000,"status":"Pending"},{"id":"m2","label":"Mid","percent":25,"amount":null,"status":"Pending"},{"id":"m3","label":"Wrap","percent":0,"amount":2000,"status":"Pending"}]' WHERE id=:'ROK';
SELECT t.eq('form re-save keeps the request status', (SELECT payment_schedule->0->>'status'||'|'||(payment_schedule->0->>'label') FROM payroll WHERE id=:'ROK'), 'Hold|Signing (renamed)');
-- visible to approvers on Payment Approvals
SELECT t.as_user(:'D');
SELECT t.eq('B13 request is on Payment Approvals', (SELECT count(*) FROM payment_requests WHERE project_id=:'P1' AND status='waiting_approval' AND payroll_milestone_id='m1' AND source_id=:'ROK'), 1::bigint);
SELECT t.eq('admin was notified', (SELECT count(*) > 0 FROM notifications WHERE user_id=:'D' AND metadata->>'payment_request_id'='c1760000-0000-0000-0000-000000000001'), true);
SELECT t.eq('no chain: admin may act', (SELECT can_act FROM payment_request_chain_status(:'O1', :'P1') WHERE request_id='c1760000-0000-0000-0000-000000000001'), true);
SELECT t.as_user(:'A');
SELECT t.eq('requester never may act', (SELECT can_act FROM payment_request_chain_status(:'O1', :'P1') WHERE request_id='c1760000-0000-0000-0000-000000000001'), false);
SELECT t.denied('X10 requester cannot approve own request', $$SELECT approve_payment_request_step('c1760000-0000-0000-0000-000000000001')$$);
SELECT t.as_user(:'C');
SELECT t.denied('no chain: a plain member cannot approve', $$SELECT approve_payment_request_step('c1760000-0000-0000-0000-000000000001')$$);
SELECT t.as_user(:'D');
SELECT (approve_payment_request_step('c1760000-0000-0000-0000-000000000001')->>'status') AS st \gset
SELECT t.eq('admin approves', :'st'::text, 'approved');
SELECT t.eq('instalment Approved', (SELECT payment_schedule->0->>'status' FROM payroll WHERE id=:'ROK'), 'Approved');
SELECT t.denied('X09 approved request amount cannot be edited', $$UPDATE payment_requests SET requested_amount = 900 WHERE id='c1760000-0000-0000-0000-000000000001'$$);
SELECT t.denied('X09 approved request cannot go back to waiting', $$UPDATE payment_requests SET status='waiting_approval' WHERE id='c1760000-0000-0000-0000-000000000001'$$);
UPDATE payment_requests SET status='paid', payment_date='2026-10-20', payment_method='Transfer' WHERE id='c1760000-0000-0000-0000-000000000001';
SELECT t.eq('instalment Paid with the payment date', (SELECT payment_schedule->0->>'status'||'|'||(payment_schedule->0->>'paidDate') FROM payroll WHERE id=:'ROK'), 'Paid|2026-10-20');
SELECT t.eq('paid instalment reached the payments ledger', (SELECT amount FROM payments WHERE source_id=:'ROK' AND payroll_milestone_id='m1'), 1000.00);
SELECT t.as_user(:'A');
SELECT t.eq('requester notified of payment', (SELECT count(*) FROM notifications WHERE user_id=:'A' AND metadata->>'status'='paid' AND metadata->>'payment_request_id'='c1760000-0000-0000-0000-000000000001'), 1::bigint);
SELECT t.as_user(:'D');
UPDATE payroll SET payment_schedule = jsonb_set(payment_schedule,'{0,status}','"Pending"') WHERE id=:'ROK';
SELECT t.eq('paid instalment status is kept', (SELECT payment_schedule->0->>'status' FROM payroll WHERE id=:'ROK'), 'Paid');

-- ---------------------------------------------------------------- X08
SELECT t.denied('X08 a paid request cannot be deleted', $$DELETE FROM payment_requests WHERE id='c1760000-0000-0000-0000-000000000001'$$);
SELECT t.denied('X08 a paid request cannot be cancelled', $$SELECT cancel_payment_request('c1760000-0000-0000-0000-000000000001','mistake')$$);
-- reject with a reason returns the instalment
SELECT t.as_user(:'A');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,payroll_milestone_id,total_amount,requested_amount,status,requested_by,submitted_at)
VALUES ('c1760000-0000-0000-0000-000000000002',:'O1',:'P1','payroll_row',:'ROK','m2',4000,1000,'waiting_approval',:'A',now());
SELECT t.denied('X09 a requested percent instalment is frozen when the contract total changes', $$UPDATE payroll SET total_amount = 8000 WHERE id='b1760000-0000-0000-0000-000000000002'$$);
SELECT t.as_user(:'D');
SELECT t.denied('rejection needs a reason', $$SELECT reject_payment_request_step('c1760000-0000-0000-0000-000000000002','  ')$$);
SELECT reject_payment_request_step('c1760000-0000-0000-0000-000000000002', 'Missing invoice') IS NOT NULL AS rj \gset
SELECT t.eq('rejected with reason', (SELECT status||'|'||rejection_reason FROM payment_requests WHERE id='c1760000-0000-0000-0000-000000000002'), 'rejected|Missing invoice');
SELECT t.eq('rejected instalment back to Pending', (SELECT payment_schedule->1->>'status' FROM payroll WHERE id=:'ROK'), 'Pending');
RESET ROLE;
SELECT t.eq('requester sees the reason', (SELECT body LIKE '%Reason: Missing invoice' FROM notifications WHERE user_id=:'A' AND metadata->>'status'='rejected' AND metadata->>'payment_request_id'='c1760000-0000-0000-0000-000000000002'), true);
-- requester withdraws a fresh request: cancelled, recorded, not deletable
SELECT t.as_user(:'A');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,payroll_milestone_id,total_amount,requested_amount,status,requested_by,submitted_at)
VALUES ('c1760000-0000-0000-0000-000000000003',:'O1',:'P1','payroll_row',:'ROK','m2',4000,1000,'waiting_approval',:'A',now());
SELECT cancel_payment_request('c1760000-0000-0000-0000-000000000003', 'Raised twice') IS NOT NULL AS cx \gset
SELECT t.eq('X08 cancelled with who/why', (SELECT status||'|'||cancellation_reason||'|'||(cancelled_by=:'A'::uuid)::text FROM payment_requests WHERE id='c1760000-0000-0000-0000-000000000003'), 'cancelled|Raised twice|true');
SELECT t.eq('cancelled instalment back to Pending', (SELECT payment_schedule->1->>'status' FROM payroll WHERE id=:'ROK'), 'Pending');
SELECT t.as_user(:'D');
SELECT t.denied('X08 a cancelled request cannot be deleted', $$DELETE FROM payment_requests WHERE id='c1760000-0000-0000-0000-000000000003'$$);
RESET ROLE;
SELECT t.eq('X08 cancellation is in the audit trail', (SELECT count(*) > 0 FROM audit_history WHERE table_name='payment_requests' AND record_id='c1760000-0000-0000-0000-000000000003' AND operation='UPDATE'), true);

-- a legacy instalment put on Hold by hand (before 176) can still be requested
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE payroll SET payment_schedule = jsonb_set(payment_schedule,'{2,status}','"Hold"') WHERE id=:'ROK';
SELECT t.as_user(:'A');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,payroll_milestone_id,total_amount,requested_amount,status,requested_by,submitted_at)
VALUES ('c1760000-0000-0000-0000-000000000004',:'O1',:'P1','payroll_row',:'ROK','m3',4000,2000,'waiting_approval',:'A',now());
SELECT t.eq('legacy Hold instalment requested', (SELECT payment_schedule->2->>'status' FROM payroll WHERE id=:'ROK'), 'Hold');
SELECT t.denied('a paid instalment cannot be requested again', $$INSERT INTO payment_requests(organization_id,project_id,source_type,source_id,payroll_milestone_id,total_amount,requested_amount,status,requested_by) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','payroll_row','b1760000-0000-0000-0000-000000000002','m1',4000,1000,'waiting_approval','00000000-0000-0000-0000-00000000000a')$$);
RESET ROLE;

-- ---------------------------------------------------------------- D05 / X11 chain
SELECT t.eq('USD request converted at the project rate', payment_request_amount_sar(1000, 'USD', :'P1'), 3750.00);
SELECT t.eq('SAR stays SAR', payment_request_amount_sar(1000, 'SAR', :'P1'), 1000.00);
SELECT t.as_user(:'A');
SELECT t.denied('a member cannot configure the chain', $$INSERT INTO payment_approval_levels(organization_id,level_no,label,approver_kind) VALUES ('10000000-0000-0000-0000-000000000001',1,'Me','org_admin')$$);
SELECT t.as_user(:'D');
-- level 1: anyone holding role "T Viewer" (user C), all amounts; level 2: the owner (F), from 10,000 SAR
INSERT INTO payment_approval_levels(organization_id,level_no,label,min_amount_sar,approver_kind,role_id) VALUES
 (:'O1',1,'Finance check',0,'role','30000000-0000-0000-0000-000000000002'),
 (:'O1',2,'Owner sign-off',10000,'org_owner',NULL);
SELECT t.denied('a role level needs a role', $$INSERT INTO payment_approval_levels(organization_id,level_no,label,approver_kind) VALUES ('10000000-0000-0000-0000-000000000001',3,'x','role')$$);
SELECT t.as_user(:'B');
SELECT t.eq('other tenants do not see the chain', (SELECT count(*) FROM payment_approval_levels WHERE organization_id=:'O1'), 0::bigint);
SELECT t.as_user(:'A');
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,source_label,total_amount,requested_amount,currency,status,requested_by,submitted_at) VALUES
 ('c1760000-0000-0000-0000-000000000010',:'O1',:'P1','invoice','60000000-0000-0000-0000-000000000002','small',0,2000,'SAR','waiting_approval',:'A',now()),
 ('c1760000-0000-0000-0000-000000000011',:'O1',:'P1','invoice','60000000-0000-0000-0000-000000000002','large',0,20000,'SAR','waiting_approval',:'A',now()),
 ('c1760000-0000-0000-0000-000000000012',:'O1',:'P1','invoice','60000000-0000-0000-0000-000000000002','large usd',0,3000,'USD','waiting_approval',:'A',now()),
 ('c1760000-0000-0000-0000-000000000013',:'O1',:'P1','invoice','60000000-0000-0000-0000-000000000002','to reject',0,500,'SAR','waiting_approval',:'A',now());
SELECT t.eq('X11 small request needs 1 level', (SELECT required_levels FROM payment_request_chain_status(:'O1') WHERE request_id='c1760000-0000-0000-0000-000000000010'), 1);
SELECT t.eq('X11 large request needs 2 levels', (SELECT required_levels FROM payment_request_chain_status(:'O1') WHERE request_id='c1760000-0000-0000-0000-000000000011'), 2);
SELECT t.eq('X11 11,250 SAR (3,000 USD) needs 2 levels', (SELECT required_levels FROM payment_request_chain_status(:'O1') WHERE request_id='c1760000-0000-0000-0000-000000000012'), 2);
RESET ROLE;
SELECT t.eq('D05 level-1 approver notified on submit', (SELECT count(*) FROM notifications WHERE user_id=:'C' AND metadata->>'payment_request_id'='c1760000-0000-0000-0000-000000000011'), 1::bigint);
SELECT t.eq('D05 owner not notified before their turn', (SELECT count(*) FROM notifications WHERE user_id=:'F' AND metadata->>'payment_request_id'='c1760000-0000-0000-0000-000000000011'), 0::bigint);
SELECT t.as_user(:'D');
SELECT t.eq('D05 admin does not see it as their turn', (SELECT can_act FROM payment_request_chain_status(:'O1') WHERE request_id='c1760000-0000-0000-0000-000000000010'), false);
SELECT t.denied('D05 not your turn', $$SELECT approve_payment_request_step('c1760000-0000-0000-0000-000000000010')$$);
SELECT t.denied('D05 the direct status update skips the chain and is refused', $$UPDATE payment_requests SET status='approved' WHERE id='c1760000-0000-0000-0000-000000000010'$$);
SELECT t.as_user(:'C');
SELECT t.eq('D05 level-1 approver sees their turn', (SELECT can_act||'|'||next_label FROM payment_request_chain_status(:'O1') WHERE request_id='c1760000-0000-0000-0000-000000000010'), 'true|Finance check');
SELECT (approve_payment_request_step('c1760000-0000-0000-0000-000000000010')->>'status') AS s1 \gset
SELECT t.eq('X11 small request approved by one level', :'s1'::text, 'approved');
SELECT (approve_payment_request_step('c1760000-0000-0000-0000-000000000011', 'checked')->>'status') AS s2 \gset
SELECT t.eq('D05 large request still waiting after level 1', :'s2'::text, 'waiting_approval');
SELECT t.eq('D05 next is the owner', (SELECT approved_levels||'|'||next_level||'|'||next_label FROM payment_request_chain_status(:'O1') WHERE request_id='c1760000-0000-0000-0000-000000000011'), '1|2|Owner sign-off');
SELECT t.denied('X10 one person approves one level only', $$SELECT approve_payment_request_step('c1760000-0000-0000-0000-000000000011')$$);
SELECT t.as_user(:'D');
SELECT t.denied('X09 amount frozen once a level approved', $$UPDATE payment_requests SET requested_amount = 9000 WHERE id='c1760000-0000-0000-0000-000000000011'$$);
RESET ROLE;
SELECT t.eq('D05 owner notified when it is their turn', (SELECT count(*) FROM notifications WHERE user_id=:'F' AND metadata->>'payment_request_id'='c1760000-0000-0000-0000-000000000011'), 1::bigint);
SELECT t.as_user(:'F');
SELECT t.eq('D05 owner now sees their turn', (SELECT can_act FROM payment_request_chain_status(:'O1') WHERE request_id='c1760000-0000-0000-0000-000000000011'), true);
SELECT (approve_payment_request_step('c1760000-0000-0000-0000-000000000011')->>'status') AS s3 \gset
SELECT t.eq('X11 large request approved after two levels', :'s3'::text, 'approved');
SELECT t.eq('both approvals recorded in order', (SELECT string_agg(level_no||':'||level_label, ',' ORDER BY level_no) FROM payment_request_approvals WHERE payment_request_id='c1760000-0000-0000-0000-000000000011'), '1:Finance check,2:Owner sign-off');
SELECT t.denied('F cannot approve level 1 of the USD one (not the role)', $$SELECT approve_payment_request_step('c1760000-0000-0000-0000-000000000012')$$);
-- super admin E matches every level but still only one
SELECT t.as_user(:'E');
SELECT approve_payment_request_step('c1760000-0000-0000-0000-000000000012') IS NOT NULL AS e1 \gset
SELECT t.denied('X10 super admin cannot take two levels', $$SELECT approve_payment_request_step('c1760000-0000-0000-0000-000000000012')$$);
-- rejection by the approver whose turn it is
SELECT t.as_user(:'C');
SELECT reject_payment_request_step('c1760000-0000-0000-0000-000000000013', 'Wrong budget code') IS NOT NULL AS r2 \gset
SELECT t.eq('D05 rejection returns with a reason', (SELECT status||'|'||rejection_reason FROM payment_requests WHERE id='c1760000-0000-0000-0000-000000000013'), 'rejected|Wrong budget code');
SELECT t.as_user(:'B');
SELECT t.eq('other tenant sees no chain rows', (SELECT count(*) FROM payment_request_chain_status(:'O1')), 0::bigint);
SELECT t.denied('other tenant cannot approve', $$SELECT approve_payment_request_step('c1760000-0000-0000-0000-000000000012')$$);
SELECT t.as_user(:'D');
SELECT cancel_payment_request('c1760000-0000-0000-0000-000000000010', 'Duplicate of PO-1') IS NOT NULL AS c2 \gset
SELECT t.eq('X08 approved request is cancelled by an admin, not deleted', (SELECT status FROM payment_requests WHERE id='c1760000-0000-0000-0000-000000000010'), 'cancelled');

-- ---------------------------------------------------------------- B21 payroll runs
RESET ROLE;
SET session_replication_role = replica;
INSERT INTO people(id,kind,full_name,contract_status,organization_id,project_id) VALUES (:'PX','crew','Day Player','Active',:'O1',:'P1');
INSERT INTO timesheets(id,person_id,period_start,period_end) VALUES ('d1760000-0000-0000-0000-000000000001',:'POK','2026-10-01','2026-10-07'), ('d1760000-0000-0000-0000-000000000002',:'PX','2026-10-01','2026-10-07');
INSERT INTO payroll_runs(id,organization_id,project_id,label,kind,period_start,period_end,status,currency) VALUES
 ('e1760000-0000-0000-0000-000000000001',:'O1',:'P1','Week 1','crew','2026-10-01','2026-10-07','approved','SAR'),
 ('e2760000-0000-0000-0000-000000000002',:'O1',:'P1','Week 2','crew','2026-10-08','2026-10-14','approved','SAR');
INSERT INTO payroll_run_items(id,payroll_run_id,organization_id,project_id,person_id,timesheet_id,beneficiary_name,gross,net,currency) VALUES
 ('f1760000-0000-0000-0000-000000000001','e1760000-0000-0000-0000-000000000001',:'O1',:'P1',:'POK','d1760000-0000-0000-0000-000000000001','Approved Person',800,800,'SAR'),
 ('f1760000-0000-0000-0000-000000000002','e1760000-0000-0000-0000-000000000001',:'O1',:'P1',:'PX','d1760000-0000-0000-0000-000000000002','Day Player',3000,3000,'SAR'),
 ('f1760000-0000-0000-0000-000000000003','e1760000-0000-0000-0000-000000000001',:'O1',:'P1',:'POK',NULL,'Approved Person',500,500,'SAR'),
 ('f1760000-0000-0000-0000-000000000004','e2760000-0000-0000-0000-000000000002',:'O1',:'P1',:'PX','d1760000-0000-0000-0000-000000000002','Day Player',1200,1200,'SAR');
SET session_replication_role = origin;
SELECT t.as_user(:'D');
SELECT t.denied('B21 a run cannot be set to posted directly', $$UPDATE payroll_runs SET status='posted' WHERE id='e1760000-0000-0000-0000-000000000001'$$);
SELECT t.denied('B21 contract crew base pay cannot also go through a run', $$SELECT post_payroll_run('e1760000-0000-0000-0000-000000000001')$$);
DELETE FROM payroll_run_items WHERE id='f1760000-0000-0000-0000-000000000001';
SELECT (post_payroll_run('e1760000-0000-0000-0000-000000000001')->>'payment_requests') AS n_req \gset
SELECT t.eq('B21 every run line became a payment request', :'n_req'::text, '2');
SELECT t.eq('B21 run posted', (SELECT status FROM payroll_runs WHERE id='e1760000-0000-0000-0000-000000000001'), 'posted');
SELECT t.eq('B21 nothing is paid at posting', (SELECT count(*) FROM payments p JOIN payroll_run_items i ON i.payroll_id = p.source_id WHERE i.payroll_run_id='e1760000-0000-0000-0000-000000000001'), 0::bigint);
SELECT t.eq('B21 run lines wait on Payment Approvals', (SELECT count(*) FROM payment_requests q JOIN payroll_run_items i ON i.payroll_id = q.source_id WHERE i.payroll_run_id='e1760000-0000-0000-0000-000000000001' AND q.status='waiting_approval' AND q.payroll_milestone_id='run'), 2::bigint);
SELECT t.denied('B21 a run is posted once', $$SELECT post_payroll_run('e1760000-0000-0000-0000-000000000001')$$);
SELECT q.id AS run_req FROM payment_requests q JOIN payroll_run_items i ON i.payroll_id = q.source_id WHERE i.id='f1760000-0000-0000-0000-000000000002' \gset
SELECT t.denied('the poster cannot approve the run line', format('SELECT approve_payment_request_step(%L)', :'run_req'));
SELECT t.as_user(:'C');
SELECT approve_payment_request_step(:'run_req') IS NOT NULL AS ok1 \gset
SELECT t.as_user(:'D');
UPDATE payment_requests SET status='paid', payment_date='2026-10-09', payment_method='Transfer' WHERE id=:'run_req';
SELECT t.eq('B21 a paid run line reaches the payments ledger once', (SELECT sum(p.amount) FROM payments p JOIN payroll_run_items i ON i.payroll_id = p.source_id WHERE i.id='f1760000-0000-0000-0000-000000000002'), 3000.00);
SELECT t.denied('B21 a run with paid lines cannot be reversed', $$SELECT reverse_payroll_run('e1760000-0000-0000-0000-000000000001','oops')$$);
SELECT post_payroll_run('e2760000-0000-0000-0000-000000000002') IS NOT NULL AS p2 \gset
SELECT reverse_payroll_run('e2760000-0000-0000-0000-000000000002','wrong week')->>'requests_cancelled' AS rc \gset
SELECT t.eq('B21 reversing cancels the open requests', :'rc'::text, '1');
SELECT t.eq('B21 reversed run leaves nothing to pay', (SELECT count(*) FROM payroll WHERE ref_id LIKE 'PR-e2760000-%' AND jsonb_array_length(payment_schedule) > 0), 0::bigint);
RESET ROLE;
ROLLBACK;
