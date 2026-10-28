import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { convertForDisplay, displayCurrencyCode, useMoney } from "@/lib/money-display";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/export/xlsx-report";
import { formatDate } from "@/lib/date-format";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { useStore, lineTotal, formatUSD } from "@/lib/store";
import {
  FileSpreadsheet,
  FileText,
  Loader2,
  ExternalLink,
  Search,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { LEDGER_TABS, LedgerTab, isLedgerTab } from "@/features/reports/ledger/LedgerTabs";
import { DealSummaryReport } from "@/features/reports/deal-summary/DealSummaryReport";
import {
  PAYABLES_TABS,
  PayablesTab,
  isPayablesTab,
} from "@/features/reports/payables/PayablesTabs";
import { PaymentsRegisterReport } from "@/features/reports/payables/PaymentsRegisterReport";
import {
  ReportExportContext,
  useReportExport,
  type ExportBuilder,
} from "@/features/reports/report-export";
import { BudgetChangeLogReport } from "@/features/reports/budget-change-log/BudgetChangeLogReport";
import { getSupportingDocUrl, useSupportingDocsSync } from "@/lib/supporting-docs";
import { FilmCommissionRebateReport } from "@/features/reports/rebate/FilmCommissionRebateReport";
import { CrewCastListReport } from "@/features/reports/rebate/CrewCastListReport";
import { PerDiemReport } from "@/features/reports/per-diem/PerDiemReport";
import { isReportTabEnabled } from "@/lib/report-flags";
import { AuditHistoryPanel } from "@/components/AuditHistoryPanel";
import { CostReportPanel } from "@/components/reports/CostReportPanel";

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

// ── Report export plumbing (G03): features/reports/report-export.tsx ──────

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
    | "cost"
    | "paid"
    | (typeof PAYABLES_TABS)[number]
    | "rebate"
    | "crewlist"
    | "vat"
    | "gosi"
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
    ["vat", t("platform.reportTab.vat")],
    ["gosi", t("platform.reportTab.gosi")],
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
        {tab === "vat" && <VatReport />}
        {tab === "gosi" && isReportTabEnabled("gosi") && <GosiReport />}
        {isLedgerTab(tab) && <LedgerTab tab={tab} />}
        {tab === "budgetlog" && <BudgetChangeLogReport />}
        {tab === "dealsummary" && <DealSummaryReport />}
        {tab === "perdiem" && <PerDiemReport />}
      </ReportExportContext.Provider>
    </>
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
                      className="px-4 py-2 text-start text-xs uppercase tracking-wider font-medium"
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
                    className="px-4 py-2 text-start text-xs uppercase tracking-wider font-medium"
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
