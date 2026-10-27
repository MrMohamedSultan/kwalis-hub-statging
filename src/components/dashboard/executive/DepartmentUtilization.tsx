// =====================================================================
// DepartmentUtilization — one BudgetMeter row per department, sorted by
// utilization descending so the problems sit at the top. Utilization
// counts everything already spoken for: actual spend + unpaid
// commitments (signed contracts, open POs).
// =====================================================================
import { useI18n } from "@/lib/i18n/useI18n";
import { useDashboardCurrency } from "@/lib/dashboard/currency";
import { formatCurrency } from "@/lib/format";
import { safeDivide, safeNumber } from "@/lib/safe";
import type { DepartmentUtil } from "@/lib/dashboard/mock-data";
import { ChartCard } from "@/components/charts/ChartCard";
import { BudgetMeter } from "@/components/dashboard/BudgetMeter";
import { formatPercentAdaptive } from "@/lib/format";

interface DepartmentUtilizationProps {
  departments: DepartmentUtil[];
  loading?: boolean;
  fetching?: boolean;
}

export function DepartmentUtilization({
  departments,
  loading,
  fetching,
}: DepartmentUtilizationProps) {
  const { t } = useI18n();
  const { code, convert } = useDashboardCurrency();

  const rows = [...departments]
    .map((d) => ({
      ...d,
      consumed: d.actual + d.committed,
      pct: safeDivide(d.actual + d.committed, d.budget) * 100,
    }))
    .sort((a, b) => b.pct - a.pct);

  // G16: financial figures are shown in full (no 1.8K abbreviations).
  const money = (v: number) => formatCurrency(convert(v), { currency: code });

  return (
    <ChartCard
      title={t("dash.departmentUtilization")}
      subtitle={t("dash.departmentUtilizationSubtitle")}
      height="h-[340px]"
      loading={loading}
      fetching={fetching}
      isEmpty={rows.length === 0}
      emptyMessage={t("dash.noDepartments")}
      table={{
        caption: t("dash.departmentUtilization"),
        columns: [
          { key: "name", label: t("dash.department") },
          {
            key: "consumed",
            label: t("dash.consumed"),
            align: "end",
            numeric: true,
            format: (r) => money(safeNumber(r.consumed)),
          },
          {
            key: "budget",
            label: t("dash.budget"),
            align: "end",
            numeric: true,
            format: (r) => money(safeNumber(r.budget)),
          },
          {
            key: "pct",
            label: "%",
            align: "end",
            numeric: true,
            format: (r) => formatPercentAdaptive(safeNumber(r.pct)),
          },
        ],
        rows,
      }}
    >
      <ul
        className="h-full divide-y divide-border overflow-auto"
        aria-label={t("dash.departmentUtilization")}
      >
        {rows.map((d) => (
          <li key={d.id} className="py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm text-ink-primary">{d.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-ink-secondary">
                {money(d.consumed)} / {money(d.budget)}
              </span>
            </div>
            <BudgetMeter className="mt-2" pct={d.pct} label={d.name} overLabel={t("dash.over")} />
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
