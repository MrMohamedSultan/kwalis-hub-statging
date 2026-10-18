// =====================================================================
// Executive dashboard data hook.
//
// Always live: queries Supabase and NEVER falls back to a fixture —
// empty budgets render honest zero states. An optional ISO date range
// filters payments by their effective date (executed_at ?? payment_date).
//
// Live financials (Total Budget / Actual Spend / Committed / Paid /
// Remaining) come from fetchRealFinancials(), which reads the database's
// shared definition layer (v_project_position / v_budget_code_position):
// actual = incurred, committed = issued-not-consumed, paid = cash out.
// Every chart slice (top sheet, departments, trajectory) is derived
// through real-slices.ts, shared with the operational view.
//
// Performance: the heavy five-table aggregate is fetched once through
// the shared realFinancialsQueryOptions cache (also used by the
// operational dashboard), and ALL derivation math (buildReal and
// friends) runs inside useMemo — arrays are only rebuilt when the
// underlying query data actually changes, never on re-render.
// =====================================================================
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getBudgetCatalog } from "@/lib/master-budget-catalog";
import { safeDivide, safeNumber } from "@/lib/safe";
import { inDateRange } from "./date-range";
import {
  emptyRealFinancials,
  lineTotalSar,
  realFinancialsQueryOptions,
  type RealFinancials,
} from "./real-financials";
import {
  TRAJECTORY_WEEKS,
  buildDepartments,
  buildTopSheet,
  buildTrajectory,
  departmentLabeler,
} from "./real-slices";
import { MOCK_EXECUTIVE, type ExecutiveDashboardData, type ProductionMeta } from "./mock-data";

/** Dated incurred-actual row from v_ledger_transactions — the doctrine
 *  series behind the spend trajectory (NOT payment requests). */
interface LedgerActualRow {
  entry_date: string | null;
  amount: number | null;
}

interface ExecutiveLists {
  actuals: LedgerActualRow[];
  deptName: (code: string) => string;
}

const REBATE_RATE = 0.35;

function buildReal(
  fin: RealFinancials,
  actuals: LedgerActualRow[],
  meta: ProductionMeta,
  deptName: (code: string) => string,
): ExecutiveDashboardData {
  const { totalBudget, fxRate } = fin;

  // Top sheet + departments — shared builders, identical to the
  // operational dashboard (departments include payroll commitments).
  const topSheet = buildTopSheet(fin);
  const departments = buildDepartments(fin, deptName);

  // KPIs — straight from the shared doctrine layer (v_project_position).
  // Full precision is preserved — rounding is a presentation decision.
  const spent = fin.actualSpend;
  const committed = fin.committed;
  const paid = fin.paid;
  const remaining = fin.remaining;

  // Trajectory — planned S-curve + cumulative INCURRED ACTUALS by week
  // (v_ledger_transactions entry_date). Same series as the operational
  // dashboard — one definition, one chart.
  const dated = actuals
    .map((p) => ({ at: p.entry_date, amount: safeNumber(p.amount) }))
    .filter((p): p is { at: string; amount: number } => !!p.at);
  const traj = buildTrajectory(dated, totalBudget);
  const currentWeek = traj.currentWeek;
  const weeklyBurn = traj.weeklyBurn || safeDivide(spent, Math.max(1, currentWeek));
  const trailingBurn = traj.trailingBurn || weeklyBurn;
  const planToDate = traj.planToDate;

  const qualifying = fin.lines
    .filter((l) => l.rebate_eligible)
    .reduce((s, l) => s + lineTotalSar(l, fxRate), 0);

  return {
    production: {
      ...meta,
      currentWeek: currentWeek || meta.currentWeek,
      totalWeeks: TRAJECTORY_WEEKS,
    },
    totalBudget,
    spent,
    committed,
    paid,
    remaining,
    planToDate: Math.round(planToDate),
    // No plan-to-date (no dated actuals yet) → NULL, never a fake 0.0%.
    varianceVsPlanPct: planToDate > 0 ? (safeDivide(spent, planToDate) - 1) * 100 : null,
    trajectory: traj.trajectory,
    crossoverWeek: traj.crossoverWeek,
    topSheet,
    departments,
    cash: [],
    qfe: {
      qualifying: Math.round(qualifying),
      totalSpend: Math.round(spent),
      rebateRate: REBATE_RATE,
      estimatedRebate: Math.round(qualifying * REBATE_RATE),
    },
    weeklyBurn: Math.round(weeklyBurn),
    // Needs ≥2 trailing weeks to be a real comparison — otherwise NULL.
    weeklyBurnDeltaPct:
      weeklyBurn > 0 && traj.trailingBurnWeeks >= 2
        ? (safeDivide(weeklyBurn, trailingBurn) - 1) * 100
        : null,
    runwayWeeks: weeklyBurn > 0 ? Math.round(safeDivide(remaining, weeklyBurn) * 10) / 10 : 0,
    sparkline: traj.sparkline,
    isMock: false,
  };
}

export interface DashboardQueryOptions {
  /** ISO "yyyy-MM-dd" bounds — null means unbounded. */
  from: string | null;
  to: string | null;
}

export function useExecutiveDashboard(
  projectId: string | null,
  meta: Partial<ProductionMeta> | null | undefined,
  opts: DashboardQueryOptions,
) {
  const { from, to } = opts;

  // Shared engine query — one cache entry for both dashboards.
  const finQuery = useQuery(realFinancialsQueryOptions(projectId, { from, to }));

  // Trajectory payments + department labeler — separate cache entry so
  // the heavy financial aggregate is never re-pulled when only these
  // change.
  const listsQuery = useQuery({
    queryKey: ["executive-dashboard-lists", projectId, from, to] as const,
    enabled: !!projectId,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<ExecutiveLists> => {
      const [actualsRes, catalog] = await Promise.all([
        // Trajectory series = dated incurred actuals from the doctrine
        // ledger — NOT payment requests (those are approvals, not spend).
        (supabase.from as any)("v_ledger_transactions")
          .select("entry_date, amount")
          .eq("project_id", projectId!)
          .eq("entry_kind", "actual")
          .order("entry_date", { ascending: true }),
        // Session-cached master budget catalog (1,712 codes) — resolves raw
        // header codes (2103, 2602…) to readable department names.
        getBudgetCatalog(),
      ]);

      // Date range filter — applied to the entry's effective date.
      const actuals = ((actualsRes.data ?? []) as LedgerActualRow[]).filter((p) =>
        inDateRange(p.entry_date, from, to),
      );

      return { actuals, deptName: departmentLabeler(catalog) };
    },
  });

  // Heavy derivation — memoized on the raw query data. Re-renders are
  // free; arrays are only rebuilt when the source data actually changes.
  const data = useMemo<ExecutiveDashboardData>(() => {
    const fallbackMeta: ProductionMeta = {
      ...MOCK_EXECUTIVE.production,
      ...(meta ?? {}),
      id: projectId,
    };
    if (!projectId) return buildReal(emptyRealFinancials(), [], fallbackMeta, (code) => code);
    // Error paths leave query data undefined → render honest zeros, never mock.
    const fin = finQuery.data ?? emptyRealFinancials();
    return buildReal(
      fin,
      listsQuery.data?.actuals ?? [],
      fallbackMeta,
      listsQuery.data?.deptName ?? ((code) => code),
    );
  }, [projectId, meta, finQuery.data, listsQuery.data]);

  return {
    data,
    isLoading: finQuery.isPending || (!!projectId && listsQuery.isPending),
    isFetching: finQuery.isFetching || listsQuery.isFetching,
  };
}
