import { formatAmount } from "@/lib/format-number";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Copy, Repeat } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { CleanBudgetResult } from "@/lib/budget-import-clean";
import { toImportRpcRows } from "@/lib/budget-import-clean";
import type { BudgetLine } from "@/lib/store";

export type ServerCheck = {
  status: "idle" | "checking" | "ok" | "errors" | "unavailable";
  errors: { row: number; messages: string[] }[];
  totalSar?: number;
};

/**
 * E13 / D01 — runs the database's own row checks (import_budget_preview,
 * db/pending/150 + 190) on the cleaned rows. Nothing is written. When the
 * function is not reachable the import keeps working with the in-app checks.
 */
export function useServerImportCheck(
  projectId: string | null,
  lines: BudgetLine[],
  rowOf?: Record<string, number>,
): ServerCheck {
  const [state, setState] = useState<ServerCheck>({ status: "idle", errors: [] });
  useEffect(() => {
    if (!projectId || lines.length === 0) {
      setState({ status: "idle", errors: [] });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, status: "checking" }));
    const timer = window.setTimeout(async () => {
      try {
        const { data, error } = await (
          supabase as unknown as {
            rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: any; error: any }>;
          }
        ).rpc("import_budget_preview", {
          p_project_id: projectId,
          p_lines: toImportRpcRows(lines, rowOf),
        });
        if (cancelled) return;
        if (error || !data) {
          setState({ status: "unavailable", errors: [] });
          return;
        }
        const errors = ((data.rows ?? []) as any[])
          .filter((r) => r.status === "error")
          .map((r) => ({ row: Number(r.row), messages: (r.messages ?? []) as string[] }));
        setState({
          status: errors.length ? "errors" : "ok",
          errors,
          totalSar: Number(data.summary?.total_sar ?? 0),
        });
      } catch {
        if (!cancelled) setState({ status: "unavailable", errors: [] });
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectId, lines, rowOf]);
  return state;
}

const fmt = (n: number) => formatAmount(n, 2);

export function ImportCleanReport({
  clean,
  server,
  keepDuplicates,
  onKeepDuplicates,
}: {
  clean: CleanBudgetResult;
  server: ServerCheck;
  keepDuplicates: boolean;
  onKeepDuplicates: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const dups = clean.issues.filter((i) => i.kind === "duplicate");
  const swaps = clean.issues.filter((i) => i.kind === "swapped");
  const ranges = clean.issues.filter((i) => i.kind === "out_of_range");
  const dupTotals = Object.entries(clean.stats.duplicateTotals)
    .map(([ccy, v]) => `${fmt(v)} ${ccy}`)
    .join(" + ");
  const where = (i: { sheet?: string; row?: number }) =>
    [i.sheet, i.row ? t("people.import.row", { row: i.row }) : null].filter(Boolean).join(" · ");

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3 text-sm space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold">{t("people.import.title")}</span>
        <span className="text-muted-foreground">
          {t("people.import.rows", { in: clean.stats.rowsIn, out: clean.stats.rowsOut })}
        </span>
        {clean.stats.trimmed > 0 && (
          <span className="text-muted-foreground">
            {t("people.import.trimmed", { count: clean.stats.trimmed })}
          </span>
        )}
        {clean.stats.rounded > 0 && (
          <span className="text-muted-foreground">
            {t("people.import.rounded", { count: clean.stats.rounded })}
          </span>
        )}
      </div>

      {dups.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-2 space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <Copy className="size-4 text-warning" />
            {keepDuplicates
              ? t("people.import.duplicates_kept", { count: dups.length })
              : t("people.import.duplicates_skipped", { count: dups.length, total: dupTotals })}
          </div>
          <ul className="text-[12px] max-h-32 overflow-auto space-y-0.5">
            {dups.slice(0, 50).map((d) => (
              <li key={d.lineId}>
                <bdi>
                  {d.mainCode} — {d.description}
                </bdi>{" "}
                <span className="text-muted-foreground">
                  ({where(d)} · {t("people.import.same_as", { row: d.detail })})
                </span>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={keepDuplicates}
              onChange={(e) => onKeepDuplicates(e.target.checked)}
              className="size-4 accent-[var(--brand)]"
            />
            {t("people.import.keep_duplicates")}
          </label>
        </div>
      )}

      {(swaps.length > 0 || ranges.length > 0) && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-2 space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <Repeat className="size-4 text-warning" />
            {t("people.import.header_main", { count: swaps.length + ranges.length })}
          </div>
          <ul className="text-[12px] max-h-32 overflow-auto space-y-0.5">
            {swaps.map((s) => (
              <li key={`s-${s.lineId}`}>
                {t("people.import.swapped", { was: s.detail, now: s.mainCode })}{" "}
                <span className="text-muted-foreground">({where(s)})</span>
              </li>
            ))}
            {ranges.map((s) => (
              <li key={`r-${s.lineId}`}>
                {t("people.import.out_of_range", { main: s.mainCode, header: s.detail })}{" "}
                <span className="text-muted-foreground">({where(s)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {server.status === "errors" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 space-y-1">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4" />
            {t("people.import.server_errors", { count: server.errors.length })}
          </div>
          <ul className="text-[12px] max-h-32 overflow-auto space-y-0.5">
            {server.errors.slice(0, 50).map((e, i) => (
              <li key={i}>
                {t("people.import.row", { row: e.row })}: {e.messages.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {server.status === "ok" && (
        <div className="flex items-center gap-2 text-[12px] text-success">
          <CheckCircle2 className="size-4" />
          {t("people.import.server_ok", { total: fmt(server.totalSar ?? 0) })}
        </div>
      )}
      {server.status === "checking" && (
        <div className="text-[12px] text-muted-foreground">
          {t("people.import.server_checking")}
        </div>
      )}
    </div>
  );
}
