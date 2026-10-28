import { createFileRoute, Link } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
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
import { FilmCommissionRebateReport } from "@/features/reports/rebate/FilmCommissionRebateReport";
import { CrewCastListReport } from "@/features/reports/rebate/CrewCastListReport";
import { useSearchHotkey } from "@/hooks/use-search-hotkey";
import { AuditHistoryPanel } from "@/components/AuditHistoryPanel";
import { useSeriesBudget } from "@/lib/series-budget";
import { CostReportPanel } from "@/components/reports/CostReportPanel";
import {
  costReportTotals,
  finalReportSummary,
  groupCostReport,
  useCostReportRows,
} from "@/lib/cost-report";

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
    | "crewlist"
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
    ["rebate", t("rebate.title")],
    ["crewlist", t("rebate.cl.title")],
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
          tab === "gltx" ||
          isLedgerTab(tab) ||
          tab === "budgetlog" ||
          tab === "rebate" ||
          tab === "crewlist" ? null : (
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
        {tab === "gl" && <CostReportPanel initialGrouping="line" />}
        {tab === "glacct" && <CostReportPanel initialGrouping="account" />}
        {tab === "gltx" && <GlTransactionsReport />}
        {tab === "paid" && <PaidReport />}
        {tab === "final" && (
          <>
            <CostReportPanel initialGrouping="category" />
            <FinalReport seasonFilter={seasonFilter} setSeasonFilter={setSeasonFilter} />
          </>
        )}
        {tab === "rebate" && <FilmCommissionRebateReport />}
        {tab === "crewlist" && <CrewCastListReport />}
        {tab === "vat" && <VatReport />}
        {tab === "gosi" && <GosiReport />}
        {isLedgerTab(tab) && <LedgerTab tab={tab} />}
        {tab === "budgetlog" && <BudgetChangeLogReport />}
      </ReportExportContext.Provider>
    </>
  );
}

/** Final Report by category — the Cost Report rows (glossary, db/pending/180). */
function useSummary() {
  const activeProjectId = useStore((st) => st.activeProjectId);
  const { data = [] } = useCostReportRows(activeProjectId);
  return useMemo(() => finalReportSummary(data, GROUPS), [data]);
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
    { label: t("glossary.term.budget"), key: "budget" },
    { label: t("glossary.term.actual"), key: "actualPaid" },
    { label: t("glossary.term.commitment"), key: "commitments" },
    { label: t("glossary.term.efc"), key: "efc" },
    { label: t("glossary.term.variance"), key: "variance", tone: "variance" },
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
