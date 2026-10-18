import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useStore, formatUSD, generateId } from "@/lib/store";
import { useCan, useCurrentUser } from "@/lib/rbac";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock,
  Send,
  Wallet,
  Receipt,
  AlertTriangle,
  FilePlus,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/field-portal")({
  component: FieldPortal,
});

type FlagMap = Record<string, { confirmed?: boolean; cleared?: boolean }>;

const FLAG_KEY = "trackroll.field.flags.v1";

function loadFlags(): FlagMap {
  try {
    return JSON.parse(localStorage.getItem(FLAG_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveFlags(f: FlagMap) {
  try {
    localStorage.setItem(FLAG_KEY, JSON.stringify(f));
  } catch {
    /* noop */
  }
}

function FieldPortal() {
  const { t } = useTranslation();

  const { cashAdvances, receipts, addReceipt, addInvoice } = useStore();
  const can = useCan();
  const me = useCurrentUser();
  const canAddInvoice = can("invoices.add");
  const [flags, setFlags] = useState<FlagMap>({});
  useEffect(() => {
    setFlags(loadFlags());
  }, []);

  // Pick the first advance as the demo holder; could be selected by ?holder=
  const advance = cashAdvances[0];

  const myReceipts = useMemo(
    () => (advance ? receipts.filter((r) => r.advanceId === advance.id) : []),
    [receipts, advance],
  );
  const logged = useMemo(() => myReceipts.reduce((a, r) => a + (r.amount || 0), 0), [myReceipts]);

  const flag = advance ? flags[advance.id] || {} : {};
  const remaining = advance ? advance.totalAdvance - logged : 0;

  const updateFlag = (patch: Partial<FlagMap[string]>) => {
    if (!advance) return;
    const next: FlagMap = { ...flags, [advance.id]: { ...flag, ...patch } };
    setFlags(next);
    saveFlags(next);
  };

  // form state
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);

  // Quick vendor invoice (Field Crew permission)
  const [invAmount, setInvAmount] = useState("");
  const [invVendor, setInvVendor] = useState("");
  const [invDesc, setInvDesc] = useState("");
  const submitInvoice = async () => {
    const amt = Number(invAmount);
    if (!amt || amt <= 0) {
      toast.error(t("field_portal.enter_a_valid_invoice_amount"));
      return;
    }
    if (!invVendor.trim()) {
      toast.error(t("field_portal.add_the_vendor_name"));
      return;
    }
    await addInvoice({
      id: generateId(),
      description: invDesc.trim() || `Field expense — ${me.name}`,
      department: "Field",
      budgetCode: "",
      price: amt,
      vatable: false,
      date: new Date().toISOString().slice(0, 10),
      invoiceNo: `FLD-${Date.now().toString().slice(-6)}`,
      vendorName: invVendor.trim(),
      purchaserName: me.name,
      paymentTerm: 100,
    });
    toast.success(t("field_portal.vendor_invoice_submitted_pending_accountant_review"));
    setInvAmount("");
    setInvVendor("");
    setInvDesc("");
  };

  const submitReceipt = async () => {
    if (!advance) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (!desc.trim()) {
      toast.error(t("field_portal.add_a_short_description"));
      return;
    }
    await addReceipt({
      id: generateId(),
      advanceId: advance.id,
      recipient: advance.holder,
      department: desc.trim(),
      method: "Cash",
      amount: amt,
      date: new Date().toISOString().slice(0, 10),
    });
    toast.success(t("field_portal.receipt_logged_pending_accountant_review"));
    setAmount("");
    setDesc("");
    setPhoto(null);
  };

  const requestClearance = () => {
    updateFlag({ cleared: true });
    toast.success(t("field_portal.submitted_for_final_clearance_accountant_notified"));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand text-brand-foreground font-bold">
              FC
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground leading-none">
                {t("field_portal.field_crew_portal")}
              </p>
              <p className="truncate text-sm font-semibold">
                {advance?.holder ?? "No advance assigned"}
              </p>
            </div>
          </div>
          <Link
            to="/accounting"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-muted"
          >
            <ArrowLeft className="size-3.5" /> Studio
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 p-4 pb-24">
        {!advance && (
          <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
            {t("field_portal.no_active_cash_advance_is_assigned_to_you")}
          </div>
        )}

        {advance && (
          <>
            {/* Pending confirmation alert */}
            {!flag.confirmed && (
              <button
                onClick={() => {
                  updateFlag({ confirmed: true });
                  toast.success(t("field_portal.cash_advance_confirmed"));
                }}
                className="flex w-full items-start gap-3 rounded-2xl border border-warning/40 bg-warning/15 p-4 text-left transition hover:bg-warning/20"
              >
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-warning">
                    You have a pending Cash Advance of {formatUSD(advance.totalAdvance)}
                  </p>
                  <p className="text-xs text-warning">
                    {t("field_portal.tap_to_confirm_receipt_and_activate")}
                  </p>
                </div>
              </button>
            )}

            {/* Active Advance Card */}
            <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="size-4 text-brand" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("field_portal.active_advance")}
                  </h2>
                </div>
                {flag.cleared ? (
                  <span className="rounded-full border border-info/40 bg-info/15 px-2.5 py-1 text-[11px] font-semibold text-info">
                    {t("field_portal.pending_accountant_review")}
                  </span>
                ) : flag.confirmed ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success">
                    <CheckCircle2 className="size-3" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning">
                    <Clock className="size-3" />
                    {t("field_portal.awaiting_confirmation")}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Stat label="Total Advance" value={formatUSD(advance.totalAdvance)} />
                <Stat label="Logged" value={formatUSD(logged)} tone="warning" />
                <Stat
                  label="Remaining"
                  value={formatUSD(remaining)}
                  tone={remaining < 0 ? "danger" : "success"}
                />
              </div>

              <button
                disabled={!flag.confirmed || flag.cleared || myReceipts.length === 0}
                onClick={requestClearance}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-brand-foreground transition hover:opacity-90 disabled:opacity-40"
              >
                <Send className="size-4" />
                Submit for Final Clearance · إقفال العهدة
              </button>
            </section>

            {/* New Receipt Form */}
            <section className="rounded-2xl border border-border bg-surface p-5">
              <div className="mb-4 flex items-center gap-2">
                <Receipt className="size-4 text-brand" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  + Log New Field Receipt
                </h2>
              </div>
              <div className="space-y-3">
                <Field label="Amount Spent">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-base font-semibold focus:border-brand focus:outline-none"
                  />
                </Field>
                <Field label="Short Description">
                  <input
                    type="text"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder={t("field_portal.set_catering_emergency_run")}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:border-brand focus:outline-none"
                  />
                </Field>
                <Field label="Receipt Photo">
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/50 px-3 py-4 text-sm font-medium text-muted-foreground hover:border-brand hover:text-foreground">
                    <Camera className="size-4" />
                    {photo ? "Photo attached · tap to replace" : "Take or upload receipt photo"}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const url = URL.createObjectURL(f);
                        setPhoto(url);
                      }}
                    />
                  </label>
                  {photo && (
                    <img
                      src={photo}
                      alt={t("field_portal.receipt")}
                      className="mt-2 max-h-40 w-full rounded-xl border border-border object-cover"
                    />
                  )}
                </Field>
                <button
                  onClick={submitReceipt}
                  disabled={!flag.confirmed || flag.cleared}
                  className="w-full rounded-xl bg-success/20 px-4 py-3 text-sm font-semibold text-success ring-1 ring-success/40 transition hover:bg-success/30 disabled:opacity-40"
                >
                  {t("field_portal.submit_receipt")}
                </button>
                {!flag.confirmed && (
                  <p className="text-center text-xs text-muted-foreground">
                    {t("field_portal.confirm_the_advance_above_to_start_logging")}
                  </p>
                )}
              </div>
            </section>

            {/* Vendor invoice — gated by RBAC permission */}
            {canAddInvoice && (
              <section className="rounded-2xl border border-border bg-surface p-5">
                <div className="mb-4 flex items-center gap-2">
                  <FilePlus className="size-4 text-brand" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    + Submit Vendor Invoice
                  </h2>
                </div>
                <div className="space-y-3">
                  <Field label="Vendor Name">
                    <input
                      type="text"
                      value={invVendor}
                      onChange={(e) => setInvVendor(e.target.value)}
                      placeholder={t("field_portal.abc_catering_co")}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:border-brand focus:outline-none"
                    />
                  </Field>
                  <Field label="Amount">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={invAmount}
                      onChange={(e) => setInvAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-base font-semibold focus:border-brand focus:outline-none"
                    />
                  </Field>
                  <Field label="Description">
                    <input
                      type="text"
                      value={invDesc}
                      onChange={(e) => setInvDesc(e.target.value)}
                      placeholder="What was purchased?"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:border-brand focus:outline-none"
                    />
                  </Field>
                  <button
                    onClick={submitInvoice}
                    className="w-full rounded-xl bg-info/20 px-4 py-3 text-sm font-semibold text-info ring-1 ring-info/40 transition hover:bg-info/30"
                  >
                    {t("field_portal.submit_invoice_for_review")}
                  </button>
                </div>
              </section>
            )}

            {/* Transaction ledger */}
            <section className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                My Receipts ({myReceipts.length})
              </h2>
              {myReceipts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("field_portal.no_receipts_logged_yet")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {myReceipts.map((r) => (
                    <li key={r.id} className="flex items-center justify-between py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {r.department || "Field receipt"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.date} · {r.method}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{formatUSD(r.amount)}</span>
                        <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
                          Pending
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background/50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-base font-bold leading-tight ${toneCls}`}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
