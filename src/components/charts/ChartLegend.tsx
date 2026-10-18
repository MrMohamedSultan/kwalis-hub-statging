// =====================================================================
// Shared chart legend — replaces the Recharts default.
// Keys mirror the mark (line for line series, rounded rect for areas /
// bars / segments). Text uses ink tokens, never the series color.
// =====================================================================

export interface LegendPayloadEntry {
  value?: string | number;
  color?: string;
  /** Recharts legend type: "line" for line series, everything else gets a rect. */
  type?: string;
  dataKey?: string | number;
}

interface ChartLegendProps {
  payload?: ReadonlyArray<LegendPayloadEntry>;
}

export function ChartLegend({ payload }: ChartLegendProps) {
  if (!payload || payload.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 pt-3">
      {payload.map((entry, i) => {
        const isLine = entry.type === "line";
        return (
          <li key={String(entry.dataKey ?? entry.value ?? i)} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={isLine ? "h-0.5 w-4 rounded-full" : "size-2.5 rounded-[3px]"}
              style={{ backgroundColor: entry.color || "var(--ink-muted)" }}
            />
            <span className="text-xs font-medium text-ink-secondary">
              {String(entry.value ?? "")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
