// =====================================================================
// PerformanceOverview — the board / CFO read of a project, at the top of
// the dashboard (client brief: "an executive should read the whole project
// from this screen").
//
//   Verdict      Are we over budget?  (EFC vs approved budget, headroom)
//   EFC          estimated final cost + variance       ← get_cost_report
//   Paid         cash settled to date
//   Budget       approved (active) budget
//   Remaining    budget − actual − commitment (glossary), one stacked bar
//   Timeline     production days: total / elapsed / remaining
//   By section   budget vs committed vs actual per Top Sheet section
//
// Figures come from the same doctrine layer as the rest of the dashboard
// (KPIs) plus the Cost Report RPC for EFC and the per-section split.
// =====================================================================
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarDays, CheckCircle2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n/useI18n";
import { useDashboardCurrency } from "@/lib/dashboard/currency";
import { formatCompactAxis, formatCurrency } from "@/lib/format";
import { getChartColors } from "@/lib/chart-theme";
import { safeNumber } from "@/lib/safe";
import type { OperationalKpis } from "@/lib/dashboard/mock-data";
import { ChartCard } from "@/components/charts/ChartCard";
import { ChartTooltip } from "@/components/charts/ChartTooltip";

type CostRow = {
  group: string | null;
  estimate: number;
  actual: number;
  committed: number;
  efc: number;
};

type ProjectDates = {
  start_date: string | null;
  end_date: string | null;
  prep_days: number | null;
  shoot_days: number | null;
};

const SECTION_ORDER = ["ATL", "Production", "BTL", "Post", "Other", "Adjustments"];

function useCostReport(projectId: string | null) {
  return useQuery({
    queryKey: ["perf-overview", "cost-report", projectId],
    enabled: !!projectId,
    staleTime: 60_000,
    queryFn: async (): Promise<CostRow[]> => {
      const { data, error } = await (supabase as any).rpc("get_cost_report", {
        p_project_id: projectId,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        group: r.group ?? null,
        estimate: safeNumber(r.estimate),
        actual: safeNumber(r.actual),
        committed: safeNumber(r.committed),
        efc: safeNumber(r.efc),
      }));
    },
  });
}

function useProjectDates(projectId: string | null) {
  return useQuery({
    queryKey: ["perf-overview", "dates", projectId],
    enabled: !!projectId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ProjectDates | null> => {
      const { data } = await supabase
        .from("projects")
        .select("start_date, end_date, prep_days, shoot_days")
        .eq("id", projectId!)
        .maybeSingle();
      return (data as ProjectDates | null) ?? null;
    },
  });
}

const DAY = 86_400_000;

export function PerformanceOverview({
  projectId,
  kpis,
  loading,
}: {
  projectId: string | null;
  kpis: OperationalKpis | null;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const { isRtl } = useI18n();
  const { code, convert } = useDashboardCurrency();
  const colors = getChartColors();
  const cost = useCostReport(projectId);
  const dates = useProjectDates(projectId);

  const money = (v: number, compact = false) =>
    formatCurrency(convert(v), { currency: code, compact, decimals: compact ? undefined : 0 });

  const budget = kpis?.totalBudget ?? 0;
  const actual = kpis?.actualSpend ?? 0;
  const committed = kpis?.committed ?? 0;
  const paid = kpis?.paid ?? 0;
  const available = budget - actual - committed;

  // EFC from the Cost Report; before any ETC is entered it equals actual +
  // committed + remaining budget per code, i.e. the budget itself.
  const efc = useMemo(
    () => (cost.data && cost.data.length ? cost.data.reduce((s, r) => s + r.efc, 0) : budget),
    [cost.data, budget],
  );
  const variance = budget - efc; // glossary Variance: + saving / − overrun
  const over = variance < -0.5;
  // B18: "headroom" is the Remaining Budget (Budget − Actual − Commitment).
  // With the default ETC (= Remaining) EFC equals the budget, so Variance is 0
  // by definition and was the wrong figure to show as headroom.
  const headroom = over ? Math.abs(variance) : Math.max(available, 0);

  const sections = useMemo(() => {
    const m = new Map<
      string,
      { section: string; budget: number; committed: number; actual: number }
    >();
    for (const r of cost.data ?? []) {
      const key = r.group || "Other";
      const s = m.get(key) ?? { section: key, budget: 0, committed: 0, actual: 0 };
      s.budget += r.estimate;
      s.committed += r.committed;
      s.actual += r.actual;
      m.set(key, s);
    }
    return [...m.values()]
      .filter((s) => s.budget || s.actual || s.committed)
      .sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section))
      .map((s) => ({
        ...s,
        label: t(`perf.section.${s.section}`, s.section),
        budgetC: Math.round(convert(s.budget)),
        committedC: Math.round(convert(s.committed)),
        actualC: Math.round(convert(s.actual)),
      }));
  }, [cost.data, convert, t]);

  const timeline = useMemo(() => {
    const d = dates.data;
    const start = d?.start_date ? new Date(d.start_date).getTime() : null;
    const end = d?.end_date ? new Date(d.end_date).getTime() : null;
    if (!start || !end || end <= start) return null;
    const total = Math.round((end - start) / DAY) + 1;
    const now = Date.now();
    const elapsed = Math.min(total, Math.max(0, Math.floor((now - start) / DAY) + 1));
    return {
      start: d!.start_date!,
      end: d!.end_date!,
      total,
      elapsed: now < start ? 0 : elapsed,
      remaining: Math.max(0, total - (now < start ? 0 : elapsed)),
      pct: now < start ? 0 : Math.min(100, (elapsed / total) * 100),
      prep: d?.prep_days ?? null,
      shoot: d?.shoot_days ?? null,
    };
  }, [dates.data]);

  if (loading || !kpis) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[132px] animate-pulse rounded-xl border border-border bg-surface"
          />
        ))}
      </div>
    );
  }

  const pct = (v: number) => (budget > 0 ? (v / budget) * 100 : 0);
  const usedPct = Math.min(100, pct(actual));
  const committedPct = Math.min(100 - usedPct, pct(committed));

  return (
    <section aria-label={t("perf.title")} className="space-y-4">
      {/* ── Headline cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div
          className={`flex flex-col justify-between rounded-xl border p-5 ${
            over
              ? "border-status-critical/40 bg-status-critical/5"
              : "border-status-good/30 bg-status-good/5"
          }`}
        >
          <div className="text-xs font-medium text-ink-muted">{t("perf.overBudgetQ")}</div>
          <div
            className={`mt-2 flex items-center gap-2 text-3xl font-bold tracking-tight ${
              over ? "text-status-critical" : "text-status-good"
            }`}
          >
            {over ? <AlertTriangle className="size-7" /> : <CheckCircle2 className="size-7" />}
            {over ? t("perf.yes") : t("perf.no")}
          </div>
          <div className="mt-3 text-xs text-ink-muted">
            {over ? t("perf.overBy") : t("glossary.dash.headroom")}{" "}
            <span className="font-semibold text-ink-primary" dir="ltr">
              {money(headroom)}
            </span>
          </div>
        </div>
        <Headline
          label={t("glossary.term.efc")}
          value={money(efc)}
          sub={
            <>
              {t("glossary.term.variance")}{" "}
              <span
                dir="ltr"
                className={`font-semibold ${over ? "text-status-critical" : "text-status-good"}`}
              >
                {variance >= 0 ? "+" : "−"}
                {money(Math.abs(variance))}
              </span>
            </>
          }
        />
        <Headline
          label={t("glossary.term.paid")}
          value={money(paid)}
          sub={t("glossary.dash.paidSub", {
            pct: (actual > 0 ? (paid / actual) * 100 : 0).toFixed(1),
            payable: money(Math.max(actual - paid, 0)),
          })}
        />
        <Headline label={t("perf.budget")} value={money(budget)} sub={t("perf.budgetSub")} />
      </div>

      {/* ── Available for new commitments ───────────────────────────── */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-xs font-medium text-ink-muted">{t("glossary.term.remaining")}</div>
          <div
            className={`text-2xl font-semibold tracking-tight ${available < 0 ? "text-status-critical" : "text-ink-primary"}`}
          >
            <span dir="ltr">{money(available)}</span>
          </div>
        </div>
        <div
          className="mt-3 flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-muted/50"
          role="img"
          aria-label={t("perf.availableBarLabel", {
            actual: pct(actual).toFixed(1),
            committed: pct(committed).toFixed(1),
          })}
        >
          {usedPct > 0 && (
            <div
              className="h-full rounded-s-full"
              style={{ width: `${usedPct}%`, background: colors.data1 }}
            />
          )}
          {committedPct > 0 && (
            <div
              className="h-full"
              style={{ width: `${committedPct}%`, background: colors.data3 }}
            />
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-secondary">
          <Legend2
            color={colors.data1}
            label={t("glossary.term.actual")}
            value={`${pct(actual).toFixed(1)}%`}
          />
          <Legend2
            color={colors.data3}
            label={t("glossary.term.commitment")}
            value={`${pct(committed).toFixed(1)}%`}
          />
          <Legend2
            color="var(--muted)"
            label={t("glossary.term.remaining")}
            value={`${Math.max(0, pct(available)).toFixed(1)}%`}
          />
        </div>
      </div>

      {/* ── Timeline + by-section chart ─────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
            <CalendarDays className="size-4 text-ink-muted" />
            {t("perf.timeline")}
          </div>
          {timeline ? (
            <div className="mt-4 space-y-3 text-sm">
              <Row label={t("perf.totalDays")} value={timeline.total} />
              <Row label={t("perf.elapsedDays")} value={timeline.elapsed} />
              <Row label={t("perf.remainingDays")} value={timeline.remaining} />
              {timeline.prep != null && <Row label={t("perf.prepDays")} value={timeline.prep} />}
              {timeline.shoot != null && <Row label={t("perf.shootDays")} value={timeline.shoot} />}
              <div>
                <div className="mb-1 flex justify-between text-xs text-ink-muted">
                  <span dir="ltr">{timeline.start}</span>
                  <span>{timeline.pct.toFixed(0)}%</span>
                  <span dir="ltr">{timeline.end}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted/50">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${timeline.pct}%`, background: colors.data1 }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-xs text-ink-muted">{t("perf.noDates")}</p>
          )}
        </div>

        <div className="lg:col-span-2">
          <ChartCard
            title={t("perf.bySection")}
            subtitle={t("perf.bySectionSub")}
            height="h-[280px]"
            loading={cost.isLoading}
            fetching={cost.isFetching}
            isEmpty={sections.length === 0}
            emptyMessage={t("perf.noSections")}
            table={{
              caption: t("perf.bySection"),
              columns: [
                { key: "label", label: t("perf.sectionCol") },
                {
                  key: "budgetC",
                  label: t("perf.budget"),
                  align: "end",
                  numeric: true,
                  format: (r) =>
                    formatCurrency(safeNumber(r.budgetC), { currency: code, decimals: 0 }),
                },
                {
                  key: "committedC",
                  label: t("glossary.term.commitment"),
                  align: "end",
                  numeric: true,
                  format: (r) =>
                    formatCurrency(safeNumber(r.committedC), { currency: code, decimals: 0 }),
                },
                {
                  key: "actualC",
                  label: t("glossary.term.actual"),
                  align: "end",
                  numeric: true,
                  format: (r) =>
                    formatCurrency(safeNumber(r.actualC), { currency: code, decimals: 0 }),
                },
              ],
              rows: sections,
            }}
          >
            <div dir="ltr" className="h-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sections}
                  margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                  barGap={2}
                >
                  <CartesianGrid stroke={colors.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    reversed={isRtl}
                    tick={{ fill: colors.inkMuted, fontSize: 11, fontWeight: 500 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={56}
                    orientation={isRtl ? "right" : "left"}
                    tick={{ fill: colors.inkMuted, fontSize: 11, fontWeight: 500 }}
                    tickFormatter={(v) => formatCompactAxis(safeNumber(v))}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatValue={(v) => formatCurrency(v, { currency: code, decimals: 0 })}
                      />
                    }
                    cursor={{ fill: colors.grid, opacity: 0.4 }}
                  />
                  <Legend
                    iconType="square"
                    iconSize={10}
                    wrapperStyle={{ fontSize: 11, color: colors.inkSecondary }}
                  />
                  <Bar
                    dataKey="budgetC"
                    name={t("perf.budget")}
                    fill={colors.data2}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="committedC"
                    name={t("glossary.term.commitment")}
                    fill={colors.data3}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="actualC"
                    name={t("glossary.term.actual")}
                    fill={colors.data1}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      </div>
    </section>
  );
}

function Headline({ label, value, sub }: { label: string; value: string; sub: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-border bg-surface p-5">
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink-primary">
        <span dir="ltr">{value}</span>
      </div>
      <div className="mt-3 text-xs text-ink-muted">{sub}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-secondary">{label}</span>
      <span className="font-semibold tabular-nums text-ink-primary">{value}</span>
    </div>
  );
}

function Legend2({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: color }} />
      {label} <span className="font-semibold text-ink-primary tabular-nums">{value}</span>
    </span>
  );
}
