// =====================================================================
// Ledger report exports: one styled .xlsx sheet (exceljs, lazy-loaded) and
// the shared PDF exporter. Both export exactly the rows shown on screen.
// =====================================================================

import { loadExcelJs } from "@/lib/lazy-export-libs";
import { downloadBlob } from "@/lib/download";
import { exportPdfReport } from "@/lib/export-pdf";
import type { ReportDoc } from "@/lib/export/xlsx-report";

export type LedgerExportTable = {
  title: string;
  subtitle: string;
  headers: string[];
  rows: (string | number)[][];
  /** Column indexes holding amounts. */
  numericColumns: number[];
};

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** KwalisHub_{ProjectCode}_{Report}_{YYYY-MM-DD}.{ext} */
export function ledgerFileName(projectCode: string | null, report: string, ext: "xlsx" | "pdf") {
  const code = (projectCode ?? "project").replace(/[^A-Za-z0-9]+/g, "-");
  return `KwalisHub_${code}_${report.replace(/[^A-Za-z0-9]+/g, "")}_${stamp()}.${ext}`;
}

/** The ledger table as a shared ReportDoc (unit-tested). */
export function ledgerReportDoc(t: LedgerExportTable): ReportDoc {
  const money = new Set(t.numericColumns);
  return {
    report: t.title,
    title: t.title,
    subtitle: t.subtitle,
    sections: [
      {
        columns: t.headers.map((h, i) => ({
          header: h,
          type: money.has(i) ? ("money" as const) : ("text" as const),
        })),
        rows: t.rows,
      },
    ],
  };
}

/** Branded workbook (G02): logo, company / project header and footer on the sheet. */
export async function exportLedgerXlsx(filename: string, t: LedgerExportTable, rtl = false) {
  const [ExcelJS, { getExportBranding }, { buildReportWorkbook }] = await Promise.all([
    loadExcelJs(),
    import("@/lib/export/branding"),
    import("@/lib/export/xlsx-report"),
  ]);
  const wb = buildReportWorkbook(ExcelJS, ledgerReportDoc(t), await getExportBranding(), { rtl });
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(
    filename,
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
}

export async function exportLedgerPdf(filename: string, t: LedgerExportTable, rtl = false) {
  await exportPdfReport(
    filename,
    [
      {
        title: t.title,
        subtitle: t.subtitle,
        headers: t.headers,
        rows: t.rows,
        numericColumns: t.numericColumns,
      },
    ],
    {
      documentTitle: `Kwalis Hub — ${t.title}`,
      author: "Kwalis Hub",
      direction: rtl ? "rtl" : "ltr",
    },
  );
}
