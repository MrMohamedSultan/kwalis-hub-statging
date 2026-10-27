// =====================================================================
// Budget Reconciliation — Master Budget vs rolled-up Committed / Actuals
// for a selected date range, with CSV + PDF export.
// =====================================================================
import { DateInput } from "@/components/ui/date-input";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, Download, FileText, RefreshCw } from "lucide-react";
import { useMoney } from "@/lib/money-display";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SectionCard } from "@/components/chrome/SectionCard";
import { supabase } from "@/integrations/supabase/client";
import { formatSAR, useStore } from "@/lib/store";
import { PRESETS, presetRange, labelFor, type PresetKey } from "@/lib/date-range";
import { downloadCSV } from "@/lib/export-csv";
import { exportPdfReport } from "@/lib/export-pdf";

import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
/** Cent-safe rounding so repeated additions never drift. */
const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

type ReconRow = {
  budget_code: string;
  description: string;
  is_header: boolean;
  parent_code: string | null;
  currency: string;
  master_planned: number;
  master_actual: number;
  project_estimate: number;
  committed: number;
  actuals: number;
  variance: number;
  in_master: boolean;
};

export const Route = createFileRoute("/_authenticated/budget-reconciliation")({
  head: () => ({
    meta: [
      { title: "Budget Reconciliation — Kwalis HUB" },
      {
        name: "description",
        content:
          "Reconcile Master Budget planned and actual figures against rolled-up committed and paid amounts for any date range.",
      },
      { property: "og:title", content: "Budget Reconciliation — Kwalis HUB" },
      {
        property: "og:description",
        content: "Master Budget vs committed vs actuals reconciliation with CSV and PDF export.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <>
      <BudgetReconciliationPage />
    </>
  ),
});

function BudgetReconciliationPage() {
  useMoney(); // re-render amounts when the currency toggle changes
  const { t } = useTranslation();

  const activeProjectId = useStore((s) => s.activeProjectId);
  const projectName = useStore((s) => s.projectName);
  const projectCode = useStore(
    (s) => s.projects.find((p) => p.id === activeProjectId)?.code ?? null,
  );

  const [preset, setPreset] = useState<PresetKey>("all");
  const [range, setRange] = useState(() => presetRange("all"));
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyDiscrepancies, setOnlyDiscrepancies] = useState(false);
  // B19: hundreds of untouched codes — hidden by default
  const [hideZero, setHideZero] = useState(true);

  const applyPreset = (key: PresetKey) => {
    setPreset(key);
    if (key !== "custom") setRange(presetRange(key));
  };

  const load = useCallback(async () => {
    if (!activeProjectId) {
      setRows([]);
      return;
    }
    setLoading(true);
    const { data, error } = await (supabase.rpc as any)("get_budget_reconciliation", {
      _project: activeProjectId,
      _from: range.from || null,
      _to: range.to || null,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      setRows([]);
      return;
    }
    setRows(
      ((data ?? []) as ReconRow[]).map((r) => ({
        ...r,
        master_planned: money(r.master_planned),
        master_actual: money(r.master_actual),
        project_estimate: money(r.project_estimate),
        committed: money(r.committed),
        actuals: money(r.actuals),
        variance: money(r.variance),
      })),
    );
  }, [activeProjectId, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const nonZero = useMemo(
    () =>
      hideZero
        ? rows.filter((r) =>
            [r.master_planned, r.master_actual, r.project_estimate, r.committed, r.actuals].some(
              (v) => Math.abs(v) >= 0.005,
            ),
          )
        : rows,
    [rows, hideZero],
  );
  const visible = useMemo(
    () =>
      onlyDiscrepancies
        ? nonZero.filter(
            (r) =>
              !r.in_master ||
              r.is_header ||
              Math.abs(money(r.master_actual - r.actuals)) > 0.01 ||
              Math.abs(money(r.master_planned - r.project_estimate)) > 0.01,
          )
        : nonZero,
    [nonZero, onlyDiscrepancies],
  );

  const totals = useMemo(
    () =>
      visible.reduce(
        (a, r) => ({
          master_planned: money(a.master_planned + r.master_planned),
          master_actual: money(a.master_actual + r.master_actual),
          project_estimate: money(a.project_estimate + r.project_estimate),
          committed: money(a.committed + r.committed),
          actuals: money(a.actuals + r.actuals),
          variance: money(a.variance + r.variance),
        }),
        {
          master_planned: 0,
          master_actual: 0,
          project_estimate: 0,
          committed: 0,
          actuals: 0,
          variance: 0,
        },
      ),
    [visible],
  );

  const flagged = rows.filter((r) => !r.in_master || r.is_header);

  const periodLabel = labelFor(range);
  const fileBase = `budget-reconciliation_${projectCode ?? "project"}_${range.from || "all"}_${range.to || "all"}`;

  const csvRows = () =>
    visible.map((r) => ({
      "Budget Code": r.budget_code,
      Description: r.description,
      "In Master COA": r.in_master ? "Yes" : "No",
      "Header Account": r.is_header ? "Yes" : "No",
      Currency: r.currency,
      "Master Planned": r.master_planned,
      "Project Estimate": r.project_estimate,
      [i18n.t("glossary.term.commitment")]: r.committed,
      [i18n.t("glossary.term.actual")]: r.actuals,
      "Master Actual": r.master_actual,
      "Actuals Δ (Master − Rolled-up)": money(r.master_actual - r.actuals),
      [i18n.t("glossary.term.remaining")]: r.variance,
    }));

  const exportCsv = () => {
    if (visible.length === 0) return toast.error("Nothing to export");
    const totalsRow: Record<string, unknown> = {
      "Budget Code": "",
      Description: "TOTAL",
      "In Master COA": "",
      "Header Account": "",
      Currency: "",
      "Master Planned": totals.master_planned,
      "Project Estimate": totals.project_estimate,
      [i18n.t("glossary.term.commitment")]: totals.committed,
      [i18n.t("glossary.term.actual")]: totals.actuals,
      "Master Actual": totals.master_actual,
      "Actuals Δ (Master − Rolled-up)": money(totals.master_actual - totals.actuals),
      [i18n.t("glossary.term.remaining")]: totals.variance,
    };
    downloadCSV(`${fileBase}.csv`, [...csvRows(), totalsRow] as Record<string, unknown>[]);
    toast.success(t("budget_reconciliation.reconciliation_exported"));
  };

  const exportPdf = () => {
    if (visible.length === 0) return toast.error("Nothing to export");
    exportPdfReport(
      `${fileBase}.pdf`,
      [
        {
          title: `Budget Reconciliation — ${projectCode ? `[${projectCode}] ` : ""}${projectName ?? ""}`,
          subtitle: `Master Budget vs Committed vs Actuals · ${periodLabel}`,
          headers: [
            "Code",
            "Description",
            "Master Planned",
            "Estimate",
            i18n.t("glossary.term.commitment"),
            i18n.t("glossary.term.actual"),
            "Master Actual",
            "Δ Actuals",
            i18n.t("glossary.term.remaining"),
          ],
          rows: [
            ...visible.map((r) => [
              r.budget_code,
              `${r.description}${r.in_master ? "" : " (not in Master COA)"}${r.is_header ? " (header!)" : ""}`,
              r.master_planned,
              r.project_estimate,
              r.committed,
              r.actuals,
              r.master_actual,
              money(r.master_actual - r.actuals),
              r.variance,
            ]),
            [
              "",
              "TOTAL",
              totals.master_planned,
              totals.project_estimate,
              totals.committed,
              totals.actuals,
              totals.master_actual,
              money(totals.master_actual - totals.actuals),
              totals.variance,
            ],
          ],
          numericColumns: [2, 3, 4, 5, 6, 7, 8],
        },
      ],
      { documentTitle: "Budget Reconciliation", author: "Kwalis HUB" },
    );
  };

  return (
    <AppShell>
      <PageTitle title={t("budget_reconciliation.budget_reconciliation")} />

      <SectionCard title={t("budget_reconciliation.period_filters")}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${
                  preset === p.key
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border bg-surface-2 hover:bg-muted"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="text-xs text-muted-foreground">
            <div className="mb-1">From</div>
            <DateInput
              value={range.from ?? ""}
              onChange={(v) => {
                setPreset("custom");
                setRange((r) => ({ ...r, from: v }));
              }}
              className="px-2 py-1.5 rounded-lg border border-border bg-surface-2 text-sm"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            <div className="mb-1">To</div>
            <DateInput
              value={range.to ?? ""}
              onChange={(v) => {
                setPreset("custom");
                setRange((r) => ({ ...r, to: v }));
              }}
              className="px-2 py-1.5 rounded-lg border border-border bg-surface-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyDiscrepancies}
              onChange={(e) => setOnlyDiscrepancies(e.target.checked)}
            />
            {t("budget_reconciliation.only_discrepancies")}
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={hideZero}
              onChange={(e) => setHideZero(e.target.checked)}
            />
            {t("glossary.cost.hideZero")}
          </label>
          <div className="ms-auto flex gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs font-semibold hover:bg-muted"
            >
              <RefreshCw className="size-3.5" /> Refresh
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs font-semibold hover:bg-muted"
            >
              <Download className="size-3.5" /> CSV
            </button>
            <button
              type="button"
              onClick={exportPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs font-semibold hover:bg-muted"
            >
              <FileText className="size-3.5" /> PDF
            </button>
          </div>
        </div>
      </SectionCard>

      {flagged.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning"
        >
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="size-3.5" /> {flagged.length} code
            {flagged.length === 1 ? "" : "s"} need mapping attention
          </div>
          <div className="mt-1">
            {flagged
              .slice(0, 8)
              .map(
                (r) =>
                  `${r.budget_code}${r.is_header ? " (header account)" : " (missing from Master COA)"}`,
              )
              .join(" · ")}
            {flagged.length > 8 ? " …" : ""}
          </div>
        </div>
      )}

      <SectionCard title={`Reconciliation · ${periodLabel}`}>
        {loading ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            {activeProjectId
              ? "No budget activity in this period."
              : "Select a project to reconcile."}
          </p>
        ) : (
          <div className="overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-surface">
                <tr>
                  <th className="text-left py-2 px-3">Code</th>
                  <th className="text-left py-2 px-3">Description</th>
                  <th className="text-right py-2 px-3">
                    {t("budget_reconciliation.master_planned")}
                  </th>
                  <th className="text-right py-2 px-3">Estimate</th>
                  <th className="text-end py-2 px-3">{t("glossary.term.commitment")}</th>
                  <th className="text-end py-2 px-3">{t("glossary.term.actual")}</th>
                  <th className="text-right py-2 px-3">
                    {t("budget_reconciliation.master_actual")}
                  </th>
                  <th className="text-right py-2 px-3">Δ actuals</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const delta = money(r.master_actual - r.actuals);
                  return (
                    <tr key={r.budget_code} className="border-t border-border">
                      <td className="py-1.5 px-3 tabular-nums">{r.budget_code}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">
                        {r.description}
                        {!r.in_master && (
                          <span className="ms-1.5 text-[10px] rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-warning">
                            not in Master COA
                          </span>
                        )}
                        {r.is_header && (
                          <span className="ms-1.5 text-[10px] rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive">
                            header account
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums">
                        {formatSAR(r.master_planned)}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums">
                        {formatSAR(r.project_estimate)}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums">
                        {formatSAR(r.committed)}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums font-medium">
                        {formatSAR(r.actuals)}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">
                        {formatSAR(r.master_actual)}
                      </td>
                      <td
                        className={`py-1.5 px-3 text-right tabular-nums ${
                          Math.abs(delta) > 0.01 ? "text-warning" : "text-muted-foreground"
                        }`}
                      >
                        {formatSAR(delta)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-border font-semibold bg-surface">
                  <td className="py-2 px-3" />
                  <td className="py-2 px-3">TOTAL</td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {formatSAR(totals.master_planned)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {formatSAR(totals.project_estimate)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {formatSAR(totals.committed)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatSAR(totals.actuals)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {formatSAR(totals.master_actual)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {formatSAR(money(totals.master_actual - totals.actuals))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}
