import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useCan } from "@/lib/rbac";
import { useAuthRoles } from "@/lib/auth-roles";
import { Modal } from "@/components/Modal";
import { DateInput } from "@/components/ui/date-input";
import {
  STATUS_COLORS,
  statusLabelKey,
  approvePaymentRequest,
  rejectPaymentRequest,
  cancelPaymentRequest,
  canReversePaidRequest,
  reversePaidPaymentRequest,
  ReasonSchema,
  RefundReferenceSchema,
  submitForApproval,
  executePaymentRequest,
  deletePaymentRequest,
  getProofSignedUrl,
  useIsCreator,
  type ChainStatus,
  type PaymentRequest,
} from "@/lib/payment-requests";
import {
  Send,
  Check,
  X,
  UploadCloud,
  Trash2,
  Paperclip,
  Eye,
  RefreshCw,
  Ban,
  Hourglass,
  Undo2,
} from "lucide-react";

export function PaymentStatusBadge({ status }: { status: PaymentRequest["status"] }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_COLORS[status] ?? STATUS_COLORS.draft}`}
    >
      {t(statusLabelKey(status))}
    </span>
  );
}

/**
 * Conditional action buttons for a single payment request.
 *  - draft (creator)               → Send for approval · Delete
 *  - waiting_approval, your turn   → Approve · Reject (with reason)
 *  - waiting_approval, not yours   → "Waiting for: <level>"
 *  - approved + payments.execute   → Execute & upload receipt
 *  - requester (before approval) / org admin (before payment) → Cancel (with reason)
 *
 * `chain` comes from payment_request_chain_status; without it the old
 * single-approval rule (payments.approve) is used.
 */
export function PaymentWorkflowActions({
  request,
  chain,
  compact = false,
  onChanged,
}: {
  request: PaymentRequest;
  chain?: ChainStatus | null;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const can = useCan();
  const { isSuperAdmin, adminOrgIds, userId } = useAuthRoles();
  const isCreator = useIsCreator(request);
  const isOrgAdmin = isSuperAdmin || adminOrgIds.includes(request.organization_id);
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState<"reject" | "cancel" | "reverse" | null>(null);
  const [executeOpen, setExecuteOpen] = useState(false);

  const btnBase =
    "inline-flex items-center gap-1.5 rounded-lg font-semibold border transition disabled:opacity-60";
  const sz = compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs";

  const waiting = request.status === "waiting_approval";
  const myTurn = waiting && !isCreator && (chain ? chain.can_act : can("payments.approve"));
  const canReject = waiting && !isCreator && (myTurn || isOrgAdmin);
  const canCancel =
    (isCreator && (request.status === "draft" || waiting)) ||
    (isOrgAdmin && (request.status === "draft" || waiting || request.status === "approved"));

  const run = async (fn: () => Promise<unknown>, ok: string, fail: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? fail);
    } finally {
      setBusy(false);
    }
  };

  const doApprove = async () => {
    setBusy(true);
    try {
      const status = await approvePaymentRequest(request.id);
      toast.success(
        status === "approved" ? t("approvals.toast.approved") : t("approvals.toast.levelApproved"),
      );
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? t("approvals.toast.approveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirm(t("approvals.confirmDeleteDraft"))) return;
    await run(
      () => deletePaymentRequest(request.id),
      t("approvals.toast.deleted"),
      t("approvals.toast.deleteFailed"),
    );
  };

  const openProof = async () => {
    if (!request.proof_path) return;
    const url = await getProofSignedUrl(request.proof_path);
    if (!url) {
      toast.error(t("approvals.toast.proofFailed"));
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {request.status === "draft" && isCreator && can("payments.request") && (
        <>
          <button
            onClick={() =>
              run(
                () => submitForApproval(request.id),
                t("approvals.toast.submitted"),
                t("approvals.toast.submitFailed"),
              )
            }
            disabled={busy}
            className={`${btnBase} ${sz} bg-success/15 text-success border-success/30 hover:bg-success/25`}
          >
            <Send className="size-3" /> {t("approvals.action.submit")}
          </button>
          <button
            onClick={doDelete}
            disabled={busy}
            title={t("approvals.action.deleteDraft")}
            aria-label={t("approvals.action.deleteDraft")}
            className={`${btnBase} ${sz} bg-surface text-muted-foreground border-border hover:bg-muted`}
          >
            <Trash2 className="size-3" />
          </button>
        </>
      )}
      {myTurn && (
        <button
          onClick={doApprove}
          disabled={busy}
          className={`${btnBase} ${sz} bg-success/15 text-success border-success/30 hover:bg-success/25`}
        >
          <Check className="size-3" />{" "}
          {chain && chain.required_levels > 1
            ? t("approvals.action.approveLevel", {
                level: chain.next_level,
                total: chain.required_levels,
              })
            : t("approvals.action.approve")}
        </button>
      )}
      {canReject && (
        <button
          onClick={() => setReasonFor("reject")}
          disabled={busy}
          className={`${btnBase} ${sz} bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/25`}
        >
          <X className="size-3" /> {t("approvals.action.reject")}
        </button>
      )}
      {waiting && !myTurn && chain?.next_label && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Hourglass className="size-3" />
          {t("approvals.waitingFor", { label: chain.next_label })}
        </span>
      )}
      {request.status === "approved" && can("payments.execute") && (
        <button
          onClick={() => setExecuteOpen(true)}
          disabled={busy}
          className={`${btnBase} ${sz} bg-info/15 text-info border-info/30 hover:bg-info/25`}
        >
          <UploadCloud className="size-3" /> {t("approvals.action.execute")}
        </button>
      )}
      {request.status === "paid" && request.proof_path && (
        <button
          onClick={openProof}
          className={`${btnBase} ${sz} bg-surface text-info border-border hover:bg-muted`}
        >
          <Eye className="size-3" /> {t("approvals.action.viewReceipt")}
        </button>
      )}
      {request.status === "paid" && request.reversed_at && (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning"
          title={request.reversal_reason ?? undefined}
        >
          <Undo2 className="size-3" /> {t("closeout.reverse.badge")}
        </span>
      )}
      {canReversePaidRequest(request, isOrgAdmin, { userId, isSuperAdmin }) && (
        <button
          onClick={() => setReasonFor("reverse")}
          disabled={busy}
          title={t("closeout.reverse.hint")}
          className={`${btnBase} ${sz} bg-surface text-warning border-warning/30 hover:bg-warning/10`}
        >
          <Undo2 className="size-3" /> {t("closeout.reverse.action")}
        </button>
      )}
      {canCancel && (
        <button
          onClick={() => setReasonFor("cancel")}
          disabled={busy}
          title={t("approvals.action.cancelHint")}
          className={`${btnBase} ${sz} bg-surface text-muted-foreground border-border hover:bg-muted`}
        >
          <Ban className="size-3" /> {t("approvals.action.cancel")}
        </button>
      )}
      {reasonFor && (
        <ReasonModal
          mode={reasonFor}
          onClose={() => setReasonFor(null)}
          onConfirm={async (reason, reference) => {
            if (reasonFor === "reject") {
              await rejectPaymentRequest(request.id, reason);
              toast.success(t("approvals.toast.rejected"));
            } else if (reasonFor === "reverse") {
              await reversePaidPaymentRequest(request.id, reason, null, reference);
              toast.success(t("closeout.reverse.done"));
            } else {
              await cancelPaymentRequest(request.id, reason);
              toast.success(t("approvals.toast.cancelled"));
            }
            onChanged?.();
          }}
        />
      )}
      {executeOpen && (
        <ExecuteModal
          request={request}
          onClose={() => setExecuteOpen(false)}
          onDone={() => onChanged?.()}
        />
      )}
    </div>
  );
}

/** Reject or cancel — both need a written reason that the requester sees. */
function ReasonModal({
  mode,
  onClose,
  onConfirm,
}: {
  mode: "reject" | "cancel" | "reverse";
  onClose: () => void;
  onConfirm: (reason: string, reference?: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // same bounds as the database (3–1000 characters; reference up to 200)
    const parsed = ReasonSchema.safeParse(reason);
    if (!parsed.success) {
      toast.error(t("approvals.reasonTooShort"));
      return;
    }
    const ref = RefundReferenceSchema.safeParse(reference);
    if (!ref.success) {
      toast.error(t("closeout.reverse.reference_too_long"));
      return;
    }
    setBusy(true);
    try {
      await onConfirm(parsed.data, mode === "reverse" ? ref.data || null : null);
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? t("approvals.toast.actionFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        mode === "reject"
          ? t("approvals.rejectTitle")
          : mode === "reverse"
            ? t("closeout.reverse.title")
            : t("approvals.cancelTitle")
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        {mode === "cancel" && (
          <p className="text-xs text-muted-foreground">{t("approvals.cancelExplain")}</p>
        )}
        {mode === "reverse" && (
          <p className="text-xs text-muted-foreground">{t("closeout.reverse.explain")}</p>
        )}
        <label className="text-sm block">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
            {mode === "reject"
              ? t("approvals.rejectReason")
              : mode === "reverse"
                ? t("closeout.reverse.reason")
                : t("approvals.cancelReason")}
          </div>
          <textarea
            rows={3}
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            required
            placeholder={t("approvals.reasonPlaceholder")}
            className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-destructive text-start"
          />
        </label>
        {mode === "reverse" && (
          <label className="text-sm block">
            <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
              {t("closeout.reverse.reference")}
            </div>
            <input
              value={reference}
              maxLength={200}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("closeout.reverse.reference_hint")}
              className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-destructive text-start"
            />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-border hover:bg-muted"
          >
            {t("approvals.close")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-destructive text-destructive-foreground font-semibold disabled:opacity-60"
          >
            {busy
              ? t("approvals.working")
              : mode === "reject"
                ? t("approvals.confirmReject")
                : mode === "reverse"
                  ? t("closeout.reverse.confirm")
                  : t("approvals.confirmCancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const ALLOWED_RECEIPT_MIME = ["application/pdf", "image/png", "image/jpeg"];
const ALLOWED_RECEIPT_EXT = [".pdf", ".png", ".jpg", ".jpeg"];
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024; // 10 MB

/** i18n key of the problem with a receipt file, or null when it is fine. */
function receiptProblem(file: File): string | null {
  const name = file.name.toLowerCase();
  const extOk = ALLOWED_RECEIPT_EXT.some((e) => name.endsWith(e));
  const mimeOk = ALLOWED_RECEIPT_MIME.includes(file.type);
  if (!extOk || !mimeOk) return "approvals.receipt.badType";
  if (file.size > MAX_RECEIPT_BYTES) return "approvals.receipt.tooBig";
  if (file.size <= 0) return "approvals.receipt.empty";
  return null;
}

const METHODS = ["Cash", "Transfer", "Check", "Card", "Bank"] as const;

function ExecuteModal({
  request,
  onClose,
  onDone,
}: {
  request: PaymentRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<(typeof METHODS)[number]>("Transfer");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Client-side preview URL for the selected file (image or PDF).
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);
  const isImage = !!file && file.type.startsWith("image/");
  const isPdf = !!file && file.type === "application/pdf";

  const pickFile = (f: File | null) => {
    if (!f) {
      setFile(null);
      setFileError(null);
      return;
    }
    const err = receiptProblem(f);
    if (err) {
      setFile(null);
      setFileError(err);
      toast.error(t(err));
      return;
    }
    setFile(f);
    setFileError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = file ? receiptProblem(file) : "approvals.receipt.required";
    if (err) {
      setFileError(err);
      toast.error(t(err));
      return;
    }
    setBusy(true);
    try {
      await executePaymentRequest({ id: request.id, paymentDate: date, method, proofFile: file });
      toast.success(t("approvals.toast.paid"));
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? t("approvals.toast.payFailed"));
    } finally {
      setBusy(false);
    }
  };
  const cls =
    "w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand text-start";
  const dropCls = fileError
    ? "border-destructive/60 bg-destructive/10"
    : "border-border bg-surface-2 hover:bg-muted";
  return (
    <Modal title={t("approvals.executeTitle")} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
            {t("approvals.paymentDate")}
          </div>
          <DateInput value={date} onChange={setDate} className={cls} />
        </label>
        <label className="text-sm">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
            {t("approvals.paymentMethod")}
          </div>
          <select value={method} onChange={(e) => setMethod(e.target.value as any)} className={cls}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`approvals.method.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm sm:col-span-2">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs flex items-center justify-between">
            <span>
              {t("approvals.receipt.label")} <span className="text-destructive">*</span>
            </span>
            {file && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-info hover:text-info normal-case tracking-normal"
              >
                <RefreshCw className="size-3" /> {t("approvals.receipt.replace")}
              </button>
            )}
          </div>
          <div
            onClick={() => !file && fileRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-4 ${dropCls} ${file ? "" : "cursor-pointer"}`}
          >
            {file ? (
              <div className="w-full flex flex-col items-center gap-2">
                <div className="inline-flex items-center gap-2 text-sm">
                  <Paperclip className="size-4 text-success" />
                  <span className="truncate max-w-[240px]">{file.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    ({(file.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
                {previewUrl && isImage && (
                  <img
                    src={previewUrl}
                    alt={t("approvals.receipt.preview")}
                    className="max-h-40 rounded-lg border border-border object-contain bg-surface-2"
                  />
                )}
                {previewUrl && isPdf && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] text-info hover:text-info"
                  >
                    <Eye className="size-3" /> {t("approvals.receipt.previewPdf")}
                  </a>
                )}
              </div>
            ) : (
              <>
                <UploadCloud className="size-6 text-muted-foreground" />
                <div className="text-xs text-muted-foreground">{t("approvals.receipt.pick")}</div>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {fileError ? (
            <div
              role="alert"
              className="mt-1.5 text-[11px] text-destructive flex items-start gap-1"
            >
              <span aria-hidden>⚠</span>
              <span>{t(fileError)}</span>
            </div>
          ) : (
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              {t("approvals.receipt.formats")}
            </div>
          )}
        </div>
        <div className="sm:col-span-2 flex justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-border hover:bg-muted"
          >
            {t("approvals.close")}
          </button>
          <button
            type="submit"
            disabled={busy || !file}
            className="px-4 py-2 rounded-xl bg-success text-success-foreground font-semibold disabled:opacity-60"
          >
            {busy ? t("approvals.working") : t("approvals.confirmPaid")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
