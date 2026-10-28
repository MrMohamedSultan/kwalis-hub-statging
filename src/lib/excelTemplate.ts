// Kwalis HUB — Multi-Sheet Budget Parser (2026-08 clean-template rewrite).
//
// The producer-facing template preserves the familiar AICP structure — one
// sheet per section (1-ATL, 2- Production Expenses, 3- Post-Production,
// 4- Other Expenses) — but every sheet uses a strictly flat, single-header
// layout:
//
//   Row 1 : section title (e.g. "ABOVE THE LINE")
//   Row 2 : header row — CODE | ITEM | NAME | PREP | SHOOTING | WRAP |
//           TOTAL | UNIT | QUANTITY | RATE | CURRENCY | NOTES
//   Row 3+: data rows, category-header rows (e.g. "1000  DEVELOPMENT COSTS"),
//           subtotal rows ("Subtotal — Foo"), and blank spacer rows
//
// Parser rules (owning this template, no state machine, no confidence):
//   1. Header row = row 2 (fallback: row 1 for the legacy single-sheet
//      "Budget" flat template).
//   2. A row is IGNORED when:
//        • the CODE cell is empty, OR
//        • the ITEM cell contains "Subtotal" (case-insensitive), OR
//        • both ITEM and NAME are empty (i.e. section header rows like
//          "1000  DEVELOPMENT COSTS").
//   3. Everything else is a valid line item.

import { normalizeKsaRegion } from "@/lib/ksa-regions";
import type * as XLSXTypes from "xlsx";
import { loadXlsx } from "@/lib/lazy-export-libs";
import { generateId } from "./store";
import type { BudgetLine } from "./store";
import type { ImportResult } from "./excelImport";
import { HEADER_ACCOUNTS, MAIN_ACCOUNTS, MACRO_CATEGORY_BY_HEADER } from "./data";
import { getBudgetCatalog, type BudgetCatalogEntry } from "./master-budget-catalog";
import { parseImportNumber } from "./budget-import-clean";

export const TEMPLATE_VERSION = "4.1-clean-multisheet";

export const TEMPLATE_SHEETS = {
  budget: "Budget",
  topSheet: "Top Sheet",
  atl: "1-ATL",
  prod: "2- Production Expenses",
  post: "3- Post-Production",
  other: "4- Other Expenses",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Public types (surface preserved for existing UI consumers)
// ─────────────────────────────────────────────────────────────────────────────

export class TemplateMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateMismatchError";
  }
}

export type TemplateMismatch = {
  sheet: string;
  row: number;
  reason: string;
  column?: string;
  columns?: string[];
  value?: string;
};

export type CanonicalCol =
  | "SECTION"
  | "CODE"
  | "ITEM"
  | "NAME"
  | "PREP"
  | "SHOOTING"
  | "WRAP"
  | "TOTAL"
  | "UNIT"
  | "QUANTITY"
  | "RATE"
  | "CURRENCY"
  | "NOTES"
  // db/pending/201: optional KSA region of the line (Film Commission budget by region)
  | "REGION";

export type SheetHeaderInfo = {
  rowNumber: number;
  cells: string[];
  autoMap: Partial<Record<CanonicalCol, number>>;
  autoMapSource: Partial<Record<CanonicalCol, "official" | "alias" | "positional">>;
};

export type IgnoredRow = {
  sheet: string;
  row: number;
  code: string;
  item: string;
  reason: string;
  total: number;
};

export type TopLineDebug = {
  sheet: string;
  row: number;
  code: string;
  description: string;
  total: number;
  viaStateMachine?: boolean;
};

export type TemplatePreview = {
  result: ImportResult;
  mismatches: TemplateMismatch[];
  unknownSheets: string[];
  sheetOfLine?: Record<string, string>;
  rowOfLine?: Record<string, number>;
  headerOffsetUsed?: number;
  officialKwalisTemplate?: boolean;
  headerRows?: Record<string, SheetHeaderInfo>;
  ignoredRows?: IgnoredRow[];
  stateMachineSheets?: string[];
  topLines?: TopLineDebug[];
};

// Kept for backwards compat with older callers; unused by the clean parser.
export type TemplatePreviewOpts = {
  headerOffset?: number;
  overrides?: Record<string, string>;
  columnMap?: Record<string, Partial<Record<CanonicalCol, number>>>;
  strict?: boolean;
};

export const SHEET_CONFIDENCE_THRESHOLD = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const norm = (s: unknown) => String(s ?? "").trim();
const normKey = (s: unknown) =>
  norm(s)
    .toUpperCase()
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .replace(/[.,;:()_/\\|*#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const HEADER_TO_CANON: Record<string, CanonicalCol> = {
  CODE: "CODE",
  "ACCOUNT CODE": "CODE",
  ACCOUNT: "CODE",
  ITEM: "ITEM",
  "TOP SHEET CATEGORY": "ITEM",
  "TOP SHEET": "ITEM",
  TOPSHEET: "ITEM",
  "CATEGORY LABEL": "ITEM",
  NAME: "NAME",
  DESCRIPTION: "NAME",
  DESC: "NAME",
  DETAILS: "NAME",
  UNIT: "UNIT",
  UOM: "UNIT",
  QTY: "QUANTITY",
  QUANTITY: "QUANTITY",
  RATE: "RATE",
  "UNIT RATE": "RATE",
  "UNIT PRICE": "RATE",
  TOTAL: "TOTAL",
  AMOUNT: "TOTAL",
  "TOTAL AMOUNT": "TOTAL",
  CURRENCY: "CURRENCY",
  CCY: "CURRENCY",
  CURR: "CURRENCY",
  NOTES: "NOTES",
  NOTE: "NOTES",
  REMARKS: "NOTES",
  REGION: "REGION",
  "KSA REGION": "REGION",
  PREP: "PREP",
  SHOOTING: "SHOOTING",
  SHOOT: "SHOOTING",
  WRAP: "WRAP",
  SECTION: "SECTION",
  GROUP: "SECTION",
  CATEGORY: "SECTION",
  // D01: Arabic budgets
  الكود: "CODE",
  كود: "CODE",
  الرمز: "CODE",
  "رمز الحساب": "CODE",
  "رقم الحساب": "CODE",
  البند: "ITEM",
  الحساب: "ITEM",
  الوصف: "NAME",
  البيان: "NAME",
  الاسم: "NAME",
  التفاصيل: "NAME",
  الوحدة: "UNIT",
  الكمية: "QUANTITY",
  العدد: "QUANTITY",
  السعر: "RATE",
  "سعر الوحدة": "RATE",
  الإجمالي: "TOTAL",
  الاجمالي: "TOTAL",
  المجموع: "TOTAL",
  المبلغ: "TOTAL",
  العملة: "CURRENCY",
  ملاحظات: "NOTES",
  الملاحظات: "NOTES",
  المنطقة: "REGION",
  التحضير: "PREP",
  التصوير: "SHOOTING",
  القسم: "SECTION",
};

function normalizeSection(raw: string): BudgetLine["group"] | null {
  const n = raw.toLowerCase().trim();
  if (!n) return null;
  if (/^atl|above/.test(n)) return "ATL";
  if (/^btl|below|production/.test(n)) return "BTL";
  if (/^post/.test(n)) return "Post";
  if (/^music/.test(n)) return "Music";
  if (/^vfx|visual/.test(n)) return "VFX";
  if (/^other|admin|general/.test(n)) return "Other";
  return null;
}

function inferSectionFromSheet(sheetName: string): BudgetLine["group"] {
  const n = sheetName.toLowerCase();
  if (/(^|[^a-z])atl([^a-z]|$)|above\s*the\s*line/.test(n)) return "ATL";
  if (/post/.test(n)) return "Post";
  if (/other|general/.test(n)) return "Other";
  if (/production|btl|below\s*the\s*line/.test(n)) return "BTL";
  return "Other";
}

function coerceNumber(raw: unknown): number {
  if (raw === "" || raw == null) return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const s = String(raw).trim();
  if (!s || s === "-" || s === "—" || s === "–") return 0;
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Strict variant used for RATE / QTY / TOTAL — flags a mismatch when the
// cell contains non-empty text that cannot be interpreted as a number.
function coerceNumberStrict(raw: unknown): { value: number; invalid: boolean; sample?: string } {
  if (raw === "" || raw == null) return { value: 0, invalid: false };
  // D01: thousands separators, currency symbols, Arabic-Indic digits
  const parsed = parseImportNumber(raw);
  if (parsed != null) return { value: parsed, invalid: false };
  if (typeof raw === "number") {
    return Number.isFinite(raw)
      ? { value: raw, invalid: false }
      : { value: 0, invalid: true, sample: String(raw) };
  }
  const s = String(raw).trim();
  if (!s || s === "-" || s === "—" || s === "–") return { value: 0, invalid: false };
  // Reject cells that contain letters — pure numeric formats accept digits,
  // decimals, commas, spaces, currency symbols, minus signs, and parentheses.
  if (/[A-Za-z]/.test(s)) return { value: 0, invalid: true, sample: s };
  // Handle accounting-style negatives like (1,234.56).
  const negParen = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") {
    return { value: 0, invalid: true, sample: s };
  }
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return { value: 0, invalid: true, sample: s };
  return { value: negParen ? -Math.abs(n) : n, invalid: false };
}

/**
 * D01: a code / item merged over several rows only has a value in its first
 * cell; copy it down the first column of the merge so every row keeps it.
 * Horizontal merges (titles across columns) are left alone.
 */
function fillMergedDown(XLSX: Awaited<ReturnType<typeof loadXlsx>>, ws: XLSXTypes.WorkSheet) {
  const merges = (ws["!merges"] ?? []) as XLSXTypes.Range[];
  for (const m of merges) {
    if (m.e.r <= m.s.r) continue;
    const master = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
    if (!master) continue;
    for (let r = m.s.r + 1; r <= m.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: m.s.c });
      const cur = ws[addr];
      if (!cur || cur.v == null || cur.v === "") ws[addr] = { ...master };
    }
  }
}

function readSheetRows(
  XLSX: Awaited<ReturnType<typeof loadXlsx>>,
  wb: XLSXTypes.WorkBook,
  name: string,
): unknown[][] | null {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  fillMergedDown(XLSX, ws);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: false });
}

function mapHeader(row: unknown[]): {
  map: Partial<Record<CanonicalCol, number>>;
  cells: string[];
} {
  const map: Partial<Record<CanonicalCol, number>> = {};
  const cells: string[] = [];
  row.forEach((c, i) => {
    const raw = norm(c);
    cells.push(raw);
    const key = normKey(raw);
    const canon = HEADER_TO_CANON[key];
    if (canon && !(canon in map)) map[canon] = i;
  });
  return { map, cells };
}

function looksLikeBudgetHeader(map: Partial<Record<CanonicalCol, number>>): boolean {
  return "CODE" in map && ("ITEM" in map || "NAME" in map);
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

export async function parseKwalisTemplatePreview(
  file: File,
  _opts?: TemplatePreviewOpts,
): Promise<TemplatePreview> {
  const buf = await file.arrayBuffer();
  const XLSX = await loadXlsx();
  const wb = XLSX.read(buf, { type: "array" });

  const result: ImportResult = {
    budget: [],
    vendors: [],
    people: [],
    anonymized: 0,
    sheetsScanned: [],
  };
  const mismatches: TemplateMismatch[] = [];
  const unknownSheets: string[] = [];
  const sheetOfLine: Record<string, string> = {};
  const rowOfLine: Record<string, number> = {};
  const headerRows: Record<string, SheetHeaderInfo> = {};
  const ignoredRows: IgnoredRow[] = [];

  const candidateSheets = wb.SheetNames.filter((n) => {
    const lo = n.toLowerCase();
    if (lo === "top sheet" || lo === "topsheet") return false;
    if (lo === "readme" || lo === "instructions") return false;
    return true;
  });

  if (candidateSheets.length === 0) {
    throw new TemplateMismatchError("Workbook has no data sheets.");
  }

  for (const sheetName of candidateSheets) {
    const rows = readSheetRows(XLSX, wb, sheetName);
    if (!rows || rows.length === 0) continue;

    // Locate the header row: prefer row 2 (multi-sheet AICP template),
    // fall back to row 1 (native single-sheet flat template).
    let headerIdx = -1;
    let map: Partial<Record<CanonicalCol, number>> = {};
    let cells: string[] = [];
    // D01: real budgets often carry a title block — look further down too.
    for (const tryIdx of [1, 0, 2, ...Array.from({ length: 17 }, (_, i) => i + 3)]) {
      if (tryIdx >= rows.length) continue;
      const parsed = mapHeader(rows[tryIdx] ?? []);
      if (looksLikeBudgetHeader(parsed.map)) {
        headerIdx = tryIdx;
        map = parsed.map;
        cells = parsed.cells;
        break;
      }
    }
    if (headerIdx === -1) {
      unknownSheets.push(sheetName);
      continue;
    }

    result.sheetsScanned.push(sheetName);
    headerRows[sheetName] = {
      rowNumber: headerIdx + 1,
      cells,
      autoMap: map,
      autoMapSource: Object.fromEntries(
        Object.keys(map).map((k) => [k, "alias" as const]),
      ) as SheetHeaderInfo["autoMapSource"],
    };

    const section = inferSectionFromSheet(sheetName);
    const cell = (row: unknown[], canon: CanonicalCol): unknown => {
      const c = map[canon];
      return typeof c === "number" ? row[c] : undefined;
    };

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const codeRaw = norm(cell(row, "CODE"));
      const itemRaw = norm(cell(row, "ITEM"));
      const nameRaw = norm(cell(row, "NAME"));

      // Rule 1: skip if CODE is empty. This also catches Subtotal rows
      // (which have CODE blank in this template) and empty spacer rows.
      if (!codeRaw) {
        if (itemRaw || nameRaw) {
          ignoredRows.push({
            sheet: sheetName,
            row: r + 1,
            code: "",
            item: itemRaw || nameRaw,
            reason: /subtotal/i.test(itemRaw) ? "Subtotal row" : "No CODE",
            total: coerceNumber(cell(row, "TOTAL")),
          });
        }
        continue;
      }

      // Rule 2: skip if ITEM starts with / contains "Subtotal".
      if (/subtotal/i.test(itemRaw)) {
        ignoredRows.push({
          sheet: sheetName,
          row: r + 1,
          code: codeRaw,
          item: itemRaw,
          reason: "Subtotal row",
          total: coerceNumber(cell(row, "TOTAL")),
        });
        continue;
      }

      // Rule 3: skip category-header rows (CODE present, no ITEM/NAME).
      if (!itemRaw && !nameRaw) {
        ignoredRows.push({
          sheet: sheetName,
          row: r + 1,
          code: codeRaw,
          item: "",
          reason: "Category header",
          total: 0,
        });
        continue;
      }

      const qtyS = coerceNumberStrict(cell(row, "QUANTITY"));
      const rateS = coerceNumberStrict(cell(row, "RATE"));
      const totalS = coerceNumberStrict(cell(row, "TOTAL"));

      // Row-level validation: capture non-numeric values in numeric columns
      // so the user sees "Row 45: Invalid number in RATE" instead of a silent 0.
      const invalidFields: { col: "QUANTITY" | "RATE" | "TOTAL"; sample: string }[] = [];
      if (qtyS.invalid) invalidFields.push({ col: "QUANTITY", sample: qtyS.sample ?? "" });
      if (rateS.invalid) invalidFields.push({ col: "RATE", sample: rateS.sample ?? "" });
      if (totalS.invalid) invalidFields.push({ col: "TOTAL", sample: totalS.sample ?? "" });
      if (invalidFields.length > 0) {
        for (const f of invalidFields) {
          mismatches.push({
            sheet: sheetName,
            row: r + 1,
            column: f.col,
            value: f.sample,
            reason: `Invalid number in ${f.col} — "${f.sample}". Expected a numeric value; imported as 0.`,
          });
        }
      }

      const qtyRaw = qtyS.value;
      const rateVal = rateS.value;
      const totalVal = totalS.value;

      // Rule 4 (Master Template): pre-populated but empty line — skip.
      if (qtyRaw <= 0 && rateVal <= 0 && totalVal <= 0) {
        ignoredRows.push({
          sheet: sheetName,
          row: r + 1,
          code: codeRaw,
          item: nameRaw || itemRaw,
          reason: "Empty line (no qty/rate/total)",
          total: 0,
        });
        continue;
      }

      const description = nameRaw || itemRaw;
      const qty = qtyRaw || 1;
      const rate = rateVal > 0 ? rateVal : totalVal > 0 ? totalVal / qty : 0;

      const codeClean = codeRaw.replace(/\.0+$/, "");
      const prefixDigits = codeClean.split(/[-.\s]/)[0].replace(/\D/g, "");
      const headerCode = (prefixDigits || "0000").padStart(4, "0").slice(0, 4);

      const unitRaw = norm(cell(row, "UNIT")) || "Flat";
      const currRaw = norm(cell(row, "CURRENCY")).toUpperCase();
      const notes = norm(cell(row, "NOTES"));
      // unknown region names are dropped (the line then uses the project default)
      const region = normalizeKsaRegion(norm(cell(row, "REGION")));
      const prep = coerceNumber(cell(row, "PREP"));
      const shooting = coerceNumber(cell(row, "SHOOTING"));
      const wrap = coerceNumber(cell(row, "WRAP"));
      const periods = prep + shooting + wrap || 1;

      // Prefer explicit SECTION column value; fall back to sheet-name inference,
      // then to the header-code lookup (1xxx→ATL, 2xxx-4xxx→BTL, 5xxx→Post, 6xxx→Music/VFX).
      const sectionRaw = norm(cell(row, "SECTION"));
      const sectionFromCol = normalizeSection(sectionRaw);
      const sectionFromCode = MACRO_CATEGORY_BY_HEADER[headerCode] as
        BudgetLine["group"] | undefined;
      const group: BudgetLine["group"] = sectionFromCol ?? sectionFromCode ?? section;

      const line: BudgetLine = {
        id: generateId(),
        headerCode,
        mainCode: codeClean || headerCode,
        description: description || "",
        name: nameRaw || "",
        amount: qty,
        rate,
        unit: (unitRaw as BudgetLine["unit"]) || "Flat",
        x: periods,
        prep,
        shooting,
        wrap,
        notes: notes || undefined,
        ...(region ? { region } : {}),
        group,
        currency: (currRaw === "USD" ? "USD" : "SAR") as BudgetLine["currency"],
        // Leave topsheetCode unset — the in-app backfill assigns it from the
        // parent section using the canonical topsheet account list. The raw
        // main code (e.g. "1202") is NOT a valid topsheet account.
        topsheetCode: null,
      };
      result.budget.push(line);
      sheetOfLine[line.id] = sheetName;
      rowOfLine[line.id] = r + 1;
    }
  }

  if (result.budget.length === 0) {
    throw new TemplateMismatchError(
      "No budget lines found. Expected the KwalisHub template: sheets with a header row containing CODE, ITEM, NAME, TOTAL followed by data rows.",
    );
  }

  return {
    result,
    mismatches,
    unknownSheets,
    sheetOfLine,
    rowOfLine,
    headerOffsetUsed: 2,
    officialKwalisTemplate: true,
    headerRows,
    ignoredRows,
    stateMachineSheets: [],
    topLines: [],
  };
}

export async function parseKwalisTemplate(file: File): Promise<ImportResult> {
  const { result } = await parseKwalisTemplatePreview(file);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Native flat template download (single-sheet convenience export)
// ─────────────────────────────────────────────────────────────────────────────

const FLAT_HEADERS = [
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
] as const;

// Clean template ships with zero sample rows — producers start from an
// empty grid to avoid leftover placeholder data slipping into a real budget.
const SAMPLE_ROWS: (string | number)[][] = [];

export async function downloadKwalisTemplate(filename = "KwalisHub_Standard_Template.xlsx") {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const aoa: (string | number)[][] = [[...FLAT_HEADERS] as (string | number)[], ...SAMPLE_ROWS];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as XLSXTypes.WorkSheet)["!cols"] = [
    { wch: 12 },
    { wch: 26 },
    { wch: 40 },
    { wch: 8 },
    { wch: 10 },
    { wch: 8 },
    { wch: 14 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 30 },
  ];
  (ws as XLSXTypes.WorkSheet)["!freeze"] = { xSplit: 0, ySplit: 1 } as unknown as never;
  XLSX.utils.book_append_sheet(wb, ws, TEMPLATE_SHEETS.budget);

  const readme = XLSX.utils.aoa_to_sheet([
    ["KwalisHub Budget Template — Clean Slate"],
    ["Version", TEMPLATE_VERSION],
    [],
    ["This template ships EMPTY on purpose. Add your own budget lines below the header."],
    [],
    ["How to use:"],
    ["1. Keep the header row exactly as shipped."],
    ["2. Add one budget line per row. Every line MUST have a CODE."],
    ["3. Rows with 'Subtotal' in the ITEM column are ignored by the importer."],
    ["4. Category-header rows (CODE only, no ITEM/NAME) are ignored."],
    ["5. Currency defaults to SAR when blank; use SAR or USD."],
    [],
    ["Need the full 1,700+ Chart of Accounts pre-populated?"],
    ["Use the ‘Download Master Budget Template’ button instead."],
  ]);
  (readme as XLSXTypes.WorkSheet)["!cols"] = [{ wch: 92 }];
  XLSX.utils.book_append_sheet(wb, readme, "README");

  XLSX.writeFile(wb, filename);
}

// ─────────────────────────────────────────────────────────────────────────────
// KwalisHub Master Budget Template — pre-populated Chart of Accounts.
// Single sheet, columns mirror the Budget Creation UI exactly.
// ─────────────────────────────────────────────────────────────────────────────

const MASTER_HEADERS = [
  "Section",
  "Top Sheet Category",
  "CODE",
  "DESCRIPTION",
  "PREP",
  "SHOOT",
  "WRAP",
  "PERIODS",
  "UNIT",
  "QTY",
  "CURR",
  "RATE",
  "TOTAL",
  "NOTES",
] as const;

/**
 * Legacy synchronous builder — sources rows from the in-code MAIN_ACCOUNTS
 * (~1,230 lines). Kept for callers that cannot await (tests, offline).
 */
export function buildMasterTemplateRows(): (string | number)[][] {
  const rows: (string | number)[][] = [[...MASTER_HEADERS] as (string | number)[]];
  for (const header of HEADER_ACCOUNTS) {
    const children = MAIN_ACCOUNTS[header.code] ?? [];
    const topSheetLabel = `${header.code} ${header.name}`;
    for (const child of children) {
      rows.push([
        header.group,
        topSheetLabel,
        child.code,
        child.name,
        0,
        0,
        0,
        1,
        "Flat",
        0,
        "SAR",
        0,
        0,
        "",
      ]);
    }
  }
  return rows;
}

/**
 * Live builder — pulls the complete Master Chart of Accounts (~1,712 rows,
 * incl. ATL, BTL, Post, VFX, Music, Special Units, Admin, Incentives) from
 * the master_budget catalog so the export always matches the DB. Falls back
 * to the in-code catalog if the fetch fails (offline / RLS).
 */
export async function buildMasterTemplateRowsFromCatalog(): Promise<(string | number)[][]> {
  let catalog: BudgetCatalogEntry[] = [];
  try {
    catalog = await getBudgetCatalog();
  } catch {
    catalog = [];
  }
  if (catalog.length === 0) return buildMasterTemplateRows();

  // Build header lookup: code -> {name, group}
  const headerMeta = new Map<string, { name: string; group: string }>();
  for (const h of HEADER_ACCOUNTS) headerMeta.set(h.code, { name: h.name, group: h.group });
  for (const row of catalog) {
    if (row.is_header && !headerMeta.has(row.code)) {
      const group =
        (MACRO_CATEGORY_BY_HEADER[row.code] as string | undefined) ??
        (row.code.startsWith("1")
          ? "ATL"
          : row.code.startsWith("5")
            ? "Post"
            : row.code.startsWith("6")
              ? "VFX"
              : row.code.startsWith("7")
                ? "Other"
                : "BTL");
      headerMeta.set(row.code, { name: row.name || "", group });
    }
  }

  // Sort by code for stable, auditable output.
  const sorted = [...catalog].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true }),
  );

  const rows: (string | number)[][] = [[...MASTER_HEADERS] as (string | number)[]];
  for (const row of sorted) {
    if (row.is_header) continue; // skip pure header rows; they're expressed via Top Sheet Category
    const headerCode = row.parent_code ?? row.code.match(/^\d{4}/)?.[0] ?? "";
    const meta = headerMeta.get(headerCode);
    const topSheetLabel = meta ? `${headerCode} ${meta.name}` : headerCode;
    const group = meta?.group ?? MACRO_CATEGORY_BY_HEADER[headerCode] ?? "Other";
    rows.push([
      group,
      topSheetLabel,
      row.code,
      row.name || row.description || "",
      0,
      0,
      0,
      1,
      "Flat",
      0,
      "SAR",
      0,
      0,
      row.description && row.name ? row.description : "",
    ]);
  }
  return rows;
}

export async function downloadKwalisMasterTemplate(filename = "KwalisHub_Master_Budget.xlsx") {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const aoa = await buildMasterTemplateRowsFromCatalog();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as XLSXTypes.WorkSheet)["!cols"] = [
    { wch: 10 },
    { wch: 32 },
    { wch: 10 },
    { wch: 48 },
    { wch: 6 },
    { wch: 7 },
    { wch: 6 },
    { wch: 8 },
    { wch: 10 },
    { wch: 8 },
    { wch: 6 },
    { wch: 12 },
    { wch: 14 },
    { wch: 32 },
  ];
  (ws as XLSXTypes.WorkSheet)["!freeze"] = { xSplit: 0, ySplit: 1 } as unknown as never;
  XLSX.utils.book_append_sheet(wb, ws, "Master Budget");

  const readme = XLSX.utils.aoa_to_sheet([
    ["KwalisHub Master Budget Template"],
    ["Version", TEMPLATE_VERSION],
    ["Rows", String(Math.max(aoa.length - 1, 0))],
    [],
    ["Contains the complete Chart of Accounts (ATL, BTL, Post, VFX, Music,"],
    ["Special Units, Administrative, Incentives). Fill QTY / RATE per line —"],
    ["totals compute on import. Delete any rows you do not need before uploading."],
  ]);
  (readme as XLSXTypes.WorkSheet)["!cols"] = [{ wch: 92 }];
  XLSX.utils.book_append_sheet(wb, readme, "README");

  XLSX.writeFile(wb, filename);
}
