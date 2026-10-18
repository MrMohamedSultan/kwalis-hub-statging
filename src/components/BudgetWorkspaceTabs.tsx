import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckCircle2, GitBranch, Loader2, Lock, Plus, Trash2 } from "lucide-react";
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
 * Budget workspace separation.
 *
 * Tab 1 — Active Ledger: the published version. It is the ONLY version any
 * financial view reads (v_active_budget_lines and everything built on it).
 * Tab 2 — Drafts Workspace: a sandbox. Editing a draft can never move the
 * live numbers; publishing swaps it in explicitly.
 *
 * Exactly one version is ever loaded into the grid — the store fetches
 * `budget_lines` filtered by that single `version_id` at the database level.
 */
export function BudgetWorkspaceTabs({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const { projectId, versions, selected, selectedId, loading, reload } = useBudgetVersions();
  const reloadScopedData = useStore((s) => s.reloadScopedData);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<string | null>(null);

  if (!projectId) return null;

  const active = versions.find((v) => v.status === "active") ?? null;
  const drafts = versions.filter((v) => v.status === "draft");
  const onDraftTab = selected?.status === "draft";

  const refreshGrid = async () => {
    invalidateBudgetCaches(projectId, "lines");
    await reloadScopedData();
  };

  // Selecting only writes the selection: the store listens once, globally,
  // and refetches the single version's lines.
  const select = (id: string | null | undefined) => {
    if (!id || id === selectedId) return;
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

  const onPublish = async (versionId: string) => {
    setBusy("publish");
    try {
      await publishBudgetVersion(versionId);
      await reload();
      setSelectedVersion(projectId, versionId);
      await refreshGrid();
      recordAudit({
        category: "other",
        action: "budget.version_published",
        severity: "warning",
        summary: "Budget version published — it now drives all financial reports",
        entity: "Budget",
        project_id: projectId,
        details: { versionId },
      });
      toast.success(t("budget.version_published", "Version published — it is now the live ledger"));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not publish version");
    } finally {
      setBusy(null);
      setConfirmPublish(null);
    }
  };

  const onDelete = async (versionId: string) => {
    setBusy("delete");
    try {
      await deleteBudgetDraft(versionId);
      if (active) setSelectedVersion(projectId, active.id);
      await reload();
      await refreshGrid();
      toast.success(t("budget.draft_deleted", "Draft deleted"));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete draft");
    } finally {
      setBusy(null);
      setConfirmDelete(null);
    }
  };

  const tabCls = (on: boolean) =>
    "rounded-lg px-3.5 py-2 text-sm font-semibold transition border " +
    (on
      ? "border-primary bg-primary/10 text-foreground"
      : "border-border text-muted-foreground hover:bg-muted");

  return (
    <div className="mb-4 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 me-2 text-sm font-semibold text-foreground">
          <GitBranch className="size-4 text-muted-foreground" />
          {t("budget.workspace", "Budget workspace")}
        </span>

        <button
          type="button"
          className={tabCls(!onDraftTab)}
          disabled={loading || !!busy || !active}
          onClick={() => select(active?.id)}
        >
          {t("budget.tab_active_ledger", "Active Ledger")}
          {active ? ` · ${active.versionName}` : ""}
        </button>

        <button
          type="button"
          className={tabCls(onDraftTab)}
          disabled={loading || !!busy}
          onClick={() => {
            if (drafts.length > 0) select(drafts[drafts.length - 1].id);
            else void onCreateDraft();
          }}
        >
          {t("budget.tab_drafts", "Drafts Workspace")}
          {drafts.length > 0 ? ` · ${drafts.length}` : ""}
        </button>

        {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}

        <span className="ms-auto text-xs text-muted-foreground">
          {onDraftTab
            ? t("budget.draft_scope_note", "Sandbox — excluded from actuals and every report")
            : t("budget.active_scope_note", "Live ledger — drives all reports and actuals")}
        </span>
      </div>

      {onDraftTab && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("budget.drafts", "Drafts")}
            </span>
            {canManage && (
              <button
                type="button"
                onClick={() => void onCreateDraft()}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition"
              >
                <Plus className="size-3.5" />
                {t("budget.create_draft", "Create draft")}
              </button>
            )}
          </div>

          {drafts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("budget.no_drafts", "No drafts yet. Create one to plan changes safely.")}
            </p>
          )}

          {drafts.map((d) => {
            const on = d.id === selectedId;
            return (
              <div
                key={d.id}
                className={
                  "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 " +
                  (on ? "border-primary bg-primary/5" : "border-border")
                }
              >
                <button
                  type="button"
                  onClick={() => select(d.id)}
                  disabled={!!busy}
                  className="text-sm font-semibold text-foreground"
                >
                  {d.versionName}
                </button>
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  {t("budget.version_draft", "Draft")}
                </span>
                {on && (
                  <span className="text-xs text-muted-foreground">
                    {t("budget.editing_now", "Editing in the grid below")}
                  </span>
                )}
                {canManage && (
                  <div className="ms-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmPublish(d.id)}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition"
                    >
                      <CheckCircle2 className="size-3.5" />
                      {t("budget.make_active", "Make Active (Publish)")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(d.id)}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 transition"
                    >
                      <Trash2 className="size-3.5" />
                      {t("common.delete", "Delete")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!onDraftTab && active && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" />
          {t(
            "budget.active_ledger_note",
            "Every report, actual and commitment reads this version only.",
          )}
        </p>
      )}

      <ConfirmDialog
        open={!!confirmPublish}
        title={t("budget.publish_title", "Make this draft the live budget?")}
        message={t(
          "budget.publish_desc",
          "The current active version is archived and this draft becomes the ledger every report reads.",
        )}
        confirmLabel={t("budget.make_active_short", "Publish")}
        onConfirm={() => confirmPublish && void onPublish(confirmPublish)}
        onCancel={() => setConfirmPublish(null)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title={t("budget.delete_draft_title", "Delete this draft?")}
        message={t(
          "budget.delete_draft_desc",
          "The draft and its budget lines are removed. Published versions and live actuals are untouched.",
        )}
        confirmLabel={t("common.delete", "Delete")}
        tone="danger"
        onConfirm={() => confirmDelete && void onDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
