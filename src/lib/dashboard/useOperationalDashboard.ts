// =====================================================================
// Operational dashboard data hook.
//
// Always live: queries Supabase and NEVER falls back to a fixture —
// empty budgets render honest zero states. An optional ISO date range
// filters payment requests by their relevant timestamp per section.
//
// Live financials (Total Budget / Actual Spend / Committed / Paid /
// Remaining) come from fetchRealFinancials(), which reads the database's
// shared definition layer (v_project_position / v_budget_code_position):
// actual = incurred, committed = issued-not-consumed, paid = cash out.
// Every chart slice (top sheet, departments, trajectory) is derived
// through real-slices.ts, the same builders the executive dashboard uses.
//
// Performance: the heavy five-table aggregate is fetched once through
// the shared realFinancialsQueryOptions cache (also used by the
// executive dashboard), and ALL derivation math (buildReal and friends)
// runs inside useMemo — arrays are only rebuilt when the underlying
// query data actually changes, never on re-render.
// =====================================================================
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getBudgetCatalog } from "@/lib/master-budget-catalog";
import { safeDivide, safeNumber } from "@/lib/safe";
import { inDateRange } from "./date-range";
import {
  emptyRealFinancials,
  realFinancialsQueryOptions,
  type RealFinancials,
} from "./real-financials";
import {
  TRAJECTORY_WEEKS,
  buildDepartments,
  buildSpendAllocation,
  buildTopSheet,
  buildTrajectory,
  departmentLabeler,
} from "./real-slices";
import type {
  ActivityEvent,
  ApprovalItem,
  ApprovalType,
  OperationalDashboardData,
} from "./mock-data";

interface PaymentRequestRow {
  id: string;
  source_type: string;
  source_label: string | null;
  total_amount: number;
  status: string;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Dated incurred-actual row from v_ledger_transactions — the doctrine
 *  series behind the spend trajectory (NOT payment requests). */
interface LedgerActualRow {
  entry_date: string | null;
  amount: number | null;
}

interface OperationalLists {
  pending: PaymentRequestRow[];
  recent: PaymentRequestRow[];
  actuals: LedgerActualRow[];
  deptName: (code: string) => string;
}

function approvalType(sourceType: string): ApprovalType {
  const s = (sourceType || "").toLowerCase();
  if (s.includes("invoice")) return "invoice";
  if (s.includes("po") || s.includes("purchase")) return "po";
  if (s.includes("petty") || s.includes("cash") || s.includes("float")) return "petty_cash";
  return "contract";
}

function ageDays(from: string | null): number {
  if (!from) return 0;
  const ms = Date.now() - new Date(from).getTime();
  return Math.max(0, Math.floor(ms / (24 * 3600 * 1000)));
}

function ageHours(from: string | null): number {
  if (!from) return 0;
  const ms = Date.now() - new Date(from).getTime();
  return Math.max(0, Math.round(ms / (3600 * 1000)));
}

function buildReal(
  fin: RealFinancials,
  pending: PaymentRequestRow[],
  recent: PaymentRequestRow[],
  actuals: LedgerActualRow[],
  deptName: (code: string) => string,
): OperationalDashboardData {
  // Departments (with per-department payroll commitments), allocation
  // bars and top sheet — one shared derivation with the executive view.
  const departments = buildDepartments(fin, deptName);
  const spendByDepartment = buildSpendAllocation(departments);
  const topSheet = buildTopSheet(fin);

  const approvals: ApprovalItem[] = pending.map((p) => ({
    id: p.id,
    type: approvalType(p.source_type),
    title: p.source_label || p.source_type || "—",
    vendor: null,
    submitter: null,
    amount: safeNumber(p.total_amount),
    ageDays: ageDays(p.submitted_at ?? p.created_at),
  }));

  const activity: ActivityEvent[] = recent.map((p) => ({
    id: p.id,
    actor: p.source_label || p.source_type || "—",
    action: p.status,
    amount: safeNumber(p.total_amount),
    ageHours: ageHours(p.updated_at),
  }));

  // KPIs — straight from the shared doctrine layer (v_project_position):
  // actual = incurred, committed = issued-not-consumed, paid = cash out,
  // remaining = available. Full precision is preserved here — rounding is
  // a presentation decision made by the tiles (2 decimals).
  const totalBudget = fin.totalBudget;
  const spent = fin.actualSpend;
  const committed = fin.committed;
  const paid = fin.paid;
  const remaining = fin.remaining;

  // Trajectory — planned S-curve + cumulative INCURRED ACTUALS by week
  // (v_ledger_transactions entry_date). The endpoint reconciles exactly
  // with the Actual Spend card: same source, same definition.
  const dated = actuals
    .map((p) => ({ at: p.entry_date, amount: safeNumber(p.amount) }))
    .filter((p): p is { at: string; amount: number } => !!p.at);
  const traj = buildTrajectory(dated, totalBudget);
  const currentWeek = traj.currentWeek || 1;
  const weeklyBurn = traj.weeklyBurn || safeDivide(spent, Math.max(1, traj.currentWeek));
  // No plan-to-date (no dated actuals yet) → NULL, never a fake 0.0%.
  const varianceVsPlanPct =
    traj.planToDate > 0 ? (safeDivide(spent, traj.planToDate) - 1) * 100 : null;

  return {
    currentWeek,
    totalWeeks: TRAJECTORY_WEEKS,
    kpis: {
      totalBudget,
      actualSpend: spent,
      committed,
      paid,
      remaining,
      pctSpent: safeDivide(spent, totalBudget) * 100,
      committedPct: safeDivide(committed, totalBudget) * 100,
      varianceVsPlanPct,
      runwayWeeks: weeklyBurn > 0 ? Math.round(safeDivide(remaining, weeklyBurn) * 10) / 10 : 0,
      sparkline: traj.sparkline,
    },
    approvals,
    departments,
    spendByDepartment,
    trajectory: traj.trajectory,
    crossoverWeek: traj.crossoverWeek,
    topSheet,
    activity,
    isMock: false,
  };
}

export interface DashboardQueryOptions {
  /** ISO "yyyy-MM-dd" bounds — null means unbounded. */
  from: string | null;
  to: string | null;
}

export function useOperationalDashboard(projectId: string | null, opts: DashboardQueryOptions) {
  const { from, to } = opts;

  // Shared engine query — one cache entry for both dashboards.
  const finQuery = useQuery(realFinancialsQueryOptions(projectId, { from, to }));

  // Section lists (approvals / activity / trajectory payments) — separate
  // cache entry so the heavy financial aggregate is never re-pulled when
  // only these change.
  const listsQuery = useQuery({
    queryKey: ["operational-dashboard-lists", projectId, from, to] as const,
    enabled: !!projectId,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<OperationalLists> => {
      const [pendingRes, recentRes, financialRes, catalog] = await Promise.all([
        supabase
          .from("payment_requests")
          .select(
            "id, source_type, source_label, total_amount, status, submitted_at, created_at, updated_at",
          )
          .eq("project_id", projectId!)
          .eq("status", "pending")
          .order("submitted_at", { ascending: false })
          .limit(20),
        supabase
          .from("payment_requests")
          .select(
            "id, source_type, source_label, total_amount, status, submitted_at, created_at, updated_at",
          )
          .eq("project_id", projectId!)
          .order("updated_at", { ascending: false })
          .limit(8),
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

      // Date range filter — each section uses its relevant timestamp.
      const pending = ((pendingRes.data ?? []) as PaymentRequestRow[]).filter((p) =>
        inDateRange(p.submitted_at ?? p.created_at, from, to),
      );
      const recent = ((recentRes.data ?? []) as PaymentRequestRow[]).filter((p) =>
        inDateRange(p.updated_at, from, to),
      );
      const actuals = ((financialRes.data ?? []) as LedgerActualRow[]).filter((p) =>
        inDateRange(p.entry_date, from, to),
      );

      return { pending, recent, actuals, deptName: departmentLabeler(catalog) };
    },
  });

  // Heavy derivation — memoized on the raw query data. Re-renders are
  // free; arrays are only rebuilt when the source data actually changes.
  const data = useMemo<OperationalDashboardData>(() => {
    if (!projectId) return buildReal(emptyRealFinancials(), [], [], [], (code) => code);
    // Error paths leave query data undefined → render honest zeros, never mock.
    const fin = finQuery.data ?? emptyRealFinancials();
    const lists = listsQuery.data;
    return buildReal(
      fin,
      lists?.pending ?? [],
      lists?.recent ?? [],
      lists?.actuals ?? [],
      lists?.deptName ?? ((code) => code),
    );
  }, [projectId, finQuery.data, listsQuery.data]);

  return {
    data,
    isLoading: finQuery.isPending || (!!projectId && listsQuery.isPending),
    isFetching: finQuery.isFetching || listsQuery.isFetching,
  };
}
