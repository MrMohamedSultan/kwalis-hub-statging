import { Inbox, SearchX } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared empty state for list/table views.
 *
 * Two flavours:
 *  - `variant="empty"`  → nothing has been created yet (offer the primary action)
 *  - `variant="filtered"` → data exists but the active filters/search exclude it
 */
export function EmptyState({
  title,
  description,
  action,
  variant = "empty",
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "empty" | "filtered";
  className?: string;
}) {
  const Icon = variant === "filtered" ? SearchX : Inbox;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** `EmptyState` wrapped in a full-width table row. */
export function TableEmptyRow({
  colSpan,
  ...props
}: { colSpan: number } & Parameters<typeof EmptyState>[0]) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <EmptyState {...props} />
      </td>
    </tr>
  );
}
