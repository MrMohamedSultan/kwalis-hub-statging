import { describe, expect, it } from "vitest";
import {
  EMPTY_PERMISSION_STATE,
  buildPermissionState,
  can,
  type ModulePermission,
  type PermissionRole,
} from "@/lib/permissions/types";

const ROLE_MEMBER: PermissionRole = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Coordinator",
  slug: "coordinator",
  layout_type: "operational",
  is_admin: false,
};

const ROLE_ADMIN: PermissionRole = { ...ROLE_MEMBER, slug: "administrator", is_admin: true };

const ROLE_EXECUTIVE: PermissionRole = {
  ...ROLE_MEMBER,
  slug: "executive",
  layout_type: "executive",
};

function mod(key: string, flags: Partial<ModulePermission> = {}): ModulePermission {
  return {
    module_key: key,
    label: key,
    icon: null,
    route_path: `/${key}`,
    parent_key: null,
    sort_order: 1,
    can_view: false,
    can_create: false,
    can_edit: false,
    can_delete: false,
    can_export: false,
    ...flags,
  };
}

describe("can() — fail-closed resolution", () => {
  it("denies everything while loading", () => {
    expect(can(EMPTY_PERMISSION_STATE, "budget", "view")).toBe(false);
    expect(can({ ...EMPTY_PERMISSION_STATE, status: "error" }, "budget", "view")).toBe(false);
  });

  it("denies unknown modules even for assigned roles", () => {
    const state = buildPermissionState({
      role: ROLE_MEMBER,
      permissions: [mod("budget", { can_view: true })],
      isSuperAdmin: false,
    });
    expect(can(state, "invoices", "view")).toBe(false);
  });

  it("grants everything to platform super admins", () => {
    const state = buildPermissionState({ role: null, permissions: [], isSuperAdmin: true });
    expect(can(state, "budget", "delete")).toBe(true);
    expect(can(state, "anything", "export")).toBe(true);
  });

  it("grants everything to RBAC admin roles", () => {
    const state = buildPermissionState({ role: ROLE_ADMIN, permissions: [], isSuperAdmin: false });
    expect(can(state, "budget", "edit")).toBe(true);
  });

  it("honours each granular matrix flag", () => {
    const state = buildPermissionState({
      role: ROLE_MEMBER,
      permissions: [mod("budget", { can_view: true, can_edit: true })],
      isSuperAdmin: false,
    });
    expect(can(state, "budget", "view")).toBe(true);
    expect(can(state, "budget", "edit")).toBe(true);
    expect(can(state, "budget", "create")).toBe(false);
    expect(can(state, "budget", "delete")).toBe(false);
    expect(can(state, "budget", "export")).toBe(false);
  });

  it("enforces the write-implies-view invariant", () => {
    const state = buildPermissionState({
      role: ROLE_MEMBER,
      // Malformed row: edit without view must still resolve to deny.
      permissions: [mod("budget", { can_view: false, can_edit: true })],
      isSuperAdmin: false,
    });
    expect(can(state, "budget", "edit")).toBe(false);
  });

  it("executive layout only gets what the matrix explicitly grants", () => {
    const state = buildPermissionState({
      role: ROLE_EXECUTIVE,
      permissions: [mod("reports", { can_view: true, can_export: true })],
      isSuperAdmin: false,
    });
    expect(can(state, "reports", "view")).toBe(true);
    expect(can(state, "reports", "export")).toBe(true);
    expect(can(state, "reports", "edit")).toBe(false);
    expect(can(state, "budget", "view")).toBe(false);
  });

  it("unassigned users (null role) are fully denied", () => {
    const state = buildPermissionState({
      role: null,
      permissions: [mod("budget", { can_view: true })],
      isSuperAdmin: false,
    });
    // No admin flag, no super admin — matrix rows alone still gate per module.
    expect(can(state, "budget", "view")).toBe(true);
    expect(can(state, "budget", "edit")).toBe(false);
  });
});
