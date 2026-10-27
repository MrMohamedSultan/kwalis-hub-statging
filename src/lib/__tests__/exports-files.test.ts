// End-to-end checks of the branded export writers (D12 / X16 / G02 / G04):
// a real .xlsx with typed cells, and a PDF whose Arabic text survives text
// extraction (joined letters, correct order) with the shared header/footer.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildReportWorkbook, reportPdfTables, type ReportDoc } from "@/lib/export/xlsx-report";
import { createBrandedPdf, setPdfFontSource } from "@/lib/export/pdf-core";
import type { ExportBranding } from "@/lib/export/file-name";

const FONT_DIR = join(process.cwd(), "public", "fonts");

const branding: ExportBranding = {
  companyName: "شركة الإنتاج السعودية للأفلام",
  logoDataUrl: `data:image/png;base64,${readFileSync(join(process.cwd(), "public", "kwalis-icon.png")).toString("base64")}`,
  productLogoDataUrl: `data:image/png;base64,${readFileSync(join(process.cwd(), "public", "kwalis-logo-dark.png")).toString("base64")}`,
  projectCode: "MON26",
  projectName: "Desert Film",
  userName: "محمد عبدالله",
  exportedAt: new Date("2026-10-27T11:05:00Z"),
};

const doc: ReportDoc = {
  report: "Payments Register",
  title: "Payments Register",
  subtitle: "All sources · SAR",
  sections: [
    {
      columns: [
        { header: "Date", type: "date" },
        { header: "Name", type: "text" },
        { header: "Amount (SAR)", type: "money" },
        { header: "Rate", type: "percent" },
      ],
      rows: [
        ["2026-10-27", "عبدالرحمن الشمري — مدير التصوير", 5084801.475000001, 5],
        ["2026-10-26T21:00:00Z", "Vendor LLC", -1750, 15],
      ],
      totals: [["", "Total", 5083051.48, null]],
    },
  ],
};

function hasTool(name: string): boolean {
  try {
    execFileSync("which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("xlsx report writer", () => {
  it("writes numbers as numbers, dates as dates, with the branded header and footer", async () => {
    const wb = buildReportWorkbook(ExcelJS, doc, branding, { dateFormat: "dd/MM/yyyy" });
    const buf = await wb.xlsx.writeBuffer();
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf as ArrayBuffer);
    const ws = back.worksheets[0];
    const values: unknown[][] = [];
    let headerRowNo = 0;
    ws.eachRow((row) => {
      const v = (row.values as unknown[]).slice(1);
      if (v[0] === "Date") headerRowNo = row.number;
      values.push(v);
    });
    const flat = values.map((r) => r.map((v) => String(v ?? "")).join("|")).join("\n");
    expect(flat).toContain(branding.companyName);
    expect(flat).toContain("MON26 — Desert Film");
    expect(flat).toContain("Exported from Kwalis Hub");
    expect(flat).toContain("27/10/2026 14:05");

    const first = ws.getRow(headerRowNo + 1);
    expect(typeof first.getCell(3).value).toBe("number");
    expect(first.getCell(3).value).toBe(5084801.48);
    expect(first.getCell(3).numFmt).toBe("#,##0.00;-#,##0.00");
    const d = first.getCell(1).value as Date;
    expect(d instanceof Date).toBe(true);
    expect(d.toISOString().slice(0, 10)).toBe("2026-10-27");
    expect(first.getCell(1).numFmt).toBe("dd/mm/yyyy");
    const second = ws.getRow(headerRowNo + 2);
    expect((second.getCell(1).value as Date).toISOString().slice(0, 10)).toBe("2026-10-27");
    expect(second.getCell(3).value).toBe(-1750);
    expect(ws.headerFooter.oddFooter).toContain("&P");
    expect(ws.headerFooter.oddFooter).toContain("&N");
    expect(back.model.media?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("flattens the same report for the PDF with formatted figures and bold totals", () => {
    const [t] = reportPdfTables(doc, "dd/MM/yyyy");
    expect(t.rows[0]).toEqual([
      "27/10/2026",
      "عبدالرحمن الشمري — مدير التصوير",
      "5,084,801.48",
      "5.00%",
    ]);
    expect(t.rows[1][0]).toBe("27/10/2026");
    expect(t.rows[1][2]).toBe("-1,750.00");
    expect(t.numericColumns).toEqual([2, 3]);
    expect(t.boldRows).toEqual([2]);
  });
});

describe("branded PDF with Arabic", () => {
  it("embeds the Arabic font and extracts joined Arabic text plus header/footer", async () => {
    setPdfFontSource(async () => ({
      regular: readFileSync(join(FONT_DIR, "IBMPlexSansArabic-Regular.ttf")).toString("base64"),
      bold: readFileSync(join(FONT_DIR, "IBMPlexSansArabic-Bold.ttf")).toString("base64"),
    }));
    const pdf = await createBrandedPdf({ title: "سجل المدفوعات", branding, rtl: true });
    const [t] = reportPdfTables(doc, "dd/MM/yyyy");
    pdf.autoTable(pdf.doc, {
      startY: pdf.contentTop,
      head: [[...t.headers].reverse()],
      body: t.rows.map((r) => [...r].reverse()),
      styles: { font: pdf.font, halign: "right" },
      headStyles: { font: pdf.font, fontStyle: "bold" },
      margin: { top: pdf.contentTop, bottom: pdf.contentBottom },
      didDrawPage: () => pdf.drawHeader(),
    });
    pdf.doc.addPage();
    pdf.drawHeader();
    const bytes = Buffer.from(pdf.finish());
    expect(pdf.font).toBe("KwalisSans");

    if (!hasTool("pdftotext")) return; // text extraction check needs poppler
    const dir = mkdtempSync(join(tmpdir(), "kwalis-pdf-"));
    const file = join(dir, "sample.pdf");
    writeFileSync(file, bytes);
    if (process.env.KWALIS_PDF_SAMPLE) writeFileSync(process.env.KWALIS_PDF_SAMPLE, bytes);
    expect(existsSync(file)).toBe(true);
    const fonts = execFileSync("pdffonts", [file]).toString();
    expect(fonts).toMatch(/KwalisSans.*CID TrueType.*yes/);
    // pdftotext returns Arabic presentation forms; NFKC folds them back to letters.
    const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString().normalize("NFKC");
    expect(text).toContain("عبدالرحمن الشمري");
    expect(text).toContain("مدير التصوير");
    expect(text).toContain("شركة الإنتاج السعودية للأفلام");
    expect(text).toContain("سجل المدفوعات");
    expect(text).toContain("5,084,801.48");
    expect(text).toContain("Exported from Kwalis Hub");
    expect(text).toContain("Page 1 of 2");
    expect(text).toContain("Page 2 of 2");
    expect(text.toLowerCase()).not.toContain("trackroll");
  });
});
