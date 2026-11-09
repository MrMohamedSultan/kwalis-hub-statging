// ═══════════════════════════════════════════════════════════════════
// budget-telfaz-format.ts — the client's own budget workbook layout
// ("Telfaz budget" format) — import AND export.
// ═══════════════════════════════════════════════════════════════════
//
// The workbook has a Top Sheet and four line sheets:
//   1-Above The Line · 2- Production Expenses   (ATL / BTL)
//     A empty · B code · C item · D name · E prep · F shooting · G wrap ·
//     H total periods · I unit · J qty · K rate · L notes · M add. notes ·
//     N SAR · O Dollar. No CODE/ITEM header: every section starts with its
//     own header row (B = section code, C = section name, D = "NAME" …) and
//     ends with a "Subtotal" row. Rates are USD; O is the line total (the
//     formula differs per row: F*J*K, H*J*K, J*K …), N = O × 3.75.
//   3- Post-Production
//     header row "Code of Chart of Accounts | Item | Description | Amount |
//     Unit | Quantity B | Rate ($) | Subtotal | Comment"; section rows
//     (code ending in 00) carry the section subtotal; child rows without a
//     code belong to the code above; rows marked "Included in Production"
//     are already budgeted on sheet 2 and are not imported.
//   4- Other Expenses
//     section header "NAME | DAYS | NOTES | SAR | Dollar", totals only.
//
// Import rule: the FILE's figure for every row is the truth (cached values).
// When qty × rate × periods does not give the file's total, the periods (or
// the quantity, for units that ignore periods) are set so it does, else the
// row becomes a lump sum — the original numbers always go to the notes, so no
// total is ever changed silently.
//
// Export writes the same layout (plus a trailing Currency column, and on
// sheet 4 the qty / rate / periods columns) with live formulas, so a budget
// exported from Kwalis re-imports to the very same lines.
// ═══════════════════════════════════════════════════════════════════

import type ExcelJS from "exceljs";
import { loadExcelJs } from "@/lib/lazy-export-libs";
import { generateId, UNITS_NO_PERIODS, type BudgetLine } from "@/lib/store";
import { HEADER_ACCOUNTS, MAIN_ACCOUNTS, MACRO_CATEGORY_BY_HEADER } from "@/lib/data";
import { cleanText, parseImportNumber } from "@/lib/budget-import-clean";
import type { ImportResult } from "@/lib/excelImport";
import type { TemplatePreview } from "@/lib/excelTemplate";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

export type TelfazSheetKey = "ATL" | "BTL" | "POST" | "OTHER";
export const TELFAZ_SHEET_KEYS: TelfazSheetKey[] = ["ATL", "BTL", "POST", "OTHER"];

export const TELFAZ_SHEET_NAMES: Record<TelfazSheetKey, string> = {
  ATL: "1-Above The Line",
  BTL: "2- Production Expenses",
  POST: "3- Post-Production",
  OTHER: "4- Other Expenses",
};
export const TELFAZ_TOP_SHEET = "Top Sheet";

const SHEET_TITLES: Record<TelfazSheetKey, string> = {
  ATL: "ABOVE THE LINE",
  BTL: "PRODUCTION EXPENSES",
  POST: "POST PRODUCTION",
  OTHER: "OTHER EXPENSES",
};

const DEFAULT_GROUP: Record<TelfazSheetKey, BudgetLine["group"]> = {
  ATL: "ATL",
  BTL: "BTL",
  POST: "Post",
  OTHER: "Other",
};

/** SAR per USD written in the client's formulas (=O4*3.75). */
export const DEFAULT_FILE_FX = 3.75;

/** Notes prefix that carries the Kwalis "excluded" flag through the file. */
export const EXCLUDED_MARK = "[Excluded]";

/**
 * A section-level lump sum (the file's 6000 MUSIC = 120,000 / "VFX" = 60,000
 * rows carry an amount on the header account itself). The database refuses
 * header codes on a line, so the lump goes to the detail account that means
 * "the whole package" in the chart of accounts.
 */
export const HEADER_LUMP_CODE: Record<string, string> = {
  "6000": "6001", // COMPOSER (ALL-IN PACKAGE UNLESS NOTED)
  "6100": "6113", // TOTAL VFX
};

/** Section names of the file that have no header account in the app. */
const EXTRA_HEADER_NAMES: Record<string, string> = {
  "5600": "LEGAL & ACCOUNTING",
};

/** Header names written on a text cell instead of a code (sheet 3 "VFX"). */
const HEADER_ALIASES: Record<string, string> = {
  VFX: "6100",
  VISUALEFFECTS: "6100",
  MUSIC: "6000",
};

const TOL = 0.005;

// ─────────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────────

export type TelfazAdjustmentKind =
  | "periods" // some of prep / shooting / wrap are not in the file's formula
  | "total_periods" // the file multiplies by the TOTAL column, not prep+shoot+wrap
  | "no_periods" // the file uses qty × rate only
  | "fold" // periods folded into the quantity (Package / Epi units)
  | "lump" // nothing reproduces the file total → qty 1 × total
  | "sar_kept" // hard-coded SAR that is not USD × rate → SAR line
  | "code_mapped" // file code rewritten to a chart-of-accounts code
  | "header_lump"; // amount on a header account → its package detail code

export type TelfazAdjustment = {
  sheet: string;
  row: number;
  code: string;
  description: string;
  kind: TelfazAdjustmentKind;
  detail: string;
};

export type TelfazRowIssue = {
  sheet: string;
  row: number;
  code: string;
  item: string;
  reason: "included_in_production" | "no_item" | "no_code" | "no_section";
  usd: number;
  sar: number;
};

export type TelfazTotals = {
  /** The file's own figure (subtotal row / Top Sheet), null when absent. */
  fileSar: number | null;
  fileUsd: number | null;
  /** Sum of the file's own row values for the rows that were read. */
  rowsSar: number;
  rowsUsd: number;
  /** Totals of the Kwalis lines built from those rows (at the file's rate). */
  parsedSar: number;
  parsedUsd: number;
  /** USD effect of rows kept at their hard-coded SAR value. */
  sarKeptUsdDelta: number;
  /** "Included in Production" rows left out (sheet 3). */
  excludedUsd: number;
  /** match = equals the file's figure; explained = every row read exactly,
   *  the gap is in the file itself (subtotal formula / hard-coded SAR). */
  status: "match" | "explained" | "mismatch";
};

export type TelfazSectionCheck = TelfazTotals & {
  sheetKey: TelfazSheetKey;
  sheet: string;
  code: string;
  name: string;
  lines: number;
};

export type TelfazSheetCheck = TelfazTotals & {
  sheetKey: TelfazSheetKey;
  sheet: string;
  lines: number;
  sections: TelfazSectionCheck[];
};

export type TelfazValidation = {
  fx: number;
  sheets: TelfazSheetCheck[];
  grand: TelfazTotals;
  adjustments: TelfazAdjustment[];
  /** Rows not turned into a line (with the reason). */
  skipped: TelfazRowIssue[];
  ok: boolean;
};

export type TelfazParseResult = {
  lines: BudgetLine[];
  sheetOfLine: Record<string, string>;
  rowOfLine: Record<string, number>;
  validation: TelfazValidation;
  sheetsScanned: string[];
};

export type TelfazPreview = TemplatePreview & { telfaz: TelfazValidation };

// ─────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────

const near = (a: number, b: number, tol = TOL) =>
  Math.abs(a - b) <= tol + 1e-9 * Math.max(Math.abs(a), Math.abs(b));
const round2 = (n: number) => Math.round((n + Number.EPSILON * Math.abs(n)) * 100) / 100;
const fmt = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString("en-US") : round2(n).toLocaleString("en-US");

const sheetKeyOfName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "");

function findSheet(
  wb: ExcelJS.Workbook,
  key: TelfazSheetKey | "TOP",
): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find((ws) => {
    const k = sheetKeyOfName(ws.name);
    switch (key) {
      case "TOP":
        return k === "topsheet";
      case "ATL":
        return k.includes("abovetheline");
      case "BTL":
        return k.includes("productionexpenses") && !k.includes("post");
      case "POST":
        return k.includes("postproduction");
      case "OTHER":
        return k.includes("otherexpenses");
    }
  });
}

type Cell = { v: unknown; formula: boolean; ftext: string; empty: boolean };

function plain(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return plain(o.result);
    if ("formula" in o || "sharedFormula" in o) return null;
    if (Array.isArray(o.richText))
      return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    if ("text" in o) return plain(o.text);
    return null;
  }
  return v;
}

function readCell(ws: ExcelJS.Worksheet, r: number, c: number): Cell {
  const cell = ws.getCell(r, c);
  const raw = cell.value as unknown;
  const isFormula =
    !!raw &&
    typeof raw === "object" &&
    !(raw instanceof Date) &&
    ("formula" in (raw as object) || "sharedFormula" in (raw as object));
  const v = plain(raw);
  let ftext = "";
  if (isFormula) {
    try {
      ftext = String((cell as unknown as { formula?: string }).formula ?? "");
    } catch {
      ftext = "";
    }
  }
  return { v, formula: isFormula, ftext, empty: v === null || v === undefined || v === "" };
}

const txt = (c: Cell) => (c.empty ? "" : cleanText(c.v));
const num = (c: Cell) => {
  if (c.empty) return 0;
  const n = parseImportNumber(c.v);
  return n == null || !Number.isFinite(n) ? 0 : n;
};
const hasNum = (c: Cell) => !c.empty && parseImportNumber(c.v) != null;

const isSubtotalLabel = (s: string) => /^sub\s*-?\s*total\b/i.test(s.trim());
const isTotalLabel = (s: string) => /^(sub\s*-?\s*total|total)\b/i.test(s.trim());

type ParsedCode = { code: string; label: string; original: string; mapped: boolean };

/** "1401\nMain\nRoles" → 1401 + "Main Roles"; "55-01" → 5501; 3100 → "3100". */
export function parseTelfazCode(raw: unknown): ParsedCode | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    const s = String(raw).replace(/\.0+$/, "");
    return { code: s, label: "", original: s, mapped: false };
  }
  const s = String(raw).trim();
  if (!s) return null;
  const dash = /^(\d{2})\s*-\s*(\d{2})(?![\d])(.*)$/s.exec(s);
  if (dash && !/^\s*\d/.test(dash[3])) {
    return {
      code: `${dash[1]}${dash[2]}`,
      label: cleanText(dash[3]),
      original: s.replace(/\s+/g, " ").split(" ")[0],
      mapped: true,
    };
  }
  const m = /^(\d{3,6}(?:\.\d+)?)(?![\d])(.*)$/s.exec(s);
  if (!m) return null;
  const code = m[1].replace(/\.0+$/, "");
  return { code, label: cleanText(m[2]), original: code, mapped: false };
}

const normName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "");

/** Exact (normalised) name match of an item against the accounts of a header. */
export function matchCatalogCode(header: string, item: string): string | null {
  const want = normName(item);
  if (!want) return null;
  const hit = (MAIN_ACCOUNTS[header] ?? []).find((a) => normName(a.name) === want);
  return hit?.code ?? null;
}

function catalogName(code: string): string {
  const header = `${code.slice(0, 2)}00`;
  return (MAIN_ACCOUNTS[header] ?? []).find((a) => a.code === code)?.name ?? "";
}

export function telfazHeaderName(code: string): string {
  return HEADER_ACCOUNTS.find((h) => h.code === code)?.name ?? EXTRA_HEADER_NAMES[code] ?? code;
}

function groupFor(sheetKey: TelfazSheetKey, headerCode: string): BudgetLine["group"] {
  const macro = MACRO_CATEGORY_BY_HEADER[headerCode] as BudgetLine["group"] | undefined;
  if (sheetKey === "POST" && (macro === "Music" || macro === "VFX" || macro === "Post"))
    return macro;
  return DEFAULT_GROUP[sheetKey];
}

const noPeriods = (unit: string) => (UNITS_NO_PERIODS as readonly string[]).includes(unit);

/** "epi" → "Epi", "package" → "Package" (the units the app totals without periods). */
export function normalizeUnit(raw: string): string {
  const u = raw.trim();
  const hit = (UNITS_NO_PERIODS as readonly string[]).find(
    (x) => x.toLowerCase() === u.toLowerCase(),
  );
  return hit ?? u;
}

// ─────────────────────────────────────────────────────────────────
// Reproducing the file's total (the heart of the import)
// ─────────────────────────────────────────────────────────────────

export type TelfazBasis = {
  prep: number;
  shooting: number;
  wrap: number;
  /** The file's TOTAL (periods) column. */
  total: number;
  unit: string;
  qty: number;
  rate: number;
};

export type TelfazFit = {
  prep: number;
  shooting: number;
  wrap: number;
  x: number;
  amount: number;
  rate: number;
  unit: string;
  kind: "as_is" | "periods" | "total_periods" | "no_periods" | "fold" | "lump";
  note?: string;
};

/** Same arithmetic as lineTotalNative() in the store. */
export function fitNative(
  f: Pick<TelfazFit, "prep" | "shooting" | "wrap" | "x" | "amount" | "rate" | "unit">,
) {
  const base = (Number(f.amount) || 0) * (Number(f.rate) || 0);
  if (noPeriods(f.unit)) return base;
  const sum = (f.prep || 0) + (f.shooting || 0) + (f.wrap || 0);
  return base * (sum > 0 ? sum : f.x > 0 ? f.x : 1);
}

const PERIOD_LABEL = { prep: "Prep", shooting: "Shooting", wrap: "Wrap" } as const;

/**
 * Line values that give exactly `target` (the file's total for the row),
 * changing as little as possible. Never returns a line with another total.
 */
export type TelfazPeriodRef = "prep" | "shooting" | "wrap" | "total";

export function fitTelfazLine(
  b: TelfazBasis,
  target: number,
  /** Period columns the file's own formula multiplies by (when it is known). */
  prefer?: ReadonlySet<TelfazPeriodRef> | null,
): TelfazFit {
  const sum = b.prep + b.shooting + b.wrap;
  const base: TelfazFit = {
    prep: b.prep,
    shooting: b.shooting,
    wrap: b.wrap,
    x: sum > 0 ? sum : b.total > 0 ? b.total : 1,
    amount: b.qty,
    rate: b.rate,
    unit: b.unit,
    kind: "as_is",
  };
  if (near(fitNative(base), target)) return base;

  const parts = (["prep", "shooting", "wrap"] as const).filter((k) => b[k] > 0);
  const list = (keys: readonly ("prep" | "shooting" | "wrap")[]) =>
    keys.map((k) => `${PERIOD_LABEL[k]} ${fmt(b[k])}`).join(", ");

  if (!noPeriods(b.unit) && prefer) {
    // 0) what the file's formula says (=F12*J12*K12 → shooting only)
    const keep = parts.filter((k) => prefer.has(k));
    const useTotal = prefer.has("total") && keep.length === 0 && b.total > 0;
    const f: TelfazFit = {
      ...base,
      prep: keep.includes("prep") ? b.prep : 0,
      shooting: keep.includes("shooting") ? b.shooting : 0,
      wrap: keep.includes("wrap") ? b.wrap : 0,
      kind: useTotal ? "total_periods" : keep.length ? "periods" : "no_periods",
    };
    f.x = useTotal ? b.total : f.prep + f.shooting + f.wrap || 1;
    if (near(fitNative(f), target)) {
      const dropped = parts.filter((k) => !keep.includes(k));
      const was = [
        list(dropped),
        !useTotal && !keep.length && b.total > 0 ? `Total ${fmt(b.total)}` : "",
      ].filter(Boolean);
      const note =
        f.kind === "total_periods"
          ? parts.length
            ? `${list(parts)} kept out — the file multiplies by Total ${fmt(b.total)}`
            : `periods ${fmt(b.total)} from the Total column`
          : f.kind === "no_periods"
            ? `${was.join(", ")} not counted in the file's total (qty × rate)`
            : `${list(dropped)} not counted in the file's total`;
      return { ...f, note };
    }
  }

  if (!noPeriods(b.unit)) {
    // 1) a subset of prep / shooting / wrap is what the formula multiplies by
    for (let size = parts.length - 1; size >= 1; size--) {
      for (const keep of combinations(parts, size)) {
        const f: TelfazFit = {
          ...base,
          prep: keep.includes("prep") ? b.prep : 0,
          shooting: keep.includes("shooting") ? b.shooting : 0,
          wrap: keep.includes("wrap") ? b.wrap : 0,
          kind: "periods",
        };
        f.x = f.prep + f.shooting + f.wrap;
        if (near(fitNative(f), target)) {
          const dropped = parts.filter((k) => !keep.includes(k));
          return { ...f, note: `${list(dropped)} not counted in the file's total` };
        }
      }
    }
    // 2) the TOTAL column is the multiplier
    if (b.total > 0) {
      const f: TelfazFit = {
        ...base,
        prep: 0,
        shooting: 0,
        wrap: 0,
        x: b.total,
        kind: "total_periods",
      };
      if (near(fitNative(f), target))
        return {
          ...f,
          note: parts.length
            ? `${list(parts)} kept out — the file multiplies by Total ${fmt(b.total)}`
            : `periods ${fmt(b.total)} from the Total column`,
        };
    }
    // 3) no period multiplier at all (qty × rate)
    const f: TelfazFit = { ...base, prep: 0, shooting: 0, wrap: 0, x: 1, kind: "no_periods" };
    if (near(fitNative(f), target)) {
      const was = [list(parts), b.total > 0 ? `Total ${fmt(b.total)}` : ""].filter(Boolean);
      return { ...f, note: `${was.join(", ")} not counted in the file's total (qty × rate)` };
    }
  } else {
    // Package / Epi lines ignore periods in Kwalis: fold the file's multiplier into qty
    const mults = Array.from(new Set([b.total, sum, b.prep, b.shooting, b.wrap])).filter(
      (m) => m > 0 && m !== 1,
    );
    for (const m of mults) {
      const f: TelfazFit = {
        ...base,
        amount: round2(b.qty * m),
        kind: "fold",
      };
      if (near(fitNative(f), target))
        return {
          ...f,
          note: `quantity ${fmt(b.qty)} × ${fmt(m)} — ${b.unit} lines are not multiplied by periods`,
        };
    }
  }

  // 4) lump sum — keep the file's figure, the original numbers go to the notes
  const shown = [
    `qty ${fmt(b.qty)}`,
    `rate ${fmt(b.rate)}`,
    sum > 0 ? `periods ${fmt(sum)}` : b.total > 0 ? `total ${fmt(b.total)}` : "",
  ].filter(Boolean);
  return {
    prep: 0,
    shooting: 0,
    wrap: 0,
    x: 1,
    amount: 1,
    rate: round2(target),
    unit: b.unit && !noPeriods(b.unit) ? b.unit : b.unit || "Allow",
    kind: "lump",
    note: `lump sum ${fmt(round2(target))} (file: ${shown.join(", ")})`,
  };
}

function* combinations<T>(arr: readonly T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of combinations(arr.slice(i + 1), k - 1)) yield [arr[i], ...rest];
}

/** The database caps a description at 500 characters; the rest goes to the notes. */
function clipDescription(d: string): { description: string; rest: string } {
  if (d.length <= 500) return { description: d, rest: "" };
  return { description: `${d.slice(0, 497)}…`, rest: `Description: ${d}` };
}

const joinNotes = (...parts: (string | undefined | null)[]) =>
  parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" · ");

/**
 * Period columns a row's total formula multiplies by ("F43*J43*K43" →
 * shooting). null when the formula is not a plain product of the row's cells.
 */
function formulaPeriodRefs(
  cell: Cell,
  row: number,
  cols: Record<string, TelfazPeriodRef>,
  valueCols: string[],
): Set<TelfazPeriodRef> | null {
  if (!cell.formula || !cell.ftext) return null;
  const f = cell.ftext.replace(/\$/g, "").replace(/\s+/g, "");
  // only a plain product of this row's cells: H4*J4*K4, (J27)*(K27)
  if (!/^\(?[A-Z]{1,2}\d+\)?(\*\(?[A-Z]{1,2}\d+\)?)*$/.test(f)) return null;
  const refs = Array.from(f.matchAll(/([A-Z]{1,2})(\d+)/g));
  if (!refs.length) return null;
  const out = new Set<TelfazPeriodRef>();
  for (const [, col, r] of refs) {
    if (Number(r) !== row) return null;
    if (cols[col]) out.add(cols[col]);
    else if (!valueCols.includes(col)) return null;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────────

/** True when the workbook is laid out like the client's budget file. */
export function isTelfazWorkbook(wb: ExcelJS.Workbook): boolean {
  const ws = findSheet(wb, "ATL") ?? findSheet(wb, "BTL");
  if (!ws) return false;
  const last = Math.min(ws.rowCount, 60);
  for (let r = 1; r <= last; r++) {
    const d = txt(readCell(ws, r, 4)).toUpperCase();
    const n = txt(readCell(ws, r, 14)).toUpperCase();
    const o = txt(readCell(ws, r, 15)).toUpperCase();
    if (d === "NAME" && (n === "SAR" || /DOLLAR|USD/.test(o))) return true;
  }
  return false;
}

/** SAR per USD the file uses: the multiplier of its SAR formulas (=O4*3.75). */
function detectFx(wb: ExcelJS.Workbook): number {
  const votes = new Map<number, number>();
  const vote = (sar: Cell, usd: Cell) => {
    if (!sar.formula) return;
    const s = num(sar);
    const u = num(usd);
    if (!s || !u) return;
    const ratio = Math.round((s / u) * 10000) / 10000;
    votes.set(ratio, (votes.get(ratio) ?? 0) + 1);
  };
  for (const key of ["ATL", "BTL"] as const) {
    const ws = findSheet(wb, key);
    if (!ws) continue;
    for (let r = 1; r <= ws.rowCount; r++) vote(readCell(ws, r, 14), readCell(ws, r, 15));
  }
  const other = findSheet(wb, "OTHER");
  if (other)
    for (let r = 1; r <= other.rowCount; r++) vote(readCell(other, r, 7), readCell(other, r, 8));
  let best = DEFAULT_FILE_FX;
  let bestN = 0;
  for (const [ratio, n] of votes) if (n > bestN) [best, bestN] = [ratio, n];
  return best > 0 ? best : DEFAULT_FILE_FX;
}

// ─────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────

type SectionAcc = {
  sheetKey: TelfazSheetKey;
  sheet: string;
  code: string;
  name: string;
  fileSar: number | null;
  fileUsd: number | null;
  rowsSar: number;
  rowsUsd: number;
  parsedSar: number;
  parsedUsd: number;
  sarKeptUsdDelta: number;
  excludedUsd: number;
  lines: number;
};

class Ctx {
  lines: BudgetLine[] = [];
  sheetOfLine: Record<string, string> = {};
  rowOfLine: Record<string, number> = {};
  adjustments: TelfazAdjustment[] = [];
  skipped: TelfazRowIssue[] = [];
  sections = new Map<string, SectionAcc>();
  sectionOrder: string[] = [];
  constructor(public fx: number) {}

  section(sheetKey: TelfazSheetKey, sheet: string, code: string, name: string): SectionAcc {
    const key = `${sheetKey}|${code}`;
    let s = this.sections.get(key);
    if (!s) {
      s = {
        sheetKey,
        sheet,
        code,
        name: name || telfazHeaderName(code),
        fileSar: null,
        fileUsd: null,
        rowsSar: 0,
        rowsUsd: 0,
        parsedSar: 0,
        parsedUsd: 0,
        sarKeptUsdDelta: 0,
        excludedUsd: 0,
        lines: 0,
      };
      this.sections.set(key, s);
      this.sectionOrder.push(key);
    } else if (!s.name && name) s.name = name;
    return s;
  }

  add(
    sec: SectionAcc,
    row: number,
    line: Omit<BudgetLine, "id" | "group" | "headerCode">,
    file: { sar: number; usd: number },
  ) {
    const l: BudgetLine = {
      id: generateId(),
      headerCode: sec.code,
      group: groupFor(sec.sheetKey, sec.code),
      topsheetCode: null,
      ...line,
    };
    const native = l.excluded
      ? 0
      : fitNative({ ...l, prep: l.prep ?? 0, shooting: l.shooting ?? 0, wrap: l.wrap ?? 0 });
    const sar = l.currency === "SAR" ? native : native * this.fx;
    const usd = l.currency === "SAR" ? native / this.fx : native;
    sec.parsedSar += sar;
    sec.parsedUsd += usd;
    sec.rowsSar += file.sar;
    sec.rowsUsd += file.usd;
    sec.lines += 1;
    this.lines.push(l);
    this.sheetOfLine[l.id] = sec.sheet;
    this.rowOfLine[l.id] = row;
    return l;
  }

  adjust(
    sheet: string,
    row: number,
    code: string,
    description: string,
    kind: TelfazAdjustmentKind,
    detail: string,
  ) {
    this.adjustments.push({ sheet, row, code, description, kind, detail });
  }
}

/** Notes + excluded flag from the file's notes text. */
function splitExcluded(notes: string): { notes: string; excluded: boolean } {
  const t = notes.trim();
  if (t.startsWith(EXCLUDED_MARK))
    return {
      notes: t
        .slice(EXCLUDED_MARK.length)
        .replace(/^\s*·?\s*/, "")
        .trim(),
      excluded: true,
    };
  return { notes: t, excluded: false };
}

const currencyMark = (c: Cell): "SAR" | "USD" | null => {
  const s = txt(c).toUpperCase();
  return s === "SAR" || s === "USD" ? s : null;
};

/** Sheets 1 and 2. */
function parseLineSheet(ws: ExcelJS.Worksheet, sheetKey: TelfazSheetKey, ctx: Ctx) {
  const sheet = ws.name;
  let sec: SectionAcc | null = null;
  let lastCode = "";
  const lastItemByCode = new Map<string, string>();
  // 1000 / 1100 sections label column F "Amount" (a multiplier), not shooting weeks
  let fIsAmount = false;

  for (let r = 1; r <= ws.rowCount; r++) {
    const c = (col: number) => readCell(ws, r, col);
    const B = c(2);
    const C = c(3);
    const D = c(4);
    const bTxt = txt(B);
    const cTxt = txt(C);
    const dTxt = txt(D);

    // Section header row: "<code> | <NAME> | NAME | PREP WEEKS | … | SAR | Dollar"
    if (dTxt.toUpperCase() === "NAME") {
      const pc = parseTelfazCode(B.v);
      const fLabel = txt(c(6));
      fIsAmount = /amount/i.test(fLabel) && !/shoot/i.test(fLabel);
      if (pc) {
        sec = ctx.section(sheetKey, sheet, pc.code, cTxt);
        lastCode = "";
      }
      continue;
    }
    if (isTotalLabel(bTxt) || isTotalLabel(cTxt)) {
      // the section's own subtotal ("Subtotal" in B); inner "Sub Total for …"
      // rows (C) and the sheet total are skipped.
      if (sec && isSubtotalLabel(bTxt) && sec.fileSar === null) {
        sec.fileSar = num(c(14));
        sec.fileUsd = num(c(15));
      }
      continue;
    }

    const E = num(c(5));
    const Fraw = num(c(6));
    const G = num(c(7));
    const Hraw = num(c(8));
    const F = fIsAmount ? 0 : Fraw;
    const H = fIsAmount ? Hraw || Fraw : Hraw;
    const unit = normalizeUnit(txt(c(9)));
    const J = num(c(10));
    const K = num(c(11));
    const L = txt(c(12));
    const M = txt(c(13));
    const Ncell = c(14);
    const Ocell = c(15);
    const N = num(Ncell);
    const O = num(Ocell);
    const mark = currencyMark(c(16));
    const anyValue = !!(E || F || G || H || J || K || N || O);

    const pc = parseTelfazCode(B.v);
    if (!pc && !bTxt && !cTxt && !dTxt && !anyValue) continue; // blank / formula-only row

    if (!sec) {
      const hc = pc ? `${pc.code.slice(0, 2)}00` : "";
      if (!hc) {
        // sheet title (merged across the columns) / banner text above the first section
        if (anyValue)
          ctx.skipped.push({
            sheet,
            row: r,
            code: bTxt,
            item: cTxt,
            reason: "no_section",
            usd: O,
            sar: N,
          });
        continue;
      }
      sec = ctx.section(sheetKey, sheet, hc, "");
    }

    let code = pc?.code ?? "";
    // "Breakdown:" is a label for the rows below, not an item of its own
    const itemTxt = /:$/.test(cTxt) ? "" : cTxt;
    const description =
      itemTxt ||
      (code ? lastItemByCode.get(code) : "") ||
      cTxt.replace(/:$/, "") ||
      pc?.label ||
      dTxt ||
      (code ? catalogName(code) : "");
    if (!cTxt && !dTxt && !anyValue) {
      // a code with nothing else ("1401 Main Roles" placeholder row)
      ctx.skipped.push({ sheet, row: r, code: bTxt, item: "", reason: "no_item", usd: 0, sar: 0 });
      continue;
    }
    if (!code) {
      const byName = matchCatalogCode(sec.code, description);
      code = lastCode || byName || "";
      if (!code) {
        if (!anyValue) {
          ctx.skipped.push({
            sheet,
            row: r,
            code: "",
            item: description,
            reason: "no_code",
            usd: 0,
            sar: 0,
          });
          continue;
        }
        code = sec.code;
        ctx.adjust(
          sheet,
          r,
          code,
          description,
          "code_mapped",
          `no code in the file — placed on header ${code}; give it a detail code`,
        );
      }
    }
    if (itemTxt) lastItemByCode.set(code, itemTxt);
    lastCode = code;

    const { notes: userNotes, excluded } = splitExcluded(joinNotes(L, M));

    // Currency: explicit marker (Kwalis export) › hard-coded SAR › USD.
    let currency: "SAR" | "USD" = mark ?? "USD";
    let sarKept = false;
    if (!mark && !Ncell.empty) {
      if (Ocell.empty) currency = N !== 0 ? "SAR" : "USD";
      else if (!near(N, O * ctx.fx, 0.01)) {
        currency = "SAR";
        sarKept = true;
      }
    }
    const target = currency === "SAR" ? N : O;
    const basis: TelfazBasis = { prep: E, shooting: F, wrap: G, total: H, unit, qty: J, rate: K };
    const prefer = formulaPeriodRefs(
      currency === "SAR" && !mark ? Ocell : currency === "SAR" ? Ncell : Ocell,
      r,
      { E: "prep", F: fIsAmount ? "total" : "shooting", G: "wrap", H: "total" },
      ["J", "K"],
    );
    const fit: TelfazFit = excluded
      ? {
          prep: E,
          shooting: F,
          wrap: G,
          x: E + F + G || H || 1,
          amount: J,
          rate: K,
          unit,
          kind: "as_is",
        }
      : fitTelfazLine(basis, target, prefer);

    let note = fit.note ? `File: ${fit.note}` : "";
    if (sarKept) {
      note = joinNotes(
        `File: SAR ${fmt(N)} hard-coded (USD column ${fmt(O)}, not × ${ctx.fx}) — kept in SAR`,
        fit.kind === "lump" ? "" : note,
      );
      ctx.adjust(
        sheet,
        r,
        code,
        description,
        "sar_kept",
        `SAR ${fmt(N)} kept (USD ${fmt(O)} × ${ctx.fx} = ${fmt(round2(O * ctx.fx))})`,
      );
      if (fit.kind === "lump") note = joinNotes(note, `qty ${fmt(J)} × rate ${fmt(K)} USD`);
    } else if (fit.kind !== "as_is") {
      ctx.adjust(sheet, r, code, description, fit.kind, fit.note ?? "");
    }

    const fileUsd = currency === "SAR" && Ocell.empty ? N / ctx.fx : O;
    const fileSar = Ncell.empty ? O * ctx.fx : N;
    const desc = clipDescription(description || dTxt || code);
    ctx.add(
      sec,
      r,
      {
        mainCode: code,
        description: desc.description,
        name: dTxt && dTxt !== description ? dTxt : undefined,
        amount: fit.amount,
        rate: fit.rate,
        currency,
        unit: fit.unit || "Flat",
        x: fit.x,
        prep: fit.prep,
        shooting: fit.shooting,
        wrap: fit.wrap,
        notes: joinNotes(userNotes, desc.rest, note) || undefined,
        excluded,
      },
      { sar: fileSar, usd: fileUsd },
    );
    if (sarKept) sec.sarKeptUsdDelta += N / ctx.fx - O;
  }
}

/** Sheet 3 (post). */
function parsePostSheet(ws: ExcelJS.Worksheet, ctx: Ctx) {
  const sheet = ws.name;
  let started = false;
  let sec: SectionAcc | null = null;
  let lastCode = "";
  let lastTitle = "";

  for (let r = 1; r <= ws.rowCount; r++) {
    const c = (col: number) => readCell(ws, r, col);
    const B = c(2);
    const bTxt = txt(B);
    if (!started) {
      if (/code of chart/i.test(bTxt)) started = true;
      continue;
    }
    const C = c(3);
    const cTxt = txt(C);
    const dTxt = txt(c(4));
    if (isTotalLabel(bTxt) || isTotalLabel(cTxt)) continue;

    const Ec = c(5);
    const Gc = c(7);
    const Hc = c(8);
    const Ic = c(9);
    const unit = normalizeUnit(txt(c(6)));
    const J = txt(c(10));
    const mark = currencyMark(c(11));
    const nums = hasNum(Ec) || hasNum(Gc) || hasNum(Hc);
    const I = num(Ic);

    const pc = parseTelfazCode(B.v);
    const alias = !pc && bTxt ? HEADER_ALIASES[normName(bTxt)] : undefined;
    if (!pc && !alias && !bTxt && !cTxt && !dTxt && !nums && !I) continue;

    // Section header (code ending in 00 with no qty / rate) — or "VFX" text row.
    if ((pc && /00$/.test(pc.code) && !nums) || (alias && !nums)) {
      const code = pc?.code ?? alias!;
      sec = ctx.section("POST", sheet, code, cTxt || (alias ? telfazHeaderName(code) : ""));
      lastCode = "";
      lastTitle = "";
      if (Ic.formula || !I) {
        if (sec.fileUsd === null) {
          sec.fileUsd = I;
          sec.fileSar = I * ctx.fx;
        }
        continue;
      }
      // a hard-coded amount on the header itself → one lump line
      sec.fileUsd = (sec.fileUsd ?? 0) + I;
      sec.fileSar = (sec.fileSar ?? 0) + I * ctx.fx;
      const detail = HEADER_LUMP_CODE[code] ?? (MAIN_ACCOUNTS[code] ?? [])[0]?.code ?? code;
      const description = cTxt || telfazHeaderName(code);
      ctx.adjust(
        sheet,
        r,
        detail,
        description,
        "header_lump",
        `amount on header ${code} placed on ${detail} ${catalogName(detail)}`.trim(),
      );
      ctx.add(
        sec,
        r,
        {
          mainCode: detail,
          description,
          amount: 1,
          rate: round2(I),
          currency: "USD",
          unit: "Allow",
          x: 1,
          prep: 0,
          shooting: 0,
          wrap: 0,
          notes: joinNotes(J, `File: lump sum on header ${code}`) || undefined,
          excluded: false,
        },
        { sar: I * ctx.fx, usd: I },
      );
      continue;
    }

    if (/included in production/i.test(J)) {
      const s = sec ?? ctx.section("POST", sheet, pc ? `${pc.code.slice(0, 2)}00` : "POST", "");
      s.excludedUsd += I;
      ctx.skipped.push({
        sheet,
        row: r,
        code: pc?.code ?? "",
        item: cTxt,
        reason: "included_in_production",
        usd: I,
        sar: I * ctx.fx,
      });
      continue;
    }

    // An account title with children below it ("5001 PICTURE EDITOR").
    if (pc && !nums && !I) {
      const next = readCell(ws, r + 1, 2);
      if (
        !parseTelfazCode(next.v) &&
        (txt(readCell(ws, r + 1, 3)) || hasNum(readCell(ws, r + 1, 8)))
      ) {
        lastCode = pc.code;
        lastTitle = cTxt;
        continue;
      }
    }

    if (!sec) {
      const hc = pc ? `${pc.code.slice(0, 2)}00` : "";
      if (!hc) {
        ctx.skipped.push({
          sheet,
          row: r,
          code: bTxt,
          item: cTxt,
          reason: "no_section",
          usd: I,
          sar: I * ctx.fx,
        });
        continue;
      }
      sec = ctx.section("POST", sheet, hc, "");
    }

    let code = pc?.code ?? "";
    const description = cTxt || dTxt || lastTitle || (code ? catalogName(code) : "");
    if (!code) {
      code = lastCode || matchCatalogCode(sec.code, description) || "";
      if (!code) {
        if (!nums && !I) {
          ctx.skipped.push({
            sheet,
            row: r,
            code: "",
            item: description,
            reason: "no_code",
            usd: 0,
            sar: 0,
          });
          continue;
        }
        code = sec.code;
        ctx.adjust(
          sheet,
          r,
          code,
          description,
          "code_mapped",
          `no code in the file — placed on header ${code}; give it a detail code`,
        );
      }
    } else {
      lastCode = code;
      lastTitle = "";
    }

    const { notes: userNotes, excluded } = splitExcluded(J);
    const currency: "SAR" | "USD" = mark ?? "USD";
    const target = currency === "SAR" ? I * ctx.fx : I;
    const E = num(Ec);
    const basis: TelfazBasis = {
      prep: 0,
      shooting: 0,
      wrap: 0,
      total: E,
      unit,
      qty: num(Gc),
      rate: num(Hc),
    };
    let fit: TelfazFit;
    if (excluded) {
      fit = {
        prep: 0,
        shooting: 0,
        wrap: 0,
        x: E > 0 ? E : 1,
        amount: basis.qty,
        rate: basis.rate,
        unit,
        kind: "as_is",
      };
    } else if (!Ec.empty || noPeriods(unit)) {
      fit = fitTelfazLine(basis, target);
    } else {
      // no Amount (periods) in the file → the formula gives 0 unless qty×rate is the total
      fit = fitTelfazLine({ ...basis, total: 0 }, target);
    }
    if (fit.kind === "total_periods") fit = { ...fit, kind: "as_is", note: undefined };
    if (fit.kind !== "as_is") ctx.adjust(sheet, r, code, description, fit.kind, fit.note ?? "");

    const desc = clipDescription(description || code);
    ctx.add(
      sec,
      r,
      {
        mainCode: code,
        description: desc.description,
        name: dTxt && dTxt !== description ? dTxt : undefined,
        amount: fit.amount,
        rate: fit.rate,
        currency,
        unit: fit.unit || "Flat",
        x: fit.x,
        prep: 0,
        shooting: 0,
        wrap: 0,
        notes: joinNotes(userNotes, desc.rest, fit.note ? `File: ${fit.note}` : "") || undefined,
        excluded,
      },
      { sar: I * ctx.fx, usd: I },
    );
  }
}

/** Sheet 4 (other). */
function parseOtherSheet(ws: ExcelJS.Worksheet, ctx: Ctx) {
  const sheet = ws.name;
  let sec: SectionAcc | null = null;
  for (let r = 1; r <= ws.rowCount; r++) {
    const c = (col: number) => readCell(ws, r, col);
    const B = c(2);
    const bTxt = txt(B);
    const cTxt = txt(c(3));
    const dTxt = txt(c(4));
    if (dTxt.toUpperCase() === "NAME") {
      const pc = parseTelfazCode(B.v);
      if (pc) {
        const code = pc.mapped ? `${pc.code.slice(0, 2)}00` : pc.code;
        sec = ctx.section("OTHER", sheet, code, cTxt);
      }
      continue;
    }
    if (isTotalLabel(bTxt) || isTotalLabel(cTxt)) {
      if (sec && isSubtotalLabel(bTxt) && sec.fileSar === null) {
        sec.fileSar = num(c(7));
        sec.fileUsd = num(c(8));
      }
      continue;
    }
    const days = num(c(5));
    const notesRaw = txt(c(6));
    const Gc = c(7);
    const Hc = c(8);
    const Gv = num(Gc);
    const Hv = num(Hc);
    const mark = currencyMark(c(9));
    const unitCol = normalizeUnit(txt(c(10)));
    const Kc = c(11);
    const Lc = c(12);
    const Mc = c(13);
    const detail = hasNum(Kc) || hasNum(Lc);
    const anyValue = !!(Gv || Hv || days || detail);
    const pc = parseTelfazCode(B.v);
    if (!pc && !bTxt && !cTxt && !dTxt && !anyValue) continue;
    if (!sec) {
      if (!pc) {
        if (anyValue)
          ctx.skipped.push({
            sheet,
            row: r,
            code: bTxt,
            item: cTxt,
            reason: "no_section",
            usd: Hv,
            sar: Gv,
          });
        continue;
      }
      sec = ctx.section("OTHER", sheet, `${pc.code.slice(0, 2)}00`, "");
    }
    const description = cTxt || pc?.label || dTxt || (pc ? catalogName(pc.code) : "");
    if (pc && !description && !anyValue) {
      ctx.skipped.push({ sheet, row: r, code: bTxt, item: "", reason: "no_item", usd: 0, sar: 0 });
      continue;
    }
    let code = pc?.code ?? "";
    const extra: string[] = [];
    if (pc?.mapped) {
      extra.push(`File code ${pc.original}`);
      ctx.adjust(sheet, r, code, description, "code_mapped", `${pc.original} → ${code}`);
    }
    if (!code) {
      const byName = matchCatalogCode(sec.code, description);
      if (byName) {
        code = byName;
        extra.push(`File: no code — matched to ${byName} by name`);
        ctx.adjust(
          sheet,
          r,
          code,
          description,
          "code_mapped",
          `no code in the file — matched to ${byName} ${catalogName(byName)} by name`,
        );
      } else if (!anyValue) {
        ctx.skipped.push({
          sheet,
          row: r,
          code: "",
          item: description,
          reason: "no_code",
          usd: 0,
          sar: 0,
        });
        continue;
      } else {
        code = sec.code;
        ctx.adjust(
          sheet,
          r,
          code,
          description,
          "code_mapped",
          `no code in the file — placed on header ${code}; give it a detail code`,
        );
      }
    }
    if (days && !detail) extra.push(`Days ${fmt(days)}`);
    const { notes: userNotes, excluded } = splitExcluded(notesRaw);

    let currency: "SAR" | "USD" = mark ?? "USD";
    let sarKept = false;
    if (!mark && !Gc.empty) {
      if (Hc.empty) currency = Gv !== 0 ? "SAR" : "USD";
      else if (!near(Gv, Hv * ctx.fx, 0.01)) {
        currency = "SAR";
        sarKept = true;
      }
    }
    const target = currency === "SAR" ? Gv : Hv;
    let fit: TelfazFit;
    if (detail) {
      const basis: TelfazBasis = {
        prep: 0,
        shooting: 0,
        wrap: 0,
        total: num(Mc),
        unit: unitCol,
        qty: num(Kc),
        rate: num(Lc),
      };
      fit = excluded
        ? {
            prep: 0,
            shooting: 0,
            wrap: 0,
            x: basis.total || 1,
            amount: basis.qty,
            rate: basis.rate,
            unit: unitCol,
            kind: "as_is",
          }
        : fitTelfazLine(basis, target);
      if (fit.kind === "total_periods") fit = { ...fit, kind: "as_is", note: undefined };
    } else {
      fit = {
        prep: 0,
        shooting: 0,
        wrap: 0,
        x: 1,
        amount: 1,
        rate: round2(target),
        unit: "Allow",
        kind: "as_is",
      };
    }
    if (fit.kind !== "as_is") ctx.adjust(sheet, r, code, description, fit.kind, fit.note ?? "");
    if (sarKept) {
      extra.push(`File: SAR ${fmt(Gv)} hard-coded (USD column ${fmt(Hv)}) — kept in SAR`);
      ctx.adjust(sheet, r, code, description, "sar_kept", `SAR ${fmt(Gv)} kept (USD ${fmt(Hv)})`);
      sec.sarKeptUsdDelta += Gv / ctx.fx - Hv;
    }
    const desc = clipDescription(description || code);
    if (desc.rest) extra.push(desc.rest);
    ctx.add(
      sec,
      r,
      {
        mainCode: code,
        description: desc.description,
        name: dTxt && dTxt !== description ? dTxt : undefined,
        amount: fit.amount,
        rate: fit.rate,
        currency,
        unit: fit.unit || "Allow",
        x: fit.x,
        prep: 0,
        shooting: 0,
        wrap: 0,
        notes: joinNotes(userNotes, ...extra, fit.note ? `File: ${fit.note}` : "") || undefined,
        excluded,
      },
      { sar: Gc.empty ? Hv * ctx.fx : Gv, usd: Hc.empty ? Gv / ctx.fx : Hv },
    );
  }
}

type TopSheetTotals = Partial<Record<TelfazSheetKey | "GRAND", { sar: number; usd: number }>>;

function parseTopSheet(ws: ExcelJS.Worksheet | undefined): TopSheetTotals {
  const out: TopSheetTotals = {};
  if (!ws) return out;
  for (let r = 1; r <= ws.rowCount; r++) {
    let label = "";
    for (let col = 2; col <= 4 && !label; col++) label = txt(readCell(ws, r, col));
    const L = label.toUpperCase();
    let key: TelfazSheetKey | "GRAND" | null = null;
    if (/^TOTAL ABOVE THE LINE/.test(L)) key = "ATL";
    else if (/^TOTAL (PRODUCTION|BELOW THE LINE)/.test(L)) key = "BTL";
    else if (/^TOTAL POST/.test(L)) key = "POST";
    else if (/^TOTAL OTHER/.test(L)) key = "OTHER";
    else if (/^TOTAL BUDGET BEFORE/.test(L)) key = "GRAND";
    if (!key || out[key]) continue;
    out[key] = { sar: num(readCell(ws, r, 7)), usd: num(readCell(ws, r, 8)) };
  }
  return out;
}

function statusOf(t: Omit<TelfazTotals, "status">): TelfazTotals["status"] {
  const tol = 0.01;
  if (
    t.fileSar !== null &&
    t.fileUsd !== null &&
    near(t.parsedSar, t.fileSar, tol) &&
    near(t.parsedUsd, t.fileUsd, tol)
  )
    return "match";
  const rowsOk =
    near(t.parsedSar, t.rowsSar, tol) && near(t.parsedUsd, t.rowsUsd + t.sarKeptUsdDelta, tol);
  return rowsOk ? "explained" : "mismatch";
}

const r2 = (n: number) => round2(n);
const r2n = (n: number | null) => (n === null ? null : round2(n));

/** Parse an already-loaded workbook (pure — used by the tests and the UI). */
export function parseTelfazWorkbook(wb: ExcelJS.Workbook): TelfazParseResult {
  const fx = detectFx(wb);
  const ctx = new Ctx(fx);
  const sheetsScanned: string[] = [];
  const sheetName: Partial<Record<TelfazSheetKey, string>> = {};
  for (const key of TELFAZ_SHEET_KEYS) {
    const ws = findSheet(wb, key);
    if (!ws) continue;
    sheetsScanned.push(ws.name);
    sheetName[key] = ws.name;
    if (key === "ATL" || key === "BTL") parseLineSheet(ws, key, ctx);
    else if (key === "POST") parsePostSheet(ws, ctx);
    else parseOtherSheet(ws, ctx);
  }
  const top = parseTopSheet(findSheet(wb, "TOP"));

  const sheets: TelfazSheetCheck[] = [];
  for (const key of TELFAZ_SHEET_KEYS) {
    if (!sheetName[key]) continue;
    const secs = ctx.sectionOrder
      .map((k) => ctx.sections.get(k)!)
      .filter((s) => s.sheetKey === key);
    const sum = (f: (s: SectionAcc) => number) => secs.reduce((a, s) => a + f(s), 0);
    const sections: TelfazSectionCheck[] = secs.map((s) => {
      const base = {
        fileSar: r2n(s.fileSar),
        fileUsd: r2n(s.fileUsd),
        rowsSar: r2(s.rowsSar),
        rowsUsd: r2(s.rowsUsd),
        parsedSar: r2(s.parsedSar),
        parsedUsd: r2(s.parsedUsd),
        sarKeptUsdDelta: r2(s.sarKeptUsdDelta),
        excludedUsd: r2(s.excludedUsd),
      };
      return {
        ...base,
        sheetKey: key,
        sheet: s.sheet,
        code: s.code,
        name: s.name,
        lines: s.lines,
        status:
          s.lines === 0 && s.excludedUsd > 0
            ? "match"
            : statusOf({ ...base, fileSar: s.fileSar, fileUsd: s.fileUsd }),
      };
    });
    const t = top[key];
    const base = {
      fileSar: t ? r2(t.sar) : null,
      fileUsd: t ? r2(t.usd) : null,
      rowsSar: r2(sum((s) => s.rowsSar)),
      rowsUsd: r2(sum((s) => s.rowsUsd)),
      parsedSar: r2(sum((s) => s.parsedSar)),
      parsedUsd: r2(sum((s) => s.parsedUsd)),
      sarKeptUsdDelta: r2(sum((s) => s.sarKeptUsdDelta)),
      excludedUsd: r2(sum((s) => s.excludedUsd)),
    };
    sheets.push({
      ...base,
      sheetKey: key,
      sheet: sheetName[key]!,
      lines: sections.reduce((a, s) => a + s.lines, 0),
      sections,
      status: statusOf({ ...base, fileSar: t ? t.sar : null, fileUsd: t ? t.usd : null }),
    });
  }
  const gsum = (f: (s: TelfazSheetCheck) => number) => sheets.reduce((a, s) => a + f(s), 0);
  const gt = top.GRAND;
  const gbase = {
    fileSar: gt ? r2(gt.sar) : null,
    fileUsd: gt ? r2(gt.usd) : null,
    rowsSar: r2(gsum((s) => s.rowsSar)),
    rowsUsd: r2(gsum((s) => s.rowsUsd)),
    parsedSar: r2(gsum((s) => s.parsedSar)),
    parsedUsd: r2(gsum((s) => s.parsedUsd)),
    sarKeptUsdDelta: r2(gsum((s) => s.sarKeptUsdDelta)),
    excludedUsd: r2(gsum((s) => s.excludedUsd)),
  };
  const grand: TelfazTotals = { ...gbase, status: statusOf(gbase) };
  const unreadMoney = ctx.skipped.some(
    (s) =>
      s.reason !== "included_in_production" && (Math.abs(s.usd) > TOL || Math.abs(s.sar) > TOL),
  );
  return {
    lines: ctx.lines,
    sheetOfLine: ctx.sheetOfLine,
    rowOfLine: ctx.rowOfLine,
    sheetsScanned,
    validation: {
      fx,
      sheets,
      grand,
      adjustments: ctx.adjustments,
      skipped: ctx.skipped,
      ok:
        !unreadMoney && sheets.every((s) => s.status !== "mismatch") && grand.status !== "mismatch",
    },
  };
}

async function loadWorkbook(src: File | ArrayBuffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const ExcelJSLib = await loadExcelJs();
  const wb = new ExcelJSLib.Workbook();
  const buf =
    src instanceof ArrayBuffer
      ? src
      : src instanceof Uint8Array
        ? src
        : await (src as File).arrayBuffer();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

/** The Telfaz preview (null when the workbook is not in this layout). */
export async function parseTelfazBudgetPreview(
  src: File | ArrayBuffer | Uint8Array,
): Promise<TelfazPreview | null> {
  const wb = await loadWorkbook(src);
  if (!isTelfazWorkbook(wb)) return null;
  const parsed = parseTelfazWorkbook(wb);
  const result: ImportResult = {
    budget: parsed.lines,
    vendors: [],
    people: [],
    anonymized: 0,
    sheetsScanned: parsed.sheetsScanned,
  };
  return {
    result,
    mismatches: [],
    unknownSheets: [],
    sheetOfLine: parsed.sheetOfLine,
    rowOfLine: parsed.rowOfLine,
    officialKwalisTemplate: true,
    ignoredRows: [],
    stateMachineSheets: [],
    topLines: [],
    telfaz: parsed.validation,
  };
}

/**
 * "Kwalis template" mode: the client's own layout first, then the existing
 * template parser (so every format that worked before still works).
 */
export async function parseBudgetPreviewAuto(
  file: File,
  opts?: Parameters<typeof import("@/lib/excelTemplate").parseKwalisTemplatePreview>[1],
): Promise<TemplatePreview | TelfazPreview> {
  if (/\.xlsx$/i.test(file.name) || file.type.includes("spreadsheetml")) {
    try {
      const telfaz = await parseTelfazBudgetPreview(file);
      if (telfaz) return telfaz;
    } catch {
      /* not readable by ExcelJS (e.g. .xls) — fall through */
    }
  }
  const { parseKwalisTemplatePreview } = await import("@/lib/excelTemplate");
  return parseKwalisTemplatePreview(file, opts);
}

export const isTelfazPreview = (p: TemplatePreview | null | undefined): p is TelfazPreview =>
  !!p && "telfaz" in p && !!(p as TelfazPreview).telfaz;

// ═══════════════════════════════════════════════════════════════════
// EXPORT — same layout, re-importable
// ═══════════════════════════════════════════════════════════════════

export type TelfazExportOptions = {
  projectTitle?: string;
  productionCompany?: string;
  budgetVersion?: string;
  budgetDate?: string;
  /** SAR per USD (the project's locked rate). */
  fx?: number;
  headerName?: (code: string) => string;
};

export function sheetKeyOfGroup(g: BudgetLine["group"]): TelfazSheetKey {
  if (g === "ATL") return "ATL";
  if (g === "BTL") return "BTL";
  if (g === "Post" || g === "Music" || g === "VFX") return "POST";
  return "OTHER";
}

function periodsOf(l: BudgetLine): number {
  const sum = Number(l.prep ?? 0) + Number(l.shooting ?? 0) + Number(l.wrap ?? 0);
  if (sum > 0) return sum;
  const x = Number(l.x ?? 0);
  return x > 0 ? x : 1;
}

function nativeOf(l: BudgetLine): number {
  if (l.excluded) return 0;
  const base = (Number(l.amount) || 0) * (Number(l.rate) || 0);
  return noPeriods(l.unit) ? base : base * periodsOf(l);
}

const headerOfLine = (l: BudgetLine) =>
  String(l.headerCode ?? "").trim() || `${String(l.mainCode ?? "").slice(0, 2)}00`;

function sections(lines: BudgetLine[]): { code: string; lines: BudgetLine[] }[] {
  const map = new Map<string, BudgetLine[]>();
  for (const l of lines) {
    const h = headerOfLine(l);
    if (!map.has(h)) map.set(h, []);
    map.get(h)!.push(l);
  }
  return Array.from(map.entries())
    .map(([code, ls]) => ({ code, lines: ls }))
    .sort((a, b) => (parseFloat(a.code) || 99999) - (parseFloat(b.code) || 99999));
}

const notesOut = (l: BudgetLine) =>
  l.excluded ? joinNotes(EXCLUDED_MARK, l.notes) : (l.notes ?? "");

const codeCell = (code: string): string | number => (/^\d+$/.test(code) ? Number(code) : code);

type F = { formula: string; result: number };
const fx_ = (formula: string, result: number): F => ({ formula, result });

const BOLD = { bold: true } as const;
const MONEY = "#,##0.00";

/** Workbook in the client's layout (pure — no download). */
export async function buildTelfazWorkbook(
  lines: BudgetLine[],
  opts: TelfazExportOptions = {},
): Promise<ExcelJS.Workbook> {
  const ExcelJSLib = await loadExcelJs();
  const wb = new ExcelJSLib.Workbook();
  wb.creator = "Kwalis Hub";
  wb.created = new Date();
  const fx = opts.fx && opts.fx > 0 ? opts.fx : DEFAULT_FILE_FX;
  const hName = (code: string) => opts.headerName?.(code) || telfazHeaderName(code);
  const bySheet: Record<TelfazSheetKey, BudgetLine[]> = { ATL: [], BTL: [], POST: [], OTHER: [] };
  for (const l of lines) bySheet[sheetKeyOfGroup(l.group)].push(l);

  const top = wb.addWorksheet(TELFAZ_TOP_SHEET);
  type Ref = { code: string; name: string; sar: string; usd: string; sarV: number; usdV: number };
  const refs: Record<TelfazSheetKey, Ref[]> = { ATL: [], BTL: [], POST: [], OTHER: [] };
  const q = (name: string) => `'${name.replace(/'/g, "''")}'`;

  // ── Sheets 1 & 2 ──
  for (const key of ["ATL", "BTL"] as const) {
    const name = TELFAZ_SHEET_NAMES[key];
    const ws = wb.addWorksheet(name);
    [2, 10, 34, 22, 9, 10, 9, 9, 10, 10, 12, 28, 18, 15, 15, 10].forEach(
      (w, i) => (ws.getColumn(i + 1).width = w),
    );
    ws.getCell(2, 1).value = SHEET_TITLES[key];
    ws.getCell(2, 1).font = { bold: true, size: 14 };
    let r = 3;
    const subtotalRows: number[] = [];
    let totSar = 0;
    let totUsd = 0;
    for (const sec of sections(bySheet[key])) {
      const head = [
        codeCell(sec.code),
        hName(sec.code),
        "NAME",
        "PREP WEEKS",
        "SHOOTING WEEKS",
        "WRAP WEEKS",
        "TOTAL WEEKS",
        "Unit",
        "Quantity",
        "Rate",
        "NOTES",
        "ADDI. NOTES",
        "SAR",
        "Dollar",
        "Currency",
      ];
      head.forEach((v, i) => (ws.getCell(r, i + 2).value = v));
      ws.getRow(r).font = BOLD;
      r++;
      const first = r;
      let sSar = 0;
      let sUsd = 0;
      for (const l of sec.lines) {
        const native = nativeOf(l);
        const nat = noPeriods(l.unit) ? `J${r}*K${r}` : `H${r}*J${r}*K${r}`;
        const sar = l.currency === "SAR" ? native : native * fx;
        const usd = l.currency === "SAR" ? native / fx : native;
        sSar += sar;
        sUsd += usd;
        const set = (col: number, v: unknown) => {
          if (v !== undefined && v !== null && v !== "")
            ws.getCell(r, col).value = v as ExcelJS.CellValue;
        };
        set(2, codeCell(l.mainCode));
        set(3, l.description);
        set(4, l.name);
        set(5, l.prep || null);
        set(6, l.shooting || null);
        set(7, l.wrap || null);
        set(8, periodsOf(l));
        set(9, l.unit);
        set(10, Number(l.amount) || 0);
        set(11, Number(l.rate) || 0);
        set(12, notesOut(l));
        if (l.excluded) {
          ws.getCell(r, 14).value = 0;
          ws.getCell(r, 15).value = 0;
        } else if (l.currency === "SAR") {
          ws.getCell(r, 14).value = fx_(nat, native);
          ws.getCell(r, 15).value = fx_(`N${r}/${fx}`, usd);
        } else {
          ws.getCell(r, 15).value = fx_(nat, native);
          ws.getCell(r, 14).value = fx_(`O${r}*${fx}`, sar);
        }
        set(16, l.currency);
        ws.getCell(r, 11).numFmt = MONEY;
        ws.getCell(r, 14).numFmt = MONEY;
        ws.getCell(r, 15).numFmt = MONEY;
        r++;
      }
      const last = r - 1;
      ws.getCell(r, 2).value = "Subtotal";
      ws.getCell(r, 14).value = fx_(`SUM(N${first}:N${last})`, sSar);
      ws.getCell(r, 15).value = fx_(`SUM(O${first}:O${last})`, sUsd);
      ws.getCell(r, 14).numFmt = MONEY;
      ws.getCell(r, 15).numFmt = MONEY;
      ws.getRow(r).font = BOLD;
      subtotalRows.push(r);
      refs[key].push({
        code: sec.code,
        name: hName(sec.code),
        sar: `${q(name)}!N${r}`,
        usd: `${q(name)}!O${r}`,
        sarV: sSar,
        usdV: sUsd,
      });
      totSar += sSar;
      totUsd += sUsd;
      r += 2;
    }
    ws.getCell(r, 2).value = key === "ATL" ? "Total Above The Line" : "Total Below The Line";
    ws.getCell(r, 14).value = fx_(
      subtotalRows.length ? `SUM(${subtotalRows.map((x) => `N${x}`).join(",")})` : "0",
      totSar,
    );
    ws.getCell(r, 15).value = fx_(
      subtotalRows.length ? `SUM(${subtotalRows.map((x) => `O${x}`).join(",")})` : "0",
      totUsd,
    );
    ws.getCell(r, 14).numFmt = MONEY;
    ws.getCell(r, 15).numFmt = MONEY;
    ws.getRow(r).font = BOLD;
  }

  // ── Sheet 3 ──
  {
    const name = TELFAZ_SHEET_NAMES.POST;
    const ws = wb.addWorksheet(name);
    [2, 14, 34, 34, 9, 10, 11, 11, 14, 24, 10].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.getCell(3, 1).value = SHEET_TITLES.POST;
    ws.getCell(3, 1).font = { bold: true, size: 14 };
    [
      "Code of Chart of Accounts",
      "Item",
      "Description",
      "Amount",
      "Unit",
      "Quantity B",
      "Rate ($)",
      "Subtotal",
      "Comment",
      "Currency",
    ].forEach((v, i) => (ws.getCell(6, i + 2).value = v));
    ws.getRow(6).font = BOLD;
    let r = 7;
    for (const sec of sections(bySheet.POST)) {
      const headRow = r;
      ws.getCell(r, 2).value = codeCell(sec.code);
      ws.getCell(r, 3).value = hName(sec.code);
      ws.getRow(r).font = BOLD;
      r++;
      const first = r;
      let sUsd = 0;
      for (const l of sec.lines) {
        const native = nativeOf(l);
        const usd = l.currency === "SAR" ? native / fx : native;
        sUsd += usd;
        const nat = noPeriods(l.unit) ? `H${r}*G${r}` : `H${r}*E${r}*G${r}`;
        ws.getCell(r, 2).value = codeCell(l.mainCode);
        ws.getCell(r, 3).value = l.description;
        if (l.name) ws.getCell(r, 4).value = l.name;
        ws.getCell(r, 5).value = periodsOf(l);
        if (l.unit) ws.getCell(r, 6).value = l.unit;
        ws.getCell(r, 7).value = Number(l.amount) || 0;
        ws.getCell(r, 8).value = Number(l.rate) || 0;
        ws.getCell(r, 9).value = l.excluded
          ? 0
          : l.currency === "SAR"
            ? fx_(`${nat}/${fx}`, usd)
            : fx_(nat, usd);
        const n = notesOut(l);
        if (n) ws.getCell(r, 10).value = n;
        ws.getCell(r, 11).value = l.currency;
        ws.getCell(r, 8).numFmt = MONEY;
        ws.getCell(r, 9).numFmt = MONEY;
        r++;
      }
      ws.getCell(headRow, 9).value = fx_(`SUM(I${first}:I${r - 1})`, sUsd);
      ws.getCell(headRow, 9).numFmt = MONEY;
      refs.POST.push({
        code: sec.code,
        name: hName(sec.code),
        sar: "",
        usd: `${q(name)}!I${headRow}`,
        sarV: sUsd * fx,
        usdV: sUsd,
      });
    }
    // category totals (skipped by the parser)
    const cats: [string, (c: string) => boolean][] = [
      ["TOTAL POST PRODUCTION (accounts 5000-5400)", (c) => c !== "6000" && c !== "6100"],
      ["TOTAL MUSIC (accounts 6000)", (c) => c === "6000"],
      ["TOTAL VFX (accounts 6100)", (c) => c === "6100"],
    ];
    for (const [label, pick] of cats) {
      const parts = refs.POST.filter((x) => pick(x.code));
      if (!parts.length) continue;
      ws.getCell(r, 2).value = label;
      ws.getCell(r, 9).value = fx_(
        parts.map((p) => p.usd.split("!")[1]).join("+"),
        parts.reduce((a, p) => a + p.usdV, 0),
      );
      ws.getCell(r, 9).numFmt = MONEY;
      ws.getRow(r).font = BOLD;
      r++;
    }
  }

  // ── Sheet 4 ──
  {
    const name = TELFAZ_SHEET_NAMES.OTHER;
    const ws = wb.addWorksheet(name);
    [2, 10, 34, 20, 8, 24, 15, 15, 10, 10, 10, 12, 10].forEach(
      (w, i) => (ws.getColumn(i + 1).width = w),
    );
    ws.getCell(2, 1).value = SHEET_TITLES.OTHER;
    ws.getCell(2, 1).font = { bold: true, size: 14 };
    let r = 3;
    for (const sec of sections(bySheet.OTHER)) {
      [
        codeCell(sec.code),
        hName(sec.code),
        "NAME",
        "DAYS",
        "NOTES",
        "SAR",
        "Dollar",
        "Currency",
        "Unit",
        "Quantity",
        "Rate",
        "Periods",
      ].forEach((v, i) => (ws.getCell(r, i + 2).value = v));
      ws.getRow(r).font = BOLD;
      r++;
      const first = r;
      let sSar = 0;
      let sUsd = 0;
      for (const l of sec.lines) {
        const native = nativeOf(l);
        const sar = l.currency === "SAR" ? native : native * fx;
        const usd = l.currency === "SAR" ? native / fx : native;
        sSar += sar;
        sUsd += usd;
        const nat = noPeriods(l.unit) ? `K${r}*L${r}` : `M${r}*K${r}*L${r}`;
        ws.getCell(r, 2).value = codeCell(l.mainCode);
        ws.getCell(r, 3).value = l.description;
        if (l.name) ws.getCell(r, 4).value = l.name;
        const n = notesOut(l);
        if (n) ws.getCell(r, 6).value = n;
        if (l.excluded) {
          ws.getCell(r, 7).value = 0;
          ws.getCell(r, 8).value = 0;
        } else if (l.currency === "SAR") {
          ws.getCell(r, 7).value = fx_(nat, native);
          ws.getCell(r, 8).value = fx_(`G${r}/${fx}`, usd);
        } else {
          ws.getCell(r, 8).value = fx_(nat, native);
          ws.getCell(r, 7).value = fx_(`H${r}*${fx}`, sar);
        }
        ws.getCell(r, 9).value = l.currency;
        ws.getCell(r, 10).value = l.unit || "Allow";
        ws.getCell(r, 11).value = Number(l.amount) || 0;
        ws.getCell(r, 12).value = Number(l.rate) || 0;
        ws.getCell(r, 13).value = periodsOf(l);
        ws.getCell(r, 7).numFmt = MONEY;
        ws.getCell(r, 8).numFmt = MONEY;
        r++;
      }
      ws.getCell(r, 2).value = "Subtotal";
      ws.getCell(r, 7).value = fx_(`SUM(G${first}:G${r - 1})`, sSar);
      ws.getCell(r, 8).value = fx_(`SUM(H${first}:H${r - 1})`, sUsd);
      ws.getCell(r, 7).numFmt = MONEY;
      ws.getCell(r, 8).numFmt = MONEY;
      ws.getRow(r).font = BOLD;
      refs.OTHER.push({
        code: sec.code,
        name: hName(sec.code),
        sar: `${q(name)}!G${r}`,
        usd: `${q(name)}!H${r}`,
        sarV: sSar,
        usdV: sUsd,
      });
      r += 2;
    }
  }

  // ── Top Sheet ──
  {
    const ws = top;
    [2, 26, 14, 40, 8, 12, 18, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.getCell(3, 2).value =
      `BUDGET TOPSHEET || ${opts.projectTitle || "Budget"}${opts.budgetVersion ? ` || ${opts.budgetVersion}` : ""}`;
    ws.getCell(3, 2).font = { bold: true, size: 14 };
    const meta: [string, string | undefined][] = [
      ["Production Co.", opts.productionCompany],
      ["Project Title", opts.projectTitle],
      ["Budget Date", opts.budgetDate],
      ["Budget Version", opts.budgetVersion],
      ["SAR / USD", String(fx)],
    ];
    meta.forEach(([k, v], i) => {
      ws.getCell(7 + i, 2).value = k;
      ws.getCell(7 + i, 2).font = BOLD;
      if (v) ws.getCell(7 + i, 5).value = v;
    });
    let r = 14;
    const totals: { sar: string; usd: string; sarV: number; usdV: number }[] = [];
    const blocks: [TelfazSheetKey, string, string, number][] = [
      ["ATL", "ABOVE THE LINE", "TOTAL ABOVE THE LINE", 1],
      ["BTL", "PRODUCTION EXPENSES", "TOTAL PRODUCTION", 2],
      ["POST", "POST PRODUCTION EXPENSES", "TOTAL POST PRODUCTION", 3],
      ["OTHER", "OTHER EXPENSES", "TOTAL OTHER", 4],
    ];
    for (const [key, title, totalLabel, sheetNo] of blocks) {
      ws.getCell(r, 2).value = title;
      ws.getCell(r, 2).font = BOLD;
      r++;
      const first = r;
      let bSar = 0;
      let bUsd = 0;
      for (const ref of refs[key]) {
        ws.getCell(r, 3).value = ref.code;
        ws.getCell(r, 4).value = ref.name;
        ws.getCell(r, 5).value = sheetNo;
        ws.getCell(r, 7).value = ref.sar ? fx_(ref.sar, ref.sarV) : fx_(`H${r}*${fx}`, ref.sarV);
        ws.getCell(r, 8).value = fx_(ref.usd, ref.usdV);
        ws.getCell(r, 7).numFmt = MONEY;
        ws.getCell(r, 8).numFmt = MONEY;
        bSar += ref.sarV;
        bUsd += ref.usdV;
        r++;
      }
      ws.getCell(r, 3).value = totalLabel;
      ws.getCell(r, 7).value = fx_(r > first ? `SUM(G${first}:G${r - 1})` : "0", bSar);
      ws.getCell(r, 8).value = fx_(r > first ? `SUM(H${first}:H${r - 1})` : "0", bUsd);
      ws.getCell(r, 7).numFmt = MONEY;
      ws.getCell(r, 8).numFmt = MONEY;
      ws.getRow(r).font = BOLD;
      totals.push({ sar: `G${r}`, usd: `H${r}`, sarV: bSar, usdV: bUsd });
      r += 2;
    }
    const gSar = totals.reduce((a, t) => a + t.sarV, 0);
    const gUsd = totals.reduce((a, t) => a + t.usdV, 0);
    ws.getCell(r, 3).value = "Total Budget Before Contingency";
    ws.getCell(r, 7).value = fx_(totals.map((t) => t.sar).join("+"), gSar);
    ws.getCell(r, 8).value = fx_(totals.map((t) => t.usd).join("+"), gUsd);
    ws.getCell(r, 7).numFmt = MONEY;
    ws.getCell(r, 8).numFmt = MONEY;
    ws.getRow(r).font = BOLD;
    const before = r;
    r += 2;
    ws.getCell(r, 2).value = "GRAND TOTAL";
    ws.getCell(r, 7).value = fx_(`G${before}`, gSar);
    ws.getCell(r, 8).value = fx_(`H${before}`, gUsd);
    ws.getCell(r, 7).numFmt = MONEY;
    ws.getCell(r, 8).numFmt = MONEY;
    ws.getRow(r).font = { bold: true, size: 12 };
  }

  return wb;
}

/** Browser download of the client-layout workbook. */
export async function exportTelfazBudget(
  lines: BudgetLine[],
  opts: TelfazExportOptions = {},
): Promise<void> {
  const wb = await buildTelfazWorkbook(lines, opts);
  const { saveBrandedWorkbook } = await import("@/lib/export/xlsx-report");
  await saveBrandedWorkbook(
    wb,
    `Budget ${opts.budgetVersion || ""} (client layout)`.replace(/\s+/g, " ").trim(),
    opts.projectTitle || "Budget",
  );
}
