import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "good" | "warning" | "danger" | "info";

const TONE: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface-2 text-muted-foreground",
  good: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-info/30 bg-info/10 text-info",
};

/** Flat, color-coded status pill. Color always carries meaning. */
export function StatusBadge({
  label,
  tone = "neutral",
  className = "",
}: {
  label: string;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        TONE[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Maps common platform statuses to a semantic tone. */
export function toneForStatus(status?: string | null): BadgeTone {
  const s = (status ?? "").toLowerCase();
  if (["active", "approved", "paid", "verified", "reconciled", "received"].includes(s))
    return "good";
  if (["pending", "pending approval", "open", "hold", "in review", "draft"].includes(s))
    return "warning";
  if (["rejected", "cancelled", "canceled", "overdue", "suspended", "archived"].includes(s))
    return "danger";
  if (["new", "invited", "committed"].includes(s)) return "info";
  return "neutral";
}
