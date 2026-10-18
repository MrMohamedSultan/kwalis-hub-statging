// ═══════════════════════════════════════════════════════════════════
// src/lib/rbac.ts
// Phase 8 — compatibility shim over the dynamic RBAC engine.
//
// The legacy localStorage role store, ROLE_TEMPLATES and hardcoded
// role→permission lists are GONE. Permission decisions now resolve from
// the database-driven matrix (roles / role_permissions /
// user_role_assignments) through the Permission State Layer:
//
//   useCan() / useCurrentUser()  →  usePermissions() + useAuthRoles()
//
// Legacy permission strings ("budget.edit", "payroll.execute", …) map
// onto (module_key, action) pairs via LEGACY_PERM_TO_MODULE. Server
// enforcement (rbac-permissions.functions.ts) resolves through the
// SAME mapping and the get_my_permissions RPC — one source of truth.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useMemo } from "react";
import { useAuthRoles } from "@/lib/auth-roles";
import { usePermissions } from "@/lib/permissions/usePermissions";
import {
  canEnterExecutiveWorkMode,
  useExecutiveWorkMode,
} from "@/lib/executive-work-mode";
import { can, type PermissionState } from "@/lib/permissions/types";
import { LEGACY_PERM_TO_MODULE } from "@/lib/permissions/legacy-map";

// ============================================================
// Legacy permission registry — kept as the stable string union
// referenced across the codebase and validated server-side.
// ============================================================
export const PERMISSIONS = {
  "workspace.billing": "Manage Workspace Billing",
  "workspace.subscription": "Edit Global Subscription",
  "workspace.org": "Manage Organizations",

  "system.quotas": "Manage Organization Quotas",
  "system.analytics": "View System-wide Analytics",
  "system.impersonate": "Impersonate Tenant (Support)",

  "users.manage": "Manage Users & Permissions",
  "system.settings": "Edit System Settings",

  "budget.view": "View Master Budget",
  "budget.edit": "Edit Budget Structure",
  "invoices.add": "Add Invoices",
  "invoices.approve": "Approve Invoices",
  "invoices.pay": "Record Invoice Payments",
  "payroll.view": "View Payroll",
  "payroll.approve": "Approve Payroll",
  "payroll.execute": "Execute & Record Payroll Payments",
  "transactions.modify": "Modify/Void Pending Transactions",
  "reports.view": "View Reports Dashboard",
  "reports.export": "Export Reports & Drilldowns",

  "payments.request": "Create Payment Requests",
  "payments.approve": "Approve or Reject Payment Requests",
  "payments.execute": "Execute Payments & Upload Receipts",

  "gl.view": "View GL Chart of Accounts",
  "gl.manage": "Manage GL Chart of Accounts",

  "crew.manage": "Manage Crew & Cast",
  "accounting.view": "View Accounting Module",

  "field.receipts": "Add Field Receipts",
  "pettycash.log": "Request Petty Cash & Log Expenses",
  "pettycash.reconcile": "Reconcile & Approve Petty Cash",

  "files.library": "Access Centralized File Library",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

// ============================================================
// Legacy display-role model — retained only as a display label
// for surfaces that still show a role pill. Authorization never
// reads these values anymore.
// ============================================================
export type Role =
  | "System Owner"
  | "Super Admin"
  | "Admin"
  | "Accountant"
  | "Producer"
  | "Board Member"
  | "Field Crew";

export const ROLES: Role[] = [
  "System Owner",
  "Super Admin",
  "Admin",
  "Accountant",
  "Producer",
  "Board Member",
  "Field Crew",
];

export type RbacUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: Permission[];
  organizationId?: string;
  jobTitle?: string | null;
};

// ============================================================
// Legacy permission resolution over the dynamic matrix.
//   • not ready            → fail closed
//   • super admin / RBAC admin → allow everything
//   • no role assigned     → allow (rollout fallback, mirrors <Can />)
//   • platform-tier perm (unmapped) → admin gate only
//   • otherwise            → the explicit matrix flag decides
// ============================================================
export function legacyPermissionAllowed(state: PermissionState, perm: Permission): boolean {
  if (state.status !== "ready") return false;
  if (state.isSuperAdmin || state.role?.is_admin) return true;
  if (!state.role) return true; // rollout fallback — unassigned users keep legacy UI
  const target = LEGACY_PERM_TO_MODULE[perm];
  if (!target) return false; // platform-tier capability: admins only
  return can(state, target[0], target[1]);
}

// ============================================================
// Hooks
// ============================================================

/** Action-level gate: `const canDo = useCan(); canDo("budget.edit")`. */
export function useCan(): (perm: Permission) => boolean {
  const perms = usePermissions();
  const roles = useAuthRoles();
  const workMode = useExecutiveWorkMode(roles.userId);
  const operationalOverride =
    workMode && roles.loaded && canEnterExecutiveWorkMode(roles, perms);
  return useCallback(
    (perm: Permission) => {
      if (!roles.loaded || !roles.userId) return false;
      if (roles.isSuperAdmin) return true;
      if (operationalOverride && (roles.isAdmin || roles.adminOrgIds.length > 0)) return true;
      return legacyPermissionAllowed(perms, perm);
    },
    [operationalOverride, perms, roles],
  );
}

export function useHasPermission(perm: Permission): boolean {
  const canDo = useCan();
  return canDo(perm);
}

/**
 * The signed-in identity with a display role label and the resolved
 * legacy permission set (derived live from the dynamic matrix).
 */
export function useCurrentUser(): RbacUser {
  const roles = useAuthRoles();
  const perms = usePermissions();
  const workMode = useExecutiveWorkMode(roles.userId);
  const operationalOverride =
    workMode && roles.loaded && canEnterExecutiveWorkMode(roles, perms);

  return useMemo(() => {
    const signedIn = roles.loaded && !!roles.userId;

    let role: Role = "Field Crew";
    if (signedIn) {
      if (roles.isSuperAdmin) role = "System Owner";
      else if (!operationalOverride && (perms.isExecutive || roles.executiveTitle))
        role = "Board Member";
      else if (perms.isAdmin || roles.isAdmin || roles.adminOrgIds.length > 0) role = "Admin";
      else role = "Producer";
    }

    const permissions: Permission[] = !signedIn
      ? []
      : roles.isSuperAdmin ||
          (operationalOverride && (roles.isAdmin || roles.adminOrgIds.length > 0))
        ? [...ALL_PERMISSIONS]
        : ALL_PERMISSIONS.filter((p) => legacyPermissionAllowed(perms, p));

    return {
      id: roles.userId ?? "anonymous",
      name: roles.displayName ?? "",
      email: roles.email ?? "",
      role,
      permissions,
      organizationId: roles.adminOrgIds[0] ?? roles.memberOrgIds[0],
      jobTitle: roles.jobTitle,
    };
  }, [roles, perms, operationalOverride]);
}

/**
 * Roles the current user may grant to others. Tenant admins must never
 * see or assign platform-tier roles.
 */
export function useAssignableRoles(): Role[] {
  const { isSuperAdmin } = useAuthRoles();
  return ROLES.filter((r) => isSuperAdmin || (r !== "System Owner" && r !== "Super Admin"));
}
