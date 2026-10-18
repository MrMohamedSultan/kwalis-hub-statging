// =====================================================================
// BudgetStatusCard — dedicated hero tile answering one question at a
// glance: are we over budget? Compares Actual Spend against Total
// Budget and shouts the verdict in massive bold type: red
// "OVER BUDGET: YES" when spend exceeds the budget, green "ON TRACK"
// otherwise. Same shell as StatTile so it sits seamlessly in the KPI
// strip.
// =====================================================================
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n/useI18n";
import { formatPercentAdaptive } from "@/lib/format";
import { safeDivide, safeNumber } from "@/lib/safe";

interface BudgetStatusCardProps {
  totalBudget: number;
  actualSpend: number;
  className?: string;
}

export function BudgetStatusCard({
  totalBudget,
  actualSpend,
  className = "",
}: BudgetStatusCardProps) {
  const { t } = useI18n();
  const budget = safeNumber(totalBudget);
  const spent = safeNumber(actualSpend);
  const over = spent > budget;
  const pct = safeDivide(spent, budget) * 100;

  const Icon = over ? TriangleAlert : ShieldCheck;

  return (
    <div
      className={`flex h-full flex-col justify-between rounded-xl border p-6 ${
        over
          ? "border-status-critical/40 bg-status-critical/5"
          : "border-status-good/40 bg-status-good/5"
      } ${className}`}
    >
      <div>
        <div className="text-xs font-medium text-ink-muted">{t("dash.budgetStatus")}</div>
        <div
          className={`mt-2 flex items-center gap-2 text-xl font-bold uppercase tracking-tight ${
            over ? "text-status-critical" : "text-status-good"
          }`}
        >
          <Icon className="size-7 shrink-0" aria-hidden="true" />
          <span className="break-words">
            {over ? t("dash.overBudgetYes") : t("dash.onTrack")}
          </span>
        </div>
      </div>
      <div className="mt-3 text-xs text-ink-muted">
        {formatPercentAdaptive(pct)} {t("dash.spent")}
      </div>
    </div>
  );
}
