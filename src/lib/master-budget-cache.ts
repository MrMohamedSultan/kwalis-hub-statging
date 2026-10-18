import { supabase } from "@/integrations/supabase/client";

/**
 * Session cache for master_budget actuals.
 * The 1,230 catalog codes/names are bundled statically in `src/lib/data.ts`;
 * only per-project `actual_amount` needs to be fetched. This module caches
 * that fetch for the duration of the browser session with a soft TTL so
 * repeated dropdown opens or report navigations don't re-hit the network.
 */
export type ActualsMap = Record<string, number>;

const TTL_MS = 5 * 60 * 1000; // 5 minutes
let cached: { at: number; data: ActualsMap } | null = null;
let inflight: Promise<ActualsMap> | null = null;

export async function getMasterBudgetActuals(force = false): Promise<ActualsMap> {
  const now = Date.now();
  if (!force && cached && now - cached.at < TTL_MS) return cached.data;
  if (inflight) return inflight;
  inflight = (async () => {
    const { data, error } = await supabase
      .from("master_budget" as any)
      .select("budget_code, actual_amount");
    const map: ActualsMap = {};
    if (!error && data) {
      for (const row of data as unknown as Array<{
        budget_code: string;
        actual_amount: number | null;
      }>) {
        map[row.budget_code] = Number(row.actual_amount ?? 0);
      }
    }
    cached = { at: Date.now(), data: map };
    inflight = null;
    return map;
  })();
  return inflight;
}

export function invalidateMasterBudgetCache() {
  cached = null;
  inflight = null;
}
