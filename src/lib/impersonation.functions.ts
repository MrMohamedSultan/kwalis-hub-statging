import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Super Admin → Tenant Impersonation.
 *
 * Server-side authority: the browser cannot start an impersonation session on
 * its own. Every start/stop is validated by this server function, which:
 *   1. Requires an authenticated Supabase session (via requireSupabaseAuth).
 *   2. Verifies the caller has the `super_admin` role in `user_roles`
 *      (checked via `is_super_admin` — the same predicate RLS uses).
 *   3. Writes a row to `audit_logs` so every support-access session is
 *      permanently recorded and viewable in the Audit Log module.
 *
 * This is defense-in-depth on top of the DB layer:
 *   - RLS on `projects` / `organizations` still enforces per-org isolation.
 *   - `listProjectsForActiveOrg` already ignores the impersonation override
 *     when the caller is not a super admin.
 *   - But now a non-super-admin user cannot even *set* the local override —
 *     the client refuses to write it unless this server function returns OK.
 */

const StartSchema = z.object({
  targetOrgId: z.string().uuid(),
});

const StopSchema = z.object({
  targetOrgId: z.string().uuid().nullable(),
  targetOrgName: z.string().max(200).nullable(),
});

async function requireSuperAdmin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("is_super_admin", { _uid: userId });
  if (error) {
    throw new Error(`Failed to verify permissions: ${error.message}`);
  }
  if (data !== true) {
    throw new Error(
      "Forbidden: only the System Owner / Super Admin may start an impersonation session.",
    );
  }
}

export const startImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StartSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    await requireSuperAdmin(supabase, userId);

    // Resolve the target org name for the audit trail and banner.
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("id,name")
      .eq("id", data.targetOrgId)
      .maybeSingle();

    if (orgErr) throw new Error(orgErr.message);
    if (!org) throw new Error("Target organization not found.");

    const actorEmail = (claims?.email as string | undefined) ?? null;

    const { error: logErr } = await supabase.from("audit_logs").insert({
      action: "impersonation.start",
      category: "security",
      severity: "warning",
      summary: `Super Admin started impersonation of ${org.name}`,
      entity: "organization",
      organization_id: org.id,
      actor_id: userId,
      actor_email: actorEmail,
      details: {
        target_org_id: org.id,
        target_org_name: org.name,
      },
    });
    if (logErr) throw new Error(logErr.message);

    return { orgId: org.id as string, orgName: org.name as string };
  });

export const stopImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StopSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    // Also require super_admin to log stop events — a non-super-admin could
    // never have started one anyway, but this keeps the audit table trusted.
    await requireSuperAdmin(supabase, userId);

    const actorEmail = (claims?.email as string | undefined) ?? null;
    const { error } = await supabase.from("audit_logs").insert({
      action: "impersonation.stop",
      category: "security",
      severity: "info",
      summary: data.targetOrgName
        ? `Super Admin exited impersonation of ${data.targetOrgName}`
        : "Super Admin exited impersonation",
      entity: "organization",
      organization_id: data.targetOrgId,
      actor_id: userId,
      actor_email: actorEmail,
      details: {
        target_org_id: data.targetOrgId,
        target_org_name: data.targetOrgName,
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
