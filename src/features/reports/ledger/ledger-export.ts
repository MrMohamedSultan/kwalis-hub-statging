// =====================================================================
// Ledger report exports: one styled .xlsx sheet (exceljs, lazy-loaded) and
// the shared PDF exporter. Both export exactly the rows shown on screen.
// =====================================================================

import { loadExcelJs } from "@/lib/lazy-export-libs";
import { downloadBlob } from "@/lib/download";
import { exportPdfReport } from "@/lib/export-pdf";

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

export async function exportLedgerXlsx(filename: string, t: LedgerExportTable, rtl = false) {
  const ExcelJS = await loadExcelJs();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kwalis Hub";
  const ws = wb.addWorksheet(t.title.slice(0, 31), { views: [{ rightToLeft: rtl }] });
  ws.addRow([t.title]).font = { bold: true, size: 14 };
  ws.addRow([t.subtitle]).font = { italic: true, size: 10 };
  ws.addRow([]);
  const head = ws.addRow(t.headers);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.border = { bottom: { style: "thin" } };
  });
  for (const r of t.rows) ws.addRow(r);
  t.numericColumns.forEach((i) => {
    ws.getColumn(i + 1).numFmt = "#,##0.00;[Red]-#,##0.00";
  });
  t.headers.forEach((h, i) => {
    const longest = Math.max(
      h.length,
      ...t.rows.slice(0, 500).map((r) => String(r[i] ?? "").length),
    );
    ws.getColumn(i + 1).width = Math.min(60, Math.max(10, longest + 2));
  });
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
