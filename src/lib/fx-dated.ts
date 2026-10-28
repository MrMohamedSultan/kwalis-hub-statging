// ═══════════════════════════════════════════════════════════════════
// Dated exchange rates with a source (D03).
//
// public.project_currency_rates (db/pending/190) holds, per project, a rate
// per currency and date (base units per 1 unit) and where it came from
// (SAMA, bank, project, manual). A document in USD / EUR takes the rate in
// force on its date; without a dated rate it falls back to the project's
// configured rate (source "project", no date). contract-terms rateToBase
// only knows SAR / USD / AED, so EUR (and any other currency) is priced here;
// rounding is the same contract-terms round2 (per document, before summing).
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "@/integrations/supabase/client";
import { rateFor, type FxSettings } from "@/lib/fx-settings";
import { round2 } from "@/lib/contract-terms";

export const FX_RATE_SOURCES = ["sama", "bank", "project", "manual"] as const;
export type FxRateSource = (typeof FX_RATE_SOURCES)[number];

export type DatedRate = {
  currency: string;
  rateDate: string; // YYYY-MM-DD
  rate: number;
  source: FxRateSource;
  sourceRef?: string | null;
};

export type PickedRate = {
  rate: number;
  source: FxRateSource | null;
  /** Date of the rate (null for the project's undated rate or the base currency). */
  rateDate: string | null;
  sourceRef?: string | null;
};

/**
 * Rate for `currency` on `date`: the latest dated rate on or before the date,
 * else the project's configured rate, else null (no guessing).
 */
export function pickRateFor(
  rates: DatedRate[],
  currency: string,
  date: string | null | undefined,
  settings: FxSettings,
): PickedRate | null {
  const ccy = currency.trim().toUpperCase();
  if (!ccy || ccy === settings.baseCurrency.toUpperCase())
    return { rate: 1, source: null, rateDate: null };
  const day = (date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  let best: DatedRate | null = null;
  for (const r of rates) {
    if (r.currency.toUpperCase() !== ccy || r.rateDate > day || !(r.rate > 0)) continue;
    if (!best || r.rateDate > best.rateDate) best = r;
  }
  if (best)
    return {
      rate: best.rate,
      source: best.source,
      rateDate: best.rateDate,
      sourceRef: best.sourceRef ?? null,
    };
  const fallback = rateFor(settings, ccy);
  return fallback ? { rate: fallback, source: "project", rateDate: null } : null;
}

/** Amount in the base currency, rounded to 2 decimals (same rule as contracts). */
export function amountInBase(amount: number, rate: number): number {
  return round2((Number(amount) || 0) * (Number(rate) || 0));
}

/** Sum of documents in mixed currencies, each converted with its own rate. */
export function totalInBase(rows: { amount: number; rate: number }[]): number {
  return round2(rows.reduce((s, r) => s + amountInBase(r.amount, r.rate), 0));
}

const db = supabase as unknown as { from: (t: string) => any };

export async function fetchProjectDatedRates(projectId: string): Promise<DatedRate[]> {
  try {
    const { data, error } = await db
      .from("project_currency_rates")
      .select("currency, rate_date, rate, source, source_ref")
      .eq("project_id", projectId)
      .order("rate_date", { ascending: false })
      .limit(1000);
    if (error) return [];
    return ((data ?? []) as any[]).map((r) => ({
      currency: String(r.currency),
      rateDate: String(r.rate_date),
      rate: Number(r.rate),
      source: (FX_RATE_SOURCES as readonly string[]).includes(r.source) ? r.source : "manual",
      sourceRef: r.source_ref ?? null,
    }));
  } catch {
    return []; // table not deployed yet → project rate only
  }
}

export async function saveProjectDatedRate(
  projectId: string,
  organizationId: string,
  r: DatedRate,
): Promise<void> {
  const { error } = await db.from("project_currency_rates").upsert(
    {
      project_id: projectId,
      organization_id: organizationId,
      currency: r.currency.toUpperCase(),
      rate_date: r.rateDate,
      rate: r.rate,
      source: r.source,
      source_ref: r.sourceRef?.trim() ? r.sourceRef.trim().slice(0, 300) : null,
    },
    { onConflict: "project_id,currency,rate_date" },
  );
  if (error) throw error;
}

export async function deleteProjectDatedRate(
  projectId: string,
  currency: string,
  rateDate: string,
): Promise<void> {
  const { error } = await db
    .from("project_currency_rates")
    .delete()
    .eq("project_id", projectId)
    .eq("currency", currency.toUpperCase())
    .eq("rate_date", rateDate);
  if (error) throw error;
}
