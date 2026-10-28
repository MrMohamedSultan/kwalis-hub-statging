// A General Ledger line → the document the transaction drawer (184) opens.
// The event key names the document: "<event>:<id>[:<instalment>]"
// (db/pending/182 / 196), so no extra query is needed to find it.
import type { GeneralLedgerLine } from "@/lib/ledger-calc";
import type {
  GlTransaction,
  GlTransactionSource,
} from "@/features/reports/gl-transactions/gl-transactions-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SOURCE_OF_EVENT: Record<string, GlTransactionSource> = {
  invoice: "invoice",
  instalment: "payroll",
  payment: "payment",
  petty_receipt: "petty_cash",
  petty_issue: "cash_advance",
  overtime: "overtime",
  per_diem: "per_diem",
  funding: "funding",
  treasury: "treasury",
};

/** The document behind a ledger event key, or null when the key is not a document. */
export function documentOfEventKey(
  key: string,
): { source: GlTransactionSource; id: string; instalment: string | null } | null {
  const [prefix, id, instalment] = String(key ?? "").split(":");
  const source = SOURCE_OF_EVENT[prefix];
  if (!source || !id || !UUID.test(id)) return null;
  return { source, id, instalment: instalment || null };
}

export function transactionFromLedgerLine(
  l: GeneralLedgerLine,
  ctx: { organizationId: string | null; projectId: string | null },
): GlTransaction | null {
  const doc = documentOfEventKey(l.event_key);
  if (!doc) return null;
  const amount = Math.max(l.debit, l.credit);
  return {
    id: doc.id,
    source_type: doc.source,
    source_id: doc.id,
    entry_kind: doc.source === "payment" ? "payment" : "actual",
    entry_date: l.entry_date,
    reference: l.reference,
    description: l.description,
    counterparty: l.party,
    budget_code: l.budget_code,
    gl_account_id: null,
    department: l.department,
    amount,
    vat_amount: 0,
    total: amount,
    currency: "SAR",
    resolvedCurrency: "SAR",
    status: l.status,
    qfe_eligible: l.qpe_eligible,
    organization_id: ctx.organizationId,
    project_id: ctx.projectId,
    created_at: "",
  };
}
