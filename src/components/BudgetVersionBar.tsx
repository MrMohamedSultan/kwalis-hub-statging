import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { GitBranch, Plus, CheckCircle2, Trash2, Loader2 } from "lucide-react";
import {
  useBudgetVersions,
  createBudgetDraft,
  publishBudgetVersion,
  deleteBudgetDraft,
  setSelectedVersion,
} from "@/lib/budget-versions";
import { useStore } from "@/lib/store";
import { invalidateBudgetCaches } from "@/lib/budget-cache-bus";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { recordAudit } from "@/lib/audit-log";

/**
 * Real budget versioning bar.
 *
 * Only the ACTIVE version feeds actuals, commitments and every financial
 * report. Drafts are editable copies that stay invisible to reporting until
 * they are published.
 */
export function BudgetVersionBar({
  canManage,
  note,
}: {
  canManage: boolean;
  /** Optional caption, e.g. "the Top Sheet follows this selection". */
  note?: string;
}) {
  const { t } = useTranslation();
  const { projectId, versions, selected, selectedId, loading, reload } = useBudgetVersions();
  const reloadScopedData = useStore((s) => s.reloadScopedData);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!projectId) return null;

  const refreshGrid = async () => {
    invalidateBudgetCaches(projectId, "lines");
    await reloadScopedData();
  };

  // Selecting a version only writes the selection: the store listens for the
  // change event once, globally, and re-fetches `budget_lines` filtered to
  // that single version_id. No per-component reload (that was the lag).
  const onSelect = (id: string) => {
    if (id === selectedId) return;
    setSelectedVersion(projectId, id);
  };

  const onCreateDraft = async () => {
    setBusy("draft");
    try {
      const id = await createBudgetDraft(projectId);
      setSelectedVersion(projectId, id);
      await reload();
      await refreshGrid();
      recordAudit({
        category: "other",
        action: "budget.draft_created",
        severity: "info",
        summary: "Budget draft created from the active version",
        entity: "Budget",
        project_id: projectId,
        details: { versionId: id },
      });
      toast.success(t("budget.draft_created", "Draft created — edits stay out of live reports"));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create draft");
    } finally {
      setBusy(null);
    }
  };

  const onPublish = async () => {
    if (!selectedId) return;
    setBusy("publish");
    try {
      await publishBudgetVersion(selectedId);
      await reload();
      await refreshGrid();
      recordAudit({
        category: "other",
        action: "budget.version_published",
        severity: "warning",
        summary: "Budget version published — it now drives all financial reports",
        entity: "Budget",
        project_id: projectId,
        details: { versionId: selectedId },
      });
      toast.success(t("budget.version_published", "Version published"));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not publish version");
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    if (!selectedId) return;
    setBusy("delete");
    try {
      await deleteBudgetDraft(selectedId);
      const active = versions.find((v) => v.status === "active");
      if (active) setSelectedVersion(projectId, active.id);
      await reload();
      await refreshGrid();
      toast.success(t("budget.draft_deleted", "Draft deleted"));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete draft");
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  const isDraft = selected?.status === "draft";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
        <GitBranch className="size-4 text-muted-foreground" />
        {t("budget.version", "Budget version")}
      </span>

      <select
        value={selectedId ?? ""}
        disabled={loading || !!busy}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.versionName}
            {v.status === "active"
              ? " • Active"
              : v.status === "draft"
                ? " • Draft"
                : " • Archived"}
          </option>
        ))}
      </select>

      {note && <span className="text-xs text-muted-foreground">{note}</span>}

      {selected && (
        <span
          className={
            "rounded-full px-2.5 py-0.5 text-xs font-semibold " +
            (selected.status === "active"
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : selected.status === "draft"
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "bg-muted text-muted-foreground")
          }
        >
          {selected.status === "active"
            ? t("budget.version_live", "Live — drives all reports")
            : selected.status === "draft"
              ? t("budget.version_draft", "Draft — excluded from actuals")
              : t("budget.version_archived", "Archived")}
        </span>
      )}

      {canManage && (
        <div className="ms-auto flex items-center gap-2">
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <button
            type="button"
            onClick={() => void onCreateDraft()}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition"
          >
            <Plus className="size-3.5" />
            {t("budget.create_draft", "Create draft")}
          </button>
          {isDraft && (
            <>
              <button
                type="button"
                onClick={() => void onPublish()}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition"
              >
                <CheckCircle2 className="size-3.5" />
                {t("budget.publish_version", "Publish")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 transition"
              >
                <Trash2 className="size-3.5" />
                {t("common.delete", "Delete")}
              </button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t("budget.delete_draft_title", "Delete this draft?")}
        message={t(
          "budget.delete_draft_desc",
          "The draft and its budget lines are removed. Published versions and live actuals are untouched.",
        )}
        confirmLabel={t("common.delete", "Delete")}
        tone="danger"
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
