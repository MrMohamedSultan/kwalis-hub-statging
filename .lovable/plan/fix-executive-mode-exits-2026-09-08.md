# Fix executive-mode exits

## Scope
- Repair the executive header sign-out action so it clears protected cached state, ends the session, and replaces the current page with `/auth`.
- Add a bilingual “Return to work mode” action only when the signed-in person has independently verified non-executive access (platform owner, organization owner/admin, or another operational entitlement already represented by the current permission data).
- Preserve the existing rules that place executive-only users in the executive workspace; do not change budget, reporting, financial logic, database schema, RLS, or policies.

## Implementation
- Reuse the application’s query client and TanStack navigation in `ExecutiveLayout`, following the existing sign-out sequence: cancel requests, clear protected cache, sign out, then navigate with history replacement.
- Derive eligibility for the work-mode exit from existing authenticated role/membership data and keep the override limited to the current browser session.
- Teach the authenticated layout/guard to honor that explicit work-mode choice only for eligible users; executive-only users remain locked to `/executive`.
- Add English and Arabic labels for the new action and any failure feedback.

## Verification
- Run focused permission/routing tests and type checks.
- Use an executive test account in the live preview to verify: executive workspace loads, eligible “Return to work mode” exits to the operational workspace, and Sign out ends the session and lands on `/auth` without restoring protected content via Back.
- Do not create migrations or leave any temporary test-account changes behind.
