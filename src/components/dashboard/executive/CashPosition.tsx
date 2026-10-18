// =====================================================================
// CashPosition — monthly cash on hand. Nominal categories get ONE color
// (--data-2) for every bar; values are direct-labeled on the caps.
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
import type { CashPoint } from "@/lib/dashboard/mock-data";
import { ChartCard } from "@/components/charts/ChartCard";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { useFirstMount } from "@/components/charts/useFirstMount";

interface CashPositionProps {
  data: CashPoint[];
  loading?: boolean;
  fetching?: boolean;
}

export function CashPosition({ data, loading, fetching }: CashPositionProps) {
  const { t, isRtl } = useI18n();
  const { code, convert } = useDashboardCurrency();
  const colors = getChartColors();
  const animate = useFirstMount();

  const chartData = data.map((p) => ({ label: p.label, value: Math.round(convert(p.value)) }));
  const money = (v: number) => formatCurrency(v, { currency: code });

  return (
    <ChartCard
      title={t("dash.cashPosition")}
      subtitle={t("dash.cashPositionSubtitle")}
      height="h-[260px]"
      loading={loading}
      fetching={fetching}
      isEmpty={chartData.length === 0}
      emptyMessage={t("dash.noCash")}
      table={{
        caption: t("dash.cashPosition"),
        columns: [
          { key: "label", label: t("dash.month") },
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
          <BarChart data={chartData} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              reversed={isRtl}
              tick={{ fill: colors.inkMuted, fontSize: 11, fontWeight: 500 }}
            />
            <YAxis hide domain={[0, "dataMax"]} />
            <Tooltip
              content={<ChartTooltip formatValue={(v) => money(v)} />}
              cursor={{ fill: "var(--surface-2)" }}
            />
            <Bar
              dataKey="value"
              name={t("dash.cashPosition")}
              fill={colors.data2}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
              isAnimationActive={animate}
              animationDuration={600}
              animationEasing="ease-out"
            >
              <LabelList
                dataKey="value"
                position="top"
                formatter={(v: unknown) => formatCompactAxis(safeNumber(v))}
                fill={colors.inkMuted}
                fontSize={11}
                fontWeight={500}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
