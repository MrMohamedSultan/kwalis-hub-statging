// ═══════════════════════════════════════════════════════════════════
// Audit trail (G12 / D07) — reads public.v_audit_trail (db/pending/184):
// every row of audit_history with the plain action (create / update /
// delete / approve / reject / pay) and the user's name. The trail itself is
// append-only in the database.
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "@/integrations/supabase/client";

export type AuditAction = "create" | "update" | "delete" | "approve" | "reject" | "pay";

export interface AuditTrailRow {
  id: string;
  created_at: string;
  table_name: string;
  record_id: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  action: AuditAction;
  actor_id: string | null;
  actor_name: string | null;
  changed_fields: Record<string, { from: unknown; to: unknown }> | null;
}

export async function fetchAuditTrail(table: string, recordId: string, limit = 100) {
  const { data, error } = await supabase
    .from("v_audit_trail" as never)
    .select(
      "id, created_at, table_name, record_id, operation, action, actor_id, actor_name, changed_fields",
    )
    .eq("table_name", table)
    .eq("record_id", recordId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as AuditTrailRow[];
}

/** Columns that are bookkeeping, never shown as a "change". */
const HIDDEN_FIELDS = new Set([
  "updated_at",
  "updated_by",
  "created_at",
  "created_by",
  "organization_id",
  "project_id",
  "id",
]);

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

/** Plain text for an audited value: no JSON, no ISO timestamps, "—" for empty. */
export function auditValueText(v: unknown, locale = "en-US"): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (typeof v === "number") {
    return v.toLocaleString(locale, { maximumFractionDigits: 2 });
  }
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString(locale);
    }
    if (/^-?\d+(\.\d+)?$/.test(v) && v.length < 16) {
      return Number(v).toLocaleString(locale, { maximumFractionDigits: 2 });
    }
    return v;
  }
  if (Array.isArray(v)) return v.length === 0 ? "—" : `${v.length} ×`;
  return "…";
}

/** The changes of one audit row, in a stable order, bookkeeping columns dropped. */
export function fieldChanges(
  row: Pick<AuditTrailRow, "changed_fields">,
  locale = "en-US",
): FieldChange[] {
  return Object.entries(row.changed_fields ?? {})
    .filter(([k]) => !HIDDEN_FIELDS.has(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, v]) => ({
      field,
      from: auditValueText(v?.from, locale),
      to: auditValueText(v?.to, locale),
    }));
}

/** "budget_code" -> "Budget code" — fallback label when no translation exists. */
export function humanizeField(key: string): string {
  const s = key.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : key;
}
