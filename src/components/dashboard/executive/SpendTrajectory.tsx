// =====================================================================
// SpendTrajectory — planned vs actual cumulative spend, 26 weeks.
// actual = story series (solid --data-1, capped gradient fill, ends at
// the current week); planned = reference series (dashed --data-4).
// One annotation only: the variance crossover point.
// =====================================================================
import { useId } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Area,
  Line,
  Legend,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/lib/i18n/useI18n";
import { useDashboardCurrency } from "@/lib/dashboard/currency";
import { formatCurrency, formatCompactAxis, formatDelta } from "@/lib/format";
import { getChartColors } from "@/lib/chart-theme";
import { safeNumber } from "@/lib/safe";
import type { TrajectoryPoint } from "@/lib/dashboard/mock-data";
import { ChartCard } from "@/components/charts/ChartCard";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { useFirstMount } from "@/components/charts/useFirstMount";

interface SpendTrajectoryProps {
  data: TrajectoryPoint[];
  totalBudget: number;
  crossoverWeek: number | null;
  loading?: boolean;
  fetching?: boolean;
}

export function SpendTrajectory({
  data,
  totalBudget,
  crossoverWeek,
  loading,
  fetching,
}: SpendTrajectoryProps) {
  const { t, isRtl } = useI18n();
  const { code, convert } = useDashboardCurrency();
  const colors = getChartColors();
  const gradientId = useId();
  const animate = useFirstMount();

  // Full precision on actuals — rounding here would drift the endpoint
  // away from the Actual Spend card by sub-SAR amounts. Planned is a
  // synthetic curve, so whole-unit rounding is honest there.
  const chartData = data.map((p) => ({
    week: `W${p.week}`,
    planned: Math.round(convert(p.planned)),
    actual: p.actual == null ? null : convert(p.actual),
  }));

  const lastActualIdx = (() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i].actual != null) return i;
    }
    return -1;
  })();

  const crossover =
    crossoverWeek != null && crossoverWeek >= 1 && crossoverWeek <= chartData.length
      ? chartData[crossoverWeek - 1]
      : null;

  // 2 decimals so the trajectory endpoint reads exactly like the Actual
  // Spend card (243,039.47 — halala-accurate reconciliation).
  const money = (v: number) => formatCurrency(v, { currency: code, decimals: 2 });
  const compact = (v: number) => formatCurrency(v, { currency: code, compact: true });

  return (
    <ChartCard
      title={t("dash.spendTrajectory")}
      subtitle={t("dash.spendTrajectorySubtitle")}
      height="h-[340px]"
      loading={loading}
      fetching={fetching}
      isEmpty={chartData.length === 0}
      emptyMessage={t("dash.noTrajectory")}
      table={{
        caption: t("dash.spendTrajectory"),
        columns: [
          { key: "week", label: t("dash.week") },
          {
            key: "planned",
            label: t("dash.planned"),
            align: "end",
            numeric: true,
            format: (r) => money(safeNumber(r.planned)),
          },
          {
            key: "actual",
            label: t("dash.actual"),
            align: "end",
            numeric: true,
            format: (r) => (r.actual == null ? "—" : money(safeNumber(r.actual))),
          },
          {
            key: "variance",
            label: t("dash.variance"),
            align: "end",
            numeric: true,
            format: (r) =>
              r.actual == null
                ? "—"
                : formatDelta((safeNumber(r.actual) / (safeNumber(r.planned) || 1) - 1) * 100),
          },
        ],
        rows: chartData.map((p) => ({ ...p, variance: null })),
      }}
    >
      {/* Recharts does not understand RTL — the container stays LTR and the
          chart is mirrored semantically via axis props. */}
      <div dir="ltr" className="h-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 24, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.data1} stopOpacity={0.18} />
                <stop offset="100%" stopColor={colors.data1} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={colors.grid} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="week"
              axisLine={false}
              tickLine={false}
              reversed={isRtl}
              interval="preserveStartEnd"
              minTickGap={24}
              tick={{ fill: colors.inkMuted, fontSize: 11, fontWeight: 500 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={56}
              orientation={isRtl ? "right" : "left"}
              tick={{ fill: colors.inkMuted, fontSize: 11, fontWeight: 500 }}
              tickFormatter={(v) => formatCompactAxis(safeNumber(v))}
            />
            <Tooltip
              content={
                <ChartTooltip
                  formatValue={(v) => money(v)}
                  extra={(_label, payload) => {
                    const planned = safeNumber(payload.find((p) => p.dataKey === "planned")?.value);
                    const actual = payload.find((p) => p.dataKey === "actual")?.value;
                    if (actual == null || !planned) return [];
                    return [
                      {
                        label: t("dash.variance"),
                        value: formatDelta((safeNumber(actual) / planned - 1) * 100),
                      },
                    ];
                  }}
                />
              }
              cursor={{ stroke: colors.axis, strokeWidth: 1 }}
            />
            {convert(totalBudget) > 0 && (
              <ReferenceLine
                y={Math.round(convert(totalBudget))}
                stroke={colors.inkSecondary}
                strokeWidth={1}
                label={{
                  value: `${t("dash.budget")} ${compact(convert(totalBudget))}`,
                  position: "insideTopRight",
                  fill: colors.inkMuted,
                  fontSize: 11,
                  fontWeight: 500,
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="actual"
              name={t("dash.actual")}
              legendType="line"
              stroke={colors.data1}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill={`url(#${gradientId})`}
              dot={false}
              connectNulls={false}
              activeDot={{ r: 5, stroke: colors.surface, strokeWidth: 2 }}
              isAnimationActive={animate}
              animationDuration={600}
              animationEasing="ease-out"
            />
            <Line
              type="monotone"
              dataKey="planned"
              name={t("dash.planned")}
              legendType="line"
              stroke={colors.data4}
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              activeDot={{ r: 5, stroke: colors.surface, strokeWidth: 2 }}
              isAnimationActive={animate}
              animationDuration={600}
              animationEasing="ease-out"
            />
            {crossover && crossover.actual != null && (
              <ReferenceDot
                x={crossover.week}
                y={crossover.actual}
                r={5}
                fill={colors.statusCritical}
                stroke={colors.surface}
                strokeWidth={2}
                label={{
                  value: `${t("dash.varianceBegins")} · W${crossoverWeek}`,
                  position: "top",
                  fill: colors.statusCritical,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
            )}
            <Legend content={<ChartLegend />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
