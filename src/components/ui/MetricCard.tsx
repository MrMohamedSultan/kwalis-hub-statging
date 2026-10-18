import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MetricSentiment = "neutral" | "good" | "warning" | "danger" | "info";

const VALUE_TONE: Record<MetricSentiment, string> = {
  neutral: "text-foreground",
  good: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
};

const BAR_TONE: Record<MetricSentiment, string> = {
  neutral: "bg-muted-foreground",
  good: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

/**
 * Flat, dense financial metric card.
 * Color is semantic only: good = healthy/remaining, warning = pending,
 * danger = overdue/over-budget, info = informational.
 * Numeric values always render LTR so they stay readable in Arabic RTL mode.
 */
export function MetricCard({
  label,
  value,
  hint,
  sentiment = "neutral",
  icon,
  progress,
  onClick,
  className = "",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  sentiment?: MetricSentiment;
  icon?: ReactNode;
  /** 0..1 — renders a thin progress bar when provided. */
  progress?: number;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-4 h-full flex flex-col",
        onClick && "transition-colors hover:bg-surface-2",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
          {label}
        </span>
        {icon}
      </div>
      <div
        dir="ltr"
        className={cn("mt-2 text-2xl font-semibold tabular-nums", VALUE_TONE[sentiment])}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      {typeof progress === "number" && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className={cn("h-full rounded-full", BAR_TONE[sentiment])}
            style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
          />
        </div>
      )}
    </div>
  );

  if (!onClick) return body;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-xl"
    >
      {body}
    </button>
  );
}

/** Picks a sentiment from a variance (remaining) figure. */
export function varianceSentiment(variance: number, budget?: number): MetricSentiment {
  if (variance < 0) return "danger";
  if (budget && budget > 0 && variance / budget < 0.1) return "warning";
  return "good";
}
