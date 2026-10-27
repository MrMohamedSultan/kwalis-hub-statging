import { formatDateTime } from "@/lib/date-format";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X, Search, Download } from "lucide-react";
import { downloadCSV } from "@/lib/export-csv";

import { useTranslation } from "react-i18next";
type AuditRow = {
  id: string;
  created_at: string;
  table_name: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  actor_id: string | null;
  changed_fields: Record<string, { from: any; to: any }>;
  old_row: any;
  new_row: any;
};

const PAGE_SIZE = 25;

function describe(r: AuditRow): string {
  const label =
    r.new_row?.description ??
    r.old_row?.description ??
    r.new_row?.main_code ??
    r.old_row?.main_code ??
    "";
  if (r.operation === "INSERT") return `Created line "${label}"`;
  if (r.operation === "DELETE") return `Deleted line "${label}"`;
  const changed = Object.keys(r.changed_fields ?? {});
  return `Updated "${label}" (${changed.slice(0, 4).join(", ") || "no diff"})`;
}

export function BudgetAuditLog({
  projectId,
  onClose,
}: {
  projectId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [actors, setActors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [opFilter, setOpFilter] = useState<"ALL" | "INSERT" | "UPDATE" | "DELETE">("ALL");
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("audit_history" as any)
        .select("*")
        .eq("project_id", projectId)
        .eq("table_name", "budget_lines")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (cancelled) return;
      if (error) {
        toast.error(t("budgetauditlog.couldnt_load_audit_log"));
        setLoading(false);
        return;
      }
      const list = (data ?? []) as any as AuditRow[];
      setRows(list);
      const actorIds = Array.from(new Set(list.map((r) => r.actor_id).filter(Boolean))) as string[];
      if (actorIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", actorIds);
        if (!cancelled && profs) {
          const map: Record<string, string> = {};
          for (const p of profs as any[]) map[p.id] = p.display_name;
          setActors(map);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (opFilter !== "ALL" && r.operation !== opFilter) return false;
      if (!term) return true;
      const hay = [
        describe(r),
        r.new_row?.description,
        r.old_row?.description,
        r.new_row?.main_code,
        r.actor_id ? actors[r.actor_id] : "",
        Object.keys(r.changed_fields ?? {}).join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }, [rows, search, opFilter, actors]);

  useEffect(() => {
    setPage(0);
  }, [search, opFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const exportCsv = () => {
    const out = filtered.map((r) => ({
      timestamp: r.created_at,
      action: r.operation,
      actor: r.actor_id ? (actors[r.actor_id] ?? r.actor_id) : "system",
      description: describe(r),
      changed_fields: Object.entries(r.changed_fields ?? {})
        .map(
          ([k, v]) => `${k}: ${JSON.stringify(v?.from ?? null)} → ${JSON.stringify(v?.to ?? null)}`,
        )
        .join(" | "),
    }));
    downloadCSV(`budget-audit-${new Date().toISOString().slice(0, 10)}.csv`, out);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card text-card-foreground border border-border rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">{t("budgetauditlog.budget_change_history")}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("budgetauditlog.search_description_actor_field")}
              className="w-full ps-7 pe-2 py-1.5 text-xs rounded-md bg-background border border-border text-foreground outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>
          <select
            value={opFilter}
            onChange={(e) => setOpFilter(e.target.value as any)}
            className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground"
          >
            <option value="ALL">{t("budgetauditlog.any_action")}</option>
            <option value="INSERT">Created</option>
            <option value="UPDATE">Updated</option>
            <option value="DELETE">Deleted</option>
          </select>
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-40 text-foreground"
          >
            <Download className="size-3.5" /> Export CSV
          </button>
        </div>

        <div className="overflow-auto flex-1">
          {loading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">
              {t("budgetauditlog.no_history_entries_yet")}
            </div>
          )}
          {!loading && pageRows.length > 0 && (
            <ul className="divide-y divide-border">
              {pageRows.map((r) => (
                <li key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate text-foreground">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] me-2 ${
                            r.operation === "INSERT"
                              ? "bg-success/15 text-success dark:text-success"
                              : r.operation === "UPDATE"
                                ? "bg-warning/15 text-warning dark:text-warning"
                                : "bg-destructive/15 text-destructive dark:text-destructive"
                          }`}
                        >
                          {r.operation}
                        </span>
                        {describe(r)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        by {r.actor_id ? (actors[r.actor_id] ?? r.actor_id.slice(0, 8)) : "system"}
                      </div>
                      {r.operation === "UPDATE" &&
                        Object.keys(r.changed_fields ?? {}).length > 0 && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {Object.entries(r.changed_fields)
                              .slice(0, 5)
                              .map(([k, v]) => (
                                <div key={k} className="truncate">
                                  <span className="text-foreground/70">{k}:</span>{" "}
                                  <span className="text-destructive dark:text-destructive line-through">
                                    {String(v?.from ?? "—")}
                                  </span>{" "}
                                  →{" "}
                                  <span className="text-success dark:text-success">
                                    {String(v?.to ?? "—")}
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}
                    </div>
                    <time className="text-xs text-muted-foreground shrink-0" dir="ltr">
                      {formatDateTime(r.created_at)}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!loading && filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground">
            <span>
              {clampedPage * PAGE_SIZE + 1}–
              {Math.min(filtered.length, (clampedPage + 1) * PAGE_SIZE)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={clampedPage === 0}
                className="rounded-md border border-border px-2 py-1 disabled:opacity-40 hover:bg-muted"
              >
                Prev
              </button>
              <span>
                Page {clampedPage + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={clampedPage >= totalPages - 1}
                className="rounded-md border border-border px-2 py-1 disabled:opacity-40 hover:bg-muted"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
