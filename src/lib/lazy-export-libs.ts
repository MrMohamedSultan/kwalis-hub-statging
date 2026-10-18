// ═══════════════════════════════════════════════════════════════════
// Lazy loaders for the heavy export/import libraries.
//
// xlsx (~490 KB), exceljs (~520 KB), jspdf + jspdf-autotable + html2canvas
// (~600 KB) used to sit in the main entry chunk, so every user downloaded
// them on first paint even though they are only needed when someone clicks
// "Export" or uploads a workbook.
//
// Every consumer must import through these helpers — never statically
// `import * as XLSX from "xlsx"` (etc.) from app code, or the library lands
// back in the entry bundle. Type-only imports are fine: they are erased.
//
// Each loader memoizes its module promise, so a second export click reuses
// the already-downloaded chunk with no extra network cost.
// ═══════════════════════════════════════════════════════════════════

type XlsxModule = typeof import("xlsx");
type ExcelJsModule = typeof import("exceljs");
type JsPdfCtor = (typeof import("jspdf"))["default"];
type AutoTableFn = (typeof import("jspdf-autotable"))["default"];

let xlsxPromise: Promise<XlsxModule> | undefined;
let excelJsPromise: Promise<ExcelJsModule> | undefined;
let pdfPromise: Promise<{ jsPDF: JsPdfCtor; autoTable: AutoTableFn }> | undefined;

/** SheetJS — spreadsheet read/write. */
export function loadXlsx(): Promise<XlsxModule> {
  xlsxPromise ??= import("xlsx");
  return xlsxPromise;
}

/** ExcelJS — styled workbook authoring. */
export function loadExcelJs(): Promise<ExcelJsModule> {
  excelJsPromise ??= import("exceljs").then(
    (m) => ((m as unknown as { default?: ExcelJsModule }).default ?? m) as ExcelJsModule,
  );
  return excelJsPromise;
}

/** jsPDF + autoTable — print-ready PDF reports. */
export function loadPdf(): Promise<{ jsPDF: JsPdfCtor; autoTable: AutoTableFn }> {
  pdfPromise ??= Promise.all([import("jspdf"), import("jspdf-autotable")]).then(([pdf, table]) => ({
    jsPDF: pdf.default,
    autoTable: table.default,
  }));
  return pdfPromise;
}
