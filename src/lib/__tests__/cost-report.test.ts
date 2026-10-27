import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  categoryOf,
  costReportTotals,
  finalReportSummary,
  fromRpcRow,
  groupCostReport,
} from "@/lib/cost-report";

const rows = [
  {
    group: "ATL",
    budget_code: "1101",
    description: "Writers",
    gl_code: "GL-1000",
    gl_name: "Story",
    budget: 20000,
    actual: 4000,
    commitment: 6000,
    remaining: 10000,
    etc: 10000,
    efc: 20000,
    variance: 0,
    paid_to_date: 0,
    payable: 4000,
  },
  {
    group: "ATL",
    budget_code: "1002",
    description: "Producer",
    gl_code: "GL-1000",
    gl_name: "Story",
    budget: 3750,
    actual: 0,
    commitment: 0,
    remaining: 3750,
    etc: 3750,
    efc: 3750,
    variance: 0,
    paid_to_date: 0,
    payable: 0,
  },
  {
    group: "Production",
    budget_code: "2101",
    description: "Camera",
    gl_code: "GL-2100",
    gl_name: "Camera",
    budget: 40000,
    actual: 3000,
    commitment: 4000,
    remaining: 33000,
    etc: 40000,
    efc: 47000,
    variance: -7000,
    paid_to_date: 2000,
    payable: 1000,
    etc_is_manual: true,
  },
  {
    group: null,
    budget_code: null,
    description: null,
    gl_code: null,
    gl_name: null,
    budget: 0,
    actual: 0,
    commitment: 0,
    remaining: 0,
    etc: 0,
    efc: 0,
    variance: 0,
    paid_to_date: 400,
    payable: -400,
  },
].map(fromRpcRow);

describe("cost report groupings (R06)", () => {
  it("categories: Production is BTL", () => {
    expect(categoryOf("Production")).toBe("BTL");
    expect(categoryOf("Post")).toBe("Post");
    expect(categoryOf(null)).toBe("Other");
  });
  it("every grouping has the same totals (X07)", () => {
    const totals = (["line", "account", "category"] as const).map((g) => {
      const t = costReportTotals(groupCostReport(rows, g));
      return [t.budget, t.actual, t.commitment, t.efc, t.variance, t.paidToDate];
    });
    expect(totals[0]).toEqual([63750, 7000, 10000, 70750, -7000, 2400]);
    expect(totals[1]).toEqual(totals[0]);
    expect(totals[2]).toEqual(totals[0]);
  });
  it("account grouping sums the codes of one account", () => {
    const g = groupCostReport(rows, "account").find((r) => r.code === "GL-1000")!;
    expect([g.budget, g.actual, g.pctSpent]).toEqual([23750, 4000, 16.84]);
  });
  it("only code rows are editable in the line view", () => {
    const g = groupCostReport(rows, "line");
    expect(g.find((r) => r.code === "2101")).toMatchObject({ editable: true, etcIsManual: true });
    expect(g.find((r) => r.code === null)?.editable).toBe(false);
    expect(groupCostReport(rows, "category").every((r) => !r.editable)).toBe(true);
  });
  it("final report summary keeps its shape with glossary numbers", () => {
    const s = finalReportSummary(rows, ["ATL", "BTL", "Post", "VFX", "Music", "Other"]);
    expect(s.rows.find((r) => r.group === "BTL")).toMatchObject({
      actualPaid: 3000,
      commitments: 4000,
      efc: 47000,
    });
    expect(s.totals.actualPaid).toBe(7000);
  });
});
