// Saudi Film Commission — QFE Ledger builder.
// Shared between the audit-facing table view (Reports → Rebate) and the
// Excel export so both surfaces render an identical transaction-level trail.

import type {
  Invoice,
  PayrollRow,
  Payment,
  CashAdvanceReceipt,
  Person,
  PurchaseOrder,
  Vendor,
} from "./store";
import { getSupportingDocUrl } from "./supporting-docs";
import { explainAutoQfe, type QfeRule } from "./qfe-rules";

export type PaymentDetail = {
  label: string;
  amount: number;
  date?: string;
  method?: string;
  reference?: string;
};

export type QfeLedgerRow = {
  id: string;
  sourceId: string;
  kind: "Invoice" | "Payroll" | "Petty Cash";
  ref: string;
  party: string;
  /** Official CR / VAT / National ID / Iqama — for auditor identity trace. */
  officialId: string;
  group: string;
  qpeType: string;
  /** Budget category / section (e.g. Locations, Picture Vehicles, Set Design). */
  category: string;
  docUrl: string;
  invoiceDate: string;
  amountExVat: number;
  vatAmount: number;
  amount: number; // total incl VAT
  supplierNationality: string;
  supplierStatus: "Local (KSA)" | "Foreign";
  qfe: boolean;
  /** Which QFE rule the engine applied (A/B/C), if the row is auto-computed. */
  qfeRule: QfeRule | null;
  /** Human-readable justification for the QFE decision. */
  qfeReason: string;
  /** True when the invoice's QFE value was set manually, overriding the rules engine. */
  qfeManualOverride: boolean;
  /** Column label for exports: "Rule A" / "Rule B" / "Rule C" / "Manual Override". */
  qfeRuleApplied: string;
  poRef?: string;
  budgetCode?: string;
  department?: string;
  description?: string;
  paidTotal: number;
  balance: number;
  paymentStatus: "Paid" | "Partially Paid" | "Unpaid";
  paymentHistory: PaymentDetail[];
};

const NON_QFE_RE = /international|travel|import|foreign|abroad|non-?qpe|non-?qfe/i;

const isForeignNationality = (n?: string | null) =>
  !!n && n.trim().length > 0 && n.toLowerCase() !== "saudi arabia" && n.toLowerCase() !== "saudi";

export function classifyQpeType(
  text: string,
  kind: QfeLedgerRow["kind"],
  payrollKind?: string,
): string {
  const t = (text || "").toLowerCase();
  if (kind === "Payroll") {
    if (payrollKind === "cast") return "Cast Fees (Local)";
    return "Crew Wages (Local)";
  }
  const rules: [RegExp, string][] = [
    [/camera|lens|arri|red\s|sony\s|dop\b|dp\b/, "Camera Equipment Rental"],
    [/light|grip|gaffer|hmi|kino|dimmer/, "Lighting & Grip Rental"],
    [/set|art\s*dep|construction|carpent|paint|scenic|props?/, "Set Construction & Art Department"],
    [/wardrobe|costume|tailor|makeup|hair|sfx\s*makeup/, "Wardrobe, Hair & Makeup"],
    [/transport|vehicle|car\s*rent|driver|fuel|logistics/, "Transportation & Vehicles"],
    [/location|permit|scout|fee\b/, "Location Fees & Permits"],
    [/hotel|accommod|lodging|villa|apartment/, "Accommodation (KSA)"],
    [/cater|craft|meal|food|coffee/, "Catering & Craft Services"],
    [
      /edit|colou?r|grade|vfx|visual\s*effect|post[-\s]?prod|di\b|sound\s*mix|foley|adr/,
      "Post-Production Services",
    ],
    [/music|composer|score|licen[cs]e/, "Music & Sound Licensing"],
    [/insur|legal|law|counsel|clearance/, "Insurance & Legal"],
    [/production\s*service|line\s*producer|prod\s*co|fixer/, "Local Production Services"],
    [/office|stationery|supplies|misc/, "Office & Production Supplies"],
  ];
  for (const [re, label] of rules) if (re.test(t)) return label;
  return "Other Qualifying Services";
}

export function buildQfeLedger(input: {
  invoices: Invoice[];
  payroll: PayrollRow[];
  receipts: CashAdvanceReceipt[];
  people: Person[];
  payments: Payment[];
  purchaseOrders: PurchaseOrder[];
  vendors?: Vendor[];
}): QfeLedgerRow[] {
  const { invoices, payroll, receipts, people, payments, purchaseOrders, vendors = [] } = input;
  const vendorByName = new Map<string, Vendor>(vendors.map((v) => [v.name.toLowerCase(), v]));
  const rows: QfeLedgerRow[] = [];

  const buildPayments = (
    sourceType: "invoice" | "payroll" | "receipt",
    sourceId: string,
  ): PaymentDetail[] =>
    payments
      .filter((p) => p.sourceType === sourceType && p.sourceId === sourceId)
      .map((p) => ({
        label: p.notes || p.method || "Payment",
        amount: Number(p.amount || 0),
        date: p.paymentDate,
        method: p.method,
        reference: p.proofPath ?? undefined,
      }));

  invoices.forEach((i) => {
    const desc = `${i.description ?? ""} ${i.department ?? ""} ${i.vendorName ?? ""}`;
    const vendor = i.vendorName ? vendorByName.get(i.vendorName.toLowerCase()) : undefined;
    const vendorNationality = vendor?.companyNationality?.trim() || "";
    const beneficiary = i.beneficiaryId ? people.find((pe) => pe.id === i.beneficiaryId) : null;
    // Run the same rules engine the Invoice UI uses so ledger + exports match.
    const explain = explainAutoQfe({
      serviceInsideKsa: i.serviceInsideKsa !== false,
      description: i.description,
      department: i.department,
      budgetCode: i.budgetCode,
      beneficiaryNationality: beneficiary?.nationality ?? null,
      vendorNationality: vendorNationality || null,
      isNonSaudiVendor: !!i.isNonSaudiVendor,
    });
    const manualOverride = !!i.rebateManualOverride;
    const qfe = manualOverride ? !!i.rebateEligible : explain.value;
    const qfeRule = manualOverride ? null : explain.rule;
    const qfeReason = manualOverride
      ? `Manual override — accountant set QFE = ${qfe ? "Yes" : "No"} (auto would have been ${explain.value ? "Yes" : "No"}: ${explain.reason})`
      : explain.reason;
    const qfeRuleApplied = manualOverride ? "Manual Override" : `Rule ${explain.rule}`;
    const foreignVendor = vendorNationality
      ? isForeignNationality(vendorNationality)
      : NON_QFE_RE.test(desc);
    const excl = Number(i.price || 0);
    const vat = i.vatable ? +(excl * 0.15).toFixed(2) : 0;
    const total = excl + vat;
    const relatedPo = purchaseOrders.find(
      (po) => po.vendorName === i.vendorName && po.budgetCode === i.budgetCode,
    );
    const invoicePayments = buildPayments("invoice", i.id);
    const legacyPaid =
      invoicePayments.length === 0
        ? total * (Math.max(0, Math.min(100, Number(i.paymentTerm ?? 0))) / 100)
        : 0;
    const paidTotal = invoicePayments.reduce((s, p) => s + p.amount, 0) + legacyPaid;
    const balance = Math.max(0, total - paidTotal);
    const officialId = [vendor?.crNo, vendor?.vatNo].filter(Boolean).join(" · ");
    rows.push({
      id: `inv-${i.id}`,
      sourceId: i.id,
      kind: "Invoice",
      ref: i.invoiceNo || i.id,
      party: i.vendorName ?? i.description ?? "—",
      officialId,
      group: i.department ?? i.budgetCode ?? "—",
      qpeType: classifyQpeType(desc, "Invoice"),
      category: i.department || i.budgetCode || classifyQpeType(desc, "Invoice"),
      docUrl: getSupportingDocUrl("invoice", i.id),
      invoiceDate: i.date ?? "",
      amountExVat: excl,
      vatAmount: vat,
      amount: total,
      supplierNationality: vendorNationality || (qfe ? "Saudi Arabia" : "Foreign / Non-KSA"),
      supplierStatus: foreignVendor ? "Foreign" : "Local (KSA)",
      qfe,
      qfeRule,
      qfeReason,
      qfeManualOverride: manualOverride,
      qfeRuleApplied,
      poRef: relatedPo?.poNumber ?? relatedPo?.id,
      budgetCode: i.budgetCode ?? undefined,
      department: i.department ?? undefined,
      description: i.description ?? undefined,
      paidTotal,
      balance,
      paymentStatus: balance < 0.005 ? "Paid" : paidTotal > 0.005 ? "Partially Paid" : "Unpaid",
      paymentHistory: invoicePayments,
    });
  });

  payroll.forEach((p) => {
    const person = people.find((pe) => pe.fullName === p.name);
    const foreign = isForeignNationality(person?.nationality);
    const qfe = !foreign && !NON_QFE_RE.test(`${p.name} ${p.kind}`);
    const total = Number(p.totalAmount || 0);
    const payHistory = buildPayments("payroll", p.id);
    const paidTotal = payHistory.reduce((s, x) => s + x.amount, 0);
    const balance = Math.max(0, total - paidTotal);
    rows.push({
      id: `pay-${p.id}`,
      sourceId: p.id,
      kind: "Payroll",
      ref: p.refId || p.id,
      party: p.name,
      officialId: person?.idNumber ?? "",
      group: p.kind === "cast" ? "ATL / Cast" : "BTL / Crew",
      qpeType: classifyQpeType(`${p.name}`, "Payroll", p.kind),
      category:
        p.kind === "cast"
          ? "Cast Payroll"
          : p.kind === "vendor"
            ? "Vendor Payroll"
            : "Crew Payroll",
      docUrl: getSupportingDocUrl("payroll", p.id),
      invoiceDate: "",
      amountExVat: total,
      vatAmount: 0,
      amount: total,
      supplierNationality: person?.nationality || (foreign ? "Foreign" : "Saudi Arabia"),
      supplierStatus: foreign ? "Foreign" : "Local (KSA)",
      qfe,
      qfeRule: "A",
      qfeReason: foreign
        ? `Rule A — Payroll follows beneficiary residency (${person?.nationality ?? "non-KSA"} — not eligible).`
        : `Rule A — Payroll follows beneficiary residency (${person?.nationality ?? "KSA"} — eligible).`,
      qfeManualOverride: false,
      qfeRuleApplied: "Rule A",
      budgetCode: p.budgetCode ?? undefined,
      description: p.name,
      paidTotal,
      balance,
      paymentStatus:
        balance < 0.005 && total > 0 ? "Paid" : paidTotal > 0.005 ? "Partially Paid" : "Unpaid",
      paymentHistory: payHistory,
    });
  });

  receipts.forEach((r) => {
    const desc = `${r.recipient ?? ""} ${r.department ?? ""}`;
    const qfe = !NON_QFE_RE.test(desc);
    const total = Number(r.amount || 0);
    rows.push({
      id: `pc-${r.id}`,
      sourceId: r.id,
      kind: "Petty Cash",
      ref: r.id,
      party: r.recipient ?? "—",
      officialId: "",
      group: r.department ?? r.budgetCode ?? "—",
      qpeType: classifyQpeType(desc, "Petty Cash"),
      category: r.department || r.budgetCode || "Petty Cash",
      docUrl: getSupportingDocUrl("receipt", r.id),
      invoiceDate: r.date ?? "",
      amountExVat: total,
      vatAmount: 0,
      amount: total,
      supplierNationality: "Saudi Arabia",
      supplierStatus: "Local (KSA)",
      qfe,
      qfeRule: "B",
      qfeReason: qfe
        ? "Rule B — Petty cash receipt for local (KSA) spend; eligible."
        : "Rule B — Petty cash tagged as travel/foreign/logistics keyword; not eligible.",
      qfeManualOverride: false,
      qfeRuleApplied: "Rule B",
      budgetCode: r.budgetCode ?? undefined,
      department: r.department ?? undefined,
      description: r.recipient ?? undefined,
      paidTotal: total,
      balance: 0,
      paymentStatus: "Paid",
      paymentHistory: [
        { label: "Petty cash receipt", amount: total, date: r.date, method: r.method },
      ],
    });
  });

  return rows;
}
