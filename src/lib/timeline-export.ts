// Production Timeline exports — Excel (xlsx) + PDF.
//
// Two flavours are supported:
//  • The *live* view is exported to PDF by the branded Gantt writer
//    (src/features/timeline/export/ganttPdfExport.ts — shared header/footer,
//    standard file name, G02), never through the browser print dialog.
//  • Any *saved draft* can be exported directly from the drafts panel without
//    loading it first: its rows are fetched by version, flattened, then written
//    to a structured workbook or a tabular PDF report.

import { loadXlsx } from "@/lib/lazy-export-libs";
import { exportPdfReport } from "@/lib/export-pdf";
import { supabase } from "@/integrations/supabase/client";
import { MACRO_PHASES, normalizeMacroPhase, type MacroPhase } from "@/lib/timeline-phases";
import type { Bar, Milestone } from "@/lib/timeline-store";

export type TimelineLane = { id: string; label: string };

export type TimelineExportRow = {
  phase: MacroPhase;
  task: string;
  start: string;
  end: string;
  durationDays: number;
  lane: string;
};

export type TimelineExportMeta = {
  projectName: string;
  versionLabel: string;
  versionDate?: string;
  status?: string;
};

const DAY_MS = 86_400_000;

function isoDays(start: string, end: string): number {
  const a = Date.parse(start + "T00:00:00Z");
  const b = Date.parse(end + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(1, Math.round((b - a) / DAY_MS) + 1);
}

function slug(s: string): string {
  return s.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "timeline";
}

/** Flattens bars + milestones into one sortable, phase-grouped row set. */
export function buildTimelineRows(
  bars: Bar[],
  milestones: Milestone[],
  lanes: TimelineLane[],
  phaseOfBar: (b: Bar) => MacroPhase,
): TimelineExportRow[] {
  const laneLabel = new Map(lanes.map((l) => [l.id, l.label]));
  const rows: TimelineExportRow[] = [];

  for (const b of bars) {
    rows.push({
      phase: phaseOfBar(b),
      task: b.label,
      start: b.start,
      end: b.end,
      durationDays: isoDays(b.start, b.end),
      lane: laneLabel.get(b.row) ?? b.row,
    });
  }
  for (const m of milestones) {
    rows.push({
      phase: normalizeMacroPhase(laneLabel.get(m.row) ?? m.row),
      task: `${m.label} (milestone)`,
      start: m.date,
      end: m.date,
      durationDays: 1,
      lane: laneLabel.get(m.row) ?? m.row,
    });
  }

  const order = new Map(MACRO_PHASES.map((p, i) => [p, i]));
  rows.sort(
    (a, b) =>
      (order.get(a.phase) ?? 99) - (order.get(b.phase) ?? 99) ||
      a.start.localeCompare(b.start) ||
      a.task.localeCompare(b.task),
  );
  return rows;
}

const HEADERS = ["Macro Phase", "Task Name", "Start Date", "End Date", "Duration (days)", "Lane"];

/**
 * Structured single-sheet workbook: a title block, then the schedule grouped
 * by macro phase with a blank separator row between groups.
 */
export async function exportTimelineXlsx(
  rows: TimelineExportRow[],
  meta: TimelineExportMeta,
): Promise<void> {
  const XLSX = await loadXlsx();

  const aoa: (string | number)[][] = [
    [`${meta.projectName} — Production Timeline`],
    [
      `Version: ${meta.versionLabel}${meta.versionDate ? ` · ${meta.versionDate}` : ""}${
        meta.status ? ` · ${meta.status}` : ""
      }`,
    ],
    [`Generated: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`],
    [],
    HEADERS,
  ];

  let current: MacroPhase | null = null;
  for (const r of rows) {
    if (current !== null && r.phase !== current) aoa.push([]);
    current = r.phase;
    aoa.push([r.phase, r.task, r.start, r.end, r.durationDays, r.lane]);
  }
  if (rows.length === 0) aoa.push(["—", "No scheduled events", "", "", 0, ""]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 18 }, { wch: 46 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 30 }];
  ws["!freeze"] = { xSplit: 0, ySplit: 5 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Timeline");

  // G02: shared identity (company / project / title header, export footer,
  // KwalisHub_{Code}_{Report}_{Date}.xlsx).
  const { writeBrandedSheetJs } = await import("@/lib/export/sheetjs-branding");
  await writeBrandedSheetJs(
    XLSX,
    wb,
    `Production Timeline ${meta.versionLabel}`,
    `${meta.projectName} — Production Timeline`,
  );
}

/** Tabular PDF for a specific draft (no need to load it into the live view). */
export async function exportTimelinePdf(
  rows: TimelineExportRow[],
  meta: TimelineExportMeta,
): Promise<void> {
  await exportPdfReport(
    `${slug(meta.projectName)}-timeline-${slug(meta.versionLabel)}.pdf`,
    [
      {
        title: `${meta.projectName} — Production Timeline`,
        subtitle: `Version ${meta.versionLabel}${meta.versionDate ? ` · ${meta.versionDate}` : ""}${
          meta.status ? ` · ${meta.status}` : ""
        }`,
        headers: HEADERS,
        rows: rows.length
          ? rows.map((r) => [r.phase, r.task, r.start, r.end, r.durationDays, r.lane])
          : [["—", "No scheduled events", "", "", 0, ""]],
        numericColumns: [4],
      },
    ],
    { documentTitle: `${meta.projectName} — Production Timeline`, direction: "ltr" },
  );
}

/**
 * Loads one saved draft's bars and milestones straight from the database so it
 * can be exported without being loaded into the active timeline.
 */
export async function fetchDraftTimeline(
  projectId: string,
  versionCode: string,
): Promise<{ bars: Bar[]; milestones: Milestone[] }> {
  const { data: vrow, error: verr } = await supabase
    .from("timeline_versions" as any)
    .select("id")
    .eq("project_id", projectId)
    .eq("code", versionCode)
    .maybeSingle();
  if (verr) throw verr;
  const versionId = (vrow as any)?.id as string | undefined;
  if (!versionId) return { bars: [], milestones: [] };

  const [{ data: bs, error: be }, { data: ms, error: me }] = await Promise.all([
    supabase
      .from("timeline_bars" as any)
      .select("*")
      .eq("project_id", projectId)
      .eq("version_id", versionId),
    supabase
      .from("timeline_milestones" as any)
      .select("*")
      .eq("project_id", projectId)
      .eq("version_id", versionId),
  ]);
  if (be) throw be;
  if (me) throw me;

  return {
    bars: ((bs ?? []) as any[]).map((r) => ({
      id: r.id,
      row: r.row_key,
      kind: r.kind,
      label: r.label,
      start: r.start_date,
      end: r.end_date,
      cashAlert: !!r.cash_alert || undefined,
    })),
    milestones: ((ms ?? []) as any[]).map((r) => ({
      id: r.id,
      row: r.row_key,
      kind: r.kind,
      label: r.label,
      date: r.milestone_date,
    })),
  };
}
