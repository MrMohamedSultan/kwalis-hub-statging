// Production Timeline — Excel import (pure parsing + mapping, no I/O).
//
// Reads three layouts back into timeline bars / milestones:
//   • "template" — the downloadable template (src/lib/timeline-template.ts):
//                  sheet "Task List", header Track | Task | Code | Kind |
//                  Start | End | Days | Notes.
//   • "gantt"    — the app's own Gantt Excel export (its "Task List" /
//                  "قائمة المهام" sheet, header TRACK | TASK | CODE | KIND |
//                  START | END | DAYS | COLOUR FROM, EN or AR headers).
//   • "draft"    — the saved-draft export (sheet "Timeline", header
//                  Macro Phase | Task Name | Start Date | End Date |
//                  Duration (days) | Lane; milestones carry a "(milestone)"
//                  suffix).
//
// The header row is located by scanning, so branding rows added above the
// table by the export writers never matter.
//
// Everything here is pure so it can be unit-tested; the page reads the file
// with SheetJS and passes the cell grid in.

import type { Bar, BarKind, Milestone, MilestoneKind } from "@/lib/timeline-store";
import { DEFAULT_MACRO_PHASE, MACRO_PHASE_ID, normalizeMacroPhase } from "@/lib/timeline-phases";

export const BAR_KINDS: BarKind[] = ["shoot", "editors", "directors", "sound", "color", "prep"];
export const MILESTONE_KINDS: MilestoneKind[] = ["vfx", "imf", "holiday", "bible", "delivery"];
export const DEFAULT_BAR_KIND: BarKind = "prep";

/** Dictionary code → bar kind (same table the Create Event dropdown uses). */
export const KIND_OF_CODE: Record<string, BarKind> = {
  PRE: "prep",
  PP: "shoot",
  EC: "editors",
  DC: "directors",
  SE: "sound",
  CG: "color",
  MIX: "sound",
  MF: "sound",
  MP: "sound",
  MR: "sound",
  CGT: "color",
  CRV: "color",
  CF: "color",
};

/** Human names that may appear in the Kind column instead of the key. */
const BAR_KIND_ALIASES: Record<string, BarKind> = {
  "principal photography": "shoot",
  production: "shoot",
  "editor's cut": "editors",
  "editors cut": "editors",
  "director's cut": "directors",
  "directors cut": "directors",
  "sound edit": "sound",
  "color grading": "color",
  "colour grading": "color",
  colour: "color",
  preparation: "prep",
  "pre-production": "prep",
};
const MILESTONE_KIND_ALIASES: Record<string, MilestoneKind> = {
  "vfx turnover": "vfx",
  "imf delivery": "imf",
  "bible delivery": "bible",
  eid: "holiday",
};

export type TimelineImportLayout = "template" | "gantt" | "draft" | "generic";

export type ImportRowRef = { id: string; label: string; ar?: string };
export type ImportDictionaryEntry = { code: string; name: string; category?: string };

export type SheetGrid = { name: string; rows: unknown[][] };

type Field =
  "track" | "task" | "code" | "kind" | "start" | "end" | "days" | "notes" | "phase" | "colorFrom";

const HEADER_ALIASES: Record<Field, string[]> = {
  track: ["track", "lane", "row", "المسار"],
  task: ["task", "task name", "name", "المهمة", "اسم المهمة"],
  code: ["code", "الرمز", "الكود"],
  kind: ["kind", "type", "النوع"],
  start: ["start", "start date", "date", "البداية", "تاريخ البداية"],
  end: ["end", "end date", "النهاية", "تاريخ النهاية"],
  days: ["days", "duration", "duration days", "الأيام", "المدة"],
  notes: ["notes", "note", "ملاحظات"],
  phase: ["macro phase", "phase", "المرحلة"],
  colorFrom: ["colour from", "color from", "مصدر اللون"],
};

function normHeader(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[\s_]+/g, " ")
    .trim();
}

function norm(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

export type ColumnMap = Partial<Record<Field, number>>;

function matchHeaderRow(row: unknown[]): ColumnMap | null {
  const map: ColumnMap = {};
  row.forEach((cell, i) => {
    const h = normHeader(cell);
    if (!h) return;
    for (const f of Object.keys(HEADER_ALIASES) as Field[]) {
      if (map[f] === undefined && HEADER_ALIASES[f].includes(h)) {
        map[f] = i;
        return;
      }
    }
  });
  // In the draft layout "Lane" is the track; "Macro Phase" only a fallback.
  if (map.task === undefined || map.start === undefined) return null;
  return map;
}

const TASK_SHEET_NAMES = ["task list", "قائمة المهام", "timeline"];

export type LocatedTable = {
  sheetName: string;
  layout: TimelineImportLayout;
  headerRowIndex: number;
  columns: ColumnMap;
};

/** Finds the sheet + header row that holds the task table. */
export function locateTaskTable(sheets: SheetGrid[]): LocatedTable | null {
  const ordered = [...sheets].sort((a, b) => {
    const ia = TASK_SHEET_NAMES.indexOf(norm(a.name));
    const ib = TASK_SHEET_NAMES.indexOf(norm(b.name));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const sheet of ordered) {
    const limit = Math.min(sheet.rows.length, 40);
    for (let r = 0; r < limit; r += 1) {
      const columns = matchHeaderRow(sheet.rows[r] ?? []);
      if (!columns) continue;
      let layout: TimelineImportLayout = "generic";
      if (columns.colorFrom !== undefined) layout = "gantt";
      else if (
        columns.phase !== undefined &&
        columns.track !== undefined &&
        columns.kind === undefined
      )
        layout = "draft";
      else if (columns.notes !== undefined || columns.kind !== undefined) layout = "template";
      return { sheetName: sheet.name, layout, headerRowIndex: r, columns };
    }
  }
  return null;
}

// ─── Dates ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function isoFromParts(y: number, m: number, d: number): string | null {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Excel serial day number → 'YYYY-MM-DD' (1900 date system). */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 120000) return null;
  return new Date(EXCEL_EPOCH + Math.floor(serial) * DAY_MS).toISOString().slice(0, 10);
}

export function isoToExcelSerial(iso: string): number {
  return Math.round((Date.parse(iso + "T00:00:00Z") - EXCEL_EPOCH) / DAY_MS);
}

/**
 * Accepts an Excel serial, a Date, 'YYYY-MM-DD', 'DD/MM/YYYY' (day first —
 * the convention in the region), 'DD Mon YYYY' and 'Mon DD, YYYY'.
 */
export function parseImportDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return excelSerialToIso(value);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return isoFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  const s = String(value).trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return isoFromParts(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return isoFromParts(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s-]+([a-z]{3,4})[a-z]*[\s,-]+(\d{4})$/i.exec(s);
  if (m && MONTHS[m[2].toLowerCase()])
    return isoFromParts(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = /^([a-z]{3,4})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s);
  if (m && MONTHS[m[1].toLowerCase()])
    return isoFromParts(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  return null;
}

function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}
function daysInclusive(start: string, end: string): number {
  return (
    Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / DAY_MS) + 1
  );
}

// ─── Raw rows ─────────────────────────────────────────────────────────────

export type RawImportRow = {
  /** 1-based row number in the sheet, for messages. */
  line: number;
  track: string;
  phase: string;
  task: string;
  code: string;
  kind: string;
  start: unknown;
  end: unknown;
  days: unknown;
  notes: string;
};

export type ParsedWorkbook =
  { ok: true; table: LocatedTable; rows: RawImportRow[] } | { ok: false; error: "no_task_table" };

export function readTaskRows(sheets: SheetGrid[]): ParsedWorkbook {
  const table = locateTaskTable(sheets);
  if (!table) return { ok: false, error: "no_task_table" };
  const sheet = sheets.find((s) => s.name === table.sheetName)!;
  const c = table.columns;
  const at = (row: unknown[], f: Field) => (c[f] === undefined ? undefined : row[c[f]!]);
  const rows: RawImportRow[] = [];
  for (let r = table.headerRowIndex + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r] ?? [];
    const raw: RawImportRow = {
      line: r + 1,
      track: cellText(at(row, "track")),
      phase: cellText(at(row, "phase")),
      task: cellText(at(row, "task")),
      code: cellText(at(row, "code")),
      kind: cellText(at(row, "kind")),
      start: at(row, "start"),
      end: at(row, "end"),
      days: at(row, "days"),
      notes: cellText(at(row, "notes")),
    };
    const empty =
      !raw.track &&
      !raw.task &&
      !raw.code &&
      !raw.kind &&
      !cellText(raw.start) &&
      !cellText(raw.end);
    if (empty) continue;
    rows.push(raw);
  }
  return { ok: true, table, rows };
}

// ─── Mapping ──────────────────────────────────────────────────────────────

export type ImportIssueCode =
  | "missing_task"
  | "missing_start"
  | "invalid_start"
  | "invalid_end"
  | "missing_end"
  | "end_before_start"
  | "unknown_track"
  | "missing_track"
  | "unknown_kind"
  | "unknown_code"
  | "days_mismatch"
  | "milestone_range"
  | "example_row"
  | "placeholder_row";

export type ImportIssue = {
  code: ImportIssueCode;
  /** error → the row is skipped; warning → imported with the stated fix. */
  severity: "error" | "warning";
  params?: Record<string, string | number>;
};

export type ImportPreviewRow = {
  line: number;
  label: string;
  rowId: string | null;
  rowLabel: string;
  kind: string;
  isMilestone: boolean;
  start: string | null;
  end: string | null;
  issues: ImportIssue[];
  skipped: boolean;
};

export type ImportPlan = {
  layout: TimelineImportLayout;
  sheetName: string;
  preview: ImportPreviewRow[];
  bars: Bar[];
  milestones: Milestone[];
  counts: { read: number; imported: number; withWarnings: number; skipped: number };
};

export type MapContext = {
  rows: ImportRowRef[];
  dictionary?: ImportDictionaryEntry[];
  newId?: () => string;
};

const EXAMPLE_PREFIX = /^\s*\[(example|مثال)\]\s*/i;
const MILESTONE_SUFFIX = /\s*\((milestone|معلم)\)\s*$/i;

function inferMilestoneKind(label: string): MilestoneKind {
  const l = label.toLowerCase();
  if (/vfx/.test(l)) return "vfx";
  if (/\bimf\b/.test(l)) return "imf";
  if (/holiday|\beid\b|عيد|عطلة|إجازة/.test(l)) return "holiday";
  if (/bible/.test(l)) return "bible";
  return "delivery";
}

/** Picks the lane for an unknown / empty track: the Pre-Production lane, else the first. */
function defaultLane(rows: ImportRowRef[]): ImportRowRef | null {
  return rows.find((r) => r.id === MACRO_PHASE_ID[DEFAULT_MACRO_PHASE]) ?? rows[0] ?? null;
}

export function resolveTrack(value: string, rows: ImportRowRef[]): ImportRowRef | null {
  const v = norm(value);
  if (!v) return null;
  const direct = rows.find(
    (r) => norm(r.id) === v || norm(r.label) === v || (r.ar && norm(r.ar) === v),
  );
  if (direct) return direct;
  // Film lanes: accept legacy/uppercase phase names ("PREP", "POST-PRODUCTION").
  // normalizeMacroPhase() falls back to the default phase for anything it does
  // not know, so only trust that result when the text really names it.
  const phase = normalizeMacroPhase(value);
  const known = phase !== DEFAULT_MACRO_PHASE || /^(pre[- ]?production|prep)$/i.test(value.trim());
  if (!known) return null;
  return rows.find((r) => r.id === MACRO_PHASE_ID[phase]) ?? null;
}

type KindResult =
  | { type: "bar"; kind: BarKind }
  | { type: "milestone"; kind: MilestoneKind }
  | { type: "milestone-infer" }
  | null;

function resolveKindCell(value: string): KindResult {
  const v = norm(value);
  if (!v) return null;
  if ((BAR_KINDS as string[]).includes(v)) return { type: "bar", kind: v as BarKind };
  if ((MILESTONE_KINDS as string[]).includes(v))
    return { type: "milestone", kind: v as MilestoneKind };
  if (BAR_KIND_ALIASES[v]) return { type: "bar", kind: BAR_KIND_ALIASES[v] };
  if (MILESTONE_KIND_ALIASES[v]) return { type: "milestone", kind: MILESTONE_KIND_ALIASES[v] };
  if (v === "milestone" || v === "معلم") return { type: "milestone-infer" };
  return null;
}

function defaultIdFactory(): () => string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return () => crypto.randomUUID();
  let n = 0;
  return () => `import-${Date.now()}-${(n += 1)}`;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = cellText(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Turns raw sheet rows into timeline items + a per-row preview. */
export function mapImportRows(
  raw: RawImportRow[],
  ctx: MapContext,
  meta: { layout: TimelineImportLayout; sheetName: string } = { layout: "generic", sheetName: "" },
): ImportPlan {
  const newId = ctx.newId ?? defaultIdFactory();
  const dict = ctx.dictionary ?? [];
  const byCode = new Map(dict.map((d) => [norm(d.code), d]));
  const byName = new Map(dict.map((d) => [norm(d.name), d]));
  const fallback = defaultLane(ctx.rows);

  const preview: ImportPreviewRow[] = [];
  const bars: Bar[] = [];
  const milestones: Milestone[] = [];

  for (const r of raw) {
    const issues: ImportIssue[] = [];
    const err = (code: ImportIssueCode, params?: ImportIssue["params"]) =>
      issues.push({ code, severity: "error", params });
    const warn = (code: ImportIssueCode, params?: ImportIssue["params"]) =>
      issues.push({ code, severity: "warning", params });

    let label = r.task;
    let forcedMilestone = false;
    if (MILESTONE_SUFFIX.test(label)) {
      forcedMilestone = true;
      label = label.replace(MILESTONE_SUFFIX, "");
    }

    // Template example rows and the draft export's "No scheduled events" filler.
    if (EXAMPLE_PREFIX.test(label)) err("example_row");
    if (label === "No scheduled events" && (r.phase === "—" || r.track === "—" || !r.track))
      err("placeholder_row");

    const codeEntry = r.code ? byCode.get(norm(r.code)) : undefined;
    if (r.code && !codeEntry) warn("unknown_code", { code: r.code });
    if (!label && codeEntry) label = codeEntry.name;
    if (!label) err("missing_task");
    const nameEntry = codeEntry ?? (label ? byName.get(norm(label)) : undefined);

    // Track
    let lane = resolveTrack(r.track, ctx.rows);
    if (!lane && r.phase) lane = resolveTrack(r.phase, ctx.rows);
    if (!lane && nameEntry?.category) lane = resolveTrack(nameEntry.category, ctx.rows);
    if (!lane) {
      lane = fallback;
      if (r.track) warn("unknown_track", { value: r.track, lane: fallback?.label ?? "" });
      else warn("missing_track", { lane: fallback?.label ?? "" });
    }

    // Kind
    let kindRes = resolveKindCell(r.kind);
    if (r.kind && !kindRes) {
      warn("unknown_kind", { value: r.kind, kind: DEFAULT_BAR_KIND });
    }
    if (forcedMilestone && (!kindRes || kindRes.type === "bar"))
      kindRes = { type: "milestone-infer" };
    if (kindRes?.type === "milestone-infer")
      kindRes = { type: "milestone", kind: inferMilestoneKind(label) };
    if (!kindRes) {
      const code = (nameEntry?.code ?? r.code ?? "").trim();
      kindRes = { type: "bar", kind: KIND_OF_CODE[code] ?? DEFAULT_BAR_KIND };
    }

    // Dates
    const start = parseImportDate(r.start);
    let end = parseImportDate(r.end);
    const days = toNumber(r.days);
    if (!start) {
      if (cellText(r.start)) err("invalid_start", { value: cellText(r.start) });
      else err("missing_start");
    }
    if (!end && cellText(r.end)) warn("invalid_end", { value: cellText(r.end) });
    if (start && !end) {
      if (kindRes.type === "milestone") end = start;
      else if (days && days >= 1) end = addDaysIso(start, Math.round(days) - 1);
      else {
        end = start;
        warn("missing_end");
      }
    }
    if (start && end && end < start) {
      warn("end_before_start", { start, end });
      end = start;
    }
    if (start && end && days && cellText(r.end) && Math.round(days) !== daysInclusive(start, end)) {
      warn("days_mismatch", { days, actual: daysInclusive(start, end) });
    }
    if (kindRes.type === "milestone" && start && end && end !== start) {
      warn("milestone_range", { date: start });
      end = start;
    }

    const skipped = issues.some((i) => i.severity === "error") || !lane;
    preview.push({
      line: r.line,
      label,
      rowId: lane?.id ?? null,
      rowLabel: lane?.label ?? "",
      kind: kindRes.kind,
      isMilestone: kindRes.type === "milestone",
      start,
      end,
      issues,
      skipped,
    });
    if (skipped || !start || !end || !lane) continue;

    if (kindRes.type === "milestone") {
      milestones.push({ id: newId(), row: lane.id, kind: kindRes.kind, label, date: start });
    } else {
      bars.push({ id: newId(), row: lane.id, kind: kindRes.kind, label, start, end });
    }
  }

  const imported = preview.filter((p) => !p.skipped);
  return {
    layout: meta.layout,
    sheetName: meta.sheetName,
    preview,
    bars,
    milestones,
    counts: {
      read: preview.length,
      imported: imported.length,
      withWarnings: imported.filter((p) => p.issues.length > 0).length,
      skipped: preview.length - imported.length,
    },
  };
}

/** One call: cell grids → import plan (or the reason nothing could be read). */
export function planTimelineImport(
  sheets: SheetGrid[],
  ctx: MapContext,
): { ok: true; plan: ImportPlan } | { ok: false; error: "no_task_table" } {
  const parsed = readTaskRows(sheets);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    plan: mapImportRows(parsed.rows, ctx, {
      layout: parsed.table.layout,
      sheetName: parsed.table.sheetName,
    }),
  };
}

/** Applies an import plan to a snapshot: append, or replace everything shown. */
export function applyImportPlan<T extends { bars: Bar[]; milestones: Milestone[] }>(
  snap: T,
  plan: Pick<ImportPlan, "bars" | "milestones">,
  mode: "append" | "replace",
): T {
  return {
    ...snap,
    bars: mode === "replace" ? [...plan.bars] : [...snap.bars, ...plan.bars],
    milestones:
      mode === "replace" ? [...plan.milestones] : [...snap.milestones, ...plan.milestones],
  };
}

type XlsxModule = typeof import("xlsx");

/** Reads a workbook buffer into plain cell grids (dates stay Excel serials). */
export function workbookToGrids(XLSX: XlsxModule, data: ArrayBuffer | Uint8Array): SheetGrid[] {
  const wb = XLSX.read(data, { type: "array", cellDates: false });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      raw: true,
      defval: "",
      blankrows: true,
    }),
  }));
}
