// ═══════════════════════════════════════════════════════════════════
// GL Transactions — data layer for the read-only v_ledger_transactions
// view. The view runs with security_invoker, so the caller's RLS on all
// seven base tables applies. We additionally scope to the active project
// and gate the whole query behind the gl_transactions RBAC permission:
// when canView is false the request is NEVER fired (enabled: false).
//
// Currency: invoices/payroll/purchase_orders/payments have NO currency
// column — the write path stores them in the organization base currency
// (payroll-payments.functions.ts and payrollImport.ts both default to
// the org base, SAR). So per-row display currency resolves as
//   row.currency ?? organization.base_currency (via the PROJECT's
//   organization_id — row-level organization_id is unreliable: legacy
//   payroll rows have it NULL, which produced unlabeled "—" figures).
// Never a hardcoded default, never converted for display here — display
// conversion lives in fx-resolution.ts and is presentation-only.
// ═══════════════════════════════════════════════════════════════════

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchRefMap } from "@/lib/document-refs";

export type GlTransactionSource =
  "invoice" | "payroll" | "purchase_order" | "petty_cash" | "overtime" | "per_diem" | "payment";

export type GlEntryKind = "actual" | "commitment" | "payment";

export interface GlTransaction {
  id: string;
  source_type: GlTransactionSource;
  source_id: string | null;
  entry_kind: GlEntryKind;
  entry_date: string | null;
  reference: string | null;
  /** Kwalis reference number (db/pending/184), merged in from v_document_refs. */
  ref_no?: string | null;
  /** Payments / receipts: the document they belong to. */
  parent_type?: string | null;
  parent_id?: string | null;
  description: string | null;
  counterparty: string | null;
  budget_code: string | null;
  gl_account_id: string | null;
  department: string | null;
  amount: number;
  vat_amount: number;
  total: number;
  /** Real withholding-tax amount; present once the view exposes wht_amount. */
  wht_amount?: number | null;
  currency: string | null;
  /** Display currency: row.currency ?? organization.base_currency. */
  resolvedCurrency: string | null;
  status: string | null;
  qfe_eligible: boolean;
  organization_id: string | null;
  project_id: string | null;
  created_at: string;
}

export const SOURCE_LABELS: Record<GlTransactionSource, string> = {
  invoice: "Invoice",
  payroll: "Payroll",
  purchase_order: "Purchase Order",
  petty_cash: "Petty Cash",
  overtime: "Overtime",
  per_diem: "Per Diem",
  payment: "Payment",
};

/** Base table behind each source — used by the drill-down drawer. */
export const SOURCE_TABLE: Record<GlTransactionSource, string> = {
  invoice: "invoices",
  payroll: "payroll",
  purchase_order: "purchase_orders",
  petty_cash: "cash_advance_receipts",
  overtime: "overtime_entries",
  per_diem: "per_diem_ledger",
  payment: "payments",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The reference shown in reports: the Kwalis ref_no (G06) when the document
 * has one, else the document's own human number — never a raw UUID.
 */
export function humanRef(r: GlTransaction): string | null {
  if (r.ref_no) return r.ref_no;
  return externalRef(r);
}

/** The other party's number (vendor invoice no., PO no.), never a raw UUID. */
export function externalRef(r: GlTransaction): string | null {
  if (!r.reference) return null;
  const v = r.reference.trim();
  if (!v || UUID_RE.test(v) || v === r.ref_no) return null;
  return v;
}

/**
 * Summary-card gate: rows whose status is not an approved/paid state are
 * visible in the table but excluded from Total Actual / Total Committed /
 * VAT Total, so a rejected receipt or pending overtime entry never counts
 * as spend. Status-less sources (invoices, payroll, payments) always count.
 */
const APPROVED_STATUSES = new Set(["approved", "paid"]);

export function countsTowardTotals(status: string | null): boolean {
  if (status == null || status.trim() === "") return true;
  return APPROVED_STATUSES.has(status.trim().toLowerCase());
}

const PAGE = 1000; // PostgREST default cap — page through the view.

async function fetchGlTransactions(projectId: string): Promise<GlTransaction[]> {
  const out: GlTransaction[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("v_ledger_transactions")
      .select("*")
      .eq("project_id", projectId)
      .order("entry_date", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as GlTransaction[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }

  // Resolve the organization base currency via the PROJECT's organization.
  // Row-level organization_id is unreliable — legacy payroll rows have it
  // NULL, which left resolvedCurrency null and rendered "242,850.00 —".
  // The project FK is authoritative: org-base is where invoices, payroll,
  // POs and payments are actually stored.
  let baseCurrency: string | null = null;
  const { data: proj } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();
  const orgId =
    ((proj as { organization_id?: string | null } | null)?.organization_id ?? null) ||
    out.find((r) => r.organization_id)?.organization_id ||
    null;
  if (orgId) {
    const { data } = await supabase
      .from("organizations")
      .select("base_currency")
      .eq("id", orgId)
      .maybeSingle();
    baseCurrency = (data?.base_currency as string | null) ?? null;
  }
  for (const r of out) r.resolvedCurrency = r.currency ?? baseCurrency;

  // G06: readable reference numbers live on the base tables; the ledger view
  // is shared with other work, so they are merged in here by record id.
  try {
    const refs = await fetchRefMap(projectId);
    for (const r of out) {
      const ref = refs.get(r.id);
      if (!ref) continue;
      r.ref_no = ref.ref_no;
      r.parent_type = ref.parent_type;
      r.parent_id = ref.parent_id;
    }
  } catch {
    // before db/pending/184 is applied the view does not exist: keep the old references
  }
  return out;
}

/**
 * Fetch the unified ledger for the active project.
 *
 * SECURITY (non-negotiable): `enabled: canView` — when the user lacks the
 * gl_transactions view permission the query is never executed, so zero
 * requests to v_ledger_transactions appear on the network. RLS isolates
 * organizations; it knows nothing about roles inside an organization, so
 * hiding the UI alone would still leak rows to any signed-in org member.
 */
export function useGlTransactions(projectId: string | null | undefined, canView: boolean) {
  return useQuery({
    queryKey: ["gl-transactions", projectId],
    queryFn: () => fetchGlTransactions(projectId as string),
    enabled: canView && !!projectId,
    staleTime: 300_000,
    gcTime: 600_000,
  });
}
