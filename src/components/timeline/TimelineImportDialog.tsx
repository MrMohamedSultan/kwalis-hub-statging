import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, XCircle } from "lucide-react";

import { Modal } from "@/components/Modal";
import { loadXlsx } from "@/lib/lazy-export-libs";
import {
  planTimelineImport,
  workbookToGrids,
  type ImportDictionaryEntry,
  type ImportIssue,
  type ImportPlan,
  type ImportRowRef,
} from "@/lib/timeline-import";

export type TimelineImportMode = "append" | "replace";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PREVIEW_LIMIT = 300;

/**
 * "Import from Excel": reads the timeline template, the Gantt Excel export or
 * the draft export, shows what will be imported (and what was flagged), then
 * hands the items to the page, which writes them through the timeline store.
 */
export function TimelineImportDialog({
  rows,
  dictionary,
  currentCount,
  versionLabel,
  onApply,
  onClose,
}: {
  rows: ImportRowRef[];
  dictionary: ImportDictionaryEntry[];
  /** Items currently on the timeline (removed by "replace"). */
  currentCount: number;
  versionLabel: string;
  onApply: (plan: ImportPlan, mode: TimelineImportMode) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [mode, setMode] = useState<TimelineImportMode>("append");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setPlan(null);
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError(t("timeline_import.file_too_large"));
      return;
    }
    setReading(true);
    try {
      const XLSX = await loadXlsx();
      const grids = workbookToGrids(XLSX, await file.arrayBuffer());
      const res = planTimelineImport(grids, { rows, dictionary });
      if (!res.ok) setError(t("timeline_import.no_task_table"));
      else setPlan(res.plan);
    } catch (err) {
      console.error("[timeline-import] read failed", err);
      setError(t("timeline_import.could_not_read_file"));
    } finally {
      setReading(false);
    }
  };

  const issueText = (i: ImportIssue) => t(`timeline_import.issue.${i.code}`, i.params ?? {});
  const importable = (plan?.bars.length ?? 0) + (plan?.milestones.length ?? 0);
  const canConfirm = importable > 0 && (mode === "append" || confirmReplace);
  const shown = (plan?.preview ?? []).filter((p) => !onlyProblems || p.issues.length > 0);

  return (
    <Modal onClose={onClose} title={t("timeline_import.title")}>
      <p className="text-xs text-muted-foreground mb-3">
        {t("timeline_import.intro", { version: versionLabel })}
      </p>

      <label className="flex items-center gap-2 rounded-xl border border-dashed border-border p-4 text-sm cursor-pointer hover:bg-muted">
        <FileSpreadsheet className="size-4 shrink-0" />
        <span className="truncate">{fileName || t("timeline_import.choose_file")}</span>
        <input
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {reading && <Loader2 className="size-4 animate-spin ms-auto" />}
      </label>

      {error && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {plan && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {(
              [
                ["rows_read", plan.counts.read, "text-foreground"],
                ["ready", plan.counts.imported, "text-success"],
                ["with_warnings", plan.counts.withWarnings, "text-warning"],
                ["skipped", plan.counts.skipped, "text-destructive"],
              ] as const
            ).map(([key, value, cls]) => (
              <div key={key} className="rounded-lg border border-border p-2">
                <div className={`text-lg font-semibold ${cls}`}>{value}</div>
                <div className="text-[11px] text-muted-foreground">
                  {t(`timeline_import.${key}`)}
                </div>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("timeline_import.detected", {
              layout: t(`timeline_import.layout.${plan.layout}`),
              sheet: plan.sheetName,
            })}{" "}
            ·{" "}
            {t("timeline_import.bars_and_milestones", {
              bars: plan.bars.length,
              milestones: plan.milestones.length,
            })}
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(e) => setOnlyProblems(e.target.checked)}
            />
            {t("timeline_import.only_problems")}
          </label>

          <div className="max-h-72 overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-muted-foreground">
                  <th className="px-2 py-1 text-start">#</th>
                  <th className="px-2 py-1 text-start">{t("timeline_import.col_task")}</th>
                  <th className="px-2 py-1 text-start">{t("timeline_import.col_track")}</th>
                  <th className="px-2 py-1 text-start">{t("timeline_import.col_kind")}</th>
                  <th className="px-2 py-1 text-start">{t("timeline_import.col_dates")}</th>
                  <th className="px-2 py-1 text-start">{t("timeline_import.col_status")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, PREVIEW_LIMIT).map((p) => (
                  <tr key={p.line} className="border-t border-border align-top">
                    <td className="px-2 py-1 text-muted-foreground">{p.line}</td>
                    <td className="px-2 py-1">{p.label || "—"}</td>
                    <td className="px-2 py-1">{p.rowLabel || "—"}</td>
                    <td className="px-2 py-1">
                      {p.kind}
                      {p.isMilestone ? ` · ${t("timeline_import.milestone")}` : ""}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap" dir="ltr">
                      {p.start ?? "—"}
                      {p.end && p.end !== p.start ? ` → ${p.end}` : ""}
                    </td>
                    <td className="px-2 py-1">
                      {p.skipped ? (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <XCircle className="size-3.5 shrink-0" />{" "}
                          {t("timeline_import.status_skipped")}
                        </span>
                      ) : p.issues.length ? (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <AlertTriangle className="size-3.5 shrink-0" />{" "}
                          {t("timeline_import.status_fixed")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CheckCircle2 className="size-3.5 shrink-0" />{" "}
                          {t("timeline_import.status_ok")}
                        </span>
                      )}
                      {p.issues.map((i, idx) => (
                        <div key={idx} className="text-[11px] text-muted-foreground">
                          {issueText(i)}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > PREVIEW_LIMIT && (
              <div className="p-2 text-[11px] text-muted-foreground">
                {t("timeline_import.more_rows", { count: shown.length - PREVIEW_LIMIT })}
              </div>
            )}
          </div>

          <fieldset className="space-y-2 text-xs">
            <legend className="font-semibold mb-1">{t("timeline_import.how_to_apply")}</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="timeline-import-mode"
                checked={mode === "append"}
                onChange={() => setMode("append")}
              />
              <span>{t("timeline_import.mode_append")}</span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="timeline-import-mode"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
                disabled={currentCount === 0}
              />
              <span>{t("timeline_import.mode_replace", { count: currentCount })}</span>
            </label>
            {mode === "replace" && (
              <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2">
                <input
                  type="checkbox"
                  checked={confirmReplace}
                  onChange={(e) => setConfirmReplace(e.target.checked)}
                />
                <span>{t("timeline_import.confirm_replace", { count: currentCount })}</span>
              </label>
            )}
            <p className="text-[11px] text-muted-foreground">{t("timeline_import.undo_hint")}</p>
          </fieldset>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
        >
          {t("timeline_import.cancel")}
        </button>
        <button
          type="button"
          disabled={!plan || !canConfirm}
          onClick={() => plan && onApply(plan, mode)}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {t("timeline_import.import_n", { count: importable })}
        </button>
      </div>
    </Modal>
  );
}
