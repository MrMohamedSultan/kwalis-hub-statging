// ═══════════════════════════════════════════════════════════════════
// src/routes/_authenticated/dashboard.tsx
// Operational dashboard — dense, analytical, monochrome. Greeting, KPI
// strip, approval queue with budget alerts, spend by department, recent
// activity and executive-grade charts. The `dashboard-scope` class repaints
// this page with the dashboard token set; the surrounding AppShell chrome is
// untouched.
// ═══════════════════════════════════════════════════════════════════

import { createFileRoute } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/useI18n";
import { useDashboardCurrency } from "@/lib/dashboard/currency";
import { useOperationalDashboard } from "@/lib/dashboard/useOperationalDashboard";
import { useStore } from "@/lib/store";
import { useCurrentUser } from "@/lib/rbac";
import { formatCurrency, formatPercentAdaptive } from "@/lib/format";
import { safeDivide } from "@/lib/safe";
import { StatTile } from "@/components/dashboard/StatTile";
import { BudgetStatusCard } from "@/components/dashboard/BudgetStatusCard";
import { DashboardControls } from "@/components/dashboard/DashboardControls";
import { useDashboardControls } from "@/stores/useDashboardControls";
import { PendingApprovals } from "@/components/dashboard/operational/PendingApprovals";
import { DepartmentWarnings } from "@/components/dashboard/operational/DepartmentWarnings";
import { SpendByDepartment } from "@/components/dashboard/operational/SpendByDepartment";
import { RecentActivity } from "@/components/dashboard/operational/RecentActivity";
import { SpendTrajectory } from "@/components/dashboard/executive/SpendTrajectory";
import { TopSheetDonut } from "@/components/dashboard/executive/TopSheetDonut";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: `Dashboard — ${APP_NAME}` },
      { name: "description", content: "Operational dashboard for production finance." },
      { property: "og:title", content: `Dashboard — ${APP_NAME}` },
      { property: "og:description", content: "Operational dashboard for production finance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OperationalDashboard,
});

/** Staggered card entrance — 40ms apart, first mount only. */
const enter = (i: number) => ({
  className: "dash-enter",
  style: { animationDelay: `${i * 40}ms` } as const,
});

const tileSkeleton = (
  <div
    className="h-full min-h-[118px] animate-pulse rounded-xl border border-border bg-surface"
    aria-hidden="true"
  />
);

function OperationalDashboard() {
  const { t } = useI18n();
  const { code, convert } = useDashboardCurrency();
  const user = useCurrentUser();
  const activeProjectId = useStore((s) => s.activeProjectId);
  const rangeFrom = useDashboardControls((s) => s.rangeFrom);
  const rangeTo = useDashboardControls((s) => s.rangeTo);
  const { data, isLoading, isFetching } = useOperationalDashboard(activeProjectId, {
    from: rangeFrom,
    to: rangeTo,
  });
  const d = data ?? null;
  const loading = isLoading || !d;

  const hour = new Date().getHours();
  const greeting = t(
    hour < 12 ? "dash.goodMorning" : hour < 18 ? "dash.goodAfternoon" : "dash.goodEvening",
  );

  // Financial KPIs render at full precision (2 decimals) — the doctrine
  // layer delivers exact figures and presentation never rounds them away.
  const money = (v: number) => formatCurrency(convert(v), { currency: code, decimals: 2 });

  return (
    <div className="dashboard-scope -m-4 min-h-full px-6 py-8 lg:-m-8 lg:px-10 lg:py-10">
      <div className="space-y-6">
        {/* ── Header band ─────────────────────────────────────────── */}
        <div {...enter(0)} className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-primary">
              {greeting}
              {user.name ? `, ${user.name}` : ""}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              {t("dash.weekSummary", {
                week: d?.currentWeek ?? "—",
                count: d?.approvals.length ?? 0,
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DashboardControls />
          </div>
        </div>

        {/* ── KPI strip ───────────────────────────────────────────── */}
        <div
          {...enter(1)}
          className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6"
        >
          {!d ? (
            <>
              {tileSkeleton}
              {tileSkeleton}
              {tileSkeleton}
              {tileSkeleton}
              {tileSkeleton}
              {tileSkeleton}
            </>
          ) : (
            <>
              <div className="h-full">
                <BudgetStatusCard totalBudget={d.kpis.totalBudget} actualSpend={d.kpis.actualSpend} />
              </div>
              <div className="h-full">
                <StatTile
                  label={t("dash.totalBudget")}
                  value={money(d.kpis.totalBudget)}
                  sublabel={`${formatPercentAdaptive(d.kpis.pctSpent)} ${t("dash.spent")}`}
                />
              </div>
              <div className="h-full">
                <StatTile
                  label={t("dash.actualSpend")}
                  value={money(d.kpis.actualSpend)}
                  delta={
                    // No plan-to-date → no delta. A fake "0.0% vs. plan" is
                    // worse than a blank.
                    d.kpis.varianceVsPlanPct == null
                      ? null
                      : {
                          value: d.kpis.varianceVsPlanPct,
                          period: t("dash.vsPlan"),
                          goodWhenUp: false,
                        }
                  }
                  spark={d.kpis.sparkline}
                  sparkTone={(d.kpis.varianceVsPlanPct ?? 0) <= 0 ? "good" : "critical"}
                />
              </div>
              <div className="h-full">
                <StatTile
                  label={t("dash.committed")}
                  value={money(d.kpis.committed)}
                  sublabel={`${formatPercentAdaptive(d.kpis.committedPct)} ${t("dash.ofBudget")}`}
                />
              </div>
              <div className="h-full">
                <StatTile
                  label={t("dash.paid")}
                  value={money(d.kpis.paid)}
                  sublabel={`${formatPercentAdaptive(
                    safeDivide(d.kpis.paid, d.kpis.actualSpend) * 100,
                  )} ${t("dash.ofActualSpend")}`}
                />
              </div>
              <div className="h-full">
                <StatTile
                  label={t("dash.remaining")}
                  value={money(d.kpis.remaining)}
                  sublabel={t("dash.runway", { weeks: d.kpis.runwayWeeks })}
                />
              </div>
            </>
          )}
        </div>

        {/* ── Primary grid: approvals + budget alerts ─────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div {...enter(3)} className="h-full lg:col-span-2">
            <PendingApprovals items={d?.approvals ?? []} loading={loading} fetching={isFetching} />
          </div>
          <div {...enter(4)} className="h-full">
            <DepartmentWarnings
              departments={d?.departments ?? []}
              loading={loading}
              fetching={isFetching}
            />
          </div>
        </div>

        {/* ── Charts: spend trajectory + top sheet breakdown ──────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div {...enter(5)} className="h-full min-h-[350px] lg:col-span-2">
            <SpendTrajectory
              data={d?.trajectory ?? []}
              totalBudget={d?.kpis.totalBudget ?? 0}
              crossoverWeek={d?.crossoverWeek ?? null}
              loading={loading}
              fetching={isFetching}
            />
          </div>
          <div {...enter(6)} className="h-full min-h-[350px] lg:col-span-1">
            <TopSheetDonut data={d?.topSheet ?? []} loading={loading} fetching={isFetching} />
          </div>
        </div>

        {/* ── Secondary grid: budget allocation + activity ────────── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div {...enter(7)}>
            <SpendByDepartment
              data={d?.spendByDepartment ?? []}
              loading={loading}
              fetching={isFetching}
            />
          </div>
          <div {...enter(8)}>
            <RecentActivity events={d?.activity ?? []} loading={loading} fetching={isFetching} />
          </div>
        </div>
      </div>
    </div>
  );
}
