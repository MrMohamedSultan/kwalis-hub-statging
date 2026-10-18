import { describe, it, expect, vi } from "vitest";

// project-role.ts imports the Supabase client, store, and auth-roles at
// module scope — stub them so the pure gating logic can be tested in Node.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    auth: { onAuthStateChange: vi.fn(), getUser: vi.fn() },
  },
}));
vi.mock("@/lib/store", () => ({
  useStore: Object.assign(vi.fn(), { getState: () => ({ activeProjectId: null, projects: [] }) }),
}));
vi.mock("@/lib/auth-roles", () => ({
  useAuthRoles: () => ({ loaded: false, userId: null, adminOrgIds: [], isSuperAdmin: false }),
}));

import {
  isPathAllowedForProjectRole,
  isSectionAllowedForProjectRole,
  PROJECT_ROLE_SECTIONS,
  PROJECT_ROLES,
} from "@/lib/project-role";

const FULL_ACCESS_ROLES = ["owner", "admin", "producer", "member"] as const;

describe("project role section allowlist", () => {
  it("coordinator sees only overview + payroll-crew", () => {
    expect(PROJECT_ROLE_SECTIONS.coordinator).toEqual(["overview", "payroll-crew"]);
  });

  it.each([...FULL_ACCESS_ROLES])("%s is unrestricted (null allowlist)", (role) => {
    expect(PROJECT_ROLE_SECTIONS[role]).toBeNull();
  });
});

describe("isSectionAllowedForProjectRole", () => {
  it.each([
    "budget-reporting",
    "procurement-payables",
    "treasury-cash",
    "production-logistics",
    "directories-admin",
  ])("hides %s from coordinators", (section) => {
    expect(isSectionAllowedForProjectRole(section, "coordinator")).toBe(false);
  });

  it.each(["overview", "payroll-crew"])("shows %s to coordinators", (section) => {
    expect(isSectionAllowedForProjectRole(section, "coordinator")).toBe(true);
  });

  it.each([...FULL_ACCESS_ROLES])("shows every section to %s", (role) => {
    for (const section of ["budget-reporting", "procurement-payables", "treasury-cash"]) {
      expect(isSectionAllowedForProjectRole(section, role)).toBe(true);
    }
  });
});

describe("isPathAllowedForProjectRole — coordinator", () => {
  it.each([
    "/budget",
    "/top-sheet-report",
    "/budget-reconciliation",
    "/reports",
    "/vendors",
    "/purchase-orders",
    "/invoices",
    "/vendor-payables",
    "/crew-cast-payables",
    "/payment-approvals",
    "/petty-cash",
    "/funding",
    "/gl-accounts",
    "/locations",
    "/production-timeline",
    "/daily-transport",
    "/accommodation-roster",
    "/car-rentals",
    "/picture-assets",
    "/characters",
    "/series",
    "/project-files",
    "/audit-log",
  ])("blocks %s", (path) => {
    expect(isPathAllowedForProjectRole(path, "coordinator")).toBe(false);
  });

  it.each([
    "/dashboard",
    "/crew",
    "/cast",
    "/payroll-hub",
    "/per-diem-ledger",
    "/main-hub",
    "/notifications",
    "/settings",
    "/account-settings",
    "/support",
  ])("allows %s", (path) => {
    expect(isPathAllowedForProjectRole(path, "coordinator")).toBe(true);
  });
});

describe("isPathAllowedForProjectRole — unrestricted roles", () => {
  it.each([...FULL_ACCESS_ROLES])("%s can visit finance routes", (role) => {
    for (const path of ["/budget", "/invoices", "/petty-cash", "/reports"]) {
      expect(isPathAllowedForProjectRole(path, role)).toBe(true);
    }
  });
});

describe("role registry", () => {
  it("includes the production roles used by the members panel", () => {
    for (const r of ["owner", "admin", "producer", "coordinator", "member"]) {
      expect(PROJECT_ROLES).toContain(r);
    }
  });
});
