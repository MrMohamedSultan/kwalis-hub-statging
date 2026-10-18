import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Reusable table / list skeleton with tokenised colors so it reads
 * correctly in both Light & Dark themes and reserves layout height
 * (prevents layout shift while data loads).
 */
export function TableSkeleton({
  rows = 6,
  cols = 5,
  className,
  showHeader = true,
}: {
  rows?: number;
  cols?: number;
  className?: string;
  showHeader?: boolean;
}) {
  return (
    <div
      role="status"
      aria-label="Loading"
      aria-busy="true"
      className={cn("w-full rounded-xl border border-border bg-card overflow-hidden", className)}
    >
      {showHeader && (
        <div
          className="grid gap-3 px-4 py-3 border-b border-border bg-muted/40"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-3/4" />
          ))}
        </div>
      )}
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid gap-3 px-4 py-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={c}
                className="h-3.5"
                style={{ width: `${60 + ((r + c) % 4) * 10}%` }}
              />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Compact KPI-card grid skeleton for dashboards. */
export function KpiCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-busy="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
