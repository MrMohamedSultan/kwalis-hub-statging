GRANT USAGE ON SCHEMA t TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO service_role;
-- Supabase grants this on a real project; the local stub does not.
GRANT SELECT ON storage.objects TO authenticated;
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-00000000000d'
\set E '00000000-0000-0000-0000-00000000000e'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P1 '20000000-0000-0000-0000-000000000001'
\set P3 'a1950000-0000-0000-0000-000000000300'
\set INV '60000000-0000-0000-0000-000000000001'

-- =====================================================================
-- X02 — server-side lockout
-- =====================================================================
SELECT t.eq('not locked at start', (SELECT locked FROM login_throttle_check('acct@org1.test', '10.0.0.1')), false);
SELECT login_throttle_record('ACCT@org1.test', '10.0.0.1', false) FROM generate_series(1, 4);
SELECT t.eq('4 failures: no lock yet', (SELECT locked FROM login_throttle_check('acct@org1.test', '10.0.0.1')), false);
SELECT t.eq('5th failure locks for 2 minutes', (SELECT lock_minutes FROM login_throttle_record('acct@org1.test', '10.0.0.1', false)), 2);
SELECT t.eq('locked (any case of e-mail)', (SELECT locked FROM login_throttle_check('Acct@Org1.test', '10.9.9.9')), true);
SELECT t.eq('counter is 5', (SELECT failed_count FROM login_throttle_check('acct@org1.test', NULL)), 5);
SELECT t.eq('other e-mail from another IP is free', (SELECT locked FROM login_throttle_check('user@org2.test', '10.0.0.2')), false);
-- success clears the e-mail counter, the IP counter stays
SELECT login_throttle_record('acct@org1.test', '10.0.0.1', true);
SELECT t.eq('success clears the e-mail lock', (SELECT locked FROM login_throttle_check('acct@org1.test', NULL)), false);
SELECT t.eq('IP counter kept', (SELECT failed_count FROM login_throttle WHERE key = 'ip:10.0.0.1'), 5);
-- 20 failures from one IP lock that IP for any e-mail
SELECT login_throttle_record('x' || g || '@spray.test', '10.0.0.7', false) FROM generate_series(1, 20) g;
SELECT t.eq('IP spraying locks the IP', (SELECT locked FROM login_throttle_check('fresh@spray.test', '10.0.0.7')), true);
-- the app roles cannot call or read it
SELECT t.as_user(:'A');
SELECT t.denied('authenticated cannot reset a counter', $$SELECT public.login_throttle_record('acct@org1.test','1.1.1.1',true)$$);
SELECT t.denied('authenticated cannot check', $$SELECT public.login_throttle_check('acct@org1.test','1.1.1.1')$$);
SELECT t.eq('non-admin cannot read counters', (SELECT count(*) FROM login_throttle), 0::bigint);
RESET ROLE;
SET ROLE anon;
SELECT t.denied('anon cannot call the hook', $$SELECT public.hook_password_verification_attempt('{"user_id":"00000000-0000-0000-0000-00000000000a","valid":true}')$$);
RESET ROLE;
SELECT t.as_user(:'E');
SELECT t.eq('super admin reads counters', (SELECT count(*) > 0 FROM login_throttle), true);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
-- GoTrue hook: per user id
SELECT public.hook_password_verification_attempt(jsonb_build_object('user_id', :'B', 'valid', false)) FROM generate_series(1, 5);
SELECT t.eq('hook rejects a correct password while locked',
  public.hook_password_verification_attempt(jsonb_build_object('user_id', :'B', 'valid', true)) ->> 'decision', 'reject');
SELECT t.eq('server check sees the user lock too', (SELECT locked FROM login_throttle_check('user@org2.test', NULL)), true);
-- super admin force unlock (existing admin_unlock event) clears it
INSERT INTO auth_security_log(event_type, email, admin_unlocked, unlocked_by, unlocked_at)
VALUES ('admin_unlock', 'user@org2.test', true, :'E', now());
SELECT t.eq('admin unlock clears the user lock', (SELECT locked FROM login_throttle_check('user@org2.test', NULL)), false);
SELECT t.eq('hook continues after unlock',
  public.hook_password_verification_attempt(jsonb_build_object('user_id', :'B', 'valid', true)) ->> 'decision', 'continue');

-- per organization 2FA switch
SELECT t.as_user(:'C');
SELECT t.denied('member cannot require 2FA', format('SELECT public.set_org_require_mfa(%L, true)', :'O1'));
SELECT t.eq('not required yet', public.my_mfa_required(), false);
SELECT t.as_user(:'D');
SELECT public.set_org_require_mfa(:'O1', true);
SELECT t.as_user(:'A');
SELECT t.eq('member of a 2FA org must use it', public.my_mfa_required(), true);
SELECT t.as_user(:'B');
SELECT t.eq('other org not affected', public.my_mfa_required(), false);
RESET ROLE;
UPDATE organizations SET require_mfa = false WHERE id = :'O1';

-- =====================================================================
-- X24 — e-mail outbox
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO notifications(organization_id, project_id, user_id, severity, category, title, body)
VALUES (:'O1', :'P1', :'A', 'info', 'payment_approval', 'T195 payment request approved', 'Casting agency — SAR 1,000.00');
INSERT INTO notifications(organization_id, project_id, user_id, severity, category, title, body)
VALUES (:'O1', :'P1', :'A', 'info', 'system', 'Not mailed', NULL);
SELECT t.eq('approval notification queued with the user e-mail',
  (SELECT to_email FROM notification_email_outbox WHERE subject LIKE '%T195 payment%'), 'acct@org1.test');
SELECT t.eq('system notification not mailed', (SELECT count(*) FROM notification_email_outbox WHERE subject LIKE '%Not mailed%'), 0::bigint);
SET ROLE service_role;
SELECT t.eq('dispatcher claims it', (SELECT count(*) FROM claim_notification_emails(50) WHERE subject LIKE '%T195 payment%'), 1::bigint);
SELECT t.eq('claimed rows are not handed out twice', (SELECT count(*) FROM claim_notification_emails(50) WHERE subject LIKE '%T195 payment%'), 0::bigint);
SELECT mark_notification_email(id, true) FROM notification_email_outbox WHERE subject LIKE '%T195 payment%';
RESET ROLE;
SELECT t.eq('marked sent', (SELECT status FROM notification_email_outbox WHERE subject LIKE '%T195 payment%'), 'sent');
SELECT t.as_user(:'A');
SELECT t.denied('a user cannot claim e-mails', $$SELECT * FROM public.claim_notification_emails(5)$$);
SELECT t.eq('user sees own outbox rows', (SELECT count(*) > 0 FROM notification_email_outbox), true);
SELECT t.as_user(:'B');
SELECT t.eq('other tenant sees none', (SELECT count(*) FROM notification_email_outbox), 0::bigint);
RESET ROLE;

-- =====================================================================
-- D04 — overspend alerts at 80 % and 100 %
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '', false);
CREATE TEMP TABLE pos AS
  SELECT budget_sar, actual_sar + committed_sar AS spent FROM v_budget_code_position
   WHERE project_id = :'P1' AND budget_code = '1403';
GRANT SELECT ON pos TO authenticated;
-- bring 1403 to 85 % with one invoice
INSERT INTO invoices(id, description, budget_code, price, vat_amount, date, organization_id, project_id)
SELECT 'a1950000-0000-0000-0000-000000000001', 'Alert test 85%', '1403',
       GREATEST(round(budget_sar * 0.85 - spent, 2), 0), 0, '2026-10-01', :'O1', :'P1' FROM pos;
SELECT t.as_user(:'A');
SELECT t.eq('80% crossing notifies (owner A + org admin D)', public.run_budget_alerts(:'P1') >= 2, true);
SELECT t.eq('second run does not repeat', public.run_budget_alerts(:'P1'), 0);
SELECT t.eq('A got the 80% alert', (SELECT (metadata ->> 'threshold')::int FROM notifications
  WHERE user_id = :'A' AND category = 'budget_alert' AND metadata ->> 'budget_code' = '1403' ORDER BY created_at DESC LIMIT 1), 80);
RESET ROLE;
SELECT t.eq('80% alert is queued for e-mail', (SELECT count(*) >= 1 FROM notification_email_outbox WHERE category = 'budget_alert'), true);
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE invoices SET price = price + (SELECT budget_sar * 0.2 FROM pos) WHERE id = 'a1950000-0000-0000-0000-000000000001';
-- a named responsible person replaces the default recipients
INSERT INTO budget_alert_responsibles(organization_id, project_id, budget_code, user_id) VALUES (:'O1', :'P1', '1403', :'C');
SELECT t.as_user(:'C');
SELECT t.eq('100% crossing: one alert to the responsible user', public.run_budget_alerts(:'P1'), 1);
SELECT t.eq('C got the 100% alert', (SELECT (metadata ->> 'threshold')::int FROM notifications WHERE user_id = :'C' AND category = 'budget_alert'), 100);
SELECT t.denied('member cannot add a responsible', format($$INSERT INTO budget_alert_responsibles(organization_id, project_id, budget_code, user_id) VALUES (%L, %L, '1101', %L)$$, :'O1', :'P1', :'C'));
SELECT t.as_user(:'B');
SELECT t.denied('other tenant cannot run alerts on P1', format('SELECT public.run_budget_alerts(%L)', :'P1'));
RESET ROLE;
-- dropping back under 80 % re-arms both thresholds
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE invoices SET price = 0 WHERE id = 'a1950000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT public.run_budget_alerts(NULL);
RESET ROLE;
SELECT t.eq('re-armed', (SELECT count(*) FROM budget_alert_log WHERE project_id = :'P1' AND budget_code = '1403'), 0::bigint);
DELETE FROM invoices WHERE id = 'a1950000-0000-0000-0000-000000000001';
DELETE FROM budget_alert_responsibles;

-- =====================================================================
-- X13 — per diem total
-- =====================================================================
INSERT INTO people(id, kind, full_name, project_id, organization_id) VALUES ('a1950000-0000-0000-0000-0000000000f1', 'crew', 'Per Diem Person', :'P1', :'O1');
INSERT INTO per_diem_ledger(id, organization_id, project_id, person_id, period_start, period_end, on_set_rate, off_set_rate, shoot_days, off_days, total_amount, currency, budget_code)
VALUES ('a1950000-0000-0000-0000-0000000000d1', :'O1', :'P1', 'a1950000-0000-0000-0000-0000000000f1', '2026-10-01', '2026-10-07', 150, 300, 5, 2, 1, 'SAR', '1403');
SELECT t.eq('total = 5x150 + 2x300', (SELECT total_amount FROM per_diem_ledger WHERE id = 'a1950000-0000-0000-0000-0000000000d1'), 1350.00);
UPDATE per_diem_ledger SET shoot_days = 6 WHERE id = 'a1950000-0000-0000-0000-0000000000d1';
SELECT t.eq('total follows the days', (SELECT total_amount FROM per_diem_ledger WHERE id = 'a1950000-0000-0000-0000-0000000000d1'), 1500.00);
UPDATE per_diem_ledger SET total_amount = 99 WHERE id = 'a1950000-0000-0000-0000-0000000000d1';
SELECT t.eq('a typed total cannot drift', (SELECT total_amount FROM per_diem_ledger WHERE id = 'a1950000-0000-0000-0000-0000000000d1'), 1500.00);
SELECT t.eq('ledger view carries the same total', (SELECT amount FROM v_ledger_transactions WHERE source_type = 'per_diem' AND source_id = 'a1950000-0000-0000-0000-0000000000d1'), 1500.00);
DELETE FROM per_diem_ledger WHERE id = 'a1950000-0000-0000-0000-0000000000d1';

-- =====================================================================
-- X27 — project counts and the plan limit
-- =====================================================================
SELECT t.as_user(:'E');
SELECT t.eq('platform owner sees every organization', (SELECT count(*) FROM v_org_project_counts) >= 2, true);
SELECT t.eq('billable = active + finalized', (SELECT bool_and(billable_projects = active_projects + finalized_projects) FROM v_org_project_counts), true);
SELECT t.as_user(:'A');
SELECT t.eq('member sees only own organization', (SELECT count(*) FROM v_org_project_counts), 1::bigint);
SELECT t.as_user(:'D');
SELECT t.denied('org admin cannot raise own limit', format('UPDATE organizations SET max_projects = 99 WHERE id = %L', :'O1'));
UPDATE organizations SET notes = 'edited by org admin' WHERE id = :'O1';
SELECT t.eq('org admin can still edit other fields', (SELECT notes FROM organizations WHERE id = :'O1'), 'edited by org admin');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE organizations SET max_projects = (SELECT billable_projects FROM v_org_project_counts WHERE organization_id = :'O1') WHERE id = :'O1';
SELECT t.as_user(:'D');
SELECT t.denied('project over the plan limit refused', format($$INSERT INTO projects(owner_id, name, code, organization_id, currency, status) VALUES (%L, 'Over limit', 'OVR1', %L, 'SAR', 'Planning')$$, :'D', :'O1'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE organizations SET max_projects = 50 WHERE id = :'O1';

-- =====================================================================
-- D08 — supporting document links + attachment archive
-- =====================================================================
SELECT t.as_user(:'A');
SELECT public.set_supporting_doc_link('invoice', :'INV', 'https://drive.example.com/inv-1.pdf');
SELECT t.eq('link stored with the invoice project', (SELECT project_id::text FROM supporting_document_links WHERE source_id = :'INV'), :'P1');
SELECT t.eq('archive lists the link', (SELECT count(*) FROM v_project_attachments WHERE project_id = :'P1' AND external_url = 'https://drive.example.com/inv-1.pdf'), 1::bigint);
SELECT t.denied('javascript: link refused', format($$SELECT public.set_supporting_doc_link('invoice', %L, 'javascript:alert(1)')$$, :'INV'));
SELECT t.as_user(:'B');
SELECT t.denied('other tenant cannot attach to P1 invoice', format($$SELECT public.set_supporting_doc_link('invoice', %L, 'https://evil.example.com')$$, :'INV'));
SELECT t.eq('other tenant sees no P1 attachments', (SELECT count(*) FROM v_project_attachments WHERE project_id = :'P1'), 0::bigint);
SELECT t.as_user(:'A');
SELECT public.set_supporting_doc_link('invoice', :'INV', '');
SELECT t.eq('empty link clears it', (SELECT count(*) FROM supporting_document_links WHERE source_id = :'INV'), 0::bigint);
RESET ROLE;

-- =====================================================================
-- D06 — a limited user on one project cannot reach another project of
--       the SAME organization (server side, every money table)
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '', false);
SET session_replication_role = replica;
INSERT INTO projects(id, owner_id, name, code, organization_id, currency, fx_rate, status) VALUES
 (:'P3', :'D', 'Second production', 'SEC26', :'O1', 'SAR', 1, 'Production');
INSERT INTO project_members(project_id, user_id) VALUES (:'P3', :'D');
INSERT INTO invoices(id, description, budget_code, price, vat_amount, date, organization_id, project_id) VALUES
 ('a1950000-0000-0000-0000-0000000003a1', 'P3 invoice', '1403', 4321, 0, '2026-10-02', :'O1', :'P3');
INSERT INTO payroll(id, name, kind, total_amount, budget_code, organization_id, project_id) VALUES
 ('a1950000-0000-0000-0000-0000000003b1', 'P3 crew', 'crew', 9876, '1403', :'O1', :'P3');
INSERT INTO payments(organization_id, project_id, source_type, source_id, amount, payment_date) VALUES
 (:'O1', :'P3', 'payroll', 'a1950000-0000-0000-0000-0000000003b1', 1111, '2026-10-03');
INSERT INTO purchase_orders(id, po_number, vendor_name, budget_code, amount, status, date, organization_id, project_id) VALUES
 ('a1950000-0000-0000-0000-0000000003c1', 'P3-PO', 'Vendor', '1403', 500, 'approved', '2026-10-01', :'O1', :'P3');
INSERT INTO per_diem_ledger(organization_id, project_id, person_id, period_start, period_end, on_set_rate, shoot_days, currency) VALUES
 (:'O1', :'P3', 'a1950000-0000-0000-0000-0000000000f1', '2026-10-01', '2026-10-02', 100, 2, 'SAR');
INSERT INTO cash_advance_receipts(id, recipient, amount, date, organization_id, project_id, budget_code, status, description) VALUES
 ('a1950000-0000-0000-0000-0000000003d1', 'P3 runner', 70, '2026-10-02', :'O1', :'P3', '1403', 'approved', 'P3 taxi');
INSERT INTO payment_requests(organization_id, project_id, source_type, source_id, source_label, total_amount, requested_amount, currency, status, requested_by) VALUES
 (:'O1', :'P3', 'invoice', 'a1950000-0000-0000-0000-0000000003a1', 'P3 invoice', 4321, 4321, 'SAR', 'waiting_approval', :'D');
SET session_replication_role = origin;
SELECT t.as_user(:'C');
SELECT t.eq('control: C sees own project invoices', (SELECT count(*) > 0 FROM invoices WHERE project_id = :'P1'), true);
SELECT t.eq('C reads no P3 invoices', (SELECT count(*) FROM invoices WHERE project_id = :'P3'), 0::bigint);
SELECT t.eq('C reads no P3 payroll', (SELECT count(*) FROM payroll WHERE project_id = :'P3'), 0::bigint);
SELECT t.eq('C reads no P3 payments', (SELECT count(*) FROM payments WHERE project_id = :'P3'), 0::bigint);
SELECT t.eq('C reads no P3 purchase orders', (SELECT count(*) FROM purchase_orders WHERE project_id = :'P3'), 0::bigint);
SELECT t.eq('C reads no P3 per diem', (SELECT count(*) FROM per_diem_ledger WHERE project_id = :'P3'), 0::bigint);
SELECT t.eq('C reads no P3 petty cash', (SELECT count(*) FROM cash_advance_receipts WHERE project_id = :'P3'), 0::bigint);
SELECT t.eq('C reads no P3 payment requests', (SELECT count(*) FROM payment_requests WHERE project_id = :'P3'), 0::bigint);
SELECT t.eq('C reads no P3 ledger rows', (SELECT count(*) FROM v_ledger_transactions WHERE project_id = :'P3'), 0::bigint);
SELECT t.eq('C reads no P3 budget position', (SELECT count(*) FROM v_budget_code_position WHERE project_id = :'P3'), 0::bigint);
SELECT t.eq('C reads no P3 journal lines', (SELECT count(*) FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id WHERE e.project_id = :'P3'), 0::bigint);
SELECT t.denied('C cannot insert an invoice into P3', format($$INSERT INTO invoices(description, price, date, organization_id, project_id) VALUES ('x', 1, '2026-10-05', %L, %L)$$, :'O1', :'P3'));
SELECT t.denied('C cannot edit a P3 invoice', $$UPDATE invoices SET price = 1 WHERE id = 'a1950000-0000-0000-0000-0000000003a1'$$);
SELECT t.denied('C cannot delete P3 payroll', $$DELETE FROM payroll WHERE id = 'a1950000-0000-0000-0000-0000000003b1'$$);
SELECT t.denied('C cannot move own invoice into P3', format($$UPDATE invoices SET project_id = %L WHERE project_id = %L$$, :'P3', :'P1'));
SELECT t.denied('C cannot pay into P3', format($$INSERT INTO payments(organization_id, project_id, source_type, source_id, amount, payment_date) VALUES (%L, %L, 'invoice', 'a1950000-0000-0000-0000-0000000003a1', 5, '2026-10-05')$$, :'O1', :'P3'));
SELECT t.denied('C cannot read the P3 trial balance', format($$SELECT * FROM public.get_trial_balance(%L, NULL, NULL)$$, :'P3'));
SELECT t.denied('C cannot run P3 budget alerts', format('SELECT public.run_budget_alerts(%L)', :'P3'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.eq('P3 data untouched', (SELECT price FROM invoices WHERE id = 'a1950000-0000-0000-0000-0000000003a1'), 4321::numeric);
SELECT t.as_user(:'D');
SELECT t.eq('control: D (member of P3) sees it', (SELECT count(*) FROM invoices WHERE project_id = :'P3'), 1::bigint);
RESET ROLE;
