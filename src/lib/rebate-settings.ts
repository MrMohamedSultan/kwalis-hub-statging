// ═══════════════════════════════════════════════════════════════════
// E10 — Film Commission settings per project (db/pending/197,
// public.project_rebate_settings). Read by every rebate figure (report,
// dashboard); written only through the admin RPCs
// set_project_rebate_settings / approve_project_rebate_settings, which
// lock the settings after approval and log every change.
// ═══════════════════════════════════════════════════════════════════
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export interface ProjectRebateSettings {
  id: string;
  project_id: string;
  rebate_rate_pct: number | null;
  rebate_cap_sar: number | null;
  fc_agreement_no: string | null;
  fc_agreement_date: string | null;
  fc_agreement_months: number | null;
  production_period_from: string | null;
  production_period_to: string | null;
  cash_limit_pct_of_qpe: number | null;
  cash_limit_per_txn_sar: number | null;
  vat_rate_pct: number;
  work_days_per_week: number;
  weekly_off_days: number[];
  approved_at: string | null;
  approved_by: string | null;
  change_reason: string | null;
  updated_at: string;
}

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

function fromRow(r: Record<string, unknown>): ProjectRebateSettings {
  return {
    id: String(r.id),
    project_id: String(r.project_id),
    rebate_rate_pct: num(r.rebate_rate_pct),
    rebate_cap_sar: num(r.rebate_cap_sar),
    fc_agreement_no: (r.fc_agreement_no as string | null) ?? null,
    fc_agreement_date: (r.fc_agreement_date as string | null) ?? null,
    fc_agreement_months: num(r.fc_agreement_months),
    production_period_from: (r.production_period_from as string | null) ?? null,
    production_period_to: (r.production_period_to as string | null) ?? null,
    cash_limit_pct_of_qpe: num(r.cash_limit_pct_of_qpe),
    cash_limit_per_txn_sar: num(r.cash_limit_per_txn_sar),
    vat_rate_pct: Number(r.vat_rate_pct ?? 15),
    work_days_per_week: Number(r.work_days_per_week ?? 5),
    weekly_off_days: Array.isArray(r.weekly_off_days) ? (r.weekly_off_days as number[]) : [5, 6],
    approved_at: (r.approved_at as string | null) ?? null,
    approved_by: (r.approved_by as string | null) ?? null,
    change_reason: (r.change_reason as string | null) ?? null,
    updated_at: String(r.updated_at ?? ""),
  };
}

// project_rebate_settings is not in the generated types yet.
const table = () => supabase.from("project_rebate_settings" as never) as any;
type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

export async function fetchRebateSettings(
  projectId: string,
): Promise<ProjectRebateSettings | null> {
  const { data, error } = await table().select("*").eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as Record<string, unknown>) : null;
}

export async function fetchCanAdminRebateSettings(projectId: string): Promise<boolean> {
  const { data, error } = await rpc("can_admin_rebate_settings", { p_project_id: projectId });
  if (error) return false;
  return data === true;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const pct = z.number().min(0).max(100).nullable();
export const rebateSettingsSchema = z
  .object({
    rebate_rate_pct: pct,
    rebate_cap_sar: z.number().min(0).max(1e12).nullable(),
    fc_agreement_no: z.string().trim().max(100).nullable(),
    fc_agreement_date: isoDate,
    fc_agreement_months: z.number().int().min(1).max(120).nullable(),
    production_period_from: isoDate,
    production_period_to: isoDate,
    cash_limit_pct_of_qpe: pct,
    cash_limit_per_txn_sar: z.number().min(0).max(1e12).nullable(),
    vat_rate_pct: z.number().min(0).max(100),
    work_days_per_week: z.number().int().min(1).max(7),
    weekly_off_days: z.array(z.number().int().min(0).max(6)).max(6),
  })
  .refine(
    (v) =>
      !v.production_period_from ||
      !v.production_period_to ||
      v.production_period_from <= v.production_period_to,
    { message: "period_order", path: ["production_period_to"] },
  )
  .refine((v) => new Set(v.weekly_off_days).size === 7 - v.work_days_per_week, {
    message: "off_days_count",
    path: ["weekly_off_days"],
  });
export type RebateSettingsInput = z.infer<typeof rebateSettingsSchema>;

export async function saveRebateSettings(
  projectId: string,
  values: RebateSettingsInput,
  reason?: string,
): Promise<ProjectRebateSettings> {
  const v = rebateSettingsSchema.parse(values);
  const { data, error } = await rpc("set_project_rebate_settings", {
    p_project_id: z.string().uuid().parse(projectId),
    p_values: { ...v, weekly_off_days: [...new Set(v.weekly_off_days)].sort() },
    p_reason: reason?.trim().slice(0, 1000) || null,
  });
  if (error) throw error;
  return fromRow(data as Record<string, unknown>);
}

export async function approveRebateSettings(
  projectId: string,
  approve: boolean,
  reason?: string,
): Promise<ProjectRebateSettings> {
  const { data, error } = await rpc("approve_project_rebate_settings", {
    p_project_id: z.string().uuid().parse(projectId),
    p_approve: approve,
    p_reason: reason?.trim().slice(0, 1000) || null,
  });
  if (error) throw error;
  return fromRow(data as Record<string, unknown>);
}

export const rebateSettingsKey = (projectId: string | null) =>
  ["project-rebate-settings", projectId] as const;

export function useRebateSettings(projectId: string | null) {
  return useQuery({
    queryKey: rebateSettingsKey(projectId),
    enabled: !!projectId,
    staleTime: 60_000,
    queryFn: async () => {
      const [settings, canAdmin] = await Promise.all([
        fetchRebateSettings(projectId as string),
        fetchCanAdminRebateSettings(projectId as string),
      ]);
      return { settings, canAdmin };
    },
  });
}

export function useInvalidateRebateSettings() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["project-rebate-settings"] }),
      qc.invalidateQueries({ queryKey: ["film-commission-rebate"] }),
      qc.invalidateQueries({ queryKey: ["rebate-headline"] }),
    ]);
}
