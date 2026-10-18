import { useState } from "react";
import { FileSpreadsheet, FileText, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";

import { Modal } from "@/components/Modal";
import { runGanttExcelExport, runGanttPdfExport } from "@/features/timeline/export/runGanttExport";
import type { Bar, Milestone, Version } from "@/lib/timeline-store";
import type { MacroPhase } from "@/lib/timeline-phases";
import {
  buildTimelineRows,
  exportTimelinePdf,
  exportTimelineXlsx,
  fetchDraftTimeline,
  type TimelineLane,
} from "@/lib/timeline-export";

const STATUS_BADGE: Record<string, string> = {
  Active: "bg-success/15 text-success border-success/30",
  Draft: "bg-warning/15 text-warning border-warning/30",
  "Pending Approval": "bg-info/15 text-info border-info/30",
  Archived: "bg-surface text-muted-foreground border-border",
};

/**
 * "Saved Drafts" panel.
 *
 * Lists every saved schedule version with its date and state. Each row can be
 * resumed (re-hydrated into the active timeline for editing) or exported
 * directly to Excel / PDF — the export path reads that draft's own rows from
 * the database, so nothing has to be loaded into the live view first.
 */
export function TimelineDraftsPanel({
  onClose,
  versions,
  activeVersionId,
  projectId,
  projectName,
  lanes,
  phaseOfBar,
  liveBars,
  liveMilestones,
  onResume,
}: {
  onClose: () => void;
  versions: Version[];
  activeVersionId: string;
  projectId: string | null;
  projectName: string;
  lanes: TimelineLane[];
  phaseOfBar: (b: Bar) => MacroPhase;
  liveBars: Bar[];
  liveMilestones: Milestone[];
  onResume: (versionId: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const runExport = async (v: Version, kind: "xlsx" | "pdf") => {
    const key = `${v.id}:${kind}`;
    if (busy) return;
    setBusy(key);
    try {
      let bars: Bar[] = [];
      let milestones: Milestone[] = [];
      if (projectId) {
        const fetched = await fetchDraftTimeline(projectId, v.id);
        bars = fetched.bars;
        milestones = fetched.milestones;
      }
      // A draft that was never persisted with its own rows (e.g. the snapshot
      // just taken from the current view) still exports what is on screen.
      if (bars.length === 0 && milestones.length === 0 && v.id === activeVersionId) {
        bars = liveBars;
        milestones = liveMilestones;
      }
      if (kind === "xlsx") {
        await runGanttExcelExport({
          projectName,
          bars,
          milestones,
          phaseOfBar,
          lanes,
          variant: v.label,
        });
      } else if (v.id === activeVersionId) {
        // The active draft is the one on screen — capture the live Gantt.
        await runGanttPdfExport({
          projectName,
          subtitle: `Version ${v.label} · ${v.date}`,
          variant: v.label,
        });
      } else {
        // Other drafts aren't rendered, so they export as a tabular report.
        const rows = buildTimelineRows(bars, milestones, lanes, phaseOfBar);
        await exportTimelinePdf(rows, {
          projectName,
          versionLabel: v.label,
          versionDate: v.date,
          status: v.status,
        });
      }
    } catch (err) {
      toast.error("Export failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal onClose={onClose} title="Saved Drafts">
      <p className="text-xs text-muted-foreground mb-3">
        Resume a saved schedule to keep editing it, or export any draft directly to Excel or PDF
        without loading it into the timeline.
      </p>

      {versions.length === 0 ? (
        <div className="rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">
          No saved drafts yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {versions.map((v) => (
            <li
              key={v.id}
              className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                v.id === activeVersionId ? "border-brand/50 bg-brand/5" : "border-border"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold truncate">{v.label}</span>
                  <span
                    className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] ${
                      STATUS_BADGE[v.status] ?? STATUS_BADGE.Archived
                    }`}
                  >
                    {v.status}
                  </span>
                  {v.id === activeVersionId && (
                    <span className="text-[10px] text-brand font-semibold">current</span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">{v.date}</div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onResume(v.id);
                    toast.success(`Draft ${v.label} loaded`);
                    onClose();
                  }}
                  disabled={v.id === activeVersionId}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/15 px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/25 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Load this draft into the active timeline"
                >
                  <PlayCircle className="size-3.5" /> Resume
                </button>
                <button
                  type="button"
                  onClick={() => void runExport(v, "xlsx")}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
                  title="Export this draft to Excel"
                >
                  {busy === `${v.id}:xlsx` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="size-3.5" />
                  )}
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => void runExport(v, "pdf")}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
                  title="Export this draft to PDF"
                >
                  {busy === `${v.id}:pdf` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <FileText className="size-3.5" />
                  )}
                  PDF
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
