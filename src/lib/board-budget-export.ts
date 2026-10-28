// Board Budget Review — Excel / PDF exports.
// Produces the exact same hierarchy the on-screen grid shows:
// group → header section → detail lines → totals.

import { formatDateTime } from "@/lib/date-format";
import type ExcelJSTypes from "exceljs";
import { loadExcelJs } from "@/lib/lazy-export-libs";
import { exportPdfReport } from "@/lib/export-pdf";

export type BoardExportLine = {
  code: string;
  account: string;
  qty: number;
  currency: string;
  rate: number;
  periods: number;
  totalSAR: number;
};

export type BoardExportHeader = {
  code: string;
  name: string;
  subtotalSAR: number;
  lines: BoardExportLine[];
};

export type BoardExportGroup = {
  groupLabel: string;
  totalSAR: number;
  headers: BoardExportHeader[];
};

export type BoardExportPayload = {
  projectName: string;
  projectCode: string;
  status: string;
  grandTotalSAR: number;
  groups: BoardExportGroup[];
};

const COLUMNS = ["Code", "Account", "Qty", "Cur", "Rate", "Periods", "Total (SAR)"];

const NAVY = "FF1F3A5F";
const GROUP_FILL = "FFDCE6F1";
const HEADER_FILL = "FFF3F6FB";

function num(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function safeName(payload: BoardExportPayload): string {
  const base = `${payload.projectCode || "project"}-budget-review`;
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase();
}

/** Flat row model shared by both exports. */
function flatRows(payload: BoardExportPayload): {
  kind: "group" | "header" | "line";
  cells: (string | number)[];
}[] {
  const rows: { kind: "group" | "header" | "line"; cells: (string | number)[] }[] = [];
  for (const group of payload.groups) {
    rows.push({
      kind: "group",
      cells: ["", group.groupLabel, "", "", "", "", num(group.totalSAR)],
    });
    for (const header of group.headers) {
      rows.push({
        kind: "header",
        cells: [header.code, header.name, "", "", "", "", num(header.subtotalSAR)],
      });
      for (const line of header.lines) {
        rows.push({
          kind: "line",
          cells: [
            line.code,
            line.account,
            num(line.qty),
            line.currency,
            num(line.rate),
            num(line.periods),
            num(line.totalSAR),
          ],
        });
      }
    }
  }
  rows.push({
    kind: "group",
    cells: ["", "GRAND TOTAL", "", "", "", "", num(payload.grandTotalSAR)],
  });
  return rows;
}

export async function exportBoardBudgetExcel(payload: BoardExportPayload): Promise<void> {
  const ExcelJS = await loadExcelJs();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kwalis HUB";
  wb.created = new Date();
  const ws = wb.addWorksheet("Budget Review", {
    views: [{ state: "frozen", ySplit: 5 }],
  });

  ws.columns = [
    { width: 14 },
    { width: 52 },
    { width: 12 },
    { width: 8 },
    { width: 14 },
    { width: 10 },
    { width: 18 },
  ];

  const title = ws.addRow([`${payload.projectName} — Budget Review`]);
  ws.mergeCells(title.number, 1, title.number, COLUMNS.length);
  title.font = { bold: true, size: 14, color: { argb: NAVY } };
  title.height = 34;
  title.alignment = { vertical: "middle" };

  const meta = ws.addRow([
    `Project code: ${payload.projectCode || "—"}   |   Status: ${payload.status}   |   Generated: ${formatDateTime(new Date())}`,
  ]);
  ws.mergeCells(meta.number, 1, meta.number, COLUMNS.length);
  meta.font = { size: 9, color: { argb: "FF666666" } };

  ws.addRow([]);

  const head = ws.addRow(COLUMNS);
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  ws.addRow([]);

  for (const row of flatRows(payload)) {
    const r = ws.addRow(row.cells);
    r.getCell(7).numFmt = "#,##0.00";
    r.getCell(3).numFmt = "#,##0.00";
    r.getCell(5).numFmt = "#,##0.00";
    if (row.kind === "group") {
      r.font = { bold: true, color: { argb: NAVY } };
      r.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_FILL } };
      });
    } else if (row.kind === "header") {
      r.font = { bold: true };
      r.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      });
    }
  }

  // Shared Kwalis Hub identity + standard file name (G02).
  const { saveBrandedWorkbook } = await import("@/lib/export/xlsx-report");
  // Client logo over the free end of the title row (column G).
  await saveBrandedWorkbook(wb, "Board Budget", "Board Budget Review", {
    logo: { col: 6.05, row: 0.05, maxWidth: 120, maxHeight: 40 },
  });
}

export function exportBoardBudgetPdf(payload: BoardExportPayload): void {
  const rows = flatRows(payload).map((row) =>
    row.cells.map((c) =>
      typeof c === "number"
        ? c.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : c,
    ),
  );

  exportPdfReport(
    `${safeName(payload)}.pdf`,
    [
      {
        title: `${payload.projectName} — Budget Review`,
        subtitle: `Code: ${payload.projectCode || "—"} · Status: ${payload.status} · Grand total: ${num(
          payload.grandTotalSAR,
        ).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`,
        headers: COLUMNS,
        rows,
        numericColumns: [2, 4, 5, 6],
      },
    ],
    { documentTitle: `${payload.projectName} Budget Review`, author: "Kwalis HUB" },
  );
}
