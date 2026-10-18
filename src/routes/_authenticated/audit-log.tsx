import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import React, { useEffect, useMemo, useState } from "react";
import { ScrollText, RefreshCw, Search, AlertTriangle, Info, AlertCircle } from "lucide-react";
import { listAuditEvents } from "@/lib/audit.functions";
import { AppShell, BackButton } from "@/components/AppShell";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/audit-log")({
  component: () => (
    <>
      <AppShell>
        <AuditLogPage />
      </AppShell>
    </>
  ),
});

type AuditRow = {
  id: string;
  created_at: string;
  organization_id: string | null;
  project_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  category: "import" | "validation" | "schema" | "auth" | "other";
  action: string;
  severity: "info" | "warning" | "error";
  entity: string | null;
  summary: string;
  details: Record<string, unknown>;
};

const CATEGORIES = ["all", "import", "validation", "schema", "auth", "other"] as const;
const SEVERITIES = ["all", "info", "warning", "error"] as const;

function severityIcon(sev: AuditRow["severity"]) {
  if (sev === "error") return <AlertCircle className="size-3.5 text-destructive" />;
  if (sev === "warning") return <AlertTriangle className="size-3.5 text-warning" />;
  return <Info className="size-3.5 text-info" />;
}

function severityBadgeClass(sev: AuditRow["severity"]) {
  if (sev === "error") return "bg-destructive/15 text-destructive border-destructive/30";
  if (sev === "warning") return "bg-warning/15 text-warning border-warning/30";
  return "bg-info/15 text-info border-info/30";
}

function categoryBadgeClass(cat: AuditRow["category"]) {
  switch (cat) {
    case "import":
      return "bg-success/15 text-success border-success/30";
    case "validation":
      return "bg-highlight/15 text-highlight border-highlight/30";
    case "schema":
      return "bg-warning/15 text-warning border-warning/30";
    case "auth":
      return "bg-info/15 text-info border-info/30";
    default:
      return "bg-surface-2 text-muted-foreground border-border";
  }
}

function formatTimestamp(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
  } catch {
    return iso;
  }
}

export function AuditLogPage() {
  const { t } = useTranslation();

  const list = useServerFn(listAuditEvents);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("all");
  const [search, setSearch] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchRows = async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await list({
        data: {
          category: category === "all" ? null : category,
          severity: severity === "all" ? null : severity,
          search: search.trim() || null,
          user: userFilter.trim() || null,
          action: actionFilter.trim() || null,
          start_date: startDate ? new Date(startDate + "T00:00:00").toISOString() : null,
          end_date: endDate ? new Date(endDate + "T23:59:59").toISOString() : null,
          limit: 300,
        } as any,
      });
      setRows((data ?? []) as AuditRow[]);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [category, severity]);

  const counts = useMemo(() => {
    const c = { import: 0, validation: 0, schema: 0, auth: 0, other: 0 } as Record<string, number>;
    rows.forEach((r) => {
      c[r.category] = (c[r.category] ?? 0) + 1;
    });
    return c;
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <BackButton />
          <div className="size-10 rounded-xl bg-brand/15 text-brand grid place-items-center">
            <ScrollText className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Audit Log</h1>
            <p className="text-sm text-muted-foreground">
              Template imports, validation results, and schema changes — append-only history.
            </p>
          </div>
        </div>
        <button
          onClick={() => void fetchRows()}
          disabled={loading}
          className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-border bg-surface-2 hover:bg-surface text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(["import", "validation", "schema", "auth", "other"] as const).map((k) => (
          <div key={k} className="rounded-xl border border-border bg-card text-card-foreground p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div>
            <div className="text-xl font-semibold mt-0.5">{counts[k] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card text-card-foreground p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void fetchRows();
              }}
              placeholder={t("audit_log.search_summary_action_entity_user")}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-2 text-foreground placeholder:text-muted-foreground border border-border outline-none focus:ring-2 ring-brand/40 text-sm"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as any)}
            className="px-3 py-2 rounded-lg bg-surface-2 text-foreground border border-border text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "All categories" : c}
              </option>
            ))}
          </select>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as any)}
            className="px-3 py-2 rounded-lg bg-surface-2 text-foreground border border-border text-sm"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All severities" : s}
              </option>
            ))}
          </select>
          <input
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void fetchRows();
            }}
            placeholder={t("audit_log.user_email")}
            className="px-3 py-2 rounded-lg bg-surface-2 text-foreground placeholder:text-muted-foreground border border-border text-sm min-w-[160px]"
          />
          <input
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void fetchRows();
            }}
            placeholder={t("audit_log.action_eg_invoicecreate")}
            className="px-3 py-2 rounded-lg bg-surface-2 text-foreground placeholder:text-muted-foreground border border-border text-sm min-w-[180px]"
          />
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            From
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2 py-2 rounded-lg bg-surface-2 text-foreground border border-border text-sm"
            />
          </label>
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            To
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2 py-2 rounded-lg bg-surface-2 text-foreground border border-border text-sm"
            />
          </label>
          <button
            onClick={() => void fetchRows()}
            className="px-3 py-2 rounded-lg bg-brand text-brand-foreground text-sm font-semibold"
          >
            Apply
          </button>
          <button
            onClick={() => {
              setSearch("");
              setUserFilter("");
              setActionFilter("");
              setStartDate("");
              setEndDate("");
              setCategory("all");
              setSeverity("all");
              setTimeout(() => void fetchRows(), 0);
            }}
            className="px-3 py-2 rounded-lg border border-border text-foreground text-sm hover:bg-surface-2"
          >
            Reset
          </button>
        </div>

        {err && (
          <div className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded-lg p-3">
            {err}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left font-medium py-2 pr-3">When</th>
                <th className="text-left font-medium py-2 pr-3">Category</th>
                <th className="text-left font-medium py-2 pr-3">Action</th>
                <th className="text-left font-medium py-2 pr-3">Summary</th>
                <th className="text-left font-medium py-2 pr-3">Entity</th>
                <th className="text-left font-medium py-2 pr-3">User</th>
                <th className="text-left font-medium py-2 pr-3">Severity</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading audit history…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-muted-foreground">
                    {t("audit_log.no_audit_events_yet")}
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const isOpen = expanded === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr
                      className="border-b border-border hover:bg-surface-2 cursor-pointer text-foreground"
                      onClick={() => setExpanded(isOpen ? null : r.id)}
                    >
                      <td className="py-2.5 pr-3 whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(r.created_at)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`inline-flex items-center text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${categoryBadgeClass(r.category)}`}
                        >
                          {r.category}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 font-medium">{r.action}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{r.summary}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{r.entity ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        <div className="flex flex-col leading-tight">
                          <span>{r.actor_email ?? "—"}</span>
                          <span className="text-[10px] text-muted-foreground/70 font-mono">
                            {r.actor_id?.slice(0, 8) ?? ""}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${severityBadgeClass(r.severity)}`}
                        >
                          {severityIcon(r.severity)}
                          {r.severity}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-surface-2">
                        <td colSpan={7} className="px-4 py-3">
                          {(() => {
                            const d: any = r.details ?? {};
                            const hasDiff =
                              d && (d.old_value !== undefined || d.new_value !== undefined);
                            return hasDiff ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <div className="text-xs text-muted-foreground mb-1">
                                    {t("audit_log.old_value")}
                                  </div>
                                  <pre className="text-[11px] leading-relaxed font-mono bg-background text-foreground border border-border rounded-md p-3 overflow-x-auto max-h-72">
                                    {JSON.stringify(d.old_value ?? null, null, 2)}
                                  </pre>
                                </div>
                                <div>
                                  <div className="text-xs text-muted-foreground mb-1">
                                    {t("audit_log.new_value")}
                                  </div>
                                  <pre className="text-[11px] leading-relaxed font-mono bg-background text-foreground border border-border rounded-md p-3 overflow-x-auto max-h-72">
                                    {JSON.stringify(d.new_value ?? null, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="text-xs text-muted-foreground mb-1">Details</div>
                                <pre className="text-[11px] leading-relaxed font-mono bg-background text-foreground border border-border rounded-md p-3 overflow-x-auto max-h-72">
                                  {JSON.stringify(d, null, 2)}
                                </pre>
                              </>
                            );
                          })()}
                          <div className="mt-2 text-[11px] text-muted-foreground">
                            event id: <span className="font-mono">{r.id}</span>
                            {r.organization_id && (
                              <>
                                {" "}
                                · org:{" "}
                                <span className="font-mono">{r.organization_id.slice(0, 8)}</span>
                              </>
                            )}
                            {r.project_id && (
                              <>
                                {" "}
                                · project:{" "}
                                <span className="font-mono">{r.project_id.slice(0, 8)}</span>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
