// =====================================================================
// HeroBudget — the one hero figure on the executive page.
// Total budget at hero scale, a full-width BudgetMeter with the
// committed threshold tick, and the spent / committed / paid / remaining
// row — the three doctrine dimensions plus what is left available.
// Over budget → a 1px critical border + a StatusChip. Nothing else
// changes — no red wash, no shouting.
// =====================================================================
import { AlertOctagon } from "lucide-react";
import { useI18n } from "@/lib/i18n/useI18n";
import { useDashboardCurrency } from "@/lib/dashboard/currency";
import { formatCurrency, formatPercentAdaptive } from "@/lib/format";
import { safeDivide, safeNumber } from "@/lib/safe";
import { BudgetMeter } from "@/components/dashboard/BudgetMeter";
import { StatusChip } from "@/components/dashboard/StatusChip";

interface HeroBudgetProps {
  totalBudget: number;
  spent: number;
  committed: number;
  /** Cash paid — third doctrine dimension (actual / committed / paid). */
  paid: number;
  remaining: number;
  loading?: boolean;
}

export function HeroBudget({
  totalBudget,
  spent,
  committed,
  paid,
  remaining,
  loading,
}: HeroBudgetProps) {
  const { t } = useI18n();
  const { code, convert } = useDashboardCurrency();

  if (loading) {
    return (
      <div
        className="h-[220px] animate-pulse rounded-xl border border-border bg-surface"
        aria-hidden="true"
      />
    );
  }

  const budget = safeNumber(totalBudget);
  const spentPct = safeDivide(spent, budget) * 100;
  const committedPct = safeDivide(spent + committed, budget) * 100;
  const over = spent > budget && budget > 0;
  const overAmount = spent - budget;
  const overPct = (safeDivide(spent, budget) - 1) * 100;

  const money = (v: number) => formatCurrency(convert(v), { currency: code, compact: true });

  return (
    <section
      className={`rounded-xl border bg-surface p-6 lg:p-7 ${
        over ? "border-status-critical" : "border-border"
      }`}
      aria-label={t("dash.totalProductionBudget")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
          {t("dash.totalProductionBudget")}
        </div>
        {over && (
          <StatusChip
            tone="critical"
            icon={AlertOctagon}
            label={t("dash.overBudgetBy", {
              amount: money(overAmount),
              pct: formatDelta(overPct),
            })}
          />
        )}
      </div>

      {/* The single hero figure — proportional figures, never tabular-nums. */}
      <div className="mt-3 text-5xl font-semibold tracking-tight text-ink-primary md:text-6xl">
        {money(budget)}
      </div>

      <div className="mt-6">
        <BudgetMeter
          pct={spentPct}
          label={t("dash.actualVsBudget")}
          threshold={committedPct}
          overLabel={t("dash.over")}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-4">
        <div className="text-sm text-ink-secondary">
          <span className="text-ink-muted">{t("dash.spent")}</span>{" "}
          <span className="font-medium tabular-nums text-ink-primary">
            {money(spent)} ({formatPercentAdaptive(spentPct)})
          </span>
        </div>
        <div className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
        <div className="text-sm text-ink-secondary">
          <span className="text-ink-muted">{t("dash.committed")}</span>{" "}
          <span className="font-medium tabular-nums text-ink-primary">{money(committed)}</span>
        </div>
        <div className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
        <div className="text-sm text-ink-secondary">
          <span className="text-ink-muted">{t("dash.paid")}</span>{" "}
          <span className="font-medium tabular-nums text-ink-primary">{money(paid)}</span>
        </div>
        <div className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
        <div className="text-sm text-ink-secondary">
          <span className="text-ink-muted">{t("dash.remaining")}</span>{" "}
          <span className="font-medium tabular-nums text-ink-primary">{money(remaining)}</span>
        </div>
      </div>
    </section>
  );
}

function formatDelta(value: number): string {
  const n = safeNumber(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}
