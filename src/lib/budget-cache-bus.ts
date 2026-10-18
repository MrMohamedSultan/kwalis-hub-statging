import { supabase } from "@/integrations/supabase/client";
import { invalidateProjectBudgetLines } from "@/lib/budget-mapping-options";
import { loadMasterHeaderNames } from "@/lib/project-budget-lines";
import { invalidateMasterBudgetCache } from "@/lib/master-budget-cache";
import { invalidateBudgetCatalog } from "@/lib/master-budget-catalog";

/**
 * Central invalidation bus for every budget/COA cache in the app.
 *
 * Three independent caches can go stale when someone edits a budget line or
 * the Master Chart of Accounts:
 *   1. the per-project `budget_lines` fetch cache + memoized option lists,
 *   2. the Master COA header-description cache (sessionStorage, 15 min TTL),
 *   3. the Master COA catalog / actuals session caches.
 *
 * Anything that writes to `budget_lines` or `master_budget` should call
 * `invalidateBudgetCaches(projectId)`, and any component rendering budget
 * options should `subscribeBudgetCaches()` so it refetches immediately.
 * A Supabase Realtime channel covers changes made by other users/tabs.
 */

export type BudgetCacheEvent = {
  /** Project whose lines changed; null/undefined = global (Master COA). */
  projectId?: string | null;
  scope: "lines" | "master" | "all";
};

type Listener = (event: BudgetCacheEvent) => void;

const listeners = new Set<Listener>();

export function subscribeBudgetCaches(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: BudgetCacheEvent) {
  for (const l of Array.from(listeners)) {
    try {
      l(event);
    } catch {
      /* a broken listener must never block the others */
    }
  }
}

/**
 * Drops the caches affected by `scope` and notifies every subscriber.
 * Master COA header descriptions are eagerly reloaded so the next dropdown
 * open already has the fresh labels.
 */
export function invalidateBudgetCaches(
  projectId?: string | null,
  scope: BudgetCacheEvent["scope"] = "all",
) {
  if (scope === "lines" || scope === "all") {
    invalidateProjectBudgetLines(projectId ?? undefined);
  }
  if (scope === "master" || scope === "all") {
    invalidateMasterBudgetCache();
    invalidateBudgetCatalog();
    // force = true clears the in-memory + sessionStorage header cache and refetches.
    void loadMasterHeaderNames(true);
    // Header descriptions feed every project's option labels, so project
    // line caches must be rebuilt too.
    invalidateProjectBudgetLines();
  }
  emit({ projectId: projectId ?? null, scope });
}

// ---------------------------------------------------------------------
// Realtime: pick up changes made by other users or other browser tabs.
// ---------------------------------------------------------------------
let realtimeStarted = false;

export function startBudgetCacheRealtime() {
  if (realtimeStarted || typeof window === "undefined") return;
  realtimeStarted = true;

  supabase
    .channel("budget-cache-invalidation")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "budget_lines" },
      (payload: any) => {
        const projectId =
          (payload?.new?.project_id as string | undefined) ??
          (payload?.old?.project_id as string | undefined) ??
          null;
        invalidateBudgetCaches(projectId, "lines");
      },
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "master_budget" }, () => {
      invalidateBudgetCaches(null, "master");
    })
    .subscribe();
}
