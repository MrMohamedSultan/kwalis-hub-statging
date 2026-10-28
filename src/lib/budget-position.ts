// =====================================================================
// Budget position — the glossary definitions in one place (B17).
//
//   Actual     approved installments + invoices + approved petty-cash receipts
//   Commitment contract value − actual on it, PO not yet invoiced,
//              car rentals / accommodation not yet invoiced
//   Paid       money out of the bank / floats (payments ledger)
//   Remaining  Budget − Actual − Commitment
//   Payable    Actual − Paid
//   ETC        per code, editable; default max(Remaining, 0)
//   EFC        Actual + Commitment + ETC
//   Variance   Budget − EFC (positive = saving)
//   Cash       Funding − Paid − VAT paid + VAT recovered − WHT remitted
//
// Every screen that shows "Remaining Budget" should call
// computeBudgetPosition() (or useTotals(), which wraps it) instead of adding
// its own pieces. Mirrors the PO / logistics rules of v_ledger_transactions
// (db/pending/174) and the payroll split of db/pending/180
// (public.payroll_contract_actual / payroll_legacy_paid).
// =====================================================================
import type { CashAdvanceReceipt, Invoice, Payment, PayrollRow, PurchaseOrder } from "@/lib/store";
import { round2 } from "@/lib/ap-calc";

/** PO states that are NOT a commitment (same list as public.po_is_commitment). */
export const PO_NON_COMMITMENT_STATES = ["draft", "cancelled", "rejected", "closed"] as const;

export function poIsCommitment(status: string | null | undefined): boolean {
  return !(PO_NON_COMMITMENT_STATES as readonly string[]).includes(
    String(status ?? "").toLowerCase(),
  );
}

/**
 * Invoice approval (db/pending/201): approved = Actual, pending (recorded) =
 * Commitment, rejected / cancelled = neither. A row without a status was
 * saved before 201 and counts as approved.
 */
export function invoiceCounts(i: Pick<Invoice, "approvalStatus">): "actual" | "commitment" | null {
  const st = i.approvalStatus ?? "approved";
  if (st === "approved") return "actual";
  if (st === "pending") return "commitment";
  return null;
}

/** Excl.-VAT total invoiced against a PO (rejected / cancelled invoices do not count). */
export function invoicedOnPo(
  poId: string,
  invoices: Pick<Invoice, "price" | "purchaseOrderId" | "approvalStatus">[],
) {
  return invoices.reduce(
    (a, i) =>
      i.purchaseOrderId === poId && invoiceCounts(i) !== null ? a + (Number(i.price) || 0) : a,
    0,
  );
}

/**
 * Open commitment of one PO: value − invoiced on it (excl. VAT), never below 0.
 * The invoice is the document that turns a PO into actual; a payment made
 * straight on a PO is Paid, not Actual (same as v_ledger_transactions).
 */
export function poOpenCommitment(
  po: Pick<PurchaseOrder, "id" | "amount" | "status">,
  invoices: Pick<Invoice, "price" | "purchaseOrderId" | "approvalStatus">[],
): number {
  if (!poIsCommitment(po.status)) return 0;
  return Math.max(0, (Number(po.amount) || 0) - invoicedOnPo(po.id, invoices));
}

/** Payroll rows created as installments of an invoice are the invoice, not a contract. */
const isInvoiceInstallment = (r: PayrollRow) => (r.refId ?? "").startsWith("invoice:");

/** A contract cancelled with cancel_payroll_contract (A04) has no Commitment left. */
export const isContractCancelled = (r: Pick<PayrollRow, "contractCancelledAt">) =>
  !!r.contractCancelledAt;

/**
 * What was paid on a contract that has no instalment schedule: the payments
 * ledger or the legacy Paid slots, whichever is larger (public.payroll_legacy_paid).
 */
export function legacyContractPaid(
  r: Pick<PayrollRow, "id" | "totalAmount" | "payments" | "percents">,
  payments: Pick<Payment, "sourceType" | "sourceId" | "amount">[],
): number {
  const ledger = payments.reduce(
    (a, p) =>
      String(p.sourceType) === "payroll" && p.sourceId === r.id ? a + (Number(p.amount) || 0) : a,
    0,
  );
  const slots = r.payments ?? [];
  const total = Number(r.totalAmount) || 0;
  const bySlots = slots.reduce((a, st, i) => {
    if (st !== "Paid") return a;
    const pct = Number(r.percents?.[i] ?? (slots.length ? 100 / slots.length : 0));
    return a + (total * pct) / 100;
  }, 0);
  return Math.max(ledger, bySlots);
}

/**
 * Actual on a contract = approved / paid installments (decision 1).
 * Installment amounts are on the net (after-WHT) basis; scaled back to the
 * contract value so actual + commitment = contract value.
 */
export function contractActual(r: PayrollRow, legacyPaid: number): number {
  const total = Number(r.totalAmount) || 0;
  const sched = r.paymentSchedule ?? [];
  if (sched.length === 0) return Math.min(total, Math.max(0, legacyPaid));
  const netBase = Number(r.netPayable ?? total) || total;
  const scale = netBase > 0 ? total / netBase : 1;
  const done = sched.reduce((a, m) => {
    const st = String(m.status ?? "Pending");
    if (st !== "Paid" && st !== "Approved") return a;
    const share =
      m.amount != null ? Number(m.amount) * scale : ((Number(m.percent) || 0) / 100) * total;
    return a + share;
  }, 0);
  return Math.min(total, Math.max(0, done));
}

export type LogisticsCommitment = {
  /** Booked total in SAR (days × rate, nights × rate). */
  amount: number;
  /** Invoice that converts the booking, if any. */
  invoiceId?: string | null;
};

export type BudgetPositionInput = {
  totalBudget: number;
  payroll: PayrollRow[];
  invoices: Invoice[];
  purchaseOrders: PurchaseOrder[];
  payments: Payment[];
  receipts: CashAdvanceReceipt[];
  logistics?: LogisticsCommitment[];
  /** paid amount of a payroll row from its ledger (store.paidPayrollAmount). */
  legacyPaidFor: (r: PayrollRow) => number;
};

export type BudgetPosition = {
  budget: number;
  actual: number;
  commitment: number;
  paid: number;
  payable: number;
  remaining: number;
  parts: {
    contractsActual: number;
    contractsCommitment: number;
    invoicesActual: number;
    invoicesCommitment: number;
    poCommitment: number;
    pettyActual: number;
    logisticsCommitment: number;
  };
};

export function computeBudgetPosition(input: BudgetPositionInput): BudgetPosition {
  const { invoices, payments } = input;
  let contractsActual = 0;
  let contractsCommitment = 0;
  for (const r of input.payroll) {
    if (isInvoiceInstallment(r)) continue;
    const total = Number(r.totalAmount) || 0;
    const act = contractActual(r, input.legacyPaidFor(r));
    contractsActual += act;
    if (!isContractCancelled(r)) contractsCommitment += Math.max(0, total - act);
  }

  const invoicesActual = invoices.reduce(
    (a, i) => (invoiceCounts(i) === "actual" ? a + (Number(i.price) || 0) : a),
    0,
  );
  const invoicesCommitment = invoices.reduce(
    (a, i) => (invoiceCounts(i) === "commitment" ? a + (Number(i.price) || 0) : a),
    0,
  );

  const poCommitment = input.purchaseOrders.reduce(
    (a, po) => a + poOpenCommitment(po, invoices),
    0,
  );

  const pettyActual = input.receipts.reduce(
    (a, r) =>
      String(r.status ?? "").toLowerCase() === "approved" ? a + (Number(r.amount) || 0) : a,
    0,
  );

  const priceOf = new Map(
    invoices.filter((i) => invoiceCounts(i) !== null).map((i) => [i.id, Number(i.price) || 0]),
  );
  const logisticsCommitment = (input.logistics ?? []).reduce(
    (a, l) =>
      a +
      Math.max(0, (Number(l.amount) || 0) - (l.invoiceId ? (priceOf.get(l.invoiceId) ?? 0) : 0)),
    0,
  );

  const actual = round2(contractsActual + invoicesActual + pettyActual);
  const commitment = round2(
    contractsCommitment + poCommitment + logisticsCommitment + invoicesCommitment,
  );
  const paid = round2(payments.reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const budget = round2(Number(input.totalBudget) || 0);
  return {
    budget,
    actual,
    commitment,
    paid,
    payable: round2(Math.max(0, actual - paid)),
    remaining: round2(budget - actual - commitment),
    parts: {
      contractsActual: round2(contractsActual),
      contractsCommitment: round2(contractsCommitment),
      invoicesActual: round2(invoicesActual),
      invoicesCommitment: round2(invoicesCommitment),
      poCommitment: round2(poCommitment),
      pettyActual: round2(pettyActual),
      logisticsCommitment: round2(logisticsCommitment),
    },
  };
}

// ---------------------------------------------------------------------
// Cost Report line (R06) — same arithmetic as public.get_cost_report.
// ---------------------------------------------------------------------
export type CostLine = {
  budget: number;
  actual: number;
  commitment: number;
  remaining: number;
  etc: number;
  efc: number;
  variance: number;
  /** Actual / Budget × 100; null when the budget is 0. */
  pctSpent: number | null;
};

/** `etcOverride` = the accountant's ETC (null / undefined = default max(Remaining, 0)). */
export function costLine(
  budget: number,
  actual: number,
  commitment: number,
  etcOverride?: number | null,
): CostLine {
  const b = round2(Number(budget) || 0);
  const a = round2(Number(actual) || 0);
  const c = round2(Number(commitment) || 0);
  const remaining = round2(b - a - c);
  const etc = round2(
    etcOverride != null && Number.isFinite(Number(etcOverride))
      ? Math.max(0, Number(etcOverride))
      : Math.max(remaining, 0),
  );
  const efc = round2(a + c + etc);
  return {
    budget: b,
    actual: a,
    commitment: c,
    remaining,
    etc,
    efc,
    variance: round2(b - efc),
    pctSpent: b !== 0 ? round2((a / b) * 100) : null,
  };
}

// ---------------------------------------------------------------------
// Cash position (A09 / A12) — same arithmetic as public.get_funding_position.
// ---------------------------------------------------------------------
export type CashInput = {
  funding: number;
  paid: number;
  vatPaid: number;
  vatRecovered: number;
  whtRemitted: number;
  /** Approved, not paid yet (unpaid invoices + approved instalments). */
  upcoming: number;
};

export type CashPosition = CashInput & {
  cashBalance: number;
  expectedBalance: number;
  hasFunding: boolean;
  overdrawn: boolean;
  paymentsExceedFunding: boolean;
  /** Paid / Funding × 100; null when there is no funding. */
  utilisationPct: number | null;
};

export function cashPosition(i: CashInput): CashPosition {
  const n = (v: number) => round2(Number(v) || 0);
  const funding = n(i.funding);
  const paid = n(i.paid);
  const cashBalance = round2(funding - paid - n(i.vatPaid) + n(i.vatRecovered) - n(i.whtRemitted));
  return {
    funding,
    paid,
    vatPaid: n(i.vatPaid),
    vatRecovered: n(i.vatRecovered),
    whtRemitted: n(i.whtRemitted),
    upcoming: n(i.upcoming),
    cashBalance,
    expectedBalance: round2(cashBalance - n(i.upcoming)),
    hasFunding: funding > 0,
    overdrawn: cashBalance < 0,
    paymentsExceedFunding: paid > funding,
    utilisationPct: funding > 0 ? round2((paid / funding) * 100) : null,
  };
}
