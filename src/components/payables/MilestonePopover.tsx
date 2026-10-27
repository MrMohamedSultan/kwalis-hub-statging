// ═══════════════════════════════════════════════════════════════════
// MilestonePopover.tsx — with Payment Execution Form
//   - "Mark as Paid" no longer fires instantly
//   - Reveals a compact Payment Execution Form (date, ref, notes)
//   - "Confirm & Pay" submits the full payload
// ═══════════════════════════════════════════════════════════════════
import { formatDate } from "@/lib/date-format";
import { DateInput } from "@/components/ui/date-input";
import { storageAudited } from "@/lib/storage-audit";
import { useState, type ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_CONFIG, fmt, useStatusLabel } from "./payables-utils";
import { MilestoneCell } from "./MilestoneCell";
import type { PayableMilestone } from "./payables-types";

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/** Uploads a receipt to the private `receipts` bucket and returns a long-lived signed URL. */
async function uploadReceipt(file: File, milestoneId: string): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error("You must be signed in to upload a receipt.");

  const ext =
    file.name
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${uid}/${milestoneId}-${Date.now()}.${ext}`;

  const { error: upErr } = await storageAudited.from("receipts").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (upErr) throw new Error(upErr.message);

  const { data: signed, error: signErr } = await storageAudited
    .from("receipts")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  if (signErr || !signed?.signedUrl)
    throw new Error(signErr?.message || "Could not link the uploaded receipt.");
  return signed.signedUrl;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function ActionButton({
  label,
  variant,
  disabled,
  onClick,
}: {
  label: string;
  variant: "destructive" | "success" | "outline" | "ghost-destructive";
  disabled?: boolean;
  onClick: () => void;
}) {
  const styles = {
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    success: "bg-success text-success-foreground hover:bg-success/90",
    outline: "border border-border text-foreground hover:bg-muted",
    "ghost-destructive": "text-destructive hover:bg-destructive/10",
  } as const;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors
                  cursor-pointer disabled:opacity-50 ${styles[variant]}`}
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: PayableMilestone["milestone_status"] }) {
  const statusLabel = useStatusLabel();
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${config.bg} ${config.text}`}
    >
      {config.icon && <span>{config.icon}</span>}
      {statusLabel(status)}
    </div>
  );
}

interface PaymentFormData {
  paid_date: string;
  payment_ref: string;
  payment_method: string;
  source_account: string;
  receipt_url: string;
  notes: string;
}

const PAYMENT_METHODS = [
  { value: "", labelKey: "payables.formExtra.selectMethod" },
  { value: "wire_transfer", labelKey: "payables.methods.wire_transfer" },
  { value: "bank_transfer", labelKey: "payables.methods.bank_transfer" },
  { value: "check", labelKey: "payables.methods.check" },
  { value: "cash", labelKey: "payables.methods.cash" },
  { value: "credit_card", labelKey: "payables.methods.credit_card" },
] as const;

const SOURCE_ACCOUNTS = [
  { value: "", labelKey: "payables.formExtra.selectSource" },
  { value: "main_production", labelKey: "payables.sources.main_production" },
  { value: "secondary_bank", labelKey: "payables.sources.secondary_bank" },
  { value: "petty_cash_office", labelKey: "payables.sources.petty_cash_office" },
  { value: "petty_cash_location", labelKey: "payables.sources.petty_cash_location" },
  { value: "escrow", labelKey: "payables.sources.escrow" },
  { value: "credit_facility", labelKey: "payables.sources.credit_facility" },
] as const;

const INPUT_BASE =
  "w-full bg-input border rounded-lg px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring";
const INPUT_OK = `${INPUT_BASE} border-border`;
const INPUT_ERR = `${INPUT_BASE} border-destructive`;

const SELECT_BASE =
  "w-full bg-input border rounded-lg ps-3 pe-8 py-2 text-sm text-foreground " +
  "cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-ring";
const SELECT_OK = `${SELECT_BASE} border-border`;
const SELECT_ERR = `${SELECT_BASE} border-destructive`;

function isValidURL(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function PaymentExecutionForm({
  milestone,
  isSubmitting,
  onConfirm,
  onCancel,
}: {
  milestone: PayableMilestone;
  isSubmitting: boolean;
  onConfirm: (data: PaymentFormData) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<PaymentFormData>({
    paid_date: todayISO(),
    payment_ref: "",
    payment_method: "",
    source_account: "",
    receipt_url: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const set = (field: keyof PaymentFormData, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!formData.paid_date) e.paid_date = t("payables.formExtra.errRequired");
    if (!formData.payment_ref.trim()) e.payment_ref = t("payables.formExtra.errRefRequired");
    if (!formData.payment_method) e.payment_method = t("payables.formExtra.errMethod");
    if (!formData.source_account) e.source_account = t("payables.formExtra.errSource");
    if (receiptFile && receiptFile.size > MAX_RECEIPT_BYTES) {
      e.receipt_file = t("payables.formExtra.errFileSize");
    }
    if (!receiptFile && formData.receipt_url.trim() && !isValidURL(formData.receipt_url.trim())) {
      e.receipt_url = t("payables.formExtra.errUrl");
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    let receiptUrl = formData.receipt_url.trim();
    if (receiptFile) {
      setUploading(true);
      try {
        receiptUrl = await uploadReceipt(receiptFile, milestone.id);
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          receipt_file: err instanceof Error ? err.message : t("payables.formExtra.errUpload"),
        }));
        return;
      } finally {
        setUploading(false);
      }
    }
    onConfirm({ ...formData, receipt_url: receiptUrl });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 pt-2">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("payables.paymentForm.title")}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Scrollable fields — action buttons stay pinned below */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pe-2">
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("payables.paymentForm.amountToPay")}
          </span>

          <span className="font-mono text-sm font-bold tabular-nums text-foreground">
            {milestone.currency} {fmt(milestone.milestone_amount)}
          </span>
        </div>

        {/* Row 1 — Method + Source */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-foreground">
              {t("payables.formExtra.method")} <span className="text-destructive">*</span>
            </label>
            <select
              value={formData.payment_method}
              onChange={(e) => set("payment_method", e.target.value)}
              className={errors.payment_method ? SELECT_ERR : SELECT_OK}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {t(m.labelKey)}
                </option>
              ))}
            </select>
            {errors.payment_method && (
              <p className="mt-0.5 text-[10px] text-destructive">{errors.payment_method}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-foreground">
              {t("payables.formExtra.source")} <span className="text-destructive">*</span>
            </label>
            <select
              value={formData.source_account}
              onChange={(e) => set("source_account", e.target.value)}
              className={errors.source_account ? SELECT_ERR : SELECT_OK}
            >
              {SOURCE_ACCOUNTS.map((a) => (
                <option key={a.value} value={a.value}>
                  {t(a.labelKey)}
                </option>
              ))}
            </select>
            {errors.source_account && (
              <p className="mt-0.5 text-[10px] text-destructive">{errors.source_account}</p>
            )}
          </div>
        </div>

        {/* Row 2 — Date + Reference */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-foreground">
              {t("payables.formExtra.date")} <span className="text-destructive">*</span>
            </label>
            <DateInput
              value={formData.paid_date}
              onChange={(v) => set("paid_date", v)}
              className={errors.paid_date ? INPUT_ERR : INPUT_OK}
            />
            {errors.paid_date && (
              <p className="mt-0.5 text-[10px] text-destructive">{errors.paid_date}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-foreground">
              {t("payables.formExtra.reference")} <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={formData.payment_ref}
              onChange={(e) => set("payment_ref", e.target.value)}
              placeholder={t("payables.formExtra.refPlaceholder")}
              maxLength={100}
              className={errors.payment_ref ? INPUT_ERR : INPUT_OK}
            />
            {errors.payment_ref && (
              <p className="mt-0.5 text-[10px] text-destructive">{errors.payment_ref}</p>
            )}
          </div>
        </div>

        {/* Row 3 — Receipt file upload + link */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-foreground">
            {t("payables.formExtra.receiptLabel")}{" "}
            <span className="font-normal text-muted-foreground">
              {t("payables.formExtra.fileOrLink")}
            </span>
          </label>
          <div className="flex items-center gap-2">
            <label
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border
                       px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Paperclip className="size-3.5" />
              {receiptFile
                ? t("payables.formExtra.changeFile")
                : t("payables.formExtra.uploadReceipt")}
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setReceiptFile(f);
                  setErrors((prev) => ({ ...prev, receipt_file: "" }));
                }}
              />
            </label>
            {receiptFile && (
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate text-[10px] text-muted-foreground">
                  {receiptFile.name}
                </span>
                <button
                  type="button"
                  onClick={() => setReceiptFile(null)}
                  aria-label={t("payables.formExtra.removeFile")}
                  className="cursor-pointer text-[11px] leading-none text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </div>
            )}
          </div>
          {errors.receipt_file && (
            <p className="mt-0.5 text-[10px] text-destructive">{errors.receipt_file}</p>
          )}
          <input
            type="url"
            value={formData.receipt_url}
            onChange={(e) => set("receipt_url", e.target.value)}
            placeholder={t("payables.formExtra.linkPlaceholder")}
            maxLength={500}
            disabled={!!receiptFile}
            className={`mt-1.5 ${errors.receipt_url ? INPUT_ERR : INPUT_OK} disabled:opacity-50`}
          />
          {errors.receipt_url && (
            <p className="mt-0.5 text-[10px] text-destructive">{errors.receipt_url}</p>
          )}
        </div>

        {/* Row 4 — Notes */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-foreground">
            {t("payables.formExtra.notes")}{" "}
            <span className="font-normal text-muted-foreground">
              {t("payables.formExtra.optional")}
            </span>
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder={t("payables.paymentForm.notesPlaceholder")}
            rows={2}
            maxLength={500}
            className={`${INPUT_OK} resize-none`}
          />
        </div>
      </div>

      <div className="flex gap-2 border-t border-border pt-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || uploading}
          className="flex-1 cursor-pointer rounded-lg bg-success px-3 py-2.5 text-xs font-bold
                     text-success-foreground transition-colors hover:bg-success/90 disabled:opacity-50"
        >
          {isSubmitting || uploading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="size-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
              {uploading
                ? t("payables.milestoneExtra.uploadingReceipt")
                : t("payables.milestone.processing")}
            </span>
          ) : (
            `✓ ${t("payables.milestone.confirmPay")}`
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting || uploading}
          className="cursor-pointer rounded-lg border border-border px-3 py-2.5 text-xs font-medium
                     text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

export function MilestonePopoverCell({
  milestone,
  onMilestoneUpdate,
  readOnly = false,
  width = 110,
  pulseKey,
  children,
}: {
  milestone?: PayableMilestone;
  onMilestoneUpdate: (milestoneId: string, updates: Partial<PayableMilestone>) => Promise<void>;
  readOnly?: boolean;
  width?: number;
  pulseKey?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  if (!milestone) {
    return <MilestoneCell width={width} />;
  }

  const handleAction = async (milestoneId: string, updates: Partial<PayableMilestone>) => {
    await onMilestoneUpdate(milestoneId, updates);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ?? <MilestoneCell milestone={milestone} width={width} pulseKey={pulseKey} />}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        alignOffset={-4}
        avoidCollisions={true}
        collisionPadding={16}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="flex w-[320px] max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height,calc(100vh-2rem))] flex-col overflow-hidden rounded-xl border-border bg-popover p-0 text-popover-foreground shadow-xl"
      >
        <MilestonePopover
          milestone={milestone}
          onAction={handleAction}
          onClose={() => setOpen(false)}
          readOnly={readOnly}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Quick-action popover content anchored to a milestone cell by Radix Popover. */
export function MilestonePopover({
  milestone,
  onAction,
  onClose,
  readOnly = false,
}: {
  milestone: PayableMilestone;
  onAction: (milestoneId: string, updates: Partial<PayableMilestone>) => Promise<void>;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editAmount, setEditAmount] = useState(milestone.milestone_amount);
  const [showPayForm, setShowPayForm] = useState(false);
  const [showUndo, setShowUndo] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const doAction = async (updates: Partial<PayableMilestone>) => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onAction(milestone.id, updates);
      onClose();
    } catch (e: any) {
      // Keep the popover open so the user knows the change was not saved.
      setActionError(e?.message ?? t("payables.genericError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaymentConfirm = (data: PaymentFormData) => {
    void doAction({
      milestone_status: "paid",
      paid_date: data.paid_date,
      payment_ref: data.payment_ref.trim(),
      payment_method: data.payment_method,
      source_account: data.source_account,
      receipt_url: data.receipt_url.trim() || undefined,
      notes: data.notes.trim() || undefined,
    });
  };

  const renderFooter = !readOnly && !showPayForm && !isEditing;

  return (
    <div className="flex max-h-[var(--radix-popover-content-available-height)] min-h-0 w-full flex-col overflow-hidden bg-popover text-popover-foreground">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 pb-2 pt-4">
        <h4 className="min-w-0 truncate text-sm font-semibold text-foreground">
          {milestone.milestone_label ||
            t("payables.milestoneExtra.paymentN", { n: milestone.milestone_number })}
        </h4>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-lg
                     leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          ×
        </button>
      </div>

      <div
        className={`min-h-0 flex-1 px-4 py-3 ${
          showPayForm
            ? "flex flex-col gap-3 overflow-hidden"
            : "space-y-3 overflow-y-auto overscroll-contain"
        }`}
      >
        <StatusBadge status={milestone.milestone_status} />

        {actionError && (
          <div
            role="alert"
            className="shrink-0 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] font-medium text-destructive"
          >
            {actionError}
          </div>
        )}

        {isEditing ? (
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-foreground">
              {t("payables.milestoneExtra.amountLabel", { currency: milestone.currency })}
            </label>
            <input
              type="number"
              step="0.01"
              value={editAmount}
              onChange={(e) => setEditAmount(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 font-mono text-sm
                         text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => doAction({ milestone_amount: editAmount })}
                disabled={isSubmitting || editAmount <= 0}
                className="flex-1 cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {t("milestonepopover.save_amount")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditAmount(milestone.milestone_amount);
                  setIsEditing(false);
                }}
                className="flex-1 cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("payables.amount")}
            </div>
            <div className="font-mono text-lg font-bold tabular-nums text-foreground">
              {milestone.currency} {fmt(milestone.milestone_amount)}
            </div>
          </div>
        )}

        {milestone.milestone_status === "pending" &&
          (milestone.payment_request_status === "rejected" ||
            milestone.payment_request_status === "cancelled") && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {milestone.payment_request_status === "rejected"
                ? t("approvals.payables.lastRejected")
                : t("approvals.payables.lastCancelled")}
              {milestone.payment_request_reason ? `: ${milestone.payment_request_reason}` : ""}
            </div>
          )}

        {milestone.milestone_status === "paid" && (
          <div className="space-y-1 rounded-lg bg-success/10 p-3">
            {milestone.paid_date && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">{t("payables.paidOn")}</span>
                <span className="text-xs font-medium text-foreground">
                  {formatDate(milestone.paid_date)}
                </span>
              </div>
            )}
            {milestone.payment_ref && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {t("payables.paymentForm.reference")}
                </span>
                <span className="font-mono text-xs font-medium text-foreground">
                  {milestone.payment_ref}
                </span>
              </div>
            )}
            {milestone.payment_method && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {t("payables.formExtra.method")}
                </span>
                <span className="text-xs font-medium text-foreground">
                  {(() => {
                    const found = PAYMENT_METHODS.find((m) => m.value === milestone.payment_method);
                    return found ? t(found.labelKey) : milestone.payment_method;
                  })()}
                </span>
              </div>
            )}
            {milestone.source_account && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {t("payables.formExtra.source")}
                </span>
                <span className="text-xs font-medium text-foreground">
                  {(() => {
                    const found = SOURCE_ACCOUNTS.find((a) => a.value === milestone.source_account);
                    return found ? t(found.labelKey) : milestone.source_account;
                  })()}
                </span>
              </div>
            )}
            {milestone.receipt_url && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {t("payables.formExtra.receipt")}
                </span>
                <a
                  href={milestone.receipt_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-xs font-medium text-primary underline decoration-dotted"
                >
                  {t("payables.milestoneExtra.openProof")}
                </a>
              </div>
            )}

            {milestone.notes && (
              <div className="border-t border-success/20 pt-1">
                <span className="text-[10px] text-muted-foreground">
                  {t("payables.formExtra.notes")}
                </span>
                <p className="mt-0.5 text-xs text-foreground">{milestone.notes}</p>
              </div>
            )}
          </div>
        )}

        {!readOnly && showPayForm && (
          <PaymentExecutionForm
            milestone={milestone}
            isSubmitting={isSubmitting}
            onConfirm={handlePaymentConfirm}
            onCancel={() => setShowPayForm(false)}
          />
        )}
      </div>

      {readOnly && (
        <div className="shrink-0 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">{t("payables.readOnly")}</p>
        </div>
      )}

      {renderFooter && (
        <div className="shrink-0 space-y-2 border-t border-border px-4 py-3">
          {milestone.milestone_status === "pending" && (
            <>
              {milestone.contract_approved === false && (
                <p className="text-[11px] text-warning">
                  {t("approvals.payables.contractNotApproved")}
                </p>
              )}
              <ActionButton
                label={t("payables.milestone.requestPayment")}
                variant="destructive"
                disabled={isSubmitting || milestone.contract_approved === false}
                onClick={() => doAction({ milestone_status: "requested" })}
              />
              <ActionButton
                label={t("payables.milestone.editAmount")}
                variant="outline"
                disabled={isSubmitting}
                onClick={() => setIsEditing(true)}
              />
            </>
          )}

          {milestone.milestone_status === "requested" && (
            <>
              <p className="text-[11px] text-muted-foreground">
                {t("approvals.payables.awaiting")}
              </p>
              <Link
                to="/payment-approvals"
                className="block w-full rounded-lg border border-border px-3 py-2 text-center text-xs font-semibold text-foreground hover:bg-muted"
              >
                {t("approvals.payables.openApprovals")}
              </Link>
              {milestone.requested_by_me && milestone.payment_request_id && (
                <ActionButton
                  label={t("payables.milestone.cancelRequest")}
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => doAction({ milestone_status: "pending" })}
                />
              )}
            </>
          )}

          {milestone.milestone_status === "approved" && (
            <ActionButton
              label={t("payables.milestone.markAsPaid")}
              variant="success"
              disabled={isSubmitting}
              onClick={() => setShowPayForm(true)}
            />
          )}

          {milestone.milestone_status === "paid" &&
            (milestone.payment_request_id ? (
              <p className="text-[11px] text-muted-foreground">
                {t("approvals.payables.paidLocked")}
              </p>
            ) : !showUndo ? (
              <ActionButton
                label={t("payables.milestone.undoPayment")}
                variant="ghost-destructive"
                disabled={isSubmitting}
                onClick={() => setShowUndo(true)}
              />
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-medium text-destructive">
                  {t("payables.milestoneExtra.undoQuestion")}
                </p>
                <div className="flex gap-2">
                  <ActionButton
                    label={t("payables.milestoneExtra.yesUndo")}
                    variant="destructive"
                    disabled={isSubmitting}
                    onClick={() =>
                      doAction({
                        milestone_status: "pending",
                        paid_date: undefined,
                        payment_ref: undefined,
                        payment_method: undefined,
                        source_account: undefined,
                        receipt_url: undefined,
                        notes: undefined,
                      })
                    }
                  />
                  <ActionButton
                    label={t("common.cancel")}
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={() => setShowUndo(false)}
                  />
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export default MilestonePopover;
