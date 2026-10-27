import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { toast } from "sonner";
import { useCan } from "@/lib/rbac";
import { AlertTriangle } from "lucide-react";
import {
  createPaymentRequest,
  sumCommittedForSource,
  usePaymentRequests,
  type PaymentSourceKind,
} from "@/lib/payment-requests";
import { formatCurrency } from "@/lib/format";
import { useTranslation } from "react-i18next";

export type NewRequestSource = {
  organizationId: string;
  projectId?: string | null;
  sourceType: PaymentSourceKind;
  sourceId: string;
  sourceLabel: string;
  totalAmount: number;
  currency?: string;
};

export function PaymentRequestModal({
  source,
  onClose,
  onCreated,
}: {
  source: NewRequestSource;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const { t } = useTranslation();

  const can = useCan();
  const allowed = can("payments.request");
  const { rows } = usePaymentRequests({
    sourceType: source.sourceType,
    sourceId: source.sourceId,
  });

  const committed = useMemo(
    () => sumCommittedForSource(rows, source.sourceType, source.sourceId),
    [rows, source.sourceType, source.sourceId],
  );
  const remaining = Math.max(0, source.totalAmount - committed);
  const currency = source.currency ?? "SAR";
  const money = (n: number) => formatCurrency(n, { currency, decimals: 2 });

  const [amount, setAmount] = useState<number>(Number(remaining.toFixed(2)));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [action, setAction] = useState<"draft" | "submit">("submit");

  const exceeds = amount > remaining + 0.005;
  const invalid = !(amount > 0);

  const inputCls =
    "w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allowed) return;
    if (invalid) {
      toast.error(t("approvals.modal.amountRequired"));
      return;
    }
    if (exceeds) {
      toast.error(t("approvals.modal.exceeds", { amount: money(remaining) }));
      return;
    }
    setSubmitting(true);
    try {
      await createPaymentRequest({
        organizationId: source.organizationId,
        projectId: source.projectId ?? null,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceLabel: source.sourceLabel,
        totalAmount: source.totalAmount,
        previouslyPaid: committed,
        requestedAmount: amount,
        currency,
        notes: notes.trim().slice(0, 1000) || null,
        submitImmediately: action === "submit",
      });
      toast.success(
        action === "submit" ? t("approvals.toast.submitted") : t("approvals.toast.draftSaved"),
      );
      onCreated?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? t("approvals.toast.createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={t("approvals.modal.title")} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        {!allowed && (
          <div className="col-span-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            {t("approvals.modal.noPermission")} <b>payments.request</b>
          </div>
        )}
        <div className="col-span-2 rounded-xl border border-border bg-surface-2/70 p-3 text-sm">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("approvals.col.source")}
          </div>
          <div className="font-semibold mt-1 truncate">{source.sourceLabel}</div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">{t("approvals.modal.sourceTotal")}</div>
              <div className="font-semibold tabular-nums" dir="ltr">
                {money(source.totalAmount)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("approvals.modal.alreadyRequested")}</div>
              <div className="font-semibold text-success tabular-nums" dir="ltr">
                {money(committed)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("approvals.modal.remaining")}</div>
              <div className="font-semibold text-warning tabular-nums" dir="ltr">
                {money(remaining)}
              </div>
            </div>
          </div>
        </div>

        <label className="text-sm col-span-2">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
            {t("approvals.modal.amount", { currency })}
          </div>
          <input
            type="number"
            min={0}
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(+e.target.value)}
            dir="ltr"
            className={`${inputCls} text-end tabular-nums`}
          />
          {exceeds && (
            <div className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
              <span>{t("approvals.modal.exceeds", { amount: money(remaining) })}</span>
            </div>
          )}
        </label>

        <label className="text-sm col-span-2">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
            {t("approvals.modal.notes")}
          </div>
          <textarea
            rows={2}
            value={notes}
            maxLength={1000}
            onChange={(e) => setNotes(e.target.value)}
            className={`${inputCls} text-start`}
          />
        </label>

        <div className="col-span-2 flex flex-wrap justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-border hover:bg-muted"
          >
            {t("approvals.close")}
          </button>
          <button
            type="submit"
            onClick={() => setAction("draft")}
            disabled={submitting || !allowed || invalid || exceeds}
            className="px-4 py-2 rounded-xl border border-border bg-surface-2 hover:bg-muted font-semibold disabled:opacity-60"
          >
            {t("approvals.modal.saveDraft")}
          </button>
          <button
            type="submit"
            onClick={() => setAction("submit")}
            disabled={submitting || !allowed || invalid || exceeds}
            className="px-4 py-2 rounded-xl bg-success text-success-foreground font-semibold disabled:opacity-60"
          >
            {submitting ? t("approvals.working") : t("approvals.action.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
