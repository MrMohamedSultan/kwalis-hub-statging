import { createFileRoute } from "@tanstack/react-router";
import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
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
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { useLedgerSync, ledgerPaidTotal } from "@/lib/ledger-sync";
import {
  useFundingEntries,
  useVatPayments,
  useReconciliation,
  type FundingKind,
  type FundingEntry,
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
function todayIso() {
  return new Date().toISOString().slice(0, 10);
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
          { id: "vat", label: tr("funding.tabVat"), icon: ReceiptText },
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

function useTotals() {
  const invoices = useStore((s) => s.invoices);
  const payroll = useStore((s) => s.payroll);
  const receipts = useStore((s) => s.receipts);
  const { items: funding } = useFundingEntries();
  const { items: vat } = useVatPayments();
  const ledgerPaid = useLedgerSync(ledgerPaidTotal);
  const ledgerScheduled = useLedgerSync(
    (s) => s.scheduled.cast + s.scheduled.crew + s.scheduled.vendor,
  );

  return useMemo(() => {
    const inflows = funding.reduce((s, e) => s + Number(e.amount || 0), 0);

    let invoiceTotal = 0;
    let invoiceVat = 0;
    for (const i of invoices) {
      const p = Number(i.price || 0);
      invoiceTotal += p;
      if (i.vatable) invoiceVat += p - p / 1.15;
    }
    // Live payroll: sum ledger entries by status. Approved+Paid feed Approved Expenditures
    // so each Pay/Approve/MarkPaid click in Cast/Crew Payroll instantly moves KPIs.
    let payrollPaid = 0;
    let payrollApproved = 0; // approved (not yet paid)
    let payrollPending = 0;
    let payrollCommitted = 0;
    for (const p of payroll) {
      payrollCommitted += Number(p.totalAmount || 0);
      const schedule = Array.isArray(p.paymentSchedule) ? p.paymentSchedule : [];
      if (schedule.length > 0) {
        // Contract milestones (Crew & Cast payables) are the source of truth when
        // a schedule exists — the legacy ledger JSON is only used for old rows.
        const base = Number(p.netPayable ?? p.totalAmount) || 0;
        for (const m of schedule) {
          const amt =
            m.amount !== null && m.amount !== undefined
              ? Number(m.amount)
              : (base * Number(m.percent ?? 0)) / 100;
          if (m.status === "Paid") payrollPaid += amt;
          else if (m.status === "Approved") payrollApproved += amt;
          else if (m.status === "Hold") payrollPending += amt;
          // "Committed (contracts)" shows what is still owed, not the full contract.
          if (m.status === "Paid" || m.status === "Approved") payrollCommitted -= amt;
        }
        continue;
      }
      for (const e of p.ledger ?? []) {
        const amt = Number(e.amount || 0);
        if (e.status === "Paid") payrollPaid += amt;
        else if (e.status === "Approved") payrollApproved += amt;
        else if (e.status === "Pending Approval") payrollPending += amt;
      }
    }
    // Fold ledger-table paid totals (payroll_payments) into the same KPIs so
    // add/edit/delete on the Payroll Hub instantly moves Net Cash Available.
    payrollPaid += ledgerPaid;
    payrollCommitted += Math.max(0, ledgerScheduled - ledgerPaid);
    const payrollTotal = payrollPaid + payrollApproved;
    const receiptsTotal = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);

    const approvedExpenditures = invoiceTotal + payrollTotal + receiptsTotal;
    const directVat = vat.reduce((s, v) => s + Number(v.amount || 0), 0);
    const netCash = inflows - (approvedExpenditures + directVat);

    return {
      inflows,
      approvedExpenditures,
      invoiceVat,
      directVat,
      netCash,
      invoiceTotal,
      payrollTotal,
      payrollPaid,
      payrollApproved,
      payrollPending,
      payrollCommitted,
      receiptsTotal,
    };
  }, [invoices, payroll, receipts, funding, vat, ledgerPaid, ledgerScheduled]);
}

function CashFlowDashboard() {
  const t = useTotals();
  const { t: tr, i18n } = useTranslation();
  const dir = (i18n.language || "en").startsWith("ar") ? "rtl" : "ltr";
  const { snap, save, clear } = useReconciliation();
  const { items: funding } = useFundingEntries();
  const { items: vat } = useVatPayments();

  const [bank, setBank] = useState(snap?.bankBalance != null ? String(snap.bankBalance) : "");
  const [asOf, setAsOf] = useState(snap?.asOfDate ?? todayIso());
  const [reconNote, setReconNote] = useState(snap?.note ?? "");
  const [bankErr, setBankErr] = useState<string | null>(null);

  const burnPct =
    t.inflows > 0 ? Math.min(100, ((t.approvedExpenditures + t.directVat) / t.inflows) * 100) : 0;
  const bankBalance = snap?.bankBalance ?? null;
  const variance = bankBalance != null ? bankBalance - t.netCash : null;

  const exportCsv = () => {
    const rows = [
      { Metric: "Total Funding Inflows", "Amount (SAR)": t.inflows },
      { Metric: "Vendor Invoices (incl. VAT)", "Amount (SAR)": t.invoiceTotal },
      { Metric: "Payroll", "Amount (SAR)": t.payrollTotal },
      { Metric: "Petty Cash Receipts", "Amount (SAR)": t.receiptsTotal },
      { Metric: "Approved Expenditures (total)", "Amount (SAR)": t.approvedExpenditures },
      { Metric: "Direct VAT Payments", "Amount (SAR)": t.directVat },
      { Metric: "Embedded VAT in Invoices", "Amount (SAR)": Math.round(t.invoiceVat) },
      { Metric: "Net Cash Available", "Amount (SAR)": t.netCash },
      ...(bankBalance != null
        ? [
            { Metric: "Bank Balance (Reconciled)", "Amount (SAR)": bankBalance },
            { Metric: "Variance (Bank − Net Cash)", "Amount (SAR)": variance ?? 0 },
          ]
        : []),
    ];
    downloadCSV(`cash-flow-${todayIso()}`, rows);
    toast.success(i18n.t("funding.cash_flow_exported_csv"));
  };

  const exportPdf = () => {
    exportPdfReport(
      `cash-flow-${todayIso()}.pdf`,
      [
        {
          title: "Cash Flow Dashboard",
          subtitle: `As of ${todayIso()} — VAT-aware liquidity`,
          headers: ["Metric", "Amount (SAR)"],
          numericColumns: [1],
          rows: [
            ["Total Funding Inflows", fmt(t.inflows)],
            ["Vendor Invoices (incl. VAT)", fmt(t.invoiceTotal)],
            ["Payroll", fmt(t.payrollTotal)],
            ["Petty Cash Receipts", fmt(t.receiptsTotal)],
            ["Approved Expenditures (total)", fmt(t.approvedExpenditures)],
            ["Direct VAT Payments", fmt(t.directVat)],
            ["Embedded VAT in Invoices", fmt(t.invoiceVat)],
            ["Net Cash Available", fmt(t.netCash)],
            ...(bankBalance != null
              ? [
                  ["Bank Balance (Reconciled)", fmt(bankBalance)],
                  ["Variance (Bank − Net Cash)", fmt(variance ?? 0)],
                ]
              : []),
          ],
        },
      ],
      { documentTitle: "Cash Flow Report" },
    );
    toast.success(i18n.t("funding.cash_flow_exported_pdf"));
  };

  const submitRecon = () => {
    const err = validateAmount(bank);
    // Bank balance can be zero (allow), but not negative or blank
    if (bank.trim() === "") {
      setBankErr("Bank balance is required");
      return;
    }
    const n = Number(bank);
    if (!Number.isFinite(n)) {
      setBankErr("Bank balance must be a number");
      return;
    }
    if (n < 0) {
      setBankErr("Bank balance cannot be negative");
      return;
    }
    if (err && n !== 0) {
      /* allow zero */
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
          <Download className="size-3.5" /> Export CSV
        </button>
        <button
          onClick={exportPdf}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          <FileText className="size-3.5" /> Export PDF
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4" dir={dir}>
        <Kpi label={tr("funding.kpiInflows")} value={t.inflows} icon={TrendingUp} tone="pos" />
        <Kpi
          label={tr("funding.kpiApproved")}
          value={t.approvedExpenditures}
          icon={TrendingDown}
          tone="neg"
        />
        <Kpi label={tr("funding.kpiVat")} value={t.directVat} icon={ReceiptText} tone="neg" />
        <Kpi
          label={tr("funding.kpiNetCash")}
          value={t.netCash}
          icon={Banknote}
          tone={t.netCash >= 0 ? "pos" : "neg"}
          highlight
        />
      </div>

      <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] p-4" dir={dir}>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-foreground font-medium">{tr("funding.utilization")}</span>
          <span className="text-muted-foreground tabular-nums" dir="ltr">
            {burnPct.toFixed(1)}%
          </span>
        </div>
        <div className="h-3 rounded-full bg-surface-2 overflow-hidden">
          <div
            className={`h-full transition-all ${burnPct >= 90 ? "bg-destructive" : burnPct >= 70 ? "bg-warning" : "bg-success"}`}
            style={{ width: `${burnPct}%` }}
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
              min="0"
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
              label={tr("funding.tileNetSystem")}
              value={t.netCash}
              tone={t.netCash >= 0 ? "pos" : "neg"}
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
          title={tr("funding.breakdown")}
          rows={[
            { label: tr("funding.vendorInvoices"), value: t.invoiceTotal },
            { label: tr("funding.payrollPaid"), value: t.payrollPaid },
            { label: tr("funding.payrollApproved"), value: t.payrollApproved },
            { label: tr("funding.payrollPending"), value: t.payrollPending, muted: true },
            { label: tr("funding.payrollCommitted"), value: t.payrollCommitted, muted: true },
            { label: tr("funding.pettyCash"), value: t.receiptsTotal },
            { label: tr("funding.embeddedVat"), value: t.invoiceVat, muted: true },
          ]}
        />
        <Breakdown
          title={tr("funding.equation")}
          rows={[
            { label: tr("funding.eqInflows"), value: t.inflows },
            { label: tr("funding.eqMinusApproved"), value: -t.approvedExpenditures },
            { label: tr("funding.eqMinusVat"), value: -t.directVat },
            { label: tr("funding.eqNetCash"), value: t.netCash, bold: true },
          ]}
        />
      </div>

      <p className="text-xs text-muted-foreground" dir={dir}>
        {tr("funding.liveNote")}
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
  reference: string;
  note: string;
};
const emptyForm = (): FormState => ({
  date: todayIso(),
  source: "",
  kind: "Investor Tranche",
  amount: "",
  reference: "",
  note: "",
});

function FundingInflowsTab() {
  const { t } = useTranslation();

  const { items, add, remove, update } = useFundingEntries();
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
    return e;
  };

  const submit = () => {
    const e = validateForm(form);
    setErrors(e);
    if (Object.keys(e).length) {
      toast.error(t("funding.please_fix_the_highlighted_fields"));
      return;
    }
    add({
      date: form.date,
      source: form.source.trim(),
      kind: form.kind,
      amount: Number(form.amount),
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
      amount: String(e.amount),
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
    update(editingId, {
      date: editForm.date,
      source: editForm.source.trim(),
      kind: editForm.kind,
      amount: Number(editForm.amount),
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
        Date: e.date,
        Source: e.source,
        Kind: e.kind,
        "Amount (SAR)": e.amount,
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
        headers: ["Date", "Source", "Kind", "Amount (SAR)", "Reference", "Note"],
        numericColumns: [3],
        rows: items.map((e) => [
          e.date,
          e.source,
          e.kind,
          fmt(e.amount),
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
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder={t("funding.amount_sar_2")}
              value={form.amount}
              onChange={(e) => {
                setForm({ ...form, amount: e.target.value });
                if (errors.amount) setErrors({ ...errors, amount: undefined });
              }}
              className={`${inputCls(errors.amount)} w-full`}
            />
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
            Preview: <span className="text-success font-medium">{fmtSAR(Number(form.amount))}</span>
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
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-left px-4 py-2 font-medium">Source</th>
                  <th className="text-left px-4 py-2 font-medium">Kind</th>
                  <th className="text-right px-4 py-2 font-medium">{t("funding.amount_sar")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("funding.reference")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("funding.note")}</th>
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
                          className={`${inputCls(editErrors.amount)} w-full text-right`}
                        />
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
                            title="Save"
                          >
                            <Save className="size-4" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                            title="Cancel"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={e.id} className="border-t border-border text-foreground">
                      <td className="px-4 py-2">{e.date}</td>
                      <td className="px-4 py-2">{e.source}</td>
                      <td className="px-4 py-2">{e.kind}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-success">
                        {fmt(e.amount)}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{e.reference || "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{e.note || "—"}</td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          <button
                            onClick={() => startEdit(e)}
                            className="p-1.5 rounded hover:bg-primary/10 text-primary"
                            title="Edit"
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(t("funding.delete_this_funding_entry"))) remove(e.id);
                            }}
                            className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
                            title="Delete"
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

  const { items, add, remove } = useVatPayments();
  const [form, setForm] = useState({ date: todayIso(), amount: "", reference: "", note: "" });
  const [amtErr, setAmtErr] = useState<string | null>(null);
  const total = items.reduce((s, e) => s + Number(e.amount || 0), 0);

  const submit = () => {
    const err = validateAmount(form.amount);
    setAmtErr(err);
    if (err) {
      toast.error(err);
      return;
    }
    add({
      date: form.date,
      amount: Number(form.amount),
      reference: form.reference.trim() || undefined,
      note: form.note.trim() || undefined,
    });
    setForm({ date: todayIso(), amount: "", reference: "", note: "" });
    toast.success(t("funding.vat_payment_logged"));
  };

  const exportCsv = () => {
    downloadCSV(
      `vat-payments-${todayIso()}`,
      items.map((e) => ({
        Date: e.date,
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
        headers: ["Date", "Amount (SAR)", "Reference", "Note"],
        numericColumns: [1],
        rows: items.map((e) => [e.date, fmt(e.amount), e.reference ?? "—", e.note ?? "—"]),
      },
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1">
          {t("funding.log_direct_vat_payment")}
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          {t("funding.track_vat_paid_directly_to_tax_authorities_outside")}
        </p>
        <div className="grid gap-2 md:grid-cols-5">
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
          <input
            placeholder={t("funding.reference")}
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            className="rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-sm text-foreground"
          />
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
          <h3 className="text-sm font-semibold text-foreground">VAT Payments ({items.length})</h3>
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
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-right px-4 py-2 font-medium">{t("funding.amount_sar")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("funding.reference")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("funding.note")}</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-t border-border text-foreground">
                    <td className="px-4 py-2">{e.date}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-destructive">
                      {fmt(e.amount)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{e.reference || "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{e.note || "—"}</td>
                    <td className="px-2 py-2">
                      <button
                        onClick={() => {
                          if (confirm(t("funding.delete_this_vat_payment"))) remove(e.id);
                        }}
                        className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
                        title="Delete"
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
