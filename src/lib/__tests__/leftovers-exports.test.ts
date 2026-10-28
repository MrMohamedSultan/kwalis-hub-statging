// G02 / G03: logos on hand-built workbooks and the ledger table as a ReportDoc.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { addWorkbookLogo, planWorkbookLogo, reportPdfTables } from "@/lib/export/xlsx-report";
import { ledgerReportDoc } from "@/features/reports/ledger/ledger-export";

const logo = `data:image/png;base64,${readFileSync(join(process.cwd(), "public", "kwalis-icon.png")).toString("base64")}`;

describe("planWorkbookLogo", () => {
  it("fits the logo in the box and keeps its ratio", () => {
    const plan = planWorkbookLogo(
      ["A", "B"],
      { col: 6, row: 0, maxWidth: 120, maxHeight: 40 },
      {
        width: 400,
        height: 100,
      },
    );
    expect(plan).toEqual([
      { sheet: "A", ext: { width: 120, height: 30 } },
      { sheet: "B", ext: { width: 120, height: 30 } },
    ]);
  });
  it("only stamps the named sheets, and nothing without a logo", () => {
    expect(
      planWorkbookLogo(["A", "B"], { col: 0, row: 0, sheets: ["B"] }, { width: 10, height: 10 }),
    ).toHaveLength(1);
    expect(planWorkbookLogo(["A"], { col: 0, row: 0 }, null)).toEqual([]);
  });
  it("adds the image to the workbook sheets", () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("One");
    wb.addWorksheet("Two");
    expect(addWorkbookLogo(wb, logo, { col: 2, row: 0, sheets: ["Two"] })).toBe(1);
    expect(wb.getWorksheet("Two")!.getImages()).toHaveLength(1);
    expect(wb.getWorksheet("One")!.getImages()).toHaveLength(0);
    expect(addWorkbookLogo(wb, null, { col: 0, row: 0 })).toBe(0);
  });
});

describe("ledgerReportDoc", () => {
  it("types amount columns as money (2 decimals in the files)", () => {
    const doc = ledgerReportDoc({
      title: "General Ledger",
      subtitle: "MON26",
      headers: ["Date", "Account", "Debit", "Credit"],
      rows: [["2026-10-01", "5100", 1234.5, 0]],
      numericColumns: [2, 3],
    });
    expect(doc.sections[0].columns.map((c) => c.type)).toEqual(["text", "text", "money", "money"]);
    expect(reportPdfTables(doc)[0].rows[0]).toEqual(["2026-10-01", "5100", "1,234.50", "0.00"]);
  });
});
