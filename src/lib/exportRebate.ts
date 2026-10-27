// Saudi Film Commission — Rebate report export.
// Produces a workbook with two sheets whose layout, column sequence,
// and bilingual headers mirror the official templates:
//   Sheet 1 — General Expenses  (5.6 - نموذج سجل المصروفات)
//   Sheet 2 — Payroll Expenses  (5.7 - نموذج سجل مصروفات الرواتب والأجور)

import type { Invoice, PayrollRow, Person } from "./store";
import type { QfeLedgerRow } from "./qfeLedger";
import { contractHousingTotal, activeDaysForPerson } from "./housing";
import { projectHeaderLine } from "@/lib/project-metadata";

// ARGB (no leading '#')
const NAVY = "FF1F3A5F";
const NAVY_LIGHT = "FF2E5C8A";
const HEADER_FONT = "FFFFFFFF";
const ROW_STRIPE = "FFF3F6FB";
const BORDER_GREY = "FFB8BCC4";

function border() {
  return {
    top: { style: "thin" as const, color: { argb: BORDER_GREY } },
    left: { style: "thin" as const, color: { argb: BORDER_GREY } },
    bottom: { style: "thin" as const, color: { argb: BORDER_GREY } },
    right: { style: "thin" as const, color: { argb: BORDER_GREY } },
  };
}

// ── Sheet 1: General Expenses ────────────────────────────────────────────────
const GEN_GROUPS: { title: string; span: number }[] = [
  { title: "#", span: 1 },
  {
    title:
      "A) Item Classification as per Incentive Agreement\nتصنيف البند وفق وثيقة شروط وأحكام الحوافز المالية",
    span: 3,
  },
  { title: "B) Expense Contractual documents - المستندات التعاقدية للمصروف", span: 5 },
  { title: "C) Invoice - الفاتورة", span: 6 },
  { title: "D) Date of service/delivery\nتاريخ استلام الخدمة", span: 1 },
  { title: "E) Payment - الدفع", span: 5 },
  { title: "Supporting Documents Reference\nمرجع الوثائق الثبوتية", span: 1 },
];

const GEN_HEADERS = [
  "#",
  "QPE Type\nبند المصروف المؤهل",
  "QPE Description\nوصف المصروف المؤهل",
  "Budget Line item\nالتصنيف المعتمد",
  "Supplier Name\nأسم المورد",
  "Supplier Nationality\nجنسية المورد",
  "Contract / PO No.\nرقم العقد/أمر الشراء",
  "PO/Contract Total Amount\nإجمالي قيمة العقد (ريال)",
  "Related Party?\nطرف ذات علاقة؟",
  "Invoice No.\nرقم الفاتورة",
  "Invoice Date\nتاريخ الفاتورة",
  "Currency\nالعملة",
  "Value Without VAT\nالقيمة بدون ضريبة",
  "VAT\nالضريبة",
  "SAR Total Amount\nإجمالي القيمة (ريال)",
  "Delivery Date\nتاريخ الاستلام",
  "Amount paid\nالمبلغ المدفوع",
  "Payment Method\nطريقة الدفع",
  "No. of Payments\nعدد الدفعات",
  "Bank Transfer Ref\nالرقم المرجعي للحوالة",
  "Date of payment\nتاريخ الدفع",
  "Ref\nالمرجع",
  "",
];

const GEN_WIDTHS = [
  5, 22, 30, 18, 24, 16, 18, 18, 12, 16, 14, 10, 16, 12, 16, 14, 14, 14, 10, 18, 14, 10, 18,
];

// ── Sheet 2: Payroll Expenses ────────────────────────────────────────────────
const PAY_GROUPS: { title: string; span: number }[] = [
  { title: "#", span: 1 },
  { title: "A) Crew Members Details - بيانات أعضاء طاقم العمل", span: 8 },
  { title: "B) Working on Film Period - فترة العمل في الفيلم", span: 3 },
  { title: "D) Payroll - الراتب", span: 9 },
  { title: "E) Payment - الدفع", span: 6 },
  { title: "Supporting Documents Reference\nمرجع الوثائق الثبوتية", span: 1 },
];

const PAY_HEADERS = [
  "#",
  "Crew member No\nرقم العضو",
  "Name\nالاسم",
  "Position / Role\nالدور في المشروع",
  "Nationality\nالجنسية",
  "ID / Passport No.\nرقم الهوية/الجواز",
  "Supplier name\nاسم المورد إن وجد",
  "Invoice No.\nرقم الفاتورة إن وجد",
  "Related Party?\nطرف ذات علاقة؟",
  "From\nبداية من",
  "To\nحتى",
  "Total Days\nإجمالي الأيام",
  "Basic Salary\nالراتب الأساسي",
  "Housing\nبدل السكن",
  "Transportation\nبدل مواصلات",
  "Telephone\nبدل هاتف",
  "Other Allowances\nبدلات أخرى",
  "Overtime\nعمل إضافي",
  "Per-diem\nالمياومات",
  "Total Salary\nإجمالي الراتب",
  "Total Paid for Film\nإجمالي المدفوع للفيلم",
  "Amount paid\nالمبلغ المدفوع",
  "Payment Method\nطريقة الدفع",
  "IBAN / Bank Account\nرقم الحساب/الآيبان",
  "No. of Payments\nعدد الدفعات",
  "Bank Ref No.\nالرقم المرجعي للحوالة",
  "Date of payment\nتاريخ الدفع",
  "Ref\nالمرجع",
];

const PAY_WIDTHS = [
  5, 14, 24, 22, 14, 18, 22, 16, 12, 12, 12, 10, 14, 12, 14, 12, 14, 12, 12, 14, 16, 14, 14, 24, 10,
  18, 14, 10,
];

function applyBanner(ws: import("exceljs").Worksheet, colCount: number, title: string) {
  ws.mergeCells(1, 1, 1, colCount);
  const c = ws.getCell(1, 1);
  // Append the latest saved Project Settings header so exports always carry
  // current production metadata without a refresh.
  const header = projectHeaderLine();
  c.value = header ? `${title}\n${header}` : title;
  c.font = { bold: true, color: { argb: HEADER_FONT }, size: 13, name: "Calibri" };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  ws.getRow(1).height = header ? 44 : 30;
}

function applyGroupedHeader(
  ws: import("exceljs").Worksheet,
  groups: { title: string; span: number }[],
  headers: string[],
) {
  // Row 2 = grouped bands, Row 3 = detailed bilingual headers.
  let col = 1;
  for (const g of groups) {
    if (g.span > 1) ws.mergeCells(2, col, 2, col + g.span - 1);
    const cell = ws.getCell(2, col);
    cell.value = g.title;
    cell.font = { bold: true, color: { argb: HEADER_FONT }, name: "Calibri", size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = border();
    for (let s = 1; s < g.span; s++) {
      ws.getCell(2, col + s).border = border();
    }
    col += g.span;
  }
  ws.getRow(2).height = 34;

  headers.forEach((h, i) => {
    const cell = ws.getCell(3, i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: HEADER_FONT }, name: "Calibri", size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_LIGHT } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = border();
  });
  ws.getRow(3).height = 48;
  ws.views = [{ state: "frozen", ySplit: 3 }];
}

function styleDataRow(
  ws: import("exceljs").Worksheet,
  rowIdx: number,
  colCount: number,
  numericCols: number[],
) {
  const row = ws.getRow(rowIdx);
  for (let i = 1; i <= colCount; i++) {
    const c = row.getCell(i);
    c.border = border();
    c.font = { name: "Calibri", size: 10 };
    if (numericCols.includes(i)) {
      c.numFmt = "#,##0.00;(#,##0.00);-";
      c.alignment = { vertical: "middle", horizontal: "right" };
    } else {
      c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    }
  }
}

function addTotalRow(
  ws: import("exceljs").Worksheet,
  rowIdx: number,
  labelCol: number,
  colCount: number,
  totals: Record<number, number>,
) {
  const row = ws.getRow(rowIdx);
  const label = row.getCell(labelCol);
  label.value = "الإجمالي  Total";
  label.font = { bold: true, name: "Calibri", size: 10, color: { argb: NAVY } };
  for (let i = 1; i <= colCount; i++) {
    const c = row.getCell(i);
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROW_STRIPE } };
    c.border = border();
    if (totals[i] !== undefined) {
      c.value = totals[i];
      c.numFmt = "#,##0.00;(#,##0.00);-";
      c.font = { bold: true, name: "Calibri", size: 10, color: { argb: NAVY } };
      c.alignment = { horizontal: "right" };
    }
  }
}

export async function exportRebateWorkbook(opts: {
  filename?: string;
  projectName?: string;
  invoices: Invoice[];
  payroll: PayrollRow[];
  /** Cast & crew roster — used to compute prorated housing allowance per payroll row. */
  people?: Person[];
  /** Supporting-document URLs keyed by entry id, per source kind. */
  docUrls?: {
    invoice?: Record<string, string>;
    payroll?: Record<string, string>;
  };
  /** Full QFE ledger — when provided, appended as a third auditor sheet. */
  ledger?: QfeLedgerRow[];
}) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kwalis Hub";
  wb.created = new Date();

  // ── General Expenses ─────────────────────────────────────────────────────
  const ws1 = wb.addWorksheet("General Expenses");
  ws1.columns = GEN_WIDTHS.map((w) => ({ width: w }));
  applyBanner(
    ws1,
    GEN_HEADERS.length,
    `General Expenses (المصروفات العامة) — ${opts.projectName ?? "Project"}`,
  );
  applyGroupedHeader(ws1, GEN_GROUPS, GEN_HEADERS);

  const genNumeric = [8, 13, 14, 15, 17, 19];
  const genTotals: Record<number, number> = { 8: 0, 13: 0, 14: 0, 15: 0, 17: 0 };
  opts.invoices.forEach((inv, i) => {
    const r = 4 + i;
    const vat = inv.vatable ? inv.price * 0.15 : 0;
    const total = inv.price + vat;
    ws1.getRow(r).values = [
      i + 1,
      "", // QPE Type
      inv.description ?? "",
      inv.budgetCode ?? "",
      inv.vendorName ?? "",
      "", // Supplier Nationality
      "", // Contract / PO No
      "", // PO/Contract Total
      "لا",
      inv.invoiceNo ?? "",
      inv.date ?? "",
      "SAR",
      inv.price,
      vat,
      total,
      inv.date ?? "",
      total,
      "Transfer",
      1,
      "",
      "",
      "",
      "",
    ];
    styleDataRow(ws1, r, GEN_HEADERS.length, genNumeric);
    const url = (opts.docUrls?.invoice?.[inv.id] ?? "").trim();
    const cell = ws1.getCell(r, GEN_HEADERS.length);
    if (url) {
      cell.value = { text: url, hyperlink: url } as any;
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF2E5C8A" }, underline: true };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    } else {
      cell.value = "N/A";
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF9AA0A6" }, italic: true };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    }
    genTotals[13] += inv.price;
    genTotals[14] += vat;
    genTotals[15] += total;
    genTotals[17] += total;
  });
  addTotalRow(ws1, 4 + opts.invoices.length, 2, GEN_HEADERS.length, genTotals);

  // ── Payroll Expenses ─────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet("Payroll Expenses");
  ws2.columns = PAY_WIDTHS.map((w) => ({ width: w }));
  applyBanner(
    ws2,
    PAY_HEADERS.length,
    `Payroll Expenses (الرواتب والأجور) — ${opts.projectName ?? "Project"}`,
  );
  applyGroupedHeader(ws2, PAY_GROUPS, PAY_HEADERS);

  const payNumeric = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  const payTotals: Record<number, number> = { 13: 0, 20: 0, 21: 0, 22: 0 };
  // Categorize payroll into audit-ready sections: Talent/Cast → Technical/Crew → Vendors.
  const kindOrder: Record<string, number> = { cast: 0, crew: 1, vendor: 2 };
  const sortedPayroll = [...opts.payroll].sort(
    (a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9),
  );
  const kindLabel = (k: string) =>
    k === "cast"
      ? "Talent / Cast (طاقم التمثيل)"
      : k === "crew"
        ? "Technical / Crew (طاقم العمل الفني)"
        : "Vendor / Service Provider";
  const peopleById = new Map<string, Person>((opts.people ?? []).map((p) => [p.id, p]));
  const peopleByName = new Map<string, Person>(
    (opts.people ?? []).map((p) => [p.fullName?.toLowerCase() ?? "", p]),
  );
  let outRow = 4;
  let lastKind: string | null = null;
  sortedPayroll.forEach((p) => {
    // Inject bold section banner when kind changes
    if (p.kind !== lastKind) {
      const banner = ws2.getRow(outRow);
      banner.values = [kindLabel(p.kind), ...Array(PAY_HEADERS.length - 1).fill("")];
      ws2.mergeCells(outRow, 1, outRow, PAY_HEADERS.length);
      banner.getCell(1).font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: HEADER_FONT },
      };
      banner.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_LIGHT } };
      banner.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
      banner.height = 20;
      outRow++;
      lastKind = p.kind;
    }
    // Lookup person to compute prorated monthly housing allowance.
    const person = peopleById.get(p.refId ?? "") ?? peopleByName.get(p.name?.toLowerCase() ?? "");
    const housing = person ? contractHousingTotal(person) : 0;
    const totalWithHousing = (p.totalAmount ?? 0) + housing;
    ws2.getRow(outRow).values = [
      outRow - 3,
      p.refId ?? "",
      p.name ?? "",
      kindLabel(p.kind), // Position / Role column now doubles as audit category
      person?.nationality ?? "",
      person?.idNumber ?? "",
      "",
      "",
      "لا",
      person?.startDate ?? "",
      person?.endDate ?? "",
      person ? String(activeDaysForPerson(person)) : "",
      p.totalAmount ?? 0,
      housing,
      0,
      0,
      0,
      0,
      0,
      totalWithHousing,
      totalWithHousing,
      totalWithHousing,
      "Transfer",
      "",
      p.payments?.length ?? 1,
      "",
      "",
      "",
    ];
    styleDataRow(ws2, outRow, PAY_HEADERS.length, payNumeric);
    const url = (opts.docUrls?.payroll?.[p.id] ?? "").trim();
    const cell = ws2.getCell(outRow, PAY_HEADERS.length);
    if (url) {
      cell.value = { text: url, hyperlink: url } as any;
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF2E5C8A" }, underline: true };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    } else {
      cell.value = "N/A";
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF9AA0A6" }, italic: true };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    }
    payTotals[13] += p.totalAmount ?? 0;
    payTotals[14] = (payTotals[14] ?? 0) + housing;
    payTotals[20] += totalWithHousing;
    payTotals[21] += totalWithHousing;
    payTotals[22] += totalWithHousing;
    outRow++;
  });
  addTotalRow(ws2, outRow, 3, PAY_HEADERS.length, payTotals);

  // ── QFE Ledger (auditor-facing, expanded) ────────────────────────────────
  if (opts.ledger && opts.ledger.length) {
    const ws3 = wb.addWorksheet("QFE Ledger");
    const LEDGER_HEADERS = [
      "#",
      "Source\nالمصدر",
      "Reference\nالمرجع",
      "Party / Vendor\nالمورد / الطرف",
      "Official ID / CR\nالسجل التجاري / الهوية",
      "Category\nالفئة",
      "Invoice Date\nتاريخ الفاتورة",
      "Official QPE Type\nتصنيف SFC",
      "Supplier Nationality\nجنسية المورد",
      "Supplier Status\nحالة المورد",
      "Amount Excl. VAT\nالمبلغ بدون ضريبة",
      "VAT\nالضريبة",
      "Total\nالإجمالي",
      "Paid\nالمدفوع",
      "Balance\nالمتبقي",
      "Payment Status\nحالة الدفع",
      "Department\nالقسم",
      "Budget Code\nرمز الميزانية",
      "PO Reference\nأمر الشراء",
      "QFE Eligibility\nالأهلية",
      "QFE Rule Applied\nالقاعدة المطبقة",
      "QFE Justification\nمبرر الأهلية",
      "Supporting Documents\nمرجع الوثائق",
    ];
    const LEDGER_WIDTHS = [
      5, 12, 20, 28, 22, 22, 14, 26, 20, 14, 16, 12, 16, 14, 14, 16, 18, 16, 16, 14, 18, 40, 30,
    ];
    ws3.columns = LEDGER_WIDTHS.map((w) => ({ width: w }));
    applyBanner(
      ws3,
      LEDGER_HEADERS.length,
      `QFE Eligibility Ledger — ${opts.projectName ?? "Project"}`,
    );

    LEDGER_HEADERS.forEach((h, i) => {
      const cell = ws3.getCell(2, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: HEADER_FONT }, name: "Calibri", size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_LIGHT } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = border();
    });
    ws3.getRow(2).height = 40;
    ws3.views = [{ state: "frozen", ySplit: 2 }];

    // Numeric columns shifted +2 due to Official ID + Category insertions.
    const ledgerNumeric = [11, 12, 13, 14, 15];
    const ledgerTotals: Record<number, number> = { 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 };
    const ELIG_COL = 20;
    const DOC_COL = LEDGER_HEADERS.length; // 21
    opts.ledger.forEach((l, i) => {
      const r = 3 + i;
      ws3.getRow(r).values = [
        i + 1,
        l.kind,
        l.ref,
        l.party,
        l.officialId ?? "",
        l.category ?? "",
        l.invoiceDate,
        l.qpeType,
        l.supplierNationality,
        l.supplierStatus,
        l.amountExVat,
        l.vatAmount,
        l.amount,
        l.paidTotal,
        l.balance,
        l.paymentStatus,
        l.department ?? "",
        l.budgetCode ?? "",
        l.poRef ?? "",
        l.qfe ? "QFE Eligible" : "Non-QPE",
        l.qfeRuleApplied ?? "",
        l.qfeReason ?? "",
        "",
      ];
      styleDataRow(ws3, r, LEDGER_HEADERS.length, ledgerNumeric);
      const eligCell = ws3.getCell(r, ELIG_COL);
      eligCell.font = {
        name: "Calibri",
        size: 10,
        bold: true,
        color: { argb: l.qfe ? "FF0F7A3D" : "FF7A2E2E" },
      };
      const docCell = ws3.getCell(r, DOC_COL);
      if (l.docUrl) {
        docCell.value = { text: l.docUrl, hyperlink: l.docUrl } as any;
        docCell.font = { name: "Calibri", size: 10, color: { argb: "FF2E5C8A" }, underline: true };
        docCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      } else {
        docCell.value = "N/A";
        docCell.font = { name: "Calibri", size: 10, color: { argb: "FF9AA0A6" }, italic: true };
        docCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      }
      ledgerTotals[11] += l.amountExVat;
      ledgerTotals[12] += l.vatAmount;
      ledgerTotals[13] += l.amount;
      ledgerTotals[14] += l.paidTotal;
      ledgerTotals[15] += l.balance;
    });
    addTotalRow(ws3, 3 + opts.ledger.length, 3, LEDGER_HEADERS.length, ledgerTotals);
    ws3.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: LEDGER_HEADERS.length } };
  }

  // ── Withholding Tax Summary (tax-reporting sheet) ────────────────────────
  const whtInvoices = opts.invoices.filter((i) => (i.whtAmount ?? 0) > 0);
  const whtPayroll = opts.payroll.filter((p) => (p.whtAmount ?? 0) > 0);
  if (whtInvoices.length + whtPayroll.length > 0) {
    const ws4 = wb.addWorksheet("Withholding Tax");
    const WHT_HEADERS = [
      "#",
      "Source\nالمصدر",
      "Reference\nالمرجع",
      "Party / Vendor\nالطرف",
      "Date\nالتاريخ",
      "Gross Amount\nالمبلغ الإجمالي",
      "WHT %\nنسبة الاستقطاع",
      "WHT Amount\nمبلغ الاستقطاع",
      "Net Payable\nصافي المستحق",
      "GL Account\nحساب الأستاذ",
    ];
    const WHT_WIDTHS = [5, 12, 22, 28, 14, 16, 10, 16, 16, 16];
    ws4.columns = WHT_WIDTHS.map((w) => ({ width: w }));
    applyBanner(
      ws4,
      WHT_HEADERS.length,
      `Withholding Tax Liability — ${opts.projectName ?? "Project"}`,
    );
    WHT_HEADERS.forEach((h, i) => {
      const c = ws4.getCell(2, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: HEADER_FONT }, name: "Calibri", size: 10 };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_LIGHT } };
      c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      c.border = border();
    });
    ws4.getRow(2).height = 40;
    ws4.views = [{ state: "frozen", ySplit: 2 }];
    const whtNumeric = [6, 8, 9];
    const whtTotals: Record<number, number> = { 6: 0, 8: 0, 9: 0 };
    let r = 3;
    whtInvoices.forEach((iv, i) => {
      const gross = Number(iv.price) || 0;
      const wht = Number(iv.whtAmount) || 0;
      const net = iv.netPayable != null ? Number(iv.netPayable) : gross - wht;
      ws4.getRow(r).values = [
        i + 1,
        "Invoice",
        iv.invoiceNo || iv.id.slice(0, 8),
        iv.vendorName ?? "",
        iv.date ?? "",
        gross,
        iv.whtPercent ?? 5,
        wht,
        net,
        iv.whtGlCode ?? "2140",
      ];
      styleDataRow(ws4, r, WHT_HEADERS.length, whtNumeric);
      whtTotals[6] += gross;
      whtTotals[8] += wht;
      whtTotals[9] += net;
      r++;
    });
    whtPayroll.forEach((p, i) => {
      const gross = Number(p.totalAmount) || 0;
      const wht = Number(p.whtAmount) || 0;
      const net = p.netPayable != null ? Number(p.netPayable) : gross - wht;
      ws4.getRow(r).values = [
        whtInvoices.length + i + 1,
        `Payroll (${p.kind})`,
        p.refId || p.id.slice(0, 8),
        p.name ?? "",
        "",
        gross,
        p.whtPercent ?? 5,
        wht,
        net,
        p.whtGlCode ?? "2140",
      ];
      styleDataRow(ws4, r, WHT_HEADERS.length, whtNumeric);
      whtTotals[6] += gross;
      whtTotals[8] += wht;
      whtTotals[9] += net;
      r++;
    });
    addTotalRow(ws4, r, 5, WHT_HEADERS.length, whtTotals);
    ws4.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: WHT_HEADERS.length } };
  }

  // Shared Kwalis Hub identity (print header/footer, page X of Y) and the
  // standard file name; the official template layout itself is untouched.
  const { saveBrandedWorkbook } = await import("@/lib/export/xlsx-report");
  await saveBrandedWorkbook(
    wb,
    opts.filename ?? "Film Commission Rebate",
    "Saudi Film Commission Rebate",
  );
}
