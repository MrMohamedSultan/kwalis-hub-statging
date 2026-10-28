// =====================================================================
// Tax Cash Impact (R23 / R24 / D14 / D15, decision 12) — pure calculations.
//
// The report is about CASH, not the tax return:
//   * WHT is read ONLY from the WHT amount stored on each contract / invoice
//     (never recomputed from a rate or a nationality). Σ WHT = Σ stored
//     fields. The rate shown is the stored rate, or amount ÷ base when only
//     the amount is stored (display only).
//   * WHT is withheld when the payee is paid (its share of each payment)
//     and is due to ZATCA by the 10th of the following month. Remittances
//     recorded on the Funding screen are allocated oldest due first.
//   * Decision 12: WHT is outside the budget, except company-borne WHT
//     (exclusive / gross-up) which is charged to budget line 7099.
//   * VAT: input VAT paid to suppliers by month, recovered from ZATCA,
//     pending recovery, forecast on open commitments × VAT rate, reverse
//     charge self-assessed on imported services.
// Amounts are SAR.
// =====================================================================

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export type WhtTreatment = "inclusive" | "exclusive";
/** pending = nothing paid to the payee yet · due / overdue = withheld, not remitted · remitted = all withheld so far remitted. */
export type WhtStatus = "pending" | "due" | "overdue" | "remitted";

export interface PaymentEvent {
  date: string; // ISO
  amount: number; // net paid to the payee
}

export interface WhtDocument {
  kind: "contract" | "invoice";
  id: string;
  ref: string;
  party: string;
  residency: "resident" | "non_resident" | null;
  serviceType: string | null;
  treatment: WhtTreatment;
  /** WHT base: contract value (gross) / invoice amount excl. VAT. */
  base: number;
  storedRate: number | null;
  storedAmount: number;
  /** What the payee receives on the whole document (base of the per-payment share). */
  payBasis: number;
  budgetCode: string | null;
  payments: PaymentEvent[];
}

export interface WhtEvent {
  docId: string;
  paymentDate: string;
  dueDate: string;
  amount: number;
}

export interface WhtRow extends WhtDocument {
  rate: number;
  amount: number;
  /** decision 12: company-borne (gross-up) WHT is a cost charged to the budget. */
  chargedToBudget: boolean;
  withheld: number;
  remitted: number;
  outstanding: number;
  lastPaymentDate: string | null;
  /** Earliest ZATCA due date still open (or the last one when all remitted). */
  dueDate: string | null;
  status: WhtStatus;
}

/** ZATCA: WHT withheld in a month is due by the 10th of the following month. */
export function zatcaWhtDueDate(paymentIso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(paymentIso);
  if (!m) return "";
  let y = Number(m[1]);
  let mo = Number(m[2]) + 1;
  if (mo > 12) {
    mo = 1;
    y += 1;
  }
  return `${y}-${String(mo).padStart(2, "0")}-10`;
}

/** Stored rate, else amount ÷ base (display only — the amount is never derived from it). */
export function displayRate(storedRate: number | null, amount: number, base: number): number {
  if (storedRate != null && storedRate > 0) return round2(storedRate);
  return base > 0 ? round2((amount / base) * 100) : 0;
}

/** WHT withheld on each payment: its share of the stored WHT (payment ÷ pay basis). */
export function whtEvents(doc: WhtDocument): WhtEvent[] {
  const amount = round2(num(doc.storedAmount));
  if (amount <= 0) return [];
  const basis = num(doc.payBasis);
  const sorted = [...doc.payments]
    .filter((p) => p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: WhtEvent[] = [];
  let taken = 0;
  for (const p of sorted) {
    const share = basis > 0 ? (num(p.amount) * amount) / basis : 0;
    const v = round2(Math.min(amount - taken, Math.max(0, share)));
    if (v <= 0) continue;
    taken = round2(taken + v);
    out.push({ docId: doc.id, paymentDate: p.date, dueDate: zatcaWhtDueDate(p.date), amount: v });
  }
  return out;
}

/** Allocate remitted WHT (Σ remittances up to today) to the events, oldest due date first. */
export function allocateRemittances(
  events: WhtEvent[],
  remittedTotal: number,
): Map<WhtEvent, number> {
  const out = new Map<WhtEvent, number>();
  let left = round2(Math.max(0, num(remittedTotal)));
  const sorted = [...events].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.paymentDate.localeCompare(b.paymentDate),
  );
  for (const e of sorted) {
    const v = round2(Math.min(left, e.amount));
    out.set(e, v);
    left = round2(left - v);
  }
  return out;
}

export function buildWhtRows(docs: WhtDocument[], remittedTotal: number, today: string): WhtRow[] {
  const withAmount = docs.filter((d) => round2(num(d.storedAmount)) > 0);
  const eventsByDoc = new Map(withAmount.map((d) => [d.id, whtEvents(d)]));
  const all = Array.from(eventsByDoc.values()).flat();
  const alloc = allocateRemittances(all, remittedTotal);
  return withAmount.map((d) => {
    const evs = eventsByDoc.get(d.id) ?? [];
    const amount = round2(num(d.storedAmount));
    const withheld = round2(evs.reduce((a, e) => a + e.amount, 0));
    const remitted = round2(evs.reduce((a, e) => a + (alloc.get(e) ?? 0), 0));
    const outstanding = round2(withheld - remitted);
    const open = evs.filter((e) => (alloc.get(e) ?? 0) < e.amount - 0.005);
    const dueDate = open[0]?.dueDate ?? evs[evs.length - 1]?.dueDate ?? null;
    let status: WhtStatus;
    if (outstanding > 0.005) status = open[0] && open[0].dueDate < today ? "overdue" : "due";
    else if (withheld > 0)
      status = "remitted"; // everything withheld so far is remitted
    else status = "pending";
    return {
      ...d,
      rate: displayRate(d.storedRate, amount, num(d.base)),
      amount,
      chargedToBudget: d.treatment === "exclusive",
      withheld,
      remitted,
      outstanding,
      lastPaymentDate: evs[evs.length - 1]?.paymentDate ?? null,
      dueDate,
      status,
    };
  });
}

export interface WhtSummary {
  total: number;
  companyBorne: number;
  deducted: number;
  withheld: number;
  remitted: number;
  outstanding: number;
  overdue: number;
  /** Budget of line 7099 and the company-borne WHT compared with it (decision 12). */
  budget7099: number;
  over7099: number;
  /** Company-borne WHT whose contract / invoice sits on another line (open decision). */
  companyBorneOnOtherLines: number;
}

export const WHT_BUDGET_CODE = "7099";

export function summarizeWht(rows: WhtRow[], budget7099: number): WhtSummary {
  const sum = (f: (r: WhtRow) => number) => round2(rows.reduce((a, r) => a + f(r), 0));
  const companyBorne = sum((r) => (r.chargedToBudget ? r.amount : 0));
  const b = round2(num(budget7099));
  return {
    total: sum((r) => r.amount),
    companyBorne,
    deducted: sum((r) => (r.chargedToBudget ? 0 : r.amount)),
    withheld: sum((r) => r.withheld),
    remitted: sum((r) => r.remitted),
    outstanding: sum((r) => r.outstanding),
    overdue: sum((r) => (r.status === "overdue" ? r.outstanding : 0)),
    budget7099: b,
    over7099: round2(Math.max(0, companyBorne - b)),
    companyBorneOnOtherLines: sum((r) =>
      r.chargedToBudget && !(r.budgetCode ?? "").startsWith(WHT_BUDGET_CODE) ? r.amount : 0,
    ),
  };
}

// ------------------------------------------------------------------- VAT

export type VatTreatment = "standard" | "zero_rated" | "exempt" | "reverse_charge";

export interface VatInvoice {
  id: string;
  ref: string;
  vendor: string;
  date: string | null;
  treatment: VatTreatment;
  net: number; // excl. VAT
  vat: number; // stored VAT amount
  /** What the vendor receives (excl. VAT + VAT − WHT): basis of the per-payment VAT share. */
  payBasis: number;
  payments: PaymentEvent[];
}

export interface VatMonth {
  month: string; // YYYY-MM
  inputPaid: number;
  reverseCharge: number;
}

export interface VatSummary {
  months: VatMonth[];
  inputBooked: number;
  inputPaid: number;
  inputUnpaid: number;
  reverseCharge: number;
  recovered: number;
  paidToZatca: number;
  /** Input VAT paid to suppliers and not recovered yet. */
  pendingRecovery: number;
  forecastOnCommitments: number;
  exemptCount: number;
  zeroRatedCount: number;
  standardCount: number;
}

export function vatPaidOn(inv: VatInvoice): PaymentEvent[] {
  const vat = num(inv.vat);
  const basis = num(inv.payBasis);
  if (vat <= 0 || basis <= 0) return [];
  let taken = 0;
  const out: PaymentEvent[] = [];
  for (const p of [...inv.payments].sort((a, b) => a.date.localeCompare(b.date))) {
    const v = round2(Math.min(vat - taken, (num(p.amount) * vat) / basis));
    if (v <= 0) continue;
    taken = round2(taken + v);
    out.push({ date: p.date, amount: v });
  }
  return out;
}

export function summarizeVat(
  invoices: VatInvoice[],
  movements: { vatPaid: number; vatRecovered: number },
  openCommitments: number,
  ratePct: number,
): VatSummary {
  const months = new Map<string, VatMonth>();
  const month = (iso: string) => {
    const k = iso.slice(0, 7);
    let m = months.get(k);
    if (!m) {
      m = { month: k, inputPaid: 0, reverseCharge: 0 };
      months.set(k, m);
    }
    return m;
  };
  let inputBooked = 0;
  let inputPaid = 0;
  let reverseCharge = 0;
  let exemptCount = 0;
  let zeroRatedCount = 0;
  let standardCount = 0;
  for (const inv of invoices) {
    if (inv.treatment === "exempt") exemptCount++;
    if (inv.treatment === "zero_rated") zeroRatedCount++;
    if (inv.treatment === "reverse_charge") {
      // self-assessed: output and input in the same return — no net cash, shown for the return
      const rc = round2((num(inv.net) * num(ratePct)) / 100);
      reverseCharge += rc;
      if (inv.date) month(inv.date).reverseCharge += rc;
      continue;
    }
    if (num(inv.vat) <= 0) continue;
    standardCount++;
    inputBooked += num(inv.vat);
    for (const p of vatPaidOn(inv)) {
      inputPaid += p.amount;
      month(p.date).inputPaid += p.amount;
    }
  }
  const recovered = round2(num(movements.vatRecovered));
  const out = Array.from(months.values())
    .map((m) => ({ ...m, inputPaid: round2(m.inputPaid), reverseCharge: round2(m.reverseCharge) }))
    .sort((a, b) => a.month.localeCompare(b.month));
  return {
    months: out,
    inputBooked: round2(inputBooked),
    inputPaid: round2(inputPaid),
    inputUnpaid: round2(inputBooked - inputPaid),
    reverseCharge: round2(reverseCharge),
    recovered,
    paidToZatca: round2(num(movements.vatPaid)),
    pendingRecovery: round2(Math.max(0, inputPaid - recovered)),
    forecastOnCommitments: round2((Math.max(0, num(openCommitments)) * num(ratePct)) / 100),
    exemptCount,
    zeroRatedCount,
    standardCount,
  };
}

/** Invoice VAT treatment: stored value, else the legacy vatable flag. */
export function vatTreatmentOf(v: unknown, vatable: boolean | null | undefined): VatTreatment {
  if (v === "standard" || v === "zero_rated" || v === "exempt" || v === "reverse_charge") return v;
  return vatable ? "standard" : "exempt";
}
