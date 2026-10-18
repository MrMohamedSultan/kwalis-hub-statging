// =====================================================================
// BudgetMeter — the over-budget component.
//
// shadcn's default Progress clamps at 100% and silently hides the exact
// condition this app exists to surface. This meter never hides it:
//   • fill clamps visually at 100% but the TRUE percentage is always
//     shown as text beside the bar;
//   • pct > 100 adds an overflow chip ("+8.0% over") at the end;
//   • an icon accompanies the color at all times.
// =====================================================================
import { AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatPercentAdaptive } from "@/lib/format";
import { useI18n } from "@/lib/i18n/useI18n";
import { safeNumber } from "@/lib/safe";
import type { StatusTone } from "./StatusChip";

interface BudgetMeterProps {
  /** Utilization percentage — may exceed 100. */
  pct: number;
  /** Department / scope name, used in the aria-label. */
  label: string;
  size?: "sm" | "md";
  /** Optional committed tick, as a percentage of the same budget. */
  threshold?: number | null;
  showOverChip?: boolean;
  /** Localized word for the overflow chip ("over"). */
  overLabel?: string;
  className?: string;
}

export function toneForPct(pct: number): StatusTone {
  if (pct < 85) return "good";
  if (pct < 100) return "warning";
  return "critical";
}

export function BudgetMeter({
  pct,
  label,
  size = "md",
  threshold = null,
  showOverChip = true,
  overLabel = "over",
  className = "",
}: BudgetMeterProps) {
  const { t } = useI18n();
  const p = safeNumber(pct);
  const tone = toneForPct(p);
  const fillWidth = Math.min(Math.max(p, 0), 100);
  const Icon = tone === "good" ? CheckCircle2 : tone === "warning" ? AlertTriangle : AlertOctagon;
  const color = `var(--status-${tone})`;
  const overPct = p - 100;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        role="progressbar"
        aria-valuenow={Math.round(p * 10) / 10}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} — ${formatPercentAdaptive(p)}${p > 100 ? `, +${formatPercentAdaptive(overPct)} ${overLabel}` : ""}`}
        className={`relative flex-1 overflow-hidden rounded-full bg-surface-2 ${
          size === "sm" ? "h-1.5" : "h-2"
        }`}
      >
        <div
          className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out"
          style={{ width: `${fillWidth}%`, backgroundColor: color }}
        />
        {threshold != null && threshold > 0 && threshold < 100 && (
          <div
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-ink-secondary"
            style={{ insetInlineStart: `${Math.min(threshold, 100)}%` }}
          />
        )}
      </div>
      <Icon className="size-4 shrink-0" style={{ color }} aria-hidden="true" />
      <span className="w-12 text-end text-xs font-medium tabular-nums text-ink-primary">
        {formatPercentAdaptive(p)}
      </span>
      {p > 100 && showOverChip && (
        <span className="inline-flex shrink-0 items-center rounded-md border border-status-critical/30 bg-status-critical/10 px-1.5 py-0.5 text-[10px] font-semibold text-status-critical">
          +{formatPercentAdaptive(overPct)} {overLabel}
        </span>
      )}
      {/* Explicit verdict — never rely on color or icons alone. */}
      <span
        className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          p > 100
            ? "border-status-critical/30 bg-status-critical/10 text-status-critical"
            : "border-status-good/30 bg-status-good/10 text-status-good"
        }`}
      >
        {p > 100 ? t("dash.overBudgetYes") : t("dash.overBudgetNo")}
      </span>
    </div>
  );
}
