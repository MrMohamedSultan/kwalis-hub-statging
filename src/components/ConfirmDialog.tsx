import { AlertTriangle, Loader2 } from "lucide-react";
import { useId } from "react";

import { Modal } from "./Modal";

export function ConfirmDialog({
  open,
  title = "Please confirm",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  loading = false,
  loadingLabel,
  warning,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger" | "success";
  /** Disables both buttons and shows a spinner on confirm while the request runs. */
  loading?: boolean;
  loadingLabel?: string;
  /** Extra emphasis line; defaults to an irreversible-action warning for `danger`. */
  warning?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const messageId = useId();
  if (!open) return null;

  const confirmClass =
    tone === "danger"
      ? "bg-destructive hover:bg-destructive text-destructive-foreground"
      : tone === "success"
        ? "bg-success hover:bg-success text-success-foreground"
        : "bg-brand text-brand-foreground";

  const warningText =
    warning ?? (tone === "danger" ? "This action is permanent and cannot be undone." : null);

  return (
    <Modal onClose={onCancel} title={title} dismissible={!loading}>
      <div id={messageId} className="text-sm text-foreground/90 mb-4 whitespace-pre-line">
        {message}
      </div>

      {warningText && (
        <div
          role="alert"
          className="flex items-start gap-2 mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{warningText}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 rounded-lg border border-border hover:bg-muted text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          aria-busy={loading}
          aria-describedby={messageId}
          className={`px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${confirmClass}`}
          autoFocus
        >
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {loading ? (loadingLabel ?? `${confirmLabel}…`) : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
