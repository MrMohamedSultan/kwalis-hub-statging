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
import { formatUSD } from "@/lib/store";

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
      toast.error(t("paymentrequestmodal.x"));
      return;
    }
    if (exceeds) {
      toast.error(`المبلغ يتجاوز الرصيد المتبقي (${formatUSD(remaining)}).`);
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
        currency: source.currency ?? "SAR",
        notes: notes.trim() || null,
        submitImmediately: action === "submit",
      });
      toast.success(action === "submit" ? "تم إرسال الطلب للاعتماد." : "تم حفظ المسودة.");
      onCreated?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "تعذّر إنشاء الطلب.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="طلب سداد جديد" onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3" dir="rtl">
        {!allowed && (
          <div className="col-span-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            لا تملك صلاحية <b>payments.request</b>.
          </div>
        )}
        <div className="col-span-2 rounded-xl border border-border bg-surface-2/70 p-3 text-sm">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">المصدر</div>
          <div className="font-semibold mt-1 truncate">{source.sourceLabel}</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">إجمالي قيمة العقد</div>
              <div className="font-semibold tabular-nums" dir="ltr">
                {formatUSD(source.totalAmount)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">المدفوع / المطلوب سابقاً</div>
              <div className="font-semibold text-success tabular-nums" dir="ltr">
                {formatUSD(committed)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">المبلغ المتبقي</div>
              <div className="font-semibold text-warning tabular-nums" dir="ltr">
                {formatUSD(remaining)}
              </div>
            </div>
          </div>
        </div>

        <label className="text-sm col-span-2">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
            قيمة الطلب الحالي
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
              <span>يتجاوز الرصيد المتبقي البالغ {formatUSD(remaining)}.</span>
            </div>
          )}
        </label>

        <label className="text-sm col-span-2">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
            ملاحظات (اختيارية)
          </div>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`${inputCls} text-start`}
          />
        </label>

        <div className="col-span-2 flex justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-border hover:bg-muted"
          >
            إلغاء
          </button>
          <button
            type="submit"
            onClick={() => setAction("draft")}
            disabled={submitting || !allowed || invalid || exceeds}
            className="px-4 py-2 rounded-xl border border-border bg-surface-2 hover:bg-muted font-semibold disabled:opacity-60"
          >
            حفظ كمسودة
          </button>
          <button
            type="submit"
            onClick={() => setAction("submit")}
            disabled={submitting || !allowed || invalid || exceeds}
            className="px-4 py-2 rounded-xl bg-success text-white font-semibold disabled:opacity-60"
          >
            {submitting ? "جاري الإرسال…" : "إرسال لطلب الاعتماد"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
