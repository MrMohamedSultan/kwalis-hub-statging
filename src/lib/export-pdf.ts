import { toast } from "sonner";
import i18n from "i18next";
import { projectHeaderLine } from "@/lib/project-metadata";
import { createBrandedPdf } from "@/lib/export/pdf-core";
import { normalizeForActiveProject } from "@/lib/export/branding";
import { formatExportNumber } from "@/lib/export/number-format";

export type PdfTable = {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  /** Columns rendered as currency (right-aligned, tabular, 2 decimals). */
  numericColumns?: number[];
  /** Rows (by index) drawn bold — totals / subtotals. */
  boldRows?: number[];
};

export type PdfMeta = {
  documentTitle?: string;
  /** Small line under the title in the page header (filters, currency…). */
  subtitle?: string;
  author?: string;
  /**
   * Language direction of the export. When "rtl" (Arabic), the document is
   * flipped so headers/labels align to the right and column order is
   * reversed so the reading flow matches the UI. Numeric column indexes are
   * auto-remapped after reversal.
   */
  direction?: "ltr" | "rtl";
};

/** Render a cell for the PDF: money columns get grouping + 2 decimals. */
export function pdfCell(value: string | number | null | undefined, numeric: boolean): string {
  if (value == null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    if (numeric || !Number.isInteger(value)) return formatExportNumber(value, 2);
    return String(value);
  }
  return String(value);
}

/**
 * Export one or more tables to a print-ready, branded PDF.
 * - A4 landscape; shared Kwalis Hub header and footer on every page
 *   (client logo, company, project / exported-by, Saudi time, page X of Y).
 * - Arabic-capable embedded font (joined letters, correct direction).
 * - File name normalised to KwalisHub_{ProjectCode}_{Report}_{YYYY-MM-DD}.pdf
 */
export async function exportPdfReport(
  filename: string,
  tables: PdfTable[],
  meta?: PdfMeta,
): Promise<void> {
  const title = meta?.documentTitle ?? tables[0]?.title ?? i18n.t("export.report");
  const pdf = await createBrandedPdf({
    title,
    subtitle: meta?.subtitle,
    detail: projectHeaderLine() || undefined,
    rtl: meta?.direction ? meta.direction === "rtl" : undefined,
  });
  const { doc, autoTable, font, rtl } = pdf;

  tables.forEach((tbl, idx) => {
    // The shared header is drawn by didDrawPage on every page of the table.
    if (idx > 0) doc.addPage();

    // Reverse column order in RTL so the reading flow matches the UI.
    const colCount = tbl.headers.length;
    const numericOrig = new Set(tbl.numericColumns ?? []);
    const bodyRows = tbl.rows.map((r) => r.map((c, i) => pdfCell(c, numericOrig.has(i))));
    const headers = rtl ? [...tbl.headers].reverse() : tbl.headers;
    const rows = rtl ? bodyRows.map((r) => [...r].reverse()) : bodyRows;
    const numericSet = new Set([...numericOrig].map((i) => (rtl ? colCount - 1 - i : i)));
    const boldRows = new Set(tbl.boldRows ?? []);

    let y = pdf.contentTop;
    const showTableTitle = tables.length > 1 || tbl.title !== title;
    if (showTableTitle) {
      doc.setFont(font, "bold");
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(tbl.title, pdf.startX, y, { align: pdf.startAlign });
      y += 14;
    }
    if (tbl.subtitle) {
      doc.setFont(font, "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(tbl.subtitle, pdf.startX, y, { align: pdf.startAlign });
      y += 12;
      doc.setTextColor(15, 23, 42);
    }

    autoTable(doc, {
      startY: y + 2,
      head: [headers],
      body: rows,
      showHead: "everyPage",
      styles: {
        font,
        fontSize: 8.5,
        cellPadding: 4,
        overflow: "linebreak",
        halign: rtl ? "right" : "left",
      },
      headStyles: {
        font,
        fillColor: [30, 41, 59],
        textColor: 255,
        fontStyle: "bold",
        halign: rtl ? "right" : "left",
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: Object.fromEntries(
        headers.map((_, i) => [
          i,
          numericSet.has(i)
            ? { halign: "right" as const }
            : rtl
              ? { halign: "right" as const }
              : {},
        ]),
      ),
      didParseCell: (data) => {
        if (data.section === "body" && boldRows.has(data.row.index)) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [226, 232, 240];
        }
      },
      margin: {
        top: pdf.contentTop,
        left: pdf.margin,
        right: pdf.margin,
        bottom: pdf.contentBottom,
      },
      didDrawPage: () => pdf.drawHeader(),
    });
  });

  const outName = normalizeForActiveProject(filename, "pdf");
  try {
    pdf.save(outName);
    toast.success(i18n.t("export.pdfReady"), { description: outName });
  } catch (err) {
    toast.error(i18n.t("export.pdfFailed"), {
      description: err instanceof Error ? err.message : outName,
    });
    throw err;
  }
}
