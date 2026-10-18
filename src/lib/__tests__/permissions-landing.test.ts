// Phase 5 — Layout & Routing Isolation: landing-derivation tests.
import { describe, expect, it } from "vitest";
import {
  buildPermissionState,
  EMPTY_PERMISSION_STATE,
  type ModulePermission,
  type PermissionRole,
} from "@/lib/permissions/types";
import {
  EXECUTIVE_HOME,
  NO_ACCESS_PATH,
  OPERATIONAL_FALLBACK,
  firstViewableModulePath,
  isExecutivePath,
  viewableOperationalModules,
} from "@/lib/permissions/landing";
import { canEnterExecutiveWorkMode } from "@/lib/executive-work-mode";
import type { AuthRolesSnapshot } from "@/lib/auth-roles";

const OPS_ROLE: PermissionRole = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Producer",
  slug: "producer",
  layout_type: "operational",
  is_admin: false,
};

function mod(partial: Partial<ModulePermission> & { module_key: string }): ModulePermission {
  return {
    label: partial.module_key,
    icon: null,
    route_path: `/${partial.module_key}`,
    parent_key: null,
    sort_order: 1,
    can_view: true,
    can_create: false,
    can_edit: false,
    can_delete: false,
    can_export: false,
    ...partial,
  };
}

function stateWith(
  permissions: ModulePermission[],
  role: PermissionRole | null = OPS_ROLE,
  isSuperAdmin = false,
) {
  return buildPermissionState({ role, permissions, isSuperAdmin });
}

describe("isExecutivePath", () => {
  it("matches the executive namespace only", () => {
    expect(isExecutivePath("/executive")).toBe(true);
    expect(isExecutivePath("/executive/reports")).toBe(true);
    expect(isExecutivePath("/executivex")).toBe(false);
    expect(isExecutivePath("/dashboard")).toBe(false);
  });
});

describe("firstViewableModulePath", () => {
  it("fails closed while loading", () => {
    expect(firstViewableModulePath(EMPTY_PERMISSION_STATE)).toBeNull();
  });

  it("returns the first viewable module by sort_order", () => {
    const state = stateWith([
      mod({ module_key: "funding", route_path: "/funding", sort_order: 2 }),
      mod({ module_key: "budget", route_path: "/budget", sort_order: 1 }),
      mod({ module_key: "dashboard", route_path: "/dashboard", sort_order: 0 }),
    ]);
    expect(firstViewableModulePath(state)).toBe("/dashboard");
  });

  it("skips non-viewable rows and rows without a route", () => {
    const state = stateWith([
      mod({ module_key: "dashboard", route_path: "/dashboard", sort_order: 0, can_view: false }),
      mod({ module_key: "header", route_path: null, sort_order: 1 }),
      mod({ module_key: "budget", route_path: "/budget", sort_order: 2 }),
    ]);
    expect(firstViewableModulePath(state)).toBe("/budget");
  });

  it("excludes the executive /board namespace from operational landings", () => {
    const state = stateWith([
      mod({
        module_key: "executive-dashboard",
        route_path: "/board/dashboard",
        sort_order: 0,
      }),
      mod({ module_key: "budget", route_path: "/budget", sort_order: 1 }),
    ]);
    expect(firstViewableModulePath(state)).toBe("/budget");
    expect(viewableOperationalModules(state)).toHaveLength(1);
  });

  it("returns null for a non-admin role with zero viewable modules", () => {
    expect(firstViewableModulePath(stateWith([]))).toBeNull();
  });

  it("bridges admins and super admins to the operational fallback", () => {
    const adminRole: PermissionRole = { ...OPS_ROLE, slug: "administrator", is_admin: true };
    expect(firstViewableModulePath(stateWith([], adminRole))).toBe(OPERATIONAL_FALLBACK);
    expect(firstViewableModulePath(stateWith([], null, true))).toBe(OPERATIONAL_FALLBACK);
  });
});

describe("Phase 5 constants", () => {
  it("are distinct paths", () => {
    expect(EXECUTIVE_HOME).toBe("/executive");
    expect(NO_ACCESS_PATH).toBe("/no-access");
    expect(new Set([EXECUTIVE_HOME, NO_ACCESS_PATH, OPERATIONAL_FALLBACK]).size).toBe(3);
  });
});

describe("executive work-mode eligibility", () => {
  const roles: AuthRolesSnapshot = {
    userId: "22222222-2222-2222-2222-222222222222",
    email: null,
    displayName: null,
    jobTitle: null,
    executiveTitle: null,
    isSuperAdmin: false,
    isAdmin: false,
    adminOrgIds: [],
    memberOrgIds: [],
  };

  it("keeps executive-only accounts in the executive workspace", () => {
    const executiveOnly = stateWith([
      mod({ module_key: "executive-dashboard", route_path: "/board/dashboard" }),
    ]);
    expect(canEnterExecutiveWorkMode(roles, executiveOnly)).toBe(false);
  });

  it("allows organization admins and executives with operational module access", () => {
    expect(
      canEnterExecutiveWorkMode({ ...roles, adminOrgIds: ["org-1"] }, stateWith([])),
    ).toBe(true);
    expect(
      canEnterExecutiveWorkMode(
        roles,
        stateWith([mod({ module_key: "dashboard", route_path: "/dashboard" })]),
      ),
    ).toBe(true);
  });
});
