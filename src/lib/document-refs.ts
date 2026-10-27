// ═══════════════════════════════════════════════════════════════════
// Readable reference numbers (G06/G08) and deep links to the source
// document (G11).
//
// ref_no is issued by the database (db/pending/184): <CODE>-<TYPE>-<NNNN>,
// e.g. MON26-PO-0012. It is Kwalis' own number; a vendor's invoice number
// stays in invoices.invoice_no. public.v_document_refs lists every document
// of a project with its ref_no, so search and the transaction drawer can
// work across all document types with one query.
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "@/integrations/supabase/client";

export type DocumentSource =
  | "invoice"
  | "payroll"
  | "purchase_order"
  | "petty_cash"
  | "cash_advance"
  | "per_diem"
  | "overtime"
  | "payment"
  | "funding";

export type DocType = "PO" | "INV" | "CRW" | "CST" | "PC" | "PD" | "OT" | "PMT" | "FND";

export interface DocumentRef {
  source_type: DocumentSource;
  record_id: string;
  project_id: string | null;
  ref_no: string | null;
  doc_type: DocType;
  label: string | null;
  counterparty: string | null;
  /** The other party's number (vendor invoice no., typed PO no., bank reference). */
  external_no: string | null;
  /** For payments and petty-cash receipts: the document they belong to. */
  parent_type: string | null;
  parent_id: string | null;
  created_at: string;
}

/** Page + permission module behind each document type. */
export interface DocumentLink {
  to: string;
  open: string;
  /** RBAC module the user must be able to view, or the button is hidden. */
  module: string;
}

const PAGE: Partial<Record<DocumentSource, { to: string; module: string }>> = {
  invoice: { to: "/invoices", module: "invoices" },
  purchase_order: { to: "/purchase-orders", module: "purchase-orders" },
  petty_cash: { to: "/petty-cash", module: "petty-cash" },
  cash_advance: { to: "/petty-cash", module: "petty-cash" },
  per_diem: { to: "/per-diem-ledger", module: "per-diem" },
};

/** Normalises the many spellings payments use for their parent. */
export function normalizeSource(t: string | null | undefined): DocumentSource | null {
  switch ((t ?? "").toLowerCase()) {
    case "invoice":
      return "invoice";
    case "purchase_order":
    case "po":
      return "purchase_order";
    case "petty_cash":
    case "receipt":
    case "cash_advance_receipt":
      return "petty_cash";
    case "cash_advance":
      return "cash_advance";
    case "payroll":
    case "crew_contract":
    case "cast_contract":
      return "payroll";
    case "per_diem":
      return "per_diem";
    case "overtime":
      return "overtime";
    case "payment":
      return "payment";
    case "funding":
      return "funding";
    default:
      return null;
  }
}

/**
 * Where "Open document" goes. A payment opens the document it paid; a
 * contract opens Crew or Cast Contracts depending on its kind. Returns null
 * when the type has no page that can open one record (overtime, funding).
 */
export function documentLink(
  source: string,
  id: string,
  opts: { kind?: string | null; parentType?: string | null; parentId?: string | null } = {},
): DocumentLink | null {
  const s = normalizeSource(source);
  if (!s || !id) return null;
  if (s === "payment") {
    if (!opts.parentType || !opts.parentId) return null;
    return documentLink(opts.parentType, opts.parentId, { kind: opts.kind });
  }
  if (s === "payroll") {
    return (opts.kind ?? "").toLowerCase() === "cast"
      ? { to: "/cast", open: id, module: "cast-contracts" }
      : { to: "/crew", open: id, module: "crew-contracts" };
  }
  const page = PAGE[s];
  return page ? { to: page.to, open: id, module: page.module } : null;
}

/** Validates the ?open= search parameter (a UUID, nothing else). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseOpenParam(v: unknown): string | undefined {
  return typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim() : undefined;
}

/** True when the text looks like (part of) a reference: "PO-0012", "MON26-INV", "0012". */
export function looksLikeRef(q: string): boolean {
  const s = q.trim();
  if (s.length < 3 || s.length > 40) return false;
  return (
    /^[A-Za-z0-9]*-?(PO|INV|CRW|CST|PC|PD|OT|PMT|FND)(-\d*)?$/i.test(s) ||
    /^[A-Za-z0-9]+-[A-Za-z]{2,3}-\d+$/.test(s) ||
    /^\d{3,}$/.test(s)
  );
}

/** Escapes % and _ so user text is matched literally by ILIKE. */
export function ilikeContains(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Search a project's documents by full or partial reference (G08). */
export async function searchDocumentRefs(projectId: string, q: string, limit = 8) {
  const { data, error } = await supabase
    .from("v_document_refs" as never)
    .select("*")
    .eq("project_id", projectId)
    .ilike("ref_no", ilikeContains(q))
    .order("ref_no")
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as DocumentRef[];
}

/** All references of a project, keyed by record id (for report rows). */
export async function fetchRefMap(projectId: string): Promise<Map<string, DocumentRef>> {
  const out = new Map<string, DocumentRef>();
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("v_document_refs" as never)
      .select("*")
      .eq("project_id", projectId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as DocumentRef[];
    for (const r of rows) out.set(r.record_id, r);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/** One document's reference row. */
export async function fetchDocumentRef(id: string): Promise<DocumentRef | null> {
  const { data, error } = await supabase
    .from("v_document_refs" as never)
    .select("*")
    .eq("record_id", id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as DocumentRef | null;
}

/** Reads ref_no from a row whose generated type does not know the column yet. */
export function refNoOf(row: unknown): string | null {
  const v = (row as { ref_no?: unknown } | null)?.ref_no;
  return typeof v === "string" && v ? v : null;
}
