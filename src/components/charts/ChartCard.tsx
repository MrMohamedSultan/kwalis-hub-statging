// =====================================================================
// ChartCard — every chart on both dashboards lives inside one.
// Owns the fixed-height chart body (ResponsiveContainer needs explicit
// pixel height), the chart/table toggle, the loading-opacity behavior,
// and the empty state.
// =====================================================================
import { useState, type ReactNode } from "react";
import { BarChart3, Table2, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/useI18n";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { TableView, type TableColumn } from "./TableView";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  /** Fixed pixel height class for the chart body — never a percentage. */
  height?: string;
  /** First load → skeleton matching the final dimensions. */
  loading?: boolean;
  /** Refetch → hold the previous render at reduced opacity. */
  fetching?: boolean;
  isEmpty?: boolean;
  emptyIcon?: LucideIcon;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  /** When provided, the header gets a chart/table view toggle. */
  table?: { columns: TableColumn[]; rows: Record<string, unknown>[]; caption?: string };
  className?: string;
  children: ReactNode;
}

export function ChartCard({
  title,
  subtitle,
  headerRight,
  height = "h-[320px]",
  loading = false,
  fetching = false,
  isEmpty = false,
  emptyIcon,
  emptyMessage,
  emptyAction,
  table,
  className = "",
  children,
}: ChartCardProps) {
  const { t } = useI18n();
  const [view, setView] = useState<"chart" | "table">("chart");

  return (
    <section
      className={`rounded-xl border border-border bg-surface p-6 pb-4 lg:p-7 lg:pb-4 ${className}`}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink-primary">{title}</h3>
          {subtitle && <p className="mt-1 text-xs text-ink-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {headerRight}
          {table && !isEmpty && !loading && (
            <div
              role="group"
              aria-label={t("dash.viewToggle")}
              className="inline-flex items-center rounded-lg border border-border bg-surface-2 p-0.5"
            >
              <button
                type="button"
                onClick={() => setView("chart")}
                aria-pressed={view === "chart"}
                title={t("dash.chartView")}
                className={`rounded-md p-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  view === "chart"
                    ? "bg-surface text-ink-primary shadow-sm"
                    : "text-ink-muted hover:text-ink-secondary"
                }`}
              >
                <BarChart3 className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setView("table")}
                aria-pressed={view === "table"}
                title={t("dash.tableView")}
                className={`rounded-md p-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  view === "table"
                    ? "bg-surface text-ink-primary shadow-sm"
                    : "text-ink-muted hover:text-ink-secondary"
                }`}
              >
                <Table2 className="size-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      {loading ? (
        /* Skeleton matches the final component's exact dimensions. */
        <div className={`${height} animate-pulse rounded-lg bg-surface-2`} aria-hidden="true" />
      ) : isEmpty ? (
        <div className={`${height} flex items-center justify-center`}>
          <EmptyState icon={emptyIcon} message={emptyMessage ?? ""} action={emptyAction} />
        </div>
      ) : (
        <div
          className={`transition-opacity duration-150 ${fetching ? "opacity-60" : "opacity-100"}`}
        >
          {view === "chart" ? (
            <div className={height}>{children}</div>
          ) : (
            <div className={`${height} overflow-auto pe-1`}>
              {table && (
                <TableView columns={table.columns} rows={table.rows} caption={table.caption} />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
