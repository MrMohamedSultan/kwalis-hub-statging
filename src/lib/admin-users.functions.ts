import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { noInput } from "@/lib/server-input";

/**
 * Admin user-management server functions.
 *
 * - createUserDirect: admin creates a user (email + password), confirms the
 *   email server-side, attaches them to an organization, and optionally
 *   assigns a custom role. No invitation email is sent.
 * - adminResetUserPassword: admin overwrites a member's password.
 * - changeOwnPassword: signed-in user updates their own password.
 *
 * Authorization mirrors RLS: super_admin OR org admin/owner on the target org.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertCanAdminOrg(supabase: any, userId: string, organizationId: string) {
  const { data: isSuper } = await supabase.rpc("is_super_admin", { _uid: userId });
  if (isSuper) return;
  const { data: isOrgAdmin } = await supabase.rpc("is_org_admin", {
    _uid: userId,
    _org: organizationId,
  });
  if (!isOrgAdmin) {
    throw new Error("Forbidden: only super admins or organization admins can do that.");
  }
}

/**
 * ANTI-LOCKOUT (application layer). The DB triggers guard_org_admin_lockout
 * / guard_assignment_lockout never see service-role writes (auth.uid() is
 * NULL), so the same rule is enforced here where the actor is known.
 *
 * Counts ONLY admin power scoped to this exact organization:
 *   - organization_members rows with role owner/admin
 *   - org-wide (project_id IS NULL) assignments of an is_admin role
 * Platform-level (organization_id IS NULL) assignments NEVER count.
 * Throws only when the target currently holds org admin power AND no other
 * org-scoped admin would remain.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertNotLastOrgAdmin(
  supabaseAdmin: any,
  targetUserId: string,
  organizationId: string,
) {
  const [{ data: adminMembers }, { data: adminAssignments }] = await Promise.all([
    supabaseAdmin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .in("role", ["owner", "admin"]),
    supabaseAdmin
      .from("user_role_assignments")
      .select("user_id, roles!inner(is_admin)")
      .eq("organization_id", organizationId)
      .is("project_id", null)
      .eq("roles.is_admin", true),
  ]);
  const adminIds = new Set<string>([
    ...(adminMembers ?? []).map((m: { user_id: string }) => m.user_id),
    ...(adminAssignments ?? []).map((a: { user_id: string }) => a.user_id),
  ]);
  if (!adminIds.has(targetUserId)) return; // target holds no org admin power
  adminIds.delete(targetUserId);
  if (adminIds.size === 0) {
    throw new Error(
      "lockout_prevented: cannot remove the last admin of this organization — promote another admin first.",
    );
  }
}

/**
 * A role is assignable inside an org when it is a system role
 * (organization_id IS NULL) or belongs to that exact organization.
 * Returns the role row for downstream metadata (e.g. is_admin).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertRoleAssignable(
  supabase: any,
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

const CreateUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(255),
    password: z.string().min(8).max(128),
    displayName: z.string().trim().max(120).optional(),
    // Optional so Platform Admins can be provisioned without being bound to a
    // client tenant. For scope='company' we still require it (see .refine below).
    organizationId: z.string().uuid().nullable().optional(),
    orgRole: z.enum(["owner", "admin", "member"]).default("member"),
    projectId: z.string().uuid().nullable().optional(),
    // Multi-project assignment: a user can be attached to several projects at
    // once. `projectId` is kept for backward compatibility (first project).
    projectIds: z.array(z.string().uuid()).max(200).optional(),

    /** RBAC role (public.roles) assigned to the user inside the org. */
    roleId: z.string().uuid().nullable().optional(),
    // 'platform' grants the super_admin app role (global visibility).
    // 'company' is the default and scopes access to the assigned organization.
    scope: z.enum(["platform", "company"]).default("company"),
  })
  .superRefine((v, ctx) => {
    if (v.scope !== "platform" && !v.organizationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Organization is required for company-scoped users.",
        path: ["organizationId"],
      });
    }
    const anyProject = !!v.projectId || (v.projectIds?.length ?? 0) > 0;
    if (v.scope === "platform" && !v.organizationId && (anyProject || v.roleId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Project and role assignments require an organization.",
        path: ["organizationId"],
      });
    }
  });

export const createUserDirect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Only platform super admins can mint another platform super admin.
    if (data.scope === "platform") {
      const { data: isSuper } = await supabase.rpc("is_super_admin", { _uid: userId });
      if (!isSuper) {
        throw new Error("Forbidden: only platform super admins can create another platform admin.");
      }
    }

    const orgId = data.organizationId ?? null;
    if (orgId) {
      await assertCanAdminOrg(supabase, userId, orgId);
    }

    // Validate the RBAC role before any writes so a bad role can't leave
    // half-provisioned state behind.
    let assignedRole: { id: string; is_admin: boolean } | null = null;
    if (orgId && data.roleId) {
      assignedRole = await assertRoleAssignable(supabase, data.roleId, orgId);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Pre-create an invitations row so handle_new_user attaches memberships.
    //    Skipped for platform-only users with no tenant binding.
    let invId: string | null = null;
    if (orgId) {
      const { data: inv, error: invErr } = await supabaseAdmin
        .from("invitations")
        .insert({
          email: data.email,
          organization_id: orgId,
          project_id: data.projectId ?? null,
          org_role: data.orgRole,
          role_id: data.roleId ?? null,
          invited_by: userId,
        })
        .select("id")
        .single();
      if (invErr || !inv) {
        throw new Error(`Could not stage invitation: ${invErr?.message ?? "unknown"}`);
      }
      invId = inv.id;
    }

    // 2. Create the auth user with a pre-set password and confirmed email.
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: data.displayName ? { display_name: data.displayName } : undefined,
    });

    if (createErr || !created?.user) {
      if (invId) await supabaseAdmin.from("invitations").delete().eq("id", invId);
      throw new Error(createErr?.message ?? "Could not create user.");
    }

    const newUserId = created.user.id;

    // 3. Ensure memberships exist even if the handle_new_user trigger didn't
    //    fully populate them. Idempotent thanks to unique constraints.
    await supabaseAdmin.from("user_roles").upsert(
      {
        user_id: newUserId,
        role: data.scope === "platform" ? "super_admin" : "member",
      },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );

    if (orgId) {
      await supabaseAdmin.from("organization_members").upsert(
        {
          organization_id: orgId,
          user_id: newUserId,
          role: data.orgRole,
        },
        { onConflict: "organization_id,user_id", ignoreDuplicates: true },
      );
    }

    // Attach the user to every selected project (multi-project assignment).
    const targetProjectIds = Array.from(
      new Set([...(data.projectIds ?? []), ...(data.projectId ? [data.projectId] : [])]),
    );
    if (orgId && targetProjectIds.length > 0) {
      await supabaseAdmin.from("project_members").upsert(
        targetProjectIds.map((pid) => ({
          project_id: pid,
          user_id: newUserId,
          role: assignedRole?.is_admin ? "admin" : "member",
        })),
        { onConflict: "project_id,user_id", ignoreDuplicates: true },
      );
    }

    // Mark the staged invitation as accepted so it doesn't linger as pending.
    if (invId) {
      await supabaseAdmin
        .from("invitations")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invId)
        .is("accepted_at", null);
    }

    // 4. Optionally attach an RBAC role (requires an org binding). The
    //    handle_new_user trigger does this too via the staged invitation —
    //    the upsert keeps it idempotent.
    if (orgId && data.roleId) {
      const { error: roleErr } = await supabaseAdmin.from("user_role_assignments").upsert(
        {
          user_id: newUserId,
          organization_id: orgId,
          role_id: data.roleId,
          assigned_by: userId,
        },
        { onConflict: "user_id,organization_id,project_id" },
      );
      if (roleErr) {
        return {
          userId: newUserId,
          warning: `User created but role assignment failed: ${roleErr.message}`,
        };
      }
    }

    // D08: an account created by hand starts with a password its creator
    // knows, so the user must replace it at first sign-in. Recorded with the
    // caller's own token (the RPC checks they administer the user). A missing
    // function (migration not applied yet, PGRST202) is not an error.
    const { error: pwErr } = await (supabase as any).rpc("admin_require_password_change", {
      p_user_id: newUserId,
      p_required: true,
    });
    if (pwErr && pwErr.code !== "PGRST202") {
      return {
        userId: newUserId,
        warning: `User created, but the "change password at first sign-in" rule could not be set: ${pwErr.message}`,
      };
    }

    return { userId: newUserId };
  });

const RemoveMemberSchema = z.object({
  targetUserId: z.string().uuid(),
  organizationId: z.string().uuid(),
  deleteAuthUser: z.boolean().optional().default(false),
});

export const removeOrgMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RemoveMemberSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanAdminOrg(supabase, userId, data.organizationId);

    if (data.targetUserId === userId) {
      throw new Error("You cannot remove yourself from the organization.");
    }

    const { data: callerIsSuper } = await supabase.rpc("is_super_admin", { _uid: userId });

    // FAIL FAST: a permanent account purge is super-admin-only. Check BEFORE
    // any membership/role rows are touched so a denied purge never leaves the
    // member half-removed behind a misleading error.
    if (data.deleteAuthUser && !callerIsSuper) {
      throw new Error("Only super admins can permanently delete a user account.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // ANTI-LOCKOUT: removing this member must not orphan the organization.
    // The DB guard never sees these service-role deletes (auth.uid() is NULL
    // there), so the rule is enforced here where the actor is known.
    if (!callerIsSuper) {
      await assertNotLastOrgAdmin(supabaseAdmin, data.targetUserId, data.organizationId);
    }

    const { data: projs } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("organization_id", data.organizationId);
    const projectIds = (projs ?? []).map((p: { id: string }) => p.id);
    if (projectIds.length > 0) {
      await supabaseAdmin
        .from("project_members")
        .delete()
        .eq("user_id", data.targetUserId)
        .in("project_id", projectIds);
    }

    await supabaseAdmin
      .from("user_role_assignments")
      .delete()
      .eq("user_id", data.targetUserId)
      .eq("organization_id", data.organizationId);

    const { error: memErr } = await supabaseAdmin
      .from("organization_members")
      .delete()
      .eq("user_id", data.targetUserId)
      .eq("organization_id", data.organizationId);
    if (memErr) throw new Error(memErr.message);

    if (data.deleteAuthUser) {
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(data.targetUserId);
      if (delErr) throw new Error(delErr.message);
    }

    return { ok: true };
  });

const ResetPasswordSchema = z.object({
  targetUserId: z.string().uuid(),
  newPassword: z.string().min(8).max(128),
});

export const adminResetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResetPasswordSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Caller must be super admin OR org admin in a shared org with target.
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _uid: userId });
    if (!isSuper) {
      const { data: shared } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", userId)
        .in("role", ["owner", "admin"]);
      const adminOrgIds = (shared ?? []).map((r: { organization_id: string }) => r.organization_id);
      if (adminOrgIds.length === 0) throw new Error("Forbidden");

      const { data: targetMemberships } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", data.targetUserId);
      const targetOrgIds = (targetMemberships ?? []).map(
        (r: { organization_id: string }) => r.organization_id,
      );
      const overlap = targetOrgIds.some((id) => adminOrgIds.includes(id));
      if (!overlap) {
        throw new Error("Forbidden: target user is not in any organization you administer.");
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.targetUserId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ChangeOwnPasswordSchema = z.object({
  newPassword: z.string().min(8).max(128),
});

export const changeOwnPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ChangeOwnPasswordSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.auth.updateUser({ password: data.newPassword });
    if (error) throw new Error(error.message);
    // D08: the password really changed, so lift the "must change password"
    // requirement if one was set. Best effort — the function only exists once
    // db/pending/120_d23_account_controls.sql has been applied.
    await (supabase as any).rpc("clear_my_password_change_requirement").then(
      () => undefined,
      () => undefined,
    );
    return { ok: true };
  });

// ============================================================
// updateOrgMember — edit a member's display name, org role,
// transfer them to another organization, and set/clear their
// RBAC role. Follows the same schema rules used elsewhere:
//   - organization_members.role in ('owner','admin','member')
//   - user_role_assignments is UNIQUE(user_id) — one role per user
// If newOrganizationId != currentOrganizationId, we remove the
// user's project + role assignments in the source org
// (they don't apply outside it) and create the new membership.
// ============================================================
const UpdateMemberSchema = z.object({
  targetUserId: z.string().uuid(),
  currentOrganizationId: z.string().uuid(),
  // null == "Global / Platform Level (No Organization)". Only permitted when
  // the target user is a platform super admin — regular tenant users must
  // always belong to an organization.
  newOrganizationId: z.string().uuid().nullable(),
  orgRole: z.enum(["owner", "admin", "member"]),
  displayName: z.string().trim().max(120).optional(),
  /** RBAC role (public.roles) to assign; null/omitted clears it. */
  roleId: z.string().uuid().nullable().optional(),
  /**
   * Project-level isolation: the exact set of projects the user should be a
   * member of inside the TARGET organization. `undefined` means "leave project
   * memberships untouched" (backwards compatible); an array replaces them.
   * Project ids outside the target organization are rejected.
   */
  projectIds: z.array(z.string().uuid()).max(200).optional(),
});

export const updateOrgMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateMemberSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const isGlobalTarget = data.newOrganizationId === null;
    const isTransfer = data.newOrganizationId !== data.currentOrganizationId;

    // Caller must admin the source org, and (if transferring to another org)
    // the target org. Transferring to the global scope requires super admin.
    await assertCanAdminOrg(supabase, userId, data.currentOrganizationId);
    if (!isGlobalTarget && isTransfer) {
      await assertCanAdminOrg(supabase, userId, data.newOrganizationId as string);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // --- SECURITY HARDENING -----------------------------------------------
    // Regular company admins cannot modify a Platform (super_admin) account.
    // Only platform super admins may touch a super_admin row. This endpoint
    // also never escalates app roles — user_roles is untouched here — but the
    // guard documents and enforces the invariant defensively.
    const [{ data: callerIsSuperRow }, { data: targetRoles }] = await Promise.all([
      supabase.rpc("is_super_admin", { _uid: userId }),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", data.targetUserId),
    ]);
    const callerIsSuper = !!callerIsSuperRow;
    const targetIsSuper = (targetRoles ?? []).some(
      (r: { role: string }) => r.role === "super_admin",
    );

    if (targetIsSuper && !callerIsSuper) {
      throw new Error("Only platform super admins can modify a Platform Admin account.");
    }

    // "Global / Platform Level (No Organization)" is reserved for platform
    // super admins — tenant users must always have an organization binding.
    if (isGlobalTarget) {
      if (!callerIsSuper) {
        throw new Error("Only platform super admins can move a user to the global platform scope.");
      }
      if (!targetIsSuper) {
        throw new Error("Only Platform Admin accounts can exist without an organization.");
      }
    }

    // Failsafe: block transferring the last remaining super admin between
    // organizations to prevent a lock-out window during the swap.
    // Moving to the global platform scope (organization_id = null) keeps the
    // account a Platform Admin, so it can never orphan the system — allow it.
    if (targetIsSuper && isTransfer && !isGlobalTarget) {
      const { count: superCount } = await supabaseAdmin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "super_admin");
      if ((superCount ?? 0) <= 1) {
        throw new Error(
          "Refusing to transfer the last remaining Platform Admin. Promote another super admin first.",
        );
      }
    }

    // Validate the RBAC role against the target org before any writes.
    const newRole =
      !isGlobalTarget && data.roleId
        ? await assertRoleAssignable(supabase, data.roleId, data.newOrganizationId as string)
        : null;

    // Snapshot "before" state for the audit log.
    const [{ data: beforeMembership }, { data: beforeProfile }, { data: beforeAssignment }] =
      await Promise.all([
        supabaseAdmin
          .from("organization_members")
          .select("role")
          .eq("user_id", data.targetUserId)
          .eq("organization_id", data.currentOrganizationId)
          .maybeSingle(),
        supabaseAdmin
          .from("profiles")
          .select("display_name")
          .eq("id", data.targetUserId)
          .maybeSingle(),
        supabaseAdmin
          .from("user_role_assignments")
          .select("role_id")
          .eq("user_id", data.targetUserId)
          .maybeSingle(),
      ]);

    // --- ANTI-LOCKOUT (app layer) ---------------------------------------
    // The DB guards never see these service-role writes (auth.uid() is NULL
    // there), so the rule is enforced here where the actor is known: if this
    // change strips the target's admin power in the source organization, it
    // must not be self-demotion and must not orphan the organization.
    let beforeAssignmentIsAdmin = false;
    if (beforeAssignment?.role_id) {
      const { data: beforeRole } = await supabaseAdmin
        .from("roles")
        .select("is_admin")
        .eq("id", beforeAssignment.role_id)
        .maybeSingle();
      beforeAssignmentIsAdmin = Boolean(beforeRole?.is_admin);
    }
    const hadOrgAdminPower =
      beforeMembership?.role === "owner" ||
      beforeMembership?.role === "admin" ||
      beforeAssignmentIsAdmin;
    const keepsOrgAdminPower =
      !isTransfer &&
      (data.orgRole === "owner" || data.orgRole === "admin" || Boolean(newRole?.is_admin));
    if (hadOrgAdminPower && !keepsOrgAdminPower && !callerIsSuper) {
      if (data.targetUserId === userId) {
        throw new Error(
          "self_demotion_blocked: you cannot remove your own admin role — ask another admin or the platform owner.",
        );
      }
      await assertNotLastOrgAdmin(supabaseAdmin, data.targetUserId, data.currentOrganizationId);
    }

    // 1. Display name — always safe to update the profile.
    if (typeof data.displayName === "string" && data.displayName.length > 0) {
      const { error: pErr } = await supabaseAdmin
        .from("profiles")
        .update({ display_name: data.displayName })
        .eq("id", data.targetUserId);
      if (pErr) throw new Error(pErr.message);
    }

    // 2. Org membership: same-org role change vs. transfer (org or global).
    if (!isTransfer) {
      const { error: rErr } = await supabaseAdmin
        .from("organization_members")
        .update({ role: data.orgRole })
        .eq("user_id", data.targetUserId)
        .eq("organization_id", data.currentOrganizationId);
      if (rErr) throw new Error(rErr.message);
    } else {
      // Clean up project + role bindings in the source org.
      const { data: oldProjects } = await supabaseAdmin
        .from("projects")
        .select("id")
        .eq("organization_id", data.currentOrganizationId);
      const oldProjectIds = (oldProjects ?? []).map((p: { id: string }) => p.id);
      if (oldProjectIds.length > 0) {
        await supabaseAdmin
          .from("project_members")
          .delete()
          .eq("user_id", data.targetUserId)
          .in("project_id", oldProjectIds);
      }
      await supabaseAdmin
        .from("user_role_assignments")
        .delete()
        .eq("user_id", data.targetUserId)
        .eq("organization_id", data.currentOrganizationId);

      const { error: delErr } = await supabaseAdmin
        .from("organization_members")
        .delete()
        .eq("user_id", data.targetUserId)
        .eq("organization_id", data.currentOrganizationId);
      if (delErr) throw new Error(delErr.message);

      // Only recreate a membership when transferring to another organization.
      // Global-scope moves leave the user without any organization_members row
      // — their access flows purely from user_roles.super_admin.
      if (!isGlobalTarget) {
        const { error: insErr } = await supabaseAdmin.from("organization_members").upsert(
          {
            user_id: data.targetUserId,
            organization_id: data.newOrganizationId as string,
            role: data.orgRole,
          },
          { onConflict: "organization_id,user_id" },
        );
        if (insErr) throw new Error(insErr.message);
      }
    }

    // 3. RBAC role sync. Assignments are per (user, organization, project),
    //    so the sync replaces only the target org's org-scoped assignment —
    //    never assignments the user holds in other organizations.
    //    Global-scope platform admins carry no org-scoped RBAC role — their
    //    access flows from user_roles.super_admin.
    await supabaseAdmin
      .from("user_role_assignments")
      .delete()
      .eq("user_id", data.targetUserId)
      .eq("organization_id", data.newOrganizationId as string)
      .is("project_id", null);
    if (!isGlobalTarget && data.roleId) {
      const { error: raErr } = await supabaseAdmin.from("user_role_assignments").insert({
        user_id: data.targetUserId,
        organization_id: data.newOrganizationId as string,
        role_id: data.roleId,
        assigned_by: userId,
      });
      if (raErr) throw new Error(raErr.message);
    }

    // 3b. PROJECT-LEVEL ISOLATION — project_members sync.
    //     project_members is the junction table that RLS on `projects` reads
    //     (can_access_project -> is_project_member), so this set IS the user's
    //     project visibility. Only the target organization's projects are
    //     touched; memberships in other organizations are never affected.
    //     Caller authority was already verified by assertCanAdminOrg above.
    if (data.projectIds && !isGlobalTarget) {
      const targetOrgId = data.newOrganizationId as string;
      const { data: orgProjects, error: opErr } = await supabaseAdmin
        .from("projects")
        .select("id")
        .eq("organization_id", targetOrgId);
      if (opErr) throw new Error(opErr.message);
      const allowed = new Set((orgProjects ?? []).map((p: { id: string }) => p.id));
      const requested = Array.from(new Set(data.projectIds));
      const invalid = requested.filter((id) => !allowed.has(id));
      if (invalid.length > 0) {
        throw new Error("One or more selected projects do not belong to the target organization.");
      }

      const orgProjectIds = Array.from(allowed);
      if (orgProjectIds.length > 0) {
        const toRemove = orgProjectIds.filter((id) => !requested.includes(id));
        if (toRemove.length > 0) {
          const { error: rmErr } = await supabaseAdmin
            .from("project_members")
            .delete()
            .eq("user_id", data.targetUserId)
            .in("project_id", toRemove);
          if (rmErr) throw new Error(rmErr.message);
        }
      }
      if (requested.length > 0) {
        const memberRole =
          data.orgRole === "owner" || data.orgRole === "admin" || newRole?.is_admin
            ? "admin"
            : "member";
        const { error: addErr } = await supabaseAdmin.from("project_members").upsert(
          requested.map((pid) => ({
            project_id: pid,
            user_id: data.targetUserId,
            role: memberRole,
          })),
          { onConflict: "project_id,user_id", ignoreDuplicates: true },
        );
        if (addErr) throw new Error(addErr.message);
      }
    }

    // --- AUDIT LOG --------------------------------------------------------
    // Never block the update on audit failure.
    try {
      // isTransfer + isGlobalTarget are already computed above; recompute
      // locally to keep audit block self-contained.
      const isTransferAudit = data.newOrganizationId !== data.currentOrganizationId;
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (
        typeof data.displayName === "string" &&
        data.displayName.length > 0 &&
        (beforeProfile?.display_name ?? null) !== data.displayName
      ) {
        changes.display_name = {
          from: beforeProfile?.display_name ?? null,
          to: data.displayName,
        };
      }
      if (isTransferAudit) {
        changes.organization = {
          from: data.currentOrganizationId,
          to: data.newOrganizationId,
        };
      }
      if ((beforeMembership?.role ?? null) !== data.orgRole) {
        changes.org_role = { from: beforeMembership?.role ?? null, to: data.orgRole };
      }
      const beforeRoleId = beforeAssignment?.role_id ?? null;
      const afterRoleId = isGlobalTarget ? null : (data.roleId ?? null);
      if (beforeRoleId !== afterRoleId) {
        changes.role_assignment = { from: beforeRoleId, to: afterRoleId };
      }

      if (Object.keys(changes).length > 0) {
        await supabaseAdmin.from("audit_logs").insert({
          category: "auth",
          action: isTransferAudit ? "user.transfer" : "user.update",
          summary: isTransferAudit
            ? data.newOrganizationId
              ? `Transferred user ${data.targetUserId} to a new organization`
              : `Moved user ${data.targetUserId} to global platform scope`
            : `Updated user ${data.targetUserId}`,
          severity: isTransferAudit ? "warning" : "info",
          entity: `user:${data.targetUserId}`,
          organization_id: data.newOrganizationId ?? data.currentOrganizationId,
          project_id: null,
          details: {
            target_user_id: data.targetUserId,
            changes,
            target_is_super_admin: targetIsSuper,
          } as any,
          actor_id: userId,
          actor_email: (context.claims as { email?: string } | null)?.email ?? null,
        });
      }
    } catch (auditErr) {
      console.warn("[audit] updateOrgMember failed to record", auditErr);
    }

    return { ok: true };
  });

// ============================================================
// listOrgMembers — returns all members visible to the caller.
// Super admins see every member across all organizations.
// Org admins/owners/members see only the orgs they belong to.
// ============================================================
export type OrgMemberRow = {
  userId: string;
  email: string;
  displayName: string;
  appRoles: string[]; // user_roles.role[]  (super_admin, admin, member)
  orgId: string;
  orgName: string;
  orgRole: string; // organization_members.role
  scope: "platform" | "company";
  createdAt: string | null;
};

export const listOrgMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(noInput)
  .handler(async ({ context }): Promise<OrgMemberRow[]> => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: isSuper } = await supabase.rpc("is_super_admin", { _uid: userId });

    // Determine which orgs the caller is allowed to see.
    let orgIds: string[] | null = null; // null = all orgs (super admin)
    if (!isSuper) {
      const { data: myOrgs } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", userId);
      orgIds = (myOrgs ?? []).map((r: { organization_id: string }) => r.organization_id);
      if (orgIds.length === 0) return [];
    }

    // Pull memberships + org names.
    let mq = supabaseAdmin
      .from("organization_members")
      .select("user_id, organization_id, role, organizations:organization_id(name)");
    if (orgIds) mq = mq.in("organization_id", orgIds);
    const { data: memberships, error: mErr } = await mq;
    if (mErr) throw new Error(mErr.message);

    const memberUserIds = Array.from(
      new Set((memberships ?? []).map((m: { user_id: string }) => m.user_id)),
    );
    if (memberUserIds.length === 0) return [];

    // Fetch profiles, app roles, and auth emails in parallel.
    const [{ data: profiles }, { data: appRoles }, { data: authUsers }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, display_name").in("id", memberUserIds),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", memberUserIds),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const profileMap = new Map<string, string>();
    for (const p of profiles ?? [])
      profileMap.set(p.id as string, (p.display_name as string) ?? "");

    const rolesMap = new Map<string, string[]>();
    for (const r of appRoles ?? []) {
      const arr = rolesMap.get(r.user_id as string) ?? [];
      arr.push(r.role as string);
      rolesMap.set(r.user_id as string, arr);
    }

    const emailMap = new Map<string, { email: string; createdAt: string | null }>();
    for (const u of authUsers?.users ?? []) {
      emailMap.set(u.id, { email: u.email ?? "", createdAt: u.created_at ?? null });
    }

    return (memberships ?? []).map(
      (m: {
        user_id: string;
        organization_id: string;
        role: string;
        organizations: { name: string } | { name: string }[] | null;
      }) => {
        const orgRel = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
        const appRolesForUser = rolesMap.get(m.user_id) ?? [];
        const isPlatform = appRolesForUser.includes("super_admin");
        const e = emailMap.get(m.user_id);
        return {
          userId: m.user_id,
          email: e?.email ?? "",
          displayName: profileMap.get(m.user_id) || (e?.email ?? "").split("@")[0] || "Unnamed",
          appRoles: appRolesForUser,
          orgId: m.organization_id,
          orgName: orgRel?.name ?? "—",
          orgRole: m.role,
          scope: isPlatform ? "platform" : "company",
          createdAt: e?.createdAt ?? null,
        } satisfies OrgMemberRow;
      },
    );
  });

// ============================================================
// assignUserRole — set or clear a user's RBAC role inside an org.
// user_role_assignments is UNIQUE(user_id), so this replaces any
// existing assignment. roleId = null unassigns.
// ============================================================
const AssignRoleSchema = z.object({
  targetUserId: z.string().uuid(),
  organizationId: z.string().uuid(),
  roleId: z.string().uuid().nullable(),
});

export const assignUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AssignRoleSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanAdminOrg(supabase, userId, data.organizationId);
    if (data.roleId) {
      await assertRoleAssignable(supabase, data.roleId, data.organizationId);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Scope the replace to this organization's org-level assignment only —
    // assignments in other orgs (or project-scoped ones) must survive.
    const { error: delErr } = await supabaseAdmin
      .from("user_role_assignments")
      .delete()
      .eq("user_id", data.targetUserId)
      .eq("organization_id", data.organizationId)
      .is("project_id", null);
    if (delErr) throw new Error(delErr.message);

    if (data.roleId) {
      const { error: insErr } = await supabaseAdmin.from("user_role_assignments").insert({
        user_id: data.targetUserId,
        organization_id: data.organizationId,
        role_id: data.roleId,
        assigned_by: userId,
      });
      if (insErr) throw new Error(insErr.message);
    }
    return { ok: true };
  });
