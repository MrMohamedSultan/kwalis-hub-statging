import type { ReactNode } from "react";
import { BackButton } from "@/components/AppShell";
import { cn } from "@/lib/utils";

/**
 * Consistent page header: back button + title (+ optional subtitle) on the
 * start side, actions on the end side. Compact by design — this is dense
 * financial software, the header should not eat the fold.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  back = true,
  backTo,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: boolean;
  backTo?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {back && <BackButton to={backTo} />}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
