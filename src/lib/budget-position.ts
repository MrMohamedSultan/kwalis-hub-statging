// =====================================================================
// Budget position — the glossary definitions in one place (B17).
//
//   Actual     approved installments + invoices + approved petty-cash receipts
//   Commitment contract value − actual on it, PO not yet invoiced,
//              car rentals / accommodation not yet invoiced
//   Paid       money out of the bank / floats (payments ledger)
//   Remaining  Budget − Actual − Commitment
//
// Every screen that shows "Remaining Budget" should call
// computeBudgetPosition() (or useTotals(), which wraps it) instead of adding
// its own pieces. Mirrors the PO / logistics rules of v_ledger_transactions
// (db/pending/174).
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

/** Excl.-VAT total invoiced against a PO. */
export function invoicedOnPo(poId: string, invoices: Pick<Invoice, "price" | "purchaseOrderId">[]) {
  return invoices.reduce(
    (a, i) => (i.purchaseOrderId === poId ? a + (Number(i.price) || 0) : a),
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
  invoices: Pick<Invoice, "price" | "purchaseOrderId">[],
): number {
  if (!poIsCommitment(po.status)) return 0;
  return Math.max(0, (Number(po.amount) || 0) - invoicedOnPo(po.id, invoices));
}

/** Payroll rows created as installments of an invoice are the invoice, not a contract. */
const isInvoiceInstallment = (r: PayrollRow) => (r.refId ?? "").startsWith("invoice:");

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
    contractsCommitment += Math.max(0, total - act);
  }

  const invoicesActual = invoices.reduce((a, i) => a + (Number(i.price) || 0), 0);

  const poCommitment = input.purchaseOrders.reduce(
    (a, po) => a + poOpenCommitment(po, invoices),
    0,
  );

  const pettyActual = input.receipts.reduce(
    (a, r) =>
      String(r.status ?? "").toLowerCase() === "approved" ? a + (Number(r.amount) || 0) : a,
    0,
  );

  const priceOf = new Map(invoices.map((i) => [i.id, Number(i.price) || 0]));
  const logisticsCommitment = (input.logistics ?? []).reduce(
    (a, l) =>
      a +
      Math.max(0, (Number(l.amount) || 0) - (l.invoiceId ? (priceOf.get(l.invoiceId) ?? 0) : 0)),
    0,
  );

  const actual = round2(contractsActual + invoicesActual + pettyActual);
  const commitment = round2(contractsCommitment + poCommitment + logisticsCommitment);
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
      poCommitment: round2(poCommitment),
      pettyActual: round2(pettyActual),
      logisticsCommitment: round2(logisticsCommitment),
    },
  };
}
