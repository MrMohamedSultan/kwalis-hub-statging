import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCan } from "@/lib/rbac";
import { Modal } from "@/components/Modal";
import { DateInput } from "@/components/ui/date-input";
import {
  STATUS_LABEL,
  STATUS_COLORS,
  approvePaymentRequest,
  rejectPaymentRequest,
  submitForApproval,
  executePaymentRequest,
  deletePaymentRequest,
  getProofSignedUrl,
  useIsCreator,
  type PaymentRequest,
} from "@/lib/payment-requests";
import { Send, Check, X, UploadCloud, Trash2, Paperclip, Eye, RefreshCw } from "lucide-react";

import { useTranslation } from "react-i18next";
export function PaymentStatusBadge({ status }: { status: PaymentRequest["status"] }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_COLORS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Conditional action buttons for a single payment request.
 * Renders the correct action(s) for the current status + user permissions:
 *  - draft + payments.request (creator)  → "Send to Approval" · "Delete"
 *  - waiting_approval + payments.approve → "Approve" · "Reject"
 *  - approved + payments.execute         → "Execute & Upload Receipt"
 */
export function PaymentWorkflowActions({
  request,
  compact = false,
}: {
  request: PaymentRequest;
  compact?: boolean;
}) {
  const { t } = useTranslation();

  const can = useCan();
  const isCreator = useIsCreator(request);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [executeOpen, setExecuteOpen] = useState(false);

  const btnBase =
    "inline-flex items-center gap-1.5 rounded-lg font-semibold border transition disabled:opacity-60";
  const sz = compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs";

  const doSubmit = async () => {
    setBusy(true);
    try {
      await submitForApproval(request.id);
      toast.success(t("paymentworkflowactions.x_2"));
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر إرسال الطلب.");
    } finally {
      setBusy(false);
    }
  };
  const doApprove = async () => {
    setBusy(true);
    try {
      await approvePaymentRequest(request.id);
      toast.success(t("paymentworkflowactions.x_3"));
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر اعتماد الطلب.");
    } finally {
      setBusy(false);
    }
  };
  const doDelete = async () => {
    if (!confirm(t("paymentworkflowactions.x_7"))) return;
    setBusy(true);
    try {
      await deletePaymentRequest(request.id);
      toast.success(t("paymentworkflowactions.x_4"));
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر الحذف.");
    } finally {
      setBusy(false);
    }
  };

  const openProof = async () => {
    if (!request.proof_path) return;
    const url = await getProofSignedUrl(request.proof_path);
    if (!url) {
      toast.error(t("paymentworkflowactions.x"));
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap" dir="rtl">
      {request.status === "draft" && isCreator && can("payments.request") && (
        <>
          <button
            onClick={doSubmit}
            disabled={busy}
            className={`${btnBase} ${sz} bg-success/15 text-success border-success/30 hover:bg-success/25`}
          >
            <Send className="size-3" /> إرسال لطلب الاعتماد
          </button>
          <button
            onClick={doDelete}
            disabled={busy}
            title="حذف المسودة"
            className={`${btnBase} ${sz} bg-surface text-muted-foreground border-border hover:bg-muted`}
          >
            <Trash2 className="size-3" />
          </button>
        </>
      )}
      {request.status === "waiting_approval" && can("payments.approve") && (
        <>
          <button
            onClick={doApprove}
            disabled={busy}
            className={`${btnBase} ${sz} bg-success/15 text-success border-success/30 hover:bg-success/25`}
          >
            <Check className="size-3" /> اعتماد وموافقة
          </button>
          <button
            onClick={() => setRejectOpen(true)}
            disabled={busy}
            className={`${btnBase} ${sz} bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/25`}
          >
            <X className="size-3" /> رفض الطلب
          </button>
        </>
      )}
      {request.status === "approved" && can("payments.execute") && (
        <button
          onClick={() => setExecuteOpen(true)}
          disabled={busy}
          className={`${btnBase} ${sz} bg-info/15 text-info border-info/30 hover:bg-info/25`}
        >
          <UploadCloud className="size-3" /> تنفيذ السداد ورفع الإيصال
        </button>
      )}
      {request.status === "paid" && request.proof_path && (
        <button
          onClick={openProof}
          className={`${btnBase} ${sz} bg-surface text-info border-border hover:bg-muted`}
        >
          <Eye className="size-3" /> معاينة الإيصال
        </button>
      )}
      {rejectOpen && <RejectModal request={request} onClose={() => setRejectOpen(false)} />}
      {executeOpen && <ExecuteModal request={request} onClose={() => setExecuteOpen(false)} />}
    </div>
  );
}

function RejectModal({ request, onClose }: { request: PaymentRequest; onClose: () => void }) {
  const { t } = useTranslation();

  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      toast.error(t("paymentworkflowactions.x_8"));
      return;
    }
    setBusy(true);
    try {
      await rejectPaymentRequest(request.id, reason.trim());
      toast.success(t("paymentworkflowactions.x_6"));
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر رفض الطلب.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="رفض طلب السداد" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" dir="rtl">
        <label className="text-sm block">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
            سبب الرفض
          </div>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            placeholder="اشرح سبب رفض هذا الطلب…"
            className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-destructive text-start"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-border hover:bg-muted"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-destructive text-white font-semibold disabled:opacity-60"
          >
            {busy ? "جاري الرفض…" : "تأكيد الرفض"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const ALLOWED_RECEIPT_MIME = ["application/pdf", "image/png", "image/jpeg"];
const ALLOWED_RECEIPT_EXT = [".pdf", ".png", ".jpg", ".jpeg"];
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024; // 10 MB

function isValidReceipt(file: File): string | null {
  const name = file.name.toLowerCase();
  const extOk = ALLOWED_RECEIPT_EXT.some((e) => name.endsWith(e));
  const mimeOk = ALLOWED_RECEIPT_MIME.includes(file.type);
  if (!extOk || !mimeOk) return "يجب أن يكون الإيصال ملف PDF أو PNG أو JPEG.";
  if (file.size > MAX_RECEIPT_BYTES) return "حجم الإيصال يتجاوز ١٠ ميغابايت.";
  if (file.size <= 0) return "ملف الإيصال فارغ.";
  return null;
}

function ExecuteModal({ request, onClose }: { request: PaymentRequest; onClose: () => void }) {
  const { t } = useTranslation();

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<"Cash" | "Transfer" | "Check" | "Card" | "Bank">("Transfer");
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

  const METHOD_LABEL: Record<string, string> = {
    Cash: "نقدي",
    Transfer: "تحويل بنكي",
    Check: "شيك",
    Card: "بطاقة",
    Bank: "بنك",
  };

  const pickFile = (f: File | null) => {
    if (!f) {
      setFile(null);
      setFileError(null);
      return;
    }
    const err = isValidReceipt(f);
    if (err) {
      setFile(null);
      setFileError(err);
      toast.error(err);
      return;
    }
    setFile(f);
    setFileError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      const msg = "يرجى إرفاق إيصال إثبات السداد (PDF أو PNG أو JPEG).";
      setFileError(msg);
      toast.error(msg);
      return;
    }
    const err = isValidReceipt(file);
    if (err) {
      setFileError(err);
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      await executePaymentRequest({ id: request.id, paymentDate: date, method, proofFile: file });
      toast.success(t("paymentworkflowactions.x_5"));
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر تنفيذ السداد.");
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
    <Modal title="تنفيذ السداد ورفع الإيصال" onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3" dir="rtl">
        <label className="text-sm">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
            تاريخ السداد
          </div>
          <DateInput value={date} onChange={setDate} className={cls} />
        </label>
        <label className="text-sm">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
            طريقة السداد
          </div>
          <select value={method} onChange={(e) => setMethod(e.target.value as any)} className={cls}>
            {["Cash", "Transfer", "Check", "Card", "Bank"].map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm col-span-2">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs flex items-center justify-between">
            <span>
              إيصال / إثبات السداد <span className="text-destructive">*</span>
            </span>
            {file && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-info hover:text-info normal-case tracking-normal"
              >
                <RefreshCw className="size-3" /> استبدال الملف
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
                    alt="معاينة الإيصال"
                    className="max-h-40 rounded-lg border border-border object-contain bg-black/20"
                  />
                )}
                {previewUrl && isPdf && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] text-info hover:text-info"
                  >
                    <Eye className="size-3" /> معاينة الملف قبل التأكيد
                  </a>
                )}
              </div>
            ) : (
              <>
                <UploadCloud className="size-6 text-muted-foreground" />
                <div className="text-xs text-muted-foreground">
                  اضغط لإرفاق الإيصال — PDF أو PNG أو JPEG (بحد أقصى ١٠ ميغابايت)
                </div>
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
          {fileError && (
            <div
              role="alert"
              className="mt-1.5 text-[11px] text-destructive flex items-start gap-1"
            >
              <span aria-hidden>⚠</span>
              <span>{fileError}</span>
            </div>
          )}
          {!fileError && (
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              الصيغ المقبولة: PDF، PNG، JPEG · الحد الأقصى ١٠ ميغابايت
            </div>
          )}
        </div>
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
            disabled={busy || !file}
            className="px-4 py-2 rounded-xl bg-success text-white font-semibold disabled:opacity-60"
          >
            {busy ? "جاري التنفيذ…" : "تأكيد السداد"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
