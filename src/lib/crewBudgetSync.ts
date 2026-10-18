// Crew ↔ Budget synchronization helpers.
// The Budget module (budget_lines table) is the single source of truth.
// A crew member can be linked to one budget_lines row that mirrors their
// "Total Deal" as an actual cost — but ONLY while their contract is "Active".

import { supabase } from "@/integrations/supabase/client";
import { invalidateBudgetCaches } from "@/lib/budget-cache-bus";

export type BudgetLineLite = {
  id: string;
  header_code: string;
  main_code: string;
  description: string;
  amount: number;
  rate: number;
  x: number;
  unit: string;
  group: string;
  currency: "USD" | "SAR";
};

export type CrewSyncMember = {
  id: string;
  full_name: string;
  role: string;
  header_code: string | null;
  sub_account_code: string | null;
  total_deal: number;
  deal_currency: "USD" | "SAR";
  linked_budget_line_id: string | null;
  contract_status: string;
};

export async function fetchBudgetLines(): Promise<BudgetLineLite[]> {
  const { data, error } = await supabase
    .from("budget_lines")
    .select('id, header_code, main_code, description, amount, rate, x, unit, "group", currency')
    .order("header_code", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((l: any) => ({
    id: l.id,
    header_code: l.header_code,
    main_code: l.main_code,
    description: l.description,
    amount: Number(l.amount ?? 0),
    rate: Number(l.rate ?? 0),
    x: Number(l.x ?? 1),
    unit: l.unit ?? "Flat",
    group: l.group ?? "BTL",
    currency: (l.currency ?? "USD") as "USD" | "SAR",
  }));
}

// Group budget lines into header → list of sub-accounts (main_code rows).
export function groupHeaders(lines: BudgetLineLite[]) {
  const headers = new Map<string, { code: string; description: string; group: string }>();
  for (const l of lines) {
    if (!headers.has(l.header_code)) {
      headers.set(l.header_code, {
        code: l.header_code,
        description: l.description, // best-effort label
        group: l.group,
      });
    }
  }
  return Array.from(headers.values()).sort((a, b) => a.code.localeCompare(b.code));
}

export function subsForHeader(lines: BudgetLineLite[], headerCode: string) {
  return lines.filter((l) => l.header_code === headerCode);
}

// Find an existing budget line for a sub-account code, preferring an
// "empty" line (zero rate) so we don't double-count when filling it in.
export function findBudgetLineForSub(lines: BudgetLineLite[], subCode: string) {
  const matches = lines.filter((l) => l.main_code === subCode);
  if (!matches.length) return null;
  const empty = matches.find((l) => Number(l.rate) === 0 || Number(l.amount) === 0);
  return empty ?? matches[0];
}

/**
 * Ensure the Budget module reflects this crew member's "Total Deal".
 *
 * - If contract is "Active" and sub-account is set:
 *     • Re-use an existing zero/empty line for that sub-account, OR create one.
 *     • Overwrite rate/qty/unit/currency to match the deal.
 *     • Persist linked_budget_line_id back on the crew member.
 * - If contract is NOT "Active":
 *     • Delete the previously-owned line and clear the link.
 *     • (Pending / Awaiting Review contracts must not impact Budget totals.)
 */
export async function syncCrewToBudget(member: CrewSyncMember): Promise<string | null> {
  try {
    return await syncCrewToBudgetInner(member);
  } finally {
    // Any path above may insert/update/delete a budget line — drop the cached
    // option lists so dropdowns immediately reflect the new descriptions.
    invalidateBudgetCaches(undefined, "lines");
  }
}

async function syncCrewToBudgetInner(member: CrewSyncMember): Promise<string | null> {
  const isActive = member.contract_status === "Active";
  const sub = member.sub_account_code?.trim();
  const header = member.header_code?.trim();

  // Inactive → tear down any owned line.
  if (!isActive || !sub || !header) {
    if (member.linked_budget_line_id) {
      await supabase.from("budget_lines").delete().eq("id", member.linked_budget_line_id);
      await supabase
        .from("crew_members")
        .update({ linked_budget_line_id: null })
        .eq("id", member.id);
    }
    return null;
  }

  const desc = `${member.full_name} — ${member.role}`.trim();
  const payload = {
    header_code: header,
    main_code: sub,
    description: desc,
    amount: 1,
    rate: Number(member.total_deal) || 0,
    x: 1,
    unit: "Flat",
    group: "BTL",
    currency: member.deal_currency,
    notes: `Synced from crew contract ${member.id}`,
  };

  // 1) Update the previously-linked line if it still exists.
  if (member.linked_budget_line_id) {
    const { data, error } = await supabase
      .from("budget_lines")
      .update(payload)
      .eq("id", member.linked_budget_line_id)
      .select("id")
      .maybeSingle();
    if (!error && data) return data.id;
    // fall through to re-link / create
  }

  // 2) Try to adopt an existing empty line for that sub-account — but never
  // one that another contract already owns. Multiple people legitimately map
  // to the same code, so each keeps its own budget row.
  const all = await fetchBudgetLines();
  const [{ data: crewLinks }, { data: peopleLinks }] = await Promise.all([
    supabase
      .from("crew_members")
      .select("linked_budget_line_id")
      .not("linked_budget_line_id", "is", null),
    supabase
      .from("people")
      .select("linked_budget_line_id")
      .not("linked_budget_line_id", "is", null),
  ]);
  const owned = new Set<string>(
    [
      ...((crewLinks ?? []) as any[]).map((r) => r.linked_budget_line_id),
      ...((peopleLinks ?? []) as any[]).map((r) => r.linked_budget_line_id),
    ].filter(Boolean),
  );
  owned.delete(member.linked_budget_line_id ?? "");
  const candidate = findBudgetLineForSub(
    all.filter((l) => !owned.has(l.id)),
    sub,
  );
  if (candidate && Number(candidate.rate) === 0) {
    const { data, error } = await supabase
      .from("budget_lines")
      .update(payload)
      .eq("id", candidate.id)
      .select("id")
      .single();
    if (error) throw error;
    await supabase
      .from("crew_members")
      .update({ linked_budget_line_id: data.id })
      .eq("id", member.id);
    return data.id;
  }

  // 3) Otherwise insert a new line dedicated to this contract.
  const { data, error } = await supabase.from("budget_lines").insert(payload).select("id").single();
  if (error) throw error;
  await supabase
    .from("crew_members")
    .update({ linked_budget_line_id: data.id })
    .eq("id", member.id);
  return data.id;
}
