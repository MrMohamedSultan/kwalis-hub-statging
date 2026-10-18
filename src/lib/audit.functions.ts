import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const categorySchema = z.enum(["import", "validation", "schema", "auth", "other"]);
const severitySchema = z.enum(["info", "warning", "error"]);

const logSchema = z.object({
  category: categorySchema,
  action: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  severity: severitySchema.default("info"),
  entity: z.string().max(120).nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  details: z.record(z.any()).optional(),
});

const listSchema = z.object({
  organization_id: z.string().uuid().nullable().optional(),
  category: categorySchema.nullable().optional(),
  severity: severitySchema.nullable().optional(),
  search: z.string().max(200).nullable().optional(),
  action: z.string().max(200).nullable().optional(),
  user: z.string().max(200).nullable().optional(),
  start_date: z.string().max(40).nullable().optional(),
  end_date: z.string().max(40).nullable().optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

export const logAuditEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => logSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("audit_logs").insert({
      category: data.category,
      action: data.action,
      summary: data.summary,
      severity: data.severity ?? "info",
      entity: data.entity ?? null,
      organization_id: data.organization_id ?? null,
      project_id: data.project_id ?? null,
      details: data.details ?? {},
      actor_id: context.userId,
      actor_email: (context.claims as any)?.email ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAuditEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("audit_logs")
      .select(
        "id, created_at, organization_id, project_id, actor_id, actor_email, category, action, severity, entity, summary, details",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.organization_id) q = q.eq("organization_id", data.organization_id);
    if (data.category) q = q.eq("category", data.category);
    if (data.severity) q = q.eq("severity", data.severity);
    if (data.search && data.search.trim()) {
      const s = `%${data.search.trim()}%`;
      q = q.or(`summary.ilike.${s},action.ilike.${s},entity.ilike.${s},actor_email.ilike.${s}`);
    }
    if (data.action && data.action.trim()) q = q.ilike("action", `%${data.action.trim()}%`);
    if (data.user && data.user.trim()) q = q.ilike("actor_email", `%${data.user.trim()}%`);
    if (data.start_date) q = q.gte("created_at", data.start_date);
    if (data.end_date) q = q.lte("created_at", data.end_date);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
