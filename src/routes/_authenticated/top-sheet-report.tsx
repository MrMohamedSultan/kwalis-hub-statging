// =====================================================================
// Top Sheet Cost Report — the tomorrow-facing executive report.
//
// - Groups accounts by Section (ATL / Production / Post / Other)
// - Columns: Budget · Committed · Actual · Paid · Variance · % Used
// - Every numeric cell is a drilldown into the underlying transactions
// - Filters: date range preset, section multi-select, search
// - Validation banner surfaces rollup issues (unmapped codes, over-budget)
// - Exports: CSV, Excel (multi-sheet), PDF (print-ready)
// =====================================================================
import { DateInput } from "@/components/ui/date-input";
import { useCallback, useEffect, useMemo, useState } from "react";

/** Cent-safe rounding — every currency figure passes through here so repeated
 *  additions of contract, overtime and invoice amounts never drift. */
const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
import { useTranslation } from "react-i18next";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeCheck,
  BeakerIcon,
  CheckCircle2,
  Download,
  FileText,
  Link2,
  Search,
  Wand2,
  XCircle,
  Loader2,
} from "lucide-react";
import { useExportAction } from "@/hooks/use-export-action";
import { TopSheetQuickMapModal } from "@/components/TopSheetQuickMapModal";
import { TopSheetSectionDrilldownModal } from "@/components/TopSheetSectionDrilldownModal";
import type { TopSheetSection } from "@/lib/topsheet-report";
import { loadXlsx } from "@/lib/lazy-export-libs";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SectionCard } from "@/components/chrome/SectionCard";
import { supabase } from "@/integrations/supabase/client";

import { formatSAR, lineTotalSAR, useStore } from "@/lib/store";
import { useDisplayCurrency } from "@/lib/display-currency";
import {
  PRESETS,
  presetRange,
  labelFor,
  inRange,
  type DateRange,
  type PresetKey,
} from "@/lib/date-range";
import {
  fetchProjectLedger,
  fetchProjectPaidLedger,
  type CanonicalLedgerEntry,
  type CanonicalPaidEntry,
} from "@/lib/canonical-ledger";
import {
  REPORT_SECTIONS,
  SECTION_LABEL,
  buildTopSheetReport,
  type TopSheetRow,
  type TopsheetAccount,
} from "@/lib/topsheet-report";
import { TopSheetDrilldownModal, type DrilldownKind } from "@/components/TopSheetDrilldownModal";
import i18n from "i18next";
import { formatAmount } from "@/lib/format-number";
import { downloadCSV } from "@/lib/export-csv";
import { exportPdfReport } from "@/lib/export-pdf";
import { GuardedButton } from "@/lib/permission-guard";
import {
  runTopSheetSelfTests,
  summarizeSelfTests,
  type SelfTestResult,
} from "@/lib/topsheet-report.selftest";

type ReportSearch = {
  preset?: PresetKey;
  from?: string;
  to?: string;
  sections?: string; // comma-separated section keys
  q?: string;
};

const ALLOWED_PRESETS: PresetKey[] = ["all", "mtd", "last30", "qtd", "ytd", "custom"];

export const Route = createFileRoute("/_authenticated/top-sheet-report")({
  head: () => ({
    meta: [
      { title: "Top Sheet Cost Report — Kwalis HUB" },
      {
        name: "description",
        content:
          "Executive Top Sheet: Budget vs Committed vs Actual with cell-level drilldown, rollup validation, and exports.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): ReportSearch => {
    const preset =
      typeof s.preset === "string" && (ALLOWED_PRESETS as string[]).includes(s.preset)
        ? (s.preset as PresetKey)
        : undefined;
    return {
      preset,
      from: typeof s.from === "string" ? s.from : undefined,
      to: typeof s.to === "string" ? s.to : undefined,
      sections: typeof s.sections === "string" ? s.sections : undefined,
      q: typeof s.q === "string" ? s.q : undefined,
    };
  },
  component: () => (
    <>
      <TopSheetCostReportPage />
    </>
  ),
});

function TopSheetCostReportPage() {
  const { t } = useTranslation();
  const { run, isPending } = useExportAction();
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projectName = useStore((s) => s.projectName);
  const projectCode = useStore(
    (s) => s.projects.find((p) => p.id === activeProjectId)?.code ?? null,
  );

  const budget = useStore((s) => s.budget);
  const fx = useDisplayCurrency(activeProjectId);

  const [accounts, setAccounts] = useState<TopsheetAccount[]>([]);
  const [ledger, setLedger] = useState<CanonicalLedgerEntry[]>([]);
  const [paid, setPaid] = useState<CanonicalPaidEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Canonical doctrine layer — the SAME sources as the dashboards and GL
  // Transactions, so every screen reconciles to the halala:
  //   accounts  = budget_topsheet_accounts catalog (global, not per-project)
  //   ledger    = v_ledger_transactions (incurred actuals + open commitments)
  //   paid      = payments ledger, codes resolved via v_paid_by_budget_code mapping
  const loadFinancials = useCallback(async () => {
    if (!activeProjectId) {
      setAccounts([]);
      setLedger([]);
      setPaid([]);
      return;
    }
    setLoading(true);
    const [acctRes, ledgerRows, paidRows] = await Promise.all([
      supabase
        .from("budget_topsheet_accounts" as any)
        .select("code, name, section, display_order, default_pct")
        .order("section")
        .order("display_order"),
      fetchProjectLedger(activeProjectId),
      fetchProjectPaidLedger(activeProjectId),
    ]);
    setAccounts(
      ((acctRes.data ?? []) as any[]).map((r) => ({
        code: String(r.code),
        description: String(r.name ?? ""),
        section: r.section as TopsheetAccount["section"],
        sort_order: (r.display_order as number | null) ?? null,
        default_pct: (r.default_pct as number | null) ?? null,
      })),
    );
    setLedger(ledgerRows);
    setPaid(paidRows);
    setLoading(false);
  }, [activeProjectId]);

  useEffect(() => {
    void loadFinancials();
  }, [loadFinancials]);

  // Real-time budget sync: contract, overtime and payment changes immediately
  // re-pull Estimate / Committed / Actuals so variance is never stale.
  useEffect(() => {
    if (!activeProjectId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void loadFinancials(), 400);
    };
    const channel = supabase.channel(
      `topsheet-sync-${activeProjectId}-${Math.random().toString(36).slice(2, 10)}`,
    );
    for (const table of [
      "overtime_entries",
      "budget_lines",
      "crew_members",
      "people",
      "invoices",
      "purchase_orders",
      "payment_requests",
      "payroll_runs",
      "payroll",
      "payments",
    ]) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `project_id=eq.${activeProjectId}` },
        bump,
      );
    }
    channel.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [activeProjectId, loadFinancials]);

  // ---- Filters (mirror the URL so every view is shareable) ----
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const initialSections = useMemo<Set<TopSheetRow["section"]>>(() => {
    if (!search.sections) return new Set(REPORT_SECTIONS);
    const requested = search.sections
      .split(",")
      .map((s: string) => s.trim())
      .filter((s: string): s is TopSheetRow["section"] =>
        (REPORT_SECTIONS as string[]).includes(s),
      );
    return requested.length ? new Set(requested) : new Set(REPORT_SECTIONS);
  }, [search.sections]);

  const [preset, setPreset] = useState<PresetKey>(search.preset ?? "all");
  const [range, setRange] = useState<DateRange>(
    search.preset === "custom"
      ? { from: search.from || undefined, to: search.to || undefined }
      : presetRange(search.preset ?? "all"),
  );
  const [customFrom, setCustomFrom] = useState(search.from ?? "");
  const [customTo, setCustomTo] = useState(search.to ?? "");
  const [sectionFilter, setSectionFilter] = useState<Set<TopSheetRow["section"]>>(initialSections);
  const [q, setQ] = useState(search.q ?? "");

  useEffect(() => {
    if (preset === "custom") {
      setRange({ from: customFrom || undefined, to: customTo || undefined });
    } else {
      setRange(presetRange(preset));
    }
  }, [preset, customFrom, customTo]);

  // Mirror filter state back into the URL so the link is always shareable.
  useEffect(() => {
    const allSelected =
      sectionFilter.size === REPORT_SECTIONS.length &&
      REPORT_SECTIONS.every((s) => sectionFilter.has(s));
    const next: ReportSearch = {
      preset: preset === "all" ? undefined : preset,
      from: preset === "custom" ? customFrom || undefined : undefined,
      to: preset === "custom" ? customTo || undefined : undefined,
      sections: allSelected ? undefined : Array.from(sectionFilter).join(","),
      q: q.trim() ? q.trim() : undefined,
    };
    void navigate({ search: next, replace: true });
  }, [preset, customFrom, customTo, sectionFilter, q, navigate]);

  const copyShareableLink = async () => {
    try {
      const url = window.location.href;
      await navigator.clipboard.writeText(url);
      toast.success(t("report.linkCopied"), {
        description: t("report.linkCopiedDesc"),
      });
    } catch {
      toast.error(t("top_sheet_report.couldnt_copy_copy_the_url_manually_from_the"));
    }
  };

  const report = useMemo(
    () =>
      buildTopSheetReport({
        accounts,
        budget,
        ledger,
        paid,
        range: range.from || range.to ? range : undefined,
        sections: Array.from(sectionFilter) as any,
      }),
    [accounts, budget, ledger, paid, range, sectionFilter],
  );

  // Fallback table when no Top Sheet accounts are configured: group the SAME
  // canonical data by GL budget code so the page still reconciles with GL
  // Transactions (codes appear even when they carry no budget lines).
  type FallbackRow = {
    code: string;
    description: string;
    estimate: number;
    committed: number;
    actuals: number;
    paid: number;
    variance: number;
  };
  const fallbackRows = useMemo<FallbackRow[]>(() => {
    if (accounts.length > 0) return [];
    const inSel = (d: string | null) => !(range.from || range.to) || inRange(d, range);
    const byCode = new Map<string, FallbackRow>();
    const get = (code: string) => {
      let r = byCode.get(code);
      if (!r) {
        r = { code, description: "", estimate: 0, committed: 0, actuals: 0, paid: 0, variance: 0 };
        byCode.set(code, r);
      }
      return r;
    };
    for (const l of budget) {
      if (l.excluded) continue;
      const r = get(String(l.mainCode || l.headerCode || "—"));
      if (!r.description && l.description) r.description = l.description;
      r.estimate += lineTotalSAR(l);
    }
    for (const e of ledger) {
      if (!inSel(e.entryDate)) continue;
      if (e.entryKind === "commitment" && e.status === "Cancelled") continue;
      const r = get(e.budgetCode ?? "—");
      if (e.entryKind === "actual") r.actuals += e.amount;
      else r.committed += e.amount;
    }
    for (const p of paid) {
      if (!inSel(p.date)) continue;
      get(p.budgetCode ?? "—").paid += p.amount;
    }
    const rows = [...byCode.values()];
    for (const r of rows) {
      r.estimate = money(r.estimate);
      r.committed = money(r.committed);
      r.actuals = money(r.actuals);
      r.paid = money(r.paid);
      r.variance = money(r.estimate - r.actuals);
    }
    return rows.sort((a, b) => a.code.localeCompare(b.code));
  }, [accounts, budget, ledger, paid, range]);

  const fallbackTotals = useMemo(
    () =>
      fallbackRows.reduce(
        (a, r) => ({
          budget: a.budget + r.estimate,
          committed: a.committed + r.committed,
          actual: a.actual + r.actuals,
          paid: a.paid + r.paid,
          variance: a.variance + r.variance,
        }),
        { budget: 0, committed: 0, actual: 0, paid: 0, variance: 0 },
      ),
    [fallbackRows],
  );

  // Apply text search to rows within each section (does not affect subtotals
  // — subtotals reflect the full account list to preserve financial truth).
  const needle = q.trim().toLowerCase();
  const visibleSections = useMemo(
    () =>
      report.sections.map((s) => ({
        ...s,
        rows: needle
          ? s.rows.filter(
              (r) =>
                r.code.toLowerCase().includes(needle) ||
                r.description.toLowerCase().includes(needle),
            )
          : s.rows,
      })),
    [report.sections, needle],
  );

  const [drill, setDrill] = useState<{
    code: string;
    description: string;
    kind: DrilldownKind;
  } | null>(null);
  const [sectionDrill, setSectionDrill] = useState<TopSheetSection | null>(null);
  const [quickMapOpen, setQuickMapOpen] = useState(false);

  const toggleSection = (key: TopSheetRow["section"]) => {
    const next = new Set(sectionFilter);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    if (next.size === 0) next.add(key); // never allow empty
    setSectionFilter(next);
  };

  return (
    <AppShell>
      <PageTitle title={t("report.topSheetCostReport")} />

      {/* This report always reads the published (active) budget version.
          Drafts stay confined to the Budget page's Drafts Workspace. */}

      {/* Header + exports */}

      <SectionCard
        title={
          <span className="flex items-center gap-2">
            {projectCode && (
              <span className="inline-flex items-center rounded-md border border-brand/40 bg-brand/15 text-brand px-1.5 py-0.5 text-xs font-bold tracking-wider">
                {projectCode}
              </span>
            )}
            <span>{projectName || t("report.project")}</span>
          </span>
        }
        subtitle={t("report.subtitle", { range: labelFor(range) })}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={copyShareableLink}
              title={t("report.copyLinkHint")}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              <Link2 className="size-3.5" /> {t("report.copyLink")}
            </button>
            <GuardedButton
              perm="reports.export"
              actionLabel="export report"
              onClick={() => run("csv", () => exportCSV(report, projectName))}
              disabled={isPending("csv")}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              {isPending("csv") ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}{" "}
              CSV
            </GuardedButton>
            <GuardedButton
              perm="reports.export"
              actionLabel="export report"
              onClick={() => run("xlsx", () => exportExcel(report, projectName))}
              disabled={isPending("xlsx")}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              {isPending("xlsx") ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}{" "}
              Excel
            </GuardedButton>
            <GuardedButton
              perm="reports.export"
              actionLabel="export report"
              onClick={() => run("pdf", () => exportPDF(report, projectName, range))}
              disabled={isPending("pdf")}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-brand text-brand-foreground font-semibold"
            >
              {isPending("pdf") ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileText className="size-3.5" />
              )}{" "}
              PDF
            </GuardedButton>
          </div>
        }
      >
        {/* Grand totals — prefer live budget_lines financials when no Top Sheet
            accounts are configured so KPIs always reflect the table below. */}
        {(() => {
          const totals = accounts.length === 0 ? fallbackTotals : report.grand;
          return (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Kpi label={t("report.budget")} value={totals.budget} tone="neutral" />
              <Kpi label={t("report.committed")} value={totals.committed} tone="warning" />
              <Kpi label={t("report.actual", "Actual")} value={totals.actual} tone="info" />
              <Kpi label={t("report.paid", "Paid")} value={totals.paid} tone="success" />
              <Kpi
                label={t("report.variance")}
                value={totals.variance}
                tone={totals.variance < 0 ? "danger" : "success"}
              />
            </div>
          );
        })()}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`text-[11px] px-2.5 py-1 rounded-full border ${
                  preset === p.key
                    ? "border-brand bg-brand/15 text-brand"
                    : "border-border hover:bg-muted text-muted-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
            {preset === "custom" && (
              <>
                <DateInput
                  value={customFrom}
                  onChange={(v) => setCustomFrom(v)}
                  className="text-[11px] px-2 py-1 rounded-md border border-border bg-surface-2"
                />
                <span className="text-[11px] text-muted-foreground">→</span>
                <DateInput
                  value={customTo}
                  onChange={(v) => setCustomTo(v)}
                  className="text-[11px] px-2 py-1 rounded-md border border-border bg-surface-2"
                />
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {REPORT_SECTIONS.map((s) => (
              <button
                key={s}
                onClick={() => toggleSection(s)}
                className={`text-[11px] px-2.5 py-1 rounded-full border ${
                  sectionFilter.has(s)
                    ? "border-brand/60 bg-brand/10 text-brand"
                    : "border-border text-muted-foreground"
                }`}
              >
                {SECTION_LABEL[s]}
              </button>
            ))}
          </div>

          <div className="relative ms-auto min-w-[200px] flex-1 max-w-xs">
            <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("report.filterAccounts")}
              className="w-full text-xs ps-7 pe-2 py-1.5 rounded-md border border-border bg-surface-2"
            />
          </div>
        </div>
      </SectionCard>

      {/* Validation */}
      <div className="mt-4 space-y-3">
        <ValidationBanner report={report} onQuickMap={() => setQuickMapOpen(true)} />
        <SelfTestsPanel />
      </div>

      {/* Report body */}
      <SectionCard className="mt-4" dense>
        {loading && accounts.length === 0 && fallbackRows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {t("report.loadingFinancials")}
          </p>
        ) : accounts.length === 0 ? (
          <BudgetLinesFallbackTable rows={fallbackRows} totals={fallbackTotals} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="text-start">
                  <th className="py-2 pe-3 w-24">{t("budget.columns.code")}</th>
                  <th className="py-2 pe-3">{t("budget.columns.account")}</th>
                  <th className="py-2 pe-3 text-end">
                    {t("report.budget")} ({fx.code})
                  </th>
                  <th className="py-2 pe-3 text-end">
                    {t("report.committed")} ({fx.code})
                  </th>
                  <th className="py-2 pe-3 text-end">
                    {t("report.actual", "Actual")} ({fx.code})
                  </th>
                  <th className="py-2 pe-3 text-end">
                    {t("report.paid", "Paid")} ({fx.code})
                  </th>
                  <th className="py-2 pe-3 text-end">
                    {t("report.variance")} ({fx.code})
                  </th>
                  <th className="py-2 pe-3 text-end w-20">{t("report.percentUsed")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleSections.map((s) => (
                  <SectionBlock
                    key={s.key}
                    section={s}
                    onDrill={(row, kind) =>
                      setDrill({ code: row.code, description: row.description, kind })
                    }
                    onSectionDrill={() => setSectionDrill(s)}
                  />
                ))}
                {report.unassigned.budget > 0 || report.unassigned.actual > 0 ? (
                  <>
                    <tr>
                      <td
                        colSpan={8}
                        className="pt-4 pb-2 text-[10px] uppercase tracking-wider text-warning"
                      >
                        {t("top_sheet_report.unassigned_unmapped")}
                      </td>
                    </tr>
                    <RowLine row={report.unassigned} onDrill={() => {}} dimmed />
                  </>
                ) : null}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold text-sm">
                  <td className="py-3 pe-3" colSpan={2}>
                    Grand Total
                  </td>
                  <td className="py-3 pe-3 text-end tabular-nums">
                    {fx.format(report.grand.budget)}
                  </td>
                  <td className="py-3 pe-3 text-end tabular-nums">
                    {fx.amount(report.grand.committed)}
                  </td>
                  <td className="py-3 pe-3 text-end tabular-nums">
                    {fx.amount(report.grand.actual)}
                  </td>
                  <td className="py-3 pe-3 text-end tabular-nums">
                    {fx.amount(report.grand.paid)}
                  </td>
                  <td
                    className={`py-3 pe-3 text-end tabular-nums ${
                      report.grand.variance < 0 ? "text-destructive" : "text-success"
                    }`}
                  >
                    {fx.amount(report.grand.variance)}
                  </td>
                  <td className="py-3 pe-3 text-end tabular-nums">
                    {report.grand.budget > 0
                      ? `${((report.grand.actual / report.grand.budget) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </SectionCard>

      {drill && (
        <TopSheetDrilldownModal
          accountCode={drill.code}
          accountDescription={drill.description}
          kind={drill.kind}
          range={range.from || range.to ? range : undefined}
          accounts={accounts}
          ledger={ledger}
          paid={paid}
          onClose={() => setDrill(null)}
        />
      )}
      {sectionDrill && (
        <TopSheetSectionDrilldownModal
          section={sectionDrill}
          accounts={accounts}
          ledger={ledger}
          paid={paid}
          range={range.from || range.to ? range : undefined}
          onClose={() => setSectionDrill(null)}
        />
      )}
      {quickMapOpen && (
        <TopSheetQuickMapModal accounts={accounts} onClose={() => setQuickMapOpen(false)} />
      )}
    </AppShell>
  );
}

// ---------------- Sub-components ----------------

function BudgetLinesFallbackTable({
  rows,
  totals,
}: {
  rows: {
    code: string;
    description: string;
    estimate: number;
    committed: number;
    actuals: number;
    paid: number;
    variance: number;
  }[];
  totals: { budget: number; committed: number; actual: number; paid: number; variance: number };
}) {
  const { t } = useTranslation();
  const fx = useDisplayCurrency();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">{t("report.noBudgetLines")}</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr className="text-start">
            <th className="py-2 pe-3 w-24">{t("budget.columns.code")}</th>
            <th className="py-2 pe-3">{t("budget.columns.description")}</th>
            <th className="py-2 pe-3 text-end">
              {t("report.budget")} ({fx.code})
            </th>
            <th className="py-2 pe-3 text-end">
              {t("report.committed")} ({fx.code})
            </th>
            <th className="py-2 pe-3 text-end">
              {t("report.actual", "Actual")} ({fx.code})
            </th>
            <th className="py-2 pe-3 text-end">
              {t("report.paid", "Paid")} ({fx.code})
            </th>
            <th className="py-2 pe-3 text-end">
              {t("report.variance")} ({fx.code})
            </th>
            <th className="py-2 pe-3 text-end w-20">{t("report.percentUsed")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = r.estimate > 0 ? r.actuals / r.estimate : 0;
            return (
              <tr key={r.code} className="border-t border-border hover:bg-card/[0.03]">
                <td className="py-1.5 pe-3 font-mono text-[11px]">{r.code}</td>
                <td className="py-1.5 pe-3">{r.description}</td>
                <td className="py-1.5 pe-3 text-end tabular-nums">{fx.amount(r.estimate)}</td>
                <td className="py-1.5 pe-3 text-end tabular-nums">{fx.amount(r.committed)}</td>
                <td className="py-1.5 pe-3 text-end tabular-nums">{fx.amount(r.actuals)}</td>
                <td className="py-1.5 pe-3 text-end tabular-nums">{fx.amount(r.paid)}</td>
                <td
                  className={`py-1.5 pe-3 text-end tabular-nums ${r.variance < 0 ? "text-destructive" : "text-success"}`}
                >
                  {fx.amount(r.variance)}
                </td>
                <td className="py-1.5 pe-3 text-end tabular-nums">
                  {r.estimate > 0 ? (
                    <span
                      className={
                        pct > 1
                          ? "text-destructive font-semibold"
                          : pct >= 0.9
                            ? "text-warning"
                            : "text-muted-foreground"
                      }
                    >
                      {(pct * 100).toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-semibold text-sm">
            <td className="py-3 pe-3" colSpan={2}>
              Grand Total
            </td>
            <td className="py-3 pe-3 text-end tabular-nums">{fx.format(totals.budget)}</td>
            <td className="py-3 pe-3 text-end tabular-nums">{fx.amount(totals.committed)}</td>
            <td className="py-3 pe-3 text-end tabular-nums">{fx.amount(totals.actual)}</td>
            <td className="py-3 pe-3 text-end tabular-nums">{fx.amount(totals.paid)}</td>
            <td
              className={`py-3 pe-3 text-end tabular-nums ${totals.variance < 0 ? "text-destructive" : "text-success"}`}
            >
              {fx.amount(totals.variance)}
            </td>
            <td className="py-3 pe-3 text-end tabular-nums">
              {totals.budget > 0 ? `${((totals.actual / totals.budget) * 100).toFixed(1)}%` : "—"}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "warning" | "info" | "success" | "danger";
}) {
  const tones: Record<typeof tone, string> = {
    neutral: "border-border text-foreground",
    warning: "border-warning/30 text-warning",
    info: "border-info/30 text-info",
    success: "border-success/30 text-success",
    danger: "border-destructive/30 text-destructive",
  } as const;
  const fx = useDisplayCurrency();
  return (
    <div className={`rounded-xl border ${tones[tone]} bg-surface-2/40 p-3`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">
        {fx.amount(value)}
        <span className="ms-1 text-xs font-medium text-muted-foreground">{fx.code}</span>
      </div>
    </div>
  );
}

function SectionBlock({
  section,
  onDrill,
  onSectionDrill,
}: {
  section: ReturnType<typeof buildTopSheetReport>["sections"][number];
  onDrill: (row: TopSheetRow, kind: DrilldownKind) => void;
  onSectionDrill?: () => void;
}) {
  const { t } = useTranslation();
  const fx = useDisplayCurrency();
  if (section.rows.length === 0) return null;
  return (
    <>
      <tr>
        <td colSpan={8} className="pt-4 pb-2 text-[10px] uppercase tracking-wider text-brand">
          {onSectionDrill ? (
            <button
              onClick={onSectionDrill}
              className="hover:underline focus:underline focus:outline-none"
              title={t("report.openSectionBreakdown")}
            >
              {section.label} ▸
            </button>
          ) : (
            section.label
          )}
        </td>
      </tr>
      {section.rows.map((row) => (
        <RowLine key={row.code} row={row} onDrill={onDrill} />
      ))}
      <tr
        className={`border-t border-border bg-surface-2/40 font-medium ${
          onSectionDrill ? "cursor-pointer hover:bg-card/[0.04]" : ""
        }`}
        onClick={onSectionDrill}
        title={onSectionDrill ? t("report.openSectionBreakdown") : undefined}
      >
        <td className="py-2 pe-3" colSpan={2}>
          {section.label} Subtotal
        </td>
        <td className="py-2 pe-3 text-end tabular-nums">{fx.amount(section.subtotal.budget)}</td>
        <td className="py-2 pe-3 text-end tabular-nums">{fx.amount(section.subtotal.committed)}</td>
        <td className="py-2 pe-3 text-end tabular-nums">{fx.amount(section.subtotal.actual)}</td>
        <td className="py-2 pe-3 text-end tabular-nums">{fx.amount(section.subtotal.paid)}</td>
        <td
          className={`py-2 pe-3 text-end tabular-nums ${
            section.subtotal.variance < 0 ? "text-destructive" : "text-success"
          }`}
        >
          {fx.amount(section.subtotal.variance)}
        </td>
        <td className="py-2 pe-3 text-end tabular-nums">
          {section.subtotal.budget > 0
            ? `${((section.subtotal.actual / section.subtotal.budget) * 100).toFixed(1)}%`
            : "—"}
        </td>
      </tr>
    </>
  );
}

function RowLine({
  row,
  onDrill,
  dimmed,
}: {
  row: TopSheetRow;
  onDrill: (row: TopSheetRow, kind: DrilldownKind) => void;
  dimmed?: boolean;
}) {
  const pct = row.pctUsed;
  const over = pct > 1;
  return (
    <tr
      className={`border-t border-border ${dimmed ? "text-muted-foreground" : ""} hover:bg-card/[0.03]`}
    >
      <td className="py-1.5 pe-3 font-mono text-[11px]">{row.code}</td>
      <td className="py-1.5 pe-3">{row.description}</td>
      <NumCell value={row.budget} onClick={() => onDrill(row, "budget")} />
      <NumCell value={row.committed} onClick={() => onDrill(row, "committed")} />
      <NumCell value={row.actual} onClick={() => onDrill(row, "actual")} />
      <NumCell value={row.paid} onClick={() => onDrill(row, "paid")} />
      <NumCell
        value={row.variance}
        onClick={() => onDrill(row, "variance")}
        tone={row.variance < 0 ? "danger" : "success"}
      />
      <td className="py-1.5 pe-3 text-end tabular-nums">
        {row.budget > 0 ? (
          <span
            className={
              over
                ? "text-destructive font-semibold"
                : pct >= 0.9
                  ? "text-warning"
                  : "text-muted-foreground"
            }
          >
            {(pct * 100).toFixed(1)}%
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

function NumCell({
  value,
  onClick,
  tone,
}: {
  value: number;
  onClick: () => void;
  tone?: "danger" | "success";
}) {
  const { t } = useTranslation();
  const fx = useDisplayCurrency();
  return (
    <td className="py-1.5 pe-3 text-end tabular-nums">
      <button
        onClick={onClick}
        title={t("report.viewTransactions")}
        className={`hover:underline focus:underline focus:outline-none ${
          tone === "danger"
            ? "text-destructive"
            : tone === "success" && value !== 0
              ? "text-success"
              : ""
        }`}
      >
        {fx.amount(value)}
      </button>
    </td>
  );
}

function ValidationBanner({
  report,
  onQuickMap,
}: {
  report: ReturnType<typeof buildTopSheetReport>;
  onQuickMap?: () => void;
}) {
  const { t } = useTranslation();

  const { validation } = report;
  const fx = useDisplayCurrency();
  const [open, setOpen] = useState(false);
  const fixableKinds = new Set(["unassigned_budget_line", "unmapped_txn_code"]);
  const hasFixable = validation.issues.some((i) => fixableKinds.has(i.kind));
  if (validation.ok) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
        <CheckCircle2 className="size-4" />
        Rollup validated — every budget line is mapped and every transaction reconciles.
        <span className="ms-auto text-muted-foreground">
          {fx.amount(validation.totals.accountsBudgetSum)} across accounts ={" "}
          {fx.amount(validation.totals.budgetLinesSum)} in budget.
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 flex-1 text-start"
        >
          <AlertTriangle className="size-4" />
          <span className="font-semibold">
            {validation.issues.length} rollup {validation.issues.length === 1 ? "issue" : "issues"}{" "}
            found
          </span>
          <span className="ms-auto text-muted-foreground">
            Diff: {fx.amount(validation.totals.diff)}
          </span>
          <span className="opacity-60">{open ? "▾" : "▸"}</span>
        </button>
        {onQuickMap && hasFixable && (
          <button
            onClick={onQuickMap}
            className="ms-2 inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border border-warning/40 bg-warning/20 hover:bg-warning/30 font-semibold text-warning"
          >
            <Wand2 className="size-3.5" />
            {t("top_sheet_report.quick_map")}
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-2 space-y-1 ps-6 list-disc">
          {validation.issues.slice(0, 30).map((iss, idx) => (
            <li key={idx}>
              <span className="font-mono text-[10px] uppercase tracking-wider text-warning me-1">
                {iss.kind.replace(/_/g, " ")}
              </span>
              {iss.message}
              {typeof iss.amount === "number" ? ` (${fx.amount(iss.amount)})` : ""}
            </li>
          ))}
          {validation.issues.length > 30 && (
            <li className="text-muted-foreground">…and {validation.issues.length - 30} more.</li>
          )}
        </ul>
      )}
    </div>
  );
}

// Deterministic fixture-based rollup tests. Runs `buildTopSheetReport` against
// hand-crafted inputs and asserts every invariant that keeps the executive
// report trustworthy (see topsheet-report.selftest.ts for the full suite).
function SelfTestsPanel() {
  const { t } = useTranslation();
  const [results, setResults] = useState<SelfTestResult[] | null>(null);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const run = () => {
    setRunning(true);
    // Defer to next tick so the button shows the running state.
    setTimeout(() => {
      try {
        const r = runTopSheetSelfTests();
        setResults(r);
        setOpen(true);
      } finally {
        setRunning(false);
      }
    }, 30);
  };

  const summary = results ? summarizeSelfTests(results) : null;
  const tone = !summary
    ? "border-border bg-surface-2/40 text-muted-foreground"
    : summary.allPassed
      ? "border-success/30 bg-success/10 text-success"
      : "border-destructive/30 bg-destructive/10 text-destructive";

  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${tone}`}>
      <div className="flex items-center gap-2">
        <BeakerIcon className="size-4" />
        <span className="font-semibold">{t("report.validationTests")}</span>
        {summary && (
          <span className="ms-2">
            {summary.passed}/{summary.total} passed
            {summary.failed > 0 ? ` · ${summary.failed} failing` : ""}
          </span>
        )}
        <div className="ms-auto flex items-center gap-2">
          {results && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="text-[11px] opacity-80 hover:opacity-100"
            >
              {open ? t("report.hideDetails") : t("report.showDetails")}
            </button>
          )}
          <button
            onClick={run}
            disabled={running}
            className="text-[11px] px-2.5 py-1 rounded-full border border-border hover:bg-muted disabled:opacity-50"
          >
            {running
              ? t("report.running")
              : results
                ? t("report.rerunTests")
                : t("report.runTests")}
          </button>
        </div>
      </div>
      {results && open && (
        <ul className="mt-2 space-y-1 ps-1">
          {results.map((r, idx) => (
            <li key={idx} className="flex items-start gap-1.5">
              {r.passed ? (
                <BadgeCheck className="size-3.5 mt-0.5 text-success shrink-0" />
              ) : (
                <XCircle className="size-3.5 mt-0.5 text-destructive shrink-0" />
              )}
              <span>
                {r.name}
                {r.detail ? (
                  <span className="ms-1 text-[11px] opacity-80">— {r.detail}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- Exports ----------------

/** Localized column keys for tabular exports — labels only; values/math untouched. */
function exportColumns() {
  return {
    section: i18n.t("export.section"),
    code: i18n.t("budget.columns.code"),
    account: i18n.t("budget.columns.account"),
    budget: i18n.t("report.budget"),
    committed: i18n.t("report.committed"),
    actual: i18n.t("report.actual", "Actual"),
    paid: i18n.t("report.paid", "Paid"),
    variance: i18n.t("report.variance"),
    pctUsed: i18n.t("report.percentUsed"),
  };
}

function flattenRows(report: ReturnType<typeof buildTopSheetReport>) {
  const c = exportColumns();
  const out: Record<string, string | number>[] = [];
  for (const s of report.sections) {
    for (const r of s.rows) {
      out.push({
        [c.section]: s.label,
        [c.code]: r.code,
        [c.account]: r.description,
        [c.budget]: Math.round(r.budget),
        [c.committed]: Math.round(r.committed),
        [c.actual]: Math.round(r.actual),
        [c.paid]: Math.round(r.paid),
        [c.variance]: Math.round(r.variance),
        [c.pctUsed]: r.budget > 0 ? +(r.pctUsed * 100).toFixed(2) : 0,
      });
    }
    out.push({
      [c.section]: s.label,
      [c.code]: "",
      [c.account]: `${s.label} — ${i18n.t("export.subtotal")}`,
      [c.budget]: Math.round(s.subtotal.budget),
      [c.committed]: Math.round(s.subtotal.committed),
      [c.actual]: Math.round(s.subtotal.actual),
      [c.paid]: Math.round(s.subtotal.paid),
      [c.variance]: Math.round(s.subtotal.variance),
      [c.pctUsed]:
        s.subtotal.budget > 0 ? +((s.subtotal.actual / s.subtotal.budget) * 100).toFixed(2) : 0,
    });
  }
  out.push({
    [c.section]: "",
    [c.code]: "",
    [c.account]: i18n.t("export.grandTotal"),
    [c.budget]: Math.round(report.grand.budget),
    [c.committed]: Math.round(report.grand.committed),
    [c.actual]: Math.round(report.grand.actual),
    [c.paid]: Math.round(report.grand.paid),
    [c.variance]: Math.round(report.grand.variance),
    [c.pctUsed]:
      report.grand.budget > 0 ? +((report.grand.actual / report.grand.budget) * 100).toFixed(2) : 0,
  });
  return out;
}

function exportCSV(report: ReturnType<typeof buildTopSheetReport>, projectName: string) {
  const c = exportColumns();
  downloadCSV(`top-sheet-report-${slug(projectName)}`, flattenRows(report), Object.values(c));
}

async function exportExcel(report: ReturnType<typeof buildTopSheetReport>, projectName: string) {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const summary = flattenRows(report);
  const ws = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, ws, i18n.t("budget.columns.topSheet"));

  if (report.validation.issues.length > 0) {
    const issues = report.validation.issues.map((i) => ({
      [i18n.t("export.kind")]: i.kind,
      [i18n.t("export.message")]: i.message,
      [i18n.t("export.reference")]: i.ref ?? "",
      [i18n.t("export.amount")]: typeof i.amount === "number" ? Math.round(i.amount) : "",
    }));
    const ws2 = XLSX.utils.json_to_sheet(issues);
    XLSX.utils.book_append_sheet(wb, ws2, i18n.t("export.validationIssues"));
  }

  const { writeBrandedSheetJs } = await import("@/lib/export/sheetjs-branding");
  await writeBrandedSheetJs(XLSX, wb, "Top Sheet Report");
}

async function exportPDF(
  report: ReturnType<typeof buildTopSheetReport>,
  projectName: string,
  range: DateRange,
) {
  const c = exportColumns();
  const headers = [
    c.code,
    c.account,
    c.budget,
    c.committed,
    c.actual,
    c.paid,
    c.variance,
    c.pctUsed,
  ];
  const tables = report.sections
    .filter((s) => s.rows.length > 0)
    .map((s) => ({
      title: s.label,
      headers,
      rows: [
        ...s.rows.map((r) => [
          r.code,
          r.description,
          formatAmount(r.budget),
          formatAmount(r.committed),
          formatAmount(r.actual),
          formatAmount(r.paid),
          formatAmount(r.variance),
          r.budget > 0 ? `${(r.pctUsed * 100).toFixed(1)}%` : "—",
        ]),
        [
          "",
          `${s.label} ${i18n.t("export.subtotal")}`,
          formatAmount(s.subtotal.budget),
          formatAmount(s.subtotal.committed),
          formatAmount(s.subtotal.actual),
          formatAmount(s.subtotal.paid),
          formatAmount(s.subtotal.variance),
          s.subtotal.budget > 0
            ? `${((s.subtotal.actual / s.subtotal.budget) * 100).toFixed(1)}%`
            : "—",
        ],
      ],
      numericColumns: [2, 3, 4, 5, 6, 7],
    }));

  tables.push({
    title: i18n.t("export.grandTotal"),
    headers,
    rows: [
      [
        "",
        i18n.t("export.grandTotal"),
        formatAmount(report.grand.budget),
        formatAmount(report.grand.committed),
        formatAmount(report.grand.actual),
        formatAmount(report.grand.variance),
        report.grand.budget > 0
          ? `${((report.grand.actual / report.grand.budget) * 100).toFixed(1)}%`
          : "—",
      ],
    ],
    numericColumns: [2, 3, 4, 5, 6],
  });

  await exportPdfReport(`top-sheet-report-${slug(projectName)}.pdf`, tables, {
    documentTitle: `${i18n.t("report.topSheetCostReport")} — ${projectName} — ${labelFor(range)}`,
  });
}

function slug(s: string) {
  return (s || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
