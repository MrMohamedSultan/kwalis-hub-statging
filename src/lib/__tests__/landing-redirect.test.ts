import { describe, it, expect } from "vitest";
import {
  ADMIN_LANDING,
  ORG_LANDING,
  entryRedirectFor,
  landingPathForRoles,
} from "@/lib/landing-redirect";

const superAdmin = { isSuperAdmin: true };
const member = { isSuperAdmin: false };

describe("role-based landing", () => {
  it("sends super admins to the isolated admin dashboard", () => {
    expect(landingPathForRoles(superAdmin)).toBe(ADMIN_LANDING);
  });

  it("sends every other role to the project gateway", () => {
    expect(landingPathForRoles(member)).toBe(ORG_LANDING);
    expect(landingPathForRoles({ isSuperAdmin: false })).toBe("/main-hub");
  });
});

describe("org entry redirects", () => {
  it.each(["/", "/dashboard", "/main-hub"])("bounces super admins off entry path %s", (path) => {
    expect(entryRedirectFor(path, superAdmin)).toBe(ADMIN_LANDING);
  });

  it.each(["/", "/dashboard", "/main-hub"])("keeps non super admins on %s", (path) => {
    expect(entryRedirectFor(path, member)).toBeNull();
  });

  it("never rewrites deep org links", () => {
    for (const path of ["/budget", "/reports", "/payroll", "/dashboard/x"]) {
      expect(entryRedirectFor(path, superAdmin)).toBeNull();
      expect(entryRedirectFor(path, member)).toBeNull();
    }
  });
});
