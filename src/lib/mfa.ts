import { supabase } from "@/integrations/supabase/client";

/**
 * X02 — two-step verification (TOTP) through Supabase Auth MFA.
 * Factors and challenges are created and checked by Supabase Auth; the
 * browser never sees the shared secret after enrolment.
 */
export type MfaState = {
  currentLevel: "aal1" | "aal2" | null;
  nextLevel: "aal1" | "aal2" | null;
  /** Verified TOTP factors of the signed-in user. */
  factors: { id: string; friendlyName: string | null; createdAt: string }[];
};

export async function getMfaState(): Promise<MfaState> {
  const [{ data: aal }, { data: list }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  const factors = (list?.totp ?? [])
    .filter((f) => f.status === "verified")
    .map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null, createdAt: f.created_at }));
  return {
    currentLevel: (aal?.currentLevel as MfaState["currentLevel"]) ?? null,
    nextLevel: (aal?.nextLevel as MfaState["nextLevel"]) ?? null,
    factors,
  };
}

/** The session still needs the second step (user has a factor, session is aal1). */
export function needsSecondStep(state: MfaState): boolean {
  return state.nextLevel === "aal2" && state.currentLevel !== "aal2";
}

/** Whether one of the user's organizations requires two-step verification. */
export async function isMfaRequiredForMe(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("my_mfa_required");
  if (error) return false;
  return data === true;
}

export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
}

export type TotpEnrolment = { factorId: string; qrCode: string; secret: string };

export async function startTotpEnrolment(friendlyName: string): Promise<TotpEnrolment> {
  // Drop unfinished enrolments first: Supabase refuses a duplicate friendly name.
  const { data: list } = await supabase.auth.mfa.listFactors();
  for (const f of list?.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: friendlyName.slice(0, 60),
  });
  if (error || !data) throw error ?? new Error("enroll failed");
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function removeFactor(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/** Six digits only. */
export function cleanTotpCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

export async function setOrgRequireMfa(organizationId: string, on: boolean): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("set_org_require_mfa", {
    _org: organizationId,
    _on: on,
  });
  if (error) throw error;
}
