// =====================================================================
// SectionHeader — overline eyebrow + title + optional end-side slot.
// =====================================================================
import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  overline?: string;
  right?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, overline, right, className = "" }: SectionHeaderProps) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div>
        {overline && (
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
            {overline}
          </div>
        )}
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink-primary">{title}</h2>
      </div>
      {right}
    </div>
  );
}
