// ═══════════════════════════════════════════════════════════════════
// N10 — Budget Change Log data. Reads public.v_budget_change_log
// (db/pending/184): every change of a budget line from the audit trail,
// with the line total before / after in SAR, user, date and reason.
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "@/integrations/supabase/client";

export interface BudgetChangeRow {
  id: string;
  changed_at: string;
  budget_line_id: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  action: string;
  actor_name: string | null;
  budget_code: string | null;
  description: string | null;
  version_name: string | null;
  version_status: string | null;
  before_sar: number | null;
  after_sar: number | null;
  reason: string | null;
  changed_fields: Record<string, unknown> | null;
}

export async function fetchBudgetChangeLog(projectId: string): Promise<BudgetChangeRow[]> {
  const out: BudgetChangeRow[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await supabase
      .from("v_budget_change_log" as never)
      .select(
        "id, changed_at, budget_line_id, operation, action, actor_name, budget_code, description, version_name, version_status, before_sar, after_sar, reason, changed_fields",
      )
      .eq("project_id", projectId)
      .order("changed_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as BudgetChangeRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Change in SAR: after − before (a created line counts from 0, a deleted one to 0). */
export function changeDelta(r: Pick<BudgetChangeRow, "before_sar" | "after_sar">): number {
  const before = Number(r.before_sar ?? 0) || 0;
  const after = Number(r.after_sar ?? 0) || 0;
  return Math.round((after - before) * 100) / 100;
}

export interface ChangeLogFilter {
  from?: string; // YYYY-MM-DD
  to?: string;
  version?: string; // version_name or "all"
  amountOnly?: boolean; // hide changes that did not move the line total
  search?: string;
}

export function filterChangeLog(rows: BudgetChangeRow[], f: ChangeLogFilter): BudgetChangeRow[] {
  const q = (f.search ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    const day = r.changed_at.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.version && f.version !== "all" && r.version_name !== f.version) return false;
    if (f.amountOnly && changeDelta(r) === 0) return false;
    if (q) {
      const hay = [r.budget_code, r.description, r.actor_name, r.reason]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
