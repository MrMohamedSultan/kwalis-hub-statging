import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DEMO_EMAIL = "demo@kwalishub.com";

/**
 * The demo account password lives in the server environment
 * (DEMO_ACCOUNT_PASSWORD, see .env.example) — never in the code. Read it only
 * inside a handler; it is never logged, audited or returned to the browser.
 */
function demoPassword(): string {
  const pw = (process.env.DEMO_ACCOUNT_PASSWORD ?? "").trim();
  if (pw.length < 12) throw new Error("Demo mode is not configured on this server.");
  return pw;
}
const DEMO_ORG_SLUG = "demo-kwalishub";

async function findAuthUserByEmail(supabaseAdmin: any, email: string) {
  const normalized = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((u: any) => (u.email ?? "").toLowerCase() === normalized);
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function upsertDemoAuthUser(supabaseAdmin: any, password: string) {
  const existing = await findAuthUserByEmail(supabaseAdmin, DEMO_EMAIL);
  if (existing) {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      ban_duration: "none",
      user_metadata: { display_name: "KwalisHUB Demo" },
    });
    if (error) throw error;
    return data.user?.id ?? existing.id;
  }

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { display_name: "KwalisHUB Demo" },
  });
  if (createErr) {
    const refetched = await findAuthUserByEmail(supabaseAdmin, DEMO_EMAIL);
    if (refetched) return upsertDemoAuthUser(supabaseAdmin, password);
    throw createErr;
  }
  return created.user!.id;
}

async function verifyDemoPassword(password: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const probe = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { error } = await probe.auth.signInWithPassword({ email: DEMO_EMAIL, password });
  await probe.auth.signOut();
  if (error) throw error;
}

async function ensureDemoAccessRows(supabaseAdmin: any, demoUserId: string) {
  const { data: seedRes, error: seedErr } = await supabaseAdmin.rpc("seed_demo_data", {
    _demo_user_id: demoUserId,
  });
  if (seedErr) throw seedErr;
  const row = Array.isArray(seedRes) ? seedRes[0] : seedRes;
  const orgId = (row as { organization_id: string }).organization_id;
  const projId = (row as { project_id: string }).project_id;

  await supabaseAdmin
    .from("profiles")
    .upsert({ id: demoUserId, display_name: "KwalisHUB Demo" }, { onConflict: "id" });

  await supabaseAdmin.from("organization_members").delete().eq("user_id", demoUserId);
  await supabaseAdmin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: demoUserId, role: "member" });

  await supabaseAdmin.from("project_members").delete().eq("user_id", demoUserId);
  await supabaseAdmin
    .from("project_members")
    .insert({ project_id: projId, user_id: demoUserId, role: "member" });

  await supabaseAdmin.from("user_roles").delete().eq("user_id", demoUserId);
  await supabaseAdmin.from("user_roles").insert({ user_id: demoUserId, role: "member" });

  return { orgId, projId };
}

async function writeAudit(
  action: string,
  summary: string,
  severity: "info" | "warning" | "error",
  actorId: string | null,
  actorEmail: string | null,
  details: Record<string, unknown>,
  organizationId?: string | null,
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_logs").insert({
      category: "auth",
      action,
      summary,
      severity,
      entity: "demo_mode",
      actor_id: actorId,
      actor_email: actorEmail,
      organization_id: organizationId ?? null,
      details: details as any,
    });
  } catch (err) {
    console.warn("[demo] audit write failed", err);
  }
}

/**
 * Provisions the standalone Demo Mode account and dataset.
 * Super-admin only. Idempotent: re-runs wipe & reseed the demo org.
 */
export const provisionDemoAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;
    const actorEmail = ((claims as any)?.email as string | null) ?? null;
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _uid: userId });
    if (!isSuper) {
      await writeAudit(
        "demo.provision.denied",
        "Non super-admin attempted demo provision",
        "warning",
        userId,
        actorEmail,
        {},
      );
      throw new Error("Forbidden: super admins only.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const password = demoPassword();

    try {
      // 1) Find/create/reset the auth user
      const demoUserId = await upsertDemoAuthUser(supabaseAdmin, password);

      // 2) Seed org + project + demo data and isolate memberships
      const { orgId, projId } = await ensureDemoAccessRows(supabaseAdmin, demoUserId);

      // 3) Verify the credentials by attempting a real sign-in with an anon client
      let signInOk = false;
      let signInError: string | null = null;
      try {
        await verifyDemoPassword(password);
        signInOk = true;
      } catch (e) {
        signInError = e instanceof Error ? e.message : String(e);
      }

      await writeAudit(
        signInOk ? "demo.provision.success" : "demo.provision.warning",
        signInOk
          ? `Demo account reseeded and sign-in verified (${DEMO_EMAIL})`
          : `Demo account reseeded but sign-in verification failed: ${signInError}`,
        signInOk ? "info" : "warning",
        userId,
        actorEmail,
        {
          demo_user_id: demoUserId,
          project_id: projId,
          sign_in_ok: signInOk,
          sign_in_error: signInError,
        },
        orgId,
      );

      if (!signInOk) {
        throw new Error(
          `Demo account was provisioned but sign-in verification failed: ${signInError ?? "unknown"}`,
        );
      }

      return {
        ok: true,
        email: DEMO_EMAIL,
        organizationId: orgId,
        projectId: projId,
        signInVerified: signInOk,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await writeAudit(
        "demo.provision.error",
        `Demo provision failed: ${msg}`,
        "error",
        userId,
        actorEmail,
        { error: msg },
      );
      throw err;
    }
  });

/**
 * Public self-healing path for the presentation demo login only.
 * It does not accept user input and can only create/reset the fixed demo account.
 */
export const ensureDemoSignInReady = createServerFn({ method: "POST" }).handler(async () => {
  let password: string;
  try {
    password = demoPassword();
  } catch {
    return { ok: false, email: DEMO_EMAIL, provisioned: false };
  }
  // Cheap-fail: if the demo account already exists and its password verifies,
  // do no privileged work at all. This keeps the public endpoint from being
  // usable to trigger admin writes / audit spam by repeated calls.
  try {
    await verifyDemoPassword(password);
    return { ok: true, email: DEMO_EMAIL, provisioned: false };
  } catch {
    // fall through to provisioning
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const demoUserId = await upsertDemoAuthUser(supabaseAdmin, password);
  const { orgId, projId } = await ensureDemoAccessRows(supabaseAdmin, demoUserId);
  await verifyDemoPassword(password);
  await writeAudit(
    "demo.auto_auth_ready",
    `Demo account auto-provisioned from sign-in (${DEMO_EMAIL})`,
    "info",
    null,
    DEMO_EMAIL,
    { demo_user_id: demoUserId, project_id: projId },
    orgId,
  );
  return { ok: true, email: DEMO_EMAIL, provisioned: true };
});

/**
 * Runs RLS isolation checks against the live demo user. Signs in as the demo
 * user with a fresh anon client, then confirms:
 *   - Demo user is a member of ONLY the KwalisHUB Showcase org.
 *   - Demo user cannot read any organizations, invoices, vendors, budget_lines,
 *     crew_members, or people rows outside that org.
 * Super-admin only. Records the result to audit_logs.
 */
export const verifyDemoIsolation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;
    const actorEmail = ((claims as any)?.email as string | null) ?? null;
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _uid: userId });
    if (!isSuper) throw new Error("Forbidden: super admins only.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createClient } = await import("@supabase/supabase-js");

    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;

    // Resolve demo org id
    const { data: demoOrg, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .select("id, name")
      .eq("slug", DEMO_ORG_SLUG)
      .maybeSingle();
    if (orgErr) throw new Error(orgErr.message);
    if (!demoOrg) throw new Error("Demo organization not found. Run 'Seed Demo Data' first.");

    // Pick a foreign org (any org that is NOT the demo org) to prove isolation
    const { data: otherOrgs } = await supabaseAdmin
      .from("organizations")
      .select("id, name")
      .neq("id", demoOrg.id)
      .limit(5);

    const asDemo = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { error: signInErr } = await asDemo.auth.signInWithPassword({
      email: DEMO_EMAIL,
      password: demoPassword(),
    });
    if (signInErr) throw new Error(`Demo sign-in failed: ${signInErr.message}`);

    const checks: Array<{ name: string; passed: boolean; detail: string }> = [];

    // 1) Membership: demo user must belong ONLY to the demo org
    const { data: memberships } = await asDemo
      .from("organization_members")
      .select("organization_id");
    const memberOrgIds = (memberships ?? []).map((m: any) => m.organization_id);
    const membershipOk = memberOrgIds.length === 1 && memberOrgIds[0] === demoOrg.id;
    checks.push({
      name: "Membership scoped to KwalisHUB Showcase",
      passed: membershipOk,
      detail: `visible memberships: ${memberOrgIds.length}`,
    });

    // 2) Demo user can only see the demo organization row
    const { data: visibleOrgs } = await asDemo.from("organizations").select("id, name");
    const visibleOrgIds = (visibleOrgs ?? []).map((o: any) => o.id);
    const orgsOk = visibleOrgIds.length === 1 && visibleOrgIds[0] === demoOrg.id;
    checks.push({
      name: "Cannot enumerate foreign organizations",
      passed: orgsOk,
      detail: `visible orgs: ${(visibleOrgs ?? []).map((o: any) => o.name).join(", ") || "none"}`,
    });

    // 3) Resolve the Showcase project so we can prove positive project_id visibility
    const { data: showcaseProject } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("organization_id", demoOrg.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const showcaseProjectId = showcaseProject?.id ?? null;

    // Pick a foreign project (any project NOT in the demo org) to prove hidden real projects
    const { data: foreignProjects } = await supabaseAdmin
      .from("projects")
      .select("id, name, organization_id")
      .neq("organization_id", demoOrg.id)
      .limit(3);
    const foreignProjectIds = (foreignProjects ?? []).map((p: any) => p.id);

    const scopedTables = ["invoices", "vendors", "budget_lines", "crew_members", "people"] as const;

    // 3a) POSITIVE — Showcase project_id data IS visible to demo
    if (showcaseProjectId) {
      for (const t of scopedTables) {
        const { count, error } = await asDemo
          .from(t)
          .select("*", { count: "exact", head: true })
          .eq("project_id", showcaseProjectId);
        checks.push({
          name: `Showcase project data visible in "${t}"`,
          passed: !error && (count ?? 0) > 0,
          detail: error ? `error: ${error.message}` : `showcase rows visible: ${count ?? 0}`,
        });
      }
    } else {
      checks.push({
        name: "Showcase project exists",
        passed: false,
        detail: "no Showcase project found — run Seed Demo Data first",
      });
    }

    // 3b) NEGATIVE — Zero rows for foreign organizations
    for (const t of scopedTables) {
      const { count, error } = await asDemo
        .from(t)
        .select("*", { count: "exact", head: true })
        .neq("organization_id", demoOrg.id);
      checks.push({
        name: `No cross-tenant read on "${t}"`,
        passed: !error && (count ?? 0) === 0,
        detail: error ? `error: ${error.message}` : `foreign rows visible: ${count ?? 0}`,
      });
    }

    // 3c) NEGATIVE — Real project_ids remain hidden (in operator per-project probe)
    if (foreignProjectIds.length > 0) {
      for (const t of scopedTables) {
        const { count, error } = await asDemo
          .from(t)
          .select("*", { count: "exact", head: true })
          .in("project_id", foreignProjectIds);
        checks.push({
          name: `Real projects hidden in "${t}"`,
          passed: !error && (count ?? 0) === 0,
          detail: error ? `error: ${error.message}` : `real-project rows leaked: ${count ?? 0}`,
        });
      }
    }

    // 4) Write-attempt: try to insert into a foreign org (should be blocked)
    if (otherOrgs && otherOrgs.length > 0) {
      const target = otherOrgs[0];
      const { error: writeErr } = await asDemo.from("vendors").insert({
        organization_id: target.id,
        name: `__rls_probe_${Date.now()}`,
      });
      checks.push({
        name: `Blocked write into foreign org (${target.name})`,
        passed: !!writeErr,
        detail: writeErr
          ? `RLS rejected: ${writeErr.code ?? writeErr.message}`
          : "WRITE ALLOWED (leak!)",
      });
    }

    await asDemo.auth.signOut();

    const passed = checks.every((c) => c.passed);
    await writeAudit(
      passed ? "demo.rls_verify.pass" : "demo.rls_verify.fail",
      passed ? "Demo RLS isolation verified" : "Demo RLS isolation FAILED",
      passed ? "info" : "error",
      userId,
      actorEmail,
      { checks, foreign_orgs_probed: (otherOrgs ?? []).map((o) => o.name) },
      demoOrg.id,
    );

    return { ok: passed, checks };
  });
