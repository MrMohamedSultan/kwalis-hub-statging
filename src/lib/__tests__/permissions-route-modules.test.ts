// Phase 6 — route → module mapping contract tests.
import { describe, it, expect } from "vitest";
import { moduleKeyForPath } from "../permissions/route-modules";

describe("moduleKeyForPath", () => {
  it("maps exact operational routes to registry keys", () => {
    expect(moduleKeyForPath("/dashboard")).toBe("dashboard");
    expect(moduleKeyForPath("/budget")).toBe("budget");
    expect(moduleKeyForPath("/crew")).toBe("crew-contracts");
    expect(moduleKeyForPath("/cast")).toBe("cast-contracts");
    expect(moduleKeyForPath("/project-files")).toBe("file-library");
    expect(moduleKeyForPath("/payment-approvals")).toBe("payment-approvals");
    expect(moduleKeyForPath("/settings")).toBe("system-settings");
  });

  it("matches nested/dynamic paths by longest prefix", () => {
    expect(moduleKeyForPath("/series/abc-123")).toBe("series");
    expect(moduleKeyForPath("/budget/some-child")).toBe("budget");
  });

  it("does not confuse sibling prefixes", () => {
    expect(moduleKeyForPath("/payroll-hub")).toBe("payroll-hub");
    expect(moduleKeyForPath("/payroll")).toBe("payroll");
    expect(moduleKeyForPath("/crew-payroll")).toBe("crew-payroll");
    expect(moduleKeyForPath("/crew")).toBe("crew-contracts");
  });

  it("leaves gateway, holding, executive and board paths ungated", () => {
    expect(moduleKeyForPath("/main-hub")).toBeNull();
    expect(moduleKeyForPath("/no-access")).toBeNull();
    expect(moduleKeyForPath("/executive")).toBeNull();
    expect(moduleKeyForPath("/board/dashboard")).toBeNull();
  });

  it("returns null for unknown paths (fail-safe, not fail-blocking)", () => {
    expect(moduleKeyForPath("/definitely-not-a-route")).toBeNull();
    expect(moduleKeyForPath("/")).toBeNull();
  });
});
