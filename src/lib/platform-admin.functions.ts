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

// ─────────────────────────────────────────────────────────────────────
// Platform user directory (super admin only)
// ─────────────────────────────────────────────────────────────────────

export type PlatformUserMembership = {
  organizationId: string;
  organizationName: string;
  orgRole: string;
};

export type PlatformUserRow = {
  userId: string;
  email: string;
  displayName: string;
  jobTitle: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  appRoles: string[];
  memberships: PlatformUserMembership[];
  /** Disabled in the account controls OR banned at the auth layer. */
  disabled: boolean;
  disabledReason: string | null;
  mustChangePassword: boolean;
  sessionsRevokedAt: string | null;
};

/**
 * Every account on the platform, with company memberships and account status.
 * The caller's own token decides access (is_super_admin); the service role is
 * used only afterwards, to read auth users and rows across all companies.
 */
export const listPlatformUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformUserRow[]> => {
    const { supabase, userId } = context;
    const { data: isSuper, error: roleErr } = await supabase.rpc("is_super_admin", {
      _uid: userId,
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isSuper) throw new Error("Forbidden: platform super admins only.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const authUsers: Array<{
      id: string;
      email?: string;
      created_at?: string;
      last_sign_in_at?: string | null;
      banned_until?: string | null;
    }> = [];
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(error.message);
      authUsers.push(...(data?.users ?? []));
      if ((data?.users ?? []).length < 1000) break;
    }

    const [profilesRes, rolesRes, membersRes, controlsRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, display_name, job_title"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin
        .from("organization_members")
        .select("user_id, organization_id, role, organizations:organization_id(name)"),
      (supabaseAdmin as any)
        .from("user_account_controls")
        .select("user_id, disabled, disabled_reason, must_change_password, sessions_revoked_at"),
    ]);
    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (rolesRes.error) throw new Error(rolesRes.error.message);
    if (membersRes.error) throw new Error(membersRes.error.message);
    // The controls table arrives with db/pending/120; before that, treat everyone as active.
    const controls: Array<{
      user_id: string;
      disabled: boolean;
      disabled_reason: string | null;
      must_change_password: boolean;
      sessions_revoked_at: string | null;
    }> = controlsRes.error ? [] : (controlsRes.data ?? []);

    const profileMap = new Map<string, { display_name: string | null; job_title: string | null }>();
    for (const p of profilesRes.data ?? []) profileMap.set(p.id as string, p as any);

    const rolesMap = new Map<string, string[]>();
    for (const r of rolesRes.data ?? []) {
      const list = rolesMap.get(r.user_id as string) ?? [];
      list.push(r.role as string);
      rolesMap.set(r.user_id as string, list);
    }

    const memberMap = new Map<string, PlatformUserMembership[]>();
    for (const m of (membersRes.data ?? []) as Array<{
      user_id: string;
      organization_id: string;
      role: string;
      organizations: { name: string } | { name: string }[] | null;
    }>) {
      const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
      const list = memberMap.get(m.user_id) ?? [];
      list.push({
        organizationId: m.organization_id,
        organizationName: org?.name ?? "—",
        orgRole: m.role,
      });
      memberMap.set(m.user_id, list);
    }

    const controlMap = new Map(controls.map((c) => [c.user_id, c]));
    const now = Date.now();

    return authUsers
      .map((u) => {
        const profile = profileMap.get(u.id);
        const control = controlMap.get(u.id);
        const banned = !!u.banned_until && new Date(u.banned_until).getTime() > now;
        const email = u.email ?? "";
        return {
          userId: u.id,
          email,
          displayName: profile?.display_name || email.split("@")[0] || "—",
          jobTitle: profile?.job_title ?? null,
          createdAt: u.created_at ?? null,
          lastSignInAt: u.last_sign_in_at ?? null,
          appRoles: rolesMap.get(u.id) ?? [],
          memberships: memberMap.get(u.id) ?? [],
          disabled: !!control?.disabled || banned,
          disabledReason: control?.disabled_reason ?? null,
          mustChangePassword: !!control?.must_change_password,
          sessionsRevokedAt: control?.sessions_revoked_at ?? null,
        } satisfies PlatformUserRow;
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  });
