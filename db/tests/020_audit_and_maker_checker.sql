\set A '00000000-0000-0000-0000-00000000000a'
\set D '00000000-0000-0000-0000-00000000000d'
\set PR '80000000-0000-0000-0000-000000000001'
-- D06: requester A may not approve own request, even if A were an admin
SELECT t.as_user(:'D');
UPDATE payment_requests SET status='approved', approved_by='00000000-0000-0000-0000-00000000000a', approved_at='2000-01-01' WHERE id=:'PR';
SELECT t.eq('admin D approves A''s request; approved_by is the real approver, not the client value', (SELECT approved_by FROM payment_requests WHERE id=:'PR'), :'D'::uuid);
SELECT t.eq('approved_at stamped by the database, not the client', (SELECT approved_at > now() - interval '1 minute' FROM payment_requests WHERE id=:'PR'), true);
SELECT t.denied('approved request amount is frozen', $$UPDATE payment_requests SET requested_amount = 5 WHERE id='80000000-0000-0000-0000-000000000001'$$);
SELECT t.denied('approval stamp cannot be rewritten', $$UPDATE payment_requests SET approved_by = '00000000-0000-0000-0000-00000000000a' WHERE id='80000000-0000-0000-0000-000000000001'$$);
UPDATE payment_requests SET status='paid', payment_date=current_date, payment_method='Transfer' WHERE id=:'PR';
SELECT t.eq('marking paid from approved works and is stamped', (SELECT executed_by FROM payment_requests WHERE id=:'PR'), :'D'::uuid);
RESET ROLE;
-- a request raised by admin D himself
SET session_replication_role = replica;
INSERT INTO payment_requests(id,organization_id,project_id,source_type,source_id,total_amount,requested_amount,currency,status,requested_by)
VALUES ('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','invoice','60000000-0000-0000-0000-000000000002',1200,500,'SAR','waiting_approval',:'D'),
       ('80000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','invoice','60000000-0000-0000-0000-000000000002',1200,100,'SAR','draft',:'D');
SET session_replication_role = origin;
SELECT t.as_user(:'D');
SELECT t.denied('maker cannot approve own request', $$UPDATE payment_requests SET status='approved' WHERE id='80000000-0000-0000-0000-000000000002'$$);
SELECT t.eq('own request still waiting', (SELECT status FROM payment_requests WHERE id='80000000-0000-0000-0000-000000000002'), 'waiting_approval');
SELECT t.denied('cannot jump draft -> approved', $$UPDATE payment_requests SET status='approved' WHERE id='80000000-0000-0000-0000-000000000003'$$);
SELECT t.denied('cannot jump waiting -> paid', $$UPDATE payment_requests SET status='paid' WHERE id='80000000-0000-0000-0000-000000000002'$$);
UPDATE payment_requests SET requested_amount=150 WHERE id='80000000-0000-0000-0000-000000000003';
SELECT t.eq('maker may still edit own draft', (SELECT requested_amount FROM payment_requests WHERE id='80000000-0000-0000-0000-000000000003'), 150.00);
RESET ROLE;
-- D05: the previously un-audited tables now leave a trail with before/after values
SELECT t.eq('payment_requests approval audited with old/new', (SELECT count(*) FROM audit_history WHERE table_name='payment_requests' AND operation='UPDATE' AND record_id=:'PR' AND changed_fields ? 'status'), 2::bigint);
SELECT t.eq('audit row carries org and project', (SELECT count(*) FROM audit_history WHERE table_name='payment_requests' AND (organization_id IS NULL OR project_id IS NULL)), 0::bigint);
SELECT t.eq('audit row carries the actor', (SELECT actor_id FROM audit_history WHERE table_name='payment_requests' AND record_id=:'PR' ORDER BY created_at LIMIT 1), :'D'::uuid);
INSERT INTO user_roles(user_id, role) VALUES (:'A', 'manager');
SELECT t.eq('role grant audited', (SELECT count(*) FROM audit_history WHERE table_name='user_roles' AND operation='INSERT'), 1::bigint);
DELETE FROM user_roles WHERE user_id = :'A';
SELECT t.eq('role removal audited', (SELECT count(*) FROM audit_history WHERE table_name='user_roles' AND operation='DELETE'), 1::bigint);
SELECT t.eq('no table got the audit trigger twice', (SELECT count(*) FROM (SELECT tg.tgrelid FROM pg_trigger tg JOIN pg_proc p ON p.oid=tg.tgfoid WHERE p.proname='log_audit_history' AND NOT tg.tgisinternal GROUP BY 1 HAVING count(*)>1) x), 0::bigint);
