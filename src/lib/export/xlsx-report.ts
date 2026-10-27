// ═══════════════════════════════════════════════════════════════════
// Report exports — ONE description of a report (`ReportDoc`), two files:
//   - a real .xlsx (ExcelJS): numbers are numbers, dates are dates, money
//     is formatted #,##0.00, the Kwalis Hub header/footer on every sheet;
//   - a branded PDF (see ./pdf-core) with the same rows and totals.
// Callers build the ReportDoc from exactly what is on screen (after
// filters, in the display currency), so the file always matches the screen.
// ═══════════════════════════════════════════════════════════════════
import type ExcelJSNS from "exceljs";
import i18n from "@/lib/i18n";
import { downloadBlob } from "@/lib/download";
import { loadExcelJs } from "@/lib/lazy-export-libs";
import {
  excelDateFormat,
  formatDate,
  getDateFormat,
  toExcelDate,
  type DateFormat,
} from "@/lib/date-format";
import { exportFileName, footerLine, projectLabel, type ExportBranding } from "./file-name";
import {
  EXCEL_INTEGER_FORMAT,
  EXCEL_MONEY_FORMAT,
  EXCEL_PERCENT_FORMAT,
  formatExportNumber,
  roundTo,
} from "./number-format";

export type ColumnType = "text" | "money" | "number" | "integer" | "date" | "percent";
export type ReportColumn = { header: string; type?: ColumnType; width?: number };
export type ReportCell = string | number | Date | null | undefined;

export type ReportSection = {
  /** Heading (and sheet name in "sheets" layout). */
  title?: string;
  subtitle?: string;
  notes?: string[];
  columns: ReportColumn[];
  rows: ReportCell[][];
  /** Bold rows printed after the body (totals / subtotals). */
  totals?: ReportCell[][];
};

export type ReportDoc = {
  /** English name used in the file name, e.g. "Payments Register". */
  report: string;
  /** Title printed in the file (localised). */
  title: string;
  subtitle?: string;
  sections: ReportSection[];
  /** "stacked" (default) — every section on one sheet; "sheets" — one sheet per section. */
  layout?: "stacked" | "sheets";
};

// ── Images ────────────────────────────────────────────────────────────

function base64Bytes(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/[a-z]+;base64,(.*)$/i.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Pixel size of a PNG / JPEG data URL (null when unknown). */
export function imageSize(dataUrl: string | null): { width: number; height: number } | null {
  if (!dataUrl) return null;
  const b = base64Bytes(dataUrl);
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50) {
    const w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
    const h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
    return w > 0 && h > 0 ? { width: w, height: h } : null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + len;
    }
  }
  return null;
}

function imageExt(dataUrl: string): "png" | "jpeg" | null {
  if (/^data:image\/png/i.test(dataUrl)) return "png";
  if (/^data:image\/jpe?g/i.test(dataUrl)) return "jpeg";
  return null;
}

function fitBox(size: { width: number; height: number }, maxW: number, maxH: number) {
  const ratio = size.width / Math.max(1, size.height);
  let h = maxH;
  let w = h * ratio;
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  return { width: Math.round(w), height: Math.round(h) };
}

// ── Workbook ──────────────────────────────────────────────────────────

const NAVY = "FF1E293B";
const RULE = "FF1E3A5F";
const MUTED = "FF64748B";
const BORDER = "FFCBD5E1";
const TOTAL_FILL = "FFE2E8F0";

function sheetName(raw: string, used: Set<string>): string {
  let base =
    (raw || "Report")
      .replace(/[[\]:*?/\\]/g, " ")
      .trim()
      .slice(0, 31) || "Report";
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  base = name;
  return base;
}

function excelHeaderText(s: string): string {
  // Excel header/footer codes start with "&" — escape literal ampersands.
  return s.replace(/&/g, "&&");
}

function cellValue(v: ReportCell, type: ColumnType | undefined): ExcelJSNS.CellValue {
  if (v == null || v === "") return null;
  switch (type) {
    case "money":
    case "number":
      return typeof v === "number"
        ? roundTo(v, 2)
        : Number.isFinite(Number(v))
          ? roundTo(Number(v), 2)
          : String(v);
    case "integer":
      return typeof v === "number" ? Math.round(v) : String(v);
    case "percent":
      return typeof v === "number" ? roundTo(v, 2) : String(v);
    case "date":
      return toExcelDate(v as string | Date) ?? String(v);
    default:
      return v instanceof Date ? (toExcelDate(v) as Date) : v;
  }
}

function numFmtFor(type: ColumnType | undefined, dateFmt: DateFormat): string | undefined {
  switch (type) {
    case "money":
    case "number":
      return EXCEL_MONEY_FORMAT;
    case "integer":
      return EXCEL_INTEGER_FORMAT;
    case "percent":
      return EXCEL_PERCENT_FORMAT;
    case "date":
      return excelDateFormat(dateFmt);
    default:
      return undefined;
  }
}

export function buildReportWorkbook(
  ExcelJS: typeof ExcelJSNS,
  doc: ReportDoc,
  branding: ExportBranding,
  opts: { rtl?: boolean; dateFormat?: DateFormat } = {},
): ExcelJSNS.Workbook {
  const dateFmt = opts.dateFormat ?? getDateFormat();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kwalis Hub";
  wb.lastModifiedBy = branding.userName || "Kwalis Hub";
  wb.created = branding.exportedAt;
  wb.title = doc.title;
  wb.company = branding.companyName;

  const logoId =
    branding.logoDataUrl && imageExt(branding.logoDataUrl)
      ? wb.addImage({ base64: branding.logoDataUrl, extension: imageExt(branding.logoDataUrl)! })
      : null;
  const productLogoId =
    branding.productLogoDataUrl && imageExt(branding.productLogoDataUrl)
      ? wb.addImage({
          base64: branding.productLogoDataUrl,
          extension: imageExt(branding.productLogoDataUrl)!,
        })
      : null;
  const logoSize = imageSize(branding.logoDataUrl);
  const productSize = imageSize(branding.productLogoDataUrl);
  const footer = footerLine(branding);
  const project = projectLabel(branding);
  const used = new Set<string>();

  const groups: ReportSection[][] =
    doc.layout === "sheets" ? doc.sections.map((s) => [s]) : [doc.sections];

  for (const group of groups) {
    const name = sheetName(
      doc.layout === "sheets" ? (group[0]?.title ?? doc.title) : doc.title,
      used,
    );
    const ws = wb.addWorksheet(name, {
      views: [{ rightToLeft: !!opts.rtl, showGridLines: false }],
      pageSetup: {
        orientation: "landscape",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.25, footer: 0.25 },
      },
    });
    ws.headerFooter = {
      oddHeader: `&L${excelHeaderText([branding.companyName, project].filter(Boolean).join(" — "))}&R${excelHeaderText(doc.title)}`,
      oddFooter: `&L${excelHeaderText(footer)}&R${excelHeaderText(
        i18n.t("exports.page_x_of_y", {
          page: "&P",
          total: "&N",
          interpolation: { escapeValue: false },
        }),
      )}`,
    };

    const maxCols = Math.max(2, ...group.map((s) => s.columns.length));

    // ── Branded header block ──
    if (logoId != null && logoSize) {
      const box = fitBox(logoSize, 160, 52);
      ws.getRow(1).height = 44;
      ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: box, editAs: "oneCell" });
      ws.addRow([]);
    }
    const companyRow = ws.addRow([branding.companyName || project]);
    companyRow.font = { bold: true, size: 14 };
    if (branding.companyName && project) {
      ws.addRow([`${i18n.t("exports.project")}: ${project}`]).font = {
        size: 11,
        color: { argb: MUTED },
      };
    }
    const titleRow = ws.addRow([doc.title]);
    titleRow.font = { bold: true, size: 12 };
    if (doc.subtitle) ws.addRow([doc.subtitle]).font = { size: 9, color: { argb: MUTED } };
    const ruleRow = ws.addRow([]);
    for (let c = 1; c <= maxCols; c++) {
      ruleRow.getCell(c).border = { bottom: { style: "medium", color: { argb: RULE } } };
    }
    ruleRow.height = 6;

    let firstHeaderRow: number | null = null;
    const widths: number[] = Array(maxCols).fill(10);

    group.forEach((section, si) => {
      ws.addRow([]);
      if (section.title && (group.length > 1 || doc.layout === "sheets")) {
        ws.addRow([section.title]).font = { bold: true, size: 11 };
      }
      if (section.subtitle)
        ws.addRow([section.subtitle]).font = { size: 9, color: { argb: MUTED } };
      for (const n of section.notes ?? [])
        ws.addRow([n]).font = { size: 9, color: { argb: MUTED } };

      const head = ws.addRow(section.columns.map((c) => c.header));
      if (si === 0) firstHeaderRow = head.number;
      head.eachCell((cell, col) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        cell.alignment = {
          vertical: "middle",
          wrapText: true,
          horizontal:
            section.columns[col - 1]?.type &&
            section.columns[col - 1].type !== "text" &&
            section.columns[col - 1].type !== "date"
              ? "right"
              : undefined,
        };
        cell.border = { bottom: { style: "thin", color: { argb: BORDER } } };
      });

      const writeRow = (cells: ReportCell[], bold: boolean) => {
        const row = ws.addRow(section.columns.map((c, i) => cellValue(cells[i], c.type)));
        section.columns.forEach((c, i) => {
          const cell = row.getCell(i + 1);
          const fmt = numFmtFor(c.type, dateFmt);
          if (fmt && cell.value != null && typeof cell.value !== "string") cell.numFmt = fmt;
          cell.border = { bottom: { style: "hair", color: { argb: BORDER } } };
          if (bold) {
            cell.font = { bold: true };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
          }
          const v = cells[i];
          const text =
            c.type === "date"
              ? formatDate(v as string | Date, dateFmt)
              : typeof v === "number"
                ? formatExportNumber(v, c.type === "integer" ? 0 : 2)
                : String(v ?? "");
          widths[i] = Math.max(widths[i], Math.min(60, text.length + 2));
        });
      };
      section.columns.forEach((c, i) => {
        widths[i] = Math.max(widths[i], Math.min(40, c.header.length + 2), c.width ?? 0);
      });
      for (const r of section.rows) writeRow(r, false);
      for (const r of section.totals ?? []) writeRow(r, true);
      if (section.rows.length === 0) {
        ws.addRow([i18n.t("exports.no_rows")]).font = { italic: true, color: { argb: MUTED } };
      }
    });

    widths.forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    if (firstHeaderRow && group.length === 1) {
      ws.views = [
        { state: "frozen", ySplit: firstHeaderRow, rightToLeft: !!opts.rtl, showGridLines: false },
      ];
    }

    // ── Footer block: "Exported from Kwalis Hub" + Kwalis mark ──
    ws.addRow([]);
    const footRow = ws.addRow([footer]);
    footRow.font = { italic: true, size: 9, color: { argb: MUTED } };
    if (productLogoId != null && productSize) {
      const box = fitBox(productSize, 96, 28);
      const logoRow = ws.addRow([]);
      logoRow.height = 24;
      ws.addImage(productLogoId, {
        tl: { col: 0, row: logoRow.number - 1 },
        ext: box,
        editAs: "oneCell",
      });
    }
  }
  return wb;
}

export async function exportReportXlsx(doc: ReportDoc, branding?: ExportBranding): Promise<string> {
  const [{ getExportBranding }, { isRtlUi }] = await Promise.all([
    import("./branding"),
    import("./pdf-core"),
  ]);
  const b = branding ?? (await getExportBranding());
  const ExcelJS = await loadExcelJs();
  const wb = buildReportWorkbook(ExcelJS, doc, b, { rtl: isRtlUi() });
  const buffer = await wb.xlsx.writeBuffer();
  const filename = exportFileName({ projectCode: b.projectCode, report: doc.report, ext: "xlsx" });
  downloadBlob(
    filename,
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  return filename;
}

// ── PDF from the same ReportDoc ──────────────────────────────────────

function pdfText(v: ReportCell, type: ColumnType | undefined, dateFmt: DateFormat): string {
  if (v == null || v === "") return "";
  if (type === "date") return formatDate(v as string | Date, dateFmt) || String(v);
  if (typeof v === "number") {
    if (type === "integer") return formatExportNumber(v, 0);
    if (type === "percent") return `${formatExportNumber(v, 2)}%`;
    if (type === "money" || type === "number" || !Number.isInteger(v))
      return formatExportNumber(v, 2);
    return String(v);
  }
  if (v instanceof Date) return formatDate(v, dateFmt);
  return String(v);
}

export type PdfReportTable = {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
  numericColumns: number[];
  boldRows: number[];
};

/** Flatten a ReportDoc into printable tables (used by the PDF writer; unit-tested). */
export function reportPdfTables(
  doc: ReportDoc,
  dateFmt: DateFormat = getDateFormat(),
): PdfReportTable[] {
  return doc.sections.map((s) => {
    const rows = s.rows.map((r) => s.columns.map((c, i) => pdfText(r[i], c.type, dateFmt)));
    const totals = (s.totals ?? []).map((r) =>
      s.columns.map((c, i) => pdfText(r[i], c.type, dateFmt)),
    );
    return {
      title: s.title ?? doc.title,
      subtitle: [s.subtitle, ...(s.notes ?? [])].filter(Boolean).join(" · ") || undefined,
      headers: s.columns.map((c) => c.header),
      rows: [...rows, ...totals],
      numericColumns: s.columns
        .map((c, i) => (c.type && c.type !== "text" && c.type !== "date" ? i : -1))
        .filter((i) => i >= 0),
      boldRows: totals.map((_, i) => rows.length + i),
    };
  });
}

export async function exportReportPdf(
  doc: ReportDoc,
  opts: { compact?: boolean } = {},
): Promise<string> {
  const [{ exportPdfReport }, { brandedFileName }] = await Promise.all([
    import("@/lib/export-pdf"),
    import("./branding"),
  ]);
  const filename = brandedFileName(doc.report, "pdf");
  const tables = reportPdfTables(doc);
  await exportPdfReport(
    filename,
    tables.map((t) => ({
      title: t.title,
      subtitle: t.subtitle,
      headers: t.headers,
      rows: t.rows,
      numericColumns: t.numericColumns,
      boldRows: t.boldRows,
    })),
    { documentTitle: doc.title, subtitle: doc.subtitle, fontSize: opts.compact ? 7 : undefined },
  );
  return filename;
}

// ── Branding for hand-built workbooks (official templates etc.) ───────

/**
 * Stamp the shared identity on a workbook that was laid out by hand (for
 * example the Film Commission template, whose cell layout is fixed): print
 * header (company — project | report title) and print footer ("Exported
 * from Kwalis Hub" · user · Saudi time | page X of Y) on every sheet.
 */
export function applyWorkbookBranding(
  wb: ExcelJSNS.Workbook,
  branding: ExportBranding,
  title: string,
): void {
  wb.creator = "Kwalis Hub";
  wb.lastModifiedBy = branding.userName || "Kwalis Hub";
  wb.company = branding.companyName;
  const project = projectLabel(branding);
  const footer = footerLine(branding);
  const page = i18n.t("exports.page_x_of_y", {
    page: "&P",
    total: "&N",
    interpolation: { escapeValue: false },
  });
  wb.eachSheet((ws) => {
    ws.headerFooter = {
      ...ws.headerFooter,
      oddHeader: `&L${excelHeaderText([branding.companyName, project].filter(Boolean).join(" — "))}&R${excelHeaderText(title)}`,
      oddFooter: `&L${excelHeaderText(footer)}&R${excelHeaderText(page)}`,
    };
  });
}

/** Brand a hand-built workbook and download it under the standard file name. */
export async function saveBrandedWorkbook(
  wb: ExcelJSNS.Workbook,
  report: string,
  title: string = report,
): Promise<string> {
  const { getExportBranding } = await import("./branding");
  const b = await getExportBranding();
  applyWorkbookBranding(wb, b, title);
  const buffer = await wb.xlsx.writeBuffer();
  const filename = exportFileName({ projectCode: b.projectCode, report, ext: "xlsx" });
  downloadBlob(
    filename,
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  return filename;
}
