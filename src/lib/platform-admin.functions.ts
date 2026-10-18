import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Platform administration of user accounts (D23 / D08).
 *
 * Each action has two halves:
 *   1. the database RPC (db/pending/120_d23_account_controls.sql) — checks the
 *      caller is a platform super admin, applies the anti-lockout rules and
 *      records who did what (audited);
 *   2. the Supabase auth admin API, which only the service role can call.
 *
 * The RPC always runs FIRST, with the caller's own token, so the service role
 * is never used to decide whether the caller is allowed (SECURITY.md §3).
 */

/** ~100 years: GoTrue has no "forever", this is the conventional stand-in. */
const BAN_FOREVER = "876000h";

const SetDisabledSchema = z.object({
  targetUserId: z.string().uuid(),
  disabled: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Disable or re-enable a user. A disabled user cannot sign in or refresh a
 * session; the sign-in gate (AccountStatusGuard) ends any session still open.
 */
export const adminSetUserDisabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetDisabledSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // 1. authorise + record (throws for anyone but a super admin)
    const { error: rpcErr } = await (supabase as any).rpc("admin_disable_user", {
      p_user_id: data.targetUserId,
      p_disabled: data.disabled,
      p_reason: data.reason ?? null,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    // 2. enforce at the auth layer
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(data.targetUserId, {
      ban_duration: data.disabled ? BAN_FOREVER : "none",
    });
    if (banErr) {
      // Keep the record truthful: undo step 1 rather than leave a user marked
      // disabled who can still sign in (or the reverse).
      await (supabase as any).rpc("admin_disable_user", {
        p_user_id: data.targetUserId,
        p_disabled: !data.disabled,
        p_reason: data.disabled ? null : (data.reason ?? null),
      });
      throw new Error(
        `Could not ${data.disabled ? "disable" : "enable"} the account: ${banErr.message}`,
      );
    }
    return { ok: true, disabled: data.disabled };
  });

const TargetSchema = z.object({ targetUserId: z.string().uuid() });

/**
 * Force sign-out: every session the user started before now stops being
 * accepted. The auth API cannot end another user's session by id, so this is
 * enforced by the sign-in gate, which compares the session's sign-in time with
 * the revocation time recorded here.
 */
export const adminForceLogout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TargetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: revokedAt, error } = await (context.supabase as any).rpc("admin_force_logout", {
      p_user_id: data.targetUserId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, revokedAt: revokedAt as string };
  });

const RequirePasswordSchema = z.object({
  targetUserId: z.string().uuid(),
  required: z.boolean().default(true),
});

/** D08 — the user must choose a new password at their next sign-in. */
export const adminRequirePasswordChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RequirePasswordSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("admin_require_password_change", {
      p_user_id: data.targetUserId,
      p_required: data.required,
    });
    if (error) throw new Error(error.message);
    return { ok: true, required: data.required };
  });

const SuspendCompanySchema = z.object({
  organizationId: z.string().uuid(),
  suspend: z.boolean(),
  /** The company name as typed by the admin — required to suspend. */
  confirmName: z.string().trim().max(200).optional(),
});

/** Suspend or reactivate a company (super admin only, name must be typed to suspend). */
export const adminSuspendCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SuspendCompanySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: status, error } = await (context.supabase as any).rpc("admin_suspend_company", {
      p_org_id: data.organizationId,
      p_suspend: data.suspend,
      p_confirm_name: data.confirmName ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true, status: status as string };
  });
