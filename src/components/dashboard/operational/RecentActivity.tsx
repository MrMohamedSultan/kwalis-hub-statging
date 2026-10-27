// =====================================================================
// RecentActivity — the last 8 ledger events. Muted, scannable, no color.
// =====================================================================
import { ScrollText } from "lucide-react";
import { useI18n } from "@/lib/i18n/useI18n";
import { useDashboardCurrency } from "@/lib/dashboard/currency";
import { formatCurrency } from "@/lib/format";
import type { ActivityEvent } from "@/lib/dashboard/mock-data";
import { EmptyState } from "@/components/dashboard/EmptyState";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

interface RecentActivityProps {
  events: ActivityEvent[];
  loading?: boolean;
  fetching?: boolean;
}

export function RecentActivity({ events, loading, fetching }: RecentActivityProps) {
  const { t } = useI18n();
  const { code, convert } = useDashboardCurrency();

  const rel = (hours: number) =>
    hours < 24
      ? t("dash.hoursAgo", { count: Math.max(1, hours) })
      : t("dash.daysAgo", { count: Math.floor(hours / 24) });

  return (
    <section
      className={`flex h-full flex-col rounded-xl border border-border bg-surface p-6 lg:p-7 transition-opacity duration-150 ${
        fetching && !loading ? "opacity-60" : "opacity-100"
      }`}
    >
      <header className="mb-2">
        <h3 className="text-sm font-medium text-ink-primary">{t("dash.recentActivity")}</h3>
      </header>

      {loading ? (
        <div className="space-y-2 pt-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState icon={ScrollText} message={t("dash.noActivity")} />
      ) : (
        <ul className="divide-y divide-border" aria-label={t("dash.recentActivity")}>
          {events.slice(0, 8).map((event) => (
            <li key={event.id} className="flex items-center gap-3 py-3">
              <div
                aria-hidden="true"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-ink-secondary"
              >
                {initials(event.actor) || "—"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink-primary">
                  <span className="font-medium">{event.actor}</span>{" "}
                  <span className="text-ink-secondary">{event.action}</span>
                </div>
                <div className="mt-0.5 text-xs text-ink-muted">{rel(event.ageHours)}</div>
              </div>
              {event.amount != null && (
                <span className="shrink-0 text-sm font-medium tabular-nums text-ink-primary">
                  {formatCurrency(convert(event.amount), { currency: code })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
