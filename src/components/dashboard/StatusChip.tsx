// =====================================================================
// StatusChip — icon + label + tone. Status color never appears alone:
// every chip ships with an icon and a text label so colorblind users
// and grayscale printouts read the same information.
// =====================================================================
import type { LucideIcon } from "lucide-react";

export type StatusTone = "good" | "warning" | "critical" | "neutral";

const TONE_CLASSES: Record<StatusTone, string> = {
  good: "border-status-good/30 bg-status-good/10 text-status-good",
  warning: "border-status-warning/30 bg-status-warning/10 text-status-warning",
  critical: "border-status-critical/30 bg-status-critical/10 text-status-critical",
  neutral: "border-border bg-surface-2 text-ink-secondary",
};

interface StatusChipProps {
  tone: StatusTone;
  label: string;
  icon?: LucideIcon;
  className?: string;
}

export function StatusChip({ tone, label, icon: Icon, className = "" }: StatusChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[tone]} ${className}`}
    >
      {Icon && <Icon className="size-3.5" aria-hidden="true" />}
      {label}
    </span>
  );
}
