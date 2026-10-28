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

/** Fields a report row can give the drawer; everything else is read by the drawer itself. */
export type DrawerRowFields = {
  date?: string | null;
  reference?: string | null;
  description?: string | null;
  party?: string | null;
  budgetCode?: string | null;
  amount?: number | null;
  status?: string | null;
  entryKind?: GlTransaction["entry_kind"];
};

/** Any report row that knows its document (source + id) → a drawer row (G09). */
export function transactionForDocument(
  source: GlTransactionSource,
  id: string,
  f: DrawerRowFields,
  ctx: { organizationId: string | null; projectId: string | null },
): GlTransaction | null {
  if (!id || !UUID.test(id)) return null;
  const amount = Number(f.amount) || 0;
  return {
    id,
    source_type: source,
    source_id: id,
    entry_kind: f.entryKind ?? (source === "payment" ? "payment" : "actual"),
    entry_date: f.date ?? null,
    reference: f.reference ?? null,
    description: f.description ?? null,
    counterparty: f.party ?? null,
    budget_code: f.budgetCode ?? null,
    gl_account_id: null,
    department: null,
    amount,
    vat_amount: 0,
    total: amount,
    currency: "SAR",
    resolvedCurrency: "SAR",
    status: f.status ?? null,
    qfe_eligible: false,
    organization_id: ctx.organizationId,
    project_id: ctx.projectId,
    created_at: "",
  };
}

const SOURCE_OF_DOCUMENT_TYPE: Record<string, GlTransactionSource> = {
  invoice: "invoice",
  payroll: "payroll",
  purchase_order: "purchase_order",
  po: "purchase_order",
  petty_cash: "cash_advance",
  cash_advance: "cash_advance",
  cash_advance_receipt: "petty_cash",
  receipt: "petty_cash",
  per_diem: "per_diem",
  overtime: "overtime",
  payment: "payment",
  treasury: "treasury",
};

/** The source of a free-form document type ("invoice", "po", "cash_advance", …). */
export function sourceOfDocumentType(t: string | null | undefined): GlTransactionSource | null {
  return SOURCE_OF_DOCUMENT_TYPE[String(t ?? "").toLowerCase()] ?? null;
}

/**
 * A Payments Register row → the drawer of the payment itself (its event
 * key names it), else of the document it paid.
 */
export function transactionFromRegisterRow(
  r: {
    event_key: string;
    payment_date: string | null;
    payment_ref: string | null;
    payee: string | null;
    document_type: string | null;
    document_id: string | null;
    document_ref: string | null;
    budget_code: string | null;
    gross: number;
  },
  ctx: { organizationId: string | null; projectId: string | null },
): GlTransaction | null {
  const fields: DrawerRowFields = {
    date: r.payment_date,
    party: r.payee,
    budgetCode: r.budget_code,
    amount: r.gross,
  };
  const doc = documentOfEventKey(r.event_key);
  if (doc)
    return transactionForDocument(
      doc.source,
      doc.id,
      { ...fields, reference: r.payment_ref ?? r.document_ref },
      ctx,
    );
  const src = sourceOfDocumentType(r.document_type);
  return src && r.document_id
    ? transactionForDocument(src, r.document_id, { ...fields, reference: r.document_ref }, ctx)
    : null;
}
