/**
 * Kwalis HUB — Production Timeline → Excel
 * -----------------------------------------
 * Three worksheets, mirroring the screen:
 *
 *   1. "Schedule Summary"   — the macro phase band. All six tracks, always,
 *                             including the unscheduled ones.
 *   2. "Track View"         — the timeline grid itself: one row per track,
 *                             bars laid side by side exactly as rendered.
 *                             Overlapping bars get a sub-lane.
 *   3. "Task List"          — one row per item, sortable, for filtering.
 *
 * Every sheet shares ONE daily column model computed across the whole
 * project, so column K is the same date on all three.
 *
 * Colour comes from `timelineColors.ts` — the same module the bar component
 * uses. Nothing in this file decides what colour anything is.
 *
 * Drop this at: src/features/timeline/export/ganttExcelExport.ts
 */

import ExcelJS from 'exceljs';
import {
  BAR_TEXT_HEX,
  resolveRowToken,
  resolveTokenHex,
  type TimelineRow,
} from '../shared/timelineColors';
import { orderedRowIds, type ExtractionReport, type GanttTask } from './toGanttTasks';

/* ================================================================== *
 * Options
 * ================================================================== */

export interface GanttExportOptions {
  projectName: string;
  tasks: GanttTask[];
  rows: TimelineRow[];
  /** e.g. "v3 · Aug 30, 2026 · Draft" — the export follows the open draft */
  versionLabel?: string;
  locale?: 'en' | 'ar';
  rtl?: boolean;
  /** 'day' matches the screen. 'week' only for very long projects. */
  scale?: 'day' | 'week';
  /** 0 = Sunday … 6 = Saturday. Gulf weekend. */
  weekendDays?: number[];
  weekStartsOn?: number;
  today?: Date | null;
  fileName?: string;
  /** aborts rather than write a workbook missing rows */
  strictCount?: number;
}

export interface ExportSummary {
  taskRows: number;
  scheduled: number;
  undated: number;
  tracks: number;
  columns: number;
  scale: 'day' | 'week';
}

export class ExportRowCountError extends Error {
  constructor(expected: number, actual: number) {
    super(`ganttExcelExport: expected ${expected} rows, wrote ${actual}. Export aborted.`);
    this.name = 'ExportRowCountError';
  }
}

/* ================================================================== *
 * Chrome
 * ================================================================== */

const INK = { primary: 'FF0B0D11', secondary: 'FF4A5260', muted: 'FF838B98' };
const SURFACE = {
  header: 'FFF1F2F4',
  band: 'FFEDEFF2',
  weekend: 'FFF3F4F6',
  track: 'FFFFFFFF',
  hairline: 'FFDDE1E6',
  today: 'FF2563EB',
  empty: 'FFFAFAFB',
};

const WHITE_EDGE: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFFFFFFF' } },
  bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } },
  left: { style: 'thin', color: { argb: 'FFFFFFFF' } },
  right: { style: 'thin', color: { argb: 'FFFFFFFF' } },
};

const DARK_EDGE: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: INK.primary } },
  bottom: { style: 'thin', color: { argb: INK.primary } },
  left: { style: 'thin', color: { argb: INK.primary } },
  right: { style: 'thin', color: { argb: INK.primary } },
};

const HAIRLINE: Partial<ExcelJS.Borders> = {
  bottom: { style: 'thin', color: { argb: SURFACE.hairline } },
};

const T = {
  summary: { en: 'Schedule Summary', ar: 'ملخص الجدول الزمني' },
  trackView: { en: 'Track View', ar: 'عرض المسارات' },
  taskList: { en: 'Task List', ar: 'قائمة المهام' },
  track: { en: 'TRACK', ar: 'المسار' },
  trackAr: { en: 'ARABIC', ar: 'بالعربية' },
  task: { en: 'TASK', ar: 'المهمة' },
  code: { en: 'CODE', ar: 'الرمز' },
  kind: { en: 'KIND', ar: 'النوع' },
  start: { en: 'START', ar: 'البداية' },
  end: { en: 'END', ar: 'النهاية' },
  days: { en: 'DAYS', ar: 'الأيام' },
  items: { en: 'ITEMS', ar: 'العناصر' },
  colorFrom: { en: 'COLOUR FROM', ar: 'مصدر اللون' },
  notScheduled: { en: 'Not scheduled', ar: 'غير مجدول' },
} as const;

const tr = (k: keyof typeof T, l: 'en' | 'ar') => T[k][l];

/* ================================================================== *
 * Dates
 * ================================================================== */

const DAY_MS = 86_400_000;

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const diffDays = (a: Date, b: Date) =>
  Math.round((midnight(b).getTime() - midnight(a).getTime()) / DAY_MS);

function startOfWeek(d: Date, weekStartsOn: number): Date {
  return addDays(midnight(d), -((d.getDay() - weekStartsOn + 7) % 7));
}

/**
 * ExcelJS serialises a JS Date through UTC. A local-midnight date in Riyadh
 * is 21:00 the previous day in UTC, which is precisely why every date in the
 * previous workbook was a day early. Handing Excel a UTC-midnight date with
 * the same calendar parts fixes it.
 */
const toExcelDate = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const fmtDayMonth = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

/* ================================================================== *
 * Fills
 * ================================================================== */

const argb = (hex: string) => (hex.length === 8 ? hex : `FF${hex.replace('#', '')}`).toUpperCase();
const solid = (hex: string): ExcelJS.FillPattern => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: argb(hex) },
});

/* ================================================================== *
 * Column model
 * ================================================================== */

interface Column {
  col: number;
  start: Date;
  end: Date;
  isWeekend: boolean;
  bandKey: string;
  bandLabel: string;
  sub: string;
  tick: string;
}

interface Grid {
  columns: Column[];
  firstCol: number;
  lastCol: number;
  colWidth: number;
  scale: 'day' | 'week';
  weekendDays: number[];
}

function buildColumns(
  min: Date,
  max: Date,
  firstCol: number,
  scale: 'day' | 'week',
  weekStartsOn: number,
  weekendDays: number[],
): Column[] {
  const out: Column[] = [];
  let col = firstCol;

  if (scale === 'day') {
    for (let d = midnight(min); d.getTime() <= max.getTime(); d = addDays(d, 1)) {
      const band = startOfWeek(d, weekStartsOn);
      out.push({
        col: col++,
        start: d,
        end: d,
        isWeekend: weekendDays.includes(d.getDay()),
        bandKey: `${band.getFullYear()}-${band.getMonth()}-${band.getDate()}`,
        bandLabel: fmtDayMonth(band),
        sub: WEEKDAYS[d.getDay()],
        tick: String(d.getDate()),
      });
    }
    return out;
  }

  for (let w = startOfWeek(min, weekStartsOn); w.getTime() <= max.getTime(); w = addDays(w, 7)) {
    out.push({
      col: col++,
      start: w,
      end: addDays(w, 6),
      isWeekend: false,
      bandKey: `${w.getFullYear()}-${w.getMonth()}`,
      bandLabel: `${MONTHS[w.getMonth()]} ${w.getFullYear()}`,
      sub: '',
      tick: fmtDayMonth(w),
    });
  }
  return out;
}

function span(grid: Grid, start: Date, end: Date): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  for (const c of grid.columns) {
    if (c.start.getTime() <= end.getTime() && c.end.getTime() >= start.getTime()) {
      if (from === -1) from = c.col;
      to = c.col;
    }
  }
  return from === -1 ? null : { from, to };
}

/* ================================================================== *
 * Sheet shell
 * ================================================================== */

const HEADER_ROWS = 5;
/** Where each sheet leaves room for the client logo (rows 1-2, after the title). */
const LOGO_ANCHOR = new WeakMap<ExcelJS.Worksheet, { col: number; row: number }>();

interface TextCol {
  label: string;
  width: number;
}

function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function createSheet(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  meta: string,
  textCols: TextCol[],
  grid: Grid | null,
  rtl: boolean,
): ExcelJS.Worksheet {
  const textCount = textCols.length;
  const lastCol = grid ? grid.lastCol : textCount;

  const ws = wb.addWorksheet(name, {
    views: [
      {
        state: 'frozen',
        xSplit: textCount,
        ySplit: HEADER_ROWS,
        topLeftCell: `${columnLetter(textCount + 1)}${HEADER_ROWS + 1}`,
        activeCell: 'A1',
        rightToLeft: rtl,
        showGridLines: false,
      },
    ],
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      printTitlesRow: `1:${HEADER_ROWS}`,
      printTitlesColumn: `A:${columnLetter(textCount)}`,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  ws.headerFooter = { oddFooter: `&L${title}&R${name} — Page &P of &N` };

  textCols.forEach((tc, i) => {
    ws.getColumn(i + 1).width = tc.width;
  });
  if (grid) grid.columns.forEach((c) => (ws.getColumn(c.col).width = grid.colWidth));

  const titleSpan = Math.min(lastCol, textCount + 22);
  // Client logo goes in the free cells right after the title block (G02).
  LOGO_ANCHOR.set(ws, { col: titleSpan + 0.1, row: 0.05 });

  ws.mergeCells(1, 1, 1, titleSpan);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: 'Inter', size: 14, bold: true, color: { argb: INK.primary } };
  t.alignment = { vertical: 'middle', horizontal: rtl ? 'right' : 'left' };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, titleSpan);
  const m = ws.getCell(2, 1);
  m.value = meta;
  m.font = { name: 'Inter', size: 9, color: { argb: INK.muted } };
  m.alignment = { vertical: 'middle', horizontal: rtl ? 'right' : 'left' };
  ws.getRow(2).height = 16;

  textCols.forEach((tc, i) => {
    ws.mergeCells(3, i + 1, HEADER_ROWS, i + 1);
    const c = ws.getCell(3, i + 1);
    c.value = tc.label;
    c.fill = solid(SURFACE.header);
    c.font = { name: 'Inter', size: 9, bold: true, color: { argb: INK.secondary } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { ...HAIRLINE, right: { style: 'thin', color: { argb: SURFACE.hairline } } };
  });

  ws.getRow(3).height = 16;
  ws.getRow(4).height = 13;
  ws.getRow(HEADER_ROWS).height = 15;

  if (!grid) return ws;

  let bandStart = 0;
  for (let i = 0; i <= grid.columns.length; i += 1) {
    const boundary =
      i === grid.columns.length || grid.columns[i].bandKey !== grid.columns[bandStart].bandKey;
    if (!boundary) continue;

    const from = grid.columns[bandStart].col;
    const to = grid.columns[i - 1].col;
    if (to > from) ws.mergeCells(3, from, 3, to);

    const c = ws.getCell(3, from);
    c.value = grid.columns[bandStart].bandLabel;
    c.fill = solid(SURFACE.header);
    c.font = { name: 'Inter', size: 9, bold: true, color: { argb: INK.secondary } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    c.border = { ...HAIRLINE, left: { style: 'thin', color: { argb: SURFACE.hairline } } };
    bandStart = i;
  }

  grid.columns.forEach((c) => {
    const sub = ws.getCell(4, c.col);
    sub.value = c.sub;
    sub.fill = solid(c.isWeekend ? SURFACE.weekend : SURFACE.header);
    sub.font = { name: 'Inter', size: 8, color: { argb: INK.muted } };
    sub.alignment = { vertical: 'middle', horizontal: 'center' };

    const tick = ws.getCell(HEADER_ROWS, c.col);
    tick.value = c.tick;
    tick.fill = solid(c.isWeekend ? SURFACE.weekend : SURFACE.header);
    tick.font = {
      name: 'Inter',
      size: 8,
      color: { argb: c.isWeekend ? INK.muted : INK.secondary },
    };
    tick.alignment = { vertical: 'middle', horizontal: 'center' };
    tick.border = HAIRLINE;
  });

  return ws;
}

/* ================================================================== *
 * Row primitives
 * ================================================================== */

function paintTrackRow(ws: ExcelJS.Worksheet, row: number, textCount: number, grid: Grid): void {
  for (let c = 1; c <= textCount; c += 1) {
    const cell = ws.getCell(row, c);
    cell.fill = solid(SURFACE.track);
    cell.border =
      c === textCount
        ? { ...HAIRLINE, right: { style: 'thin', color: { argb: SURFACE.hairline } } }
        : HAIRLINE;
  }
  grid.columns.forEach((tc) => {
    const weekend = grid.scale === 'day' && grid.weekendDays.includes(tc.start.getDay());
    const cell = ws.getCell(row, tc.col);
    cell.fill = solid(weekend ? SURFACE.weekend : SURFACE.track);
    cell.border = HAIRLINE;
  });
}

function drawBar(
  ws: ExcelJS.Worksheet,
  grid: Grid,
  row: number,
  start: Date,
  end: Date,
  hex: string,
  textHex: string,
  label: string,
  painted: Set<string>,
): void {
  const s = span(grid, start, end);
  if (!s) return;

  const edge = s.to === s.from ? DARK_EDGE : WHITE_EDGE;
  for (let c = s.from; c <= s.to; c += 1) {
    const cell = ws.getCell(row, c);
    cell.fill = solid(hex);
    cell.border = edge;
    painted.add(`${row}:${c}`);
  }
  if (s.to > s.from) ws.mergeCells(row, s.from, row, s.to);

  const anchor = ws.getCell(row, s.from);
  anchor.value = label;
  anchor.font = { name: 'Inter', size: 9, bold: true, color: { argb: argb(textHex) } };
  // shrinkToFit keeps short bars readable instead of leaving them blank
  anchor.alignment = {
    vertical: 'middle',
    horizontal: 'center',
    shrinkToFit: true,
  };
}

function writeText(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: string | number,
  opts: { bold?: boolean; size?: number; color?: string; align?: 'left' | 'center' | 'right' } = {},
): void {
  const cell = ws.getCell(row, col);
  cell.value = value;
  cell.font = {
    name: 'Inter',
    size: opts.size ?? 10,
    bold: opts.bold ?? false,
    color: { argb: opts.color ?? INK.primary },
  };
  cell.alignment = { vertical: 'middle', horizontal: opts.align ?? 'left', indent: 1 };
}

function writeDate(ws: ExcelJS.Worksheet, row: number, col: number, date: Date): void {
  const cell = ws.getCell(row, col);
  cell.value = toExcelDate(date);
  cell.numFmt = 'dd mmm yyyy';
  cell.font = { name: 'Inter', size: 9, color: { argb: INK.secondary } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
}

function drawToday(
  ws: ExcelJS.Worksheet,
  grid: Grid,
  today: Date | null,
  fromRow: number,
  toRow: number,
  painted: Set<string>,
): void {
  if (!today || toRow < fromRow) return;
  const t = midnight(today);
  const hit = grid.columns.find(
    (c) => c.start.getTime() <= t.getTime() && c.end.getTime() >= t.getTime(),
  );
  if (!hit) return;

  for (let r = 3; r <= toRow; r += 1) {
    if (r < fromRow && r > HEADER_ROWS) continue;
    if (painted.has(`${r}:${hit.col}`)) continue;
    const cell = ws.getCell(r, hit.col);
    cell.border = {
      ...(cell.border ?? {}),
      left: { style: 'medium', color: { argb: SURFACE.today } },
    };
  }
}

/* ================================================================== *
 * Lane packing — how the Track View mirrors the screen
 * ================================================================== */

function packLanes(tasks: GanttTask[]): GanttTask[][] {
  const lanes: GanttTask[][] = [];
  const dated = tasks
    .filter((t): t is GanttTask & { start: Date; end: Date } => Boolean(t.start && t.end))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  dated.forEach((task) => {
    const lane = lanes.find((l) => {
      const last = l[l.length - 1] as GanttTask & { end: Date };
      return last.end.getTime() < task.start.getTime();
    });
    if (lane) lane.push(task);
    else lanes.push([task]);
  });

  return lanes.length ? lanes : [[]];
}

/* ================================================================== *
 * Build
 * ================================================================== */

export async function buildTimelineWorkbook(
  options: GanttExportOptions,
): Promise<{ workbook: ExcelJS.Workbook; summary: ExportSummary }> {
  const {
    projectName,
    tasks,
    rows,
    versionLabel,
    locale = 'en',
    scale = 'day',
    weekendDays = [5, 6],
    weekStartsOn = 0,
    today = new Date(),
  } = options;
  const rtl = options.rtl ?? locale === 'ar';

  if (!tasks.length) throw new Error('buildTimelineWorkbook: no tasks to export.');

  const dated = tasks.filter(
    (t): t is GanttTask & { start: Date; end: Date } => Boolean(t.start && t.end),
  );
  const undated = tasks.filter((t) => !t.start || !t.end);
  if (!dated.length) {
    throw new Error(`buildTimelineWorkbook: all ${tasks.length} items are undated.`);
  }

  const minDate = new Date(Math.min(...dated.map((t) => t.start.getTime())));
  const maxDate = new Date(Math.max(...dated.map((t) => t.end.getTime())));

  const columns = buildColumns(
    addDays(minDate, -3),
    addDays(maxDate, 3),
    1, // patched per sheet below
    scale,
    weekStartsOn,
    weekendDays,
  );

  const makeGrid = (firstCol: number): Grid => {
    const shifted = columns.map((c, i) => ({ ...c, col: firstCol + i }));
    return {
      columns: shifted,
      firstCol,
      lastCol: shifted[shifted.length - 1].col,
      colWidth: scale === 'day' ? 2.7 : 6.5,
      scale,
      weekendDays,
    };
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kwalis HUB';
  wb.created = new Date();

  const title = `${projectName} — Production Timeline`;
  const meta =
    (versionLabel ? `${versionLabel}  ·  ` : '') +
    `${fmtDayMonth(minDate)} → ${fmtDayMonth(maxDate)}` +
    `  ·  ${tasks.length} ${tr('items', locale).toLowerCase()}` +
    (undated.length ? `  ·  ${undated.length} ${tr('notScheduled', locale)}` : '') +
    `  ·  ${new Date().toISOString().slice(0, 10)}`;

  const orderedIds = orderedRowIds(rows);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const label = (r: TimelineRow) => (locale === 'ar' && r.ar ? r.ar : r.label);

  /* ============================================================== *
   * SHEET 1 — Schedule Summary (all six tracks, always)
   * ============================================================== */
  const g1 = makeGrid(5);
  const s1 = createSheet(
    wb,
    T.summary[locale],
    title,
    meta,
    [
      { label: tr('track', locale), width: 20 },
      { label: tr('trackAr', locale), width: 18 },
      { label: tr('start', locale), width: 13 },
      { label: tr('end', locale), width: 13 },
    ],
    g1,
    rtl,
  );

  let r = HEADER_ROWS + 1;
  const painted1 = new Set<string>();

  orderedIds.forEach((id) => {
    const row = rowById.get(id);
    if (!row) return;
    const own = dated.filter((t) => t.rowId === id);

    s1.getRow(r).height = 22;
    paintTrackRow(s1, r, 4, g1);

    writeText(s1, r, 1, label(row), { bold: true });
    writeText(s1, r, 2, row.ar ?? '', { size: 9, color: INK.muted });

    if (own.length) {
      const start = new Date(Math.min(...own.map((t) => t.start.getTime())));
      const end = new Date(Math.max(...own.map((t) => t.end.getTime())));
      writeDate(s1, r, 3, start);
      writeDate(s1, r, 4, end);

      const token = resolveRowToken(id);
      drawBar(
        s1,
        g1,
        r,
        start,
        end,
        resolveTokenHex(token),
        BAR_TEXT_HEX[token],
        label(row).toUpperCase(),
        painted1,
      );
    } else {
      // the screen shows Post production and Wrap as "Not Scheduled" — so does this
      writeText(s1, r, 3, tr('notScheduled', locale), { size: 9, color: INK.muted });
      g1.columns.forEach((c) => (s1.getCell(r, c.col).fill = solid(SURFACE.empty)));
    }
    r += 1;
  });

  drawToday(s1, g1, today, HEADER_ROWS + 1, r - 1, painted1);

  /* ============================================================== *
   * SHEET 2 — Track View (the grid as rendered)
   * ============================================================== */
  const g2 = makeGrid(4);
  const s2 = createSheet(
    wb,
    T.trackView[locale],
    title,
    meta,
    [
      { label: tr('track', locale), width: 20 },
      { label: tr('trackAr', locale), width: 18 },
      { label: tr('items', locale), width: 9 },
    ],
    g2,
    rtl,
  );

  r = HEADER_ROWS + 1;
  const painted2 = new Set<string>();

  orderedIds.forEach((id) => {
    const row = rowById.get(id);
    if (!row) return;
    const own = tasks.filter((t) => t.rowId === id);
    const lanes = packLanes(own);
    const firstRow = r;

    lanes.forEach((lane) => {
      s2.getRow(r).height = 24;
      paintTrackRow(s2, r, 3, g2);
      lane.forEach((task) => {
        if (!task.start || !task.end) return;
        drawBar(
          s2,
          g2,
          r,
          task.start,
          task.end,
          task.hex,
          BAR_TEXT_HEX[task.token],
          task.label,
          painted2,
        );
      });
      r += 1;
    });

    const lastRow = r - 1;
    if (lastRow > firstRow) {
      s2.mergeCells(firstRow, 1, lastRow, 1);
      s2.mergeCells(firstRow, 2, lastRow, 2);
      s2.mergeCells(firstRow, 3, lastRow, 3);
    }
    writeText(s2, firstRow, 1, label(row), { bold: true });
    writeText(s2, firstRow, 2, row.ar ?? '', { size: 9, color: INK.muted });
    writeText(s2, firstRow, 3, own.length, { size: 9, color: INK.muted, align: 'center' });
    s2.getCell(firstRow, 1).alignment = {
      vertical: 'middle',
      horizontal: rtl ? 'right' : 'left',
      indent: 1,
    };
  });

  drawToday(s2, g2, today, HEADER_ROWS + 1, r - 1, painted2);

  /* ============================================================== *
   * SHEET 3 — Task List (sortable, no grid)
   * ============================================================== */
  const s3 = createSheet(
    wb,
    T.taskList[locale],
    title,
    meta,
    [
      { label: tr('track', locale), width: 20 },
      { label: tr('task', locale), width: 38 },
      { label: tr('code', locale), width: 9 },
      { label: tr('kind', locale), width: 12 },
      { label: tr('start', locale), width: 13 },
      { label: tr('end', locale), width: 13 },
      { label: tr('days', locale), width: 8 },
      { label: tr('colorFrom', locale), width: 14 },
    ],
    null,
    rtl,
  );

  r = HEADER_ROWS + 1;
  let written = 0;

  orderedIds.forEach((id) => {
    const row = rowById.get(id);
    const own = tasks
      .filter((t) => t.rowId === id)
      .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
    if (!own.length) return;

    own.forEach((task) => {
      s3.getRow(r).height = 20;
      for (let c = 1; c <= 8; c += 1) {
        s3.getCell(r, c).fill = solid(SURFACE.track);
        s3.getCell(r, c).border = HAIRLINE;
      }

      writeText(s3, r, 1, row ? label(row) : task.rowId, { size: 9, color: INK.muted });
      writeText(s3, r, 2, task.label);

      // the colour swatch, so the list reads the same as the grid
      const swatch = s3.getCell(r, 3);
      swatch.value = task.code ?? '';
      swatch.fill = solid(task.hex);
      swatch.font = {
        name: 'Inter',
        size: 9,
        bold: true,
        color: { argb: argb(BAR_TEXT_HEX[task.token]) },
      };
      swatch.alignment = { vertical: 'middle', horizontal: 'center' };
      swatch.border = WHITE_EDGE;

      writeText(s3, r, 4, task.kind ?? '', { size: 9, color: INK.muted });
      if (task.start) writeDate(s3, r, 5, task.start);
      else writeText(s3, r, 5, tr('notScheduled', locale), { size: 9, color: INK.muted });
      if (task.end) writeDate(s3, r, 6, task.end);
      if (task.start && task.end) {
        const cell = s3.getCell(r, 7);
        cell.value = diffDays(task.start, task.end) + 1;
        cell.numFmt = '0';
        cell.font = { name: 'Inter', size: 9, color: { argb: INK.secondary } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
      writeText(s3, r, 8, task.colorSource, { size: 8, color: INK.muted });

      written += 1;
      r += 1;
    });
  });

  s3.autoFilter = { from: { row: HEADER_ROWS, column: 1 }, to: { row: r - 1, column: 8 } };

  /* -- gates -------------------------------------------------------- */
  if (written !== tasks.length) throw new ExportRowCountError(tasks.length, written);
  if (options.strictCount !== undefined && options.strictCount !== written) {
    throw new ExportRowCountError(options.strictCount, written);
  }

  return {
    workbook: wb,
    summary: {
      taskRows: written,
      scheduled: dated.length,
      undated: undated.length,
      tracks: orderedIds.length,
      columns: columns.length,
      scale,
    },
  };
}

/* ================================================================== *
 * Download
 * ================================================================== */


export async function exportTimelineToExcel(
  options: GanttExportOptions & { report?: ExtractionReport },
): Promise<ExportSummary> {
  const { workbook, summary } = await buildTimelineWorkbook(options);
  // Shared Kwalis Hub identity + standard file name (G02).
  const { saveBrandedWorkbook } = await import('@/lib/export/xlsx-report');
  const version = options.versionLabel ? ` ${options.versionLabel.split(/[\s·]/)[0]}` : '';
  const logos = workbook.worksheets.flatMap((ws) => {
    const at = LOGO_ANCHOR.get(ws);
    return at ? [{ ...at, maxWidth: 110, maxHeight: 36, sheets: [ws.name] }] : [];
  });
  await saveBrandedWorkbook(workbook, options.fileName ?? `Production Timeline${version}`, undefined, {
    logo: logos,
  });

  return summary;
}
