import { describe, it, expect } from "vitest";
import {
  BOARD_NAV_ITEMS,
  executiveRedirectFor,
  isPathAllowedForExecutive,
  legacyBoardPortalTarget,
} from "@/lib/board-access";

describe("board member shell (206)", () => {
  it("sidebar is Dashboard, Budget, Timeline, Cash flow, Notifications", () => {
    expect(BOARD_NAV_ITEMS.map((i) => i.to)).toEqual([
      "/dashboard",
      "/budget",
      "/production-timeline",
      "/funding",
      "/notifications",
    ]);
  });

  it.each([
    "/",
    "/dashboard",
    "/budget",
    "/budget/",
    "/production-timeline",
    "/funding",
    "/notifications",
    "/main-hub",
    "/account-settings",
    "/support",
    "/no-access",
    "/executive",
  ])("allows %s", (path) => {
    expect(isPathAllowedForExecutive(path)).toBe(true);
    expect(executiveRedirectFor(path, "Board Member")).toBeNull();
  });

  it.each([
    "/budget-reconciliation",
    "/top-sheet-report",
    "/reports",
    "/invoices",
    "/payment-approvals",
    "/petty-cash",
    "/crew",
    "/settings",
    "/role-management",
    "/trash",
    "/timeline-task-dictionary",
    "/funding-x",
  ])("blocks %s and sends to the dashboard", (path) => {
    expect(isPathAllowedForExecutive(path)).toBe(false);
    expect(executiveRedirectFor(path, "Board Member")).toBe("/dashboard");
    expect(executiveRedirectFor(path, "CFO")).toBe("/dashboard");
  });

  it("does not restrict members without a title", () => {
    expect(executiveRedirectFor("/invoices", null)).toBeNull();
    expect(executiveRedirectFor("/invoices", undefined)).toBeNull();
  });

  it("forwards old /board portal links into the main app", () => {
    expect(legacyBoardPortalTarget("/board/dashboard")).toEqual({ to: "/dashboard" });
    expect(legacyBoardPortalTarget("/board/budget-review")).toEqual({
      to: "/budget",
      search: { focus: "governance" },
    });
    expect(legacyBoardPortalTarget("/board/settings")).toEqual({ to: "/account-settings" });
    expect(legacyBoardPortalTarget("/board")).toEqual({ to: "/dashboard" });
  });
});
