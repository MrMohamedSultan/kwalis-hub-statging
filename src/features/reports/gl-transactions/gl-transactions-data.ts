// ═══════════════════════════════════════════════════════════════════
// Transaction drawer row shape (G09) — one financial document as the
// General Ledger drawer shows it. The old GL Transactions tab that listed
// v_ledger_transactions was retired by decision 6 (db/pending/196): the
// General Ledger tab (double entry, db/pending/182) opens this drawer from
// a ledger line (see features/reports/ledger/ledger-drawer.ts).
// v_ledger_transactions can return a payroll row twice (actual +
// commitment) with the same id: key its rows by row_key, never by id.
// ═══════════════════════════════════════════════════════════════════

export type GlTransactionSource =
  | "invoice"
  | "payroll"
  | "purchase_order"
  | "petty_cash"
  | "overtime"
  | "per_diem"
  | "payment"
  | "cash_advance"
  | "funding"
  | "treasury";

export type GlEntryKind = "actual" | "commitment" | "payment";

export interface GlTransaction {
  id: string;
  source_type: GlTransactionSource;
  source_id: string | null;
  entry_kind: GlEntryKind;
  /** id:entry_kind — unique per row of v_ledger_transactions (db/pending/196). */
  row_key?: string | null;
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
  cash_advance: "Petty Cash Float",
  funding: "Funding",
  treasury: "Bank movement",
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
  cash_advance: "cash_advances",
  funding: "project_funding",
  treasury: "treasury_movements",
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
