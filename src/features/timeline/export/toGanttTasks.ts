/**
 * Kwalis HUB — Timeline state → export rows
 * ------------------------------------------
 * Rewritten against the real state, read out of the running app:
 *
 *   bar   = { id, row, kind, label, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', cashAlert? }
 *   row   = { id, label, ar }        ids: development · soft-prep · prep · shoot · post · wrap
 *   card  = { name, code, bg, required, done, category }
 *
 * The previous version guessed at twenty field names and deep-scanned the
 * whole state object. None of that is needed: there is one `bars` array, one
 * `rows` array, one `milestones` array. Simple beats clever when the shape is
 * actually known.
 *
 * Note `shoot` is the Production track — not `production`.
 *
 * Drop this at: src/features/timeline/export/toGanttTasks.ts
 */

import {
  buildCardIndex,
  normaliseCardName,
  resolveBarColor,
  resolveTokenHex,
  ROW_ORDER,
  type CardIndex,
  type ColorSource,
  type TimelineBar,
  type TimelineCard,
  type TimelineColorToken,
  type TimelineRow,
} from '../shared/timelineColors';

/* ================================================================== *
 * Output shape
 * ================================================================== */

export interface GanttTask {
  id: string;
  label: string;
  rowId: string;
  rowLabel: string;
  rowLabelAr?: string;
  kind?: string;
  /** null only when the source carried no usable date */
  start: Date | null;
  end: Date | null;
  token: TimelineColorToken;
  hex: string;
  colorSource: ColorSource;
  /** dictionary metadata, when the bar resolved to a card */
  code?: string;
  category?: string;
  isMilestone: boolean;
}

export interface ExtractionReport {
  bars: number;
  milestones: number;
  emitted: number;
  undated: Array<{ id: string; label: string }>;
  /** bars whose label matched no dictionary card — they fell back to `kind` */
  unmatchedCards: Array<{ id: string; label: string; kind?: string }>;
  /** bar.row values not present in the row registry */
  unknownRows: string[];
  bySource: Record<ColorSource, number>;
  byRow: Record<string, number>;
}

export interface TimelineStateInput {
  bars?: TimelineBar[] | null;
  milestones?: unknown[] | null;
  rows?: TimelineRow[] | null;
  cards?: TimelineCard[] | null;
}

/* ================================================================== *
 * Dates
 * ================================================================== */

/**
 * `start` and `end` are plain 'YYYY-MM-DD' strings. Parsing them with
 * `new Date(s)` treats them as UTC midnight, which in Riyadh renders as the
 * previous day at 21:00 — the exact off-by-one that was in the last workbook.
 * Building the date from its parts keeps the calendar day intact.
 */
export function parseTimelineDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ================================================================== *
 * Extraction
 * ================================================================== */

const DEFAULT_ROWS: TimelineRow[] = [
  { id: 'development', label: 'Development', ar: 'التطوير' },
  { id: 'soft-prep', label: 'Soft prep', ar: 'التحضير المبدئي' },
  { id: 'prep', label: 'Pre-Production', ar: 'التحضير' },
  { id: 'shoot', label: 'Production', ar: 'الإنتاج' },
  { id: 'post', label: 'Post production', ar: 'ما بعد الإنتاج' },
  { id: 'wrap', label: 'Wrap', ar: 'الإنهاء' },
];

export function toGanttTasks(state: TimelineStateInput): {
  tasks: GanttTask[];
  rows: TimelineRow[];
  report: ExtractionReport;
  cardIndex: CardIndex;
} {
  const rows = state.rows?.length ? state.rows : DEFAULT_ROWS;
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const cardIndex = buildCardIndex(state.cards);

  const bars = Array.isArray(state.bars) ? state.bars : [];
  const rawMilestones = Array.isArray(state.milestones) ? state.milestones : [];

  const report: ExtractionReport = {
    bars: bars.length,
    milestones: rawMilestones.length,
    emitted: 0,
    undated: [],
    unmatchedCards: [],
    unknownRows: [],
    bySource: { 'card-id': 0, 'card-name': 0, kind: 0, neutral: 0 },
    byRow: {},
  };

  const unknownRows = new Set<string>();
  const tasks: GanttTask[] = [];

  const emit = (bar: TimelineBar, isMilestone: boolean): void => {
    const row = rowById.get(bar.row);
    if (!row) unknownRows.add(bar.row);

    const start = parseTimelineDate(bar.start);
    // a milestone carries one date; it becomes a one-day bar, never a dropped row
    const rawEnd = parseTimelineDate(bar.end) ?? start;
    const end = start && rawEnd && rawEnd < start ? start : rawEnd;

    const resolved = resolveBarColor(bar, cardIndex);

    tasks.push({
      id: bar.id,
      label: bar.label,
      rowId: bar.row,
      rowLabel: row?.label ?? bar.row,
      rowLabelAr: row?.ar,
      kind: bar.kind,
      start,
      end,
      token: resolved.token,
      hex: resolveTokenHex(resolved.token),
      colorSource: resolved.source,
      code: resolved.card?.code,
      category: resolved.card?.category,
      isMilestone,
    });

    report.bySource[resolved.source] += 1;
    report.byRow[bar.row] = (report.byRow[bar.row] ?? 0) + 1;

    if (!start) report.undated.push({ id: bar.id, label: bar.label });
    if (resolved.source === 'kind' || resolved.source === 'neutral') {
      report.unmatchedCards.push({ id: bar.id, label: bar.label, kind: bar.kind });
    }
  };

  bars.forEach((bar) => emit(bar, false));

  // milestones were empty in every draft inspected, so the shape is unverified.
  // They are normalised defensively rather than assumed away.
  rawMilestones.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const m = raw as Record<string, unknown>;
    const date = (m.date ?? m.start ?? m.on ?? m.due) as string | undefined;
    emit(
      {
        id: String(m.id ?? `milestone-${i}`),
        row: String(m.row ?? m.track ?? 'development'),
        kind: typeof m.kind === 'string' ? m.kind : undefined,
        label: String(m.label ?? m.name ?? m.title ?? `Milestone ${i + 1}`),
        start: String(date ?? ''),
        end: String((m.end as string) ?? date ?? ''),
      },
      true,
    );
  });

  report.emitted = tasks.length;
  report.unknownRows = Array.from(unknownRows);

  return { tasks, rows, report, cardIndex };
}

/* ================================================================== *
 * The count gate
 * ================================================================== */

export class RowCountMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(
      `Timeline export: the screen holds ${expected} items but ${actual} rows were produced. ` +
        'Export aborted rather than deliver an incomplete schedule.',
    );
    this.name = 'RowCountMismatchError';
  }
}

export function assertRowCount(report: ExtractionReport, expected: number): void {
  if (report.emitted !== expected) {
    throw new RowCountMismatchError(expected, report.emitted);
  }
}

export function describeExtraction(report: ExtractionReport): string {
  const parts = [`${report.emitted} items`];
  if (report.undated.length) parts.push(`${report.undated.length} undated`);
  if (report.unmatchedCards.length) {
    parts.push(`${report.unmatchedCards.length} without a dictionary card`);
  }
  if (report.unknownRows.length) parts.push(`unknown tracks: ${report.unknownRows.join(', ')}`);
  return parts.join(' · ');
}

/** track order, screen order first, then anything unexpected */
export function orderedRowIds(rows: TimelineRow[]): string[] {
  const known = ROW_ORDER.filter((id) => rows.some((r) => r.id === id));
  const extra = rows.map((r) => r.id).filter((id) => !ROW_ORDER.includes(id as never));
  return [...known, ...extra];
}

export { normaliseCardName };
