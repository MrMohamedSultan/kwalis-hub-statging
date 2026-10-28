// =====================================================================
// Canonical ledger fetchers — the single financial source of truth.
//
//   Actual    = incurred costs (v_ledger_transactions, entry_kind='actual')
//   Committed = issued but not consumed (entry_kind='commitment' — POs)
//   Paid      = cash out the door (payments table, budget code resolved
//               through each payment's source row — mirrors the
//               v_paid_by_budget_code view exactly)
//
// Every screen that reports money (dashboards, budget grid, Top Sheet,
// Actual Paid tab) must source from these so they can never disagree.
// =====================================================================
import { supabase } from "@/integrations/supabase/client";

/** Maps a payment's source_type to the table holding its budget code.
 *  Mirrors the join logic of the v_paid_by_budget_code SQL view exactly —
 *  changes there must be reflected here. */
export const SOURCE_TABLE_BY_TYPE: Record<string, string> = {
  invoice: "invoices",
  purchase_order: "purchase_orders",
  po: "purchase_orders",
  payroll: "payroll",
  cash_advance_receipt: "cash_advance_receipts",
  cash_advance: "cash_advance_receipts",
  petty_cash: "cash_advance_receipts",
  receipt: "cash_advance_receipts",
  overtime: "overtime_entries",
  per_diem: "per_diem_ledger",
};

/** Human label for a ledger/payment source_type. */
export function ledgerSourceLabel(sourceType: string): string {
  switch (sourceType) {
    case "invoice":
      return "Invoice";
    case "purchase_order":
    case "po":
      return "PO";
    case "payroll":
      return "Payroll";
    case "payroll_wht":
      // decision 12 (db/pending/201): company-borne WHT of a contract, code 7099
      return "Payroll (company WHT)";
    case "petty_cash":
    case "cash_advance":
    case "cash_advance_receipt":
    case "receipt":
      return "Petty cash";
    case "overtime":
      return "Overtime";
    case "per_diem":
      return "Per diem";
    default:
      return sourceType || "Entry";
  }
}

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

export type CanonicalLedgerEntry = {
  sourceType: string;
  sourceId: string;
  entryKind: "actual" | "commitment";
  entryDate: string | null;
  reference: string | null;
  description: string | null;
  counterparty: string | null;
  budgetCode: string | null;
  amount: number; // SAR (project base)
  status: string | null;
};

export type CanonicalPaidEntry = {
  id: string;
  sourceType: string;
  sourceId: string | null;
  date: string | null;
  method: string | null;
  budgetCode: string | null; // resolved through the payment's source row
  amount: number; // SAR (project base)
};

/** All ledger rows (actual + commitment) for a project, newest first. */
export async function fetchProjectLedger(projectId: string): Promise<CanonicalLedgerEntry[]> {
  const { data, error } = await (supabase.from as any)("v_ledger_transactions")
    .select(
      "source_type, source_id, entry_kind, entry_date, reference, description, counterparty, budget_code, amount, status",
    )
    .eq("project_id", projectId)
    // D11: the view also carries entry_kind='payment' rows (cash out). Those are
    // the third dimension (Paid) and are fetched by fetchProjectPaidLedger —
    // letting them through here counted every payment a second time as Actual.
    .in("entry_kind", ["actual", "commitment"])
    .order("entry_date", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    sourceType: String(r.source_type ?? ""),
    sourceId: String(r.source_id ?? ""),
    entryKind: r.entry_kind === "commitment" ? "commitment" : "actual",
    entryDate: r.entry_date != null ? String(r.entry_date) : null,
    reference: (r.reference as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    counterparty: (r.counterparty as string | null) ?? null,
    budgetCode: r.budget_code != null ? String(r.budget_code) : null,
    amount: money(r.amount),
    status: (r.status as string | null) ?? null,
  }));
}

/** All payments for a project with the budget code resolved through the
 *  payment's source row (same mapping as v_paid_by_budget_code). */
export async function fetchProjectPaidLedger(projectId: string): Promise<CanonicalPaidEntry[]> {
  const { data: pays, error } = await supabase
    .from("payments")
    .select("id, source_type, source_id, payment_date, amount, method")
    .eq("project_id", projectId);
  if (error) throw error;
  const payRows = (pays ?? []) as any[];

  // Batch-resolve budget codes: group source ids per table, one query each.
  const idsByTable = new Map<string, Set<string>>();
  for (const p of payRows) {
    const table = SOURCE_TABLE_BY_TYPE[String(p.source_type ?? "")];
    if (!table || !p.source_id) continue;
    let set = idsByTable.get(table);
    if (!set) idsByTable.set(table, (set = new Set()));
    set.add(String(p.source_id));
  }
  const codeBySourceId = new Map<string, string | null>();
  await Promise.all(
    [...idsByTable.entries()].map(async ([table, ids]) => {
      const { data } = await supabase
        .from(table as any)
        .select("id, budget_code")
        .in("id", [...ids]);
      for (const r of (data ?? []) as any[]) {
        codeBySourceId.set(String(r.id), r.budget_code != null ? String(r.budget_code) : null);
      }
    }),
  );

  return payRows.map((p) => ({
    id: String(p.id),
    sourceType: String(p.source_type ?? ""),
    sourceId: p.source_id != null ? String(p.source_id) : null,
    date: (p.payment_date as string | null) ?? null,
    method: (p.method as string | null) ?? null,
    budgetCode: (p.source_id && codeBySourceId.get(String(p.source_id))) || null,
    amount: money(p.amount),
  }));
}
