import { useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { X, Wallet, Banknote, Coins } from "lucide-react";

import { useTranslation } from "react-i18next";
export type PaymentSource = "cash" | "bank_transfer" | "petty_cash";

export const PAYMENT_SOURCE_OPTIONS: {
  value: PaymentSource;
  label: string;
  icon: any;
  description: string;
}[] = [
  { value: "cash", label: "Cash", icon: Banknote, description: "Direct cash disbursement" },
  {
    value: "bank_transfer",
    label: "Main Bank Transfer",
    icon: Wallet,
    description: "Production bank account transfer",
  },
  {
    value: "petty_cash",
    label: "Petty Cash / Custodian",
    icon: Coins,
    description: "Paid from petty cash / custodian float",
  },
];

export type PaymentSourceResult = {
  source: PaymentSource;
  reference: string;
  amount: number | null;
  paidAt: string;
};

/**
 * Standardized "record payment" dialog used platform-wide whenever a payment
 * is marked as paid. Captures the funding source, reference number and
 * amount/date for ledger reconciliation.
 */
export function PaymentSourceDialog({
  open,
  onClose,
  onConfirm,
  title = "Record Payment",
  defaultAmount,
  currency = "SAR",
  submitting = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (result: PaymentSourceResult) => void;
  title?: string;
  defaultAmount?: number | null;
  currency?: string;
  submitting?: boolean;
}) {
  const { t } = useTranslation();

  const [source, setSource] = useState<PaymentSource>("bank_transfer");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState<string>(defaultAmount != null ? String(defaultAmount) : "");
  const [paidAt, setPaidAt] = useState<string>(new Date().toISOString().slice(0, 10));

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card text-card-foreground border border-border rounded-xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Payment Source *
            </label>
            <div className="mt-2 space-y-1.5">
              {PAYMENT_SOURCE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = source === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSource(opt.value)}
                    className={`w-full flex items-start gap-2.5 rounded-lg border px-3 py-2 text-start transition ${
                      active ? "border-brand bg-brand/10" : "border-border hover:bg-muted"
                    }`}
                  >
                    <Icon
                      className={`size-4 mt-0.5 shrink-0 ${active ? "text-brand" : "text-muted-foreground"}`}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-[11px] text-muted-foreground">{opt.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Amount ({currency})
              </label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Date
              </label>
              <DateInput
                value={paidAt}
                onChange={(v) => setPaidAt(v)}
                className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Reference / Voucher #
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("paymentsourcedialog.trx20260012_or_cheque_number")}
              className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onConfirm({
                source,
                reference: reference.trim(),
                amount: amount === "" ? null : Number(amount),
                paidAt,
              })
            }
            disabled={submitting}
            className="rounded-md bg-brand hover:bg-brand/90 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            {submitting ? "Recording…" : "Confirm Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
