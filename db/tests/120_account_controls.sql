\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-00000000000d'
\set E '00000000-0000-0000-0000-00000000000e'
\set O1 '10000000-0000-0000-0000-000000000001'
\set O2 '10000000-0000-0000-0000-000000000002'
-- only the platform owner may use the admin functions
SELECT t.as_user(:'D');
SELECT t.denied('org admin cannot disable users', $$SELECT admin_disable_user('00000000-0000-0000-0000-00000000000a')$$);
SELECT t.denied('org admin cannot force logout', $$SELECT admin_force_logout('00000000-0000-0000-0000-00000000000a')$$);
SELECT t.denied('org admin cannot suspend a company', $$SELECT admin_suspend_company('10000000-0000-0000-0000-000000000001', true, 'Org One')$$);
SELECT t.denied('nobody writes the controls table directly', $$INSERT INTO user_account_controls(user_id, disabled) VALUES ('00000000-0000-0000-0000-00000000000a', true)$$);
SELECT t.as_user(:'A');
SELECT t.eq('fresh account: not disabled, nothing required', (SELECT disabled::text||must_change_password::text||all_orgs_suspended::text FROM my_account_status()), 'falsefalsefalse');
-- disable / enable
SELECT t.as_user(:'E');
SELECT t.denied('cannot disable yourself', $$SELECT admin_disable_user('00000000-0000-0000-0000-00000000000e')$$);
SELECT t.denied('unknown user rejected', $$SELECT admin_disable_user('99999999-9999-9999-9999-999999999999')$$);
SELECT t.eq('disable records who and why', (SELECT disabled::text||'|'||disabled_reason||'|'||(disabled_by = :'E'::uuid)::text FROM admin_disable_user(:'A', true, ' Left the company ')), 'true|Left the company|true');
SELECT t.as_user(:'A');
SELECT t.eq('the disabled user sees it at the gate', (SELECT disabled FROM my_account_status()), true);
SELECT t.eq('disabling also revokes open sessions', (SELECT sessions_revoked_at > now() - interval '1 minute' FROM my_account_status()), true);
SELECT t.eq('a user reads only their own control row', (SELECT count(*) FROM user_account_controls), 1::bigint);
SELECT t.as_user(:'C');
SELECT t.eq('other users cannot see it', (SELECT count(*) FROM user_account_controls), 0::bigint);
SELECT t.as_user(:'E');
SELECT t.eq('enable clears the flag and the reason', (SELECT disabled::text||'|'||coalesce(disabled_reason,'-') FROM admin_disable_user(:'A', false)), 'false|-');
-- force logout
SELECT admin_force_logout(:'C') AS revoked_at \gset
SELECT t.as_user(:'C');
SELECT t.eq('force logout stamps the revocation time', (SELECT sessions_revoked_at FROM my_account_status()), :'revoked_at'::timestamptz);
-- D08: must change password
SELECT t.as_user(:'D');
SELECT t.eq('org admin flags a member of their org', public.admin_require_password_change(:'C', true), true);
SELECT t.denied('org admin cannot flag a user of another org', $$SELECT admin_require_password_change('00000000-0000-0000-0000-00000000000b', true)$$);
SELECT t.as_user(:'C');
SELECT t.eq('gate sees the requirement', (SELECT must_change_password FROM my_account_status()), true);
SELECT public.clear_my_password_change_requirement();
SELECT t.eq('user clears own flag after changing the password', (SELECT must_change_password FROM my_account_status()), false);
SELECT t.as_user(:'A');
SELECT t.denied('a member cannot flag someone else', $$SELECT admin_require_password_change('00000000-0000-0000-0000-00000000000c', true)$$);
-- suspend company
SELECT t.as_user(:'E');
SELECT t.denied('suspension needs the exact company name', $$SELECT admin_suspend_company('10000000-0000-0000-0000-000000000002', true, 'wrong name')$$);
SELECT t.eq('suspend with the typed name', public.admin_suspend_company(:'O2', true, ' org two '), 'suspended');
SELECT t.as_user(:'B');
SELECT t.eq('member of the suspended company is blocked at the gate', (SELECT all_orgs_suspended::text||'|'||array_length(suspended_org_ids,1)::text FROM my_account_status()), 'true|1');
SELECT t.as_user(:'A');
SELECT t.eq('other companies are unaffected', (SELECT all_orgs_suspended FROM my_account_status()), false);
SELECT t.as_user(:'E');
SELECT t.eq('reactivate needs no typed name', public.admin_suspend_company(:'O2', false), 'active');
SELECT t.eq('platform owner is never blocked by a suspension', (SELECT all_orgs_suspended FROM my_account_status()), false);
RESET ROLE;
SELECT t.eq('suspension and reactivation are in the audit log', (SELECT count(*) FROM audit_logs WHERE action IN ('company.suspended','company.reactivated') AND organization_id=:'O2'), 2::bigint);
SELECT t.eq('account control changes are audited', (SELECT count(*) > 3 FROM audit_history WHERE table_name='user_account_controls'), true);
SELECT t.eq('company status change is in the row audit too (D05)', (SELECT count(*) FROM audit_history WHERE table_name='organizations' AND changed_fields ? 'subscription_status'), 2::bigint);
-- last super admin guard
SELECT t.as_user(:'E');
SELECT t.denied('the last super admin cannot delete their own role', $$DELETE FROM user_roles WHERE user_id='00000000-0000-0000-0000-00000000000e'$$);
SELECT t.denied('...nor downgrade it', $$UPDATE user_roles SET role='member' WHERE user_id='00000000-0000-0000-0000-00000000000e'$$);
RESET ROLE;
SELECT t.denied('even a privileged session is refused', $$DELETE FROM user_roles WHERE role='super_admin'$$);
INSERT INTO user_roles(user_id, role) VALUES (:'D', 'super_admin');
SELECT t.as_user(:'E');
DELETE FROM user_roles WHERE user_id = :'D' AND role = 'super_admin';
SELECT t.eq('with two owners, one can be removed', (SELECT count(*) FROM user_roles WHERE role='super_admin'), 1::bigint);
SELECT t.denied('cannot disable the last ACTIVE super admin (self)', $$SELECT admin_disable_user('00000000-0000-0000-0000-00000000000e')$$);
RESET ROLE;
