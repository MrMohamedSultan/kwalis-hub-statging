import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

/**
 * Invite a user to an organization (and optionally a project).
 *
 * Flow:
 *   1. Caller must be a super admin OR an admin/owner of the target org.
 *   2. Insert a row in `public.invitations` so org/project/role metadata
 *      survives the email round-trip — the `handle_new_user` trigger reads
 *      this on first sign-in to attach memberships and the RBAC role
 *      assignment (`user_role_assignments` via `role_id`).
 *   3. Call `supabase.auth.admin.inviteUserByEmail`. Supabase Auth sends
 *      the email itself using whatever SMTP is configured in
 *      Cloud → Auth → SMTP.
 *
 * If the email step fails after the row was inserted, we roll the row back
 * so the admin UI never shows a "pending" invite that was never delivered.
 */

const InviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  orgRole: z.enum(["owner", "admin", "member"]).default("member"),
  /** RBAC role (public.roles) assigned to the user on first sign-in. */
  roleId: z.string().uuid().nullable().optional(),
  redirectTo: z.string().url().optional(),
});

async function assertCanInvite(supabase: SupabaseClient<Database>, userId: string, orgId: string) {
  const { data: isSuper } = await supabase.rpc("is_super_admin", { _uid: userId });
  if (isSuper) return;
  const { data: isOrgAdmin } = await supabase.rpc("is_org_admin", {
    _uid: userId,
    _org: orgId,
  });
  if (!isOrgAdmin) {
    throw new Error("Forbidden: only super admins or organization admins can invite users.");
  }
}

/**
 * A role is assignable inside an org when it is a system role
 * (organization_id IS NULL) or belongs to that exact organization.
 * Returns the role row for downstream metadata.
 */
async function assertRoleAssignable(
  supabase: SupabaseClient<Database>,
  roleId: string,
  organizationId: string,
): Promise<{ id: string; organization_id: string | null; is_admin: boolean }> {
  const { data: role, error } = await supabase
    .from("roles")
    .select("id, organization_id, is_admin")
    .eq("id", roleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!role) throw new Error("Selected role does not exist.");
  if (role.organization_id !== null && role.organization_id !== organizationId) {
    throw new Error("Selected role belongs to a different organization.");
  }
  return role;
}

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    await assertCanInvite(supabase, userId, data.organizationId);
    if (data.roleId) {
      await assertRoleAssignable(supabase, data.roleId, data.organizationId);
    }

    // 1. Insert invitation row (as the caller, so RLS still applies).
    const { data: inserted, error: insertError } = await supabase
      .from("invitations")
      .insert({
        email: data.email,
        organization_id: data.organizationId,
        project_id: data.projectId ?? null,
        org_role: data.orgRole,
        role_id: data.roleId ?? null,
        invited_by: userId,
      })
      .select("id, token, expires_at")
      .single();

    if (insertError || !inserted) {
      throw new Error(`Could not create invitation: ${insertError?.message ?? "unknown error"}`);
    }

    // 2. Send the email via Supabase Auth (uses Cloud → Auth → SMTP).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      redirectTo: data.redirectTo,
      data: {
        invitation_token: inserted.token,
        organization_id: data.organizationId,
        project_id: data.projectId ?? null,
        org_role: data.orgRole,
        role_id: data.roleId ?? null,
      },
    });

    if (inviteError) {
      // Roll back the row so the UI doesn't show ghost pending invites.
      await supabaseAdmin.from("invitations").delete().eq("id", inserted.id);

      // Common case: the address already has a Supabase auth user.
      // That's fine — the invitations row + handle_new_user trigger only
      // run on NEW signups. Surface a clear message instead.
      const msg = inviteError.message ?? "Failed to send invitation email.";
      throw new Error(msg);
    }

    return {
      id: inserted.id,
      token: inserted.token,
      expiresAt: inserted.expires_at,
    };
  });

/**
 * Resend an existing pending invitation. Re-issues the Supabase Auth email
 * without creating a duplicate `invitations` row.
 */
export const resendInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ invitationId: z.string().uuid(), redirectTo: z.string().url().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: inv, error } = await supabase
      .from("invitations")
      .select(
        "id, email, organization_id, project_id, org_role, role_id, token, accepted_at, revoked_at, expires_at",
      )
      .eq("id", data.invitationId)
      .single();
    if (error || !inv) throw new Error("Invitation not found.");
    if (inv.accepted_at) throw new Error("Invitation already accepted.");
    if (inv.revoked_at) throw new Error("Invitation has been revoked.");

    await assertCanInvite(supabase, userId, inv.organization_id);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: sendErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(inv.email, {
      redirectTo: data.redirectTo,
      data: {
        invitation_token: inv.token,
        organization_id: inv.organization_id,
        project_id: inv.project_id,
        org_role: inv.org_role,
        role_id: inv.role_id,
      },
    });
    if (sendErr) throw new Error(sendErr.message);
    return { ok: true };
  });
