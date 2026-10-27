// ═══════════════════════════════════════════════════════════════════
// GL Transactions — Excel (.xlsx) and PDF exports through the shared
// Kwalis Hub report writers (header/footer, Arabic font, file name).
// Both export exactly the filtered rows shown on screen.
//
// CURRENCY MODES (display-only; stored data is never touched):
//   "both" — paired columns AMOUNT (SAR) | AMOUNT (USD), likewise VAT/WHT/NET
//   "sar"  — single column set expressed in the base currency
//   "usd"  — single column set expressed in the target currency
//
// ROUNDING RULE (accountants): every row is converted and rounded to 2
// decimals FIRST; totals are the SUM OF THE ROUNDED ROWS.
//
// TOTALS (G04): never one grand total over mixed kinds. Following the
// glossary, the file carries Total Actual (approved actuals), Total Paid
// (payments) and Total Commitment — each the sum of its own rows only,
// with the same status rule the screen uses (countsTowardTotals).
//
// AUDIT RULE: whenever any figure was converted, the header states the
// exchange rate, its effective date (when recorded) and where it is set.
// ═══════════════════════════════════════════════════════════════════

import i18n from "@/lib/i18n";
import {
  convertAmount,
  formatRate,
  fxSourceLabel,
  round2,
  type ResolvedFxRate,
} from "@/lib/fx-resolution";
import { formatDate } from "@/lib/date-format";
import type { ReportColumn, ReportDoc, ReportCell } from "@/lib/export/xlsx-report";
import {
  countsTowardTotals,
  humanRef,
  SOURCE_LABELS,
  type GlTransaction,
} from "./gl-transactions-data";

export interface GlExportMeta {
  projectTag: string;
  projectSlug: string;
  dateFrom: string;
  dateTo: string;
  /** Resolve a GL account id to a "code · name" label. */
  glName: (id: string | null) => string;
}

export type GlExportCurrencyMode = "both" | "sar" | "usd";

export interface GlExportOptions {
  mode: GlExportCurrencyMode;
  /** Resolved project FX rate; null → no conversion, native figures. */
  fx: ResolvedFxRate | null;
}

const KIND_LABELS: Record<string, string> = {
  actual: "Actual",
  commitment: "Commitment",
  payment: "Payment",
};

const TEXT_COLUMNS: ReportColumn[] = [
  { header: "Date", type: "date" },
  { header: "Source" },
  { header: "Reference" },
  { header: "Description" },
  { header: "Counterparty" },
  { header: "Budget Code" },
  { header: "GL Account" },
  { header: "Department" },
  { header: "Kind" },
  { header: "Status" },
  { header: "QPE" },
];

// In paired-column ("both") PDF mode the page gets wide — these are the
// least important text columns, dropped first instead of shrinking the
// font below legible.
const PDF_BOTH_DROPPED = new Set(["GL Account", "Department", "Status"]);

function rangeLabel(meta: GlExportMeta): string {
  const from = meta.dateFrom ? formatDate(meta.dateFrom) : "";
  const to = meta.dateTo ? formatDate(meta.dateTo) : "";
  if (from && to) return `${from} → ${to}`;
  if (from) return `from ${from}`;
  if (to) return `to ${to}`;
  return "all dates";
}

// ── Conversion core ──────────────────────────────────────────────────────────

interface MoneySet {
  amount: number | null;
  vat: number | null;
  wht: number | null;
  net: number | null;
}

const MONEY_KEYS: (keyof MoneySet)[] = ["amount", "vat", "wht", "net"];

function rawMoney(r: GlTransaction): Record<keyof MoneySet, number> {
  return {
    amount: Number(r.amount) || 0,
    vat: Number(r.vat_amount) || 0,
    wht: Number(r.wht_amount) || 0,
    net: Number(r.total) || 0,
  };
}

function pairValues(
  fx: ResolvedFxRate | null,
  value: number,
  native: string,
  ccyA: string,
  ccyB: string,
): [number | null, number | null] {
  if (native === ccyA) {
    const other = fx ? convertAmount(fx, value, ccyA, ccyB) : null;
    return [round2(value), other == null ? null : round2(other)];
  }
  if (native === ccyB) {
    const other = fx ? convertAmount(fx, value, ccyB, ccyA) : null;
    return [other == null ? null : round2(other), round2(value)];
  }
  return [null, null]; // outside the configured pair — never guess
}

function singleValue(
  fx: ResolvedFxRate | null,
  value: number,
  native: string,
  chosen: string,
): { value: number; converted: boolean } | null {
  if (native === chosen) return { value: round2(value), converted: false };
  if (fx) {
    const c = convertAmount(fx, value, native, chosen);
    if (c != null) return { value: round2(c), converted: true };
  }
  return null; // unconvertible without a configured rate
}

interface PreparedRow {
  r: GlTransaction;
  /** Money cells in column order (paired or single mode). */
  money: (number | null)[];
  converted: boolean;
  exotic: boolean;
}

function prepare(
  rows: GlTransaction[],
  opts: GlExportOptions,
): { rows: PreparedRow[]; moneyHeaders: string[]; ccyA: string; ccyB: string } {
  const ccyA = opts.fx?.baseCurrency ?? "SAR";
  const ccyB = opts.fx?.targetCurrency ?? "USD";
  const both = opts.mode === "both";
  const chosen = opts.mode === "usd" ? ccyB : ccyA;
  const moneyHeaders = both
    ? MONEY_KEYS.flatMap((k) => {
        const label = k === "amount" ? "Amount" : k.toUpperCase();
        return [`${label} (${ccyA})`, `${label} (${ccyB})`];
      })
    : MONEY_KEYS.map((k) => `${k === "amount" ? "Amount" : k.toUpperCase()} (${chosen})`);

  const prepared = rows.map((r) => {
    const native = (r.resolvedCurrency ?? "").toUpperCase();
    const raw = rawMoney(r);
    const exotic = native !== ccyA && native !== ccyB;
    let converted = false;
    const money: (number | null)[] = [];
    for (const k of MONEY_KEYS) {
      if (both) {
        const [a, b] = pairValues(opts.fx, raw[k], native, ccyA, ccyB);
        money.push(a, b);
        if (
          opts.fx &&
          !exotic &&
          ((native === ccyA && b != null) || (native === ccyB && a != null))
        )
          converted = true;
      } else {
        const s = singleValue(opts.fx, raw[k], native, chosen);
        money.push(s ? s.value : round2(raw[k])); // unconvertible → native, noted in header
        if (s?.converted) converted = true;
      }
    }
    return { r, money, converted, exotic };
  });
  return { rows: prepared, moneyHeaders, ccyA, ccyB };
}

/** Which dictionary total a row belongs to (null = not totalled). */
export function glTotalBucket(r: GlTransaction): "actual" | "paid" | "commitment" | null {
  if (r.entry_kind === "payment") return "paid";
  if (!countsTowardTotals(r.status)) return null;
  if (r.entry_kind === "actual") return "actual";
  if (r.entry_kind === "commitment") return "commitment";
  return null;
}

/** Sum of the rounded row values per dictionary bucket (G04). */
export function glTotals(prepared: { r: GlTransaction; money: (number | null)[] }[]) {
  const width = prepared[0]?.money.length ?? 0;
  const acc = {
    actual: Array<number>(width).fill(0),
    paid: Array<number>(width).fill(0),
    commitment: Array<number>(width).fill(0),
  };
  for (const p of prepared) {
    const bucket = glTotalBucket(p.r);
    if (!bucket) continue;
    p.money.forEach((v, i) => {
      acc[bucket][i] = round2(acc[bucket][i] + (v ?? 0));
    });
  }
  return acc;
}

function rateLine(fx: ResolvedFxRate): string {
  const effective = fx.effectiveFrom ? formatDate(fx.effectiveFrom) : "not recorded";
  return `Exchange rate applied: 1 ${fx.targetCurrency} = ${formatRate(fx.rate)} ${fx.baseCurrency} (effective ${effective}, set in ${fxSourceLabel(fx.source)})`;
}

function authorityLine(fx: ResolvedFxRate): string {
  return `${fx.baseCurrency} is the currency of record; ${fx.targetCurrency} figures are indicative and may differ by rounding.`;
}

function textCells(r: GlTransaction, meta: GlExportMeta): ReportCell[] {
  return [
    r.entry_date ?? null,
    SOURCE_LABELS[r.source_type] ?? r.source_type,
    humanRef(r) ?? "",
    r.description ?? "",
    r.counterparty ?? "",
    r.budget_code ?? "",
    meta.glName(r.gl_account_id),
    r.department ?? "",
    KIND_LABELS[r.entry_kind] ?? r.entry_kind,
    r.status ?? "",
    r.qfe_eligible ? "QPE" : "",
  ];
}

/** The GL Transactions report as a ReportDoc (pure; unit-tested). */
export function buildGlTransactionsDoc(
  rows: GlTransaction[],
  meta: GlExportMeta,
  opts: GlExportOptions,
  target: "xlsx" | "pdf",
): ReportDoc {
  const { rows: prepared, moneyHeaders, ccyA, ccyB } = prepare(rows, opts);
  const anyConverted = prepared.some((p) => p.converted);
  const exoticCount = prepared.filter((p) => p.exotic).length;

  const notes: string[] = [`${rows.length} transactions · ${rangeLabel(meta)}`];
  if (opts.fx && anyConverted) {
    notes.push(rateLine(opts.fx), authorityLine(opts.fx));
  } else if (!opts.fx) {
    const ccys = [...new Set(prepared.map((p) => (p.r.resolvedCurrency ?? "").toUpperCase()))];
    notes.push(
      `No exchange rate configured — figures in native currency (${ccys.filter(Boolean).join(", ") || "unknown"}).`,
    );
  }
  if (exoticCount > 0) {
    notes.push(
      `${exoticCount} row(s) are in a currency outside the ${ccyA}/${ccyB} pair and were not converted.`,
    );
  }

  const dropped = target === "pdf" && opts.mode === "both" ? PDF_BOTH_DROPPED : new Set<string>();
  const keep = TEXT_COLUMNS.map((c) => !dropped.has(c.header));
  const textCols = TEXT_COLUMNS.filter((_, i) => keep[i]);
  const columns: ReportColumn[] = [
    ...textCols,
    ...moneyHeaders.map((h) => ({ header: h, type: "money" as const })),
  ];
  const pad = Array<ReportCell>(textCols.length - 1).fill("");
  const totals = glTotals(prepared);

  return {
    report: "General Ledger",
    title: i18n.t("exports.report_general_ledger"),
    subtitle: meta.projectTag,
    sections: [
      {
        title: i18n.t("exports.report_general_ledger"),
        notes,
        columns,
        rows: prepared.map((p) => [...textCells(p.r, meta).filter((_, i) => keep[i]), ...p.money]),
        totals: [
          [i18n.t("exports.total_actual"), ...pad, ...totals.actual],
          [i18n.t("exports.total_paid"), ...pad, ...totals.paid],
          [i18n.t("exports.total_commitment"), ...pad, ...totals.commitment],
        ],
      },
    ],
  };
}

export async function exportGlTransactionsExcel(
  rows: GlTransaction[],
  meta: GlExportMeta,
  opts: GlExportOptions = { mode: "both", fx: null },
): Promise<void> {
  const { exportReportXlsx } = await import("@/lib/export/xlsx-report");
  await exportReportXlsx(buildGlTransactionsDoc(rows, meta, opts, "xlsx"));
}

export async function exportGlTransactionsPdf(
  rows: GlTransaction[],
  meta: GlExportMeta,
  opts: GlExportOptions = { mode: "both", fx: null },
): Promise<void> {
  const { exportReportPdf } = await import("@/lib/export/xlsx-report");
  await exportReportPdf(buildGlTransactionsDoc(rows, meta, opts, "pdf"), { compact: true });
}
