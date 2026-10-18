// =====================================================================
// Shared chart tooltip — replaces the unthemeable Recharts default.
// Theme tokens only, so it is correct in dark mode automatically.
// One row per series at the hovered X; values lead in weight.
// =====================================================================
import { formatAmount } from "@/lib/format-number";

export interface TooltipPayloadEntry {
  name?: string | number;
  value?: number | string | null;
  color?: string;
  dataKey?: string | number;
}

export interface TooltipExtraRow {
  label: string;
  value: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<TooltipPayloadEntry>;
  label?: string | number;
  /** Formats a series value; defaults to a grouped plain number. */
  formatValue?: (value: number, dataKey: string) => string;
  /** Extra rows appended after the series rows (e.g. variance). */
  extra?: (
    label: string | number | undefined,
    payload: ReadonlyArray<TooltipPayloadEntry>,
  ) => TooltipExtraRow[];
}

export function ChartTooltip({ active, payload, label, formatValue, extra }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const rows = payload.filter((p) => p.value != null && p.value !== "");
  const extraRows = extra?.(label, payload) ?? [];
  if (rows.length === 0 && extraRows.length === 0) return null;

  return (
    <div className="dash-tooltip min-w-[180px] rounded-lg border border-border bg-surface px-3 py-2.5 shadow-sm">
      {label != null && label !== "" && (
        <div className="mb-1.5 text-xs text-ink-muted">{String(label)}</div>
      )}
      <div className="space-y-1">
        {rows.map((entry, i) => {
          const numeric = Number(entry.value);
          const value = Number.isFinite(numeric)
            ? (formatValue?.(numeric, String(entry.dataKey ?? entry.name ?? i)) ??
              formatAmount(numeric))
            : String(entry.value);
          return (
            <div key={String(entry.dataKey ?? entry.name ?? i)} className="flex items-center gap-2">
              {/* 2px line-key — at tooltip density a filled box is data-weight
                  ink doing a label's job. */}
              <span
                aria-hidden="true"
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color || "var(--ink-muted)" }}
              />
              <span className="text-xs text-ink-secondary">{String(entry.name ?? "")}</span>
              <span className="ms-auto text-sm font-medium tabular-nums text-ink-primary">
                {value}
              </span>
            </div>
          );
        })}
        {extraRows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 border-t border-border pt-1 mt-1">
            <span className="text-xs text-ink-secondary">{row.label}</span>
            <span className="ms-auto text-sm font-medium tabular-nums text-ink-primary">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
