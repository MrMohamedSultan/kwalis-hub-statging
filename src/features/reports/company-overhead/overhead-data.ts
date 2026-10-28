// Data for Company Overhead (R25 / E04 / R11). Reads public.get_company_overhead
// (db/pending/198); writes project_overhead_staff (060) and
// project_overhead_items (198). Writes need Edit on "reports" (RLS).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { overheadTotals, type OverheadLine } from "./overhead-calc";

const from = (t: string) => (supabase.from as any)(t);
const n = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export const overheadKey = (projectId: string | null) => ["taxlive-overhead", projectId];

export function useCompanyOverhead(projectId: string | null) {
  return useQuery({
    queryKey: overheadKey(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: async (): Promise<OverheadLine[]> => {
      const { data, error } = await (supabase.rpc as any)("get_company_overhead", {
        p_project_id: projectId,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        monthly_amount: n(r.monthly_amount),
        pct_of_budget: n(r.pct_of_budget),
        allocation_pct: n(r.allocation_pct) ?? 100,
        months: n(r.months),
        amount: n(r.amount) ?? 0,
        project_budget: n(r.project_budget) ?? 0,
      }));
    },
  });
}

/**
 * R11 hook for the Cost Report: the overhead totals of the active project.
 * Returns null while loading or when the caller may not read reports, so
 * the Cost Report simply shows no overhead rows then.
 */
export function useCompanyOverheadTotals(projectId: string | null) {
  const q = useCompanyOverhead(projectId);
  return q.data ? overheadTotals(q.data) : null;
}

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const code = z
  .string()
  .trim()
  .max(64)
  .transform((v) => v || null)
  .nullable();
const notes = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => v || null)
  .nullable();

export const staffSchema = z
  .object({
    employee_name: z.string().trim().min(1).max(200),
    position: z
      .string()
      .trim()
      .max(200)
      .transform((v) => v || null)
      .nullable(),
    monthly_cost: z.number().min(0).max(1e9),
    allocation_pct: z.number().gt(0).max(100),
    start_date: iso,
    end_date: iso,
    budget_code: code,
    notes,
  })
  .refine((v) => v.end_date >= v.start_date, { path: ["end_date"] });
export type StaffInput = z.input<typeof staffSchema>;

export const itemSchema = z
  .object({
    kind: z.enum(["office_rent", "equipment"]),
    label: z.string().trim().min(1).max(200),
    basis: z.enum(["monthly", "pct_budget"]),
    monthly_amount: z.number().min(0).max(1e9).nullable(),
    pct_of_budget: z.number().min(0).max(100).nullable(),
    allocation_pct: z.number().gt(0).max(100),
    start_date: iso.nullable(),
    end_date: iso.nullable(),
    budget_code: code,
    notes,
  })
  .refine(
    (v) =>
      v.basis === "pct_budget"
        ? v.pct_of_budget != null
        : v.monthly_amount != null && !!v.start_date && !!v.end_date && v.end_date >= v.start_date,
    { path: ["basis"] },
  );
export type ItemInput = z.input<typeof itemSchema>;

export function useOverheadMutations(projectId: string | null, organizationId: string | null) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: overheadKey(projectId) });
  const scope = () => ({
    project_id: z.string().uuid().parse(projectId),
    organization_id: z.string().uuid().parse(organizationId),
  });
  return {
    addStaff: async (input: StaffInput) => {
      const v = staffSchema.parse(input);
      const { error } = await from("project_overhead_staff").insert({ ...v, ...scope() });
      if (error) throw error;
      await done();
    },
    addItem: async (input: ItemInput) => {
      const v = itemSchema.parse(input);
      const row = {
        ...v,
        monthly_amount: v.basis === "monthly" ? v.monthly_amount : null,
        pct_of_budget: v.basis === "pct_budget" ? v.pct_of_budget : null,
      };
      const { error } = await from("project_overhead_items").insert({ ...row, ...scope() });
      if (error) throw error;
      await done();
    },
    /** Soft delete (the tables keep the row and its audit trail). */
    remove: async (kind: OverheadLine["kind"], id: string) => {
      const table = kind === "staff" ? "project_overhead_staff" : "project_overhead_items";
      const { error } = await from(table)
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", z.string().uuid().parse(id))
        .eq("project_id", z.string().uuid().parse(projectId));
      if (error) throw error;
      await done();
    },
  };
}
