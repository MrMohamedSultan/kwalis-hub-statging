import { supabase } from "@/integrations/supabase/client";

export type BudgetCatalogEntry = {
  code: string;
  name: string;
  description: string | null;
  parent_code: string | null;
  is_header: boolean;
};

const TTL_MS = 5 * 60 * 1000;
let cached: { at: number; data: BudgetCatalogEntry[] } | null = null;
let inflight: Promise<BudgetCatalogEntry[]> | null = null;

/**
 * Session cache of the entire master_budget catalog (headers + sub-accounts).
 * Fetched once per session so budget-code dropdowns don't hit the DB on every
 * open. Safe to call from any component — repeated callers share the promise.
 */
export async function getBudgetCatalog(force = false): Promise<BudgetCatalogEntry[]> {
  const now = Date.now();
  if (!force && cached && now - cached.at < TTL_MS) return cached.data;
  if (inflight) return inflight;
  inflight = (async () => {
    // PostgREST caps a single response at 1000 rows and the catalog has
    // ~1.7k accounts, so page through the full table — otherwise every code
    // past the first 1000 silently vanishes from pickers and dashboards.
    const PAGE = 1000;
    const rows: BudgetCatalogEntry[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("master_budget" as any)
        .select("budget_code, category, description, parent_code, is_header")
        .order("budget_code", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data) break;
      for (const r of data as unknown as Array<{
        budget_code: string;
        category: string | null;
        description: string | null;
        parent_code: string | null;
        is_header: boolean | null;
      }>) {
        rows.push({
          code: r.budget_code,
          // For sub-accounts, the human-readable line item lives in `description`
          // (e.g. "SCRIPT", "STORY RIGHTS / COPYRIGHTS / OPTION"). `category`
          // is the section name (ATL/BTL/POST) and repeats across every child,
          // so it's useless as a picker label. Headers fall back to category.
          name: (r.is_header ? (r.category ?? r.description) : (r.description ?? r.category)) ?? "",
          description: r.description ?? null,
          parent_code: r.parent_code ?? null,
          is_header: !!r.is_header,
        });
      }
      if (data.length < PAGE) break;
    }
    cached = { at: Date.now(), data: rows };
    inflight = null;
    return rows;
  })();
  return inflight;
}

export function invalidateBudgetCatalog() {
  cached = null;
  inflight = null;
}
