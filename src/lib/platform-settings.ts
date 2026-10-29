// Platform Hub configuration (D20): stored in public.platform_settings
// (key / value rows, db/pending/035 + 204), read by every signed-in user,
// written by a super admin only (RLS + stamp_platform_settings checks).
// Before 204 the tab kept these values in the browser (localStorage).
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export type PlatformSettings = {
  baseCurrency: string;
  usdRate: string;
  eurRate: string;
  aedRate: string;
  whtRate: string;
  vatRate: string;
  fiscalYearStart: string;
  defaultProjectLimit: string;
  defaultLanguage: "en" | "ar";
  /** Board approval above this SAR amount; "" = off (NULL). */
  requireApprovalAbove: string;
};

/** Field → platform_settings.key. */
export const PLATFORM_SETTING_KEYS: Record<keyof PlatformSettings, string> = {
  baseCurrency: "platform_base_currency",
  usdRate: "fx_usd_to_base",
  eurRate: "fx_eur_to_base",
  aedRate: "fx_aed_to_base",
  whtRate: "default_wht_rate_pct",
  vatRate: "vat_standard_rate_pct",
  fiscalYearStart: "fiscal_year_start",
  defaultProjectLimit: "default_project_limit",
  defaultLanguage: "default_language",
  requireApprovalAbove: "payment_board_approval_above_sar",
};

export const PLATFORM_DEFAULTS: PlatformSettings = {
  baseCurrency: "SAR",
  usdRate: "3.75",
  eurRate: "4.05",
  aedRate: "1.02",
  whtRate: "5",
  vatRate: "15",
  fiscalYearStart: "01-01",
  defaultProjectLimit: "5",
  defaultLanguage: "en",
  requireApprovalAbove: "",
};

const rate = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,6})?$/, "rate")
  .refine((v) => Number(v) > 0, "rate");
const pct = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "pct")
  .refine((v) => Number(v) < 100, "pct");

/** Same rules as stamp_platform_settings() in the database. */
export const PlatformSettingsSchema = z.object({
  baseCurrency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "currency"),
  usdRate: rate,
  eurRate: rate,
  aedRate: rate,
  whtRate: pct,
  vatRate: pct,
  fiscalYearStart: z
    .string()
    .trim()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "fiscal"),
  defaultProjectLimit: z
    .string()
    .trim()
    .regex(/^\d{1,5}$/, "limit")
    .refine((v) => Number(v) >= 1, "limit"),
  defaultLanguage: z.enum(["en", "ar"]),
  requireApprovalAbove: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0), "approval"),
});

/** Pure: database rows → form values (missing rows keep the default). */
export function settingsFromRows(rows: { key: string; value: string | null }[]): PlatformSettings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...PLATFORM_DEFAULTS };
  for (const [field, key] of Object.entries(PLATFORM_SETTING_KEYS) as [
    keyof PlatformSettings,
    string,
  ][]) {
    if (!byKey.has(key)) continue;
    const v = byKey.get(key);
    (out as Record<string, string>)[field] = v == null ? "" : String(v);
  }
  return out;
}

/** Pure: the rows to update (key, value — NULL for an empty approval limit). */
export function changedSettingRows(
  before: PlatformSettings,
  after: PlatformSettings,
): { key: string; value: string | null }[] {
  return (Object.keys(PLATFORM_SETTING_KEYS) as (keyof PlatformSettings)[])
    .filter((f) => String(before[f]).trim() !== String(after[f]).trim())
    .map((f) => {
      const v = String(after[f]).trim();
      return { key: PLATFORM_SETTING_KEYS[f], value: v === "" ? null : v };
    });
}

export async function fetchPlatformSettings(): Promise<PlatformSettings> {
  const { data, error } = await (supabase.from as any)("platform_settings")
    .select("key, value")
    .in("key", Object.values(PLATFORM_SETTING_KEYS));
  if (error) throw error;
  return settingsFromRows((data ?? []) as { key: string; value: string | null }[]);
}

export async function savePlatformSettings(rows: { key: string; value: string | null }[]) {
  for (const r of rows) {
    const { data, error } = await (supabase.from as any)("platform_settings")
      .update({ value: r.value })
      .eq("key", r.key)
      .select("key");
    if (error) throw error;
    if (!data?.length) throw new Error(`platform_settings: ${r.key} was not saved`);
  }
}
