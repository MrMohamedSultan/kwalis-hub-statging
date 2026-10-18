// ============================================================
// Server-side RBAC helpers — Phase 8: dynamic-matrix edition.
//
// - `getMyEffectivePermissions` returns the legacy Permission strings
//   the signed-in user currently holds, resolved from the DB-driven
//   role × module matrix via the get_my_permissions SECURITY DEFINER
//   RPC (super-admin flag → all; no role assigned → rollout fallback).
// - `requirePermission(perm)` is a createMiddleware factory. Chain it
//   AFTER `requireSupabaseAuth` on any protected server function to
//   throw 403 when the caller lacks the permission.
//
// Legacy permission strings map onto (module_key, action) pairs via
// LEGACY_PERM_TO_MODULE — the same mapping the client shim uses.
// ============================================================
import { createServerFn, createMiddleware } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { LEGACY_PERM_TO_MODULE } from "@/lib/permissions/legacy-map";
import { ALL_PERMISSIONS, PERMISSIONS, type Permission } from "@/lib/rbac";

type SB = SupabaseClient<Database>;

type EffectivePermissionsResult = {
  userId: string;
  isSuperAdmin: boolean;
  isOrgAdmin: boolean;
  permissions: Permission[];
};

const ModuleRowSchema = z.object({
  module_key: z.string(),
  can_view: z.boolean(),
  can_create: z.boolean(),
  can_edit: z.boolean(),
  can_delete: z.boolean(),
  can_export: z.boolean(),
});

const PayloadSchema = z.object({
  role: z.object({ is_admin: z.boolean() }).nullable(),
  permissions: z.array(ModuleRowSchema),
});

async function loadEffectivePermissions(
  supabase: SB,
  userId: string,
  orgId: string | null = null,
  projectId: string | null = null,
): Promise<EffectivePermissionsResult> {
  // Super-admin check
  const { data: superRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  const isSuperAdmin = !!superRow;

  // Org owner/admin check (reported for context; no longer grants perms)
  const { data: orgRows } = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["owner", "admin"]);
  const isOrgAdmin = (orgRows ?? []).length > 0;

  if (isSuperAdmin) {
    return { userId, isSuperAdmin: true, isOrgAdmin, permissions: [...ALL_PERMISSIONS] };
  }

  // Resolve scope(s): an explicit org when the caller supplied one, otherwise
  // every org the user belongs to (flags unioned — table RLS stays the real
  // boundary, this layer is the coarse permission gate).
  let orgIds: string[] = [];
  if (orgId) {
    orgIds = [orgId];
  } else {
    const { data: mems } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId);
    orgIds = [...new Set((mems ?? []).map((m) => m.organization_id))];
  }

  // No resolvable organization scope → clearly-typed no-scope result. Never
  // pass a null org into the RPC: an org-less non-super user holds no
  // permissions (table RLS would give them nothing either).
  if (orgIds.length === 0) {
    return { userId, isSuperAdmin, isOrgAdmin, permissions: [] };
  }

  type ModuleRow = z.infer<typeof ModuleRowSchema>;
  const byModule = new Map<string, ModuleRow>();
  let sawRole = false;
  let sawAdminRole = false;

  // Dynamic role × module matrix from the org-aware SECURITY DEFINER helper.
  for (const oid of orgIds) {
    // Only include p_project_id when a project was actually supplied —
    // undefined falls through to the SQL DEFAULT NULL; null is never sent.
    const rpcArgs: { p_org_id: string; p_project_id?: string } = { p_org_id: oid };
    if (orgId && projectId) rpcArgs.p_project_id = projectId;
    const { data: raw, error } = await supabase.rpc("get_my_permissions", rpcArgs);
    if (error) throw new Error(error.message);
    const payload = PayloadSchema.parse(raw ?? { role: null, permissions: [] });
    if (!payload.role) continue;
    sawRole = true;
    if (payload.role.is_admin) {
      sawAdminRole = true;
      break;
    }
    for (const row of payload.permissions) {
      const existing = byModule.get(row.module_key);
      if (!existing) {
        byModule.set(row.module_key, { ...row });
      } else {
        existing.can_view ||= row.can_view;
        existing.can_create ||= row.can_create;
        existing.can_edit ||= row.can_edit;
        existing.can_delete ||= row.can_delete;
        existing.can_export ||= row.can_export;
      }
    }
  }

  // RBAC admin role → everything. No role assigned → rollout fallback
  // (mirrors the client <Can /> bridge until every user is assigned).
  if (sawAdminRole || !sawRole) {
    return { userId, isSuperAdmin, isOrgAdmin, permissions: [...ALL_PERMISSIONS] };
  }

  const permissions = ALL_PERMISSIONS.filter((perm) => {
    const target = LEGACY_PERM_TO_MODULE[perm];
    if (!target) return false; // platform-tier capability: admins only
    const row = byModule.get(target[0]);
    if (!row) return false;
    const action = target[1];
    if (action !== "view" && !row.can_view) return false;
    return Boolean(row[`can_${action}` as keyof typeof row]);
  });

  return { userId, isSuperAdmin, isOrgAdmin, permissions };
}

/**
 * Public server function — returns the caller's effective permissions.
 * Safe for the client to call; only ever returns data about `auth.uid()`.
 * Optional org/project scope narrows resolution to that organization.
 */
export const getMyEffectivePermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const d = (data ?? {}) as { orgId?: unknown; projectId?: unknown };
    return {
      orgId: typeof d.orgId === "string" ? d.orgId : null,
      projectId: typeof d.projectId === "string" ? d.projectId : null,
    };
  })
  .handler(async ({ context, data }) => {
    return loadEffectivePermissions(context.supabase, context.userId, data.orgId, data.projectId);
  });

/**
 * Server-verified route gate. Called from a route's `beforeLoad` so that
 * typing a protected URL directly is rejected by the server, not just by
 * client-side UI. Custom operational roles are honoured because they
 * resolve through the same dynamic-matrix pipeline.
 */
export const checkRoutePermission = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { perm: Permission; orgId?: string | null; projectId?: string | null }) => {
      if (!data || typeof data.perm !== "string" || !(data.perm in PERMISSIONS)) {
        throw new Error("Invalid permission");
      }
      return {
        perm: data.perm as Permission,
        orgId: typeof data.orgId === "string" ? data.orgId : null,
        projectId: typeof data.projectId === "string" ? data.projectId : null,
      };
    },
  )
  .handler(async ({ context, data }) => {
    const result = await loadEffectivePermissions(
      context.supabase,
      context.userId,
      data.orgId,
      data.projectId,
    );
    return {
      allowed: result.isSuperAdmin || result.permissions.includes(data.perm),
      isSuperAdmin: result.isSuperAdmin,
      perm: data.perm,
    };
  });

/**
 * Middleware factory. Use AFTER `requireSupabaseAuth`:
 *
 *   export const approveInvoice = createServerFn({ method: "POST" })
 *     .middleware([requireSupabaseAuth, requirePermission("invoices.approve")])
 *     .inputValidator(...)
 *     .handler(...);
 *
 * On success it forwards `context.permissions` (Permission[]) and
 * `context.isSuperAdmin` alongside the existing supabase/userId.
 */
export function requirePermission(perm: Permission) {
  return createMiddleware({ type: "function" })
    .middleware([requireSupabaseAuth])
    .server(async (args) => {
      const { next, context } = args;
      const { supabase, userId } = context;
      // Best-effort scope extraction from the raw (not yet validated) input —
      // organization_id / organizationId / orgId and project_id / projectId.
      const raw = (args as { data?: unknown }).data as Record<string, unknown> | undefined;
      const orgId =
        typeof raw?.organization_id === "string"
          ? raw.organization_id
          : typeof raw?.organizationId === "string"
            ? raw.organizationId
            : typeof raw?.orgId === "string"
              ? raw.orgId
              : null;
      const projectId =
        typeof raw?.project_id === "string"
          ? raw.project_id
          : typeof raw?.projectId === "string"
            ? raw.projectId
            : null;
      const result = await loadEffectivePermissions(supabase as SB, userId, orgId, projectId);
      if (!result.isSuperAdmin && !result.permissions.includes(perm)) {
        const err = new Error(`Forbidden: missing permission "${perm}"`);
        (err as Error & { status?: number }).status = 403;
        throw err;
      }
      return next({
        context: {
          permissions: result.permissions,
          isSuperAdmin: result.isSuperAdmin,
        },
      });
    });
}
