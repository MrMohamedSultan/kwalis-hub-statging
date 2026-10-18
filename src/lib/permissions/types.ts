// ═══════════════════════════════════════════════════════════════════
// src/lib/permissions/types.ts
// Phase 4 — Permission State Layer (client).
//
// Pure types + the synchronous `can()` resolver. This module has NO
// React, Supabase, or browser imports so it stays usable from tests,
// server functions, route guards, and components alike.
//
// Fail-closed contract: anything unknown (loading, error, missing
// module, missing role) resolves to DENY. Access is only ever granted
// by an explicit server-verified row.
// ═══════════════════════════════════════════════════════════════════

/** The five granular actions a role can hold on a module. */
export type PermissionAction = "view" | "create" | "edit" | "delete" | "export";

/** Mirrors public.roles.layout_type. */
export type LayoutType = "operational" | "executive";

/** The role payload returned by public.get_my_permissions(). */
export interface PermissionRole {
  id: string;
  name: string;
  slug: string;
  layout_type: LayoutType;
  is_admin: boolean;
}

/** One row of the resolved role × module matrix (can_view rows only). */
export interface ModulePermission {
  module_key: string;
  label: string;
  icon: string | null;
  route_path: string | null;
  parent_key: string | null;
  sort_order: number;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

export type PermissionStatus = "loading" | "ready" | "error";

/** The fully-resolved, client-side permission snapshot. */
export interface PermissionState {
  status: PermissionStatus;
  /** Null when the user has no operational role assignment (fail-closed). */
  role: PermissionRole | null;
  /** Platform super-admin bridge (Phase 2 safety net). */
  isSuperAdmin: boolean;
  /** Ordered by module sort_order, exactly as the server returned them. */
  permissions: ModulePermission[];
  /** O(1) lookup index derived from `permissions`. */
  byModule: Record<string, ModulePermission>;
}

export const EMPTY_PERMISSION_STATE: PermissionState = {
  status: "loading",
  role: null,
  isSuperAdmin: false,
  permissions: [],
  byModule: {},
};

const ACTION_FLAG: Record<PermissionAction, keyof ModulePermission> = {
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
  delete: "can_delete",
  export: "can_export",
};

/** Raw payload shape produced by the queries layer. */
export interface MyPermissionsPayload {
  role: PermissionRole | null;
  permissions: ModulePermission[];
  isSuperAdmin: boolean;
}

/** Build the ready-state snapshot (with lookup index) from a server payload. */
export function buildPermissionState(payload: MyPermissionsPayload): PermissionState {
  const byModule: Record<string, ModulePermission> = {};
  for (const p of payload.permissions) byModule[p.module_key] = p;
  return {
    status: "ready",
    role: payload.role,
    isSuperAdmin: payload.isSuperAdmin,
    permissions: payload.permissions,
    byModule,
  };
}

/**
 * Pure synchronous permission check.
 *
 * Resolution order (first match wins):
 *   1. State not ready        → false (never decide on a loading race)
 *   2. Platform super admin   → true
 *   3. RBAC admin role        → true
 *   4. Unknown module         → false (fail closed)
 *   5. Write/export action without can_view → false (implication invariant)
 *   6. The explicit matrix flag
 */
export function can(
  state: PermissionState,
  moduleKey: string,
  action: PermissionAction = "view",
): boolean {
  if (state.status !== "ready") return false;
  if (state.isSuperAdmin) return true;
  if (state.role?.is_admin) return true;
  const mod = state.byModule[moduleKey];
  if (!mod) return false;
  if (action !== "view" && !mod.can_view) return false;
  return Boolean(mod[ACTION_FLAG[action]]);
}
