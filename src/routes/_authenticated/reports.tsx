import { createFileRoute, Link } from "@tanstack/react-router";
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import { convertForDisplay, displayCurrencyCode, useMoney } from "@/lib/money-display";
import {
  exportReportPdf,
  exportReportXlsx,
  type ReportColumn,
  type ReportDoc,
} from "@/lib/export/xlsx-report";
import { formatDate } from "@/lib/date-format";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { useStore, lineTotal, formatUSD } from "@/lib/store";
import { HEADER_ACCOUNTS } from "@/lib/data";
import { supabase } from "@/integrations/supabase/client";
import {
  FileSpreadsheet,
  FileText,
  Loader2,
  ExternalLink,
  Search,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useGlAccounts, GL_CATEGORIES, type GlAccountCategory } from "@/lib/gl-accounts";
import { GlTransactionsReport } from "@/features/reports/gl-transactions/GlTransactionsReport";
import { LEDGER_TABS, LedgerTab, isLedgerTab } from "@/features/reports/ledger/LedgerTabs";
import { BudgetChangeLogReport } from "@/features/reports/budget-change-log/BudgetChangeLogReport";
import {
  SOURCE_LABELS,
  type GlTransactionSource,
} from "@/features/reports/gl-transactions/gl-transactions-data";
import { SOURCE_TABLE_BY_TYPE } from "@/components/BudgetLineActualsModal";
import { SarAmount } from "@/components/ui/currency";
import { exportRebateWorkbook } from "@/lib/exportRebate";
import { getSupportingDocUrl } from "@/lib/supporting-docs";
import { buildQfeLedger, type QfeLedgerRow } from "@/lib/qfeLedger";
import { useSearchHotkey } from "@/hooks/use-search-hotkey";
import { AuditHistoryPanel } from "@/components/AuditHistoryPanel";
import { useSeriesBudget } from "@/lib/series-budget";

import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/reports")({
  component: () => (
    <>
      <AppShell>
        <ReportsPage />
      </AppShell>
    </>
  ),
});

const GROUPS = ["ATL", "BTL", "Post", "Music", "VFX", "Other"] as const;

// Source-of-truth slot amount: prefer the schedule percent, fall back to even split.
function slotAmount(total: number, percents: number[] | undefined, idx: number, slots: number) {
  const fallback = slots > 0 ? 100 / slots : 0;
  const pct = Number(percents?.[idx] ?? fallback);
  return total * (pct / 100);
}

// ── Report export plumbing (G03) ─────────────────────────────────────────
type ReportExport = {
  doc: ReportDoc;
  /** Optional Excel override (e.g. the official Film Commission template). */
  excel?: () => Promise<void>;
};
type ExportBuilder = () => ReportExport | null;
const ReportExportContext = createContext<{ current: ExportBuilder | null } | null>(null);

/** Register the visible tab's export: it must describe exactly what is on screen. */
function useReportExport(builder: ExportBuilder) {
  const ref = useContext(ReportExportContext);
  useEffect(() => {
    if (ref) ref.current = builder;
  });
  useEffect(
    () => () => {
      if (ref) ref.current = null;
    },
    [ref],
  );
}

/** Stored SAR figure in the display currency (what the screen shows), to the halala. */
const dm = (n: number) => convertForDisplay(Number(n) || 0, 2);
const moneyCol = (label: string): ReportColumn => ({
  header: `${label} (${displayCurrencyCode()})`,
  type: "money",
});
const currencyNote = () => `${i18n.t("exports.currency")}: ${displayCurrencyCode()}`;

function ReportsPage() {
  useMoney(); // re-render report tables when the currency toggle changes
  const { t } = useTranslation();

  const [tab, setTab] = useState<
    | "gl"
    | "glacct"
    | "gltx"
    | "paid"
    | "final"
    | "rebate"
    | "qfe"
    | "tracking"
    | "vat"
    | "gosi"
    | (typeof LEDGER_TABS)[number]
    | "budgetlog"
  >("final");
  const [exporting, setExporting] = useState<null | "excel" | "pdf">(null);
  const exportRef = useRef<ExportBuilder | null>(null);
  const [seasonFilter, setSeasonFilterState] = useState<string>("all");
  const activeProjectId = useStore((s) => s.activeProjectId);
  const seasonFilterKey = activeProjectId ? `kwalis.seasonFilter.${activeProjectId}` : null;
  useEffect(() => {
    if (!seasonFilterKey) return;
    try {
      const saved = localStorage.getItem(seasonFilterKey);
      if (saved) setSeasonFilterState(saved);
      else setSeasonFilterState("all");
    } catch {
      /* ignore */
    }
  }, [seasonFilterKey]);
  const setSeasonFilter = (v: string) => {
    setSeasonFilterState(v);
    try {
      if (seasonFilterKey) localStorage.setItem(seasonFilterKey, v);
    } catch {
      /* ignore */
    }
  };
  // ── Export (G03 / D12): ONE Excel + PDF button pair for the whole page.
  // The visible tab registers a builder that returns exactly what is on
  // screen (after its filters, in the display currency).
  const runExport = async (kind: "excel" | "pdf") => {
    if (exporting) return;
    const built = exportRef.current?.();
    if (!built) {
      toast.error(t("exports.nothing_to_export"));
      return;
    }
    setExporting(kind);
    try {
      if (kind === "excel") {
        if (built.excel) await built.excel();
        else await exportReportXlsx(built.doc);
        toast.success(t("reports.report_exported_to_excel"));
      } else {
        await exportReportPdf(built.doc);
        toast.success(t("reports.report_exported_to_pdf"));
      }
    } catch (e) {
      console.error(e);
      toast.error(
        kind === "excel" ? t("reports.excel_export_failed") : t("exports.pdf_export_failed"),
      );
    } finally {
      setExporting(null);
    }
  };

  const tabs = [
    ["gl", "GL Report"],
    ["glacct", "By GL Account"],
    ["gltx", t("reports.gl_transactions")],
    ["paid", "Actual Paid"],
    ["final", "Final Report"],
    ["rebate", "Saudi Film Commission Rebate"],
    ["qfe", "QFE Rebate Report"],
    ["tracking", "Rebate Tracking"],
    ["vat", "Tax & VAT Compliance"],
    ["gosi", "GOSI & Localization"],
    ...LEDGER_TABS.map((k) => [k, t(`journal.tab.${k}`)] as const),
    ["budgetlog", t("refs.bcl_title")],
  ] as const;
  return (
    <>
      <PageTitle
        title={t("reports.reports")}
        action={
          // The GL Transactions tab has its own export buttons gated on the
          // gl_transactions/export permission — the page-level exporter would
          // fall through to the GOSI dataset for this tab, so hide it there.
          tab === "gltx" || isLedgerTab(tab) || tab === "budgetlog" ? null : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => runExport("excel")}
                disabled={exporting !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-success/20 text-success border border-success/30 hover:bg-success/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting === "excel" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="size-4" />
                )}
                {t("exports.export_excel")}
              </button>
              <button
                onClick={() => runExport("pdf")}
                disabled={exporting !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive/20 text-destructive border border-destructive/30 hover:bg-destructive/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting === "pdf" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4" />
                )}
                {t("exports.export_pdf")}
              </button>
            </div>
          )
        }
      />
      {exporting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8 shadow-xl">
            <Loader2 className="size-10 animate-spin text-brand" />
            <p className="text-sm font-semibold text-foreground">
              {exporting === "pdf" ? t("exports.compiling_pdf") : t("exports.compiling_excel")}
            </p>
          </div>
        </div>
      )}
      <div className="flex gap-2 mb-5 flex-wrap">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-5 py-2 rounded-full text-sm font-semibold ${tab === k ? "bg-brand text-brand-foreground" : "bg-surface hover:bg-muted"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <ReportExportContext.Provider value={exportRef}>
        {tab === "gl" && <GLReport />}
        {tab === "glacct" && <GlAccountReport />}
        {tab === "gltx" && <GlTransactionsReport />}
        {tab === "paid" && <PaidReport />}
        {tab === "final" && (
          <FinalReport seasonFilter={seasonFilter} setSeasonFilter={setSeasonFilter} />
        )}
        {tab === "rebate" && <RebateReport />}
        {tab === "qfe" && <QfeRebateAuditReport />}
        {tab === "tracking" && <RebateTrackingReport />}
        {tab === "vat" && <VatReport />}
        {tab === "gosi" && <GosiReport />}
        {isLedgerTab(tab) && <LedgerTab tab={tab} />}
        {tab === "budgetlog" && <BudgetChangeLogReport />}
      </ReportExportContext.Provider>
    </>
  );
}

function useSummary() {
  const { budget, payroll, invoices, receipts } = useStore();
  return useMemo(() => {
    const deptToGroup = new Map<string, string>();
    HEADER_ACCOUNTS.forEach((h) => {
      deptToGroup.set(h.name.toUpperCase(), h.group);
      deptToGroup.set(h.code, h.group);
    });
    // Skip payroll rows that mirror an invoice split (avoid double-counting with invoice math).
    const payrollRows = payroll.filter((r) => !(r.refId ?? "").startsWith("invoice:"));
    const rows = GROUPS.map((g) => {
      const lines = budget.filter((b) => b.group === g);
      const budgetTotal = lines.reduce((a, l) => a + lineTotal(l), 0);
      const payrollPaid = payrollRows.reduce((a, r) => {
        const grp = r.kind === "cast" ? "ATL" : "BTL";
        if (grp !== g) return a;
        return (
          a +
          r.payments.reduce(
            (s, p, i) =>
              s + (p === "Paid" ? slotAmount(r.totalAmount, r.percents, i, r.payments.length) : 0),
            0,
          )
        );
      }, 0);
      const invoicePaid = invoices.reduce((a, i) => {
        const grp = deptToGroup.get((i.department ?? "").toUpperCase()) ?? "BTL";
        if (grp !== g) return a;
        const term = Math.max(0, Math.min(100, Number(i.paymentTerm ?? 100)));
        return a + i.price * (term / 100);
      }, 0);
      const invoiceCommit = invoices.reduce((a, i) => {
        const grp = deptToGroup.get((i.department ?? "").toUpperCase()) ?? "BTL";
        if (grp !== g) return a;
        const term = Math.max(0, Math.min(100, Number(i.paymentTerm ?? 100)));
        return a + i.price * ((100 - term) / 100);
      }, 0);
      const receiptsPaid = receipts.reduce((a, r) => {
        const grp = deptToGroup.get((r.department ?? "").toUpperCase()) ?? "BTL";
        return grp === g ? a + Number(r.amount || 0) : a;
      }, 0);
      const actualPaid = payrollPaid + invoicePaid + receiptsPaid;
      const commitments =
        invoiceCommit +
        payrollRows.reduce((a, r) => {
          const grp = r.kind === "cast" ? "ATL" : "BTL";
          if (grp !== g) return a;
          return (
            a +
            r.payments.reduce(
              (s, p, i) =>
                s + (p === "Due" ? slotAmount(r.totalAmount, r.percents, i, r.payments.length) : 0),
              0,
            )
          );
        }, 0);
      const efc = Math.max(budgetTotal, actualPaid + commitments);
      return {
        group: g,
        actualPaid,
        commitments,
        budget: budgetTotal,
        efc,
        variance: budgetTotal - efc,
      };
    });
    const totals = rows.reduce(
      (a, r) => ({
        actualPaid: a.actualPaid + r.actualPaid,
        commitments: a.commitments + r.commitments,
        budget: a.budget + r.budget,
        efc: a.efc + r.efc,
        variance: a.variance + r.variance,
      }),
      { actualPaid: 0, commitments: 0, budget: 0, efc: 0, variance: 0 },
    );
    return { rows, totals };
  }, [budget, payroll, invoices, receipts]);
}

function FinalReport({
  seasonFilter,
  setSeasonFilter,
}: {
  seasonFilter: string;
  setSeasonFilter: (v: string) => void;
}) {
  const { t } = useTranslation();

  const { rows, totals } = useSummary();
  const series = useSeriesBudget();
  const filteredBySeason =
    seasonFilter === "all"
      ? series.bySeason
      : series.bySeason.filter((s) => s.season.id === seasonFilter);
  const filteredAllocated = filteredBySeason.reduce((a, s) => a + s.allocated, 0);
  const filteredEpisodeCount = filteredBySeason.reduce((a, s) => a + s.episodes.length, 0);
  const seriesVariance = totals.budget - filteredAllocated;

  const groupCols = ["ATL", "BTL", "Post", "VFX", "Music", "Other"] as const;
  const byGroup = Object.fromEntries(rows.map((r) => [r.group, r]));
  const cell = (g: string, key: "actualPaid" | "commitments" | "budget" | "efc" | "variance") =>
    Number((byGroup[g] as any)?.[key] ?? 0);
  const metricRows: Array<{
    label: string;
    key: "budget" | "actualPaid" | "commitments" | "efc" | "variance";
    tone?: "variance";
  }> = [
    { label: "Budget", key: "budget" },
    { label: "Actual Paid", key: "actualPaid" },
    { label: "Commitments", key: "commitments" },
    { label: "Estimated Final Cost", key: "efc" },
    { label: "Variance", key: "variance", tone: "variance" },
  ];

  useReportExport(() => ({
    doc: {
      report: "Cost Report",
      title: "Cost Report — Estimated Final Cost",
      subtitle: currencyNote(),
      sections: [
        {
          title: "Cost Report — Estimated Final Cost",
          columns: [{ header: "Metric" }, ...groupCols.map((g) => moneyCol(g)), moneyCol("TOTAL")],
          rows: metricRows.map(({ label, key }) => [
            label,
            ...groupCols.map((g) => dm(cell(g, key))),
            dm(Number(totals[key] ?? 0)),
          ]),
        },
        ...(series.isSeries
          ? [
              {
                title: `Series Episode Allocations · ${
                  seasonFilter === "all"
                    ? i18n.t("reports.all_seasons")
                    : filteredBySeason
                        .map(({ season }) => `S${season.season_number} — ${season.title}`)
                        .join(", ")
                }`,
                columns: [
                  { header: "Season" },
                  { header: "Episodes", type: "integer" as const },
                  moneyCol("Allocated"),
                  { header: "% of Budget", type: "percent" as const },
                  moneyCol("Avg / Episode"),
                ],
                rows: filteredBySeason.map(({ season, episodes, allocated }) => [
                  `S${season.season_number} — ${season.title}`,
                  episodes.length,
                  dm(allocated),
                  totals.budget > 0 ? (allocated / totals.budget) * 100 : 0,
                  dm(episodes.length > 0 ? allocated / episodes.length : 0),
                ]),
                totals: [
                  [
                    i18n.t("reports.total_allocated"),
                    filteredEpisodeCount,
                    dm(filteredAllocated),
                    totals.budget > 0 ? (filteredAllocated / totals.budget) * 100 : 0,
                    dm(filteredEpisodeCount > 0 ? filteredAllocated / filteredEpisodeCount : 0),
                  ],
                  [
                    "Allocation Variance (Budget − Allocated)",
                    null,
                    null,
                    null,
                    dm(seriesVariance),
                  ],
                ],
              },
            ]
          : []),
      ],
    },
  }));

  return (
    <Panel>
      <h3 className="text-lg font-semibold mb-4">Cost Report — Estimated Final Cost</h3>
      <div className="overflow-x-auto">
        <table className="app-table w-full">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wider">
                Metric
              </th>
              {groupCols.map((g) => (
                <th
                  key={g}
                  className="px-4 py-2 text-right font-medium text-xs uppercase tracking-wider"
                >
                  {g}
                </th>
              ))}
              <th className="px-4 py-2 text-right font-medium text-xs uppercase tracking-wider bg-surface">
                TOTAL
              </th>
            </tr>
          </thead>
          <tbody>
            {metricRows.map(({ label, key, tone }) => (
              <tr key={key} className="border-b border-border">
                <td className="px-4 py-3 font-semibold">{label}</td>
                {groupCols.map((g) => {
                  const v = cell(g, key);
                  const cls =
                    tone === "variance"
                      ? v < 0
                        ? "text-destructive font-semibold"
                        : "text-success font-semibold"
                      : "";
                  return (
                    <td key={g} className={`px-4 py-3 text-right tabular-nums ${cls}`}>
                      {formatUSD(v)}
                    </td>
                  );
                })}
                <td
                  className={`px-4 py-3 text-right tabular-nums bg-surface font-semibold ${
                    tone === "variance"
                      ? Number(totals[key]) < 0
                        ? "text-destructive"
                        : "text-success"
                      : ""
                  }`}
                >
                  {formatUSD(Number(totals[key] ?? 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {series.isSeries && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Series Episode Allocations · {filteredBySeason.length} of {series.seasonCount} season
              {series.seasonCount === 1 ? "" : "s"} · {filteredEpisodeCount} episode
              {filteredEpisodeCount === 1 ? "" : "s"}
            </h4>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t("reports.filter_by_season")}
              <select
                value={seasonFilter}
                onChange={(e) => setSeasonFilter(e.target.value)}
                className="bg-surface border border-border rounded px-2 py-1 text-foreground"
              >
                <option value="all">{t("reports.all_seasons")}</option>
                {series.bySeason.map(({ season }) => (
                  <option key={season.id} value={season.id}>
                    S{season.season_number} — {season.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="app-table w-full">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  {["Season", "Episodes", "Allocated", "% of Budget", "Avg / Episode"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredBySeason.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-muted-foreground">
                      {t("reports.no_seasons_match_the_filter")}
                    </td>
                  </tr>
                ) : (
                  filteredBySeason.map(({ season, episodes, allocated }) => (
                    <tr key={season.id} className="border-b border-border hover:bg-muted">
                      <td className="px-4 py-3 font-medium">
                        <Link
                          to="/series/$seasonId"
                          params={{ seasonId: season.id }}
                          className="text-brand hover:underline"
                        >
                          S{season.season_number} — {season.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{episodes.length}</td>
                      <td className="px-4 py-3">
                        {allocated > 0 ? (
                          formatUSD(allocated)
                        ) : (
                          <span className="text-warning text-xs">Unallocated</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {totals.budget > 0 ? ((allocated / totals.budget) * 100).toFixed(1) : "0.0"}
                        %
                      </td>
                      <td className="px-4 py-3">
                        {formatUSD(episodes.length > 0 ? allocated / episodes.length : 0)}
                      </td>
                    </tr>
                  ))
                )}
                <tr className="bg-surface-2 font-semibold">
                  <td className="px-4 py-3">{t("reports.total_allocated")}</td>
                  <td className="px-4 py-3">{filteredEpisodeCount}</td>
                  <td className="px-4 py-3">{formatUSD(filteredAllocated)}</td>
                  <td className="px-4 py-3">
                    {totals.budget > 0
                      ? ((filteredAllocated / totals.budget) * 100).toFixed(1)
                      : "0.0"}
                    %
                  </td>
                  <td className="px-4 py-3">
                    {formatUSD(
                      filteredEpisodeCount > 0 ? filteredAllocated / filteredEpisodeCount : 0,
                    )}
                  </td>
                </tr>
                <tr className="bg-surface-2/60">
                  <td className="px-4 py-3 font-semibold">
                    Allocation Variance (Budget − Allocated)
                  </td>
                  <td className="px-4 py-3" colSpan={3}></td>
                  <td
                    className={`px-4 py-3 font-semibold ${seriesVariance < 0 ? "text-destructive" : "text-success"}`}
                  >
                    {formatUSD(seriesVariance)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

function GLReport() {
  const { t } = useTranslation();

  const budget = useStore((s) => s.budget);
  const payroll = useStore((s) => s.payroll); // re-fetch when Paid status changes
  const [actuals, setActuals] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("master_budget" as any)
        .select("budget_code, actual_amount");
      if (error || cancelled || !data) return;
      const map: Record<string, number> = {};
      for (const row of data as unknown as Array<{
        budget_code: string;
        actual_amount: number | null;
      }>) {
        map[row.budget_code] = Number(row.actual_amount ?? 0);
      }
      setActuals(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [payroll]);

  useReportExport(() => {
    const rows = budget.map((b) => {
      const planned = lineTotal(b);
      const actual = actuals[b.mainCode] ?? 0;
      return [
        b.headerCode,
        b.mainCode,
        b.description ?? "",
        b.group ?? "",
        dm(planned),
        dm(actual),
        dm(planned - actual),
      ];
    });
    const sum = (i: number) => rows.reduce((a, r) => a + Number(r[i] || 0), 0);
    return {
      doc: {
        report: "GL Report",
        title: t("reports.general_ledger"),
        subtitle: currencyNote(),
        sections: [
          {
            columns: [
              { header: "Header" },
              { header: "Main" },
              { header: "Description" },
              { header: "Group" },
              moneyCol("Budget"),
              moneyCol("Actual"),
              moneyCol("Variance"),
            ],
            rows,
            totals: [[i18n.t("common.total"), "", "", "", sum(4), sum(5), sum(6)]],
          },
        ],
      },
    };
  });

  return (
    <Panel>
      <h3 className="text-lg font-semibold mb-4">{t("reports.general_ledger")}</h3>
      <div className="overflow-x-auto">
        <table className="app-table w-full">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              {["Header", "Main", "Description", "Group", "Budget", "Actual", "Variance"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-left text-xs uppercase tracking-wider font-medium"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {budget.map((b) => {
              const planned = lineTotal(b);
              const actual = actuals[b.mainCode] ?? 0;
              const variance = planned - actual;
              return (
                <tr key={b.id} className="border-b border-border">
                  <td className="px-4 py-3 font-mono">{b.headerCode}</td>
                  <td className="px-4 py-3 font-mono">{b.mainCode}</td>
                  <td className="px-4 py-3">{b.description}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 rounded-full bg-brand/30">{b.group}</span>
                  </td>
                  <td className="px-4 py-3 font-semibold">{formatUSD(planned)}</td>
                  <td className="px-4 py-3 font-semibold">{formatUSD(actual)}</td>
                  <td
                    className={`px-4 py-3 font-semibold ${variance < 0 ? "text-destructive" : "text-success"}`}
                  >
                    {formatUSD(variance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// Actual Paid — straight from the canonical payments ledger
// (public.payments). Same source as v_project_position.paid_sar,
// so the total here reconciles exactly with the dashboard Paid
// card and the budget drill-down.
// ─────────────────────────────────────────────────────────────
type PaidLedgerRow = {
  id: string;
  sourceType: string;
  counterparty: string | null;
  method: string | null;
  date: string | null;
  budgetCode: string | null;
  amount: number;
};

/** Column holding each source table's counterparty display value. */
const PAID_SOURCE_NAME_COL: Record<string, string> = {
  invoices: "vendor_name",
  purchase_orders: "vendor_name",
  payroll: "name",
  cash_advance_receipts: "description",
  overtime_entries: "person_name",
  per_diem_ledger: "person_id", // resolved to people.full_name below
};

function PaidReport() {
  const { t } = useTranslation();
  const { activeProjectId } = useStore();
  const [rows, setRows] = useState<PaidLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeProjectId) {
        setRows([]);
        setLoading(false);
        return;
      }
      setLoading(true);

      const { data: pays } = await supabase
        .from("payments")
        .select("id, source_type, source_id, payment_date, method, amount")
        .eq("project_id", activeProjectId)
        .order("payment_date", { ascending: false });
      const payRows = (pays ?? []) as any[];

      // Resolve each payment's counterparty + budget code through its
      // source row (source_type → table mapping shared with
      // BudgetLineActualsModal — one definition, no drift).
      const idsByTable = new Map<string, Set<string>>();
      for (const p of payRows) {
        const table = SOURCE_TABLE_BY_TYPE[String(p.source_type ?? "")];
        if (!table || !p.source_id) continue;
        let set = idsByTable.get(table);
        if (!set) idsByTable.set(table, (set = new Set()));
        set.add(String(p.source_id));
      }
      const srcById = new Map<
        string,
        { code: string | null; name: string | null; personId: string | null }
      >();
      await Promise.all(
        [...idsByTable.entries()].map(async ([table, ids]) => {
          const col = PAID_SOURCE_NAME_COL[table];
          if (!col) return;
          const { data } = await supabase
            .from(table as any)
            .select(`id, budget_code, ${col}`)
            .in("id", [...ids]);
          for (const r of (data ?? []) as any[]) {
            const raw = (r[col] as string | null) ?? null;
            srcById.set(String(r.id), {
              code: (r.budget_code as string | null) ?? null,
              name: table === "per_diem_ledger" ? null : raw,
              personId: table === "per_diem_ledger" ? raw : null,
            });
          }
        }),
      );
      // Per-diem rows reference people — resolve display names.
      const personIds = [...srcById.values()]
        .map((v) => v.personId)
        .filter((v): v is string => !!v);
      if (personIds.length) {
        const { data: persons } = await supabase
          .from("people")
          .select("id, full_name")
          .in("id", personIds);
        const nameByPerson = new Map(
          (persons ?? []).map((p: any) => [String(p.id), p.full_name as string | null]),
        );
        for (const v of srcById.values()) {
          if (v.personId) v.name = nameByPerson.get(v.personId) ?? null;
        }
      }

      if (cancelled) return;
      setRows(
        payRows.map((p) => {
          const src = p.source_id ? srcById.get(String(p.source_id)) : undefined;
          return {
            id: String(p.id),
            sourceType: String(p.source_type ?? ""),
            counterparty: src?.name ?? null,
            method: (p.method as string | null) ?? null,
            date: (p.payment_date as string | null) ?? null,
            budgetCode: src?.code ?? null,
            amount: Number(p.amount) || 0,
          };
        }),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  // G03: export the payments ledger shown here (it was empty before because
  // the old exporter read a different, client-side list).
  useReportExport(() =>
    loading
      ? null
      : {
          doc: {
            report: "Payments Register",
            title: t("reports.actual_paid"),
            subtitle: `${i18n.t("exports.currency")}: SAR`,
            sections: [
              {
                columns: [
                  { header: "Date", type: "date" },
                  { header: t("reports.paid_col_source") },
                  { header: t("reports.paid_col_name") },
                  { header: "Method" },
                  { header: "Budget Code" },
                  { header: `${t("reports.paid_col_amount")} (SAR)`, type: "money" },
                ],
                rows: rows.map((r) => [
                  r.date,
                  SOURCE_LABELS[r.sourceType as GlTransactionSource] ?? r.sourceType,
                  r.counterparty ?? "",
                  r.method ?? "",
                  r.budgetCode ?? "",
                  r.amount,
                ]),
                totals: [[t("reports.paid_total"), "", "", "", "", total]],
              },
            ],
          },
        },
  );

  return (
    <Panel>
      <h3 className="text-lg font-semibold mb-1">{t("reports.actual_paid")}</h3>
      <p className="text-xs text-muted-foreground mb-4">{t("exports.paid_caption")}</p>
      <div className="overflow-x-auto">
        <table className="app-table w-full">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              {[
                t("reports.paid_col_source"),
                t("reports.paid_col_name"),
                t("reports.paid_col_detail"),
                t("reports.paid_col_amount"),
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2 text-left text-xs uppercase tracking-wider font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  {t("reports.paid_loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  {t("reports.paid_empty")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-border">
                  <td className="px-4 py-3">
                    {SOURCE_LABELS[r.sourceType as GlTransactionSource] ?? r.sourceType}
                  </td>
                  <td className="px-4 py-3 font-medium">{r.counterparty ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {[r.method, formatDate(r.date), r.budgetCode].filter(Boolean).join(" · ") ||
                      "—"}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    <SarAmount amount={r.amount} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border">
                <td
                  colSpan={3}
                  className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground"
                >
                  {t("reports.paid_total")}
                </td>
                <td className="px-4 py-3 font-semibold">
                  <SarAmount amount={total} />
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// By GL Account — group actuals by Chart of Accounts (with filters)
// ─────────────────────────────────────────────────────────────
function GlAccountReport() {
  const { t } = useTranslation();

  const { invoices, payroll, receipts } = useStore();
  const { rows: accounts, loading } = useGlAccounts();
  const [cat, setCat] = useState<GlAccountCategory | "all">("all");
  const [acctId, setAcctId] = useState<string>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const searchRef = useSearchHotkey<HTMLInputElement>();

  const acctById = useMemo(() => {
    const m = new Map<string, (typeof accounts)[number]>();
    accounts.forEach((a) => m.set(a.id, a));
    return m;
  }, [accounts]);

  const visibleAccounts = useMemo(
    () => accounts.filter((a) => cat === "all" || a.category === cat),
    [accounts, cat],
  );

  const filteredAcctIds = useMemo(() => {
    if (acctId !== "all") return new Set([acctId]);
    return new Set(visibleAccounts.map((a) => a.id));
  }, [visibleAccounts, acctId]);

  const summary = useMemo(() => {
    // For each GL account, aggregate committed & paid values.
    // Invoice payment term % is treated as "paid share" (matches useSummary above).
    type Row = {
      id: string;
      code: string;
      name: string;
      category: GlAccountCategory;
      invoiceCount: number;
      payrollCount: number;
      receiptCount: number;
      committed: number;
      paid: number;
    };
    const map = new Map<string, Row>();
    const uncategorized: Row = {
      id: "__none__",
      code: "—",
      name: "Uncategorized",
      category: "Admin & Other",
      invoiceCount: 0,
      payrollCount: 0,
      receiptCount: 0,
      committed: 0,
      paid: 0,
    };
    const rowFor = (id?: string | null): Row | null => {
      if (!id) return uncategorized;
      const a = acctById.get(id);
      if (!a) return uncategorized;
      if (cat !== "all" && a.category !== cat) return null;
      if (acctId !== "all" && acctId !== a.id) return null;
      let r = map.get(a.id);
      if (!r) {
        r = {
          id: a.id,
          code: a.code,
          name: a.name,
          category: a.category,
          invoiceCount: 0,
          payrollCount: 0,
          receiptCount: 0,
          committed: 0,
          paid: 0,
        };
        map.set(a.id, r);
      }
      return r;
    };

    let includeUncategorized = false;

    for (const iv of invoices) {
      const r = rowFor(iv.glAccountId);
      if (!r) continue;
      if (r === uncategorized) {
        if (acctId !== "all") continue; // skip un-categorized when filtering to a specific account
        includeUncategorized = true;
      }
      const term = Math.max(0, Math.min(100, Number(iv.paymentTerm ?? 100)));
      r.invoiceCount += 1;
      r.paid += iv.price * (term / 100);
      r.committed += iv.price;
    }

    for (const p of payroll) {
      const r = rowFor(p.glAccountId);
      if (!r) continue;
      if (r === uncategorized) {
        if (acctId !== "all") continue;
        includeUncategorized = true;
      }
      const slots = p.payments.length;
      let paid = 0;
      for (let i = 0; i < slots; i++) {
        if (p.payments[i] === "Paid") {
          paid += slotAmount(p.totalAmount, p.percents, i, slots);
        }
      }
      r.payrollCount += 1;
      r.paid += paid;
      r.committed += p.totalAmount;
    }

    // Petty cash receipts — already-spent money; committed == paid.
    for (const rc of receipts) {
      const r = rowFor(rc.glAccountId);
      if (!r) continue;
      if (r === uncategorized) {
        if (acctId !== "all") continue;
        includeUncategorized = true;
      }
      const amt = Number(rc.amount || 0);
      r.receiptCount += 1;
      r.paid += amt;
      r.committed += amt;
    }

    const rows = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
    if (includeUncategorized) rows.push(uncategorized);

    const totals = rows.reduce(
      (a, r) => ({
        committed: a.committed + r.committed,
        paid: a.paid + r.paid,
        invoiceCount: a.invoiceCount + r.invoiceCount,
        payrollCount: a.payrollCount + r.payrollCount,
        receiptCount: a.receiptCount + r.receiptCount,
      }),
      { committed: 0, paid: 0, invoiceCount: 0, payrollCount: 0, receiptCount: 0 },
    );

    // Category subtotals (only when not filtered to a specific account)
    const byCat = new Map<string, { committed: number; paid: number }>();
    for (const r of rows) {
      if (r.id === "__none__") continue;
      const k = r.category;
      const cur = byCat.get(k) ?? { committed: 0, paid: 0 };
      cur.committed += r.committed;
      cur.paid += r.paid;
      byCat.set(k, cur);
    }

    return { rows, totals, byCat };
  }, [invoices, payroll, receipts, acctById, cat, acctId]);

  const filteredRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return summary.rows;
    return summary.rows.filter(
      (r) =>
        r.code.toLowerCase().includes(s) ||
        r.name.toLowerCase().includes(s) ||
        r.category.toLowerCase().includes(s),
    );
  }, [summary.rows, q]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredRows, currentPage],
  );

  // Totals follow the rows actually listed (category / account / search).
  const filteredTotals = useMemo(
    () =>
      filteredRows.reduce(
        (a, r) => ({
          committed: a.committed + r.committed,
          paid: a.paid + r.paid,
          invoiceCount: a.invoiceCount + r.invoiceCount,
          payrollCount: a.payrollCount + r.payrollCount,
          receiptCount: a.receiptCount + r.receiptCount,
        }),
        { committed: 0, paid: 0, invoiceCount: 0, payrollCount: 0, receiptCount: 0 },
      ),
    [filteredRows],
  );

  useReportExport(() => ({
    doc: {
      report: "By GL Account",
      title: t("reports.cost_by_gl_account"),
      subtitle: [
        currencyNote(),
        cat === "all" ? t("reports.all_categories") : cat,
        acctId !== "all" ? (acctById.get(acctId)?.code ?? "") : "",
        q.trim() ? `“${q.trim()}”` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      sections: [
        {
          columns: [
            { header: "Code" },
            { header: "Name" },
            { header: "Category" },
            { header: "Invoices", type: "integer" },
            { header: "Payroll", type: "integer" },
            { header: "Receipts", type: "integer" },
            moneyCol("Committed"),
            moneyCol("Actual Paid"),
          ],
          rows: filteredRows.map((r) => [
            r.code,
            r.name,
            r.category,
            r.invoiceCount,
            r.payrollCount,
            r.receiptCount,
            dm(r.committed),
            dm(r.paid),
          ]),
          totals: [
            [
              i18n.t("common.total"),
              "",
              "",
              filteredTotals.invoiceCount,
              filteredTotals.payrollCount,
              filteredTotals.receiptCount,
              dm(filteredTotals.committed),
              dm(filteredTotals.paid),
            ],
          ],
        },
      ],
    },
  }));

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Category
            </div>
            <select
              value={cat}
              onChange={(e) => {
                setCat(e.target.value as any);
                setAcctId("all");
                setPage(1);
              }}
              className="bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm"
            >
              <option value="all">{t("reports.all_categories")}</option>
              {GL_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              {t("reports.gl_account")}
            </div>
            <select
              value={acctId}
              onChange={(e) => {
                setAcctId(e.target.value);
                setPage(1);
              }}
              className="bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm min-w-[240px]"
            >
              <option value="all">{t("reports.all_accounts")}</option>
              {visibleAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Search <kbd className="ml-1 px-1 text-[9px] rounded bg-surface-2">/</kbd>
            </div>
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder={t("reports.code_name_category_press")}
              className="bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm min-w-[200px]"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="text-xs text-muted-foreground mr-2">
              {loading
                ? "Loading GL accounts…"
                : `${filteredRows.length} of ${summary.rows.length} accounts`}
            </div>
          </div>
        </div>

        <h3 className="text-lg font-semibold mb-3">{t("reports.cost_by_gl_account")}</h3>
        <div className="overflow-x-auto">
          <table className="app-table w-full">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                {[
                  "Code",
                  "Name",
                  "Category",
                  "Invoices",
                  "Payroll",
                  "Receipts",
                  "Committed",
                  "Actual Paid",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-left text-xs uppercase tracking-wider font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={pageRows.length > 40 ? "virt-rows" : undefined}>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                    {t("reports.no_transactions_categorized_to_these_accounts_yet")}
                  </td>
                </tr>
              )}
              {pageRows.map((r) => (
                <tr key={r.id} className="border-b border-border">
                  <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface border border-border">
                      {r.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{r.invoiceCount}</td>
                  <td className="px-4 py-3 tabular-nums">{r.payrollCount}</td>
                  <td className="px-4 py-3 tabular-nums">{r.receiptCount}</td>
                  <td className="px-4 py-3 font-semibold">{formatUSD(r.committed)}</td>
                  <td className="px-4 py-3 font-semibold text-success">{formatUSD(r.paid)}</td>
                </tr>
              ))}
              {filteredRows.length > 0 && (
                <tr className="bg-surface-2 font-semibold">
                  <td className="px-4 py-3" colSpan={3}>
                    TOTAL
                  </td>
                  <td className="px-4 py-3 tabular-nums">{filteredTotals.invoiceCount}</td>
                  <td className="px-4 py-3 tabular-nums">{filteredTotals.payrollCount}</td>
                  <td className="px-4 py-3 tabular-nums">{filteredTotals.receiptCount}</td>
                  <td className="px-4 py-3">{formatUSD(filteredTotals.committed)}</td>
                  <td className="px-4 py-3 text-success">{formatUSD(filteredTotals.paid)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredRows.length > pageSize && (
          <div className="flex items-center justify-between text-xs text-muted-foreground mt-3">
            <div>
              Showing {(currentPage - 1) * pageSize + 1}–
              {Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="px-2 py-1 rounded-lg bg-surface hover:bg-muted disabled:opacity-40"
              >
                Prev
              </button>
              <span className="px-2">
                Page {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="px-2 py-1 rounded-lg bg-surface hover:bg-muted disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </Panel>

      {acctId === "all" && summary.byCat.size > 0 && (
        <Panel>
          <h3 className="text-lg font-semibold mb-3">{t("reports.category_totals")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {GL_CATEGORIES.filter((c) => cat === "all" || c.key === cat).map((c) => {
              const v = summary.byCat.get(c.key) ?? { committed: 0, paid: 0 };
              return (
                <div key={c.key} className="rounded-xl border border-border bg-surface-2 p-4">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {c.label}
                  </div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <div>
                      <div className="text-[10px] text-muted-foreground">Committed</div>
                      <div className="text-xl font-semibold tabular-nums">
                        {formatUSD(v.committed)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">
                        {t("reports.actual_paid")}
                      </div>
                      <div className="text-xl font-semibold text-success tabular-nums">
                        {formatUSD(v.paid)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

// Saudi Film Commission — 40% Cash Rebate (QFE) — reactive mock
// ─────────────────────────────────────────────────────────────
function RebateReport() {
  const { t } = useTranslation();

  const { budget, payroll, invoices, receipts, people, vendors, payments, purchaseOrders } =
    useStore();
  const activeProject = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId)) ?? null;
  const totalBudget = useMemo(() => budget.reduce((a, l) => a + lineTotal(l), 0), [budget]);

  type LedgerRow = QfeLedgerRow;
  const fullLedger: LedgerRow[] = useMemo(
    () =>
      buildQfeLedger({ invoices, payroll, receipts, people, payments, purchaseOrders, vendors }),
    [invoices, payroll, receipts, people, payments, purchaseOrders, vendors],
  );
  // The Film Commission report lists qualifying (QFE) transactions only.
  const ledger: LedgerRow[] = useMemo(() => fullLedger.filter((l) => l.qfe), [fullLedger]);
  const excludedCount = fullLedger.length - ledger.length;

  // Auditor search & filter
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ledger;
    return ledger.filter((l) =>
      [
        l.party,
        l.ref,
        l.qpeType,
        l.supplierNationality,
        l.description,
        l.budgetCode,
        l.poRef,
        l.department,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [ledger, query]);

  // Column sorting
  type SortKey =
    | "kind"
    | "ref"
    | "party"
    | "invoiceDate"
    | "qpeType"
    | "supplierNationality"
    | "amountExVat"
    | "vatAmount"
    | "amount"
    | "qfe";
  const [sortKey, setSortKey] = useState<SortKey>("invoiceDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey] as string | number | boolean;
      const bv = b[sortKey] as string | number | boolean;
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else if (typeof av === "boolean" && typeof bv === "boolean")
        cmp = av === bv ? 0 : av ? 1 : -1;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);
  const requestSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };
  const sortIcon = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "");

  // Pagination
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);
  const paged = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // QFE base per Saudi Film Commission: qualifying expenditure is calculated
  // on the Amount Excl. VAT (المبلغ بدون ضريبة), not the gross total.
  const qfeTotal = useMemo(
    () => ledger.filter((l) => l.qfe).reduce((a, l) => a + l.amountExVat, 0),
    [ledger],
  );
  const rebate = qfeTotal * 0.4;
  const filteredQfeTotal = useMemo(
    () => filtered.filter((l) => l.qfe).reduce((a, l) => a + l.amountExVat, 0),
    [filtered],
  );

  const COL_COUNT = 13;

  // Film Commission rebate: the PDF lists the ledger as shown (search +
  // sort); Excel keeps the official bilingual SFC template, limited to the
  // same filtered transactions.
  useReportExport(() => ({
    doc: {
      report: "Saudi Film Commission Rebate",
      title: "Saudi Film Commission Rebate — Qualifying Expenditure",
      subtitle: [currencyNote(), query.trim() ? `“${query.trim()}”` : ""]
        .filter(Boolean)
        .join(" · "),
      sections: [
        {
          columns: [
            { header: "Source" },
            { header: "Reference" },
            { header: "Party / Vendor" },
            { header: "Official ID / CR" },
            { header: "Category" },
            { header: "Invoice Date", type: "date" },
            { header: "Official QPE Type" },
            { header: "Supplier Nationality" },
            moneyCol("Amount Excl. VAT"),
            moneyCol("VAT"),
            moneyCol("Total"),
            { header: "Status" },
          ],
          rows: sorted.map((l) => [
            l.kind,
            l.ref,
            l.party,
            l.officialId || "",
            l.category || "",
            l.invoiceDate || null,
            l.qpeType,
            l.supplierNationality,
            dm(l.amountExVat),
            dm(l.vatAmount),
            dm(l.amount),
            l.qfe ? t("reports.qfe_eligible") : "Non-QPE",
          ]),
          totals: [
            [
              "QFE TOTAL (Excl. VAT)",
              "",
              "",
              "",
              "",
              null,
              "",
              "",
              dm(filteredQfeTotal),
              null,
              null,
              "",
            ],
            [
              "Projected 40% Cash Rebate",
              "",
              "",
              "",
              "",
              null,
              "",
              "",
              dm(filteredQfeTotal * 0.4),
              null,
              null,
              "",
            ],
          ],
        },
      ],
    },
    excel: async () => {
      const invoiceIds = new Set(
        filtered.filter((l) => l.kind === "Invoice").map((l) => l.sourceId),
      );
      const payrollIds = new Set(
        filtered.filter((l) => l.kind === "Payroll").map((l) => l.sourceId),
      );
      const invoiceDocs: Record<string, string> = {};
      invoices.forEach((i) => {
        const u = getSupportingDocUrl("invoice", i.id);
        if (u) invoiceDocs[i.id] = u;
      });
      const payrollDocs: Record<string, string> = {};
      payroll.forEach((p) => {
        const u = getSupportingDocUrl("payroll", p.id);
        if (u) payrollDocs[p.id] = u;
      });
      await exportRebateWorkbook({
        filename: "Saudi Film Commission Rebate",
        projectName: [activeProject?.code, activeProject?.name].filter(Boolean).join(" — "),
        invoices: invoices.filter((i) => invoiceIds.has(i.id)),
        payroll: payroll.filter((p) => payrollIds.has(p.id)),
        people,
        docUrls: { invoice: invoiceDocs, payroll: payrollDocs },
        ledger: sorted,
      });
    },
  }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard label="Total Budget" value={formatUSD(totalBudget)} tone="neutral" />
        <SummaryCard
          label="Qualifying KSA Expenditure (QFE)"
          value={formatUSD(qfeTotal)}
          tone="info"
          hint={t("reports.qfeOnlyHint", { count: ledger.length, excluded: excludedCount })}
        />
        <SummaryCard
          label="Projected 40% Cash Rebate"
          value={formatUSD(rebate)}
          tone="success"
          hint="Based on Amount Excl. VAT · Per Saudi Film Commission"
        />
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold">{t("reports.qfe_eligibility_ledger")}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Transaction-level audit trail · حافز الإنتاج السينمائي
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("reports.search_supplier_invoice_qpe_type")}
                className="w-72 pl-9 pr-3 py-2 rounded-xl bg-surface-2 border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {filtered.length} of {ledger.length}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="app-table w-full min-w-[1400px]">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                {(
                  [
                    ["", null],
                    ["Source", "kind"],
                    ["Reference", "ref"],
                    ["Party / Vendor", "party"],
                    ["Official ID / CR", null],
                    ["Category", null],
                    ["Invoice Date", "invoiceDate"],
                    ["Official QPE Type", "qpeType"],
                    ["Supplier Nationality", "supplierNationality"],
                    ["Amount Excl. VAT", "amountExVat"],
                    ["VAT", "vatAmount"],
                    ["Total", "amount"],
                    ["Supporting Documents", null],
                    ["Status", "qfe"],
                  ] as [string, SortKey | null][]
                ).map(([label, key], idx) => {
                  const alignRight = idx >= 9 && idx <= 11;
                  const clickable = key !== null;
                  return (
                    <th
                      key={idx}
                      onClick={clickable ? () => requestSort(key!) : undefined}
                      className={`px-3 py-2 text-xs uppercase tracking-wider font-medium whitespace-nowrap ${
                        alignRight ? "text-right" : "text-left"
                      } ${clickable ? "cursor-pointer select-none hover:text-foreground" : ""}`}
                    >
                      {label}
                      {clickable && (
                        <span className="ml-1 text-[10px] text-brand">{sortIcon(key!)}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className={paged.length > 40 ? "virt-rows" : undefined}>
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={COL_COUNT + 1}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    {ledger.length === 0
                      ? "No transactions yet — add invoices or payroll to populate the ledger."
                      : "No transactions match this search."}
                  </td>
                </tr>
              )}
              {paged.map((l) => {
                const isOpen = expanded.has(l.id);
                return (
                  <Fragment key={l.id}>
                    <tr
                      onClick={() => toggle(l.id)}
                      className="border-b border-border hover:bg-card/[0.03] cursor-pointer transition-colors"
                    >
                      <td className="px-2 py-3 w-8 text-muted-foreground">
                        <ChevronRight
                          className={`size-4 transition-transform ${isOpen ? "rotate-90 text-brand" : ""}`}
                        />
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{l.kind}</td>
                      <td className="px-3 py-3 font-mono text-xs">{l.ref}</td>
                      <td className="px-3 py-3">{l.party}</td>
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {l.officialId || "—"}
                      </td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap">{l.category || "—"}</td>
                      <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">
                        {formatDate(l.invoiceDate) || l.invoiceDate || "—"}
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs px-2 py-1 rounded-md bg-info/10 text-info border border-info/30 whitespace-nowrap">
                          {l.qpeType}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-block size-1.5 rounded-full ${
                              l.supplierStatus === "Local (KSA)" ? "bg-success" : "bg-warning"
                            }`}
                          />
                          <span className="text-xs whitespace-nowrap">{l.supplierNationality}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-sm">
                        {formatUSD(l.amountExVat)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-sm text-muted-foreground">
                        {l.vatAmount > 0 ? formatUSD(l.vatAmount) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums font-semibold">
                        {formatUSD(l.amount)}
                      </td>
                      <td className="px-3 py-3">
                        {l.docUrl ? (
                          <a
                            href={l.docUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title={l.docUrl}
                            className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-success/15 text-success border border-success/30 hover:bg-success/25 transition-colors"
                          >
                            <ExternalLink className="size-3" />
                            {t("reports.view_doc")}
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {l.qfe ? (
                          <span className="text-xs px-2 py-1 rounded-full bg-success/20 text-success border border-success/30 whitespace-nowrap">
                            {t("reports.qfe_eligible")}
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded-full bg-surface text-muted-foreground border border-border whitespace-nowrap">
                            Non-QPE
                          </span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-surface-2/60 border-b border-border">
                        <td colSpan={COL_COUNT + 1} className="px-6 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                            <div className="space-y-1.5">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                {t("reports.transaction_details")}
                              </div>
                              <div className="text-xs">
                                <span className="text-muted-foreground">Description:</span>{" "}
                                {l.description || "—"}
                              </div>
                              <div className="text-xs">
                                <span className="text-muted-foreground">Department:</span>{" "}
                                {l.department || "—"}
                              </div>
                              <div className="text-xs">
                                <span className="text-muted-foreground">
                                  {t("reports.budget_code_2")}
                                </span>{" "}
                                <span className="font-mono">{l.budgetCode || "—"}</span>
                              </div>
                              <div className="text-xs">
                                <span className="text-muted-foreground">
                                  {t("reports.po_reference")}
                                </span>{" "}
                                <span className="font-mono">{l.poRef || "—"}</span>
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                {t("reports.payment_status")}
                              </div>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-xs px-2 py-1 rounded-full border ${
                                    l.paymentStatus === "Paid"
                                      ? "bg-success/20 text-success border-success/30"
                                      : l.paymentStatus === "Partially Paid"
                                        ? "bg-warning/20 text-warning border-warning/30"
                                        : "bg-destructive/20 text-destructive border-destructive/30"
                                  }`}
                                >
                                  {l.paymentStatus}
                                </span>
                              </div>
                              <div className="text-xs">
                                <span className="text-muted-foreground">
                                  {t("reports.paid_to_date")}
                                </span>{" "}
                                <span className="font-mono tabular-nums">
                                  {formatUSD(l.paidTotal)}
                                </span>
                              </div>
                              <div className="text-xs">
                                <span className="text-muted-foreground">Balance:</span>{" "}
                                <span className="font-mono tabular-nums">
                                  {formatUSD(l.balance)}
                                </span>
                              </div>
                              <div className="text-xs">
                                <span className="text-muted-foreground">
                                  {t("reports.total_incl_vat")}
                                </span>{" "}
                                <span className="font-mono tabular-nums font-semibold">
                                  {formatUSD(l.amount)}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Payment History
                              </div>
                              {l.paymentHistory.length === 0 ? (
                                <div className="text-xs text-muted-foreground">
                                  {t("reports.no_payments_recorded")}
                                </div>
                              ) : (
                                <ul className="space-y-1">
                                  {l.paymentHistory.map((p, idx) => (
                                    <li
                                      key={idx}
                                      className="text-xs flex items-center justify-between gap-2 border-b border-border pb-1 last:border-b-0"
                                    >
                                      <span className="text-muted-foreground truncate">
                                        {p.date ? `${formatDate(p.date) || p.date} · ` : ""}
                                        {p.method || p.label}
                                        {p.reference ? ` · ${p.reference}` : ""}
                                      </span>
                                      <span className="font-mono tabular-nums">
                                        {formatUSD(p.amount)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 pt-3 border-t border-border">
                            <AuditHistoryPanel
                              tableName={
                                l.kind === "Invoice"
                                  ? "invoices"
                                  : l.kind === "Payroll"
                                    ? "payroll"
                                    : null
                              }
                              recordId={l.kind === "Petty Cash" ? null : l.sourceId}
                              emptyLabel={
                                l.kind === "Petty Cash"
                                  ? "Audit trail not tracked for petty cash receipts."
                                  : "No changes recorded."
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {sorted.length > 0 && (
                <tr className="bg-surface-2 font-semibold">
                  <td className="px-3 py-3" colSpan={9}>
                    QFE TOTAL {query ? "(filtered)" : ""}{" "}
                    <span className="text-[10px] text-muted-foreground font-normal">
                      (Excl. VAT basis)
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums" colSpan={3}>
                    {formatUSD(filteredQfeTotal)}
                  </td>
                  <td className="px-3 py-3 text-success" colSpan={2}>
                    Rebate {formatUSD(filteredQfeTotal * 0.4)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sorted.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>{t("reports.rows_per_page")}</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(+e.target.value);
                  setPage(1);
                }}
                className="bg-surface-2 border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span className="ml-2">
                Showing{" "}
                <span className="text-foreground font-medium">{(page - 1) * pageSize + 1}</span>–
                <span className="text-foreground font-medium">
                  {Math.min(page * pageSize, sorted.length)}
                </span>{" "}
                of <span className="text-foreground font-medium">{sorted.length}</span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(1)}
                className="px-2 py-1 rounded-md border border-border bg-surface-2 hover:bg-muted disabled:opacity-40"
              >
                « First
              </button>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2 py-1 rounded-md border border-border bg-surface-2 hover:bg-muted disabled:opacity-40"
              >
                ‹ Prev
              </button>
              <span className="px-2 text-foreground">
                Page {page} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                className="px-2 py-1 rounded-md border border-border bg-surface-2 hover:bg-muted disabled:opacity-40"
              >
                Next ›
              </button>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage(pageCount)}
                className="px-2 py-1 rounded-md border border-border bg-surface-2 hover:bg-muted disabled:opacity-40"
              >
                Last »
              </button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tax & VAT Compliance — Withholding + VAT input tracking
// ─────────────────────────────────────────────────────────────
function VatReport() {
  const { t } = useTranslation();

  const store = useStore();
  // Defensive: the transactional tax refactor can leave these slices briefly
  // undefined while a project switch rehydrates the store.
  const invoices = store.invoices ?? [];
  const people = store.people ?? [];
  const payroll = store.payroll ?? [];

  // ── VAT Input: transactional only. Sum the VAT component of the invoices
  // actually booked as "Vatable" (KSA local supply). Never a % of the budget.
  const vatRows = useMemo(
    () =>
      invoices
        .filter((i) => i.vatable)
        .map((i) => ({
          id: i.id,
          invoiceNo: i.invoiceNo,
          vendorName: i.vendorName,
          date: i.date,
          net: Number(i.price) || 0,
          vat: +((Number(i.price) || 0) * 0.15).toFixed(2),
        })),
    [invoices],
  );
  const vatInput = useMemo(() => +vatRows.reduce((a, r) => a + r.vat, 0).toFixed(2), [vatRows]);

  // ── WHT: only invoices/contracts explicitly flagged international / non-Saudi.
  const whtInvoiceRows = useMemo(
    () =>
      invoices
        .filter((i) => i.isNonSaudiVendor)
        .map((i) => {
          const base = Number(i.price) || 0;
          const pct = Number(i.whtPercent) || 5;
          return {
            id: i.id,
            party: i.vendorName || "—",
            ref: i.invoiceNo || i.id.slice(0, 6),
            kind: "Invoice",
            base,
            pct,
            wht: Number(i.whtAmount) || +(base * (pct / 100)).toFixed(2),
          };
        }),
    [invoices],
  );

  const foreignPeople = useMemo(
    () =>
      people.filter(
        (p) =>
          (p.nationality ?? "").trim() && (p.nationality ?? "").toLowerCase() !== "saudi arabia",
      ),
    [people],
  );
  const whtContractRows = useMemo(
    () =>
      foreignPeople.map((p) => {
        const committed = payroll
          .filter((r) => r.name === p.fullName)
          .reduce((a, r) => a + (Number(r.totalAmount) || 0), 0);
        const base = committed || (Number(p.dailyRate) || 0) * (Number(p.shootingDays) || 0);

        return {
          id: p.id,
          party: p.fullName,
          ref: p.position || (p.kind === "cast" ? "Cast performance" : "Crew service"),
          kind: p.kind === "cast" ? "Cast contract" : "Crew contract",
          nationality: p.nationality ?? "",
          base,
          pct: 5,
          wht: +(base * 0.05).toFixed(2),
        };
      }),
    [foreignPeople, payroll],
  );

  const wht = useMemo(
    () =>
      +(
        whtInvoiceRows.reduce((a, r) => a + r.wht, 0) +
        whtContractRows.reduce((a, r) => a + r.wht, 0)
      ).toFixed(2),
    [whtInvoiceRows, whtContractRows],
  );

  // G03: both tables on screen (invoice AND contract withholding, VAT input).
  useReportExport(() => {
    const whtRows = [...whtInvoiceRows, ...whtContractRows];
    return {
      doc: {
        report: "Tax and VAT",
        title: "Tax & VAT Compliance",
        subtitle: currencyNote(),
        sections: [
          {
            title: "Withholding Tax — Flagged International Vendors & Contracts",
            columns: [
              { header: "Party" },
              { header: "Type" },
              { header: "Reference" },
              moneyCol("Base Amount"),
              { header: "WHT Rate", type: "percent" },
              moneyCol("WHT Amount"),
            ],
            rows: whtRows.map((r) => [r.party, r.kind, r.ref, dm(r.base), r.pct, dm(r.wht)]),
            totals: [[i18n.t("common.total"), "", "", null, null, dm(wht)]],
          },
          {
            title: t("reports.vat_input_tracking_zatca"),
            columns: [
              { header: "Date", type: "date" },
              { header: "Invoice #" },
              { header: "Vendor" },
              moneyCol("Net (Excl. VAT)"),
              moneyCol("VAT (15%)"),
            ],
            rows: vatRows.map((r) => [
              r.date || null,
              r.invoiceNo || "",
              r.vendorName || "",
              dm(r.net),
              dm(r.vat),
            ]),
            totals: [[i18n.t("common.total"), "", "", null, dm(vatInput)]],
          },
        ],
      },
    };
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Withholding Tax Due (actual)"
          value={formatUSD(wht)}
          tone="warning"
          hint="ضريبة الاستقطاع — 5% on flagged non-Saudi invoices & contracts"
        />
        <SummaryCard
          label="VAT Input (recoverable)"
          value={formatUSD(vatInput)}
          tone="info"
          hint={`${vatRows.length} vatable invoice${vatRows.length === 1 ? "" : "s"} · ZATCA`}
        />
        <SummaryCard
          label="International Parties Affected"
          value={String(whtInvoiceRows.length + whtContractRows.length)}
          tone="neutral"
          hint="Flagged non-Saudi vendors & contracts"
        />
      </div>

      <Panel>
        <h3 className="text-lg font-semibold mb-2">
          Withholding Tax — Flagged International Vendors & Contracts
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Calculated transactionally: 5% of the committed/actual amount of every invoice marked
          <strong className="text-foreground">
            {t("reports.international_nonsaudi_vendor")}
          </strong>{" "}
          and every non-Saudi Crew/Cast contract. No projection over the Master Budget is applied.
        </p>
        <div className="overflow-x-auto">
          <table className="app-table w-full">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                {["Party", "Type", "Reference", "Base Amount", "WHT Rate", "WHT Amount"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-2 text-left text-xs uppercase tracking-wider font-medium"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {whtInvoiceRows.length === 0 && whtContractRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    {t("reports.no_transactions_flagged_as_international_nonsaudi")}
                  </td>
                </tr>
              )}
              {[...whtInvoiceRows, ...whtContractRows].map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="border-b border-border">
                  <td className="px-4 py-3 font-medium">{r.party}</td>
                  <td className="px-4 py-3">{r.kind}</td>
                  <td className="px-4 py-3">{r.ref}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{formatUSD(r.base)}</td>
                  <td className="px-4 py-3 font-mono">{r.pct}%</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{formatUSD(r.wht)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <h3 className="text-lg font-semibold mb-2">{t("reports.vat_input_tracking_zatca")}</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Recoverable input VAT is the sum of the 15% VAT component on submitted vatable invoices —
          currently <strong className="text-foreground">{formatUSD(vatInput)}</strong> across{" "}
          {vatRows.length} invoice
          {vatRows.length === 1 ? "" : "s"}.
        </p>
        <div className="overflow-x-auto">
          <table className="app-table w-full">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                {["Date", "Invoice #", "Vendor", "Net (Excl. VAT)", "VAT (15%)"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-left text-xs uppercase tracking-wider font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vatRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    {t("reports.no_vatable_invoices_booked_yet")}
                  </td>
                </tr>
              )}
              {vatRows.map((r) => (
                <tr key={r.id} className="border-b border-border">
                  <td className="px-4 py-3 tabular-nums">{formatDate(r.date) || "—"}</td>
                  <td className="px-4 py-3 font-mono">{r.invoiceNo || "—"}</td>
                  <td className="px-4 py-3">{r.vendorName || "—"}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{formatUSD(r.net)}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{formatUSD(r.vat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// GOSI & Localization — Saudization compliance
// ─────────────────────────────────────────────────────────────
function GosiReport() {
  const { t } = useTranslation();

  const people = useStore((s) => s.people) ?? [];
  const saudis = people.filter((p) => (p.nationality ?? "").toLowerCase() === "saudi arabia");
  const foreign = people.filter((p) => (p.nationality ?? "").toLowerCase() !== "saudi arabia");
  const saudization = people.length > 0 ? (saudis.length / people.length) * 100 : 0;

  useReportExport(() => ({
    doc: {
      report: "GOSI and Localization",
      title: "GOSI & Localization",
      subtitle: `Saudization ${saudization.toFixed(1)}% · ${saudis.length} / ${people.length}`,
      sections: [
        {
          title: "Saudi Nationals — GOSI Enrolled",
          columns: [{ header: "Name" }, { header: "Position" }, { header: "Status" }],
          rows: saudis.map((p) => [p.fullName, p.position || p.kind, t("reports.gosi_active")]),
        },
        {
          title: "Foreign Crew & Cast — Iqama Tracked",
          columns: [
            { header: "Name" },
            { header: "Nationality" },
            { header: "Position" },
            { header: "Status" },
          ],
          rows: foreign.map((p) => [
            p.fullName,
            p.nationality || "",
            p.position || p.kind,
            t("reports.work_permit"),
          ]),
        },
      ],
    },
  }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Saudi Nationals"
          value={String(saudis.length)}
          tone="success"
          hint="Subject to GOSI contributions"
        />
        <SummaryCard
          label="Foreign Crew & Cast"
          value={String(foreign.length)}
          tone="neutral"
          hint="Exempt from GOSI"
        />
        <SummaryCard
          label="Saudization Ratio"
          value={`${saudization.toFixed(1)}%`}
          tone={saudization >= 30 ? "success" : "warning"}
          hint="Nitaqat compliance indicator"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel>
          <h3 className="text-lg font-semibold mb-3">Saudi Nationals — GOSI Enrolled</h3>
          <ul className="divide-y divide-border">
            {saudis.length === 0 && (
              <li className="py-4 text-sm text-muted-foreground">
                {t("reports.no_saudi_nationals_on_roster_yet")}
              </li>
            )}
            {saudis.map((p) => (
              <li key={p.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{p.fullName}</div>
                  <div className="text-xs text-muted-foreground">{p.position || p.kind}</div>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-success/20 text-success border border-success/30">
                  {t("reports.gosi_active")}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <h3 className="text-lg font-semibold mb-3">Foreign Crew & Cast — Iqama Tracked</h3>
          <ul className="divide-y divide-border">
            {foreign.length === 0 && (
              <li className="py-4 text-sm text-muted-foreground">
                {t("reports.no_foreign_crew_on_roster_yet")}
              </li>
            )}
            {foreign.map((p) => (
              <li key={p.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{p.fullName}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.nationality || "—"} · {p.position || p.kind}
                  </div>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-info/20 text-info border border-info/30">
                  {t("reports.work_permit")}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "neutral" | "success" | "info" | "warning";
}) {
  const toneCls = {
    neutral: "border-border",
    success: "border-success/30",
    info: "border-brand/40",
    warning: "border-warning/30",
  }[tone];
  const valueCls = {
    neutral: "text-foreground",
    success: "text-success",
    info: "text-brand",
    warning: "text-warning",
  }[tone];
  return (
    <div className={`rounded-2xl bg-surface border ${toneCls} p-5`}>
      <div
        dir="auto"
        className="text-xs uppercase tracking-wider text-muted-foreground font-medium"
      >
        {label}
      </div>
      <div className={`mt-2 text-3xl font-bold ${valueCls}`}>
        <bdi>{value}</bdi>
      </div>
      {hint && (
        <div dir="auto" className="mt-1 text-xs text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}

// -------------------- QFE Rebate Report (Saudi Film Commission auditor view) --------------------
// Focused, read-only ledger of invoices eligible for the 40% QFE rebate.
// Joins invoices to their linked vendor for the C.R NO. Uses Amount Excl. VAT
// as the Net Amount, since rebates do not cover VAT.
function QfeRebateAuditReport() {
  const { t } = useTranslation();

  const { invoices, vendors } = useStore();
  const [query, setQuery] = useState("");

  const vendorByName = useMemo(
    () => new Map(vendors.map((v) => [v.name.toLowerCase(), v] as const)),
    [vendors],
  );

  type Row = {
    id: string;
    date: string;
    vendorName: string;
    crNo: string;
    invoiceNo: string;
    description: string;
    budgetCode: string;
    netAmount: number;
    docUrl: string;
  };

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const i of invoices) {
      const vendor = i.vendorName ? vendorByName.get(i.vendorName.toLowerCase()) : undefined;
      const nationality = (vendor?.companyNationality ?? "").trim().toLowerCase();
      const foreign = nationality
        ? nationality !== "saudi arabia" && nationality !== "saudi"
        : /international|travel|import|foreign|abroad/i.test(
            `${i.description ?? ""} ${i.department ?? ""}`,
          );
      if (foreign) continue;
      out.push({
        id: i.id,
        date: i.date ?? "",
        vendorName: i.vendorName ?? "—",
        crNo: vendor?.crNo ?? "",
        invoiceNo: i.invoiceNo ?? "",
        description: i.description ?? "",
        budgetCode: i.budgetCode ?? "",
        netAmount: Number(i.price ?? 0),
        docUrl: getSupportingDocUrl("invoice", i.id),
      });
    }
    return out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [invoices, vendorByName]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.vendorName, r.crNo, r.invoiceNo, r.description, r.budgetCode, r.date]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  const totalNet = useMemo(() => rows.reduce((a, r) => a + r.netAmount, 0), [rows]);
  const filteredNet = useMemo(() => filtered.reduce((a, r) => a + r.netAmount, 0), [filtered]);

  useReportExport(() => ({
    doc: {
      report: "QFE Rebate Report",
      title: "QFE Rebate Report (Saudi Film Commission)",
      subtitle: [currencyNote(), query.trim() ? `“${query.trim()}”` : ""]
        .filter(Boolean)
        .join(" · "),
      sections: [
        {
          columns: [
            { header: t("reports.invoice_date"), type: "date" },
            { header: "Vendor Name" },
            { header: t("reports.vendor_cr_no") },
            { header: "Invoice #" },
            { header: "Description" },
            { header: t("reports.budget_code_gl") },
            moneyCol(t("reports.net_amount_excl_vat")),
          ],
          rows: filtered.map((r) => [
            r.date || null,
            r.vendorName,
            r.crNo,
            r.invoiceNo,
            r.description,
            r.budgetCode,
            dm(r.netAmount),
          ]),
          totals: [[t("reports.total_filtered"), "", "", "", "", "", dm(filteredNet)]],
        },
      ],
    },
  }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Total QFE Eligible Spend (Net)"
          value={formatUSD(totalNet)}
          tone="success"
          hint={`${rows.length} eligible invoices · Excl. VAT`}
        />
        <SummaryCard
          label="Filtered Net"
          value={formatUSD(filteredNet)}
          tone="neutral"
          hint={`${filtered.length} of ${rows.length} rows shown`}
        />
        <SummaryCard
          label="Estimated Rebate (40%)"
          value={formatUSD(totalNet * 0.4)}
          tone="success"
          hint="Indicative — subject to SFC audit"
        />
      </div>

      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Search className="size-4" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("reports.search_vendor_cr_invoice_code")}
              className="bg-transparent outline-none placeholder:text-muted-foreground/70 w-72"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {t("reports.net_amount_uses_invoice_excl_vat_rebate_base")}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="app-table w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">{t("reports.invoice_date")}</th>
                <th className="px-4 py-3">Vendor Name</th>
                <th className="px-4 py-3">{t("reports.vendor_cr_no")}</th>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">{t("reports.budget_code_gl")}</th>
                <th className="px-4 py-3 text-right">{t("reports.net_amount_excl_vat")}</th>
                <th className="px-4 py-3">Doc</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    {t("reports.no_qfeeligible_invoices_to_display")}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                      {formatDate(r.date) || "—"}
                    </td>
                    <td className="px-4 py-3">{r.vendorName}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.crNo || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{r.invoiceNo || "—"}</td>
                    <td className="px-4 py-3 max-w-[320px] truncate" title={r.description}>
                      {r.description || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.budgetCode || <span className="text-muted-foreground">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatUSD(r.netAmount)}</td>
                    <td className="px-4 py-3">
                      {r.docUrl ? (
                        <a
                          href={r.docUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-brand hover:underline"
                        >
                          <ExternalLink className="size-3.5" /> View
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="border-t border-border bg-surface font-semibold">
                  <td colSpan={6} className="px-4 py-3 text-right">
                    {t("reports.total_filtered")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatUSD(filteredNet)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// -------------------- Rebate Tracking (Estimated vs Actual Rebate-Eligible Spend) --------------------
// Aggregates every budget line and invoice tagged `rebateEligible` to compare
// planned QFE budget against actual QFE spend, then supports CSV export for
// submission to a film commission.
function RebateTrackingReport() {
  const { t } = useTranslation();

  const { budget, invoices } = useStore();

  const eligibleBudget = useMemo(() => budget.filter((b) => b.rebateEligible), [budget]);
  const eligibleInvoices = useMemo(() => invoices.filter((i) => i.rebateEligible), [invoices]);

  const estimatedTotal = useMemo(
    () => eligibleBudget.reduce((s, b) => s + lineTotal(b), 0),
    [eligibleBudget],
  );
  const actualTotal = useMemo(
    () => eligibleInvoices.reduce((s, i) => s + Number(i.price || 0), 0),
    [eligibleInvoices],
  );
  const variance = actualTotal - estimatedTotal;
  const pctSpent = estimatedTotal > 0 ? (actualTotal / estimatedTotal) * 100 : 0;

  const byGroup = useMemo(() => {
    const map = new Map<string, { estimated: number; actual: number }>();
    for (const b of eligibleBudget) {
      const g = b.group ?? "Other";
      const cur = map.get(g) ?? { estimated: 0, actual: 0 };
      cur.estimated += lineTotal(b);
      map.set(g, cur);
    }
    for (const i of eligibleInvoices) {
      const g = i.department || "Other";
      const cur = map.get(g) ?? { estimated: 0, actual: 0 };
      cur.actual += Number(i.price || 0);
      map.set(g, cur);
    }
    return [...map.entries()].map(([group, v]) => ({
      group,
      ...v,
      variance: v.actual - v.estimated,
    }));
  }, [eligibleBudget, eligibleInvoices]);

  // G03: same currency as the screen (was always labelled USD before).
  useReportExport(() => ({
    doc: {
      report: "Rebate Tracking",
      title: "Rebate Tracking — Estimated vs Actual",
      subtitle: currencyNote(),
      sections: [
        {
          title: "Summary",
          columns: [{ header: "Metric" }, moneyCol("Amount")],
          rows: [
            ["Estimated Rebate-Eligible Budget", dm(estimatedTotal)],
            ["Actual Rebate-Eligible Spend", dm(actualTotal)],
            ["Variance (Actual − Estimated)", dm(variance)],
          ],
        },
        {
          title: t("reports.rebateeligible_by_group"),
          columns: [
            { header: "Group" },
            moneyCol("Estimated"),
            moneyCol("Actual"),
            moneyCol("Variance"),
          ],
          rows: byGroup.map((g) => [g.group, dm(g.estimated), dm(g.actual), dm(g.variance)]),
        },
        {
          title: `Rebate-Eligible Budget Lines (${eligibleBudget.length})`,
          columns: [
            { header: "Code" },
            { header: "Description" },
            { header: "Group" },
            moneyCol("Planned"),
          ],
          rows: eligibleBudget.map((b) => [
            b.mainCode,
            b.description ?? "",
            b.group ?? "",
            dm(lineTotal(b)),
          ]),
          totals: [[i18n.t("common.total"), "", "", dm(estimatedTotal)]],
        },
        {
          title: `Rebate-Eligible Invoices (${eligibleInvoices.length})`,
          columns: [
            { header: "Date", type: "date" },
            { header: "Invoice #" },
            { header: "Vendor" },
            { header: t("reports.budget_code") },
            moneyCol(t("reports.amount_excl_vat")),
          ],
          rows: eligibleInvoices.map((i) => [
            i.date || null,
            i.invoiceNo ?? "",
            i.vendorName ?? "",
            i.budgetCode ?? "",
            dm(Number(i.price || 0)),
          ]),
          totals: [[i18n.t("common.total"), "", "", "", dm(actualTotal)]],
        },
      ],
    },
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-success/30 bg-success/10 p-5">
          <div className="text-xs uppercase text-success">
            {t("reports.estimated_rebateeligible_budget")}
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{formatUSD(estimatedTotal)}</div>
          <div className="text-xs text-success mt-1">
            {eligibleBudget.length} budget lines tagged
          </div>
        </div>
        <div className="rounded-2xl border border-info/30 bg-info/10 p-5">
          <div className="text-xs uppercase text-info">
            {t("reports.actual_rebateeligible_spend")}
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{formatUSD(actualTotal)}</div>
          <div className="text-xs text-info mt-1">{eligibleInvoices.length} invoices tagged</div>
        </div>
        <div
          className={`rounded-2xl border p-5 ${variance >= 0 ? "border-warning/30 bg-warning/10" : "border-highlight/30 bg-highlight/10"}`}
        >
          <div className="text-xs uppercase opacity-80">Variance (Actual − Estimated)</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{formatUSD(variance)}</div>
          <div className="text-xs opacity-70 mt-1">
            {pctSpent.toFixed(1)}% of estimated budget spent
          </div>
        </div>
      </div>

      <Panel>
        <h3 className="text-lg font-semibold mb-3">{t("reports.rebateeligible_by_group")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Group</th>
                <th className="px-3 py-2 text-right">Estimated</th>
                <th className="px-3 py-2 text-right">Actual</th>
                <th className="px-3 py-2 text-right">Variance</th>
              </tr>
            </thead>
            <tbody>
              {byGroup.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    No rebate-eligible items yet. Toggle the "R" checkbox on budget lines or set
                    Rebate Eligible = Yes on invoices.
                  </td>
                </tr>
              )}
              {byGroup.map((g) => (
                <tr key={g.group} className="border-t border-border">
                  <td className="px-3 py-2 font-semibold">{g.group}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatUSD(g.estimated)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatUSD(g.actual)}</td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${g.variance >= 0 ? "text-warning" : "text-highlight"}`}
                  >
                    {formatUSD(g.variance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <h3 className="text-lg font-semibold mb-3">
          Rebate-Eligible Budget Lines ({eligibleBudget.length})
        </h3>
        <div className="overflow-x-auto max-h-[360px]">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground sticky top-0">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Group</th>
                <th className="px-3 py-2 text-right">Planned</th>
              </tr>
            </thead>
            <tbody>
              {eligibleBudget.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{b.mainCode}</td>
                  <td className="px-3 py-2">{b.description}</td>
                  <td className="px-3 py-2">{b.group}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatUSD(lineTotal(b))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <h3 className="text-lg font-semibold mb-3">
          Rebate-Eligible Invoices ({eligibleInvoices.length})
        </h3>
        <div className="overflow-x-auto max-h-[360px]">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground sticky top-0">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Invoice #</th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">{t("reports.budget_code")}</th>
                <th className="px-3 py-2 text-right">{t("reports.amount_excl_vat")}</th>
              </tr>
            </thead>
            <tbody>
              {eligibleInvoices.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="px-3 py-2 tabular-nums">{formatDate(i.date) || "—"}</td>
                  <td className="px-3 py-2">{i.invoiceNo}</td>
                  <td className="px-3 py-2">{i.vendorName}</td>
                  <td className="px-3 py-2 font-mono">{i.budgetCode}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatUSD(Number(i.price || 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
