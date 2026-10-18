import { supabase } from "@/integrations/supabase/client";

/**
 * Unified currency & FX configuration.
 *
 * Three levels, each falling back to the one below:
 *   project.fx_rates  →  organization.fx_rates  →  PLATFORM_DEFAULTS
 *
 * A rate is always expressed as "1 unit of <currency> = N units of base
 * currency". The base currency itself is implicitly 1 and is never stored
 * in the matrix.
 */

export const SUPPORTED_CURRENCIES = [
  "SAR",
  "USD",
  "EUR",
  "AED",
  "GBP",
  "EGP",
  "JOD",
  "KWD",
  "QAR",
  "BHD",
  "OMR",
  "TRY",
  "INR",
  "CAD",
  "AUD",
  "CHF",
  "JPY",
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number] | (string & {});

export type FxRates = Record<string, number>;

export type FxSettings = {
  baseCurrency: string;
  rates: FxRates;
};

export const PLATFORM_FX_DEFAULTS: FxSettings = {
  baseCurrency: "SAR",
  rates: { USD: 3.75, EUR: 4.05, AED: 1.02 },
};

/** Strips the base currency, drops non-positive/NaN entries, uppercases codes. */
export function normalizeRates(rates: unknown, baseCurrency: string): FxRates {
  const out: FxRates = {};
  if (!rates || typeof rates !== "object") return out;
  for (const [key, value] of Object.entries(rates as Record<string, unknown>)) {
    const code = String(key).trim().toUpperCase();
    const n = Number(value);
    if (!code || code === baseCurrency.toUpperCase()) continue;
    if (!Number.isFinite(n) || n <= 0) continue;
    out[code] = n;
  }
  return out;
}

export function normalizeSettings(
  baseCurrency: unknown,
  rates: unknown,
  fallback: FxSettings = PLATFORM_FX_DEFAULTS,
): FxSettings {
  const base =
    typeof baseCurrency === "string" && baseCurrency.trim()
      ? baseCurrency.trim().toUpperCase()
      : fallback.baseCurrency;
  const normalized = normalizeRates(rates, base);
  return {
    baseCurrency: base,
    rates: Object.keys(normalized).length ? normalized : normalizeRates(fallback.rates, base),
  };
}

/** Rate for `code` expressed in `baseCurrency`. The base itself is 1. */
export function rateFor(settings: FxSettings, code: string): number | null {
  const c = code.trim().toUpperCase();
  if (c === settings.baseCurrency.toUpperCase()) return 1;
  const r = settings.rates[c];
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** Convert an amount between any two configured currencies. */
export function convert(
  settings: FxSettings,
  amount: number,
  from: string,
  to: string,
): number | null {
  const fromRate = rateFor(settings, from);
  const toRate = rateFor(settings, to);
  if (fromRate == null || toRate == null) return null;
  return (amount * fromRate) / toRate;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function fetchOrgFxSettings(organizationId: string): Promise<FxSettings> {
  const { data, error } = await supabase
    .from("organizations")
    .select("base_currency, fx_rates" as never)
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) return { ...PLATFORM_FX_DEFAULTS, rates: { ...PLATFORM_FX_DEFAULTS.rates } };
  const row = data as unknown as { base_currency: string | null; fx_rates: unknown };
  return normalizeSettings(row.base_currency, row.fx_rates);
}

export async function saveOrgFxSettings(
  organizationId: string,
  settings: FxSettings,
): Promise<void> {
  const clean = normalizeSettings(settings.baseCurrency, settings.rates);
  const { error } = await supabase
    .from("organizations")
    .update({ base_currency: clean.baseCurrency, fx_rates: clean.rates } as never)
    .eq("id", organizationId);
  if (error) throw new Error(error.message);
}

export type ProjectFxSettings = {
  /** `null` when the project inherits its company configuration. */
  override: FxSettings | null;
  /** Company-level configuration (the inheritance target). */
  organization: FxSettings;
  /** What the app should actually use. */
  effective: FxSettings;
};

export async function fetchProjectFxSettings(projectId: string): Promise<ProjectFxSettings> {
  const { data } = await supabase
    .from("projects")
    .select("organization_id, base_currency, fx_rates" as never)
    .eq("id", projectId)
    .maybeSingle();
  const row = (data ?? null) as unknown as {
    organization_id: string | null;
    base_currency: string | null;
    fx_rates: unknown;
  } | null;

  const organization = row?.organization_id
    ? await fetchOrgFxSettings(row.organization_id)
    : { ...PLATFORM_FX_DEFAULTS, rates: { ...PLATFORM_FX_DEFAULTS.rates } };

  const hasOverride =
    !!row?.base_currency ||
    (!!row?.fx_rates &&
      Object.keys(normalizeRates(row.fx_rates, row.base_currency ?? organization.baseCurrency))
        .length > 0);

  const override = hasOverride
    ? normalizeSettings(
        row?.base_currency ?? organization.baseCurrency,
        row?.fx_rates,
        organization,
      )
    : null;

  return { override, organization, effective: override ?? organization };
}

/**
 * Persists (or clears) the project-level override. The legacy single
 * `projects.fx_rate` column stays in sync with the USD rate so existing
 * dual-currency budget math keeps working.
 */
export async function saveProjectFxSettings(
  projectId: string,
  settings: FxSettings | null,
): Promise<number | null> {
  if (!settings) {
    const { error } = await supabase
      .from("projects")
      .update({ base_currency: null, fx_rates: null } as never)
      .eq("id", projectId);
    if (error) throw new Error(error.message);
    return null;
  }
  const clean = normalizeSettings(settings.baseCurrency, settings.rates);
  const usd = rateFor(clean, "USD");
  const patch: Record<string, unknown> = {
    base_currency: clean.baseCurrency,
    fx_rates: clean.rates,
  };
  if (clean.baseCurrency === "SAR" && usd && usd > 0) patch.fx_rate = usd;
  const { error } = await supabase
    .from("projects")
    .update(patch as never)
    .eq("id", projectId);
  if (error) throw new Error(error.message);
  return clean.baseCurrency === "SAR" ? usd : null;
}
