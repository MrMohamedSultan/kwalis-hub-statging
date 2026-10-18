// ═══════════════════════════════════════════════════════════════════
// GL Transactions — drill-down side panel. Shows the full source record
// (every column of the underlying base-table row), the raw reference/UUID,
// and the audit trail from audit_history for that record.
// ═══════════════════════════════════════════════════════════════════

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { formatAmount } from "@/lib/format-number";
import { SOURCE_LABELS, SOURCE_TABLE, type GlTransaction } from "./gl-transactions-data";

interface AuditRow {
  id: string;
  created_at: string;
  operation: string | null;
  changed_fields: string[] | null;
  actor_id: string | null;
}

function fmtValue(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : formatAmount(v, 2);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function GlTransactionDrawer({
  row,
  onClose,
}: {
  row: GlTransaction | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const table = row ? SOURCE_TABLE[row.source_type] : null;

  const recordQuery = useQuery({
    queryKey: ["gltx-record", table, row?.id],
    enabled: !!row && !!table,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table as "payroll")
        .select("*")
        .eq("id", row!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
  });

  const auditQuery = useQuery({
    queryKey: ["gltx-audit", table, row?.id],
    enabled: !!row && !!table,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_history")
        .select("id, created_at, operation, changed_fields, actor_id")
        .eq("table_name", table!)
        .eq("record_id", row!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  if (!row) return null;

  const record = recordQuery.data ?? null;
  const entries = Object.entries(record ?? {}).filter(([k]) => k !== "old_row" && k !== "new_row");

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-surface border-s border-border shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-surface border-b border-border">
          <div>
            <div className="text-sm font-semibold">{t("reports.gltx_drawer_title")}</div>
            <div className="text-xs text-muted-foreground">
              {SOURCE_LABELS[row.source_type]} · {row.entry_date ?? "—"}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("reports.gltx_close")}
            className="size-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Raw reference — the full UUID lives here, never in the table */}
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              {t("reports.gltx_raw_ref")}
            </div>
            <div className="font-mono text-xs break-all rounded-lg bg-surface-2 border border-border px-3 py-2">
              {row.reference ?? row.id}
            </div>
          </div>

          {/* Full source record */}
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              {t("reports.gltx_source_record")}
            </div>
            {recordQuery.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="size-4 animate-spin" />
                {t("reports.gltx_loading")}
              </div>
            )}
            {recordQuery.isError && (
              <div className="text-sm text-destructive py-2">{t("reports.gltx_error")}</div>
            )}
            {record && (
              <dl className="rounded-xl border border-border overflow-hidden">
                {entries.map(([k, v], i) => (
                  <div
                    key={k}
                    className={`grid grid-cols-[minmax(0,40%)_1fr] gap-2 px-3 py-2 text-xs ${i % 2 ? "bg-surface-2/50" : ""}`}
                  >
                    <dt className="font-mono text-muted-foreground truncate" title={k}>
                      {k}
                    </dt>
                    <dd className="break-all tabular-nums">{fmtValue(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {/* Audit trail */}
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              {t("reports.gltx_audit_trail")}
            </div>
            {auditQuery.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="size-4 animate-spin" />
                {t("reports.gltx_loading")}
              </div>
            )}
            {auditQuery.data && auditQuery.data.length === 0 && (
              <div className="text-sm text-muted-foreground py-2">{t("reports.gltx_no_audit")}</div>
            )}
            <div className="space-y-2">
              {(auditQuery.data ?? []).map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl border border-border bg-surface-2/50 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] px-2 py-0.5 rounded-full border bg-brand/15 text-brand border-brand/30">
                      {a.operation ?? "—"}
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </div>
                  {a.changed_fields && a.changed_fields.length > 0 && (
                    <div className="mt-1 text-[11px] text-muted-foreground font-mono break-all">
                      {a.changed_fields.join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
