// Shared identity for workbooks built with SheetJS (G02): every sheet gets
// the company / project / report header on top and the "Exported from
// Kwalis Hub" footer underneath; the file gets the standard name.
// Cell values keep their types (numbers stay numbers).
import type * as XLSXNS from "xlsx";
import { exportFileName, footerLine, projectLabel } from "./file-name";

type XlsxModule = typeof XLSXNS;
type Sheet = XLSXNS.WorkSheet;

/** Pure: header rows + data + footer for one sheet (unit-tested). */
export function brandedRows(
  data: unknown[][],
  ctx: { company: string; project: string; title: string; footer: string },
): unknown[][] {
  const head: unknown[][] = [];
  if (ctx.company) head.push([ctx.company]);
  if (ctx.project) head.push([ctx.project]);
  head.push([ctx.title], []);
  return [...head, ...data, [], [ctx.footer]];
}

function brandSheet(
  XLSX: XlsxModule,
  ws: Sheet,
  ctx: { company: string; project: string; title: string; footer: string },
): Sheet {
  // Sheets with merged cells keep their layout; only the footer is added.
  if (ws["!merges"]?.length) {
    XLSX.utils.sheet_add_aoa(ws, [[], [ctx.footer]], { origin: -1 });
    return ws;
  }
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  const rows = brandedRows(data, ctx);
  const out = XLSX.utils.aoa_to_sheet(rows);
  if (ws["!cols"]) out["!cols"] = ws["!cols"];
  // Money columns keep 2-decimal grouping in Excel.
  const range = XLSX.utils.decode_range(out["!ref"] ?? "A1");
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = out[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n" && !Number.isInteger(cell.v)) cell.z = "#,##0.00";
    }
  }
  return out;
}

/**
 * Brand every sheet of a SheetJS workbook and write it under
 * KwalisHub_{ProjectCode}_{Report}_{YYYY-MM-DD}.xlsx.
 */
export async function writeBrandedSheetJs(
  XLSX: XlsxModule,
  wb: XLSXNS.WorkBook,
  report: string,
  title: string = report,
): Promise<string> {
  const { getExportBranding } = await import("./branding");
  const b = await getExportBranding();
  const ctx = {
    company: b.companyName,
    project: projectLabel(b),
    title,
    footer: footerLine(b),
  };
  for (const name of wb.SheetNames) wb.Sheets[name] = brandSheet(XLSX, wb.Sheets[name], ctx);
  wb.Props = { ...(wb.Props ?? {}), Author: b.userName || "Kwalis Hub", Company: b.companyName };
  const filename = exportFileName({ projectCode: b.projectCode, report, ext: "xlsx" });
  XLSX.writeFile(wb, filename);
  return filename;
}
