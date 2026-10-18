import { useEffect, useState, useMemo } from "react";
import { Download, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getAuditHistory, type AuditHistoryRow } from "@/lib/audit-history.functions";
import { downloadBlob } from "@/lib/download";

type Table = "invoices" | "payroll" | "transactions" | "crew_members" | "people";

function toCsv(rows: AuditHistoryRow[]): string {
  const header = ["Timestamp", "Operation", "Actor", "Field", "From", "To"];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    const actor = r.actor_email || r.actor_id || "system";
    const entries = Object.entries(r.changed_fields);
    if (r.operation !== "UPDATE" || entries.length === 0) {
      lines.push([r.created_at, r.operation, actor, "", "", ""].map(esc).join(","));
    } else {
      for (const [k, v] of entries) {
        lines.push(
          [r.created_at, r.operation, actor, k, v.from ?? "", v.to ?? ""].map(esc).join(","),
        );
      }
    }
  }
  return lines.join("\n");
}

function download(filename: string, content: string) {
  const blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8;" });
  downloadBlob(filename, blob);
}

export function AuditHistoryPanel({
  tableName,
  recordId,
  label,
  emptyLabel,
}: {
  tableName: Table | null;
  recordId: string | null;
  label?: string;
  emptyLabel?: string;
}) {
  const { t } = useTranslation();
  const labelText = label ?? t("audit.title");
  const emptyText = emptyLabel ?? t("audit.empty");
  const [rows, setRows] = useState<AuditHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!tableName || !recordId) {
      setRows([]);
      return;
    }
    let cancel = false;
    setLoading(true);
    setError(null);
    getAuditHistory({ data: { tableName, recordId, limit: 100 } })
      .then((r) => {
        if (!cancel) setRows(r as AuditHistoryRow[]);
      })
      .catch((e) => {
        if (!cancel) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [tableName, recordId]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const s = q.toLowerCase();
    return rows.filter((r) => {
      if (r.operation.toLowerCase().includes(s)) return true;
      if ((r.actor_email || "").toLowerCase().includes(s)) return true;
      if (new Date(r.created_at).toLocaleString().toLowerCase().includes(s)) return true;
      for (const [k, v] of Object.entries(r.changed_fields)) {
        if (k.toLowerCase().includes(s)) return true;
        if (
          String(v.from ?? "")
            .toLowerCase()
            .includes(s)
        )
          return true;
        if (
          String(v.to ?? "")
            .toLowerCase()
            .includes(s)
        )
          return true;
      }
      return false;
    });
  }, [rows, q]);

  if (!tableName || !recordId) {
    return (
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {labelText}
        </div>
        <div className="text-xs text-muted-foreground">{t("audit.notTracked")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {labelText}
        </div>
        <button
          type="button"
          onClick={() => download(`audit-${tableName}-${recordId.slice(0, 8)}.csv`, toCsv(rows))}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border bg-surface-2 hover:bg-surface-3 text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition"
          title={t("audit.exportTitle")}
        >
          <Download className="h-3 w-3" /> {t("audit.exportCsv")}
        </button>
      </div>

      <div className="relative">
        <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("audit.searchPlaceholder")}
          className="w-full ps-7 pe-2 py-1.5 text-xs rounded-md bg-surface-2 border border-border text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
      </div>

      {loading && <div className="text-xs text-muted-foreground">{t("audit.loading")}</div>}
      {error && <div className="text-xs text-destructive">{error}</div>}
      {!loading && !error && filtered.length === 0 && (
        <div className="text-xs text-muted-foreground">{q ? t("audit.noMatch") : emptyText}</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className="space-y-1 max-h-56 overflow-auto pr-1">
          {filtered.map((r) => (
            <li key={r.id} className="text-xs border-b border-border pb-1 last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] mr-1 ${
                      r.operation === "INSERT"
                        ? "bg-success/15 text-success"
                        : r.operation === "UPDATE"
                          ? "bg-warning/15 text-warning"
                          : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {r.operation}
                  </span>
                  {new Date(r.created_at).toLocaleString()}
                </span>
                <span className="text-foreground/80 truncate max-w-[45%]">
                  {r.actor_email || r.actor_id?.slice(0, 8) || "system"}
                </span>
              </div>
              {r.operation === "UPDATE" && Object.keys(r.changed_fields).length > 0 && (
                <div className="mt-0.5 text-[11px] text-muted-foreground pl-1">
                  {Object.entries(r.changed_fields)
                    .slice(0, 8)
                    .map(([k, v]) => (
                      <div key={k} className="truncate">
                        <span className="text-foreground/70">{k}:</span>{" "}
                        <span className="text-destructive line-through">
                          {String(v.from ?? "—")}
                        </span>{" "}
                        → <span className="text-success">{String(v.to ?? "—")}</span>
                      </div>
                    ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
