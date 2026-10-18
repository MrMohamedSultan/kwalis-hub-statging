// =====================================================================
// DepartmentWarnings — ONLY the departments at or above 85% utilization,
// sorted descending. Utilization counts EVERYTHING already spoken for:
// actual spend + unpaid commitments (signed contracts, open POs). A
// short honest list beats a long reassuring one: when nothing is above
// 85% the empty state renders instead.
// =====================================================================
import { ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/useI18n";
import { useDashboardCurrency } from "@/lib/dashboard/currency";
import { formatCurrency } from "@/lib/format";
import { safeDivide, safeNumber } from "@/lib/safe";
import type { DepartmentUtil } from "@/lib/dashboard/mock-data";
import { BudgetMeter } from "@/components/dashboard/BudgetMeter";
import { StatusChip } from "@/components/dashboard/StatusChip";
import { EmptyState } from "@/components/dashboard/EmptyState";

interface DepartmentWarningsProps {
  departments: DepartmentUtil[];
  loading?: boolean;
  fetching?: boolean;
}

export function DepartmentWarnings({ departments, loading, fetching }: DepartmentWarningsProps) {
  const { t } = useI18n();
  const { code, convert } = useDashboardCurrency();

  const warnings = [...departments]
    .map((d) => ({
      ...d,
      consumed: d.actual + d.committed,
      pct: safeDivide(d.actual + d.committed, d.budget) * 100,
    }))
    .filter((d) => d.pct >= 85)
    .sort((a, b) => b.pct - a.pct);

  const money = (v: number) => formatCurrency(convert(v), { currency: code, compact: true });

  return (
    <section
      className={`rounded-xl border border-border bg-surface p-6 lg:p-7 transition-opacity duration-150 ${
        fetching && !loading ? "opacity-60" : "opacity-100"
      }`}
    >
      <header className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-ink-primary">{t("dash.budgetAlerts")}</h3>
        {!loading && warnings.length > 0 && (
          <StatusChip tone="warning" label={t("dash.pendingCount", { count: warnings.length })} />
        )}
      </header>

      {loading ? (
        <div className="space-y-2 pt-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : warnings.length === 0 ? (
        <EmptyState icon={ShieldCheck} message={t("dash.noWarnings")} />
      ) : (
        <ul className="divide-y divide-border" aria-label={t("dash.budgetAlerts")}>
          {warnings.map((d) => (
            <li key={d.id} className="py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium text-ink-primary">{d.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-secondary">
                  {money(d.consumed)} / {money(d.budget)}
                </span>
              </div>
              <BudgetMeter
                className="mt-2"
                size="sm"
                pct={d.pct}
                label={d.name}
                overLabel={t("dash.over")}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
