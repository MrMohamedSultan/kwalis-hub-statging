// =====================================================================
// Live-mode financial engine shared by both dashboards — DOCTRINE LAYER.
//
// Every money figure comes from the database's shared definition layer
// (migration 20260824163637), never recomputed in TypeScript:
//   budget    = Σ public.budget_line_total_sar(line) — budget by LINE
//   actual    = incurred costs (v_ledger_transactions, entry_kind='actual')
//   committed = issued but not consumed (entry_kind='commitment')
//   paid      = cash out the door (canonical payments ledger)
//   remaining = available = budget − actual − committed
//
// The views:
//   v_project_position      — one row per project: totals + unallocated_*
//   v_budget_code_position  — one row per (project, main_code): budget is
//                             the lines' build-up of ONE account, money is
//                             reported by code. Σ codes ≡ project rollup
//                             by construction.
//
// Date ranges deliberately do NOT filter these figures: budget, actual,
// committed and paid are the project's current POSITION (state), not a
// dated event series. Event lists (approvals, activity, trajectory) carry
// their own range filtering in the hooks.
// =====================================================================
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { safeNumber } from "@/lib/safe";
import { useStore } from "@/lib/store";

export interface RealBudgetLineRow {
  id: string;
  header_code: string | null;
  main_code: string | null;
  description: string | null;
  name: string | null;
  amount: number;
  rate: number;
  unit: string | null;
  x: number;
  currency: string | null;
  prep: number | null;
  shooting: number | null;
  wrap: number | null;
  group: string | null;
  excluded: boolean;
  rebate_eligible: boolean;
}

export interface RealFinancials {
  /** Σ line totals in SAR — budget is built by LINE. */
  totalBudget: number;
  /** Incurred costs (v_ledger_transactions actuals), SAR. */
  actualSpend: number;
  /** Issued but not consumed (commitments), SAR. */
  committed: number;
  /** Cash paid (payments ledger), SAR. */
  paid: number;
  /** Available position: budget − actual − committed. */
  remaining: number;
  /** Ledger money with no attributable budget line — surfaced, never folded in. */
  unallocatedActual: number;
  unallocatedCommitted: number;
  unallocatedPaid: number;
  /** Incurred actuals keyed by budget header code (from code-level rows). */
  actualByHeader: Record<string, number>;
  /** Commitments keyed by budget header code (from code-level rows). */
  committedByHeader: Record<string, number>;
  lines: RealBudgetLineRow[];
  fxRate: number;
}

/** Zero-state used by the hooks' catch paths — honest zeros, never mock. */
export function emptyRealFinancials(): RealFinancials {
  return {
    totalBudget: 0,
    actualSpend: 0,
    committed: 0,
    paid: 0,
    remaining: 0,
    unallocatedActual: 0,
    unallocatedCommitted: 0,
    unallocatedPaid: 0,
    actualByHeader: {},
    committedByHeader: {},
    lines: [],
    fxRate: 3.75,
  };
}

// CANONICAL RULE (2026-08-24, confirmed by platform owner): Package and
// Epi units are FLAT TOTALS — amount × rate is the full line value and
// they NEVER multiply by periods (x / prep / shooting / wrap). This set
// mirrors public.budget_line_total_sar in the database, which is the
// single canonical implementation; this TS copy is consumed only by
// chart slices (top sheet / departments) and must never drift from the
// SQL function.
const UNITS_NO_PERIODS = new Set(["Package", "Epi"]);

/** totalPeriods() from src/lib/store.ts — identical semantics. */
function periodsOf(l: Pick<RealBudgetLineRow, "prep" | "shooting" | "wrap" | "x">): number {
  const sum = safeNumber(l.prep) + safeNumber(l.shooting) + safeNumber(l.wrap);
  if (sum > 0) return sum;
  const x = safeNumber(l.x);
  return x > 0 ? x : 1;
}

/** lineTotalSAR() — identical semantics to public.budget_line_total_sar. */
export function lineTotalSar(l: RealBudgetLineRow, fxRate: number): number {
  if (l.excluded) return 0;
  const base = safeNumber(l.amount) * safeNumber(l.rate);
  const native = UNITS_NO_PERIODS.has(l.unit ?? "") ? base : base * periodsOf(l);
  return (l.currency ?? "USD") === "SAR" ? native : native * fxRate;
}

/** Project FX rate (USD→SAR): store first, DB fallback. */
async function resolveFxRate(projectId: string): Promise<number> {
  const fromStore = useStore.getState().projects.find((p) => p.id === projectId)?.fxRate;
  if (Number.isFinite(fromStore) && (fromStore as number) > 0) return fromStore as number;
  const { data } = await supabase
    .from("projects")
    .select("fx_rate")
    .eq("id", projectId)
    .maybeSingle();
  const rate = Number((data as any)?.fx_rate);
  return Number.isFinite(rate) && rate > 0 ? rate : 3.75;
}

/**
 * Project financial position from the shared definition layer.
 *
 * `opts.from/to` are accepted (and key the query cache) but intentionally
 * unused: the position views return the project's CURRENT state. Filtering
 * a balance by a date range would silently misstate it.
 */
export async function fetchRealFinancials(
  projectId: string,
  _opts: { from: string | null; to: string | null },
): Promise<RealFinancials> {
  const [linesRes, positionRes, codesRes, fxRate] = await Promise.all([
    // Lines feed the chart slices (top sheet / departments) and the
    // code → header map; the totals themselves come from the views.
    supabase
      .from("v_active_budget_lines" as any)
      .select("*")
      .eq("project_id", projectId)
      .order("created_at"),
    (supabase.from as any)("v_project_position")
      .select(
        "budget_sar, actual_sar, committed_sar, paid_sar, available_sar, unallocated_actual_sar, unallocated_committed_sar, unallocated_paid_sar",
      )
      .eq("project_id", projectId)
      .maybeSingle(),
    (supabase.from as any)("v_budget_code_position")
      .select("budget_code, actual_sar, committed_sar")
      .eq("project_id", projectId),
    resolveFxRate(projectId),
  ]);
  if (linesRes.error) throw linesRes.error;
  if (positionRes.error) throw positionRes.error;
  if (codesRes.error) throw codesRes.error;

  const lines = (linesRes.data ?? []) as unknown as RealBudgetLineRow[];
  const pos = (positionRes.data ?? {}) as Record<string, unknown>;

  // Code-level money → header-level slices. The code → header map comes
  // from the project's own budget lines (each main_code sits under exactly
  // one header); money on codes with no line aggregates under "—" and is
  // additionally surfaced via the unallocated_* totals above.
  const headerByCode = new Map<string, string>();
  for (const l of lines) {
    if (l.main_code && !headerByCode.has(l.main_code)) {
      headerByCode.set(l.main_code, l.header_code || "—");
    }
  }
  const actualByHeader: Record<string, number> = {};
  const committedByHeader: Record<string, number> = {};
  for (const row of (codesRes.data ?? []) as Array<Record<string, unknown>>) {
    const code = typeof row.budget_code === "string" ? row.budget_code : null;
    const header = (code && headerByCode.get(code)) || "—";
    actualByHeader[header] = (actualByHeader[header] ?? 0) + safeNumber(row.actual_sar);
    committedByHeader[header] = (committedByHeader[header] ?? 0) + safeNumber(row.committed_sar);
  }

  return {
    totalBudget: safeNumber(pos.budget_sar),
    actualSpend: safeNumber(pos.actual_sar),
    committed: safeNumber(pos.committed_sar),
    paid: safeNumber(pos.paid_sar),
    remaining: safeNumber(pos.available_sar),
    unallocatedActual: safeNumber(pos.unallocated_actual_sar),
    unallocatedCommitted: safeNumber(pos.unallocated_committed_sar),
    unallocatedPaid: safeNumber(pos.unallocated_paid_sar),
    actualByHeader,
    committedByHeader,
    lines,
    fxRate,
  };
}

/** One row per (project, budget account code) — the doctrine position. */
export interface CodePositionRow {
  budget_code: string | null;
  line_count: number;
  actual_sar: number;
  committed_sar: number;
  paid_sar: number;
}

/**
 * Code-level position for the active project (v_budget_code_position).
 * Money is reported by account CODE; Σ codes ≡ the project rollup by
 * construction. Rows with line_count = 0 carry ledger money with no
 * matching budget line — surface them, never fold them in.
 */
export async function fetchCodePosition(projectId: string): Promise<CodePositionRow[]> {
  const { data, error } = await (supabase.from as any)("v_budget_code_position")
    .select("budget_code, line_count, actual_sar, committed_sar, paid_sar")
    .eq("project_id", projectId);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    budget_code: typeof r.budget_code === "string" ? r.budget_code : null,
    line_count: safeNumber(r.line_count),
    actual_sar: safeNumber(r.actual_sar),
    committed_sar: safeNumber(r.committed_sar),
    paid_sar: safeNumber(r.paid_sar),
  }));
}

// =====================================================================
// Shared, cacheable query options.
//
// Both dashboards read the exact same position (one view row + one
// code-level scan + the budget lines). Keying it once means the
// executive and operational views share a single cache entry instead of
// each re-pulling on mount. staleTime/gcTime match the global
// QueryClient doctrine (5 min fresh / 10 min retained).
// =====================================================================
export function realFinancialsQueryOptions(
  projectId: string | null,
  opts: { from: string | null; to: string | null },
) {
  return queryOptions({
    // v2 — the doctrine-layer redefinition; old aggregates must never be
    // served from a stale v1 cache entry.
    queryKey: ["real-financials-v2", projectId, opts.from, opts.to] as const,
    queryFn: (): Promise<RealFinancials> =>
      projectId ? fetchRealFinancials(projectId, opts) : Promise.resolve(emptyRealFinancials()),
    // Hold the previous render during refetch — no skeleton flash.
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}
