// RecordPaymentModal is now a thin adapter that opens the multi-step
// Payment Approval Workflow modal. Direct-payment recording has been
// replaced by Request → Approve → Execute. Existing call sites keep
// working: they pass a PaymentSourceInfo, we translate it into a
// payment request creation flow.
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore, formatUSD, type PaymentSource } from "@/lib/store";
import { PaymentRequestModal } from "@/components/PaymentRequestModal";
import { Num } from "@/lib/format";

export type PaymentSourceInfo = {
  type: PaymentSource;
  id: string;
  label: string;
  totalAmount: number;
};

export function RecordPaymentModal({
  source,
  onClose,
}: {
  source: PaymentSourceInfo;
  onClose: () => void;
}) {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const project = projects.find((p) => p.id === activeProjectId);
  const orgId = project?.organizationId ?? null;

  if (!orgId) {
    // No project scope — nothing we can attach the request to.
    return null;
  }

  return (
    <PaymentRequestModal
      source={{
        organizationId: orgId,
        projectId: activeProjectId ?? null,
        sourceType: source.type,
        sourceId: source.id,
        sourceLabel: source.label,
        totalAmount: source.totalAmount,
      }}
      onClose={onClose}
    />
  );
}

/**
 * Kept for backwards-compat: renders paid/partial/unpaid pill based on
 * the caller's tracked paid total. Now that payments flow through the
 * approval workflow, prefer <PaymentStatusBadge /> from
 * PaymentWorkflowActions when reading a payment_requests row directly.
 */
export function PaymentStatusPill({ paid, total }: { paid: number; total: number }) {
  const { t } = useTranslation();
  const remaining = Math.max(0, total - paid);
  const isPaid = total > 0 && remaining < 0.005;
  const isPartial = paid > 0 && !isPaid;
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1 min-w-[120px]">
      <div className="flex items-center gap-2">
        {isPaid ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/20 text-success text-[11px] font-semibold border border-success/30">
            <Check className="size-3" /> {t("people.paid")}
          </span>
        ) : isPartial ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/20 text-warning text-[11px] font-semibold border border-warning/30">
            {t("people.partial")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface text-muted-foreground text-[11px] font-semibold border border-border">
            {t("people.unpaid")}
          </span>
        )}
      </div>
      {total > 0 && (
        <>
          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div
              className={`h-full ${isPaid ? "bg-success" : "bg-warning"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <Num className="text-[10px] text-muted-foreground">
            {formatUSD(paid)} / {formatUSD(total)}
          </Num>
        </>
      )}
    </div>
  );
}
