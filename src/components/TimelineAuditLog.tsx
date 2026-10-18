import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { useTranslation } from "react-i18next";
type AuditRow = {
  id: string;
  created_at: string;
  table_name: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  actor_id: string | null;
  actor_email?: string | null;
  changed_fields: Record<string, { from: any; to: any }>;
  old_row: any;
  new_row: any;
};

const TABLE_LABEL: Record<string, string> = {
  timeline_bars: "Bar",
  timeline_milestones: "Milestone",
  timeline_versions: "Version",
};

function describe(r: AuditRow): string {
  const kind = TABLE_LABEL[r.table_name] ?? r.table_name;
  const label = r.new_row?.label ?? r.old_row?.label ?? r.new_row?.code ?? "";
  if (r.operation === "INSERT") return `Created ${kind} "${label}"`;
  if (r.operation === "DELETE") return `Deleted ${kind} "${label}"`;
  const changed = Object.keys(r.changed_fields ?? {});
  if (
    r.table_name === "timeline_bars" &&
    (changed.includes("start_date") || changed.includes("end_date"))
  ) {
    return `Moved/resized ${kind} "${label}"`;
  }
  if (r.table_name === "timeline_milestones" && changed.includes("milestone_date")) {
    return `Moved ${kind} "${label}"`;
  }
  return `Updated ${kind} "${label}" (${changed.join(", ") || "no diff"})`;
}

const PAGE_SIZE = 25;

export function TimelineAuditLog({
  projectId,
  onClose,
}: {
  projectId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [emails, setEmails] = useState<Record<string, string>>({});

  const [search, setSearch] = useState("");
  const [opFilter, setOpFilter] = useState<"ALL" | "INSERT" | "UPDATE" | "DELETE">("ALL");
  const [tableFilter, setTableFilter] = useState<
    "ALL" | "timeline_bars" | "timeline_milestones" | "timeline_versions"
  >("ALL");
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
        .in("table_name", ["timeline_bars", "timeline_milestones", "timeline_versions"])
        .order("created_at", { ascending: false })
        .limit(1000);
      if (cancelled) return;
      if (error) {
        toast.error("Couldn't load audit log");
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
          setEmails(map);
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
      if (tableFilter !== "ALL" && r.table_name !== tableFilter) return false;
      if (!term) return true;
      const hay = [
        describe(r),
        r.new_row?.label,
        r.old_row?.label,
        r.actor_id ? emails[r.actor_id] : "",
        Object.keys(r.changed_fields ?? {}).join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }, [rows, search, opFilter, tableFilter, emails]);

  useEffect(() => {
    setPage(0);
  }, [search, opFilter, tableFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">{t("timelineauditlog.timeline_activity_log")}</h2>
          <button className="text-muted-foreground hover:text-foreground text-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search description, actor, field…"
            className="flex-1 min-w-[180px] bg-transparent border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/40"
          />
          <select
            value={opFilter}
            onChange={(e) => setOpFilter(e.target.value as any)}
            className="bg-transparent border border-border rounded-md px-2 py-1 text-xs"
          >
            <option value="ALL">Any action</option>
            <option value="INSERT">Created</option>
            <option value="UPDATE">Updated</option>
            <option value="DELETE">Deleted</option>
          </select>
          <select
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value as any)}
            className="bg-transparent border border-border rounded-md px-2 py-1 text-xs"
          >
            <option value="ALL">All types</option>
            <option value="timeline_bars">Bars</option>
            <option value="timeline_milestones">Milestones</option>
            <option value="timeline_versions">Versions</option>
          </select>
          {(search || opFilter !== "ALL" || tableFilter !== "ALL") && (
            <button
              onClick={() => {
                setSearch("");
                setOpFilter("ALL");
                setTableFilter("ALL");
              }}
              className="text-[11px] text-muted-foreground hover:text-foreground underline"
            >
              Reset
            </button>
          )}
        </div>

        <div className="overflow-auto flex-1">
          {loading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">
              {t("timelineauditlog.no_entries_match_these_filters")}
            </div>
          )}
          {!loading && pageRows.length > 0 && (
            <ul className="divide-y divide-border">
              {pageRows.map((r) => (
                <li key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{describe(r)}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        by {r.actor_id ? (emails[r.actor_id] ?? r.actor_id.slice(0, 8)) : "system"}
                      </div>
                    </div>
                    <time className="text-xs text-muted-foreground shrink-0" dir="ltr">
                      {new Date(r.created_at).toLocaleString()}
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
