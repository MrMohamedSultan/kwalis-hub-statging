import { describe, expect, it } from "vitest";
import { sectionsToCSV } from "@/lib/export-csv";

describe("sectionsToCSV (G04)", () => {
  it("prints each table under its title with money formatted", () => {
    const csv = sectionsToCSV([
      {
        title: "Summary",
        rows: [{ Metric: "Total Paid", Value: "1,250.00" }],
        opts: { raw: ["Value"] },
      },
      {
        title: "Payments",
        rows: [{ Date: "2026-10-01", Amount: 1250 }],
        opts: { money: ["Amount"] },
      },
      { title: "Invoices", rows: [], emptyText: "(no rows)" },
    ]);
    expect(csv).toBe(
      [
        "# Summary",
        "Metric,Value",
        'Total Paid,"1,250.00"',
        "",
        "# Payments",
        "Date,Amount",
        '2026-10-01,"1,250.00"',
        "",
        "# Invoices",
        "(no rows)",
      ].join("\n"),
    );
  });
});
