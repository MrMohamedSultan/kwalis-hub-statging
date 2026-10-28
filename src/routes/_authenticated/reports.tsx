import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMoney } from "@/lib/money-display";
import { exportReportPdf, exportReportXlsx } from "@/lib/export/xlsx-report";
import { AppShell, PageTitle } from "@/components/AppShell";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LEDGER_TABS, LedgerTab, isLedgerTab } from "@/features/reports/ledger/LedgerTabs";
import { DealSummaryReport } from "@/features/reports/deal-summary/DealSummaryReport";
import {
  PAYABLES_TABS,
  PayablesTab,
  isPayablesTab,
} from "@/features/reports/payables/PayablesTabs";
import { PaymentsRegisterReport } from "@/features/reports/payables/PaymentsRegisterReport";
import { ReportExportContext, type ExportBuilder } from "@/features/reports/report-export";
import { BudgetChangeLogReport } from "@/features/reports/budget-change-log/BudgetChangeLogReport";
import { getSupportingDocUrl, useSupportingDocsSync } from "@/lib/supporting-docs";
import { useStore } from "@/lib/store";
import { FilmCommissionRebateReport } from "@/features/reports/rebate/FilmCommissionRebateReport";
import { CrewCastListReport } from "@/features/reports/rebate/CrewCastListReport";
import { PerDiemReport } from "@/features/reports/per-diem/PerDiemReport";
import { isReportTabEnabled } from "@/lib/report-flags";
import { AuditHistoryPanel } from "@/components/AuditHistoryPanel";
import { CostReportPanel } from "@/components/reports/CostReportPanel";
import { TaxCashImpactReport } from "@/features/reports/tax-cash/TaxCashImpactReport";
import { CompanyOverheadReport } from "@/features/reports/company-overhead/CompanyOverheadReport";
import { LiveBalanceReport } from "@/features/reports/live-balance/LiveBalanceReport";
import { GsrReport } from "@/features/reports/gsr/GsrReport";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/reports")({
  component: () => (
    <>
      <AppShell>
        <ReportsPage />
      </AppShell>
    </>
  ),
});

// ── Report export plumbing (G03): features/reports/report-export.tsx ──────

function ReportsPage() {
  useMoney(); // re-render report tables when the currency toggle changes
  const { t } = useTranslation();

  const [tab, setTab] = useState<
    | "cost"
    | "paid"
    | (typeof PAYABLES_TABS)[number]
    | "rebate"
    | "crewlist"
    | "vat"
    | "gosi"
    | "livebal"
    | "gsr"
    | (typeof LEDGER_TABS)[number]
    | "budgetlog"
    | "dealsummary"
    | "perdiem"
  >("cost");
  const [exporting, setExporting] = useState<null | "excel" | "pdf">(null);
  const exportRef = useRef<ExportBuilder | null>(null);
  const activeProjectIdForDocs = useStore((s) => s.activeProjectId);
  useSupportingDocsSync(activeProjectIdForDocs); // D08: links from the server
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

  // Decisions 5–7: one Cost Report (by line / account / category), General
  // Ledger (double entry) replaces GL Transactions, Payments Register replaces
  // Actual Paid; N05–N08 payables reports.
  const tabs = [
    ["cost", t("reconcile.tab.cost")],
    ["paid", t("reconcile.tab.paid")],
    ...PAYABLES_TABS.map((k) => [k, t(`reconcile.tab.${k}`)] as const),
    ["rebate", t("rebate.title")],
    ["crewlist", t("rebate.cl.title")],
    ["vat", t("taxlive.tab.vat")],
    ["gosi", t("taxlive.tab.gosi")],
    ["livebal", t("taxlive.tab.livebal")],
    ["gsr", t("taxlive.tab.gsr")],
    ...LEDGER_TABS.map(
      (k) => [k, k === "ledger" ? t("reconcile.tab.ledger") : t(`journal.tab.${k}`)] as const,
    ),
    ["budgetlog", t("refs.bcl_title")],
    ["dealsummary", t("people.deal.title")],
    ["perdiem", t("platform.perDiem.title")],
  ].filter(([k]) => isReportTabEnabled(k)) as [typeof tab, string][];
  return (
    <>
      <PageTitle
        title={t("reports.reports")}
        action={
          // Tabs with their own export buttons.
          isLedgerTab(tab) ||
          tab === "budgetlog" ||
          tab === "dealsummary" ||
          tab === "rebate" ||
          tab === "crewlist" ||
          tab === "perdiem" ? null : (
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
        {tab === "cost" && <CostReportPanel initialGrouping="line" />}
        {tab === "paid" && <PaymentsRegisterReport />}
        {isPayablesTab(tab) && <PayablesTab tab={tab} />}
        {tab === "rebate" && <FilmCommissionRebateReport />}
        {tab === "crewlist" && <CrewCastListReport />}
        {tab === "vat" && <TaxCashImpactReport />}
        {tab === "gosi" && <CompanyOverheadReport />}
        {tab === "livebal" && <LiveBalanceReport />}
        {tab === "gsr" && <GsrReport />}
        {isLedgerTab(tab) && <LedgerTab tab={tab} />}
        {tab === "budgetlog" && <BudgetChangeLogReport />}
        {tab === "dealsummary" && <DealSummaryReport />}
        {tab === "perdiem" && <PerDiemReport />}
      </ReportExportContext.Provider>
    </>
  );
}
