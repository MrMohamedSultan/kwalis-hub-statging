// =====================================================================
// Dashboard mock fixtures.
//
// Realistic, film-industry-accurate data so both dashboards render
// beautifully on first load — before any real rows exist. The hooks
// (useExecutiveDashboard / useOperationalDashboard) return these
// fixtures with `isMock: true` whenever the Supabase query errors,
// returns null, or returns an empty array. Every derived figure is
// computed from the trajectory so the fixture is internally coherent.
// =====================================================================
import { safeDivide, safeNumber } from "@/lib/safe";

/* ── Shared types ─────────────────────────────────────────────────── */

export interface TrajectoryPoint {
  week: number;
  planned: number;
  /** Null beyond the current week — the line ends cleanly. */
  actual: number | null;
}

export type TopSheetKey = "atl" | "btl" | "post" | "ops";

export interface TopSheetCategory {
  key: TopSheetKey;
  amount: number;
}

export interface DepartmentUtil {
  id: string;
  name: string;
  budget: number;
  actual: number;
  committed: number;
}

export type ApprovalType = "invoice" | "po" | "petty_cash" | "contract";

export interface ApprovalItem {
  id: string;
  type: ApprovalType;
  title: string;
  vendor: string | null;
  submitter: string | null;
  amount: number;
  ageDays: number;
}

export interface ActivityEvent {
  id: string;
  actor: string;
  action: string;
  amount: number | null;
  ageHours: number;
}

export interface CashPoint {
  label: string;
  value: number;
}

export interface ProductionMeta {
  id: string | null;
  name: string;
  unit: string;
  dates: string;
  currentWeek: number;
  totalWeeks: number;
}

export interface QfeSummary {
  qualifying: number;
  totalSpend: number;
  rebateRate: number;
  estimatedRebate: number;
}

export interface ExecutiveDashboardData {
  production: ProductionMeta;
  totalBudget: number;
  spent: number;
  committed: number;
  /** Cash paid — third doctrine dimension (actual / committed / paid). */
  paid: number;
  remaining: number;
  planToDate: number;
  /** Signed % variance of actual vs planned-to-date (+ = over plan).
   *  NULL when no plan-to-date exists — never render a fake 0.0%. */
  varianceVsPlanPct: number | null;
  trajectory: TrajectoryPoint[];
  /** First week actual crosses above planned and stays there. */
  crossoverWeek: number | null;
  topSheet: TopSheetCategory[];
  departments: DepartmentUtil[];
  cash: CashPoint[];
  qfe: QfeSummary;
  weeklyBurn: number;
  /** Signed % vs the trailing 4-week average burn. NULL when the trailing
   *  window has <2 weeks of data — never render a fake 0.0%. */
  weeklyBurnDeltaPct: number | null;
  runwayWeeks: number;
  /** Last 12 weekly cumulative actuals — KPI sparkline. */
  sparkline: number[];
  isMock: boolean;
}

export interface SpendByDepartment {
  name: string;
  value: number;
}

export interface OperationalKpis {
  totalBudget: number;
  actualSpend: number;
  committed: number;
  /** Cash paid — third doctrine dimension (actual / committed / paid). */
  paid: number;
  remaining: number;
  /** actualSpend / totalBudget × 100. */
  pctSpent: number;
  /** committed / totalBudget × 100. */
  committedPct: number;
  /** Signed % variance of actual vs planned-to-date (+ = over plan).
   *  NULL when no plan-to-date exists — never render a fake 0.0%. */
  varianceVsPlanPct: number | null;
  runwayWeeks: number;
  /** Last 12 cumulative actuals — KPI sparkline. */
  sparkline: number[];
}

export interface OperationalDashboardData {
  currentWeek: number;
  totalWeeks: number;
  kpis: OperationalKpis;
  approvals: ApprovalItem[];
  departments: DepartmentUtil[];
  spendByDepartment: SpendByDepartment[];
  /** Planned vs actual cumulative spend — shared with the executive view. */
  trajectory: TrajectoryPoint[];
  /** First week actual crosses above planned and stays there. */
  crossoverWeek: number | null;
  topSheet: TopSheetCategory[];
  activity: ActivityEvent[];
  isMock: boolean;
}

/* ── Fixture constants ────────────────────────────────────────────── */

const TOTAL_BUDGET = 48_500_000;
const TOTAL_WEEKS = 26;
const CURRENT_WEEK = 18;
const COMMITTED = 5_400_000;
const CROSSOVER_WEEK = 15;

/** Normalised logistic S-curve: planned(0) ≈ 0, planned(26) = total. */
function plannedAt(week: number, total: number, weeks: number): number {
  const mid = 17;
  const k = 4;
  const logistic = (w: number) => 1 / (1 + Math.exp(-(w - mid) / k));
  const l0 = logistic(0);
  const lN = logistic(weeks);
  return total * ((logistic(week) - l0) / (lN - l0));
}

function buildMockTrajectory(): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [];
  for (let w = 1; w <= TOTAL_WEEKS; w++) {
    const planned = plannedAt(w, TOTAL_BUDGET, TOTAL_WEEKS);
    let actual: number | null = null;
    if (w <= 14) {
      // Tracks the plan closely (±2%) for the first 14 weeks.
      actual = planned * (1 + 0.018 * Math.sin(w * 1.9));
    } else if (w <= CURRENT_WEEK) {
      // Weeks 15–18: spend blows through the total budget and lands at
      // 120% — the fixture exercises the over-budget alert UI.
      const start = plannedAt(14, TOTAL_BUDGET, TOTAL_WEEKS);
      const target = TOTAL_BUDGET * 1.2;
      actual = start + ((target - start) * (w - 14)) / (CURRENT_WEEK - 14);
    }
    points.push({
      week: w,
      planned: Math.round(planned),
      actual: actual == null ? null : Math.round(actual),
    });
  }
  return points;
}

const trajectory = buildMockTrajectory();
const lastActual = [...trajectory].reverse().find((p) => p.actual != null)?.actual ?? 0;
const SPENT = lastActual;
const PLAN_TO_DATE = trajectory[CURRENT_WEEK - 1]?.planned ?? 0;
const REMAINING = TOTAL_BUDGET - SPENT - COMMITTED;
const PAID = Math.round(SPENT * 0.75);

/** Weekly burn = mean of the last 4 weekly actual deltas. */
function weeklyDeltaAvg(points: TrajectoryPoint[], endWeek: number, span: number): number {
  let sum = 0;
  let count = 0;
  for (let w = endWeek; w > endWeek - span; w--) {
    const cur = points[w - 1]?.actual;
    const prev = points[w - 2]?.actual;
    if (cur != null && prev != null) {
      sum += cur - prev;
      count++;
    }
  }
  return safeDivide(sum, count);
}

const WEEKLY_BURN = weeklyDeltaAvg(trajectory, CURRENT_WEEK, 4);
const TRAILING_BURN = weeklyDeltaAvg(trajectory, CURRENT_WEEK - 4, 4);

export const MOCK_PRODUCTION: ProductionMeta = {
  id: null,
  name: "Untitled Feature — Riyadh Unit",
  unit: "Riyadh Unit",
  dates: "Mar 2026 – Feb 2027",
  currentWeek: CURRENT_WEEK,
  totalWeeks: TOTAL_WEEKS,
};

export const MOCK_TOP_SHEET: TopSheetCategory[] = [
  { key: "atl", amount: 11_200_000 },
  { key: "btl", amount: 21_400_000 },
  { key: "post", amount: 8_900_000 },
  { key: "ops", amount: 4_100_000 },
];

export const MOCK_DEPARTMENTS: DepartmentUtil[] = [
  { id: "art", name: "Art Department", budget: 3_900_000, actual: 4_680_000, committed: 120_000 },
  { id: "locations", name: "Locations", budget: 2_800_000, actual: 2_632_000, committed: 90_000 },
  { id: "stunts", name: "Stunts", budget: 1_500_000, actual: 1_245_000, committed: 150_000 },
  { id: "transport", name: "Transport", budget: 1_600_000, actual: 1_232_000, committed: 100_000 },
  { id: "camera", name: "Camera", budget: 3_400_000, actual: 2_448_000, committed: 300_000 },
  { id: "grip", name: "Grip & Electric", budget: 2_900_000, actual: 1_972_000, committed: 220_000 },
  { id: "sound", name: "Sound", budget: 1_200_000, actual: 732_000, committed: 80_000 },
  { id: "wardrobe", name: "Wardrobe", budget: 1_100_000, actual: 605_000, committed: 70_000 },
  { id: "makeup", name: "Makeup", budget: 900_000, actual: 432_000, committed: 50_000 },
  { id: "catering", name: "Catering", budget: 1_300_000, actual: 546_000, committed: 110_000 },
];

export const MOCK_APPROVALS: ApprovalItem[] = [
  {
    id: "a1",
    type: "invoice",
    title: "INV-2407",
    vendor: "NEOM Studios Catering",
    submitter: "Sara Alotaibi",
    amount: 184_500,
    ageDays: 2,
  },
  {
    id: "a2",
    type: "po",
    title: "PO-1183",
    vendor: "Panavision Riyadh",
    submitter: "Omar Haddad",
    amount: 420_000,
    ageDays: 3,
  },
  {
    id: "a3",
    type: "petty_cash",
    title: "PC-0331",
    vendor: "Locations float top-up",
    submitter: "Layla Nasser",
    amount: 25_000,
    ageDays: 5,
  },
  {
    id: "a4",
    type: "contract",
    title: "Stunt coordinator amendment",
    vendor: "Action Unit Arabia",
    submitter: "Fahad Alqahtani",
    amount: 96_000,
    ageDays: 8,
  },
  {
    id: "a5",
    type: "invoice",
    title: "INV-2411",
    vendor: "Riyadh Gear House",
    submitter: "Sara Alotaibi",
    amount: 312_750,
    ageDays: 9,
  },
  {
    id: "a6",
    type: "contract",
    title: "VFX vendor change order",
    vendor: "Framestore MENA",
    submitter: "Maya Khoury",
    amount: 540_000,
    ageDays: 6,
  },
  {
    id: "a7",
    type: "po",
    title: "PO-1187",
    vendor: "SkyCam Arabia",
    submitter: "Omar Haddad",
    amount: 150_000,
    ageDays: 16,
  },
];

export const MOCK_ACTIVITY: ActivityEvent[] = [
  {
    id: "e1",
    actor: "Sara Alotaibi",
    action: "submitted invoice INV-2411",
    amount: 312_750,
    ageHours: 2,
  },
  {
    id: "e2",
    actor: "Omar Haddad",
    action: "raised purchase order PO-1183",
    amount: 420_000,
    ageHours: 5,
  },
  {
    id: "e3",
    actor: "Layla Nasser",
    action: "logged petty cash receipt PC-0330",
    amount: 8_450,
    ageHours: 9,
  },
  {
    id: "e4",
    actor: "Fahad Alqahtani",
    action: "executed payroll run W17",
    amount: 1_214_000,
    ageHours: 26,
  },
  {
    id: "e5",
    actor: "Maya Khoury",
    action: "uploaded contract amendment",
    amount: 96_000,
    ageHours: 30,
  },
  {
    id: "e6",
    actor: "Sara Alotaibi",
    action: "approved invoice INV-2402",
    amount: 77_200,
    ageHours: 49,
  },
  {
    id: "e7",
    actor: "Omar Haddad",
    action: "recorded vendor payment",
    amount: 265_000,
    ageHours: 52,
  },
  {
    id: "e8",
    actor: "Layla Nasser",
    action: "issued cash float — Locations",
    amount: 40_000,
    ageHours: 74,
  },
];

export const MOCK_CASH: CashPoint[] = [
  { label: "Sep", value: 8_200_000 },
  { label: "Oct", value: 6_900_000 },
  { label: "Nov", value: 5_400_000 },
  { label: "Dec", value: 4_800_000 },
  { label: "Jan", value: 3_600_000 },
  { label: "Feb", value: 2_900_000 },
];

const qualifying = Math.round(SPENT * 0.62);

export const MOCK_EXECUTIVE: ExecutiveDashboardData = {
  production: MOCK_PRODUCTION,
  totalBudget: TOTAL_BUDGET,
  spent: SPENT,
  committed: COMMITTED,
  paid: PAID,
  remaining: REMAINING,
  planToDate: PLAN_TO_DATE,
  varianceVsPlanPct: (safeDivide(SPENT, PLAN_TO_DATE) - 1) * 100,
  trajectory,
  crossoverWeek: CROSSOVER_WEEK,
  topSheet: MOCK_TOP_SHEET,
  departments: MOCK_DEPARTMENTS,
  cash: MOCK_CASH,
  qfe: {
    qualifying,
    totalSpend: SPENT,
    rebateRate: 0.35,
    estimatedRebate: Math.round(qualifying * 0.35),
  },
  weeklyBurn: Math.round(WEEKLY_BURN),
  weeklyBurnDeltaPct: (safeDivide(WEEKLY_BURN, TRAILING_BURN) - 1) * 100,
  runwayWeeks: Math.round(safeDivide(REMAINING, WEEKLY_BURN) * 10) / 10,
  sparkline: trajectory
    .filter((p) => p.actual != null)
    .slice(-12)
    .map((p) => safeNumber(p.actual)),
  isMock: true,
};

export const MOCK_OPERATIONAL: OperationalDashboardData = {
  currentWeek: CURRENT_WEEK,
  totalWeeks: TOTAL_WEEKS,
  kpis: {
    totalBudget: TOTAL_BUDGET,
    actualSpend: SPENT,
    committed: COMMITTED,
    paid: PAID,
    remaining: REMAINING,
    pctSpent: safeDivide(SPENT, TOTAL_BUDGET) * 100,
    committedPct: safeDivide(COMMITTED, TOTAL_BUDGET) * 100,
    varianceVsPlanPct: (safeDivide(SPENT, PLAN_TO_DATE) - 1) * 100,
    runwayWeeks: Math.round(safeDivide(REMAINING, WEEKLY_BURN) * 10) / 10,
    sparkline: trajectory
      .filter((p) => p.actual != null)
      .slice(-12)
      .map((p) => safeNumber(p.actual)),
  },
  approvals: MOCK_APPROVALS,
  departments: MOCK_DEPARTMENTS,
  spendByDepartment: [
    { name: "Camera", value: 486_000 },
    { name: "Art Department", value: 412_000 },
    { name: "Locations", value: 358_000 },
    { name: "Grip & Electric", value: 301_000 },
    { name: "Stunts", value: 244_000 },
    { name: "Transport", value: 198_000 },
    { name: "Sound", value: 122_000 },
    { name: "Wardrobe", value: 96_000 },
  ],
  trajectory,
  crossoverWeek: CROSSOVER_WEEK,
  topSheet: MOCK_TOP_SHEET,
  activity: MOCK_ACTIVITY,
  isMock: true,
};
