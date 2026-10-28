// =====================================================================
// Company Overhead (R25 / E04 / R11, decision 14) — pure calculations.
//
// Lines come from public.get_company_overhead (db/pending/198): company
// employees (monthly cost incl. the company GOSI share × allocation % ×
// months), office rent share and company equipment share (monthly amount
// or % of the budget). Overhead never enters the ledger, payments or cash.
// On the Cost Report it is a separate line under the total:
//   Company Overhead (unbudgeted) = lines without a budget line
//   True cost = EFC + unbudgeted overhead
// (overhead linked to a budget line is already covered by that line's
// budget / ETC, so adding it again would count it twice).
// =====================================================================

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export type OverheadKind = "staff" | "office_rent" | "equipment";
export const OVERHEAD_KINDS: OverheadKind[] = ["staff", "office_rent", "equipment"];

export interface OverheadLine {
  kind: OverheadKind;
  id: string;
  label: string;
  position: string | null;
  basis: "monthly" | "pct_budget";
  monthly_amount: number | null;
  pct_of_budget: number | null;
  allocation_pct: number;
  start_date: string | null;
  end_date: string | null;
  months: number | null;
  amount: number;
  budget_code: string | null;
  budgeted: boolean;
  over_allocated: boolean;
  project_budget: number;
  notes: string | null;
}

export interface OverheadTotals {
  total: number;
  budgeted: number;
  unbudgeted: number;
  byKind: Record<OverheadKind, number>;
  projectBudget: number;
  /** total ÷ project budget × 100 (null when there is no budget). */
  pctOfBudget: number | null;
}

export function overheadTotals(lines: OverheadLine[]): OverheadTotals {
  const byKind: Record<OverheadKind, number> = { staff: 0, office_rent: 0, equipment: 0 };
  let budgeted = 0;
  let unbudgeted = 0;
  for (const l of lines) {
    const a = num(l.amount);
    byKind[l.kind] = (byKind[l.kind] ?? 0) + a;
    if (l.budgeted) budgeted += a;
    else unbudgeted += a;
  }
  for (const k of OVERHEAD_KINDS) byKind[k] = round2(byKind[k]);
  const total = round2(budgeted + unbudgeted);
  const projectBudget = round2(num(lines[0]?.project_budget));
  return {
    total,
    budgeted: round2(budgeted),
    unbudgeted: round2(unbudgeted),
    byKind,
    projectBudget,
    pctOfBudget: projectBudget > 0 ? round2((total / projectBudget) * 100) : null,
  };
}

/** True cost = EFC + Company Overhead not already in a budget line. */
export function trueCost(efc: number, unbudgetedOverhead: number): number {
  return round2(num(efc) + num(unbudgetedOverhead));
}

/** Monthly cost × allocation % × months (preview in the add form; the database is authoritative). */
export function allocatedCost(monthly: number, allocationPct: number, months: number): number {
  return round2((num(monthly) * num(allocationPct) * num(months)) / 100);
}
