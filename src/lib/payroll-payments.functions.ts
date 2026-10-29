import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePermission } from "@/lib/rbac-permissions.functions";
import { z } from "zod";
import { noInput } from "@/lib/server-input";

const payrollRowSchema = z.object({
  kind: z.enum(["vendor", "crew", "cast"]),
  in_process: z.boolean().default(false),
  company_name: z.string().max(200).nullable().optional(),
  invoice_link: z.string().max(500).nullable().optional(),
  beneficiary_name: z.string().min(1).max(200),
  iban: z.string().max(64).nullable().optional(),
  bank_name: z.string().max(120).nullable().optional(),
  bank_nationality: z.string().max(120).nullable().optional(),
  department: z.string().max(120).nullable().optional(),
  position_role: z.string().max(120).nullable().optional(),
  deal_notes: z.string().max(500).nullable().optional(),
  excludes_vat: z.number().default(0),
  currency: z.string().min(1).max(8).default("SAR"),
  scheduled_payments: z.array(z.number()).length(7),
  paid_payments: z.array(z.number()).length(7),
  reserved_budget_sar: z.number().default(0),
});

const insertSchema = z.object({
  organization_id: z.string().uuid(),
  project_id: z.string().uuid().nullable().optional(),
  rows: z.array(payrollRowSchema).min(1).max(500),
});

export const listMyOrganizations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(noInput)
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("organization_members")
      .select("organization_id, role, organizations(id, name)")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.organizations?.id ?? r.organization_id,
      name: r.organizations?.name ?? "(unknown)",
      role: r.role,
    }));
  });

export const importPayrollPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePermission("payroll.execute")])
  .inputValidator((input: unknown) => insertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const payload = data.rows.map((r) => ({
      ...r,
      organization_id: data.organization_id,
      project_id: data.project_id ?? null,
      created_by: context.userId,
    }));
    const { data: inserted, error } = await context.supabase
      .from("payroll_payments")
      .insert(payload)
      .select("id");
    if (error) throw new Error(error.message);
    return { inserted: inserted?.length ?? 0 };
  });

export const listPayrollPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { organization_id: string; kind?: "vendor" | "crew" | "cast" }) =>
    z
      .object({
        organization_id: z.string().uuid(),
        kind: z.enum(["vendor", "crew", "cast"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("payroll_payments")
      .select("*")
      .eq("organization_id", data.organization_id)
      .order("created_at", { ascending: false });
    if (data.kind) q = q.eq("kind", data.kind);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const deletePayrollPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePermission("payroll.execute")])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("payroll_payments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
