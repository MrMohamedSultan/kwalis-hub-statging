// =====================================================================
// TopSheetDonut — the four top-sheet categories in fixed conventional
// order (ATL → BTL → Post → Ops), colored with the ordered neutral ramp
// --data-1 → --data-4. The ramp encodes position in a known sequence,
// never magnitude — segments are NOT sorted by value.
//
// The vertical legend (swatch · name · amount · percent) is mandatory:
// close values cannot be compared by arc, so the numbers carry it.
// =====================================================================
import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import { useI18n } from "@/lib/i18n/useI18n";
import { useDashboardCurrency } from "@/lib/dashboard/currency";
import { formatCurrency } from "@/lib/format";
import { getChartColors } from "@/lib/chart-theme";
import { safeDivide, safeNumber } from "@/lib/safe";
import type { TopSheetCategory } from "@/lib/dashboard/mock-data";
import { ChartCard } from "@/components/charts/ChartCard";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { useFirstMount } from "@/components/charts/useFirstMount";

interface TopSheetDonutProps {
  data: TopSheetCategory[];
  loading?: boolean;
  fetching?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const renderActiveShape = (props: any) => (
  <Sector {...props} outerRadius={safeNumber(props.outerRadius) + 3} />
);

export function TopSheetDonut({ data, loading, fetching }: TopSheetDonutProps) {
  const { t } = useI18n();
  const { code, convert } = useDashboardCurrency();
  const colors = getChartColors();
  const animate = useFirstMount();
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const fills = [colors.data1, colors.data2, colors.data3, colors.data4];
  const chartData = data.map((c, i) => ({
    name: t(`dash.topSheet.${c.key}`),
    value: Math.round(convert(c.amount)),
    fill: fills[i % fills.length],
  }));
  // Total in the SAME currency as the slices — percentages must divide like by
  // like (the old total stayed in SAR while slices were converted to USD).
  const total = chartData.reduce((s, c) => s + safeNumber(c.value), 0);

  const money = (v: number) => formatCurrency(v, { currency: code });
  // One fixed precision for every row, so 29.3 / 57.3 / 12.1 / 1.3 line up.
  const pct = (v: number) => `${(safeDivide(v, total) * 100).toFixed(1)}%`;
  // G16: the total in full (2 decimals), never "12.4M".
  const totalText = formatCurrency(total, { currency: code, decimals: 2 }).replace(`${code} `, "");

  return (
    <ChartCard
      title={t("dash.topSheetBreakdown")}
      subtitle={t("dash.topSheetSubtitle")}
      height="h-[340px]"
      loading={loading}
      fetching={fetching}
      isEmpty={chartData.length === 0 || total <= 0}
      emptyMessage={t("dash.noTopSheet")}
      table={{
        caption: t("dash.topSheetBreakdown"),
        columns: [
          { key: "name", label: t("dash.category") },
          {
            key: "value",
            label: t("dash.amount"),
            align: "end",
            numeric: true,
            format: (r) => money(safeNumber(r.value)),
          },
          {
            key: "pct",
            label: "%",
            align: "end",
            numeric: true,
            format: (r) => pct(safeNumber(r.value)),
          },
        ],
        rows: chartData,
      }}
    >
      <div className="flex h-full flex-col">
        <div dir="ltr" className="relative h-[188px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip content={<ChartTooltip formatValue={(v) => money(v)} />} />
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                innerRadius="62%"
                outerRadius="88%"
                paddingAngle={2}
                minAngle={4}
                stroke="var(--surface)"
                strokeWidth={2}
                activeShape={renderActiveShape}
                onMouseEnter={(_, i) => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(null)}
                isAnimationActive={animate}
                animationDuration={600}
                animationEasing="ease-out"
              >
                {chartData.map((d, i) => (
                  <Cell
                    key={d.name}
                    fill={d.fill}
                    fillOpacity={activeIdx == null || activeIdx === i ? 1 : 0.4}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {/* Center label — HTML over the SVG center, not an SVG text hack. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[11px] font-medium text-ink-muted">{code}</div>
            <div className="text-sm font-semibold leading-tight tracking-tight text-ink-primary tabular-nums">
              {totalText}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-muted">{t("dash.totalBudget")}</div>
          </div>
        </div>

        {/* Mandatory numeric legend — swatch · name · amount · percent. */}
        <ul
          className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-auto"
          aria-label={t("dash.topSheetBreakdown")}
        >
          {chartData.map((d, i) => (
            <li key={d.name} className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: fills[i % fills.length] }}
              />
              <span className="truncate text-xs text-ink-secondary">{d.name}</span>
              <span className="ms-auto text-xs font-medium tabular-nums text-ink-primary">
                {money(d.value)}
              </span>
              <span className="w-12 text-end text-xs tabular-nums text-ink-muted">
                {pct(d.value)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}
