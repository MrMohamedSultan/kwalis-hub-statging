import { toast } from "sonner";
import i18n from "i18next";
import { loadPdf } from "@/lib/lazy-export-libs";
import { projectHeaderLine } from "@/lib/project-metadata";

export type PdfTable = {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  /** Columns rendered as currency (right-aligned, tabular). */
  numericColumns?: number[];
};

export type PdfMeta = {
  documentTitle?: string;
  author?: string;
  /**
   * Language direction of the export. When "rtl" (Arabic), the document is
   * flipped so headers/labels align to the right, timestamps align to the
   * left, and column order is reversed so numeric columns stay at the reading
   * end. Numeric column indexes are auto-remapped after reversal.
   */
  direction?: "ltr" | "rtl";
};

/**
 * Export one or more tables to a print-ready PDF.
 * - A4 landscape, page numbers, timestamp footer.
 * - Uses jspdf-autotable for clean typography and column layout.
 * - RTL-safe: pass `meta.direction: "rtl"` when exporting from the Arabic UI.
 */
export async function exportPdfReport(
  filename: string,
  tables: PdfTable[],
  meta?: PdfMeta,
): Promise<void> {
  // jspdf + autotable are pulled on demand so they stay out of the entry bundle.
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const autoDir: "ltr" | "rtl" =
    typeof document !== "undefined" &&
    (document.documentElement.dir === "rtl" ||
      document.documentElement.lang?.toLowerCase().startsWith("ar"))
      ? "rtl"
      : "ltr";
  const rtl = (meta?.direction ?? autoDir) === "rtl";

  const stamp = new Date().toLocaleString(rtl ? "ar-SA" : undefined);
  doc.setProperties({
    title: meta?.documentTitle ?? filename,
    author: meta?.author ?? "TrackRoll",
    creator: "TrackRoll",
  });

  tables.forEach((tbl, idx) => {
    if (idx > 0) doc.addPage();

    // Reverse column order in RTL so the reading flow matches the UI.
    const headers = rtl ? [...tbl.headers].reverse() : tbl.headers;
    const rows = rtl ? tbl.rows.map((r) => [...r].reverse()) : tbl.rows;
    const colCount = headers.length;
    const numericSet = new Set((tbl.numericColumns ?? []).map((i) => (rtl ? colCount - 1 - i : i)));

    // Header band
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, pageWidth, 56, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    const titleText = meta?.documentTitle ?? `TrackRoll ${i18n.t("export.report")}`;
    if (rtl) {
      doc.text(titleText, pageWidth - 32, 24, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(stamp, 32, 24, { align: "left" });
    } else {
      doc.text(titleText, 32, 24);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(stamp, pageWidth - 32, 24, { align: "right" });
    }

    // Live production header (Project Settings) — always the latest saved values.
    const headerLine = projectHeaderLine();
    if (headerLine) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(203, 213, 225);
      doc.text(headerLine, rtl ? pageWidth - 32 : 32, 44, {
        align: rtl ? "right" : "left",
      });
    }

    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(tbl.title, rtl ? pageWidth - 32 : 32, 78, {
      align: rtl ? "right" : "left",
    });
    if (tbl.subtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(tbl.subtitle, rtl ? pageWidth - 32 : 32, 94, {
        align: rtl ? "right" : "left",
      });
      doc.setTextColor(15, 23, 42);
    }

    autoTable(doc, {
      startY: tbl.subtitle ? 104 : 90,
      head: [headers],
      body: rows.map((r) => r.map((c) => (c == null ? "" : String(c)))),
      styles: {
        fontSize: 9,
        cellPadding: 5,
        overflow: "linebreak",
        halign: rtl ? "right" : "left",
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: 255,
        fontStyle: "bold",
        halign: rtl ? "right" : "left",
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: Object.fromEntries(
        headers.map((_, i) => [
          i,
          numericSet.has(i) ? { halign: "right" } : rtl ? { halign: "right" } : {},
        ]),
      ),
      margin: { left: 32, right: 32, bottom: 40 },
      didDrawPage: () => {
        const page = doc.getNumberOfPages();
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(`${i18n.t("export.page")} ${page}`, rtl ? 32 : pageWidth - 32, pageHeight - 20, {
          align: rtl ? "left" : "right",
        });
        doc.setTextColor(15, 23, 42);
      },
    });
  });

  const outName = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  try {
    doc.save(outName);
    toast.success(i18n.t("export.pdfReady"), { description: outName });
  } catch (err) {
    toast.error(i18n.t("export.pdfFailed"), {
      description: err instanceof Error ? err.message : outName,
    });
    throw err;
  }
}
