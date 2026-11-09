import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMoney } from "@/lib/money-display";
import { exportReportPdf, exportReportXlsx } from "@/lib/export/xlsx-report";
import { AppShell, PageTitle } from "@/components/AppShell";
import { FileSpreadsheet, FileText, Loader2, Search, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { LedgerTab, isLedgerTab } from "@/features/reports/ledger/LedgerTabs";
import { DealSummaryReport } from "@/features/reports/deal-summary/DealSummaryReport";
import { PayablesTab, isPayablesTab } from "@/features/reports/payables/PayablesTabs";
import { PaymentsRegisterReport } from "@/features/reports/payables/PaymentsRegisterReport";
import { ReportExportContext, type ExportBuilder } from "@/features/reports/report-export";
import { BudgetChangeLogReport } from "@/features/reports/budget-change-log/BudgetChangeLogReport";
import { useSupportingDocsSync } from "@/lib/supporting-docs";
import { useStore } from "@/lib/store";
import { FilmCommissionRebateReport } from "@/features/reports/rebate/FilmCommissionRebateReport";
import { CrewCastListReport } from "@/features/reports/rebate/CrewCastListReport";
import { PerDiemReport } from "@/features/reports/per-diem/PerDiemReport";
import { isReportTabEnabled } from "@/lib/report-flags";
import { CostReportPanel } from "@/components/reports/CostReportPanel";
import { TaxCashImpactReport } from "@/features/reports/tax-cash/TaxCashImpactReport";
import { CompanyOverheadReport } from "@/features/reports/company-overhead/CompanyOverheadReport";
import { LiveBalanceReport } from "@/features/reports/live-balance/LiveBalanceReport";
import { GsrReport } from "@/features/reports/gsr/GsrReport";

import { usePermissions } from "@/lib/permissions/usePermissions";
import { useProjectRole } from "@/lib/project-role";
import {
  REPORT_GROUPS,
  allowedReportGroups,
  resolveSelection,
  searchReports,
  type ReportGroupId,
  type ReportId,
} from "@/features/reports/report-groups";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";

type ReportsSearch = { group?: string; report?: string };

export const Route = createFileRoute("/_authenticated/reports")({
  // N04: direct link to a report — /reports?group=payables&report=due
  validateSearch: (s: Record<string, unknown>): ReportsSearch => ({
    group: typeof s.group === "string" ? s.group : undefined,
    report: typeof s.report === "string" ? s.report : undefined,
  }),
  component: () => (
    <>
      <AppShell>
        <ReportsPage />
      </AppShell>
    </>
  ),
});

// ── Report export plumbing (G03): features/reports/report-export.tsx ──────

/** Translation key of each report's name. */
const REPORT_LABEL_KEY: Record<ReportId, string> = {
  cost: "reconcile.tab.cost",
  livebal: "taxlive.tab.livebal",
  gosi: "taxlive.tab.gosi",
  budgetlog: "refs.bcl_title",
  due: "reconcile.tab.due",
  aging: "reconcile.tab.aging",
  openpo: "reconcile.tab.openpo",
  dealsummary: "people.deal.title",
  perdiem: "platform.perDiem.title",
  paid: "reconcile.tab.paid",
  cashpos: "journal.tab.cashpos",
  bankrec: "journal.tab.bankrec",
  pettyrec: "reconcile.tab.pettyrec",
  vat: "taxlive.tab.vat",
  ledger: "reconcile.tab.ledger",
  tb: "journal.tab.tb",
  rebate: "rebate.title",
  crewlist: "rebate.cl.title",
  gsr: "taxlive.tab.gsr",
};

const LAST_KEY = (uid: string | null) => `kwalis.reports.last.${uid ?? "anon"}`;

function readLast(uid: string | null): { group?: string; report?: string } | null {
  try {
    const raw = localStorage.getItem(LAST_KEY(uid));
    return raw ? (JSON.parse(raw) as { group?: string; report?: string }) : null;
  } catch {
    return null;
  }
}

function ReportsPage() {
  useMoney(); // re-render report tables when the currency toggle changes
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/reports" });
  const perms = usePermissions();
  const projectRole = useProjectRole();

  // N06: the groups this user may open (role matrix, else project role).
  const allowed = useMemo(() => {
    const matrixActive = perms.status === "ready" && (!!perms.role || perms.isSuperAdmin);
    return allowedReportGroups({
      matrixActive,
      canView: (k) => perms.can(k, "view"),
      heldModules: (perms.modules ?? []).map((m) => m.module_key),
      isAdmin: perms.isAdmin,
      projectRole: projectRole.role,
    }).filter((g) =>
      REPORT_GROUPS.find((x) => x.id === g)!.reports.some((r) => isReportTabEnabled(r)),
    );
  }, [perms, projectRole.role]);

  const ready = perms.status !== "loading" && projectRole.ready;
  const sel = useMemo(
    () =>
      resolveSelection(
        allowed,
        { group: search.group, report: search.report },
        search.group || search.report ? null : readLast(projectRole.userId),
      ),
    [allowed, search.group, search.report, projectRole.userId],
  );
  const tab = sel.report;

  // N03: remember the last group + report per user.
  useEffect(() => {
    if (!sel.group || !sel.report) return;
    try {
      localStorage.setItem(
        LAST_KEY(projectRole.userId),
        JSON.stringify({ group: sel.group, report: sel.report }),
      );
    } catch {
      /* storage unavailable: nothing to remember */
    }
  }, [sel.group, sel.report, projectRole.userId]);

  const open = (group: ReportGroupId, report?: ReportId) =>
    navigate({ search: { group, report }, replace: true });

  const [exporting, setExporting] = useState<null | "excel" | "pdf">(null);
  // N09: one export slot per open report, so the top buttons can only ever
  // export the report that is on screen (a report that is closing writes to
  // its own slot, never to the new one).
  const exportRef = useMemo<{ current: ExportBuilder | null }>(() => ({ current: null }), [tab]);
  const activeProjectIdForDocs = useStore((s) => s.activeProjectId);
  useSupportingDocsSync(activeProjectIdForDocs); // D08: links from the server
  const canExport = perms.status !== "ready" || !perms.role || perms.can("reports", "export");
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

  // N05: search by report name, English or Arabic.
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const en = i18n.getFixedT("en");
    const ar = i18n.getFixedT("ar");
    const names: Record<string, string[]> = {};
    for (const [id, key] of Object.entries(REPORT_LABEL_KEY))
      names[id] = [String(en(key)), String(ar(key)), String(t(key))];
    return searchReports(q, names, allowed).filter((r) => isReportTabEnabled(r));
  }, [q, allowed, t]);

  const group = REPORT_GROUPS.find((g) => g.id === sel.group);
  const groupReports = (group?.reports ?? []).filter((r) => isReportTabEnabled(r)) as ReportId[];
  const showTopExport =
    !!tab &&
    canExport &&
    !(isLedgerTab(tab) || tab === "rebate" || tab === "crewlist" || tab === "perdiem");

  return (
    <>
      <PageTitle
        title={t("reports.reports")}
        action={
          // Tabs with their own export buttons.
          !showTopExport ? null : (
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
      {!ready ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : sel.denied ? (
        // N07: a link to a report the user may not open.
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-10 text-center">
          <ShieldAlert className="size-8 text-warning" />
          <p className="font-semibold">{t("reportGroups.no_permission")}</p>
          {allowed.length > 0 && (
            <button
              onClick={() => open(allowed[0])}
              className="px-4 py-2 rounded-full text-sm font-semibold bg-brand text-brand-foreground"
            >
              {t("reportGroups.open_my_reports")}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            {/* N01 / N13: group buttons, a horizontal scroller on small screens */}
            <div className="flex gap-2 overflow-x-auto max-w-full pb-1 [scrollbar-width:thin]">
              {REPORT_GROUPS.filter((g) => allowed.includes(g.id)).map((g) => {
                const count = g.reports.filter((r) => isReportTabEnabled(r)).length;
                const active = g.id === sel.group;
                return (
                  <button
                    key={g.id}
                    onClick={() => open(g.id)}
                    aria-pressed={active}
                    className={`shrink-0 whitespace-nowrap px-5 py-2 rounded-full text-sm font-semibold border ${active ? "bg-brand text-brand-foreground border-brand" : "bg-surface border-border hover:bg-muted"}`}
                  >
                    {t(`reportGroups.${g.id}`)} <span className="opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>
            <div className="relative ms-auto w-full sm:w-64">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("reportGroups.search")}
                className="w-full rounded-full border border-border bg-surface ps-9 pe-3 py-2 text-sm"
              />
              {q.trim() && (
                <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
                  {hits.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      {t("reportGroups.no_match")}
                    </p>
                  ) : (
                    hits.map((r) => {
                      const g = REPORT_GROUPS.find((x) =>
                        (x.reports as readonly string[]).includes(r),
                      )!;
                      return (
                        <button
                          key={r}
                          onClick={() => {
                            setQ("");
                            open(g.id, r);
                          }}
                          className="block w-full px-3 py-2 text-start text-sm hover:bg-muted"
                        >
                          {t(REPORT_LABEL_KEY[r])}
                          <span className="ms-2 text-xs text-muted-foreground">
                            {t(`reportGroups.${g.id}`)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 mb-5 overflow-x-auto max-w-full pb-1 border-b border-border">
            {groupReports.map((k) => (
              <button
                key={k}
                onClick={() => open(sel.group!, k)}
                className={`shrink-0 whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium ${tab === k ? "bg-brand/15 text-brand ring-1 ring-brand/40" : "hover:bg-muted text-muted-foreground"}`}
              >
                {t(REPORT_LABEL_KEY[k])}
              </button>
            ))}
          </div>
          <ReportExportContext.Provider value={exportRef}>
            {tab === "cost" && <CostReportPanel initialGrouping="line" />}
            {tab === "paid" && <PaymentsRegisterReport />}
            {tab && isPayablesTab(tab) && <PayablesTab tab={tab} />}
            {tab === "rebate" && <FilmCommissionRebateReport />}
            {tab === "crewlist" && <CrewCastListReport />}
            {tab === "vat" && <TaxCashImpactReport />}
            {tab === "gosi" && <CompanyOverheadReport />}
            {tab === "livebal" && <LiveBalanceReport />}
            {tab === "gsr" && <GsrReport />}
            {tab && isLedgerTab(tab) && <LedgerTab tab={tab} />}
            {tab === "budgetlog" && <BudgetChangeLogReport />}
            {tab === "dealsummary" && <DealSummaryReport />}
            {tab === "perdiem" && <PerDiemReport />}
          </ReportExportContext.Provider>
        </>
      )}
    </>
  );
}
