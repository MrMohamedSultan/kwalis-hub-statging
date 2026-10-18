import type { ReactNode } from "react";

/**
 * Shared surface card — uniform padding, radius, border and spacing.
 * Prefer this over hand-rolling `rounded-2xl border ...` divs.
 */
export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className = "",
  dense = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border border-border bg-surface ${dense ? "p-4" : "p-6"} space-y-4 ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold text-foreground">{title}</h2>}
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
