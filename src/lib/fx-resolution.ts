// ═══════════════════════════════════════════════════════════════════
// FX rate resolution — the single, honest source for a project's
// SAR ↔ USD exchange rate.
//
// Resolution order (strictly):
//   1. project_fx_rates  — active row, latest effective_from
//   2. projects.fx_rate  — legacy scalar (SAR per 1 USD)
//   3. organizations.fx_rates — company matrix (units of base per 1 USD)
//
// If NONE yields a positive rate, resolveProjectFxRate returns null.
// Callers must NEVER fall back to a guessed/hardcoded rate: an audited
// report either shows the real configured rate or refuses to convert.
//
// Everything here is read-only; conversion is a display-layer concern
// and never writes back to the database.
// ═══════════════════════════════════════════════════════════════════

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import i18n from "@/lib/i18n";

export type FxRateSource = "project_fx_rates" | "projects.fx_rate" | "organizations.fx_rates";

export interface ResolvedFxRate {
  /** Base-currency units per 1 target-currency unit (e.g. 3.75 SAR per 1 USD). */
  rate: number;
  baseCurrency: string;
  targetCurrency: string;
  /** Only level 1 (project_fx_rates) records an effective date. */
  effectiveFrom: string | null;
  source: FxRateSource;
}

// project_fx_rates / fx_rates columns lag behind the generated types.
const db = supabase as unknown as { from: (table: string) => any };

export async function resolveProjectFxRate(projectId: string): Promise<ResolvedFxRate | null> {
  // ── Level 1: project_fx_rates (active, latest effective_from) ──────
  try {
    const { data, error } = await db
      .from("project_fx_rates")
      .select("rate, base_currency, target_currency, effective_from")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .order("effective_from", { ascending: false })
      .limit(1);
    if (!error) {
      const row = (data ?? [])[0];
      const rate = Number(row?.rate);
      if (row && Number.isFinite(rate) && rate > 0) {
        return {
          rate,
          baseCurrency: String(row.base_currency ?? "SAR").toUpperCase(),
          targetCurrency: String(row.target_currency ?? "USD").toUpperCase(),
          effectiveFrom: row.effective_from ?? null,
          source: "project_fx_rates",
        };
      }
    }
  } catch {
    /* table/RLS not reachable — fall through to the next level */
  }

  // Project + organization rows feed levels 2 and 3.
  const { data: proj } = await db
    .from("projects")
    .select("organization_id, fx_rate, currency")
    .eq("id", projectId)
    .maybeSingle();

  let org: { base_currency: string | null; fx_rates: unknown } | null = null;
  if (proj?.organization_id) {
    const { data } = await db
      .from("organizations")
      .select("base_currency, fx_rates")
      .eq("id", proj.organization_id)
      .maybeSingle();
    org = data ?? null;
  }
  // projects.fx_rate is DEFINED as SAR per 1 USD (legacy budget math);
  // the base comes from the organization when known.
  const orgBase = String(org?.base_currency ?? "SAR").toUpperCase();

  // ── Level 2: projects.fx_rate ──────────────────────────────────────
  const projectRate = Number(proj?.fx_rate);
  if (Number.isFinite(projectRate) && projectRate > 0) {
    const projCcy = String(proj?.currency ?? "").toUpperCase();
    return {
      rate: projectRate,
      baseCurrency: orgBase,
      targetCurrency: projCcy && projCcy !== orgBase ? projCcy : "USD",
      effectiveFrom: null,
      source: "projects.fx_rate",
    };
  }

  // ── Level 3: organizations.fx_rates matrix ─────────────────────────
  const matrix = (org?.fx_rates ?? {}) as Record<string, unknown>;
  const usd = Number(matrix.USD);
  const entries = Object.entries(matrix)
    .map(([k, v]) => [k.toUpperCase(), Number(v)] as const)
    .filter(([, v]) => Number.isFinite(v) && v > 0);
  const picked = Number.isFinite(usd) && usd > 0 ? (["USD", usd] as const) : entries[0];
  if (picked) {
    return {
      rate: picked[1],
      baseCurrency: orgBase,
      targetCurrency: picked[0],
      effectiveFrom: null,
      source: "organizations.fx_rates",
    };
  }

  return null; // no configured rate — callers must NOT guess
}

/** Round half-up to 2 decimals. Applied PER ROW before any summing, so
 *  totals always equal the sum of the visible (rounded) column. */
export const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Convert between the two currencies of the resolved pair.
 * Returns null when `from`/`to` are outside the pair (unconvertible —
 * the caller must keep the native figure rather than guess).
 */
export function convertAmount(
  fx: ResolvedFxRate,
  amount: number,
  from: string,
  to: string,
): number | null {
  const f = from.trim().toUpperCase();
  const t = to.trim().toUpperCase();
  if (!f || !t) return null;
  if (f === t) return amount;
  if (f === fx.baseCurrency && t === fx.targetCurrency) return amount / fx.rate;
  if (f === fx.targetCurrency && t === fx.baseCurrency) return amount * fx.rate;
  return null;
}

/** True when `fx` can convert between these two codes. */
export function canConvert(fx: ResolvedFxRate, from: string, to: string): boolean {
  return convertAmount(fx, 1, from, to) != null;
}

/** React hook over the resolver — cached 5 min per project. */
export function useResolvedFxRate(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["resolved-fx-rate", projectId],
    queryFn: () => resolveProjectFxRate(projectId as string),
    enabled: !!projectId,
    staleTime: 300_000,
    gcTime: 600_000,
  });
}

/** "3.75" from 3.750000 — trims trailing zeros, keeps up to 4 decimals. */
export function formatRate(rate: number): string {
  return String(Number(rate.toFixed(4)));
}

/**
 * Plain-language name of where a rate came from (G13) — never a table or
 * column name on screen or in an export.
 */
export function fxSourceLabel(source: FxRateSource): string {
  switch (source) {
    case "project_fx_rates":
      return i18n.t("exports.fx_source_rate_table");
    case "projects.fx_rate":
      return i18n.t("exports.fx_source_project");
    default:
      return i18n.t("exports.fx_source_company");
  }
}
