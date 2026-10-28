import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseKwalisTemplatePreview } from "@/lib/excelTemplate";
import {
  checkHeaderMain,
  cleanImportedBudget,
  cleanText,
  describeWorkbookError,
  lineTotal,
  parseImportNumber,
  round2,
  toImportRpcRows,
} from "@/lib/budget-import-clean";
import type { BudgetLine } from "@/lib/store";

const line = (over: Partial<BudgetLine>): BudgetLine => ({
  id: Math.random().toString(36).slice(2),
  headerCode: "1100",
  mainCode: "1101",
  description: "Head Writer",
  amount: 1,
  rate: 1000,
  x: 1,
  unit: "Flat",
  currency: "SAR",
  group: "ATL",
  ...over,
});

describe("budget import clean-up (E13)", () => {
  it("rounds to 2 decimals, including float artifacts", () => {
    // 15000.074999999999 is the same double as 15000.075 → half-up
    expect(round2(15000.074999999999)).toBe(15000.08);
    expect(round2(15000.0749)).toBe(15000.07);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-2.345)).toBe(-2.35);
  });

  it("trims and collapses spaces, drops invisible characters", () => {
    expect(cleanText("  Head ‏  Writer  ")).toBe("Head Writer");
    expect(cleanText("  مونتاج   الحلقات ")).toBe("مونتاج الحلقات");
  });

  it("reads numbers the way people type them", () => {
    expect(parseImportNumber("30,000.50")).toBe(30000.5);
    expect(parseImportNumber("(1,200)")).toBe(-1200);
    expect(parseImportNumber("SAR 4,500")).toBe(4500);
    expect(parseImportNumber("١٥٠٠٠٫٥")).toBe(15000.5);
    expect(parseImportNumber("١٢٬٥٠٠")).toBe(12500);
    expect(parseImportNumber("abc")).toBeNull();
    expect(parseImportNumber("")).toBe(0);
  });

  it("checks Header ≤ Main", () => {
    expect(checkHeaderMain("5111", "5105")).toMatchObject({
      header: "5105",
      main: "5111",
      swapped: true,
    });
    expect(checkHeaderMain("1100", "1101").swapped).toBe(false);
    expect(checkHeaderMain("5000-5400", "6101").outOfRange).toBe(true);
    expect(checkHeaderMain("5000-5400", "5302").outOfRange).toBe(false);
  });

  it("warns and skips duplicates; total drops by the duplicate", () => {
    const a = line({ description: "Head  Writer ", rate: 30000 });
    const b = line({ description: "head writer", rate: 30000.004 });
    const c = line({ mainCode: "1102", description: "Writer 2", rate: 24000 });
    const r = cleanImportedBudget([a, b, c], { rowOf: { [a.id]: 3, [b.id]: 9 } });
    expect(r.lines).toHaveLength(2);
    expect(r.stats.duplicates).toBe(1);
    expect(r.stats.duplicateTotals).toEqual({ SAR: 30000 });
    expect(r.issues.find((i) => i.kind === "duplicate")).toMatchObject({ row: 9, detail: "3" });
    expect(cleanImportedBudget([a, b, c], { keepDuplicates: true }).lines).toHaveLength(3);
  });

  it("swaps a reversed pair and says so", () => {
    const r = cleanImportedBudget([line({ headerCode: "5111", mainCode: "5105" })]);
    expect(r.lines[0]).toMatchObject({ headerCode: "5105", mainCode: "5111" });
    expect(r.issues.map((i) => i.kind)).toContain("swapped");
  });

  it("sends the database the same rows", () => {
    const [row] = toImportRpcRows([line({ notes: "x" })], {});
    expect(row).toMatchObject({ row: 1, main_code: "1101", currency: "SAR", notes: "x" });
  });

  it("explains a bad file in plain words", () => {
    expect(describeWorkbookError(new Error("x"), "budget.pdf").key).toBe("not_excel");
    expect(
      describeWorkbookError(new Error("End of Central Directory not found"), "b.xlsx").key,
    ).toBe("corrupt");
    expect(describeWorkbookError(new Error("File is password-protected"), "b.xlsx").key).toBe(
      "protected",
    );
  });
});

// ── D01: a real-shaped workbook — 310 lines, Arabic, merged cells, 4 sheets ──
function buildRealisticWorkbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["مشروع تجريبي — الميزانية"], ["Total", 0]]),
    "Top Sheet",
  );
  const sheets: { name: string; base: number }[] = [
    { name: "1-ATL", base: 1100 },
    { name: "2- Production Expenses", base: 2100 },
    { name: "3- Post-Production", base: 5100 },
    { name: "4- Other Expenses", base: 7000 },
  ];
  const expected: { total: number; dupTotal: number; lines: number; dups: number } = {
    total: 0,
    dupTotal: 0,
    lines: 0,
    dups: 0,
  };
  let n = 0;
  for (const [si, sh] of sheets.entries()) {
    const aoa: (string | number)[][] = [
      [`ميزانية ${sh.name}`],
      ["CODE", "ITEM", "NAME", "UNIT", "QUANTITY", "RATE", "TOTAL", "CURRENCY", "NOTES"],
    ];
    const merges: XLSX.Range[] = [];
    for (let i = 0; i < 77 + (si === 0 ? 2 : 0); i++) {
      n++;
      const code = String(sh.base + (i % 40) + 1);
      const rate = i === 5 ? 15000.074999999999 : 1000 + i * 10;
      const qty = (i % 3) + 1;
      const desc = i % 2 ? `بند رقم ${n}  مع  مسافات ` : `Line ${n} — ${sh.name}`;
      aoa.push([code, `بند ${n}`, desc, "Week", qty, rate, round2(qty * round2(rate)), "SAR", ""]);
      expected.lines++;
      expected.total += round2(qty * round2(rate));
      // merged CODE cell over this row and the next (same code, another line)
      if (i % 25 === 10) {
        n++;
        aoa.push(["", `بند ${n}`, `سطر مدمج ${n}`, "Flat", 1, 500, 500, "SAR", ""]);
        merges.push({ s: { r: aoa.length - 2, c: 0 }, e: { r: aoa.length - 1, c: 0 } });
        expected.lines++;
        expected.total += 500;
      }
      // seven exact duplicates across the file (extra spaces do not hide them)
      if (expected.dups < 7 && i % 11 === 3) {
        aoa.push([
          code,
          `بند ${n}`,
          ` ${desc}  `,
          "Week",
          qty,
          rate,
          round2(qty * round2(rate)),
          "SAR",
          "",
        ]);
        expected.dups++;
        expected.dupTotal += round2(qty * round2(rate));
      }
    }
    aoa.push(["", "Subtotal", "", "", "", "", 0, "", ""]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = merges;
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return { buf, expected };
}

describe("real-shaped budget workbook (D01)", () => {
  it("imports every line, skips the 7 duplicates, totals match the file", async () => {
    const { buf, expected } = buildRealisticWorkbook();
    expect(expected.lines).toBeGreaterThan(300);
    const file = new File([buf], "ميزانية حقيقية.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const preview = await parseKwalisTemplatePreview(file);
    expect(preview.result.budget).toHaveLength(expected.lines + expected.dups);
    const cleaned = cleanImportedBudget(preview.result.budget, {
      rowOf: preview.rowOfLine,
      sheetOf: preview.sheetOfLine,
    });
    expect(cleaned.stats.duplicates).toBe(7);
    expect(cleaned.lines).toHaveLength(expected.lines);
    const total = round2(cleaned.lines.reduce((s, l) => s + lineTotal(l), 0));
    expect(total).toBe(round2(expected.total));
    expect(cleaned.stats.duplicateTotals.SAR).toBe(round2(expected.dupTotal));
    // merged code cells were carried down
    expect(
      cleaned.lines.filter((l) => l.description.startsWith("سطر مدمج")).every((l) => l.mainCode),
    ).toBe(true);
    // Arabic text kept, spaces cleaned, float artefact rounded
    expect(cleaned.lines.some((l) => /^بند رقم \d+ مع مسافات$/.test(l.description))).toBe(true);
    expect(cleaned.lines.some((l) => l.rate === 15000.08)).toBe(true);
    // duplicates point at a row of the file
    expect(
      cleaned.issues.filter((i) => i.kind === "duplicate").every((i) => i.row && i.sheet),
    ).toBe(true);
  });

  it("a file that is not a workbook gets a clear reason", async () => {
    const file = new File([new TextEncoder().encode("not a workbook at all")], "budget.xlsx");
    let reason = "";
    try {
      await parseKwalisTemplatePreview(file);
    } catch (e) {
      reason = describeWorkbookError(e, file.name).key;
    }
    expect(["corrupt", "no_lines", "unknown"]).toContain(reason);
  });
});
