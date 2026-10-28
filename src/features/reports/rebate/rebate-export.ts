// ═══════════════════════════════════════════════════════════════════
// Film Commission Rebate — exports (R20 / D18 / decision 11).
//   * every section exports alone (Excel + PDF through the shared writers
//     in src/lib/export), or
//   * all sections in ONE workbook, one sheet per section.
// General expenses and payroll use the exact column layout of the
// official forms 5.6 and 5.7 (bilingual headers, numbered columns), built
// with ExcelJS; the other sections are ReportDoc sections.
// Amounts are SAR, excl. VAT (the Film Commission's basis), as stored.
// ═══════════════════════════════════════════════════════════════════
import type ExcelJSNS from "exceljs";
import i18n from "@/lib/i18n";
import { regionSlug } from "@/lib/ksa-regions";
import { loadExcelJs } from "@/lib/lazy-export-libs";
import { excelDateFormat, toExcelDate } from "@/lib/date-format";
import {
  buildReportWorkbook,
  exportReportPdf,
  exportReportXlsx,
  saveBrandedWorkbook,
  addWorkbookLogo,
  type ReportCell,
  type ReportDoc,
  type ReportSection,
} from "@/lib/export/xlsx-report";
import { EXCEL_MONEY_FORMAT } from "@/lib/export/number-format";
import { formRows, sumBy } from "./rebate-calc";
import type {
  FilmCommissionRebate,
  GeneralExpenseRow,
  PayrollRow57,
  RebateSection,
} from "./rebate-types";

const t = (k: string, o?: Record<string, unknown>) => i18n.t(`rebate.${k}`, o) as string;
const REPORT = "Film Commission Rebate";
const yesNo = (v: boolean | null | undefined) =>
  v == null ? t("answer_missing") : v ? t("yes") : t("no");
const label = (group: string, key: string | null | undefined) =>
  key ? (i18n.t(`rebate.${group}.${key}`, { defaultValue: key }) as string) : "";
const flagsText = (flags: readonly string[] | undefined) =>
  (flags ?? []).map((f) => label("flag", f)).join("; ");

export const sectionTitle = (s: RebateSection) => t(`section.${s}`);

// ── ReportDoc sections (everything except the two official forms) ────

function summarySection(d: FilmCommissionRebate): ReportSection {
  const s = d.summary;
  const st = d.settings;
  const rows: ReportCell[][] = s
    ? [
        [t("sum.qpe_budget"), s.qpe_budget],
        [t("sum.rate"), s.rebate_rate_pct ?? null],
        [t("sum.cap"), s.rebate_cap_sar ?? null],
        [t("sum.expected_rebate"), s.expected_rebate ?? null],
        [t("sum.qpe_contracted"), s.qpe_contracted],
        [t("sum.expected_rebate_contracts"), s.expected_rebate_contracts ?? null],
        [t("sum.qpe_actual"), s.qpe_actual],
        [t("sum.qpe_paid"), s.qpe_paid],
        [t("sum.qpe_claimable"), s.qpe_claimable],
        [t("sum.claimable_rebate"), s.claimable_rebate ?? null],
        [t("sum.paid_undocumented"), s.paid_undocumented],
        [t("sum.needs_review"), s.needs_review_total],
        [t("sum.not_eligible"), s.not_eligible_total],
        [t("sum.cash_total"), s.cash_total],
        [t("sum.cash_pct"), s.cash_pct_of_qpe ?? null],
        [t("sum.cash_limit_pct"), s.cash_limit_pct_of_qpe ?? null],
        [t("sum.shoot_days"), s.shoot_days],
      ]
    : [];
  const notes = [
    st?.fc_agreement_no ? `${t("set.agreement_no")}: ${st.fc_agreement_no}` : null,
    st?.production_period_from && st?.production_period_to
      ? `${t("set.period")}: ${st.production_period_from} → ${st.production_period_to}`
      : null,
    s?.settings_approved ? t("sum.settings_approved") : t("sum.settings_not_approved"),
    t("basis_note"),
  ].filter((x): x is string => !!x);
  return {
    title: sectionTitle("summary"),
    notes,
    columns: [
      { header: t("col.item"), width: 44 },
      { header: t("col.value_sar"), type: "money" },
    ],
    rows,
  };
}

function budgetSections(d: FilmCommissionRebate): ReportSection[] {
  const b = d.budget;
  const groups = b?.by_group ?? [];
  return [
    {
      title: sectionTitle("budget"),
      notes: [t("variance_note")],
      columns: [
        { header: t("col.group") },
        { header: t("col.budget_total"), type: "money" },
        { header: t("col.budget_qpe"), type: "money" },
        { header: t("col.actual_total"), type: "money" },
        { header: t("col.actual_qpe"), type: "money" },
        { header: t("col.variance_qpe"), type: "money" },
      ],
      rows: groups.map((g) => [
        label("group", g.group),
        g.budget_total,
        g.budget_qpe,
        g.actual_total,
        g.actual_qpe,
        g.variance_qpe,
      ]),
      totals: [
        [
          t("total"),
          sumBy(groups, (g) => g.budget_total),
          sumBy(groups, (g) => g.budget_qpe),
          sumBy(groups, (g) => g.actual_total),
          sumBy(groups, (g) => g.actual_qpe),
          sumBy(groups, (g) => g.variance_qpe),
        ],
      ],
    },
    {
      title: t("budget_by_region"),
      columns: [
        { header: t("col.region") },
        { header: i18n.t("decisions.region.estimate"), type: "money" },
        { header: t("col.actual_total"), type: "money" },
        { header: t("col.actual_qpe"), type: "money" },
        { header: i18n.t("decisions.region.variance"), type: "money" },
      ],
      rows: (b?.by_region ?? []).map((r) => [
        r.region === "unassigned"
          ? t("region_unassigned")
          : r.region === "outside_ksa"
            ? i18n.t("decisions.region.outside_ksa")
            : (i18n.t(`decisions.region.${regionSlug(r.region)}`, {
                defaultValue: r.region,
              }) as string),
        r.estimate ?? 0,
        r.actual_total ?? 0,
        r.actual_qpe ?? 0,
        r.variance ?? 0,
      ]),
    },
  ];
}

function headcountSection(d: FilmCommissionRebate): ReportSection {
  const h = d.headcount;
  return {
    title: sectionTitle("headcount"),
    columns: [
      { header: t("col.item"), width: 40 },
      { header: t("col.count"), type: "integer" },
    ],
    rows: h
      ? [
          [t("hc.total"), h.total],
          [t("hc.crew"), h.crew],
          [t("hc.cast"), h.cast],
          [t("hc.saudi"), h.saudi],
          [t("hc.saudi_crew"), h.saudi_crew],
          [t("hc.saudi_cast"), h.saudi_cast],
          [t("hc.saudi_trainees"), h.saudi_trainees],
          [t("hc.nationality_missing"), h.nationality_missing],
        ]
      : [],
  };
}

function eligibilitySection(d: FilmCommissionRebate): ReportSection {
  const rows = d.eligibility_log ?? [];
  return {
    title: sectionTitle("eligibility_log"),
    columns: [
      { header: t("col.ref") },
      { header: t("col.source") },
      { header: t("col.date"), type: "date" },
      { header: t("col.party"), width: 26 },
      { header: t("col.nationality") },
      { header: t("col.budget_code") },
      { header: t("col.category"), width: 26 },
      { header: t("col.mapping") },
      { header: t("col.status") },
      { header: t("col.reason"), width: 34 },
      { header: t("col.override"), width: 30 },
      { header: t("col.amount_excl_vat"), type: "money" },
      { header: t("col.actual"), type: "money" },
      { header: t("col.paid"), type: "money" },
      { header: t("col.claimable"), type: "money" },
      { header: t("col.flags"), width: 34 },
    ],
    rows: rows.map((r) => [
      r.ref_no ?? r.doc_no ?? "",
      label("source", r.source),
      r.date ?? null,
      r.party ?? "",
      r.nationality ?? "",
      r.budget_code ?? "",
      label("cat", r.qpe_category),
      label("mapping_status", r.mapping_status),
      label("status", r.status),
      label("reason", r.reason),
      r.override_reason
        ? `${r.override_reason}${r.override_by_name ? ` — ${r.override_by_name}` : ""}`
        : "",
      r.amount_excl_vat,
      r.actual_excl,
      r.paid,
      r.claimable_excl,
      flagsText(r.flags),
    ]),
    totals: [
      [
        t("total"),
        "",
        null,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        sumBy(rows, (r) => r.amount_excl_vat),
        sumBy(rows, (r) => r.actual_excl),
        sumBy(rows, (r) => r.paid),
        sumBy(rows, (r) => r.claimable_excl),
        "",
      ],
    ],
  };
}

function relatedSection(d: FilmCommissionRebate): ReportSection {
  const rows = d.related_parties ?? [];
  return {
    title: sectionTitle("related_parties"),
    notes: [t("related_note")],
    columns: [
      { header: t("col.name"), width: 28 },
      { header: t("col.party_type") },
      { header: t("col.nationality") },
      { header: t("col.relation"), width: 30 },
      { header: t("col.transaction_type") },
      { header: t("col.total_value"), type: "money" },
      { header: t("col.count"), type: "integer" },
    ],
    rows: rows.map((r) => [
      r.name,
      label("party_type", r.party_type),
      r.nationality ?? "",
      r.relation ?? "",
      (r.transaction_types ?? "")
        .split(", ")
        .map((s) => label("source", s))
        .join(", "),
      r.total_value,
      r.transactions,
    ]),
  };
}

function documentsSection(d: FilmCommissionRebate): ReportSection {
  const rows = d.documents ?? [];
  return {
    title: sectionTitle("documents"),
    columns: [
      { header: t("col.ref") },
      { header: t("col.source") },
      { header: t("col.party"), width: 26 },
      { header: t("col.status") },
      { header: t("doc.source_document") },
      { header: t("doc.payment_proof") },
      { header: t("doc.id_document") },
      { header: t("doc.vendor_cr") },
      { header: t("doc.bank_refs") },
      { header: t("doc.complete") },
      { header: t("col.flags"), width: 34 },
    ],
    rows: rows.map((r) => [
      r.ref_no ?? r.doc_no ?? "",
      label("source", r.source),
      r.party ?? "",
      label("status", r.status),
      yesNo(r.source_document),
      yesNo(r.payment_proof),
      r.id_document == null ? "" : yesNo(r.id_document),
      r.vendor_cr ?? "",
      r.bank_refs ?? "",
      yesNo(r.documented),
      flagsText(r.flags),
    ]),
  };
}

function changeText(changes: Record<string, { from?: unknown; to?: unknown }> | null | undefined) {
  if (!changes) return "";
  return Object.entries(changes)
    .map(([k, v]) => {
      const f = v && typeof v === "object" && "from" in v ? JSON.stringify(v.from ?? "") : "";
      const to = v && typeof v === "object" && "to" in v ? JSON.stringify(v.to ?? "") : "";
      return `${k}: ${f} → ${to}`;
    })
    .join("; ");
}

function changeLogSection(d: FilmCommissionRebate): ReportSection {
  const rows = d.change_log ?? [];
  return {
    title: sectionTitle("change_log"),
    columns: [
      { header: t("col.date"), type: "date" },
      { header: t("col.area") },
      { header: t("col.action") },
      { header: t("col.subject"), width: 26 },
      { header: t("col.changes"), width: 50 },
      { header: t("col.user") },
      { header: t("col.reason"), width: 30 },
    ],
    rows: rows.map((r) => [
      r.changed_at,
      label("area", r.area),
      label("op", r.operation),
      r.subject ?? "",
      changeText(r.changes),
      r.user_name ?? "",
      r.reason ?? "",
    ]),
  };
}

/** Generic (non-form) sections, by key. */
export function genericSections(d: FilmCommissionRebate, s: RebateSection): ReportSection[] {
  switch (s) {
    case "summary":
      return [summarySection(d)];
    case "budget":
      return budgetSections(d);
    case "headcount":
      return [headcountSection(d)];
    case "eligibility_log":
      return [eligibilitySection(d)];
    case "related_parties":
      return [relatedSection(d)];
    case "documents":
      return [documentsSection(d)];
    case "change_log":
      return [changeLogSection(d)];
    default:
      return [];
  }
}

// ── Official forms 5.6 / 5.7 (exact column layout) ───────────────────

const FORM_NAVY = "FF1F3A5F";
const FORM_BAND = "FFFDEADA";
const FORM_BAND2 = "FFEBF1DE";
const FORM_TEXT = "FF1E293B";
const FORM_BORDER = "FFB8BCC4";

type Band = { title: string; span: number; fill?: string };

const GE_BANDS: Band[] = [
  { title: "#", span: 1 },
  {
    title:
      "A) Item Classification as per Incentive Agreement\nتصنيف البند وفق وثيقة شروط وأحكام تقديم الحوافز المالية",
    span: 3,
    fill: FORM_BAND,
  },
  {
    title: "B) Expense Contractual documents - المستندات التعاقدية للمصروف",
    span: 5,
    fill: FORM_BAND2,
  },
  { title: "C) Invoice - الفاتورة", span: 6, fill: FORM_BAND },
  {
    title: "D) Date of service or equipment delivery\nتاريخ استلام الخدمة /المعدات",
    span: 1,
    fill: FORM_BAND2,
  },
  { title: "E) Payment- الدفع", span: 5, fill: FORM_BAND },
  { title: "Supporting Documents Reference\nمرجع الوثائق الثبوتية", span: 1, fill: FORM_BAND2 },
];
const GE_HEADERS = [
  "#",
  "QPE Type\nبند المصروف المؤهل",
  "QPE Description\nوصف المصروف المؤهل",
  "Budget Line item\nالتصنيف وفق الميزانية المعتمدة",
  "Supplier / Service Provider Name\nأسم المورد / مقدم الخدمة",
  "Supplier / Service Provide Nationality\nجنسية المورد / مقدم الخدمة",
  "Contract / PO No.\nرقم أمر الشراء / العقد",
  "PO / Contract Total Amount SAR\nإجمالي قيمة أمر الشراء / العقد بالريال السعودي",
  "هل يصنف المورد / مقدم الخدمة على أنه طرف ذات علاقة (نعم أو لا)",
  "Invoice N0.\nرقم الفاتورة",
  "Invoice Date\nتاريخ الفاتورة",
  "Currency\nالعملة",
  "SAR Value Without VAT\nالقيمة بالريال السعودي بدون ضريبة",
  "VAT\nالضريبة",
  "SAR Total Amount\nإجمالي القيمة بالريال السعودي",
  "Date of service or equipment delivery\nتاريخ استلام الخدمة /المعدات",
  "Amount paid\nالمبلغ المدفوع",
  "Payment Method (Cash - Cheque - Transfer)\nطريقة الدفع (نقدي - شيك - تحويل)",
  "Number of Payments\nعدد الدفعات",
  "الرقم المرجعي للحوالة البنكية\nBank transfer reference number",
  "Date of payment\nتاريخ الدفع",
  "Supporting Documents Reference\nمرجع الوثائق الثبوتية",
];
const GE_WIDTHS = [
  5, 24, 30, 20, 26, 16, 18, 18, 14, 16, 13, 9, 16, 12, 16, 14, 14, 16, 10, 20, 13, 20,
];
const GE_MONEY = [8, 13, 14, 15, 17];
const GE_DATES = [11, 16, 21];

const PR_BANDS: Band[] = [
  { title: "#", span: 1 },
  { title: "A) Crew Members Details - بيانات أعضاء طاقم العمل", span: 8, fill: FORM_BAND },
  { title: "B) Working on Film Period", span: 3, fill: FORM_BAND2 },
  { title: "D) Payroll - الراتب", span: 9, fill: FORM_BAND },
  { title: "E) Payment- الدفع", span: 6, fill: FORM_BAND2 },
  { title: "Supporting Documents Reference\nمرجع الوثائق الثبوتية", span: 1, fill: FORM_BAND },
];
const PR_HEADERS = [
  "#",
  "Crew member No\nرقم عضو طاقم العمل",
  "Name\nالاسم",
  "Position / Role In Project\nالدور في المشروع",
  "Nationality\nالجنسية",
  "ID No.\nرقم الهوية / الإقامة/جواز سفر (للأجانب الغير مقيمين)",
  "Supplier / Service Provider name (If applicable)\nاسم المورد / مقدم الخدمة (إن وجد)",
  "Invoice Number (If applicable)\nرقم الفاتورة (إن وجد)",
  "هل يصنف عضو طاقم العمل على أنه طرف ذات علاقة (نعم أو لا)",
  "From\nبداية من",
  "To\nحتى",
  "Total Working Days\nإجمالي عدد أيام العمل",
  "Basic Salary\nقيمة الراتب الأساسي",
  "Housing Allowance\nقيمة بدل السكن",
  "Transportation Allowance\nقيمة بدل مواصلات",
  "Telephone Allowance\nقيمة بدل هاتف",
  "Other Allowances\nقيمة أي بدلات أخرى",
  "Over time\nقيمة العمل الإضافي",
  "Per-diem\nقيمة المياومات",
  "Total Salary\nإجمالي قيمة الراتب",
  "Total salary paid for the period of work on the film\nإجمالي الراتب المدفوع طوال فترة العمل على الفيلم",
  "Amount paid\nالمبلغ المدفوع",
  "Payment Method (Cash - Cheque - Transfer)\nطريقة الدفع (نقدي - شيك - تحويل)",
  "Bank account number or IBAN\nرقم الحساب البنكي أو رقم الآيبان",
  "Number of Payments\nعدد الدفعات",
  "الرقم المرجعي للحوالة البنكية\nBank transfer reference number",
  "Date of payment\nتاريخ الدفع",
  "Supporting Documents Reference\nمرجع الوثائق الثبوتية",
];
const PR_WIDTHS = [
  5, 16, 24, 20, 14, 18, 20, 14, 14, 12, 12, 10, 14, 12, 12, 12, 12, 12, 12, 14, 16, 14, 16, 26, 10,
  20, 13, 20,
];
const PR_MONEY = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const PR_DATES = [10, 11, 27];

/** Payment method in the form's words (Cash - Cheque - Transfer). */
export function formPaymentMethod(methods: string | null | undefined): string {
  if (!methods) return "";
  const map: Record<string, string> = {
    Cash: "Cash - نقدي",
    Check: "Cheque - شيك",
    Transfer: "Transfer - تحويل",
    Bank: "Transfer - تحويل",
    Card: "Card - بطاقة",
  };
  return [
    ...new Set(
      methods
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
        .map((m) => map[m] ?? m),
    ),
  ].join(", ");
}

const nationalityText = (n: string | null | undefined, motherSaudi?: boolean | null) =>
  [n ?? "", motherSaudi ? t("mother_saudi_short") : ""].filter(Boolean).join(" — ");

/** Rows of form 5.6, in the form's 22 columns (# + 21). */
export function generalExpenseFormRows(rows: readonly GeneralExpenseRow[]): ReportCell[][] {
  return rows.map((r, i) => [
    i + 1,
    label("cat", r.qpe_category),
    r.description ?? "",
    r.budget_code ?? "",
    r.supplier ?? "",
    r.supplier_nationality ?? "",
    r.po_ref ?? "",
    r.po_total ?? null,
    r.related_party ? "نعم - Yes" : "لا - No",
    r.invoice_no ?? "",
    r.invoice_date ?? null,
    r.currency ?? "SAR",
    r.amount_excl_vat,
    r.vat_amount,
    r.amount_total,
    r.delivery_date ?? null,
    r.paid,
    formPaymentMethod(r.payment_methods),
    r.payments_count,
    r.bank_refs ?? "",
    r.payment_date ?? null,
    r.ref_no ?? "",
  ]);
}

/** Rows of form 5.7, in the form's 28 columns (# + 27). */
export function payrollFormRows(rows: readonly PayrollRow57[]): ReportCell[][] {
  return rows.map((r, i) => [
    i + 1,
    r.crew_no ?? "",
    r.name,
    r.position ?? "",
    nationalityText(r.nationality, r.mother_saudi),
    r.id_number ?? "",
    "",
    "",
    r.related_party == null ? t("answer_missing") : r.related_party ? "نعم - Yes" : "لا - No",
    r.from ?? null,
    r.to ?? null,
    r.working_days ?? null,
    r.basic,
    r.housing,
    r.transport,
    r.telephone,
    r.other_allowances,
    r.overtime,
    r.per_diem,
    r.total_salary,
    r.paid,
    r.paid,
    formPaymentMethod(r.payment_methods),
    r.iban ?? "",
    r.payments_count,
    r.bank_refs ?? "",
    r.payment_date ?? null,
    r.crew_no ?? "",
  ]);
}

function border() {
  const s = { style: "thin" as const, color: { argb: FORM_BORDER } };
  return { top: s, left: s, bottom: s, right: s };
}

function writeFormSheet(
  wb: ExcelJSNS.Workbook,
  opts: {
    name: string;
    title: string;
    projectName: string;
    companyName: string;
    bands: Band[];
    headers: string[];
    widths: number[];
    money: number[];
    dates: number[];
    rows: ReportCell[][];
    totalsLabelCol: number;
    rtl: boolean;
    logoDataUrl?: string | null;
  },
): ExcelJSNS.Worksheet {
  const ws = wb.addWorksheet(opts.name.slice(0, 31), {
    views: [{ rightToLeft: opts.rtl, showGridLines: false, state: "frozen", ySplit: 7 }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  const n = opts.headers.length;
  ws.columns = opts.widths.map((w) => ({ width: w }));
  // Row 1: form title; rows 2-3: project / production company (as on the form)
  ws.mergeCells(1, 1, 1, n);
  const title = ws.getCell(1, 1);
  title.value = opts.title;
  title.font = { bold: true, size: 14, color: { argb: FORM_NAVY } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;
  ws.getCell(2, 2).value = `Project Name - أسم المشروع: ${opts.projectName}`;
  ws.getCell(3, 2).value = `Production Company Name - أسم شركة الإنتاج: ${opts.companyName}`;
  ws.getCell(2, 2).font = ws.getCell(3, 2).font = { bold: true, color: { argb: FORM_TEXT } };
  // Client logo in the free block at the end of rows 2-4 (G02); the form's
  // own cell layout is unchanged.
  addWorkbookLogo(wb, opts.logoDataUrl ?? null, {
    col: Math.max(2, n - 2),
    row: 1,
    maxWidth: 140,
    maxHeight: 48,
    sheets: [ws.name],
  });
  // Row 5 bands, row 6 headers, row 7 column numbers
  let col = 1;
  for (const b of opts.bands) {
    if (b.span > 1) ws.mergeCells(5, col, 5, col + b.span - 1);
    const c = ws.getCell(5, col);
    c.value = b.title;
    c.font = { bold: true, size: 10, color: { argb: FORM_TEXT } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    for (let k = 0; k < b.span; k++) {
      const cc = ws.getCell(5, col + k);
      cc.border = border();
      cc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: b.fill ?? "FFF2F2F2" } };
    }
    col += b.span;
  }
  ws.getRow(5).height = 36;
  opts.headers.forEach((h, i) => {
    const c = ws.getCell(6, i + 1);
    c.value = h;
    c.font = { bold: true, size: 9, color: { argb: FORM_TEXT } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = border();
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FORM_BAND } };
    const num = ws.getCell(7, i + 1);
    num.value = i === 0 ? null : i;
    num.font = { size: 9, color: { argb: FORM_TEXT } };
    num.alignment = { horizontal: "center" };
    num.border = border();
    num.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FORM_BAND } };
  });
  ws.getRow(6).height = 64;
  const dateFmt = excelDateFormat();
  const totals: Record<number, number> = {};
  opts.rows.forEach((r, ri) => {
    const row = ws.getRow(8 + ri);
    r.forEach((v, ci) => {
      const c = row.getCell(ci + 1);
      const colNo = ci + 1;
      if (opts.dates.includes(colNo) && typeof v === "string") {
        c.value = toExcelDate(v);
        c.numFmt = dateFmt;
      } else {
        c.value = v ?? null;
      }
      if (opts.money.includes(colNo)) {
        c.numFmt = EXCEL_MONEY_FORMAT;
        totals[colNo] = (totals[colNo] ?? 0) + (Number(v) || 0);
      }
      c.border = border();
      c.font = { size: 10 };
      c.alignment = { vertical: "middle", wrapText: !opts.money.includes(colNo) };
    });
  });
  const tr = ws.getRow(8 + opts.rows.length);
  tr.getCell(opts.totalsLabelCol).value = "الإجمالي - Total";
  for (let i = 1; i <= n; i++) {
    const c = tr.getCell(i);
    c.font = { bold: true, size: 10, color: { argb: FORM_NAVY } };
    c.border = border();
    if (totals[i] !== undefined) {
      c.value = Math.round(totals[i] * 100) / 100;
      c.numFmt = EXCEL_MONEY_FORMAT;
    }
  }
  return ws;
}

type FormContext = {
  projectName: string;
  companyName: string;
  rtl: boolean;
  logoDataUrl?: string | null;
};

async function formContext(): Promise<FormContext> {
  const [{ getExportBranding }, { isRtlUi }] = await Promise.all([
    import("@/lib/export/branding"),
    import("@/lib/export/pdf-core"),
  ]);
  const b = await getExportBranding();
  return {
    projectName: [b.projectCode, b.projectName].filter(Boolean).join(" — "),
    companyName: b.companyName,
    rtl: isRtlUi(),
    logoDataUrl: b.logoDataUrl,
  };
}

function addGeneralExpensesForm(
  wb: ExcelJSNS.Workbook,
  d: FilmCommissionRebate,
  ctx: FormContext,
  includeAll: boolean,
) {
  return writeFormSheet(wb, {
    name: sectionTitle("general_expenses"),
    title: "General Expenses Data Gathering Sheet — سجل المصروفات (5.6)",
    ...ctx,
    bands: GE_BANDS,
    headers: GE_HEADERS,
    widths: GE_WIDTHS,
    money: GE_MONEY,
    dates: GE_DATES,
    rows: generalExpenseFormRows(formRows(d.general_expenses ?? [], includeAll)),
    totalsLabelCol: 2,
  });
}

function addPayrollForm(
  wb: ExcelJSNS.Workbook,
  d: FilmCommissionRebate,
  ctx: FormContext,
  includeAll: boolean,
) {
  return writeFormSheet(wb, {
    name: sectionTitle("payroll"),
    title: "Payroll and Wages Data Gathering Sheet — سجل مصروفات الرواتب والأجور (5.7)",
    ...ctx,
    bands: PR_BANDS,
    headers: PR_HEADERS,
    widths: PR_WIDTHS,
    money: PR_MONEY,
    dates: PR_DATES,
    rows: payrollFormRows(formRows(d.payroll ?? [], includeAll)),
    totalsLabelCol: 3,
  });
}

/** The same rows as the form, as a ReportDoc section (used for PDF). */
function formAsSection(
  d: FilmCommissionRebate,
  s: "general_expenses" | "payroll",
  includeAll: boolean,
): ReportSection {
  if (s === "general_expenses") {
    const rows = formRows(d.general_expenses ?? [], includeAll);
    return {
      title: sectionTitle(s),
      columns: GE_HEADERS.map((h, i) => ({
        header: h.split("\n")[0],
        type: GE_MONEY.includes(i + 1) ? "money" : GE_DATES.includes(i + 1) ? "date" : undefined,
      })),
      rows: generalExpenseFormRows(rows),
    };
  }
  const rows = formRows(d.payroll ?? [], includeAll);
  return {
    title: sectionTitle(s),
    columns: PR_HEADERS.map((h, i) => ({
      header: h.split("\n")[0],
      type: PR_MONEY.includes(i + 1) ? "money" : PR_DATES.includes(i + 1) ? "date" : undefined,
    })),
    rows: payrollFormRows(rows),
  };
}

function docFor(sections: ReportSection[], title: string, layout: "stacked" | "sheets"): ReportDoc {
  return {
    report: REPORT,
    title: `${t("title")} — ${title}`,
    subtitle: t("basis_note"),
    sections,
    layout,
  };
}

/** Export ONE section (Excel or PDF). */
export async function exportRebateSection(
  d: FilmCommissionRebate,
  s: RebateSection,
  kind: "excel" | "pdf",
  opts: { includeAll?: boolean } = {},
): Promise<string> {
  const includeAll = !!opts.includeAll;
  if (s === "general_expenses" || s === "payroll") {
    if (kind === "pdf") {
      return exportReportPdf(
        docFor([formAsSection(d, s, includeAll)], sectionTitle(s), "stacked"),
        {
          compact: true,
        },
      );
    }
    const ExcelJS = await loadExcelJs();
    const wb = new ExcelJS.Workbook();
    const ctx = await formContext();
    if (s === "general_expenses") addGeneralExpensesForm(wb, d, ctx, includeAll);
    else addPayrollForm(wb, d, ctx, includeAll);
    return saveBrandedWorkbook(
      wb,
      `${REPORT} ${sectionTitle(s)}`,
      `${t("title")} — ${sectionTitle(s)}`,
    );
  }
  const doc = docFor(genericSections(d, s), sectionTitle(s), "stacked");
  return kind === "excel" ? exportReportXlsx(doc) : exportReportPdf(doc);
}

/** All sections in ONE workbook — one sheet per section, forms in their official layout. */
export async function exportRebateWorkbook(
  d: FilmCommissionRebate,
  opts: { includeAll?: boolean } = {},
): Promise<string> {
  const [{ getExportBranding }, { isRtlUi }] = await Promise.all([
    import("@/lib/export/branding"),
    import("@/lib/export/pdf-core"),
  ]);
  const ExcelJS = await loadExcelJs();
  const b = await getExportBranding();
  const rtl = isRtlUi();
  const order: RebateSection[] = [
    "summary",
    "general_expenses",
    "payroll",
    "budget",
    "headcount",
    "eligibility_log",
    "related_parties",
    "documents",
    "change_log",
  ];
  const generic = order.flatMap((s) => genericSections(d, s));
  const wb = buildReportWorkbook(ExcelJS, docFor(generic, t("all_sections"), "sheets"), b, { rtl });
  const ctx: FormContext = {
    projectName: [b.projectCode, b.projectName].filter(Boolean).join(" — "),
    companyName: b.companyName,
    rtl,
    logoDataUrl: b.logoDataUrl,
  };
  const ge = addGeneralExpensesForm(wb, d, ctx, !!opts.includeAll);
  const pr = addPayrollForm(wb, d, ctx, !!opts.includeAll);
  // Summary first, then the two forms, then the rest.
  const sheets = wb.worksheets.filter((w) => w !== ge && w !== pr);
  [sheets[0], ge, pr, ...sheets.slice(1)].forEach((w, i) => {
    if (w) (w as unknown as { orderNo: number }).orderNo = i + 1;
  });
  return saveBrandedWorkbook(wb, REPORT, t("title"));
}

/** All sections in ONE PDF (forms as tables, compact font). */
export async function exportRebatePdfAll(
  d: FilmCommissionRebate,
  opts: { includeAll?: boolean } = {},
): Promise<string> {
  const includeAll = !!opts.includeAll;
  const sections: ReportSection[] = [
    ...genericSections(d, "summary"),
    formAsSection(d, "general_expenses", includeAll),
    formAsSection(d, "payroll", includeAll),
    ...(
      [
        "budget",
        "headcount",
        "eligibility_log",
        "related_parties",
        "documents",
        "change_log",
      ] as const
    ).flatMap((s) => genericSections(d, s)),
  ];
  return exportReportPdf(docFor(sections, t("all_sections"), "stacked"), { compact: true });
}
