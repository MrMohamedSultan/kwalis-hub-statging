// ═══════════════════════════════════════════════════════════════════
// Film Commission Rebate — data access (db/pending/197).
//   get_film_commission_rebate  every section of the merged report
//   suggest_qpe_mapping         system suggestion for unmapped budget codes
//   set_qpe_mapping             accountant approves / changes a code
//   set_qpe_override            one transaction, with a mandatory reason
//   clear_qpe_override          remove it (reason required)
// The RPCs check access and permissions in the database; the inputs are
// validated here too (zod) so a bad call never leaves the browser.
// ═══════════════════════════════════════════════════════════════════
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  INELIGIBLE_REASONS,
  QPE_CATEGORIES,
  type FilmCommissionRebate,
  type RebateSource,
} from "./rebate-types";

// The generated Supabase types do not know the 197 RPCs yet.
type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const rebateKeys = {
  all: ["film-commission-rebate"] as const,
  report: (projectId: string | null, sections: string) =>
    ["film-commission-rebate", projectId, sections] as const,
};

export async function fetchFilmCommissionRebate(
  projectId: string,
  sections?: readonly string[],
): Promise<FilmCommissionRebate> {
  const data = await call<FilmCommissionRebate | null>("get_film_commission_rebate", {
    p_project_id: projectId,
    p_sections: sections && sections.length ? [...sections] : null,
  });
  const out = data ?? { project_id: projectId, currency: "SAR" };
  // db/pending/201: budget by region = estimate vs actual (line region, else
  // the project default). Older databases keep the 197 actual-only rows.
  if (out.budget && (!sections || sections.length === 0 || sections.includes("budget"))) {
    try {
      const rows = await call<any[]>("get_budget_by_region", {
        p_project_id: uuid.parse(projectId),
      });
      out.budget = {
        ...out.budget,
        by_region: (rows ?? []).map((r) => ({
          region: String(r.region),
          estimate: Number(r.estimate_sar) || 0,
          actual_total: Number(r.actual_sar) || 0,
          actual_qpe: Number(r.actual_qpe_sar) || 0,
          variance: Number(r.variance_sar) || 0,
        })),
      };
    } catch {
      /* get_budget_by_region not deployed yet */
    }
  }
  return out;
}

export function useFilmCommissionRebate(projectId: string | null, sections?: readonly string[]) {
  return useQuery({
    queryKey: rebateKeys.report(projectId, (sections ?? ["all"]).join(",")),
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: () => fetchFilmCommissionRebate(projectId as string, sections),
  });
}

export function useInvalidateRebate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: rebateKeys.all });
}

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);

export async function suggestQpeMapping(projectId: string): Promise<number> {
  return call<number>("suggest_qpe_mapping", { p_project_id: uuid.parse(projectId) });
}

const mappingInput = z
  .object({
    projectId: uuid,
    code: text(20).min(1),
    category: z.enum(QPE_CATEGORIES).nullable(),
    reason: z.enum(INELIGIBLE_REASONS).nullable(),
    note: text(1000).optional(),
    changeReason: text(1000).optional(),
  })
  .refine((v) => (v.category == null) !== (v.reason == null), {
    message: "category_or_reason",
  });

export async function setQpeMapping(input: z.input<typeof mappingInput>) {
  const v = mappingInput.parse(input);
  return call("set_qpe_mapping", {
    p_project_id: v.projectId,
    p_budget_code: v.code,
    p_category: v.category,
    p_reason: v.reason,
    p_note: v.note || null,
    p_change_reason: v.changeReason || null,
  });
}

const SOURCES = ["invoice", "payroll", "petty_cash", "overtime", "per_diem"] as const;
const overrideInput = z.object({
  projectId: uuid,
  sourceType: z.enum(SOURCES),
  sourceId: uuid,
  eligible: z.boolean(),
  category: z.enum(QPE_CATEGORIES).nullable().optional(),
  ineligibleReason: z.enum(INELIGIBLE_REASONS).nullable().optional(),
  reason: text(1000).min(5),
});

export async function setQpeOverride(input: z.input<typeof overrideInput>) {
  const v = overrideInput.parse(input);
  return call("set_qpe_override", {
    p_project_id: v.projectId,
    p_source_type: v.sourceType,
    p_source_id: v.sourceId,
    p_eligible: v.eligible,
    p_category: v.eligible ? (v.category ?? null) : null,
    p_ineligible_reason: v.eligible ? null : (v.ineligibleReason ?? "other"),
    p_reason: v.reason,
  });
}

export async function clearQpeOverride(input: {
  projectId: string;
  sourceType: RebateSource;
  sourceId: string;
  reason: string;
}) {
  const v = overrideInput
    .pick({ projectId: true, sourceType: true, sourceId: true, reason: true })
    .parse(input);
  return call<number>("clear_qpe_override", {
    p_project_id: v.projectId,
    p_source_type: v.sourceType,
    p_source_id: v.sourceId,
    p_reason: v.reason,
  });
}
