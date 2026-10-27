// ═══════════════════════════════════════════════════════════════════
// src/routes/_authenticated/executive.tsx
// Executive dashboard — read-only, presentation-grade. A production
// report that happens to be on screen: one hero, one trend, one
// composition, one utilization list, one cash panel, four KPI tiles.
// Zero data-entry affordances. Rendered inside ExecutiveLayout, which
// carries the `dashboard-scope` monochrome token scope.
// ═══════════════════════════════════════════════════════════════════

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { APP_NAME } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/useI18n";
import { useDashboardCurrency } from "@/lib/dashboard/currency";
import { useExecutiveDashboard } from "@/lib/dashboard/useExecutiveDashboard";
import { MOCK_PRODUCTION } from "@/lib/dashboard/mock-data";
import { formatCurrency, formatPercentAdaptive } from "@/lib/format";
import { safeDivide } from "@/lib/safe";
import { HeroBudget } from "@/components/dashboard/executive/HeroBudget";
import { SpendTrajectory } from "@/components/dashboard/executive/SpendTrajectory";
import { TopSheetDonut } from "@/components/dashboard/executive/TopSheetDonut";
import { DepartmentUtilization } from "@/components/dashboard/executive/DepartmentUtilization";
import { CashPosition } from "@/components/dashboard/executive/CashPosition";
import { StatTile } from "@/components/dashboard/StatTile";
import { DashboardControls } from "@/components/dashboard/DashboardControls";
import { useDashboardControls } from "@/stores/useDashboardControls";

export const Route = createFileRoute("/_authenticated/executive")({
  head: () => ({
    meta: [
      { title: `Executive Dashboard — ${APP_NAME}` },
      { name: "description", content: "Read-only executive portfolio overview." },
      { property: "og:title", content: `Executive Dashboard — ${APP_NAME}` },
      { property: "og:description", content: "Read-only executive portfolio overview." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExecutiveDashboard,
});

/** Staggered card entrance — 40ms apart, first mount only. */
const enter = (i: number) => ({
  className: "dash-enter",
  style: { animationDelay: `${i * 40}ms` } as const,
});

const tileSkeleton = (
  <div
    className="h-[118px] animate-pulse rounded-xl border border-border bg-surface"
    aria-hidden="true"
  />
);

function ExecutiveDashboard() {
  const { t } = useI18n();
  const { code, convert } = useDashboardCurrency();
  const rangeFrom = useDashboardControls((s) => s.rangeFrom);
  const rangeTo = useDashboardControls((s) => s.rangeTo);

  // Production selector — real projects when they exist.
  const { data: projects } = useQuery({
    queryKey: ["executive", "projects"],
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  const list = useMemo(() => projects ?? [], [projects]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? list[0]?.id ?? null;
  const selected = list.find((p) => p.id === effectiveId);

  // Stable identity — the dashboard hook memoizes its heavy derivations on
  // this object; an inline literal would invalidate the memo every render.
  const meta = useMemo(
    () => ({
      name: selected?.name ?? MOCK_PRODUCTION.name,
      unit: MOCK_PRODUCTION.unit,
      dates: MOCK_PRODUCTION.dates,
      currentWeek: MOCK_PRODUCTION.currentWeek,
      totalWeeks: MOCK_PRODUCTION.totalWeeks,
    }),
    [selected?.name],
  );

  const { data, isLoading, isFetching } = useExecutiveDashboard(effectiveId, meta, {
    from: rangeFrom,
    to: rangeTo,
  });
  const d = data ?? null;
  const loading = isLoading || !d;

  const trajectory = d?.trajectory ?? [];

  // G16: financial figures are shown in full (no 1.8K abbreviations).
  const money = (v: number) => formatCurrency(convert(v), { currency: code });

  return (
    <div className="dashboard-scope space-y-6">
      {/* ── Header band ─────────────────────────────────────────── */}
      <div {...enter(0)} className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-primary">
            {d?.production.name ?? meta.name}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {d?.production.dates ?? meta.dates} · {d?.production.unit ?? meta.unit} ·{" "}
            {t("dash.weekOf", {
              current: d?.production.currentWeek ?? meta.currentWeek,
              total: d?.production.totalWeeks ?? meta.totalWeeks,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {list.length > 0 && (
            <select
              value={effectiveId ?? ""}
              onChange={(e) => setSelectedId(e.target.value || null)}
              aria-label={t("dash.production")}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-secondary outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <DashboardControls />
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-2 hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="size-3.5" aria-hidden="true" />
            {t("dash.exportPdf")}
          </button>
        </div>
      </div>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div {...enter(1)}>
        <HeroBudget
          totalBudget={d?.totalBudget ?? 0}
          spent={d?.spent ?? 0}
          committed={d?.committed ?? 0}
          paid={d?.paid ?? 0}
          remaining={d?.remaining ?? 0}
          loading={loading}
        />
      </div>

      {/* ── Trajectory + composition ────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div {...enter(2)} className="lg:col-span-3">
          <SpendTrajectory
            data={trajectory}
            totalBudget={d?.totalBudget ?? 0}
            crossoverWeek={d?.crossoverWeek ?? null}
            loading={loading}
            fetching={isFetching}
          />
        </div>
        <div {...enter(3)} className="lg:col-span-2">
          <TopSheetDonut data={d?.topSheet ?? []} loading={loading} fetching={isFetching} />
        </div>
      </div>

      {/* ── Utilization + cash ──────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div {...enter(4)}>
          <DepartmentUtilization
            departments={d?.departments ?? []}
            loading={loading}
            fetching={isFetching}
          />
        </div>
        <div {...enter(5)}>
          <CashPosition data={d?.cash ?? []} loading={loading} fetching={isFetching} />
        </div>
      </div>

      {/* ── KPI strip ───────────────────────────────────────────── */}
      <div {...enter(6)} className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {!d ? (
          <>
            {tileSkeleton}
            {tileSkeleton}
            {tileSkeleton}
            {tileSkeleton}
          </>
        ) : (
          <>
            <StatTile
              label={t("dash.totalVsActual")}
              value={money(d.spent)}
              delta={
                // No plan-to-date → no delta. A fake "0.0% vs. plan" is
                // worse than a blank.
                d.varianceVsPlanPct == null
                  ? null
                  : {
                      value: d.varianceVsPlanPct,
                      period: t("dash.vsPlan"),
                      goodWhenUp: false,
                    }
              }
              spark={d.sparkline}
              sparkTone={(d.varianceVsPlanPct ?? 0) <= 0 ? "good" : "critical"}
            />
            <StatTile
              label={t("dash.remainingFunds")}
              value={money(d.remaining)}
              sublabel={t("dash.runway", { weeks: d.runwayWeeks })}
            />
            <StatTile
              label={t("dash.qfeQualifying")}
              value={money(d.qfe.qualifying)}
              sublabel={
                <span className="inline-flex items-center gap-1">
                  {`${formatPercentAdaptive(safeDivide(d.qfe.qualifying, d.qfe.totalSpend) * 100)} ${t("dash.ofTotalSpend")} · ${t("dash.estRebate")} ${money(d.qfe.estimatedRebate)}`}
                  <span title={t("dash.qfeInfo")} className="inline-flex cursor-help">
                    <Info className="size-3.5" aria-hidden="true" />
                  </span>
                </span>
              }
            />
            <StatTile
              label={t("dash.weeklyBurnRate")}
              value={money(d.weeklyBurn)}
              delta={
                // <2 weeks of trailing burn data → no delta, never a fake 0.0%.
                d.weeklyBurnDeltaPct == null
                  ? null
                  : {
                      value: d.weeklyBurnDeltaPct,
                      period: t("dash.vsFourWeekAvg"),
                      goodWhenUp: false,
                    }
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
