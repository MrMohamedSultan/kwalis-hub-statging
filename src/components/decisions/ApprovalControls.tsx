// Invoice approval (db/pending/201): status pill, approve / reject / cancel
// actions (maker-checker enforced by the database) and the reason dialog.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, Check, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuthRoles } from "@/lib/auth-roles";
import { useStore, type Invoice, type InvoiceApprovalStatus } from "@/lib/store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);
const reasonSchema = z.string().trim().min(1).max(1000);

const PILL: Record<InvoiceApprovalStatus, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function ApprovalStatusPill({
  status,
  reason,
}: {
  status: InvoiceApprovalStatus | "pending" | "approved" | "rejected" | "cancelled";
  reason?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${PILL[status]}`}
      title={reason ?? undefined}
    >
      {t(`decisions.approval.${status}`)}
    </span>
  );
}

/** Can the signed-in user approve invoices of this project (public.can_approve_invoice)? */
export function useCanApproveInvoice(projectId: string | null | undefined): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setOk(false);
      return;
    }
    (async () => {
      const { data, error } = await rpc("can_approve_invoice", { p_project: projectId });
      if (!cancelled) setOk(!error && data === true);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return ok;
}

/** Reason dialog shared by reject / cancel actions. */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const parsed = reasonSchema.safeParse(reason);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">{t("decisions.approval.reason")}</span>
          <textarea
            value={reason}
            maxLength={1000}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 outline-none focus:ring-2 ring-brand"
          />
        </label>
        <DialogFooter>
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            {t("decisions.common.back")}
          </button>
          <button
            disabled={!parsed.success || busy}
            onClick={async () => {
              if (!parsed.success) return;
              setBusy(true);
              try {
                await onConfirm(parsed.data);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function patchInvoice(id: string, patch: Partial<Invoice>) {
  useStore.setState((s) => ({
    invoices: s.invoices.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  }));
}

/** Approve / reject (pending) and cancel (approved) buttons of one invoice row. */
export function InvoiceApprovalActions({
  invoice,
  canApprove,
}: {
  invoice: Invoice;
  canApprove: boolean;
}) {
  const { t } = useTranslation();
  const { userId } = useAuthRoles();
  const [dialog, setDialog] = useState<"reject" | "cancel" | null>(null);
  const status = invoice.approvalStatus ?? "approved";
  const isCreator = !!userId && invoice.createdBy === userId;
  const id = z.string().uuid().safeParse(invoice.id);

  const run = async (
    fn: string,
    args: Record<string, unknown>,
    patch: Partial<Invoice>,
    ok: string,
  ) => {
    if (!id.success) return;
    const { error } = await rpc(fn, { p_invoice: id.data, ...args });
    if (error) {
      toast.error(error.message);
      throw error;
    }
    patchInvoice(invoice.id, patch);
    toast.success(ok);
  };

  if (!canApprove) return null;
  return (
    <>
      {status === "pending" && (
        <span className="inline-flex gap-1">
          <button
            disabled={isCreator}
            title={
              isCreator ? t("decisions.approval.makerChecker") : t("decisions.approval.approve")
            }
            onClick={() =>
              void run(
                "approve_invoice",
                {},
                {
                  approvalStatus: "approved",
                  approvedBy: userId,
                  approvedAt: new Date().toISOString(),
                },
                t("decisions.invoice.approved"),
              ).catch(() => undefined)
            }
            className="inline-flex items-center gap-1 rounded-lg border border-success/30 bg-success/15 px-2 py-1 text-xs font-semibold text-success hover:bg-success/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="size-3" />
            {t("decisions.approval.approve")}
          </button>
          <button
            disabled={isCreator}
            title={
              isCreator ? t("decisions.approval.makerChecker") : t("decisions.approval.reject")
            }
            onClick={() => setDialog("reject")}
            className="inline-flex items-center gap-1 rounded-lg border border-destructive/30 bg-destructive/15 px-2 py-1 text-xs font-semibold text-destructive hover:bg-destructive/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <XIcon className="size-3" />
            {t("decisions.approval.reject")}
          </button>
        </span>
      )}
      {status === "approved" && (
        <button
          title={t("decisions.invoice.cancelHint")}
          onClick={() => setDialog("cancel")}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
        >
          <Ban className="size-3" />
          {t("decisions.approval.cancel")}
        </button>
      )}
      <ReasonDialog
        open={dialog !== null}
        title={
          dialog === "cancel"
            ? t("decisions.invoice.cancelTitle")
            : t("decisions.invoice.rejectTitle")
        }
        description={dialog === "cancel" ? t("decisions.invoice.cancelHint") : undefined}
        confirmLabel={
          dialog === "cancel" ? t("decisions.approval.cancel") : t("decisions.approval.reject")
        }
        onClose={() => setDialog(null)}
        onConfirm={(reason) =>
          dialog === "cancel"
            ? run(
                "cancel_invoice",
                { p_reason: reason },
                { approvalStatus: "cancelled", cancellationReason: reason },
                t("decisions.invoice.cancelled"),
              )
            : run(
                "reject_invoice",
                { p_reason: reason },
                { approvalStatus: "rejected", rejectionReason: reason },
                t("decisions.invoice.rejected"),
              )
        }
      />
    </>
  );
}

export const APPROVAL_FILTERS = ["all", "pending", "approved", "rejected", "cancelled"] as const;
export type ApprovalFilter = (typeof APPROVAL_FILTERS)[number];

export function ApprovalFilterSelect({
  value,
  onChange,
}: {
  value: ApprovalFilter;
  onChange: (v: ApprovalFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ApprovalFilter)}
      aria-label={t("decisions.approval.filter")}
      className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
    >
      {APPROVAL_FILTERS.map((f) => (
        <option key={f} value={f}>
          {f === "all" ? t("decisions.approval.allStatuses") : t(`decisions.approval.${f}`)}
        </option>
      ))}
    </select>
  );
}
