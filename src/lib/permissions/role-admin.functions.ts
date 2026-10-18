// ═══════════════════════════════════════════════════════════════════
// src/lib/permissions/role-admin.functions.ts
// Phase 7 — Role Management server functions (admin only).
//
// Every function runs through requireSupabaseAuth and then applies its
// own authorization:
//   • platform super admins  → may view/edit everything, incl. system roles
//   • organization owners/admins → may view system roles + manage custom
//     roles inside orgs they administrate
//   • RBAC is_admin role holders → read-only access to the matrix
//
// Writes normalize the implication invariant server-side (view gates all
// other flags) so a crafted payload can never persist an invalid row.
// ═══════════════════════════════════════════════════════════════════

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeFlags, slugify } from "./role-matrix";
import type { RoleFlags, RoleMatrixPayload, RolePermissionRow, RoleRow } from "./role-matrix";

type Ctx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
};

/** Resolve the caller's administrative capability in one pass. */
async function resolveAdminContext({ supabase, userId }: Ctx) {
  const { data: isSuper } = await supabase.rpc("is_super_admin", { _uid: userId });
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId);
  const memberOrgIds: string[] = (memberships ?? []).map(
    (m: { organization_id: string }) => m.organization_id,
  );
  const adminOrgIds: string[] = (memberships ?? [])
    .filter((m: { role: string }) => m.role === "owner" || m.role === "admin")
    .map((m: { organization_id: string }) => m.organization_id);

  let rbacAdmin = false;
  if (!isSuper) {
    const { data: isAdm } = await supabase.rpc("is_admin");
    rbacAdmin = Boolean(isAdm);
  }

  // Orgs whose custom roles this caller may edit: orgs they own/administrate,
  // plus — for holders of an RBAC Administrator role (is_admin) — every org
  // workspace they belong to. System roles always stay super-admin only.
  const editableOrgIds = Array.from(new Set([...adminOrgIds, ...(rbacAdmin ? memberOrgIds : [])]));

  return {
    isSuper: Boolean(isSuper),
    adminOrgIds,
    rbacAdmin,
    editableOrgIds,
    canAdmin: Boolean(isSuper) || adminOrgIds.length > 0 || rbacAdmin,
  };
}

function forbidden(): never {
  const err = new Error("Forbidden: administrator access required");
  (err as Error & { status?: number }).status = 403;
  throw err;
}

/** May this caller edit the given role's matrix / identity? */
function canEditRole(
  role: Pick<RoleRow, "is_system" | "organization_id">,
  admin: { isSuper: boolean; editableOrgIds: string[] },
): boolean {
  if (role.is_system) return admin.isSuper;
  if (admin.isSuper) return true;
  return role.organization_id != null && admin.editableOrgIds.includes(role.organization_id);
}

// ─── Read: the full matrix payload ──────────────────────────────────

export const getRoleManagementMatrix = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ organizationId: z.string().uuid().nullish() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<RoleMatrixPayload> => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const admin = await resolveAdminContext(ctx);
    if (!admin.canAdmin) forbidden();

    // Resolve which custom-role organizations are in scope.
    //   undefined → all orgs (super admin, no scope selected)
    //   []        → system roles only
    let scopeOrgIds: string[] | undefined;
    if (data.organizationId) {
      if (!admin.isSuper && !admin.adminOrgIds.includes(data.organizationId)) forbidden();
      scopeOrgIds = [data.organizationId];
    } else if (admin.isSuper) {
      scopeOrgIds = undefined;
    } else {
      scopeOrgIds = admin.editableOrgIds;
    }

    let rolesQuery = context.supabase
      .from("roles")
      .select("id, organization_id, name, slug, description, layout_type, is_admin, is_system")
      .order("is_system", { ascending: false })
      .order("name");
    if (scopeOrgIds !== undefined) {
      rolesQuery =
        scopeOrgIds.length === 0
          ? rolesQuery.is("organization_id", null)
          : rolesQuery.or(`organization_id.is.null,organization_id.in.(${scopeOrgIds.join(",")})`);
    }
    const { data: roles, error: rolesErr } = await rolesQuery;
    if (rolesErr) throw rolesErr;

    const roleIds = (roles ?? []).map((r) => r.id);

    const [{ data: modules, error: modErr }, { data: perms, error: permErr }, { data: assigns }] =
      await Promise.all([
        context.supabase
          .from("modules")
          .select("key, label, icon, route_path, parent_key, sort_order, layer")
          .eq("is_active", true)
          .order("sort_order"),
        roleIds.length
          ? context.supabase
              .from("role_permissions")
              .select("role_id, module_key, can_view, can_create, can_edit, can_delete, can_export")
              .in("role_id", roleIds)
          : Promise.resolve({ data: [], error: null }),
        roleIds.length
          ? context.supabase.from("user_role_assignments").select("role_id").in("role_id", roleIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
    if (modErr) throw modErr;
    if (permErr) throw permErr;

    const assignmentCounts: Record<string, number> = {};
    for (const a of assigns ?? []) {
      const rid = (a as { role_id: string }).role_id;
      assignmentCounts[rid] = (assignmentCounts[rid] ?? 0) + 1;
    }

    let orgs: { id: string; name: string }[] = [];
    if (admin.isSuper) {
      const { data: orgRows } = await context.supabase
        .from("organizations")
        .select("id, name")
        .order("name");
      orgs = (orgRows ?? []) as { id: string; name: string }[];
    }

    return {
      roles: (roles ?? []) as RoleRow[],
      modules: modules ?? [],
      permissions: (perms ?? []) as RolePermissionRow[],
      assignmentCounts,
      editableRoleIds: (roles ?? []).filter((r) => canEditRole(r, admin)).map((r) => r.id),
      editableOrgIds: admin.editableOrgIds,
      isSuperAdmin: admin.isSuper,
      orgs,
    };
  });

// ─── Write: batched matrix save ─────────────────────────────────────

export const saveRolePermissionBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        changes: z
          .array(
            z.object({
              roleId: z.string().uuid(),
              moduleKey: z.string().min(1).max(80),
              canView: z.boolean(),
              canCreate: z.boolean(),
              canEdit: z.boolean(),
              canDelete: z.boolean(),
              canExport: z.boolean(),
            }),
          )
          .max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const admin = await resolveAdminContext(ctx);
    if (!admin.canAdmin) forbidden();
    if (data.changes.length === 0) return { saved: 0 };

    const roleIds = Array.from(new Set(data.changes.map((c) => c.roleId)));
    const { data: roles, error } = await context.supabase
      .from("roles")
      .select("id, organization_id, is_system")
      .in("id", roleIds);
    if (error) throw error;
    const byId = new Map((roles ?? []).map((r) => [r.id, r]));
    for (const roleId of roleIds) {
      const role = byId.get(roleId);
      if (!role || !canEditRole(role, admin)) forbidden();
    }

    // Server-side invariant normalization — never trust the client payload.
    const rows = data.changes.map((c) => {
      const f = normalizeFlags({
        can_view: c.canView,
        can_create: c.canCreate,
        can_edit: c.canEdit,
        can_delete: c.canDelete,
        can_export: c.canExport,
      } satisfies RoleFlags);
      return { role_id: c.roleId, module_key: c.moduleKey, ...f };
    });

    const { error: upsertErr } = await context.supabase
      .from("role_permissions")
      .upsert(rows, { onConflict: "role_id,module_key" });
    if (upsertErr) throw upsertErr;
    return { saved: rows.length };
  });

// ─── Write: create custom role (with optional duplicated matrix) ────

export const createCustomRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        name: z.string().trim().min(2).max(60),
        description: z.string().trim().max(500).optional(),
        layoutType: z.enum(["operational", "executive"]),
        isAdmin: z.boolean().optional(),
        permissions: z
          .array(
            z.object({
              moduleKey: z.string().min(1).max(80),
              canView: z.boolean(),
              canCreate: z.boolean(),
              canEdit: z.boolean(),
              canDelete: z.boolean(),
              canExport: z.boolean(),
            }),
          )
          .max(500)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const admin = await resolveAdminContext(ctx);
    if (!admin.isSuper && !admin.editableOrgIds.includes(data.organizationId)) forbidden();
    // Only platform super admins may mint administrator-level roles.
    if (data.isAdmin && !admin.isSuper) forbidden();

    let slug = slugify(data.name);
    const { data: clash } = await context.supabase
      .from("roles")
      .select("id")
      .eq("slug", slug)
      .limit(1);
    if (clash && clash.length > 0) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const { data: role, error } = await context.supabase
      .from("roles")
      .insert({
        organization_id: data.organizationId,
        name: data.name,
        slug,
        description: data.description ?? null,
        layout_type: data.layoutType,
        is_admin: Boolean(data.isAdmin),
        is_system: false,
        created_by: context.userId,
      })
      .select("id, organization_id, name, slug, description, layout_type, is_admin, is_system")
      .single();
    if (error) throw error;

    if (data.permissions && data.permissions.length > 0) {
      const rows = data.permissions
        .map((p) => ({
          role_id: role.id,
          module_key: p.moduleKey,
          ...normalizeFlags({
            can_view: p.canView,
            can_create: p.canCreate,
            can_edit: p.canEdit,
            can_delete: p.canDelete,
            can_export: p.canExport,
          }),
        }))
        .filter((r) => r.can_view);
      if (rows.length > 0) {
        const { error: permErr } = await context.supabase.from("role_permissions").insert(rows);
        if (permErr) throw permErr;
      }
    }

    return { role: role as RoleRow };
  });

// ─── Write: update role identity ────────────────────────────────────

export const updateRoleIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        roleId: z.string().uuid(),
        name: z.string().trim().min(2).max(60),
        description: z.string().trim().max(500).optional(),
        layoutType: z.enum(["operational", "executive"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const admin = await resolveAdminContext(ctx);
    if (!admin.canAdmin) forbidden();

    const { data: role, error } = await context.supabase
      .from("roles")
      .select("id, organization_id, is_system")
      .eq("id", data.roleId)
      .single();
    if (error || !role) throw new Error("Role not found");
    if (!canEditRole(role, admin)) forbidden();

    const { error: updErr } = await context.supabase
      .from("roles")
      .update({
        name: data.name,
        description: data.description ?? null,
        layout_type: data.layoutType,
      })
      .eq("id", data.roleId);
    if (updErr) throw updErr;
    return { ok: true };
  });

// ─── Write: delete custom role ──────────────────────────────────────

export const deleteCustomRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ roleId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const admin = await resolveAdminContext(ctx);
    if (!admin.canAdmin) forbidden();

    const { data: role, error } = await context.supabase
      .from("roles")
      .select("id, organization_id, is_system, name")
      .eq("id", data.roleId)
      .single();
    if (error || !role) throw new Error("Role not found");
    if (role.is_system) forbidden();
    if (!canEditRole(role, admin)) forbidden();

    const { count } = await context.supabase
      .from("user_role_assignments")
      .select("id", { count: "exact", head: true })
      .eq("role_id", data.roleId);
    if ((count ?? 0) > 0) {
      throw new Error("Role still has assigned users — reassign them first.");
    }

    await context.supabase.from("role_permissions").delete().eq("role_id", data.roleId);
    const { error: delErr } = await context.supabase.from("roles").delete().eq("id", data.roleId);
    if (delErr) throw delErr;
    return { ok: true };
  });
