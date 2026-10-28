// ═══════════════════════════════════════════════════════════════════
// N10 — Budget Change Log report (Film Commission claim attachment):
// line, value before, value after, change, user, date, reason. Filters by
// date, version and "amount changes only"; exports CSV and PDF.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/date-format";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, FileText, Loader2 } from "lucide-react";

import { useStore } from "@/lib/store";
import { formatAmount } from "@/lib/format-number";
import { downloadCSV } from "@/lib/export-csv";
import { exportPdfReport } from "@/lib/export-pdf";
import { changeDelta, fetchBudgetChangeLog, filterChangeLog } from "./budget-change-log-data";

const money = (n: number | null) => (n == null ? "—" : formatAmount(n, 2));

export function BudgetChangeLogReport() {
  const { t, i18n } = useTranslation();
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  const projectId = project?.id ?? null;

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [version, setVersion] = useState("all");
  const [amountOnly, setAmountOnly] = useState(true);
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["budget-change-log", projectId],
    enabled: !!projectId,
    staleTime: 60_000,
    queryFn: () => fetchBudgetChangeLog(projectId as string),
  });
  const all = q.data ?? [];
  const versions = useMemo(
    () =>
      Array.from(new Set(all.map((r) => r.version_name).filter((v): v is string => !!v))).sort(),
    [all],
  );
  const rows = useMemo(
    () => filterChangeLog(all, { from, to, version, amountOnly, search }),
    [all, from, to, version, amountOnly, search],
  );
  const net = rows.reduce((s, r) => s + changeDelta(r), 0);

  const headers = [
    t("refs.bcl_date"),
    t("refs.bcl_line"),
    t("refs.bcl_version"),
    t("refs.bcl_action"),
    t("refs.bcl_before"),
    t("refs.bcl_after"),
    t("refs.bcl_change"),
    t("refs.bcl_user"),
    t("refs.bcl_reason"),
  ];
  const tableRows = rows.map((r) => [
    formatDateTime(r.changed_at),
    [r.budget_code, r.description].filter(Boolean).join(" — "),
    r.version_name ?? "",
    t(`refs.action_${r.action}`),
    money(r.before_sar),
    money(r.after_sar),
    money(changeDelta(r)),
    r.actor_name ?? t("refs.system"),
    r.reason ?? "",
  ]);
  const slug = project?.code ?? "project";

  const exportCsv = () =>
    downloadCSV(
      `budget-change-log-${slug}.csv`,
      tableRows.map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i]]))),
      headers,
    );
  const exportPdf = () =>
    void exportPdfReport(
      `budget-change-log-${slug}.pdf`,
      [
        {
          title: t("refs.bcl_title"),
          subtitle: `${project?.code ?? ""} ${project?.name ?? ""} · SAR`,
          headers,
          rows: tableRows,
          numericColumns: [4, 5, 6],
        },
      ],
      {
        documentTitle: `Kwalis Hub — ${t("refs.bcl_title")}`,
        direction: i18n.language === "ar" ? "rtl" : "ltr",
      },
    );

  const input =
    "rounded-lg bg-surface-2 border border-border px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-brand/40";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("refs.bcl_title")}</h2>
          <p className="text-xs text-muted-foreground">{t("refs.bcl_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-40"
          >
            <Download className="size-3.5" />
            {t("refs.export_csv")}
          </button>
          <button
            type="button"
            onClick={exportPdf}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-40"
          >
            <FileText className="size-3.5" />
            {t("refs.export_pdf")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("refs.bcl_from")}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("refs.bcl_to")}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("refs.bcl_version")}
          <select value={version} onChange={(e) => setVersion(e.target.value)} className={input}>
            <option value="all">{t("refs.bcl_all_versions")}</option>
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground min-w-[180px] flex-1">
          {t("refs.bcl_search")}
          <input
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
            className={input}
          />
        </label>
        <label className="inline-flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={amountOnly}
            onChange={(e) => setAmountOnly(e.target.checked)}
          />
          {t("refs.bcl_amount_only")}
        </label>
      </div>

      {q.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("common.loading")}
        </div>
      )}
      {q.isError && <div className="text-sm text-destructive">{t("refs.bcl_error")}</div>}

      {!q.isLoading && !q.isError && (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted-foreground">
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={h}
                    className={`px-3 py-2 font-medium ${i >= 4 && i <= 6 ? "text-end" : "text-start"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={headers.length}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    {t("refs.bcl_empty")}
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const d = changeDelta(r);
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-xs tabular-nums">
                      {formatDateTime(r.changed_at)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs" dir="ltr">
                        {r.budget_code}
                      </span>{" "}
                      {r.description}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.version_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{t(`refs.action_${r.action}`)}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{money(r.before_sar)}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{money(r.after_sar)}</td>
                    <td
                      className={`px-3 py-2 text-end tabular-nums font-semibold ${d > 0 ? "text-destructive" : d < 0 ? "text-success" : ""}`}
                    >
                      {money(d)}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.actor_name ?? t("refs.system")}</td>
                    <td className="px-3 py-2 text-xs">{r.reason ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td colSpan={6} className="px-3 py-2">
                    {t("refs.bcl_net_change", { count: rows.length })}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{money(net)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
