// =====================================================================
// real-slices.ts — shared live-data derivations for BOTH dashboards.
//
// Pure builders over RealFinancials + dated payments: top-sheet rollup,
// department allocation (with per-department commitments), and the
// planned-vs-actual spend trajectory. One source of truth so the
// executive and operational dashboards can never drift apart.
// =====================================================================
import { safeNumber } from "@/lib/safe";
import type { BudgetCatalogEntry } from "@/lib/master-budget-catalog";
import { lineTotalSar, type RealFinancials } from "./real-financials";
import type {
  DepartmentUtil,
  SpendByDepartment,
  TopSheetCategory,
  TopSheetKey,
  TrajectoryPoint,
} from "./mock-data";

/** Readable fallbacks when a budget line's header_code is a legacy group label. */
const GROUP_LABELS: Record<string, string> = {
  atl: "ATL",
  btl: "BTL",
  post: "Post",
  other: "Other",
  ops: "Ops",
};

/**
 * Code → human label resolver shared by both dashboards. Prefers the
 * catalog `description` (the real header/line title, e.g. "EDITORIAL" for
 * 5000) over `name` (section name for headers), then group labels, then the
 * raw code as a last resort.
 */
export function departmentLabeler(catalog: BudgetCatalogEntry[]): (code: string) => string {
  const byCode = new Map(catalog.map((c) => [c.code, c.description?.trim() || c.name]));
  return (code) => byCode.get(code) ?? GROUP_LABELS[code.trim().toLowerCase()] ?? code;
}

export const TRAJECTORY_WEEKS = 26;

const TOP_SHEET_ORDER: TopSheetKey[] = ["atl", "btl", "post", "ops"];

function topSheetKey(group: string): TopSheetKey {
  const g = (group || "").toLowerCase();
  if (g === "atl") return "atl";
  if (g === "btl") return "btl";
  if (g === "post") return "post";
  return "ops";
}

/** Top Sheet — fixed conventional order, budget by line group. */
export function buildTopSheet(fin: RealFinancials): TopSheetCategory[] {
  const totals: Record<TopSheetKey, number> = { atl: 0, btl: 0, post: 0, ops: 0 };
  for (const l of fin.lines) totals[topSheetKey(l.group ?? "")] += lineTotalSar(l, fin.fxRate);
  return TOP_SHEET_ORDER.map((key) => ({ key, amount: Math.round(totals[key]) }));
}

/**
 * Departments — budget grouped by header code, top 10. Actuals and
 * commitments come from the code-level position view
 * (v_budget_code_position), aggregated code → header: budget is built by
 * LINE, money is reported by account CODE, and Σ per header ≡ the
 * project rollup by construction.
 */
export function buildDepartments(
  fin: RealFinancials,
  deptName: (code: string) => string,
): DepartmentUtil[] {
  const byHeader = new Map<string, number>();
  for (const l of fin.lines) {
    const key = l.header_code || "—";
    byHeader.set(key, (byHeader.get(key) ?? 0) + lineTotalSar(l, fin.fxRate));
  }
  return [...byHeader.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([code, budget]) => ({
      id: code,
      name: deptName(code),
      budget: Math.round(budget),
      actual: Math.round(fin.actualByHeader[code] ?? 0),
      committed: Math.round(fin.committedByHeader[code] ?? 0),
    }));
}

/** Budget allocation by department — top 8 by budget (not spend). */
export function buildSpendAllocation(departments: DepartmentUtil[]): SpendByDepartment[] {
  return departments.slice(0, 8).map((d) => ({ name: d.name, value: d.budget }));
}

/** Normalised logistic S-curve: planned(0) ≈ 0, planned(weeks) = total. */
export function plannedAt(week: number, total: number, weeks: number): number {
  const mid = weeks * 0.65;
  const k = weeks / 6.5;
  const logistic = (w: number) => 1 / (1 + Math.exp(-(w - mid) / k));
  const l0 = logistic(0);
  const lN = logistic(weeks);
  return total * ((logistic(week) - l0) / (lN - l0));
}

export interface DatedActual {
  at: string;
  amount: number;
}

export interface TrajectorySlice {
  trajectory: TrajectoryPoint[];
  currentWeek: number;
  crossoverWeek: number | null;
  planToDate: number;
  weeklyBurn: number;
  trailingBurn: number;
  /** Weeks in the trailing burn window — <2 means the "vs 4-week avg"
   *  delta has no basis and must be hidden, not rendered as 0.0%. */
  trailingBurnWeeks: number;
  /** Last 12 weekly cumulative actuals — KPI sparkline. */
  sparkline: number[];
}

/**
 * Planned S-curve + cumulative INCURRED ACTUALS bucketed by week
 * (v_ledger_transactions, entry_kind='actual' — the doctrine series).
 * A single dated actual already renders one honest point. Cumulative
 * values keep full precision — per-week rounding would drift the
 * endpoint away from the position views by sub-SAR amounts.
 */
export function buildTrajectory(datedActuals: DatedActual[], totalBudget: number): TrajectorySlice {
  const dated = [...datedActuals].sort((a, b) => a.at.localeCompare(b.at));

  let currentWeek = 0;
  const weeklyActual: (number | null)[] = [];
  if (dated.length >= 1) {
    const start = new Date(dated[0].at).getTime();
    const end = new Date(dated[dated.length - 1].at).getTime();
    currentWeek = Math.min(
      TRAJECTORY_WEEKS,
      Math.max(1, Math.ceil((end - start) / (7 * 24 * 3600 * 1000)) + 1),
    );
    let cumulative = 0;
    let idx = 0;
    for (let w = 1; w <= TRAJECTORY_WEEKS; w++) {
      if (w <= currentWeek) {
        const weekEnd = start + w * 7 * 24 * 3600 * 1000;
        while (idx < dated.length && new Date(dated[idx].at).getTime() <= weekEnd) {
          cumulative += dated[idx].amount;
          idx++;
        }
        weeklyActual.push(cumulative);
      } else {
        weeklyActual.push(null);
      }
    }
  } else {
    for (let w = 1; w <= TRAJECTORY_WEEKS; w++) weeklyActual.push(null);
  }

  const trajectory: TrajectoryPoint[] = Array.from({ length: TRAJECTORY_WEEKS }, (_, i) => ({
    week: i + 1,
    planned: Math.round(plannedAt(i + 1, totalBudget, TRAJECTORY_WEEKS)),
    actual: weeklyActual[i],
  }));

  // First week actual crosses above planned and never comes back.
  let crossoverWeek: number | null = null;
  for (let w = 1; w <= currentWeek; w++) {
    const rest = trajectory.slice(w - 1, currentWeek);
    if (rest.length > 0 && rest.every((p) => (p.actual ?? 0) > p.planned)) {
      if ((trajectory[w - 1].actual ?? 0) > trajectory[w - 1].planned) {
        crossoverWeek = w;
        break;
      }
    }
  }

  const planToDate = currentWeek > 0 ? (trajectory[currentWeek - 1]?.planned ?? 0) : 0;
  const actuals = trajectory.filter((p) => p.actual != null).map((p) => safeNumber(p.actual));
  const burnWindow = actuals.slice(-4);
  const trailingWindow = actuals.slice(-8, -4);
  const weeklyBurn =
    burnWindow.length >= 2
      ? (burnWindow[burnWindow.length - 1] - burnWindow[0]) / (burnWindow.length - 1)
      : 0;
  const trailingBurn =
    trailingWindow.length >= 2
      ? (trailingWindow[trailingWindow.length - 1] - trailingWindow[0]) /
        (trailingWindow.length - 1)
      : weeklyBurn;

  return {
    trajectory,
    currentWeek,
    crossoverWeek,
    planToDate,
    weeklyBurn,
    trailingBurn,
    trailingBurnWeeks: trailingWindow.length,
    sparkline: actuals.slice(-12),
  };
}
