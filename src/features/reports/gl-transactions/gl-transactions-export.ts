// ═══════════════════════════════════════════════════════════════════
// GL Transactions — Excel (.xlsx via exceljs) and PDF (A4 landscape via
// jspdf + jspdf-autotable) exports. Both export exactly the filtered rows
// shown on screen — never the unfiltered dataset.
//
// CURRENCY MODES (display-only; stored data is never touched):
//   "both" — paired columns AMOUNT (SAR) | AMOUNT (USD), likewise VAT/WHT/NET
//   "sar"  — single column set expressed in the base currency
//   "usd"  — single column set expressed in the target currency
//
// ROUNDING RULE (accountants): every row is converted and rounded to 2
// decimals FIRST; totals are the SUM OF THE ROUNDED ROWS, so a total
// always equals what its own visible column adds up to.
//
// AUDIT RULE: whenever any figure was converted, the header block states
// the exchange rate, its effective date (when recorded) and which table
// it came from. No rate → no silent conversion: figures stay native and
// the header says so.
// ═══════════════════════════════════════════════════════════════════

import { loadPdf } from "@/lib/lazy-export-libs";
import { formatAmount } from "@/lib/format-number";
import { downloadBlob } from "@/lib/download";
import { convertAmount, formatRate, round2, type ResolvedFxRate } from "@/lib/fx-resolution";
import { humanRef, SOURCE_LABELS, type GlTransaction } from "./gl-transactions-data";

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

const TEXT_HEADERS = [
  "Date",
  "Source",
  "Reference",
  "Description",
  "Counterparty",
  "Budget Code",
  "GL Account",
  "Department",
  "Kind",
  "Status",
  "QFE",
];

// In paired-column ("both") PDF mode the page gets wide — these are the
// least important text columns, dropped first instead of shrinking the
// font below legible.
const PDF_BOTH_DROPPED = new Set(["GL Account", "Department", "Status"]);

function dateStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function rangeLabel(meta: GlExportMeta): string {
  if (meta.dateFrom && meta.dateTo) return `${meta.dateFrom} → ${meta.dateTo}`;
  if (meta.dateFrom) return `from ${meta.dateFrom}`;
  if (meta.dateTo) return `to ${meta.dateTo}`;
  return "all dates";
}

// ── Conversion core ──────────────────────────────────────────────────────────

interface MoneySet {
  amount: number | null;
  vat: number | null;
  wht: number | null;
  net: number | null;
}

interface PreparedRow {
  r: GlTransaction;
  native: string;
  /** Values in the pair's FIRST currency (base, e.g. SAR). */
  a: MoneySet;
  /** Values in the pair's SECOND currency (target, e.g. USD). */
  b: MoneySet;
  /** True when any figure on this row was produced by conversion. */
  converted: boolean;
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

function prepareRows(
  rows: GlTransaction[],
  opts: GlExportOptions,
  ccyA: string,
  ccyB: string,
): { rows: PreparedRow[]; anyConverted: boolean; exoticCount: number } {
  let anyConverted = false;
  let exoticCount = 0;
  const prepared = rows.map((r) => {
    const native = (r.resolvedCurrency ?? "").toUpperCase();
    const fields: Array<[keyof MoneySet, number]> = [
      ["amount", Number(r.amount) || 0],
      ["vat", Number(r.vat_amount) || 0],
      ["wht", Number(r.wht_amount) || 0],
      ["net", Number(r.total) || 0],
    ];
    const a: MoneySet = { amount: null, vat: null, wht: null, net: null };
    const b: MoneySet = { amount: null, vat: null, wht: null, net: null };
    let converted = false;
    const exotic = native !== ccyA && native !== ccyB;
    for (const [key, v] of fields) {
      const [av, bv] = pairValues(opts.fx, v, native, ccyA, ccyB);
      a[key] = av;
      b[key] = bv;
      if (
        opts.fx &&
        !exotic &&
        ((native === ccyA && bv != null) || (native === ccyB && av != null))
      ) {
        converted = true;
      }
    }
    if (exotic) exoticCount += 1;
    if (converted) anyConverted = true;
    return { r, native, a, b, converted };
  });
  return { rows: prepared, anyConverted, exoticCount };
}

function rateLine(fx: ResolvedFxRate): string {
  const effective = fx.effectiveFrom ?? "not recorded";
  return `Exchange rate applied: 1 ${fx.targetCurrency} = ${formatRate(fx.rate)} ${fx.baseCurrency} (effective ${effective}, source: ${fx.source})`;
}

// Row-first rounding means a converted total can differ by a halala or two
// from a single division by the rate. That is deliberate — but the report
// must SAY which currency is authoritative whenever a converted figure is
// shown, on screen and in every export header block.
function authorityLine(fx: ResolvedFxRate): string {
  return `${fx.baseCurrency} is the currency of record; ${fx.targetCurrency} figures are indicative and may differ by rounding.`;
}

function sumMoney(rows: PreparedRow[], side: "a" | "b"): MoneySet {
  // Totals = sum of the ROUNDED row values — always matches the column.
  const acc: MoneySet = { amount: 0, vat: 0, wht: 0, net: 0 };
  for (const p of rows) {
    const s = p[side];
    acc.amount = round2(acc.amount! + (s.amount ?? 0));
    acc.vat = round2(acc.vat! + (s.vat ?? 0));
    acc.wht = round2(acc.wht! + (s.wht ?? 0));
    acc.net = round2(acc.net! + (s.net ?? 0));
  }
  return acc;
}

function textCells(r: GlTransaction, meta: GlExportMeta, drop: Set<string>): unknown[] {
  const all: Array<[string, unknown]> = [
    ["Date", r.entry_date ? new Date(`${r.entry_date}T00:00:00`) : null],
    ["Source", SOURCE_LABELS[r.source_type] ?? r.source_type],
    ["Reference", humanRef(r) ?? ""],
    ["Description", r.description ?? ""],
    ["Counterparty", r.counterparty ?? ""],
    ["Budget Code", r.budget_code ?? ""],
    ["GL Account", meta.glName(r.gl_account_id)],
    ["Department", r.department ?? ""],
    ["Kind", KIND_LABELS[r.entry_kind] ?? r.entry_kind],
    ["Status", r.status ?? ""],
    ["QFE", r.qfe_eligible ? "QFE" : ""],
  ];
  return all.filter(([h]) => !drop.has(h)).map(([, v]) => v);
}

function modeTag(opts: GlExportOptions, ccyA: string, ccyB: string): string {
  if (!opts.fx) return "native";
  if (opts.mode === "both") return `${ccyA}-${ccyB}`;
  return opts.mode === "sar" ? ccyA : ccyB;
}

// ── Excel ────────────────────────────────────────────────────────────────────

const NAVY = "FF1F3A5F";
const HEADER_FONT = "FFFFFFFF";
const BORDER_GREY = "FFB8BCC4";

function thinBorder() {
  return {
    top: { style: "thin" as const, color: { argb: BORDER_GREY } },
    left: { style: "thin" as const, color: { argb: BORDER_GREY } },
    bottom: { style: "thin" as const, color: { argb: BORDER_GREY } },
    right: { style: "thin" as const, color: { argb: BORDER_GREY } },
  };
}

export async function exportGlTransactionsExcel(
  rows: GlTransaction[],
  meta: GlExportMeta,
  opts: GlExportOptions = { mode: "both", fx: null },
): Promise<void> {
  const ccyA = opts.fx?.baseCurrency ?? "SAR";
  const ccyB = opts.fx?.targetCurrency ?? "USD";
  const both = opts.mode === "both";
  const chosen = opts.mode === "usd" ? ccyB : ccyA;

  const { rows: prepared, anyConverted, exoticCount } = prepareRows(rows, opts, ccyA, ccyB);

  // Single mode: convert each row into the chosen currency (rounded per row).
  const singleValues = both
    ? null
    : prepared.map((p) => {
        const fields: Array<[keyof MoneySet, number]> = [
          ["amount", Number(p.r.amount) || 0],
          ["vat", Number(p.r.vat_amount) || 0],
          ["wht", Number(p.r.wht_amount) || 0],
          ["net", Number(p.r.total) || 0],
        ];
        const out: MoneySet = { amount: null, vat: null, wht: null, net: null };
        let converted = false;
        for (const [key, v] of fields) {
          const s = singleValue(opts.fx, v, p.native, chosen);
          out[key] = s ? s.value : round2(v); // unconvertible → native, noted in header
          if (s?.converted) converted = true;
        }
        return { out, converted };
      });
  const singleAnyConverted = singleValues?.some((s) => s.converted) ?? false;
  const conversionApplied = both ? anyConverted : singleAnyConverted;

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("GL Transactions");

  // ── Header block (cells, not the filename) ──
  ws.addRow([`GL Transactions — ${meta.projectTag}`]).font = { bold: true, size: 14 };
  ws.addRow([`Range: ${rangeLabel(meta)} · Generated: ${new Date().toLocaleString()}`]);
  if (opts.fx && conversionApplied) {
    ws.addRow([rateLine(opts.fx)]);
    ws.addRow([authorityLine(opts.fx)]);
  } else if (!opts.fx) {
    const ccys = [...new Set(prepared.map((p) => p.native).filter(Boolean))];
    ws.addRow([
      `No exchange rate configured — figures in native currency (${ccys.join(", ") || "unknown"}).`,
    ]);
  }
  if (exoticCount > 0) {
    ws.addRow([
      `${exoticCount} row(s) are in a currency outside the ${ccyA}/${ccyB} pair and were not converted.`,
    ]);
  }
  ws.addRow([]);

  const moneyHeaders = both
    ? [
        `Amount (${ccyA})`,
        `Amount (${ccyB})`,
        `VAT (${ccyA})`,
        `VAT (${ccyB})`,
        `WHT (${ccyA})`,
        `WHT (${ccyB})`,
        `NET (${ccyA})`,
        `NET (${ccyB})`,
      ]
    : [`Amount (${chosen})`, `VAT (${chosen})`, `WHT (${chosen})`, `NET (${chosen})`];

  const headers = [...TEXT_HEADERS, ...moneyHeaders];
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: HEADER_FONT } };
  headerRow.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.border = thinBorder();
    c.alignment = { vertical: "middle" };
  });

  // Freeze title block + header row.
  ws.views = [{ state: "frozen", ySplit: headerRow.number }];

  const moneyStart = TEXT_HEADERS.length + 1; // 1-indexed first money column
  const moneyCount = moneyHeaders.length;

  prepared.forEach((p, i) => {
    const money: unknown[] = both
      ? [p.a.amount, p.b.amount, p.a.vat, p.b.vat, p.a.wht, p.b.wht, p.a.net, p.b.net]
      : (() => {
          const s = singleValues![i].out;
          return [s.amount, s.vat, s.wht, s.net];
        })();
    const row = ws.addRow([...textCells(p.r, meta, new Set()), ...money]);
    row.getCell(1).numFmt = "yyyy-mm-dd";
    for (let k = 0; k < moneyCount; k++) row.getCell(moneyStart + k).numFmt = "#,##0.00";
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = thinBorder();
    });
  });

  // ── Totals row: SUM OF THE ROUNDED ROW VALUES, never converted separately ──
  const totals: unknown[] = both
    ? (() => {
        const ta = sumMoney(prepared, "a");
        const tb = sumMoney(prepared, "b");
        return [ta.amount, tb.amount, ta.vat, tb.vat, ta.wht, tb.wht, ta.net, tb.net];
      })()
    : (() => {
        const acc: MoneySet = { amount: 0, vat: 0, wht: 0, net: 0 };
        for (const s of singleValues!) {
          acc.amount = round2(acc.amount! + (s.out.amount ?? 0));
          acc.vat = round2(acc.vat! + (s.out.vat ?? 0));
          acc.wht = round2(acc.wht! + (s.out.wht ?? 0));
          acc.net = round2(acc.net! + (s.out.net ?? 0));
        }
        return [acc.amount, acc.vat, acc.wht, acc.net];
      })();

  const totalRow = ws.addRow(["TOTAL", ...Array(TEXT_HEADERS.length - 1).fill(""), ...totals]);
  totalRow.font = { bold: true };
  for (let k = 0; k < moneyCount; k++) totalRow.getCell(moneyStart + k).numFmt = "#,##0.00";
  totalRow.eachCell({ includeEmpty: true }, (c) => {
    c.border = thinBorder();
  });

  // Autofit column widths from rendered content (capped).
  (ws.columns ?? []).forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (c) => {
      const v = c.value instanceof Date ? "yyyy-mm-dd" : String(c.value ?? "");
      max = Math.max(max, v.length + 2);
    });
    col.width = Math.min(max, 42);
  });

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(
    `GL-Transactions_${meta.projectSlug}_${dateStamp()}_${modeTag(opts, ccyA, ccyB)}.xlsx`,
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}

// ── PDF (A4 landscape, header + rate line repeated on EVERY page) ───────────

export async function exportGlTransactionsPdf(
  rows: GlTransaction[],
  meta: GlExportMeta,
  opts: GlExportOptions = { mode: "both", fx: null },
): Promise<void> {
  const { jsPDF, autoTable } = await loadPdf();
  const ccyA = opts.fx?.baseCurrency ?? "SAR";
  const ccyB = opts.fx?.targetCurrency ?? "USD";
  const both = opts.mode === "both";
  const chosen = opts.mode === "usd" ? ccyB : ccyA;

  const { rows: prepared, anyConverted, exoticCount } = prepareRows(rows, opts, ccyA, ccyB);

  const singleValues = both
    ? null
    : prepared.map((p) => {
        const fields: Array<[keyof MoneySet, number]> = [
          ["amount", Number(p.r.amount) || 0],
          ["vat", Number(p.r.vat_amount) || 0],
          ["wht", Number(p.r.wht_amount) || 0],
          ["net", Number(p.r.total) || 0],
        ];
        const out: MoneySet = { amount: null, vat: null, wht: null, net: null };
        let converted = false;
        for (const [key, v] of fields) {
          const s = singleValue(opts.fx, v, p.native, chosen);
          out[key] = s ? s.value : round2(v);
          if (s?.converted) converted = true;
        }
        return { out, converted };
      });
  const conversionApplied = both ? anyConverted : (singleValues?.some((s) => s.converted) ?? false);

  // Rate line is MANDATORY whenever any figure was converted — an audited
  // report never shows a converted number without the rate beside it, and
  // the authority sentence says which currency is the currency of record.
  const rateNote =
    opts.fx && conversionApplied
      ? rateLine(opts.fx)
      : !opts.fx
        ? "No exchange rate configured — figures in native currency."
        : null;
  const authorityNote = opts.fx && conversionApplied ? authorityLine(opts.fx) : null;
  const exoticNote =
    exoticCount > 0
      ? `${exoticCount} row(s) outside the ${ccyA}/${ccyB} pair not converted.`
      : null;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Header band + meta + rate line — drawn on EVERY page via didDrawPage.
  const drawHeader = () => {
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 56, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("GL Transactions", 32, 24);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(new Date().toLocaleString(), pageWidth - 32, 24, { align: "right" });
    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225);
    doc.text(meta.projectTag, 32, 44);

    doc.setTextColor(100, 116, 139);
    doc.setFontSize(9);
    doc.text(`${rows.length} transactions · ${rangeLabel(meta)}`, 32, 72);
    // Rate, authority and exotic-currency notes — each on its own line so
    // none of them is clipped at the right edge of the page.
    doc.setFontSize(8);
    let y = 86;
    for (const note of [rateNote, authorityNote, exoticNote]) {
      if (!note) continue;
      doc.text(note, 32, y);
      y += 12;
    }
    doc.setTextColor(15, 23, 42);
  };

  const noteCount = [rateNote, authorityNote, exoticNote].filter(Boolean).length;
  const topMargin = noteCount === 0 ? 92 : 96 + 12 * noteCount;

  // Column layout. Paired mode drops the least important text columns
  // rather than shrinking the font below legible.
  const dropped = both ? PDF_BOTH_DROPPED : new Set<string>();
  const textHeaders = TEXT_HEADERS.filter((h) => !dropped.has(h));
  const moneyHeaders = both
    ? [
        `Amount (${ccyA})`,
        `Amount (${ccyB})`,
        `VAT (${ccyA})`,
        `VAT (${ccyB})`,
        `WHT (${ccyA})`,
        `WHT (${ccyB})`,
        `NET (${ccyA})`,
        `NET (${ccyB})`,
      ]
    : [`Amount (${chosen})`, `VAT (${chosen})`, `WHT (${chosen})`, `NET (${chosen})`];
  const headers = [...textHeaders, ...moneyHeaders];
  const moneyStart = textHeaders.length; // 0-indexed for columnStyles

  const body = prepared.map((p, i) => {
    const money = both
      ? [p.a.amount, p.b.amount, p.a.vat, p.b.vat, p.a.wht, p.b.wht, p.a.net, p.b.net].map((v) =>
          v == null ? "" : formatAmount(v, 2),
        )
      : (() => {
          const s = singleValues![i].out;
          return [s.amount, s.vat, s.wht, s.net].map((v) => (v == null ? "" : formatAmount(v, 2)));
        })();
    const texts = textCells(p.r, meta, dropped).map((v) =>
      v instanceof Date ? (p.r.entry_date ?? "") : String(v ?? ""),
    );
    return [...texts, ...money];
  });

  const totals: string[] = both
    ? (() => {
        const ta = sumMoney(prepared, "a");
        const tb = sumMoney(prepared, "b");
        return [ta.amount, tb.amount, ta.vat, tb.vat, ta.wht, tb.wht, ta.net, tb.net].map((v) =>
          formatAmount(v ?? 0, 2),
        );
      })()
    : (() => {
        const acc: MoneySet = { amount: 0, vat: 0, wht: 0, net: 0 };
        for (const s of singleValues!) {
          acc.amount = round2(acc.amount! + (s.out.amount ?? 0));
          acc.vat = round2(acc.vat! + (s.out.vat ?? 0));
          acc.wht = round2(acc.wht! + (s.out.wht ?? 0));
          acc.net = round2(acc.net! + (s.out.net ?? 0));
        }
        return [acc.amount, acc.vat, acc.wht, acc.net].map((v) => formatAmount(v ?? 0, 2));
      })();

  const columnStyles: Record<number, { halign: "right" }> = {};
  for (let k = 0; k < moneyHeaders.length; k++) columnStyles[moneyStart + k] = { halign: "right" };

  autoTable(doc, {
    startY: topMargin,
    head: [headers],
    body,
    foot: [["TOTAL", ...Array(textHeaders.length - 1).fill(""), ...totals]],
    showHead: "everyPage", // repeating header on every page
    showFoot: "lastPage",
    didDrawPage: drawHeader, // band + rate line on EVERY page
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles,
    margin: { top: topMargin, left: 32, right: 32, bottom: 40 },
  });

  // Page X of Y — stamped after the table is laid out so the total is known.
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 32, pageHeight - 20, { align: "right" });
  }

  doc.save(`GL-Transactions_${meta.projectSlug}_${dateStamp()}_${modeTag(opts, ccyA, ccyB)}.pdf`);
}
