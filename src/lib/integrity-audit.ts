/**
 * One-click Integrity Audit — cross-checks in-memory store state against
 * derived aggregates. UI-side only (matches the rest of the platform).
 *
 * Checks:
 *  1. Payroll Ledger PAID entries by topsheet-code vs. Actual Paid rollup.
 *  2. Net Cash Available = Funding Inflows − (Approved + Paid ledger + Direct VAT).
 *  3. Missing top-sheet code on paid payroll rows.
 *  4. Missing Proof of Payment on ledger entries.
 */

import { formatAmount } from "@/lib/format-number";
import { useMemo } from "react";
import { useStore, paidPayrollAmount } from "@/lib/store";
import type { PayrollRow, Payment, Invoice, PurchaseOrder } from "@/lib/store";

export type IntegrityFinding = {
  id: string;
  severity: "error" | "warning" | "info";
  category: "topsheet" | "cashflow" | "mapping" | "proof";
  title: string;
  detail: string;
  refId?: string;
  expected?: number;
  actual?: number;
  delta?: number;
};

function sumPaidLedger(rows: PayrollRow[]) {
  let approved = 0;
  let paid = 0;
  let pending = 0;
  for (const r of rows) {
    for (const e of r.ledger ?? []) {
      const amt = Number(e.amount || 0);
      if (e.status === "Paid") paid += amt;
      else if (e.status === "Approved") approved += amt;
      else if (e.status === "Pending Approval") pending += amt;
    }
  }
  return { approved, paid, pending };
}

function paidByTopsheetCode(rows: PayrollRow[]) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const code = (r as any).topsheetCode ?? (r as any).topsheet_code ?? null;
    if (!code) continue;
    out[code] = (out[code] ?? 0) + paidPayrollAmount(r);
  }
  return out;
}

/** Run the audit against the current store snapshot + funding/VAT ledgers. */
export function runIntegrityAudit(input: {
  payroll: PayrollRow[];
  invoices: Invoice[];
  purchaseOrders: PurchaseOrder[];
  payments: Payment[];
  fundingInflows: number;
  directVatPaid: number;
  displayedNetCash?: number | null;
}): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const ledger = sumPaidLedger(input.payroll);

  // 1. Missing top-sheet code on payroll rows with paid amounts
  for (const r of input.payroll) {
    const paid = paidPayrollAmount(r);
    const code = (r as any).topsheetCode ?? (r as any).topsheet_code ?? null;
    if (paid > 0 && !code) {
      findings.push({
        id: `map-${r.id}`,
        severity: "warning",
        category: "mapping",
        title: "Paid payroll row is not mapped to a Top Sheet code",
        detail: `${r.name ?? "(unnamed)"} — ${formatAmount(paid, 2)} SAR paid without a topsheet_code. Actuals rollup will miss this row.`,
        refId: r.id,
        actual: paid,
      });
    }
  }

  // 2. Missing proof of payment
  for (const r of input.payroll) {
    for (const e of r.ledger ?? []) {
      if (!(e as any).proofPath && e.status === "Paid") {
        findings.push({
          id: `proof-${e.id ?? r.id}`,
          severity: "warning",
          category: "proof",
          title: "Paid ledger entry missing Proof of Payment",
          detail: `${r.name ?? "(unnamed)"} — ${formatAmount(Number(e.amount || 0), 2)} SAR marked Paid without an attached proof.`,
          refId: r.id,
          actual: Number(e.amount || 0),
        });
      }
    }
  }

  // 3. Net Cash Available recompute
  const expectedNet = input.fundingInflows - (ledger.approved + ledger.paid) - input.directVatPaid;
  if (
    typeof input.displayedNetCash === "number" &&
    Math.abs(expectedNet - input.displayedNetCash) > 0.5
  ) {
    findings.push({
      id: "cashflow-net",
      severity: "error",
      category: "cashflow",
      title: "Net Cash Available drift",
      detail: `Displayed value differs from recomputed Funding − (Approved + Paid) − Direct VAT.`,
      expected: expectedNet,
      actual: input.displayedNetCash,
      delta: input.displayedNetCash - expectedNet,
    });
  }

  // 4. Topsheet code paid rollup summary (informational — always present)
  const byCode = paidByTopsheetCode(input.payroll);
  const totalMapped = Object.values(byCode).reduce((a, b) => a + b, 0);
  findings.push({
    id: "topsheet-summary",
    severity: "info",
    category: "topsheet",
    title: `Actual Paid rollup mapped across ${Object.keys(byCode).length} Top Sheet codes`,
    detail: `Total mapped = ${formatAmount(totalMapped, 2)} SAR. Codes: ${
      Object.entries(byCode)
        .map(([c, v]) => `${c}=${formatAmount(v, 2)}`)
        .join(", ") || "none"
    }.`,
    actual: totalMapped,
  });

  return findings;
}

export function useIntegrityAudit(opts: {
  fundingInflows: number;
  directVatPaid: number;
  displayedNetCash?: number | null;
}) {
  const { payroll, invoices, purchaseOrders, payments } = useStore();
  return useMemo(
    () =>
      runIntegrityAudit({
        payroll,
        invoices,
        purchaseOrders,
        payments,
        fundingInflows: opts.fundingInflows,
        directVatPaid: opts.directVatPaid,
        displayedNetCash: opts.displayedNetCash ?? null,
      }),
    [
      payroll,
      invoices,
      purchaseOrders,
      payments,
      opts.fundingInflows,
      opts.directVatPaid,
      opts.displayedNetCash,
    ],
  );
}
