// =====================================================================
// Account status — what the platform owner decided about this account
// (D23 / D08). Reads public.my_account_status() from
// db/pending/120_d23_account_controls.sql.
//
// Fail-open by design: if the function does not exist yet (migration not
// applied) or the call fails, the result is "nothing to enforce". This gate
// is UX-level; the auth ban and RLS are the real enforcement.
// =====================================================================
import { supabase } from "@/integrations/supabase/client";

export type AccountStatus = {
  disabled: boolean;
  disabledReason: string | null;
  sessionsRevokedAt: string | null;
  mustChangePassword: boolean;
  allOrgsSuspended: boolean;
};

export const NO_ACCOUNT_RESTRICTIONS: AccountStatus = {
  disabled: false,
  disabledReason: null,
  sessionsRevokedAt: null,
  mustChangePassword: false,
  allOrgsSuspended: false,
};

export async function fetchMyAccountStatus(): Promise<AccountStatus> {
  try {
    const { data, error } = await (supabase as any).rpc("my_account_status");
    if (error) return NO_ACCOUNT_RESTRICTIONS;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return NO_ACCOUNT_RESTRICTIONS;
    return {
      disabled: !!row.disabled,
      disabledReason: (row.disabled_reason as string | null) ?? null,
      sessionsRevokedAt: (row.sessions_revoked_at as string | null) ?? null,
      mustChangePassword: !!row.must_change_password,
      allOrgsSuspended: !!row.all_orgs_suspended,
    };
  } catch {
    return NO_ACCOUNT_RESTRICTIONS;
  }
}

export type AccountAction =
  "sign_out_disabled" | "sign_out_revoked" | "change_password" | "suspended" | "none";

/**
 * What the app must do for a given status. Pure — unit tested.
 *
 * lastSignInAt is the time of the user's last real sign-in (it does not move
 * when a token is refreshed), so a session opened before a forced sign-out is
 * recognised even after its access token was renewed.
 */
export function accountActionFor(
  status: AccountStatus,
  lastSignInAt: string | null | undefined,
): AccountAction {
  if (status.disabled) return "sign_out_disabled";
  if (status.sessionsRevokedAt) {
    const revoked = Date.parse(status.sessionsRevokedAt);
    const signedIn = lastSignInAt ? Date.parse(lastSignInAt) : NaN;
    // Unknown sign-in time: be safe and end the session.
    if (Number.isNaN(signedIn) || signedIn < revoked) return "sign_out_revoked";
  }
  if (status.mustChangePassword) return "change_password";
  if (status.allOrgsSuspended) return "suspended";
  return "none";
}

/** Lift the "must change password" flag after the password really changed. */
export async function clearMyPasswordChangeRequirement(): Promise<void> {
  try {
    await (supabase as any).rpc("clear_my_password_change_requirement");
  } catch {
    // function not deployed yet — nothing to clear
  }
}
