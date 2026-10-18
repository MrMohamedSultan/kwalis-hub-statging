import { useEffect, useId, useState } from "react";
import { Archive, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import { archiveCodeMatches } from "@/lib/project-archive";

/**
 * Archive confirmation (D02). The admin must type the project code; the
 * button stays disabled until it matches. Nothing is deleted — the dialog
 * says so, and says when permanent deletion becomes possible.
 */
export function ArchiveProjectDialog({
  project,
  loading = false,
  onCancel,
  onConfirm,
}: {
  project: { id: string; name: string; code: string | null } | null;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (typedCode: string) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    setTyped("");
  }, [project?.id]);

  if (!project) return null;
  const matches = archiveCodeMatches(typed, project.code);

  return (
    <Modal
      onClose={onCancel}
      title={t("archiveProject.title", "Archive this project?")}
      dismissible={!loading}
    >
      <p className="mb-3 text-sm text-foreground/90">
        {t(
          "archiveProject.body",
          "The project is hidden from the company's screens. Every budget, invoice, payroll row and payment is kept, and the project can be restored at any time. Permanent deletion only becomes possible 30 days after archiving.",
        )}
      </p>
      <p className="mb-2 text-sm font-medium">{project.name}</p>
      {project.code ? (
        <label htmlFor={inputId} className="mb-5 block space-y-1.5">
          <span className="text-xs text-muted-foreground">
            {t("archiveProject.typeCode", "Type the project code to confirm:")}{" "}
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              {project.code}
            </span>
          </span>
          <input
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoFocus
            disabled={loading}
            maxLength={64}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-brand"
          />
        </label>
      ) : (
        <p role="alert" className="mb-5 text-sm text-destructive">
          {t(
            "archiveProject.noCode",
            "This project has no code, so it cannot be confirmed. Give it a code first.",
          )}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("common.cancel", "Cancel")}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(typed)}
          disabled={loading || !matches}
          aria-busy={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-warning-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Archive className="size-4" aria-hidden="true" />
          )}
          {t("archiveProject.confirm", "Archive project")}
        </button>
      </div>
    </Modal>
  );
}
