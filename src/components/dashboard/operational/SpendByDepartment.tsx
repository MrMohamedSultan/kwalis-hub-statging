// =====================================================================
// SpendByDepartment — BUDGET ALLOCATION by department (not spend):
// horizontal bars, top 8 departments by budgeted amount. One color for
// every bar (nominal categories), values direct-labeled at the bar tips
// (outside the bar end — never clipped).
// =====================================================================
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/lib/i18n/useI18n";
import { useDashboardCurrency } from "@/lib/dashboard/currency";
import { formatCurrency, formatCompactAxis } from "@/lib/format";
import { getChartColors } from "@/lib/chart-theme";
import { safeNumber } from "@/lib/safe";
import type { SpendByDepartment as SpendPoint } from "@/lib/dashboard/mock-data";
import { ChartCard } from "@/components/charts/ChartCard";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { useFirstMount } from "@/components/charts/useFirstMount";

interface SpendByDepartmentProps {
  data: SpendPoint[];
  loading?: boolean;
  fetching?: boolean;
}

export function SpendByDepartment({ data, loading, fetching }: SpendByDepartmentProps) {
  const { t, isRtl } = useI18n();
  const { code, convert } = useDashboardCurrency();
  const colors = getChartColors();
  const animate = useFirstMount();

  const chartData = data.slice(0, 8).map((d) => ({
    name: d.name,
    value: Math.round(convert(d.value)),
  }));
  const money = (v: number) => formatCurrency(v, { currency: code });

  // Direct value label at the bar tip. Recharts' positional LabelList is
  // unreliable under a reversed (RTL) x-axis, so compute the tip from the
  // geometric props: LTR tip = x + width, RTL tip = x.
  const renderBarLabel = (props: {
    x?: number | string;
    y?: number | string;
    width?: number | string;
    height?: number | string;
    value?: unknown;
  }) => {
    const x = safeNumber(props.x);
    const y = safeNumber(props.y);
    const w = safeNumber(props.width);
    const h = safeNumber(props.height);
    // Recharts may emit negative widths under a reversed axis, so resolve
    // the geometric bar ends first instead of assuming x is the left edge.
    const left = Math.min(x, x + w);
    const right = Math.max(x, x + w);
    const tipX = isRtl ? left : right;
    return (
      <text
        x={isRtl ? tipX - 6 : tipX + 6}
        y={y + h / 2}
        dy={4}
        textAnchor={isRtl ? "end" : "start"}
        fill={colors.inkPrimary}
        fontSize={11}
        fontWeight={600}
      >
        {formatCompactAxis(safeNumber(props.value))}
      </text>
    );
  };

  return (
    <ChartCard
      title={t("dash.budgetAllocationByDepartment")}
      subtitle={t("dash.budgetAllocationSubtitle")}
      height="h-[320px]"
      loading={loading}
      fetching={fetching}
      isEmpty={chartData.length === 0}
      emptyMessage={t("dash.noSpend")}
      table={{
        caption: t("dash.budgetAllocationByDepartment"),
        columns: [
          { key: "name", label: t("dash.department") },
          {
            key: "value",
            label: t("dash.amount"),
            align: "end",
            numeric: true,
            format: (r) => money(safeNumber(r.value)),
          },
        ],
        rows: chartData,
      }}
    >
      <div dir="ltr" className="h-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 8, right: isRtl ? 8 : 56, bottom: 0, left: isRtl ? 56 : 8 }}
          >
            <CartesianGrid stroke={colors.grid} strokeDasharray="0" horizontal={false} />
            <XAxis type="number" hide reversed={isRtl} />
            <YAxis
              type="category"
              dataKey="name"
              axisLine={false}
              tickLine={false}
              width={104}
              orientation={isRtl ? "right" : "left"}
              tick={{ fill: colors.inkMuted, fontSize: 11, fontWeight: 500 }}
            />
            <Tooltip
              content={<ChartTooltip formatValue={(v) => money(v)} />}
              cursor={{ fill: "var(--surface-2)" }}
            />
            <Bar
              dataKey="value"
              name={t("dash.budget")}
              fill={colors.data2}
              maxBarSize={24}
              radius={isRtl ? [4, 0, 0, 4] : [0, 4, 4, 0]}
              isAnimationActive={animate}
              animationDuration={600}
              animationEasing="ease-out"
            >
              <LabelList dataKey="value" content={renderBarLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
