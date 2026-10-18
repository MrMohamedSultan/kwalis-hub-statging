// Shared entry points used by the timeline toolbar and the Saved Drafts list.
// Excel is read-only: it consumes the already-loaded timeline state and
// project-scoped dictionary cards, then renders a workbook.

import { toast } from "sonner";
import i18n from "i18next";

import { fetchTimelineTaskTypes, type TimelineTaskType } from "@/lib/timeline-task-types";
import type { Bar, Milestone } from "@/lib/timeline-store";
import type { TimelineRow } from "../shared/timelineColors";
import { ExportRowCountError, exportTimelineToExcel } from "./ganttExcelExport";
import { RowCountMismatchError, describeExtraction, toGanttTasks } from "./toGanttTasks";

export type GanttExportSource = {
  projectName: string;
  bars: Bar[];
  milestones: Milestone[];
  rows?: TimelineRow[];
  cards?: TimelineTaskType[];
  /** The open draft/version label, included in the workbook title and file name. */
  versionLabel?: string;
  /** Number of rendered timeline items; the exporter aborts on mismatch. */
  strictCount?: number;
  /** Legacy draft-panel fields retained as a read-only compatibility adapter. */
  lanes?: { id: string; label: string }[];
  variant?: string;
  phaseOfBar?: (bar: Bar) => unknown;
};

function isArabic(): boolean {
  return (i18n.language ?? "en").toLowerCase().startsWith("ar");
}

function safe(s: string): string {
  return s.replace(/[^\p{L}\p{N}\- ]/gu, "").trim() || "Project";
}

function toExportCards(cards: TimelineTaskType[]) {
  return cards.map((card) => ({
    id: card.id,
    name: card.name,
    code: card.code,
    bg: card.color,
    required: card.requiredCount,
    done: 0,
    category: card.category,
  }));
}

/** Visual Gantt workbook. This function does not write to the database. */
export async function runGanttExcelExport(src: GanttExportSource): Promise<void> {
  try {
    const cards = src.cards ?? (await fetchTimelineTaskTypes().catch(() => []));
    const versionLabel = src.versionLabel ?? src.variant;
    const rows = src.rows ?? src.lanes;
    const { tasks, rows: extractedRows, report } = toGanttTasks({
      bars: src.bars,
      rows,
      cards: toExportCards(cards),
      milestones: src.milestones,
    });

    const ar = isArabic();
    const summary = await exportTimelineToExcel({
      projectName: src.projectName,
      tasks,
      rows: extractedRows,
      versionLabel,
      locale: ar ? "ar" : "en",
      rtl: ar,
      strictCount: src.strictCount ?? src.bars.length + src.milestones.length,
      fileName: `Production-Timeline_${safe(src.projectName)}${
        versionLabel ? `_${safe(versionLabel)}` : ""
      }_${new Date().toISOString().slice(0, 10)}.xlsx`,
    });

    toast.success(`Exported ${summary.taskRows} items`, {
      description: `${summary.scheduled} scheduled · ${summary.undated} undated · ${summary.tracks} tracks (${summary.scale} scale). ${describeExtraction(report)}`,
    });
  } catch (err) {
    if (err instanceof RowCountMismatchError || err instanceof ExportRowCountError) {
      toast.error(err.message);
      return;
    }
    throw err;
  }
}

/** Paginated landscape PDF captured from the live Gantt. */
export async function runGanttPdfExport(opts: {
  projectName: string;
  subtitle?: string;
  variant?: string;
}): Promise<void> {
  const { exportGanttPdf } = await import("./ganttPdfExport");
  await exportGanttPdf({
    fileName: `Production-Timeline_${safe(opts.projectName)}${
      opts.variant ? `_${safe(opts.variant)}` : ""
    }_${new Date().toISOString().slice(0, 10)}.pdf`,
    title: `${opts.projectName} — Production Timeline`,
    subtitle: opts.subtitle,
  });
  toast.success("Timeline exported");
}
