import { createFileRoute } from "@tanstack/react-router";
import { DateInput } from "@/components/ui/date-input";
import { useEffect, useMemo, useState } from "react";
import { formatDate, riyadhToday } from "@/lib/date-format";
import { fetchProjectFxSettings, type FxSettings } from "@/lib/fx-settings";
import { LEDGER_CURRENCY, fundingCurrencies, toLedgerAmount } from "@/lib/funding-currency";
import { toast } from "sonner";
import {
  Banknote,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  Wallet,
  Landmark,
  ReceiptText,
  Download,
  FileText,
  Pencil,
  Save,
  X,
  Scale,
  AlertTriangle,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import {
  useFundingEntries,
  useFundingPosition,
  useVatPayments,
  useReconciliation,
  type FundingKind,
  type FundingEntry,
  type TaxPaymentKind,
  FUNDING_TREASURY_KINDS,
  treasurySign,
} from "@/lib/funding-store";
import { downloadCSV } from "@/lib/export-csv";
import { exportPdfReport } from "@/lib/export-pdf";
import { useTranslation } from "react-i18next";

import i18n from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/funding")({
  component: () => (
    <>
      <AppShell>
        <FundingPage />
      </AppShell>
    </>
  ),
});

const KINDS: FundingKind[] = ["Investor Tranche", "Capital", "Grant", "Loan", "Other"];

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n || 0));
}
function fmtSAR(n: number) {
  return `SAR ${fmt(n)}`;
}
function fmt2(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}
/** Today in Saudi time (a UTC "today" is yesterday before 03:00 KSA). */
function todayIso() {
  return riyadhToday();
}

/** Original currency fields stored beside the SAR amount (B28). */
function currencyFields(f: { amount: string; currency: string }, rate: number) {
  return f.currency === LEDGER_CURRENCY
    ? { currency: LEDGER_CURRENCY, originalAmount: undefined, fxRate: undefined }
    : { currency: f.currency, originalAmount: Number(f.amount), fxRate: rate };
}

/** Effective FX settings of the active project (inherits the company's). */
function useFundingFx(): FxSettings | null {
  const pid = useStore((s) => s.activeProjectId);
  const [fx, setFx] = useState<FxSettings | null>(null);
  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    void fetchProjectFxSettings(pid)
      .then((s) => {
        if (!cancelled) setFx(s.effective);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pid]);
  return fx;
}

/** Validate an amount input. Returns error message or null. */
function validateAmount(raw: string): string | null {
  if (raw == null || String(raw).trim() === "") return "Amount is required";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Amount must be a number";
  if (n <= 0) return "Amount must be greater than zero";
  if (n > 1e12) return "Amount is unrealistically large";
  return null;
}

function FundingPage() {
  const [tab, setTab] = useState<"cashflow" | "inflows" | "vat">("cashflow");
  const { t: tr, i18n } = useTranslation();
  const isRtl = (i18n.language || "en").startsWith("ar");
  const dir = isRtl ? "rtl" : "ltr";
  const pid = useStore((s) => s.activeProjectId);

  if (!pid) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] p-6 text-center text-foreground">
          {i18n.t("funding.select_an_active_project_to_manage_funding_cash")}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <header className="flex items-center gap-3" dir={dir}>
        <Wallet className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{tr("funding.title")}</h1>
          <p className="text-sm text-muted-foreground">{tr("funding.subtitle")}</p>
        </div>
      </header>

      <div className="flex gap-2 border-b border-border overflow-x-auto" dir={dir}>
        {[
          { id: "cashflow", label: tr("funding.tabCashflow"), icon: TrendingUp },
          { id: "inflows", label: tr("funding.tabInflows"), icon: Landmark },
          { id: "vat", label: tr("reconcile.treasury.tab"), icon: ReceiptText },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "cashflow" && <CashFlowDashboard />}
      {tab === "inflows" && <FundingInflowsTab />}
      {tab === "vat" && <VatPaymentsTab />}
    </div>
  );
}

/**
 * A09 / A12: the cash figures come from the database (get_funding_position),
 * read from the ledger (db/pending/196): the cash balance IS the bank account
 * of the Trial Balance (9100) —
 *   Funding − Paid from the bank − petty cash floats + returns − VAT paid
 *   + VAT recovered − WHT remitted − bank charges
 *   Upcoming = approved, not paid yet; Expected balance = Cash − Upcoming
 */
function useTotals() {
  const { data } = useFundingPosition();
  return useMemo(() => {
    const d = data;
    const v = (k: keyof NonNullable<typeof d>) => Number(d?.[k] ?? 0) || 0;
    const funding = v("funding");
    const paid = v("paid");
    return {
      loaded: !!d,
      funding,
      fundingExpected: v("funding_expected"),
      paid,
      paidFromBank: v("paid_from_bank"),
      paidNotFromBank: v("paid_not_from_bank"),
      pettyIssued: v("petty_cash_issued"),
      pettyReturned: v("petty_cash_returned"),
      vatPaid: v("vat_paid"),
      vatRecovered: v("vat_recovered"),
      whtRemitted: v("wht_remitted"),
      bankCharges: v("bank_charges"),
      cashBalance: v("cash_balance"),
      cashOnHand: v("cash_on_hand"),
      pettyCash: v("petty_cash"),
      upcoming: v("upcoming"),
      expectedBalance: v("expected_balance"),
      upcomingInvoices: v("upcoming_invoices"),
      upcomingInstalments: v("upcoming_instalments"),
      actual: v("actual"),
      commitment: v("commitment"),
      payable: v("payable"),
      hasFunding: !!d?.has_funding,
      overdrawn: !!d?.overdrawn,
      paymentsExceedFunding: !!d?.payments_exceed_funding,
      utilisationPct: funding > 0 ? Math.round((paid / funding) * 10000) / 100 : null,
      taxNet: v("vat_paid") - v("vat_recovered") + v("wht_remitted"),
    };
  }, [data]);
}

function CashFlowDashboard() {
  const t = useTotals();
  const { t: tr, i18n } = useTranslation();
  const dir = (i18n.language || "en").startsWith("ar") ? "rtl" : "ltr";
  const { snap, save, clear } = useReconciliation();

  const [bank, setBank] = useState(snap?.bankBalance != null ? String(snap.bankBalance) : "");
  const [asOf, setAsOf] = useState(snap?.asOfDate ?? todayIso());
  const [reconNote, setReconNote] = useState(snap?.note ?? "");
  const [bankErr, setBankErr] = useState<string | null>(null);

  const burnPct = t.utilisationPct == null ? null : Math.min(100, t.utilisationPct);
  const bankBalance = snap?.bankBalance ?? null;
  const variance = bankBalance != null ? bankBalance - t.cashBalance : null;

  const metricRows = (): [string, number][] => [
    [tr("glossary.term.funding"), t.funding],
    [tr("glossary.cash.fundingExpected"), t.fundingExpected],
    [tr("glossary.term.paid"), t.paid],
    [tr("glossary.cash.vatPaid"), t.vatPaid],
    [tr("glossary.cash.vatRecovered"), t.vatRecovered],
    [tr("glossary.cash.whtRemitted"), t.whtRemitted],
    [tr("reconcile.cash.paidFromBank"), t.paidFromBank],
    [tr("reconcile.cash.pettyIssued"), t.pettyIssued],
    [tr("reconcile.cash.pettyReturned"), t.pettyReturned],
    [tr("reconcile.cash.bankCharges"), t.bankCharges],
    [tr("reconcile.cash.bankBalance"), t.cashBalance],
    [tr("reconcile.cash.cashOnHand"), t.cashOnHand],
    [tr("reconcile.cash.pettyBalance"), t.pettyCash],
    [tr("glossary.cash.upcoming"), t.upcoming],
    [tr("glossary.cash.expectedBalance"), t.expectedBalance],
    [tr("glossary.term.actual"), t.actual],
    [tr("glossary.term.payable"), t.payable],
    [tr("glossary.term.commitment"), t.commitment],
    ...(bankBalance != null
      ? ([
          [tr("funding.tileBank"), bankBalance],
          [tr("funding.tileVariance"), variance ?? 0],
        ] as [string, number][])
      : []),
  ];

  const exportCsv = () => {
    downloadCSV(
      `cash-flow-${todayIso()}`,
      metricRows().map(([m, v]) => ({ Metric: m, "Amount (SAR)": v })),
    );
    toast.success(i18n.t("funding.cash_flow_exported_csv"));
  };

  const exportPdf = () => {
    exportPdfReport(
      `cash-flow-${todayIso()}.pdf`,
      [
        {
          title: tr("funding.title"),
          subtitle: `${tr("funding.asOfDate")} ${todayIso()}`,
          headers: ["Metric", "Amount (SAR)"],
          numericColumns: [1],
          rows: metricRows().map(([m, v]) => [m, fmt(v)]),
        },
      ],
      { documentTitle: tr("funding.title") },
    );
    toast.success(i18n.t("funding.cash_flow_exported_pdf"));
  };

  const submitRecon = () => {
    if (bank.trim() === "") {
      setBankErr(tr("glossary.cash.bankRequired"));
      return;
    }
    const n = Number(bank);
    if (!Number.isFinite(n)) {
      setBankErr(tr("glossary.cash.bankNumber"));
      return;
    }
    setBankErr(null);
    save({ bankBalance: n, asOfDate: asOf, note: reconNote.trim() || undefined });
    toast.success(tr("funding.saved"));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          <Download className="size-3.5" /> {tr("glossary.export.csv")}
        </button>
        <button
          onClick={exportPdf}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          <FileText className="size-3.5" /> {tr("glossary.export.pdf")}
        </button>
      </div>

      {t.loaded && !t.hasFunding && (
        <div
          className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-foreground"
          dir={dir}
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <div className="font-semibold">{tr("glossary.cash.noFunding")}</div>
            <div className="text-xs text-muted-foreground">{tr("glossary.cash.noFundingHint")}</div>
          </div>
        </div>
      )}
      {t.loaded && t.paymentsExceedFunding && (
        <div
          className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          dir={dir}
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            {tr("glossary.cash.paymentsExceedFunding", {
              paid: fmtSAR(t.paid),
              funding: fmtSAR(t.funding),
            })}
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4" dir={dir}>
        <Kpi label={tr("glossary.term.funding")} value={t.funding} icon={TrendingUp} tone="pos" />
        <Kpi label={tr("glossary.term.paid")} value={t.paid} icon={TrendingDown} tone="neg" />
        <Kpi label={tr("glossary.cash.taxNet")} value={t.taxNet} icon={ReceiptText} tone="neg" />
        <Kpi
          label={tr("reconcile.cash.bankBalance")}
          value={t.cashBalance}
          icon={Banknote}
          tone={t.cashBalance >= 0 ? "pos" : "neg"}
          highlight
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2" dir={dir}>
        <Kpi label={tr("glossary.cash.upcoming")} value={t.upcoming} icon={Wallet} tone="neg" />
        <Kpi
          label={tr("glossary.cash.expectedBalance")}
          value={t.expectedBalance}
          icon={Scale}
          tone={t.expectedBalance >= 0 ? "pos" : "neg"}
        />
      </div>

      <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] p-4" dir={dir}>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-foreground font-medium">{tr("glossary.cash.utilisation")}</span>
          <span className="text-muted-foreground tabular-nums" dir="ltr">
            {burnPct == null ? tr("glossary.cash.noFunding") : `${burnPct.toFixed(1)}%`}
          </span>
        </div>
        <div className="h-3 rounded-full bg-surface-2 overflow-hidden">
          <div
            className={`h-full transition-all ${(burnPct ?? 0) >= 90 ? "bg-destructive" : (burnPct ?? 0) >= 70 ? "bg-warning" : "bg-success"}`}
            style={{ width: `${burnPct ?? 0}%` }}
          />
        </div>
      </div>

      {/* Bank Reconciliation */}
      <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] p-4" dir={dir}>
        <div className="flex items-center gap-2 mb-3">
          <Scale className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{tr("funding.bankRecon")}</h3>
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          <div className="md:col-span-1">
            <label className="text-xs text-muted-foreground">{tr("funding.asOfDate")}</label>
            <DateInput
              value={asOf}
              onChange={(v) => setAsOf(v)}
              className="w-full mt-1 rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div className="md:col-span-1">
            <label className="text-xs text-muted-foreground">{tr("funding.bankBalance")}</label>
            <input
              type="number"
              step="0.01"
              placeholder="0"
              value={bank}
              onChange={(e) => {
                setBank(e.target.value);
                setBankErr(null);
              }}
              dir="ltr"
              className={`w-full mt-1 rounded-lg border px-3 py-2 text-sm text-foreground tabular-nums bg-[hsl(var(--surface-2))] ${bankErr ? "border-destructive/40" : "border-border"}`}
            />
            {bankErr && <p className="text-xs text-destructive mt-1">{bankErr}</p>}
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground">{tr("funding.note")}</label>
            <input
              value={reconNote}
              onChange={(e) => setReconNote(e.target.value)}
              placeholder={tr("funding.notePlaceholder")}
              className="w-full mt-1 rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={submitRecon}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90"
            >
              <Save className="size-4" /> {tr("common.save")}
            </button>
            {snap && (
              <button
                onClick={() => {
                  clear();
                  setBank("");
                  setReconNote("");
                  toast.success(tr("funding.reconCleared"));
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                <X className="size-4" /> {tr("funding.clear")}
              </button>
            )}
          </div>
        </div>

        {snap && (
          <div className="grid gap-3 md:grid-cols-3 mt-4">
            <ReconTile label={tr("funding.tileBank")} value={snap.bankBalance} tone="neutral" />
            <ReconTile
              label={tr("reconcile.cash.bankBalance")}
              value={t.cashBalance}
              tone={t.cashBalance >= 0 ? "pos" : "neg"}
            />
            <ReconTile
              label={tr("funding.tileVariance")}
              value={variance ?? 0}
              tone={Math.abs(variance ?? 0) < 1 ? "pos" : "neg"}
              hint={
                Math.abs(variance ?? 0) < 1 ? tr("funding.matched") : tr("funding.reviewVariance")
              }
            />
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2" dir={dir}>
        <Breakdown
          title={tr("glossary.cash.position")}
          rows={[
            { label: tr("glossary.term.actual"), value: t.actual },
            { label: tr("glossary.term.paid"), value: t.paid },
            { label: tr("glossary.term.payable"), value: t.payable },
            { label: tr("glossary.cash.upcomingInvoices"), value: t.upcomingInvoices, muted: true },
            {
              label: tr("glossary.cash.upcomingInstalments"),
              value: t.upcomingInstalments,
              muted: true,
            },
            { label: tr("glossary.term.commitment"), value: t.commitment, muted: true },
          ]}
        />
        <Breakdown
          title={tr("funding.equation")}
          rows={[
            { label: tr("glossary.term.funding"), value: t.funding },
            { label: tr("reconcile.cash.minusPaidFromBank"), value: -t.paidFromBank },
            { label: tr("reconcile.cash.minusPettyIssued"), value: -t.pettyIssued },
            { label: tr("reconcile.cash.plusPettyReturned"), value: t.pettyReturned },
            { label: tr("glossary.cash.minusVatPaid"), value: -t.vatPaid },
            { label: tr("glossary.cash.plusVatRecovered"), value: t.vatRecovered },
            { label: tr("glossary.cash.minusWht"), value: -t.whtRemitted },
            { label: tr("reconcile.cash.minusBankCharges"), value: -t.bankCharges },
            { label: tr("reconcile.cash.bankBalance"), value: t.cashBalance, bold: true },
            { label: tr("glossary.cash.minusUpcoming"), value: -t.upcoming },
            { label: tr("glossary.cash.expectedBalance"), value: t.expectedBalance, bold: true },
          ]}
        />
        <Breakdown
          title={tr("reconcile.cash.outsideBank")}
          rows={[
            { label: tr("reconcile.cash.paidNotFromBank"), value: t.paidNotFromBank, muted: true },
            { label: tr("reconcile.cash.cashOnHand"), value: t.cashOnHand },
            { label: tr("reconcile.cash.pettyBalance"), value: t.pettyCash },
          ]}
        />
      </div>

      <p className="text-xs text-muted-foreground" dir={dir}>
        {tr("reconcile.cash.note")}
      </p>
    </div>
  );
}

function ReconTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "pos" | "neg" | "neutral";
  hint?: string;
}) {
  const color =
    tone === "pos" ? "text-success" : tone === "neg" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${color}`} dir="ltr">
        {value < 0 ? "-" : ""}
        {fmtSAR(Math.abs(value))}
      </div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
  highlight,
}: {
  label: string;
  value: number;
  icon: any;
  tone: "pos" | "neg";
  highlight?: boolean;
}) {
  const color = tone === "pos" ? "text-success" : "text-destructive";
  return (
    <div
      className={`rounded-xl border p-4 bg-[hsl(var(--surface-2))] ${highlight ? "border-primary/60 ring-1 ring-primary/40" : "border-border"}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className={`size-4 ${color}`} />
      </div>
      <div
        className={`mt-2 text-2xl font-bold tabular-nums ${highlight ? color : "text-foreground"}`}
        dir="ltr"
      >
        {value < 0 ? "-" : ""}
        {fmtSAR(Math.abs(value))}
      </div>
    </div>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number; muted?: boolean; bold?: boolean }[];
}) {
  return (
    <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className={`flex justify-between text-sm ${r.bold ? "pt-2 border-t border-border font-bold" : ""}`}
          >
            <span className={r.muted ? "text-muted-foreground" : "text-foreground"}>{r.label}</span>
            <span
              dir="ltr"
              className={`tabular-nums ${r.value < 0 ? "text-destructive" : r.muted ? "text-muted-foreground" : "text-foreground"}`}
            >
              {r.value < 0 ? "-" : ""}
              {fmtSAR(Math.abs(r.value))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type FormState = {
  date: string;
  source: string;
  kind: FundingKind;
  amount: string;
  /** B28 — currency the money was received in (booked in SAR). */
  currency: string;
  reference: string;
  note: string;
};
const emptyForm = (): FormState => ({
  date: todayIso(),
  source: "",
  kind: "Investor Tranche",
  amount: "",
  currency: LEDGER_CURRENCY,
  reference: "",
  note: "",
});

/** Entries kept in this browser before funding moved to the database (A09). */
function LegacyImportBanner({
  count,
  onImport,
}: {
  count: number;
  onImport: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
      <span>{t("glossary.cash.legacyFound", { count })}</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const ok = await onImport();
          setBusy(false);
          if (ok) toast.success(t("glossary.cash.legacyImported"));
        }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        <Upload className="size-3.5" /> {t("glossary.cash.legacyImport")}
      </button>
    </div>
  );
}

function FundingInflowsTab() {
  const { t } = useTranslation();

  const { items, add, remove, update, legacy, importLegacy } = useFundingEntries();
  const fx = useFundingFx();
  const currencies = fundingCurrencies(fx);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [errors, setErrors] = useState<{ source?: string; amount?: string }>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [editErrors, setEditErrors] = useState<{ source?: string; amount?: string }>({});

  const total = items.reduce((s, e) => s + Number(e.amount || 0), 0);

  const validateForm = (f: FormState) => {
    const e: { source?: string; amount?: string } = {};
    if (!f.source.trim()) e.source = "Source/Entity is required";
    const a = validateAmount(f.amount);
    if (a) e.amount = a;
    else if (!toLedgerAmount(fx, Number(f.amount), f.currency))
      e.amount = t("exports.funding_no_rate", { currency: f.currency });
    return e;
  };

  const submit = () => {
    const e = validateForm(form);
    setErrors(e);
    if (Object.keys(e).length) {
      toast.error(t("funding.please_fix_the_highlighted_fields"));
      return;
    }
    const booked = toLedgerAmount(fx, Number(form.amount), form.currency)!;
    add({
      date: form.date,
      source: form.source.trim(),
      kind: form.kind,
      amount: booked.amount,
      ...currencyFields(form, booked.rate),
      reference: form.reference.trim() || undefined,
      note: form.note.trim() || undefined,
    });
    setForm(emptyForm());
    setErrors({});
    toast.success(t("funding.funding_entry_added"));
  };

  const startEdit = (e: FundingEntry) => {
    setEditingId(e.id);
    setEditForm({
      date: e.date,
      source: e.source,
      kind: e.kind,
      amount: String(e.originalAmount ?? e.amount),
      currency: e.currency ?? LEDGER_CURRENCY,
      reference: e.reference ?? "",
      note: e.note ?? "",
    });
    setEditErrors({});
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditErrors({});
  };
  const saveEdit = () => {
    const e = validateForm(editForm);
    setEditErrors(e);
    if (Object.keys(e).length) {
      toast.error(t("funding.please_fix_the_highlighted_fields"));
      return;
    }
    if (!editingId) return;
    const booked = toLedgerAmount(fx, Number(editForm.amount), editForm.currency)!;
    update(editingId, {
      date: editForm.date,
      source: editForm.source.trim(),
      kind: editForm.kind,
      amount: booked.amount,
      ...currencyFields(editForm, booked.rate),
      reference: editForm.reference.trim() || undefined,
      note: editForm.note.trim() || undefined,
    });
    setEditingId(null);
    toast.success(t("funding.funding_entry_updated"));
  };

  const exportCsv = () => {
    downloadCSV(
      `funding-inflows-${todayIso()}`,
      items.map((e) => ({
        Date: formatDate(e.date),
        Source: e.source,
        Kind: e.kind,
        "Amount (SAR)": e.amount.toFixed(2),
        Currency: e.currency ?? LEDGER_CURRENCY,
        "Original Amount": (e.originalAmount ?? e.amount).toFixed(2),
        "FX Rate": e.fxRate ?? 1,
        Reference: e.reference ?? "",
        Note: e.note ?? "",
      })),
    );
  };
  const exportPdf = () => {
    exportPdfReport(`funding-inflows-${todayIso()}.pdf`, [
      {
        title: "Funding Inflows Ledger",
        subtitle: `Total: ${fmtSAR(total)}`,
        headers: ["Date", "Source", "Kind", "Amount (SAR)", "Original", "Reference", "Note"],
        numericColumns: [3],
        rows: items.map((e) => [
          formatDate(e.date),
          e.source,
          e.kind,
          e.amount,
          e.currency && e.currency !== LEDGER_CURRENCY
            ? `${fmt2(e.originalAmount ?? 0)} ${e.currency} × ${e.fxRate ?? "—"}`
            : "—",
          e.reference ?? "—",
          e.note ?? "—",
        ]),
      },
    ]);
  };

  const inputCls = (err?: string) =>
    `rounded-lg border px-3 py-2 text-sm text-foreground bg-[hsl(var(--surface-2))] ${err ? "border-destructive/40" : "border-border"}`;

  return (
    <div className="space-y-4">
      <LegacyImportBanner count={legacy.length} onImport={importLegacy} />
      <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">
          {t("funding.log_new_inflow")}
        </h3>
        <div className="grid gap-2 md:grid-cols-6">
          <DateInput
            value={form.date}
            onChange={(v) => setForm({ ...form, date: v })}
            className={inputCls()}
          />
          <div className="md:col-span-2">
            <input
              placeholder={t("funding.source_entity")}
              value={form.source}
              onChange={(e) => {
                setForm({ ...form, source: e.target.value });
                if (errors.source) setErrors({ ...errors, source: undefined });
              }}
              className={`${inputCls(errors.source)} w-full`}
            />
            {errors.source && <p className="text-xs text-destructive mt-1">{errors.source}</p>}
          </div>
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as FundingKind })}
            className={inputCls()}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <div>
            <div className="flex gap-1">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={t("exports.funding_amount")}
                value={form.amount}
                onChange={(e) => {
                  setForm({ ...form, amount: e.target.value });
                  if (errors.amount) setErrors({ ...errors, amount: undefined });
                }}
                className={`${inputCls(errors.amount)} w-full min-w-0`}
              />
              <select
                aria-label={t("exports.funding_currency")}
                value={form.currency}
                onChange={(e) => {
                  setForm({ ...form, currency: e.target.value });
                  if (errors.amount) setErrors({ ...errors, amount: undefined });
                }}
                className={`${inputCls()} w-20 px-1`}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {errors.amount && <p className="text-xs text-destructive mt-1">{errors.amount}</p>}
          </div>
          <button
            onClick={submit}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90"
          >
            <Plus className="size-4" /> Add
          </button>
        </div>
        <div className="grid gap-2 md:grid-cols-2 mt-2">
          <input
            placeholder={t("funding.reference_optional")}
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            className={inputCls()}
          />
          <input
            placeholder={t("funding.description_optional")}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className={inputCls()}
          />
        </div>
        {form.amount && !errors.amount && Number(form.amount) > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            {t("exports.funding_preview")}{" "}
            <span className="text-success font-medium">
              {fmtSAR(toLedgerAmount(fx, Number(form.amount), form.currency)?.amount ?? 0)}
            </span>
            {form.currency !== LEDGER_CURRENCY && (
              <span dir="ltr" className="ms-1">
                ({fmt2(Number(form.amount))} {form.currency} ×{" "}
                {toLedgerAmount(fx, 1, form.currency)?.rate ?? "—"})
              </span>
            )}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-border flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-foreground">Funding Ledger ({items.length})</h3>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-success">Total: {fmtSAR(total)}</span>
            <button
              onClick={exportCsv}
              disabled={!items.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-40"
            >
              <Download className="size-3.5" /> CSV
            </button>
            <button
              onClick={exportPdf}
              disabled={!items.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-40"
            >
              <FileText className="size-3.5" /> PDF
            </button>
          </div>
        </div>
        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t("funding.no_funding_entries_logged_yet")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-muted-foreground">
                <tr>
                  <th className="text-start px-4 py-2 font-medium">{t("platform.ui.date")}</th>
                  <th className="text-start px-4 py-2 font-medium">{t("platform.ui.source")}</th>
                  <th className="text-start px-4 py-2 font-medium">{t("platform.ui.kind")}</th>
                  <th className="text-end px-4 py-2 font-medium">{t("funding.amount_sar")}</th>
                  <th className="text-start px-4 py-2 font-medium">{t("funding.reference")}</th>
                  <th className="text-start px-4 py-2 font-medium">{t("funding.note")}</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) =>
                  editingId === e.id ? (
                    <tr key={e.id} className="border-t border-border bg-primary/5">
                      <td className="px-2 py-2">
                        <DateInput
                          value={editForm.date}
                          onChange={(v) => setEditForm({ ...editForm, date: v })}
                          className={`${inputCls()} w-full`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={editForm.source}
                          onChange={(x) => {
                            setEditForm({ ...editForm, source: x.target.value });
                            if (editErrors.source)
                              setEditErrors({ ...editErrors, source: undefined });
                          }}
                          className={`${inputCls(editErrors.source)} w-full`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={editForm.kind}
                          onChange={(x) =>
                            setEditForm({ ...editForm, kind: x.target.value as FundingKind })
                          }
                          className={`${inputCls()} w-full`}
                        >
                          {KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editForm.amount}
                            onChange={(x) => {
                              setEditForm({ ...editForm, amount: x.target.value });
                              if (editErrors.amount)
                                setEditErrors({ ...editErrors, amount: undefined });
                            }}
                            className={`${inputCls(editErrors.amount)} w-full min-w-0 text-end`}
                          />
                          <select
                            aria-label={t("exports.funding_currency")}
                            value={editForm.currency}
                            onChange={(x) => setEditForm({ ...editForm, currency: x.target.value })}
                            className={`${inputCls()} w-20 px-1`}
                          >
                            {currencies.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>
                        {editErrors.amount && (
                          <p className="text-xs text-destructive mt-1">{editErrors.amount}</p>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={editForm.reference}
                          onChange={(x) => setEditForm({ ...editForm, reference: x.target.value })}
                          className={`${inputCls()} w-full`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={editForm.note}
                          onChange={(x) => setEditForm({ ...editForm, note: x.target.value })}
                          className={`${inputCls()} w-full`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          <button
                            onClick={saveEdit}
                            className="p-1.5 rounded bg-success/20 text-success hover:bg-success/30"
                            title={t("platform.ui.save")}
                          >
                            <Save className="size-4" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                            title={t("platform.ui.cancel")}
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={e.id} className="border-t border-border text-foreground">
                      <td className="px-4 py-2 tabular-nums">{formatDate(e.date)}</td>
                      <td className="px-4 py-2">{e.source}</td>
                      <td className="px-4 py-2">{e.kind}</td>
                      <td className="px-4 py-2 text-end tabular-nums font-medium text-success">
                        {fmt(e.amount)}
                        {e.currency && e.currency !== LEDGER_CURRENCY && (
                          <div dir="ltr" className="text-[11px] font-normal text-muted-foreground">
                            {fmt2(e.originalAmount ?? 0)} {e.currency} × {e.fxRate ?? "—"}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{e.reference || "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{e.note || "—"}</td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          <button
                            onClick={() => startEdit(e)}
                            className="p-1.5 rounded hover:bg-primary/10 text-primary"
                            title={t("platform.ui.edit")}
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(t("funding.delete_this_funding_entry"))) remove(e.id);
                            }}
                            className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
                            title={t("platform.ui.delete")}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function VatPaymentsTab() {
  const { t } = useTranslation();

  const { items, add, remove, legacy, importLegacy } = useVatPayments();
  const [form, setForm] = useState({
    date: todayIso(),
    amount: "",
    reference: "",
    note: "",
    kind: "vat_payment" as TaxPaymentKind,
    budgetCode: "",
  });
  const kindLabel = (k?: TaxPaymentKind) => t(`reconcile.treasury.${k ?? "vat_payment"}`);
  const [amtErr, setAmtErr] = useState<string | null>(null);
  // net cash out of the bank: VAT paid + WHT remitted + charges − VAT recovered − petty returns
  const total = items.reduce((s, e) => s - treasurySign(e.kind) * Number(e.amount || 0), 0);

  const submit = () => {
    const err = validateAmount(form.amount);
    setAmtErr(err);
    if (err) {
      toast.error(err);
      return;
    }
    add({
      kind: form.kind,
      date: form.date,
      amount: Number(form.amount),
      budgetCode: form.budgetCode.trim() || undefined,
      reference: form.reference.trim() || undefined,
      note: form.note.trim() || undefined,
    });
    setForm({
      date: todayIso(),
      amount: "",
      reference: "",
      note: "",
      kind: form.kind,
      budgetCode: form.budgetCode,
    });
    toast.success(t("funding.vat_payment_logged"));
  };

  const exportCsv = () => {
    downloadCSV(
      `vat-payments-${todayIso()}`,
      items.map((e) => ({
        Date: formatDate(e.date),
        Kind: kindLabel(e.kind),
        "Amount (SAR)": e.amount,
        Reference: e.reference ?? "",
        Note: e.note ?? "",
      })),
    );
  };
  const exportPdf = () => {
    exportPdfReport(`vat-payments-${todayIso()}.pdf`, [
      {
        title: "Direct VAT Payments",
        subtitle: `Total: ${fmtSAR(total)}`,
        headers: ["Date", "Kind", "Amount (SAR)", "Reference", "Note"],
        numericColumns: [2],
        rows: items.map((e) => [
          formatDate(e.date),
          kindLabel(e.kind),
          fmt(e.amount),
          e.reference ?? "—",
          e.note ?? "—",
        ]),
      },
    ]);
  };

  return (
    <div className="space-y-4">
      <LegacyImportBanner count={legacy.length} onImport={importLegacy} />
      <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1">
          {t("reconcile.treasury.title")}
        </h3>
        <p className="text-xs text-muted-foreground mb-3">{t("reconcile.treasury.hint")}</p>
        <div className="grid gap-2 md:grid-cols-6">
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as TaxPaymentKind })}
            aria-label={t("glossary.cash.kindLabel")}
            className="rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-sm text-foreground"
          >
            {FUNDING_TREASURY_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
          <DateInput
            value={form.date}
            onChange={(v) => setForm({ ...form, date: v })}
            className="rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-sm text-foreground"
          />
          <div>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder={t("funding.amount_sar_2")}
              value={form.amount}
              onChange={(e) => {
                setForm({ ...form, amount: e.target.value });
                setAmtErr(null);
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm text-foreground bg-[hsl(var(--surface-2))] ${amtErr ? "border-destructive/40" : "border-border"}`}
            />
            {amtErr && <p className="text-xs text-destructive mt-1">{amtErr}</p>}
          </div>
          {form.kind === "bank_charge" ? (
            <input
              placeholder={t("reconcile.treasury.budgetCode")}
              value={form.budgetCode}
              maxLength={64}
              onChange={(e) => setForm({ ...form, budgetCode: e.target.value })}
              className="rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-sm text-foreground"
            />
          ) : (
            <input
              placeholder={t("funding.reference")}
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
              className="rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-sm text-foreground"
            />
          )}
          <input
            placeholder={t("funding.note")}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-sm text-foreground"
          />
          <button
            onClick={submit}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90"
          >
            <Plus className="size-4" /> Add
          </button>
        </div>
        {form.amount && !amtErr && Number(form.amount) > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Preview:{" "}
            <span className="text-destructive font-medium">{fmtSAR(Number(form.amount))}</span>
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-border flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t("reconcile.treasury.list", { count: items.length })}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-destructive">Total: {fmtSAR(total)}</span>
            <button
              onClick={exportCsv}
              disabled={!items.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-40"
            >
              <Download className="size-3.5" /> CSV
            </button>
            <button
              onClick={exportPdf}
              disabled={!items.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-40"
            >
              <FileText className="size-3.5" /> PDF
            </button>
          </div>
        </div>
        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t("funding.no_vat_payments_logged_yet")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-muted-foreground">
                <tr>
                  <th className="text-start px-4 py-2 font-medium">{t("glossary.cash.dateCol")}</th>
                  <th className="text-start px-4 py-2 font-medium">
                    {t("glossary.cash.kindLabel")}
                  </th>
                  <th className="text-end px-4 py-2 font-medium">{t("funding.amount_sar")}</th>
                  <th className="text-start px-4 py-2 font-medium">{t("funding.reference")}</th>
                  <th className="text-start px-4 py-2 font-medium">{t("funding.note")}</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-t border-border text-foreground">
                    <td className="px-4 py-2 tabular-nums">{formatDate(e.date)}</td>
                    <td className="px-4 py-2">{kindLabel(e.kind)}</td>
                    <td
                      className={`px-4 py-2 text-end tabular-nums font-medium ${treasurySign(e.kind) > 0 ? "text-success" : "text-destructive"}`}
                    >
                      {fmt(e.amount)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {e.reference || e.budgetCode || "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{e.note || "—"}</td>
                    <td className="px-2 py-2">
                      <button
                        onClick={() => {
                          if (confirm(t("funding.delete_this_vat_payment"))) remove(e.id);
                        }}
                        className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
                        title={t("platform.ui.delete")}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
