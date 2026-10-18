import { describe, expect, it } from "vitest";
import { buildBudgetWorkbook, type BudgetLine } from "@/lib/excelAdapter";

function line(over: Partial<BudgetLine>): BudgetLine {
  return {
    group: "ATL",
    header_code: "1000",
    header_name: "DEVELOPMENT COSTS",
    main_code: "1001",
    account_name: "Story Rights",
    name: "Writer",
    prep: 1,
    shooting: 0,
    wrap: 0,
    total: 1,
    unit: "Flat",
    amount: 1,
    rate: 1000,
    currency: "SAR",
    notes: "",
    ...over,
  };
}

const rows: BudgetLine[] = [
  line({}),
  line({ main_code: "1002", account_name: "Script", rate: 2500 }),
  line({
    group: "BTL",
    header_code: "2100",
    header_name: "PRODUCTION STAFF",
    main_code: "2101",
    account_name: "Line Producer",
    rate: 500,
    total: 10,
  }),
  line({
    group: "POST",
    header_code: "5000",
    header_name: "POST PRODUCTION",
    main_code: "5001",
    account_name: "Editor",
    currency: "USD",
    rate: 300,
    total: 5,
  }),
  line({
    group: "OTHER",
    header_code: "8000",
    header_name: "OTHER",
    main_code: "8001",
    account_name: "Insurance",
    rate: 75000,
  }),
];

describe("excelAdapter — multi-sheet export", () => {
  it("creates the Top Sheet plus one sheet per group", async () => {
    const wb = await buildBudgetWorkbook(rows, {
      projectTitle: "Test Feature",
      budgetVersion: "v1.2",
    });
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe("Top Sheet");
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(new Set(names).size).toBe(names.length);
  });

  it("writes the project title into the Top Sheet header", async () => {
    const wb = await buildBudgetWorkbook(rows, { projectTitle: "Test Feature" });
    const title = String(wb.getWorksheet("Top Sheet")!.getCell("A1").value ?? "");
    expect(title).toContain("Test Feature");
  });

  it("emits SUM formulas for subtotal rows on data sheets", async () => {
    const wb = await buildBudgetWorkbook(rows, {});
    const formulas: string[] = [];
    wb.eachSheet((ws) => {
      if (ws.name === "Top Sheet") return;
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const v = cell.value as { formula?: string } | null;
          if (v && typeof v === "object" && typeof v.formula === "string") {
            formulas.push(v.formula);
          }
        });
      });
    });
    expect(formulas.length).toBeGreaterThan(0);
    expect(formulas.every((f) => /^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/.test(f))).toBe(true);
  });

  it("produces a readable xlsx buffer with no empty sheets", async () => {
    const wb = await buildBudgetWorkbook(rows, { projectTitle: "Buffer Test" });
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);
    wb.eachSheet((ws) => expect(ws.rowCount).toBeGreaterThan(0));
  });

  it("handles an empty budget without throwing", async () => {
    const wb = await buildBudgetWorkbook([], { projectTitle: "Empty" });
    expect(wb.getWorksheet("Top Sheet")).toBeTruthy();
  });
});
