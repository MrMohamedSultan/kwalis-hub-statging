import { projectHeaderPairs } from "@/lib/project-metadata";
import { downloadBlob } from "@/lib/download";
import { currentProjectContext, normalizeForActiveProject } from "@/lib/export/branding";
import { footerLine, projectLabel } from "@/lib/export/file-name";
import { peekAuthRoles } from "@/lib/auth-roles";
import { formatExportNumber } from "@/lib/export/number-format";

// G04 / X17: money in CSV exports is written with 2 decimals and thousands
// separators ("5,084,801.48"), the same text the PDFs print; Excel reads it
// back as a number. A column counts as money when its header names an
// amount (Amount, SAR, Total, Paid, …) or when it holds fractional numbers;
// FX rates, quantities, days, counts and codes are written as-is.
const MONEY_HEADER =
  /amount|sar\b|usd\b|eur\b|total|balance|paid|payable|remaining|spent|budget|cost|vat|wht|net\b|gross|price|value|fee|due|committed|actual|variance|reserved|scheduled|outstanding|مبلغ|إجمالي|المدفوع|المتبقي|رصيد/i;
const NOT_MONEY_HEADER =
  /fx|exchange|qty|quantity|days|count|period|pct|percent|%|code|\bid\b|iban|ref|phone|year|hours|units?\b|version|lines?\b|rows|_id\b|account|number|\bno\b|#|\bgl\b|line_/i;
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

export type CsvOptions = {
  /** Columns always written as money (2 decimals, thousands separators). */
  money?: string[];
  /** Columns never reformatted. */
  raw?: string[];
};

/** Pure: which columns are money for this export (unit-tested). */
export function csvMoneyColumns<T extends Record<string, any>>(
  rows: T[],
  cols: string[],
  opts: CsvOptions = {},
): Set<string> {
  const raw = new Set(opts.raw ?? []);
  const out = new Set<string>();
  for (const c of cols) {
    if (raw.has(c)) continue;
    if (opts.money?.includes(c)) {
      out.add(c);
      continue;
    }
    if (NOT_MONEY_HEADER.test(c)) continue;
    const named = MONEY_HEADER.test(c);
    const values = rows.map((r) => r[c]).filter((v) => v != null && v !== "");
    if (!values.length) continue;
    const numeric = values.every(
      (v) =>
        (typeof v === "number" && Number.isFinite(v)) ||
        (typeof v === "string" && NUMERIC_TEXT.test(v.trim())),
    );
    if (!numeric) continue;
    const fractional = values.some((v) => !Number.isInteger(Number(v)));
    if (named || fractional) out.add(c);
  }
  return out;
}

/** Minimal CSV exporter — no deps. */
export function toCSV<T extends Record<string, any>>(
  rows: T[],
  headers?: string[],
  opts: CsvOptions = {},
): string {
  if (rows.length === 0) return (headers ?? []).join(",") + "\n";
  const cols = headers ?? Object.keys(rows[0]);
  const money = csvMoneyColumns(rows, cols, opts);
  const esc = (v: unknown, col: string) => {
    if (v == null) return "";
    if (money.has(col) && v !== "" && Number.isFinite(Number(v)))
      v = formatExportNumber(Number(v), 2);
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c], c)).join(","))].join("\n");
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Project header block printed above every CSV export ("Project,<code — name>" …). */
function csvPrelude(): string {
  // Prepend the latest saved Project Settings production header so every
  // export carries current metadata without needing a refresh.
  const project = projectLabel(currentProjectContext());
  const pairs: [string, string][] = [
    ...(project ? ([["Project", project]] as [string, string][]) : []),
    ...projectHeaderPairs(),
  ];
  const headerBlock = pairs.map(([k, v]) => `${csvCell(k)},${csvCell(v)}`).join("\n");
  return headerBlock ? `${headerBlock}\n\n` : "";
}

/** Shared export footer (G02): Exported from Kwalis Hub · user · Saudi time. */
function csvFooter(): string {
  const roles = peekAuthRoles();
  const footer = footerLine({
    companyName: "",
    logoDataUrl: null,
    productLogoDataUrl: null,
    projectCode: null,
    projectName: null,
    userName: roles?.displayName || roles?.email || "",
    exportedAt: new Date(),
  });
  return `\n\n${csvCell(footer)}\n`;
}

function saveCsv(filename: string, body: string) {
  // UTF-8 BOM so Excel opens Arabic (and other non-ASCII) content correctly
  // regardless of the interface language (EN/LTR or AR/RTL) at export time.
  const BOM = "\ufeff";
  const blob = new Blob([BOM + csvPrelude() + body + csvFooter()], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(normalizeForActiveProject(filename, "csv"), blob);
}

export function downloadCSV(
  filename: string,
  rows: Record<string, any>[],
  headers?: string[],
  opts: CsvOptions = {},
) {
  saveCsv(filename, toCSV(rows, headers, opts));
}

export type CsvSection = {
  title: string;
  rows: Record<string, any>[];
  headers?: string[];
  opts?: CsvOptions;
  /** Text printed when the section has no rows. */
  emptyText?: string;
};

/** Pure: several tables in one CSV, each under a "# Title" line (unit-tested). */
export function sectionsToCSV(sections: CsvSection[]): string {
  return sections
    .map((s) => {
      const title = `# ${s.title}`;
      if (!s.rows.length && !s.headers?.length) return `${title}\n${s.emptyText ?? ""}`.trimEnd();
      const body = toCSV(s.rows, s.headers, s.opts).replace(/\n$/, "");
      return s.rows.length || !s.emptyText
        ? `${title}\n${body}`
        : `${title}\n${body}\n${s.emptyText}`;
    })
    .join("\n\n");
}

/** Multi-table CSV with the same project header, money format and footer as downloadCSV. */
export function downloadSectionedCSV(filename: string, sections: CsvSection[]) {
  saveCsv(filename, sectionsToCSV(sections));
}
