// ═══════════════════════════════════════════════════════════════════
// excelAdapter.ts — Kwalis Hub Budget Excel Parser & Exporter
// ═══════════════════════════════════════════════════════════════════
//
// Two pure functions:
//   parseBudgetExcel(file)  → BudgetLine[]   (multi-sheet → flat array)
//   exportBudgetExcel(data, projectDetails)   (flat array → beautiful .xlsx)
//
// DEPENDENCY: ExcelJS  (npm install exceljs)
//   Works in both Node and browser environments.
//
// CONSTRAINT: Database schema is NEVER modified. This is a pure
//   frontend bridge between the formatted Excel template and
//   the flat BudgetLine[] payload the backend expects.
// ═══════════════════════════════════════════════════════════════════

import type ExcelJS from "exceljs";
import { loadExcelJs } from "@/lib/lazy-export-libs";
import { downloadBlob } from "@/lib/download";

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

export interface BudgetLine {
  id?: string;
  group: "ATL" | "BTL" | "POST" | "OTHER";
  header_code: string; // e.g. "1000", "2100", "5000-5400"
  header_name: string; // e.g. "DEVELOPMENT COSTS"
  main_code: string; // e.g. "1001", "1001.1"
  account_name: string; // from ITEM column
  name: string; // from NAME column
  description?: string;
  prep: number;
  shooting: number;
  wrap: number;
  total: number; // TOTAL column (prep+shoot+wrap or override)
  unit: string; // e.g. "Flat", "Week", "Day", "Epi"
  amount: number; // QUANTITY column
  rate: number;
  currency: string; // "SAR" | "USD"
  notes: string;
  sar_total?: number; // computed SAR total (read-only from Excel)
  usd_total?: number; // computed USD total (read-only from Excel)
  excluded?: boolean;
}

export interface ProjectDetails {
  projectTitle?: string;
  budgetVersion?: string;
  versionDate?: string;
  exportedOn?: string;
  productionCompany?: string;
  lineProducer?: string;
  shootDays?: string | number;
  filmingLocations?: string;
}

// ─────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────

const SAR_RATE = 3.75;

/** Map sheet name → flat group code */
const SHEET_TO_GROUP: Record<string, BudgetLine["group"]> = {
  "1-ATL": "ATL",
  "2- Production Expenses": "BTL",
  "3- Post-Production": "POST",
  "4- Other Expenses": "OTHER",
};

/** Reverse: group code → sheet name */
const GROUP_TO_SHEET: Record<string, string> = {
  ATL: "1-ATL",
  BTL: "2- Production Expenses",
  POST: "3- Post-Production",
  OTHER: "4- Other Expenses",
};

/** Group code → display title for row 1 of each sheet */
const GROUP_TITLES: Record<string, string> = {
  ATL: "ABOVE THE LINE",
  BTL: "PRODUCTION EXPENSES",
  POST: "POST PRODUCTION EXPENSES",
  OTHER: "OTHER EXPENSES",
};

/** Column layout (1-indexed): matches the actual Excel template exactly */
const COL = {
  CODE: 1,
  ITEM: 2,
  NAME: 3,
  PREP: 4,
  SHOOTING: 5,
  WRAP: 6,
  TOTAL: 7,
  UNIT: 8,
  QUANTITY: 9,
  RATE: 10,
  CURRENCY: 11,
  NOTES: 12,
  SAR: 13,
  USD: 14,
} as const;

const HEADER_LABELS = [
  "CODE",
  "ITEM",
  "NAME",
  "PREP",
  "SHOOTING",
  "WRAP",
  "TOTAL",
  "UNIT",
  "QUANTITY",
  "RATE",
  "CURRENCY",
  "NOTES",
  "SAR",
  "USD",
];

// ─────────────────────────────────────────────────────────────────
// ROW CLASSIFICATION HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Detects category header rows like:
 *   "1000  DEVELOPMENT COSTS"
 *   "5000-5400  EDITORIAL / PICTURE FINISHING / ..."
 *   "UNASSIGNED"
 *
 * Returns { code, name } or null.
 */
function parseCategoryHeader(cellA: unknown): { code: string; name: string } | null {
  if (typeof cellA !== "string" || !cellA.trim()) return null;
  const s = cellA.trim();

  // "UNASSIGNED" is a special fallback category
  if (s.toUpperCase() === "UNASSIGNED") {
    return { code: "UNASSIGNED", name: "UNASSIGNED" };
  }

  // Pattern: "1000  DEVELOPMENT COSTS" — code, then 2+ spaces, then name
  const match = s.match(/^([\d-]+)\s{2,}(.+)$/);
  if (match) {
    return { code: match[1].trim(), name: match[2].trim() };
  }

  return null;
}

/** Returns true for rows like: col B = "Subtotal — ..." */
function isSubtotalRow(cellB: unknown): boolean {
  if (typeof cellB !== "string") return false;
  return cellB.trim().toLowerCase().startsWith("subtotal");
}

/** Returns true if every cell in the row is null/undefined/empty */
function isEmptyRow(row: ExcelJS.Row, maxCol: number): boolean {
  for (let c = 1; c <= maxCol; c++) {
    const v = row.getCell(c).value;
    if (v !== null && v !== undefined && v !== "") return false;
  }
  return true;
}

/** Returns true for the column header row (CODE, ITEM, NAME, ...) */
function isColumnHeaderRow(cellA: unknown, cellB: unknown): boolean {
  return (
    typeof cellA === "string" &&
    cellA.trim().toUpperCase() === "CODE" &&
    typeof cellB === "string" &&
    cellB.trim().toUpperCase() === "ITEM"
  );
}

/** Safe number extraction from a cell value */
function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/** Safe string extraction from a cell value */
function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** Generate a deterministic ID for a line */
function makeId(group: string, code: string, index: number): string {
  return `${group}-${code}-${index}`;
}

// ═══════════════════════════════════════════════════════════════════
// PARSER: Multi-sheet Excel → flat BudgetLine[]
// ═══════════════════════════════════════════════════════════════════

export async function parseBudgetExcel(file: File): Promise<BudgetLine[]> {
  const buffer = await file.arrayBuffer();
  const ExcelJSLib = await loadExcelJs();
  const workbook = new ExcelJSLib.Workbook();
  await workbook.xlsx.load(buffer);

  const results: BudgetLine[] = [];
  let globalIndex = 0;

  // Process each data sheet (skip "Top Sheet")
  for (const [sheetName, group] of Object.entries(SHEET_TO_GROUP)) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) continue;

    let currentHeader: { code: string; name: string } | null = null;
    let headerRowPassed = false;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cellA = row.getCell(COL.CODE).value;
      const cellB = row.getCell(COL.ITEM).value;

      // ── Skip: sheet title (row 1) and blank row (row 2) ──
      if (rowNumber <= 2) return;

      // ── Skip: column header row (CODE | ITEM | NAME | ...) ──
      if (isColumnHeaderRow(cellA, cellB)) {
        headerRowPassed = true;
        return;
      }
      if (!headerRowPassed) return;

      // ── Skip: empty rows ──
      if (isEmptyRow(row, 14)) return;

      // ── Skip: subtotal rows ──
      if (isSubtotalRow(cellB)) return;

      // ── Category header row? Update current header context ──
      const catHeader = parseCategoryHeader(cellA);
      if (catHeader) {
        currentHeader = catHeader;
        return; // category headers are structural, not data
      }

      // ── DATA ROW ──
      const codeVal = toStr(cellA);
      const itemVal = toStr(cellB);

      // Must have at least a code OR an item to be a valid data row
      if (!codeVal && !itemVal) return;

      const header = currentHeader as { code: string; name: string } | null;

      const line: BudgetLine = {
        id: makeId(group, codeVal || `row${rowNumber}`, globalIndex),
        group: group as BudgetLine["group"],
        header_code: header?.code || "UNASSIGNED",
        header_name: header?.name || "UNASSIGNED",
        main_code: codeVal,
        account_name: itemVal,
        name: toStr(row.getCell(COL.NAME).value),
        prep: toNum(row.getCell(COL.PREP).value),
        shooting: toNum(row.getCell(COL.SHOOTING).value),
        wrap: toNum(row.getCell(COL.WRAP).value),
        total: toNum(row.getCell(COL.TOTAL).value),
        unit: toStr(row.getCell(COL.UNIT).value),
        amount: toNum(row.getCell(COL.QUANTITY).value),
        rate: toNum(row.getCell(COL.RATE).value),
        currency: toStr(row.getCell(COL.CURRENCY).value) || "SAR",
        notes: toStr(row.getCell(COL.NOTES).value),
        sar_total: toNum(row.getCell(COL.SAR).value),
        usd_total: toNum(row.getCell(COL.USD).value),
        excluded: false,
      };

      results.push(line);
      globalIndex++;
    });
  }

  return results;
}

/**
 * Convenience: also extract project metadata from "Top Sheet"
 */
export async function parseProjectDetails(file: File): Promise<ProjectDetails> {
  const buffer = await file.arrayBuffer();
  const ExcelJSLib = await loadExcelJs();
  const workbook = new ExcelJSLib.Workbook();
  await workbook.xlsx.load(buffer);

  const ws = workbook.getWorksheet("Top Sheet");
  if (!ws) return {};

  const get = (row: number, col: number): string => toStr(ws.getCell(row, col).value);

  return {
    projectTitle: get(3, 2),
    budgetVersion: get(4, 2),
    versionDate: get(5, 2),
    exportedOn: get(6, 2),
    productionCompany: get(7, 2),
    lineProducer: get(8, 2),
    shootDays: get(9, 2),
    filmingLocations: get(10, 2),
  };
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTER: flat BudgetLine[] → Beautiful multi-sheet Excel
// ═══════════════════════════════════════════════════════════════════

// ── Styling constants ──
const COLORS = {
  headerBg: "1B2A4A", // dark navy for headers
  headerFont: "FFFFFF",
  categoryBg: "E8EDF5", // light blue-grey for category rows
  categoryFont: "1B2A4A",
  subtotalBg: "F0F4FA", // very light blue for subtotals
  subtotalFont: "1B2A4A",
  dataBorder: "D4D9E2", // subtle grey borders
  titleFont: "0F1724",
  topSheetAccent: "2E5090", // blue accent for top sheet
  grandTotalBg: "1B2A4A",
  grandTotalFont: "FFFFFF",
  sarHighlight: "27AE60", // green for SAR column
};

const FONT_FAMILY = "Arial";

function applyHeaderStyle(row: ExcelJS.Row, colCount: number): void {
  row.height = 28;
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > colCount) return;
    cell.font = {
      name: FONT_FAMILY,
      bold: true,
      size: 10,
      color: { argb: COLORS.headerFont },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.headerBg },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: colNumber >= COL.PREP ? "right" : "left",
    };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFFFFF" } },
    };
  });
}

function applyCategoryStyle(row: ExcelJS.Row, colCount: number): void {
  row.height = 24;
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > colCount) return;
    cell.font = {
      name: FONT_FAMILY,
      bold: true,
      size: 10,
      color: { argb: COLORS.categoryFont },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.categoryBg },
    };
    cell.alignment = { vertical: "middle" };
    cell.border = {
      bottom: { style: "thin", color: { argb: COLORS.dataBorder } },
    };
  });
}

function applyDataStyle(row: ExcelJS.Row, colCount: number): void {
  row.height = 20;
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > colCount) return;
    cell.font = { name: FONT_FAMILY, size: 10 };
    cell.alignment = {
      vertical: "middle",
      horizontal: colNumber >= COL.PREP ? "right" : "left",
    };
    cell.border = {
      bottom: { style: "hair", color: { argb: COLORS.dataBorder } },
    };

    // Number formatting for financial columns
    if (([COL.RATE, COL.SAR, COL.USD] as number[]).includes(colNumber)) {
      cell.numFmt = "#,##0.00";
    }
    if (
      ([COL.QUANTITY, COL.PREP, COL.SHOOTING, COL.WRAP, COL.TOTAL] as number[]).includes(colNumber)
    ) {
      cell.numFmt = "#,##0";
    }
  });
}

function applySubtotalStyle(row: ExcelJS.Row, colCount: number): void {
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > colCount) return;
    cell.font = {
      name: FONT_FAMILY,
      bold: true,
      size: 10,
      color: { argb: COLORS.subtotalFont },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.subtotalBg },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: colNumber >= COL.SAR ? "right" : "left",
    };
    cell.border = {
      top: { style: "thin", color: { argb: COLORS.dataBorder } },
      bottom: { style: "thin", color: { argb: COLORS.dataBorder } },
    };
    if (([COL.SAR, COL.USD] as number[]).includes(colNumber)) {
      cell.numFmt = "#,##0.00";
    }
  });
}

/** Column widths matching the template */
const COL_WIDTHS = [
  14, // CODE
  36, // ITEM
  18, // NAME
  8, // PREP
  10, // SHOOTING
  8, // WRAP
  8, // TOTAL
  10, // UNIT
  10, // QUANTITY
  12, // RATE
  10, // CURRENCY
  16, // NOTES
  14, // SAR
  14, // USD
];

/** Computation helpers */
function calcTotalPeriods(line: BudgetLine): number {
  const sum = (line.prep || 0) + (line.shooting || 0) + (line.wrap || 0);
  if (sum > 0) return sum;
  return (line.total || 0) > 0 ? line.total : 1;
}

function calcLineTotalNative(line: BudgetLine): number {
  if (line.excluded) return 0;
  return (line.amount || 0) * (line.rate || 0) * calcTotalPeriods(line);
}

function calcLineTotalSAR(line: BudgetLine): number {
  const native = calcLineTotalNative(line);
  if ((line.currency || "SAR").toUpperCase() === "SAR") return native;
  return native * SAR_RATE;
}

function calcLineTotalUSD(line: BudgetLine): number {
  const native = calcLineTotalNative(line);
  if ((line.currency || "SAR").toUpperCase() === "USD") return native;
  return native / SAR_RATE;
}

// ── Group & sort the flat data for export ──
interface HeaderGroup {
  code: string;
  name: string;
  lines: BudgetLine[];
}

function groupByHeaders(lines: BudgetLine[]): HeaderGroup[] {
  const map = new Map<string, HeaderGroup>();
  for (const line of lines) {
    const key = line.header_code;
    if (!map.has(key)) {
      map.set(key, {
        code: line.header_code,
        name: line.header_name,
        lines: [],
      });
    }
    map.get(key)!.lines.push(line);
  }
  // Sort by header code numerically
  return Array.from(map.values()).sort((a, b) => {
    const na = parseFloat(a.code) || 99999;
    const nb = parseFloat(b.code) || 99999;
    return na - nb;
  });
}

// ── Workbook builder (pure — testable in Node, no DOM) ──
export async function buildBudgetWorkbook(
  data: BudgetLine[],
  projectDetails: ProjectDetails = {},
): Promise<ExcelJS.Workbook> {
  const ExcelJSLib = await loadExcelJs();
  const workbook = new ExcelJSLib.Workbook();
  workbook.creator = "Kwalis Hub";
  workbook.created = new Date();

  // ────────────────────────────────────────────────
  // SHEET 1: TOP SHEET
  // ────────────────────────────────────────────────
  const topSheet = workbook.addWorksheet("Top Sheet", {
    properties: { tabColor: { argb: COLORS.topSheetAccent } } as any,
  });

  // Title row
  const titleRow = topSheet.getRow(1);
  topSheet.mergeCells("A1:G1");
  const titleCell = topSheet.getCell("A1");
  titleCell.value = `BUDGET TOPSHEET  ||  ${projectDetails.projectTitle || "Untitled Project"}`;
  titleCell.font = {
    name: FONT_FAMILY,
    bold: true,
    size: 16,
    color: { argb: COLORS.titleFont },
  };
  titleCell.alignment = { vertical: "middle" };
  titleRow.height = 36;

  // Project metadata
  const metaFields: [string, string | number | undefined][] = [
    ["Project Title", projectDetails.projectTitle],
    ["Budget Version", projectDetails.budgetVersion],
    ["Version Date", projectDetails.versionDate],
    ["Exported On", projectDetails.exportedOn || new Date().toLocaleDateString("en-GB")],
    ["Production Company", projectDetails.productionCompany],
    ["Line Producer", projectDetails.lineProducer],
    ["Shoot Days", projectDetails.shootDays],
    ["Filming Locations", projectDetails.filmingLocations],
  ];

  metaFields.forEach(([label, value], i) => {
    const r = i + 3; // start at row 3
    topSheet.getCell(r, 1).value = label;
    topSheet.getCell(r, 1).font = {
      name: FONT_FAMILY,
      bold: true,
      size: 10,
      color: { argb: COLORS.categoryFont },
    };
    topSheet.getCell(r, 2).value = value || "";
    topSheet.getCell(r, 2).font = { name: FONT_FAMILY, size: 10 };
  });

  topSheet.getColumn(1).width = 22;
  topSheet.getColumn(2).width = 30;

  // ── Top Sheet summary by group ──
  let topRow = 12; // start summary below metadata
  const groups: BudgetLine["group"][] = ["ATL", "BTL", "POST", "OTHER"];
  let grandSAR = 0;
  let grandUSD = 0;

  for (const groupKey of groups) {
    const groupLines = data.filter((l) => l.group === groupKey);
    const headers = groupByHeaders(groupLines);
    const groupTitle = GROUP_TITLES[groupKey] || groupKey;

    // Group title row
    const gtRow = topSheet.getRow(topRow);
    topSheet.getCell(topRow, 1).value = groupTitle;
    topSheet.getCell(topRow, 1).font = {
      name: FONT_FAMILY,
      bold: true,
      size: 11,
      color: { argb: COLORS.headerFont },
    };
    gtRow.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col <= 7) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.headerBg },
        };
        cell.font = cell.font || {};
        cell.font = {
          ...cell.font,
          color: { argb: COLORS.headerFont },
          name: FONT_FAMILY,
        };
      }
    });
    topRow++;

    // Column headers
    const chRow = topSheet.getRow(topRow);
    ["", "Code", "Account", "Units", "", "SAR", "USD"].forEach((v, i) => {
      topSheet.getCell(topRow, i + 1).value = v;
    });
    chRow.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col <= 7) {
        cell.font = { name: FONT_FAMILY, bold: true, size: 9 };
        cell.border = {
          bottom: { style: "thin", color: { argb: COLORS.dataBorder } },
        };
      }
    });
    topRow++;

    // Each header group as a summary row
    let groupSAR = 0;
    let groupUSD = 0;

    for (const hg of headers) {
      const hSAR = hg.lines.reduce((s, l) => s + calcLineTotalSAR(l), 0);
      const hUSD = hg.lines.reduce((s, l) => s + calcLineTotalUSD(l), 0);
      groupSAR += hSAR;
      groupUSD += hUSD;

      topSheet.getCell(topRow, 2).value = hg.code;
      topSheet.getCell(topRow, 3).value = hg.name;
      topSheet.getCell(topRow, 4).value = 1;
      topSheet.getCell(topRow, 6).value = hSAR;
      topSheet.getCell(topRow, 6).numFmt = "#,##0";
      topSheet.getCell(topRow, 7).value = hUSD;
      topSheet.getCell(topRow, 7).numFmt = "#,##0";

      for (let c = 1; c <= 7; c++) {
        topSheet.getCell(topRow, c).font = { name: FONT_FAMILY, size: 10 };
      }
      topRow++;
    }

    // Group total
    const totalLabel = `TOTAL ${groupTitle}`;
    topSheet.getCell(topRow, 2).value = totalLabel;
    topSheet.getCell(topRow, 2).font = {
      name: FONT_FAMILY,
      bold: true,
      size: 10,
    };
    topSheet.getCell(topRow, 6).value = groupSAR;
    topSheet.getCell(topRow, 6).numFmt = "#,##0";
    topSheet.getCell(topRow, 6).font = { name: FONT_FAMILY, bold: true, size: 10 };
    topSheet.getCell(topRow, 7).value = groupUSD;
    topSheet.getCell(topRow, 7).numFmt = "#,##0";
    topSheet.getCell(topRow, 7).font = { name: FONT_FAMILY, bold: true, size: 10 };

    const totRow = topSheet.getRow(topRow);
    totRow.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col <= 7) {
        cell.border = {
          top: { style: "thin", color: { argb: COLORS.dataBorder } },
        };
      }
    });

    grandSAR += groupSAR;
    grandUSD += groupUSD;
    topRow += 2; // blank line between groups
  }

  // Grand total at bottom of top sheet
  topRow++;
  topSheet.getCell(topRow, 2).value = "Subtotal (Direct Costs)";
  topSheet.getCell(topRow, 2).font = { name: FONT_FAMILY, bold: true, size: 10 };
  topSheet.getCell(topRow, 6).value = grandSAR;
  topSheet.getCell(topRow, 6).numFmt = "#,##0";
  topSheet.getCell(topRow, 6).font = { name: FONT_FAMILY, bold: true, size: 10 };
  topSheet.getCell(topRow, 7).value = grandUSD;
  topSheet.getCell(topRow, 7).numFmt = "#,##0";
  topSheet.getCell(topRow, 7).font = { name: FONT_FAMILY, bold: true, size: 10 };

  topRow++;
  topSheet.getCell(topRow, 2).value = "GRAND TOTAL (Excluding VAT)";
  topSheet.getCell(topRow, 2).font = {
    name: FONT_FAMILY,
    bold: true,
    size: 12,
    color: { argb: COLORS.grandTotalFont },
  };
  topSheet.getCell(topRow, 6).value = grandSAR;
  topSheet.getCell(topRow, 6).numFmt = "#,##0";
  topSheet.getCell(topRow, 7).value = grandUSD;
  topSheet.getCell(topRow, 7).numFmt = "#,##0";

  const grandRow = topSheet.getRow(topRow);
  grandRow.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col <= 7) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLORS.grandTotalBg },
      };
      cell.font = {
        name: FONT_FAMILY,
        bold: true,
        size: 12,
        color: { argb: COLORS.grandTotalFont },
      };
    }
  });

  // ────────────────────────────────────────────────
  // SHEETS 2-5: DATA SHEETS (ATL, BTL, POST, OTHER)
  // ────────────────────────────────────────────────
  for (const groupKey of groups) {
    const sheetName = GROUP_TO_SHEET[groupKey];
    const sheetTitle = GROUP_TITLES[groupKey];
    const groupLines = data.filter((l) => l.group === groupKey);
    const headers = groupByHeaders(groupLines);

    const ws = workbook.addWorksheet(sheetName, {
      properties: {
        tabColor: {
          argb:
            groupKey === "ATL"
              ? "2E5090"
              : groupKey === "BTL"
                ? "E67E22"
                : groupKey === "POST"
                  ? "8E44AD"
                  : "27AE60",
        },
      } as any,
    });

    // Set column widths
    COL_WIDTHS.forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });

    // Row 1: Sheet title
    let rowNum = 1;
    ws.mergeCells(`A${rowNum}:N${rowNum}`);
    const sheetTitleCell = ws.getCell(rowNum, 1);
    sheetTitleCell.value = sheetTitle;
    sheetTitleCell.font = {
      name: FONT_FAMILY,
      bold: true,
      size: 14,
      color: { argb: COLORS.titleFont },
    };
    sheetTitleCell.alignment = { vertical: "middle" };
    ws.getRow(rowNum).height = 30;

    // Row 2: blank
    rowNum = 2;

    // Row 3: Column headers
    rowNum = 3;
    const headerRow = ws.getRow(rowNum);
    HEADER_LABELS.forEach((label, i) => {
      ws.getCell(rowNum, i + 1).value = label;
    });
    applyHeaderStyle(headerRow, 14);

    // Row 4+: Data grouped by header_code
    rowNum = 4;

    for (const hg of headers) {
      // ── Category header row ──
      const catText = hg.code === "UNASSIGNED" ? "UNASSIGNED" : `${hg.code}  ${hg.name}`;

      ws.getCell(rowNum, COL.CODE).value = catText;
      ws.mergeCells(`A${rowNum}:N${rowNum}`);
      applyCategoryStyle(ws.getRow(rowNum), 14);
      rowNum++;

      // ── Data lines ──
      const firstDataRow = rowNum;

      for (const line of hg.lines) {
        const tp = calcTotalPeriods(line);
        const sarTotal = calcLineTotalSAR(line);
        const usdTotal = calcLineTotalUSD(line);

        ws.getCell(rowNum, COL.CODE).value = line.main_code;
        ws.getCell(rowNum, COL.ITEM).value = line.account_name;
        ws.getCell(rowNum, COL.NAME).value = line.name || "";
        ws.getCell(rowNum, COL.PREP).value = line.prep;
        ws.getCell(rowNum, COL.SHOOTING).value = line.shooting;
        ws.getCell(rowNum, COL.WRAP).value = line.wrap;
        ws.getCell(rowNum, COL.TOTAL).value = tp;
        ws.getCell(rowNum, COL.UNIT).value = line.unit;
        ws.getCell(rowNum, COL.QUANTITY).value = line.amount;
        ws.getCell(rowNum, COL.RATE).value = line.rate;
        ws.getCell(rowNum, COL.CURRENCY).value = line.currency;
        ws.getCell(rowNum, COL.NOTES).value = line.notes || "";
        ws.getCell(rowNum, COL.SAR).value = sarTotal;
        ws.getCell(rowNum, COL.USD).value = usdTotal;

        applyDataStyle(ws.getRow(rowNum), 14);
        rowNum++;
      }

      const lastDataRow = rowNum - 1;

      // ── Subtotal row ──
      const subtotalName =
        hg.code === "UNASSIGNED" ? "Subtotal — Unassigned" : `Subtotal — ${hg.name}`;

      ws.getCell(rowNum, COL.ITEM).value = subtotalName;

      // Use SUM formulas for SAR and USD subtotal columns
      if (firstDataRow <= lastDataRow) {
        const sarCol = "M"; // column M = SAR
        const usdCol = "N"; // column N = USD
        ws.getCell(rowNum, COL.SAR).value = {
          formula: `SUM(${sarCol}${firstDataRow}:${sarCol}${lastDataRow})`,
          result: hg.lines.reduce((s, l) => s + calcLineTotalSAR(l), 0),
        } as any;
        ws.getCell(rowNum, COL.USD).value = {
          formula: `SUM(${usdCol}${firstDataRow}:${usdCol}${lastDataRow})`,
          result: hg.lines.reduce((s, l) => s + calcLineTotalUSD(l), 0),
        } as any;
      } else {
        ws.getCell(rowNum, COL.SAR).value = 0;
        ws.getCell(rowNum, COL.USD).value = 0;
      }

      applySubtotalStyle(ws.getRow(rowNum), 14);
      rowNum++;

      // Blank spacer row
      rowNum++;
    }

    // Freeze panes: lock header row
    ws.views = [{ state: "frozen", ySplit: 3, xSplit: 0 }];
  }

  return workbook;
}

// ── Main export function (browser download) ──
export async function exportBudgetExcel(
  data: BudgetLine[],
  projectDetails: ProjectDetails = {},
): Promise<void> {
  const workbook = await buildBudgetWorkbook(data, projectDetails);
  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(
    `${projectDetails.projectTitle || "Budget"}_${projectDetails.budgetVersion || "v1"}.xlsx`,
    blob,
  );
}

// ═══════════════════════════════════════════════════════════════════
// CONVENIENCE: Round-trip validator (dev/debug only)
// ═══════════════════════════════════════════════════════════════════

/**
 * Parses, logs summary, and returns the flat array.
 * Useful for verifying the parser against a known file.
 */
export async function debugParse(file: File): Promise<void> {
  const lines = await parseBudgetExcel(file);
  const details = await parseProjectDetails(file);

  console.group("Kwalis Hub Excel Parser — Debug Report");
  console.log("Project:", details.projectTitle);
  console.log("Version:", details.budgetVersion);
  console.log("Total lines parsed:", lines.length);

  const byGroup: Record<string, number> = {};
  const byHeader: Record<string, number> = {};
  for (const l of lines) {
    byGroup[l.group] = (byGroup[l.group] || 0) + 1;
    const hk = `${l.group} > ${l.header_code} ${l.header_name}`;
    byHeader[hk] = (byHeader[hk] || 0) + 1;
  }
  console.log("By group:", byGroup);
  console.log("By header:", byHeader);

  const totalSAR = lines.reduce((s, l) => s + calcLineTotalSAR(l), 0);
  const totalUSD = lines.reduce((s, l) => s + calcLineTotalUSD(l), 0);
  console.log(`Grand Total SAR: ${totalSAR.toLocaleString()}`);
  console.log(`Grand Total USD: ${totalUSD.toLocaleString()}`);
  console.groupEnd();
}
