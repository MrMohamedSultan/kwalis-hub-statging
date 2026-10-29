// QPE eligibility of a budget code for exports (E12). The single source is
// budget_code_qpe_map (db/pending/197): the system suggests a category or a
// non-eligibility reason per code, the accountant approves it. Only an
// approved mapping counts — the same rule rebate_transactions() applies.
// The old per-line flag (budget_lines.rebate_eligible, "QFE") is not used.
import { supabase } from "@/integrations/supabase/client";

export type QpeMapRow = {
  budget_code: string;
  qpe_category: string | null;
  ineligible_reason: string | null;
  status: "suggested" | "approved" | string;
};

export type QpeEligibility =
  "eligible" | "not_eligible" | "suggested_eligible" | "suggested_not" | "unmapped";

/** Pure: the eligibility of one budget code from its mapping row (unit-tested). */
export function qpeEligibilityOf(row: QpeMapRow | null | undefined): QpeEligibility {
  if (!row) return "unmapped";
  const eligible = !!row.qpe_category && !row.ineligible_reason;
  if (row.status === "approved") return eligible ? "eligible" : "not_eligible";
  return eligible ? "suggested_eligible" : "suggested_not";
}

/** Export text (English, like the other column headers of the budget files). */
export function qpeEligibilityLabel(e: QpeEligibility, category?: string | null): string {
  switch (e) {
    case "eligible":
      return category ? `Yes (${category})` : "Yes";
    case "not_eligible":
      return "No";
    case "suggested_eligible":
      return "Pending approval (suggested Yes)";
    case "suggested_not":
      return "Pending approval (suggested No)";
    default:
      return "Not mapped";
  }
}

/** budget code → mapping row, for one project (RLS: project members). */
export async function fetchQpeMap(projectId: string | null): Promise<Map<string, QpeMapRow>> {
  const out = new Map<string, QpeMapRow>();
  if (!projectId) return out;
  const { data, error } = await (supabase.from as any)("budget_code_qpe_map")
    .select("budget_code, qpe_category, ineligible_reason, status")
    .eq("project_id", projectId);
  if (error) return out; // database without 197: every code "Not mapped"
  for (const r of (data ?? []) as QpeMapRow[]) out.set(r.budget_code, r);
  return out;
}

/** Label for one budget code from a fetched map. */
export function qpeLabelForCode(
  map: Map<string, QpeMapRow>,
  code: string | null | undefined,
): string {
  const row = code ? map.get(code) : undefined;
  return qpeEligibilityLabel(qpeEligibilityOf(row), row?.qpe_category);
}
