import { describe, expect, it } from "vitest";
import {
  REPORT_GROUPS,
  allowedReportGroups,
  groupOf,
  resolveSelection,
  searchReports,
} from "@/features/reports/report-groups";

const ALL = ["cost", "payables", "cash", "accounting", "commission"];

describe("report groups (N01–N13)", () => {
  it("puts all 19 reports in exactly one group, defaults first", () => {
    const ids = REPORT_GROUPS.flatMap((g) => [...g.reports]);
    expect(ids).toHaveLength(19);
    expect(new Set(ids).size).toBe(19);
    expect(REPORT_GROUPS.map((g) => g.reports[0])).toEqual([
      "cost",
      "due",
      "cashpos",
      "ledger",
      "rebate",
    ]);
    expect(groupOf("aging")).toBe("payables");
    expect(groupOf("nope")).toBeNull();
  });

  const base = {
    matrixActive: false,
    canView: () => false,
    heldModules: [] as string[],
    isAdmin: false,
    projectRole: null,
  };

  it("admins and unrestricted users see every group", () => {
    expect(allowedReportGroups({ ...base, isAdmin: true })).toEqual(ALL);
    expect(allowedReportGroups(base)).toEqual(ALL);
  });

  it("a producer does not see Accounting or Cash (legacy project role)", () => {
    const g = allowedReportGroups({ ...base, projectRole: "producer" });
    expect(g).not.toContain("accounting");
    expect(g).not.toContain("cash");
    expect(g).toContain("cost");
    expect(allowedReportGroups({ ...base, projectRole: "coordinator" })).toEqual([]);
  });

  it("role matrix: per-group modules decide; empty groups are hidden", () => {
    const held = ["reports", "reports-budget-cost", "reports-commission"];
    const g = allowedReportGroups({
      ...base,
      matrixActive: true,
      heldModules: held,
      canView: (k) => held.includes(k),
    });
    expect(g).toEqual(["cost", "commission"]);
  });

  it("role matrix without the group modules on the server: Reports covers all", () => {
    expect(
      allowedReportGroups({
        ...base,
        matrixActive: true,
        heldModules: ["reports"],
        canView: (k) => k === "reports",
      }),
    ).toEqual(ALL);
    expect(allowedReportGroups({ ...base, matrixActive: true })).toEqual([]);
  });

  it("direct links open the group + report, or deny", () => {
    expect(resolveSelection(ALL as never, { report: "aging" })).toEqual({
      group: "payables",
      report: "aging",
      denied: false,
    });
    expect(resolveSelection(["cost"], { report: "tb" }).denied).toBe(true);
    expect(resolveSelection(["cost"], { group: "accounting" }).denied).toBe(true);
    expect(resolveSelection(ALL as never, { group: "cash" }).report).toBe("cashpos");
    expect(resolveSelection([], {}).denied).toBe(true);
  });

  it("remembered choice is used only when still allowed", () => {
    expect(resolveSelection(ALL as never, {}, { group: "accounting", report: "tb" })).toEqual({
      group: "accounting",
      report: "tb",
      denied: false,
    });
    expect(resolveSelection(["cost"], {}, { group: "accounting", report: "tb" }).report).toBe(
      "cost",
    );
  });

  it("search matches English or Arabic names, only in allowed groups", () => {
    const names = { aging: ["AP Aging", "أعمار الذمم"], tb: ["Trial Balance", "ميزان المراجعة"] };
    expect(searchReports("aging", names, ALL as never)).toEqual(["aging"]);
    expect(searchReports("أعمار", names, ALL as never)).toEqual(["aging"]);
    expect(searchReports("trial", names, ["cost"])).toEqual([]);
  });
});
