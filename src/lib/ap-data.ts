// Data hooks for the accounts-payable screens (db/pending/174).
// Every query is scoped to the active project; RLS enforces the same.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_VAT_RATE_PCT,
  rentalTotal,
  stayNights,
  stayTotal,
  toBaseAmount,
} from "@/lib/ap-calc";
import type { LogisticsCommitment } from "@/lib/budget-position";
import { useStore } from "@/lib/store";

const validPct = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

/** E10: the project's VAT rate wins; the platform setting, then 15 %, are the fallbacks. */
export function resolveVatRate(projectPct: unknown, platformPct: unknown): number {
  return validPct(projectPct) ?? validPct(platformPct) ?? DEFAULT_VAT_RATE_PCT;
}

/**
 * Standard VAT rate (percent) for the active project: its Film Commission
 * settings (project_rebate_settings.vat_rate_pct, E10) when the project has
 * them, else platform_settings.vat_standard_rate_pct, else 15.
 */
export function useVatStandardRate(): number {
  const projectId = useStore((s) => s.activeProjectId);
  const platform = useQuery({
    queryKey: ["platform-setting", "vat_standard_rate_pct"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("platform_settings")
        .select("value")
        .eq("key", "vat_standard_rate_pct")
        .maybeSingle();
      if (error || !data) return null;
      return validPct((data as { value: string | null }).value);
    },
    staleTime: 10 * 60_000,
  });
  const project = useQuery({
    // same prefix as rebateSettingsKey: saving the settings refreshes it
    queryKey: ["project-rebate-settings", projectId, "vat"],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("project_rebate_settings")
        .select("vat_rate_pct")
        .eq("project_id", projectId)
        .maybeSingle();
      if (error || !data) return null;
      return validPct((data as { vat_rate_pct: unknown }).vat_rate_pct);
    },
    staleTime: 5 * 60_000,
  });
  return resolveVatRate(project.data, platform.data);
}

/**
 * Car rentals + accommodation of the project as commitments in SAR (B20).
 * Totals are recomputed from the row (same formula as the generated columns)
 * so the figure is right even before the generated columns exist.
 */
export function useLogisticsCommitments(projectId: string | null, fxRate: number) {
  const q = useQuery({
    queryKey: ["logistics-commitments", projectId, fxRate],
    enabled: !!projectId,
    queryFn: async (): Promise<LogisticsCommitment[]> => {
      const [cars, stays] = await Promise.all([
        supabase.from("car_rentals").select("*").eq("project_id", projectId!),
        supabase.from("accommodations").select("*").eq("project_id", projectId!),
      ]);
      const toSar = (amount: number, ccy: string | null | undefined) =>
        String(ccy ?? "SAR").toUpperCase() === "USD" ? toBaseAmount(amount, fxRate) : amount;
      const out: LogisticsCommitment[] = [];
      for (const r of (cars.data ?? []) as any[]) {
        const total = rentalTotal({
          rate_type: r.rate_type,
          daily_rate: Number(r.daily_rate) || 0,
          monthly_rate: Number(r.monthly_rate) || 0,
          rental_start_date: r.rental_start_date,
          rental_end_date: r.rental_end_date,
        });
        if (total > 0)
          out.push({ amount: toSar(total, r.currency), invoiceId: r.invoice_id ?? null });
      }
      for (const r of (stays.data ?? []) as any[]) {
        const total = stayTotal(
          stayNights(r.check_in_date, r.check_out_date),
          Number(r.nightly_rate) || 0,
        );
        if (total > 0)
          out.push({ amount: toSar(total, r.currency), invoiceId: r.invoice_id ?? null });
      }
      return out;
    },
    staleTime: 60_000,
  });
  return q.data ?? [];
}

/** GL account mapped to a budget code by budget_code_gl_map (070); null when unmapped. */
export async function fetchMappedGlAccount(
  organizationId: string | null | undefined,
  budgetCode: string,
): Promise<string | null> {
  if (!organizationId || !budgetCode.trim()) return null;
  try {
    const { data, error } = await (supabase as any).rpc("resolve_gl_account", {
      p_org: organizationId,
      p_budget_code: budgetCode,
    });
    if (error) return null;
    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}
