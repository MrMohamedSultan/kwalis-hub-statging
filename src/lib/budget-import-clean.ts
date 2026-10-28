// ═══════════════════════════════════════════════════════════════════
// Budget import clean-up (E13 / D01) — runs on every parsed file before a
// line is written, whatever parser read it (Kwalis template, multi-sheet
// adapter, legacy auto-detect). Same rules as import_budget_validate in the
// database (db/pending/150 + 190), so preview and commit agree:
//
//   · text: trimmed, inner spaces collapsed, invisible characters removed
//   · money / quantities: rounded to 2 decimals (15000.074999999999 → 15000.07)
//   · Header ≤ Main: two plain-number codes the wrong way round are swapped
//     (warning); a main code outside a header range ("5000-5400") is warned
//   · duplicates: a line identical to an earlier one is warned and skipped
//     (the total drops by the duplicate's amount), unless keepDuplicates
// ═══════════════════════════════════════════════════════════════════

import type { BudgetLine } from "@/lib/store";

export type ImportIssueKind = "duplicate" | "swapped" | "out_of_range" | "rounded" | "missing";

export type ImportIssue = {
  kind: ImportIssueKind;
  lineId: string;
  /** Row / sheet in the file when the parser knows them. */
  row?: number;
  sheet?: string;
  mainCode: string;
  description: string;
  /** duplicate: the row it repeats; swapped: the original "header/main". */
  detail?: string;
  /** Line total (amount × rate × x) in the line currency. */
  total: number;
  currency: string;
};

export type CleanBudgetResult = {
  lines: BudgetLine[];
  issues: ImportIssue[];
  stats: {
    rowsIn: number;
    rowsOut: number;
    duplicates: number;
    /** Sum of the skipped duplicates, per currency. */
    duplicateTotals: Record<string, number>;
    swapped: number;
    rounded: number;
    trimmed: number;
  };
};

const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿ ]/g;

/** Trim, collapse inner whitespace, drop invisible / bidi control characters. */
export function cleanText(v: unknown): string {
  return String(v ?? "")
    .replace(INVISIBLE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Codes never contain spaces ("1 101" → "1101"); a trailing ".0" from Excel is dropped. */
export function cleanCode(v: unknown): string {
  return String(v ?? "")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, "")
    .replace(/^(\d+)\.0+$/, "$1");
}

export const round2 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  // Number.EPSILON scaled to the magnitude, so 15000.074999999999 → 15000.07
  // and 1.005 → 1.01 (half-up on the decimal the user typed).
  const s = Math.sign(n) || 1;
  return (s * Math.round((Math.abs(n) + Number.EPSILON * Math.abs(n)) * 100)) / 100;
};

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

/**
 * A number typed in a budget cell: plain numbers, "30,000.50", "(1,200)",
 * "SAR 4,500", Arabic-Indic digits "١٥٠٠٠٫٥" (٫ decimal, ٬ thousands).
 * Returns null when the cell holds text that is not a number.
 */
export function parseImportNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw)
    .replace(INVISIBLE, "")
    .replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] ?? d)
    .replace(/٫/g, ".")
    .replace(/[٬،]/g, ",")
    .trim();
  if (!s || /^[-—–]$/.test(s)) return 0;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/^\(|\)$/g, "").replace(/^-/, "");
  // currency words / symbols around the number are tolerated, other letters are not
  s = s.replace(/^(sar|usd|eur|ر\.?س|\$|€)\s*/i, "").replace(/\s*(sar|usd|eur|ر\.?س|\$|€)$/i, "");
  if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(s.replace(/\s/g, ""))) return null;
  const n = Number(s.replace(/[\s,]/g, ""));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const isPlainNumber = (c: string) => /^\d+(\.\d+)?$/.test(c);

/** Header ≤ Main check. Returns the corrected pair and what was found. */
export function checkHeaderMain(
  header: string,
  main: string,
): { header: string; main: string; swapped: boolean; outOfRange: boolean } {
  if (/^\d+$/.test(header) && isPlainNumber(main) && Number(header) > Number(main)) {
    return { header: main, main: header, swapped: true, outOfRange: false };
  }
  const range = header.match(/^(\d+)-(\d+)$/);
  if (range && isPlainNumber(main)) {
    const m = Number(main);
    const out = m < Number(range[1]) || m >= Number(range[2]) + 100;
    return { header, main, swapped: false, outOfRange: out };
  }
  return { header, main, swapped: false, outOfRange: false };
}

export const lineTotal = (l: Pick<BudgetLine, "amount" | "rate" | "x" | "excluded">) =>
  l.excluded ? 0 : round2((Number(l.amount) || 0) * (Number(l.rate) || 0) * (Number(l.x) || 0));

/** Identity of a line for the duplicate check — the same fields the DB compares. */
export function duplicateKey(l: BudgetLine): string {
  return [
    l.headerCode,
    l.mainCode,
    l.description.toLowerCase(),
    (l.name ?? "").toLowerCase(),
    l.amount,
    l.rate,
    l.x,
    String(l.unit ?? "").toLowerCase(),
    l.prep ?? 0,
    l.shooting ?? 0,
    l.wrap ?? 0,
    l.currency ?? "USD",
    !!l.excluded,
  ].join("|");
}

export function cleanImportedBudget(
  input: BudgetLine[],
  opts: {
    keepDuplicates?: boolean;
    rowOf?: Record<string, number>;
    sheetOf?: Record<string, string>;
  } = {},
): CleanBudgetResult {
  const issues: ImportIssue[] = [];
  const out: BudgetLine[] = [];
  const firstByKey = new Map<string, BudgetLine>();
  const stats: CleanBudgetResult["stats"] = {
    rowsIn: input.length,
    rowsOut: 0,
    duplicates: 0,
    duplicateTotals: {},
    swapped: 0,
    rounded: 0,
    trimmed: 0,
  };
  const where = (id: string) => ({ row: opts.rowOf?.[id], sheet: opts.sheetOf?.[id] });

  for (const raw of input) {
    const description = cleanText(raw.description);
    const name = raw.name != null ? cleanText(raw.name) : raw.name;
    const notes = raw.notes != null ? cleanText(raw.notes) || undefined : raw.notes;
    if (description !== raw.description || (raw.name != null && name !== raw.name)) {
      stats.trimmed += 1;
    }
    const hm = checkHeaderMain(cleanCode(raw.headerCode), cleanCode(raw.mainCode));
    const nums = {
      amount: round2(Number(raw.amount) || 0),
      rate: round2(Number(raw.rate) || 0),
      x: round2(Number(raw.x) || 0),
      prep: raw.prep != null ? round2(Number(raw.prep) || 0) : raw.prep,
      shooting: raw.shooting != null ? round2(Number(raw.shooting) || 0) : raw.shooting,
      wrap: raw.wrap != null ? round2(Number(raw.wrap) || 0) : raw.wrap,
    };
    const roundedAny =
      nums.amount !== (Number(raw.amount) || 0) ||
      nums.rate !== (Number(raw.rate) || 0) ||
      nums.x !== (Number(raw.x) || 0);
    const line: BudgetLine = {
      ...raw,
      headerCode: hm.header,
      mainCode: hm.main,
      description,
      name: name || undefined,
      notes,
      ...nums,
    };
    const base = {
      lineId: raw.id,
      ...where(raw.id),
      mainCode: line.mainCode,
      description: line.description,
      total: lineTotal(line),
      currency: line.currency ?? "USD",
    };
    if (roundedAny) {
      stats.rounded += 1;
      issues.push({ kind: "rounded", ...base });
    }
    if (hm.swapped) {
      stats.swapped += 1;
      issues.push({ kind: "swapped", ...base, detail: `${raw.headerCode}/${raw.mainCode}` });
    }
    if (hm.outOfRange) issues.push({ kind: "out_of_range", ...base, detail: line.headerCode });
    if (!line.mainCode || !line.description) issues.push({ kind: "missing", ...base });

    const key = duplicateKey(line);
    const first = firstByKey.get(key);
    if (first) {
      stats.duplicates += 1;
      stats.duplicateTotals[base.currency] = round2(
        (stats.duplicateTotals[base.currency] ?? 0) + base.total,
      );
      issues.push({
        kind: "duplicate",
        ...base,
        detail: String(opts.rowOf?.[first.id] ?? first.mainCode),
      });
      if (!opts.keepDuplicates) continue;
    } else {
      firstByKey.set(key, line);
    }
    out.push(line);
  }
  stats.rowsOut = out.length;
  return { lines: out, issues, stats };
}

/** Rows in the shape import_budget_preview / import_budget_validate expect. */
export function toImportRpcRows(lines: BudgetLine[], rowOf?: Record<string, number>) {
  return lines.map((l, i) => ({
    row: rowOf?.[l.id] ?? i + 1,
    header_code: l.headerCode,
    main_code: l.mainCode,
    description: l.description,
    name: l.name ?? null,
    group: l.group,
    topsheet_code: l.topsheetCode ?? null,
    amount: l.amount,
    rate: l.rate,
    x: l.x,
    unit: l.unit,
    prep: l.prep ?? 0,
    shooting: l.shooting ?? 0,
    wrap: l.wrap ?? 0,
    currency: l.currency,
    notes: l.notes ?? null,
    excluded: !!l.excluded,
  }));
}

/**
 * Plain-language reason a workbook could not be read (D01). Never a stack
 * trace: the key is translated by the caller, `detail` is shown as is.
 */
export function describeWorkbookError(
  e: unknown,
  fileName: string,
): { key: string; detail?: string } {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const lower = msg.toLowerCase();
  if (!/\.(xlsx|xlsm|xls)$/i.test(fileName)) return { key: "not_excel" };
  if (/password|encrypt|cfb/.test(lower)) return { key: "protected" };
  if (/zip|end of central directory|corrupt|unsupported file|invalid/.test(lower))
    return { key: "corrupt" };
  if (/no budget lines|no data sheets|no budget rows/.test(lower))
    return { key: "no_lines", detail: msg };
  return { key: "unknown", detail: msg.slice(0, 300) };
}
