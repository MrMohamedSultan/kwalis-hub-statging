import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { History, Trash2, FileSpreadsheet, User, RefreshCw, Undo2 } from "lucide-react";
import { listBudgetBatches, deleteBudgetBatch, type BudgetUploadBatch } from "@/lib/budget-batches";
import { useStore } from "@/lib/store";

import { useTranslation } from "react-i18next";
export function BudgetUploadHistory() {
  const { t } = useTranslation();

  const activeProjectId = useStore((s) => s.activeProjectId);
  const reload = useStore((s) => s.reloadScopedData);
  const [batches, setBatches] = useState<BudgetUploadBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeProjectId) {
      setBatches([]);
      return;
    }
    setLoading(true);
    try {
      const data = await listBudgetBatches(activeProjectId);
      setBatches(data);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deleteBatch = async (b: BudgetUploadBatch) => {
    if (!activeProjectId) return;
    const label = b.filename ?? "this upload";
    const snapshotCount = Array.isArray(b.replaced_snapshot)
      ? (b.replaced_snapshot as unknown[]).length
      : 0;
    const msg =
      snapshotCount > 0
        ? `Delete batch "${label}"?\n\n• Removes the ${b.row_count} rows imported by this batch.\n• RESTORES the ${snapshotCount} budget line(s) that existed before this Replace-mode import.\n\nProceed?`
        : `Delete batch "${label}"?\n\nAll ${b.row_count} budget entries from this upload will be permanently wiped from the current project. This cannot be undone.`;
    if (!confirm(msg)) return;
    setBusyId(b.id);
    try {
      const { removed, restored } = await deleteBudgetBatch(b.id, activeProjectId);
      if (restored > 0) {
        toast.success(
          `Undone: removed ${removed} imported row(s) and restored ${restored} previous line(s).`,
        );
      } else {
        toast.success(
          `Deleted ${removed} budget ${removed === 1 ? "entry" : "entries"} from "${label}".`,
        );
      }
      await reload();
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete batch");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-brand" />
          <h3 className="text-sm font-semibold text-white">
            {t("budgetuploadhistory.budget_upload_history")}
          </h3>
        </div>
        <button
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-white px-2 py-1 rounded-md hover:bg-muted"
          title={t("budgetuploadhistory.refresh")}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          {t("budgetuploadhistory.refresh")}
        </button>
      </div>
      {loading ? (
        <div className="text-xs text-muted-foreground py-4 text-center">
          Loading upload history…
        </div>
      ) : batches.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
          {t("budgetuploadhistory.no_budget_uploads_recorded_yet_for_this_project")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">File</th>
                <th className="py-2 pr-3">Uploaded</th>
                <th className="py-2 pr-3">By</th>
                <th className="py-2 pr-3 text-right">Rows</th>
                <th className="py-2 pr-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const snapshotCount = Array.isArray(b.replaced_snapshot)
                  ? (b.replaced_snapshot as unknown[]).length
                  : 0;
                const isUndo = snapshotCount > 0;
                return (
                  <tr key={b.id} className="border-b border-border hover:bg-card/[0.02]">
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2 text-foreground">
                        <FileSpreadsheet className="w-3.5 h-3.5 text-success shrink-0" />
                        <span className="truncate max-w-[240px]">{b.filename ?? "—"}</span>
                        {isUndo && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/30 whitespace-nowrap"
                            title={`Replace-mode import — ${snapshotCount} previous line(s) captured. Delete this batch to restore them.`}
                          >
                            Replace • {snapshotCount} restorable
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                      {new Date(b.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {b.uploader_name ?? "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-foreground">
                      {b.row_count}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <button
                        onClick={() => void deleteBatch(b)}
                        disabled={busyId === b.id}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium disabled:opacity-50 ${
                          isUndo
                            ? "border border-warning/60 bg-warning/10 text-warning hover:bg-warning/20"
                            : "border border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
                        }`}
                        title={
                          isUndo
                            ? `Undo this Replace-mode import (removes ${b.row_count} imported rows and restores ${snapshotCount} previous lines)`
                            : "Permanently delete this upload batch and all its rows"
                        }
                      >
                        {isUndo ? <Undo2 className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
                        {busyId === b.id
                          ? isUndo
                            ? "Restoring…"
                            : "Deleting…"
                          : isUndo
                            ? "Undo Replace"
                            : "Delete Batch"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
