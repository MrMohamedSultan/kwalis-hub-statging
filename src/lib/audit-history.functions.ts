import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  tableName: z.enum(["invoices", "payroll", "transactions", "crew_members", "people"]),
  recordId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(50),
});

export type AuditHistoryRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  operation: "INSERT" | "UPDATE" | "DELETE";
  changed_fields: Record<string, { from: string | null; to: string | null }>;
};

export const getAuditHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }): Promise<AuditHistoryRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("audit_history")
      .select("id, created_at, actor_id, operation, changed_fields")
      .eq("table_name", data.tableName)
      .eq("record_id", data.recordId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return [];

    // Resolve actor emails
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actorIds = Array.from(
      new Set(rows.map((r: any) => r.actor_id).filter(Boolean) as string[]),
    );
    const emailMap = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, display_name")
        .in("id", actorIds);
      for (const p of profiles ?? [])
        emailMap.set(p.id as string, (p.display_name as string) ?? "");
      // Fall back to auth emails for actors without a display name.
      // Page through listUsers instead of assuming everyone fits in one page.
      const missing = new Set(actorIds.filter((id) => !emailMap.get(id)));
      const perPage = 1000;
      for (let page = 1; missing.size > 0 && page <= 50; page += 1) {
        const { data: authList, error: authErr } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (authErr) break;
        const users = authList?.users ?? [];
        for (const u of users) {
          if (missing.has(u.id)) {
            emailMap.set(u.id, u.email ?? "");
            missing.delete(u.id);
          }
        }
        if (users.length < perPage) break;
      }
    }

    return rows.map((r: any) => {
      const raw = (r.changed_fields ?? {}) as Record<string, { from: unknown; to: unknown }>;
      const changed: Record<string, { from: string | null; to: string | null }> = {};
      for (const [k, v] of Object.entries(raw)) {
        changed[k] = {
          from:
            v?.from == null ? null : typeof v.from === "string" ? v.from : JSON.stringify(v.from),
          to: v?.to == null ? null : typeof v.to === "string" ? v.to : JSON.stringify(v.to),
        };
      }
      return {
        id: r.id,
        created_at: r.created_at,
        actor_id: r.actor_id,
        actor_email: r.actor_id ? (emailMap.get(r.actor_id) ?? null) : null,
        operation: r.operation,
        changed_fields: changed,
      };
    });
  });
