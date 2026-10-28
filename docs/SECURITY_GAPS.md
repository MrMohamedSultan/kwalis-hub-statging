# Security policy vs. reality — gap list (X05)

Compared: `SECURITY.md` (the only written security / tenant-isolation policy in
the repo; the client's information-security policy files are not in the repo)
against the code, `supabase/migrations`, the live schema dump and `db/pending`.
State: branch `wave-platform` (2026-10-28). "Fixed in 195" = needs
`db/pending/195_platform.sql` applied (owner approval) and this branch deployed.

| # | Policy says | Reality | Status |
|---|-------------|---------|--------|
| 1 | Users of one org never see another org; project members never see unassigned projects (§4) | RLS uses `can_access_project` / `is_org_member` on every money table. **But `payment_requests` SELECT and INSERT policies only checked org membership**: any member could read (and raise) payment requests of every project in the org. Proven by `db/tests/195_platform.sql` (D06). | Fixed in 195 §8 (RLS change — approve) |
| 2 | Same | Storage policy `"Org members can read contracts"` lets every org member read every file in the `contracts` bucket, across projects. Files are only safe from other orgs. | Open — proposed (commented) in 195 §2; first move old files that are not under a `{project_id}/` folder |
| 3 | Same | Old app versions saved per-diem receipts, payroll proofs and payment-request proofs under `per-diem/…`, `payroll/…`, `payment_requests/…` (no project folder), and location contracts under `locations/{project}/…`. | New uploads fixed (all under `{project_id}/…`); old objects need a one-off move |
| 4 | Privilege escalation via localStorage must never happen (§4); lockout logged (§3) | Login lockout lived in localStorage. | Fixed in 195 + app (server counters, GoTrue hook) |
| 5 | Same | Project lock was localStorage. | Fixed earlier (184) |
| 6 | Same | Film Commission "supporting document" links lived in localStorage only. | Fixed in 195 + app (D08) |
| 7 | — (policy silent) | Two-step verification did not exist. | Added (TOTP, per user, enforceable per org). **Gap:** enforcement is in the app (redirect to enrolment); RLS does not check the session's `aal`. A user of a 2FA org with a valid password can still call the REST API with an aal1 token. Add `auth.jwt()->>'aal' = 'aal2'` checks to `is_org_member` if the client needs hard enforcement. |
| 8 | Org admins manage their org; plan limits are platform business | Policy "Org admins update orgs" let an org admin raise `max_projects` / change `subscription_status` of their own org; the project limit was checked in the UI only. | Fixed in 195 (trigger guard + insert limit) |
| 9 | Uploaded files never public; validated input (§6.1) | All buckets private (signed URLs). No size/type limit on buckets; client checks only on two screens; `locations.tsx` used `getPublicUrl` on a private bucket. | Fixed: 20 MB / document+image list in every upload path and on the bucket rows (195 §2) |
| 10 | Every `createServerFn` has a zod `inputValidator` (§3) | New functions comply. Not re-audited for older functions in this batch. | Check in a later sweep |
| 11 | `/api/public/*` verify a secret in constant time (§3) | `ai-job` and the new `notifications-dispatch` comply. | OK |
| 12 | Rate limiting: "no improvised implementation without explicit request" (§6.4) | X02 explicitly asked for a server lockout; implemented in the database. | Update §6.4 to mention `login_throttle` |
| 13 | Approval workflow: security changes proposed, applied after approval (§1) | Pending files are applied by the owner. | OK — 195 flagged sections: §2 (bucket limits), §8 (RLS) |
| 14 | Regression tests `scripts/rls-regression.mjs` in CI (§5) | They skip without credentials; the reliable proof is the local DB suite `db/tests/run.sh` (incl. D06 cross-project test). | Update §5 to name `db/tests` |
| 15 | Backups (not in policy) | No documented backup schedule or encryption. | See `docs/BACKUP_RESTORE.md`; add a line to the policy |
| 16 | Monitoring (not in policy) | No health endpoint or alerting. | `/api/health` + `docs/MONITORING.md` |
| 17 | Terms / privacy | No pages. | Draft pages `/terms`, `/privacy` (legal review needed) |

## Before sharing SECURITY.md with the client
1. Apply 195 (after review) and deploy this branch.
2. Decide item 2 (contracts bucket policy) and item 7 (hard 2FA enforcement).
3. Add to SECURITY.md: login lockout (`login_throttle` + GoTrue hook env vars),
   2FA, upload limits, backups, monitoring, and that the test suite is `db/tests`.
