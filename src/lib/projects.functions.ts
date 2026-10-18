import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getServerSupabaseForToken } from "./supabase-singleton.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PROJECT_STATUSES, PROJECT_TYPES } from "@/lib/project-constants";

/**
 * Server-side "active organization" guard for project listings.
 *
 * Regardless of what the client asks for, this server function:
 *   1. Requires an authenticated session (via requireSupabaseAuth).
 *   2. Resolves the caller's set of accessible organization_ids from
 *      organization_members (RLS-checked as that user).
 *   3. If an activeOrgId is provided, VALIDATES the caller is a member
 *      of that org — otherwise falls back to the caller's primary org.
 *   4. Filters projects strictly by that organization_id.
 *
 * Platform-tier viewers (super_admin in user_roles) are allowed to pass
 * a null/any activeOrgId and receive the full list, so system owners can
 * still switch tenants from the UI.
 *
 * RLS on public.projects already enforces isolation at the DB layer; this
 * function is defense-in-depth so the *server* — not the client — decides
 * which org's projects are returned.
 */
export const listProjectsForActiveOrg = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({ activeOrgId: z.string().uuid().nullable().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }) => {
    // Auth is resolved inline (instead of a throwing middleware) so that a call
    // made before the browser session is hydrated degrades to an empty list
    // instead of a 500 that blanks the app shell.
    const authHeader = getRequest()?.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return { projects: [], activeOrgId: null, isPlatform: false };
    }

    const supabase = getServerSupabaseForToken(token);
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (claimsError || !userId) {
      return { projects: [], activeOrgId: null, isPlatform: false };
    }

    const [{ data: rolesData }, { data: memberships }, { data: projectMemberships }] =
      await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("organization_members").select("organization_id,role").eq("user_id", userId),
        supabase
          .from("project_members")
          .select("project_id,projects(organization_id)")
          .eq("user_id", userId),
      ]);

    const isPlatform = (rolesData ?? []).some((r: { role: string }) => r.role === "super_admin");
    const memberOrgIds = (memberships ?? [])
      .map((m: { organization_id: string }) => m.organization_id)
      .filter(Boolean);
    const assignments = (projectMemberships ?? [])
      .map((m: any) => ({
        projectId: m.project_id as string | null,
        orgId: (m.projects?.organization_id ?? null) as string | null,
      }))
      .filter((a) => !!a.projectId);

    let query = supabase
      .from("projects")
      .select(
        "id,name,code,status,project_type,currency,organization_id,production_kind,budget_status,fx_rate",
      )
      .neq("status", "Archived")
      .order("created_at", { ascending: false });

    if (isPlatform) {
      // Platform viewers may scope to a specific org, or fetch all.
      if (data.activeOrgId) query = query.eq("organization_id", data.activeOrgId);
    } else {
      // Regular users are ALWAYS locked to their memberships.
      if (memberOrgIds.length === 0) {
        return { projects: [], activeOrgId: null, isPlatform: false };
      }
      const resolvedOrgId =
        data.activeOrgId && memberOrgIds.includes(data.activeOrgId)
          ? data.activeOrgId
          : memberOrgIds[0];
      query = query.eq("organization_id", resolvedOrgId);

      // Project-level isolation: org OWNERS administer the whole tenant and keep
      // full visibility. Everyone else — including org admins — only sees the
      // projects they are explicitly assigned to. Safety valve: a user with no
      // assignments at all keeps org-wide visibility so nobody is locked out.
      const orgRole = (memberships ?? []).find(
        (m: { organization_id: string; role?: string | null }) =>
          m.organization_id === resolvedOrgId,
      )?.role;
      const assignedInOrg = Array.from(
        new Set(
          assignments.filter((a) => a.orgId === resolvedOrgId).map((a) => a.projectId as string),
        ),
      );
      if (orgRole !== "owner" && assignedInOrg.length > 0) {
        query = query.in("id", assignedInOrg);
      }
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const orgIds = Array.from(
      new Set(
        (rows ?? [])
          .map((r: any) => r.organization_id as string | null)
          .filter((x: string | null): x is string => !!x),
      ),
    );
    let orgNames = new Map<string, string>();
    if (orgIds.length > 0) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id,name")
        .in("id", orgIds);
      orgNames = new Map((orgs ?? []).map((o: any) => [o.id as string, o.name as string]));
    }

    return {
      projects: (rows ?? []).map((r: any) => ({
        id: r.id as string,
        name: r.name as string,
        code: (r.code ?? null) as string | null,
        status: r.status as string,
        projectType: (r.project_type ?? "Feature Film") as string,
        currency: (r.currency ?? "USD") as string,
        organizationId: r.organization_id as string | null,
        organizationName: r.organization_id ? (orgNames.get(r.organization_id) ?? null) : null,
        productionKind: (r.production_kind ?? "film") as string,
        budgetStatus: (r.budget_status ?? "Draft") as string,
        fxRate: Number(r.fx_rate ?? 3.75),
      })),
      activeOrgId: isPlatform ? (data.activeOrgId ?? null) : (memberOrgIds[0] ?? null),
      isPlatform,
    };
  });

export const updateActiveProjectSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        project_name: z.string().trim().min(1).max(120),
        project_type: z.enum(PROJECT_TYPES),
        currency: z.enum(["USD", "SAR", "EUR", "GBP", "AED"]),
        default_unit: z.enum(["Flat", "Day", "Week", "Month", "Split"]),
        project_status: z.enum(PROJECT_STATUSES),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id,organization_id")
      .eq("id", data.projectId)
      .maybeSingle();

    if (projectError) throw new Error(projectError.message);
    if (!project?.organization_id) {
      const err = new Error("Project not found");
      (err as Error & { status?: number }).status = 404;
      throw err;
    }

    const { data: isAllowed, error: adminError } = await context.supabase.rpc("is_admin", {
      p_org_id: project.organization_id,
      p_project_id: data.projectId,
    });

    if (adminError) throw new Error(adminError.message);
    if (!isAllowed) {
      const err = new Error("Forbidden: project settings require admin access");
      (err as Error & { status?: number }).status = 403;
      throw err;
    }

    const { data: updated, error } = await context.supabase
      .from("projects")
      .update({
        name: data.project_name,
        project_type: data.project_type,
        currency: data.currency,
        status: data.project_status,
      })
      .eq("id", data.projectId)
      .eq("organization_id", project.organization_id)
      .select("id,name,project_type,currency,status")
      .single();

    if (error) throw new Error(error.message);

    return {
      id: updated.id,
      projectName: updated.name,
      projectType: updated.project_type,
      currency: updated.currency,
      projectStatus: updated.status,
    };
  });

export const updateProjectProductionKind = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        productionKind: z.enum(["film", "series", "commercial"]),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id,organization_id")
      .eq("id", data.projectId)
      .maybeSingle();

    if (projectError) throw new Error(projectError.message);
    if (!project?.organization_id) {
      const err = new Error("Project not found");
      (err as Error & { status?: number }).status = 404;
      throw err;
    }

    const { data: isAllowed, error: adminError } = await context.supabase.rpc("is_admin", {
      p_org_id: project.organization_id,
      p_project_id: data.projectId,
    });

    if (adminError) throw new Error(adminError.message);
    if (!isAllowed) {
      const err = new Error("Forbidden: project settings require admin access");
      (err as Error & { status?: number }).status = 403;
      throw err;
    }

    const { error } = await context.supabase
      .from("projects")
      .update({ production_kind: data.productionKind })
      .eq("id", data.projectId)
      .eq("organization_id", project.organization_id);

    if (error) throw new Error(error.message);
    return { projectId: data.projectId, productionKind: data.productionKind };
  });

/**
 * Hard-delete a project. Allowed for organization owners/admins of the
 * project's org, and for platform super admins. RLS on public.projects
 * ("Org admins can delete projects") is the ultimate boundary; this check
 * is defense-in-depth so the server refuses before touching the row.
 */
export const deleteProjectHard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ projectId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id,name,organization_id")
      .eq("id", data.projectId)
      .maybeSingle();

    if (projectError) throw new Error(projectError.message);
    if (!project?.organization_id) {
      const err = new Error("Project not found");
      (err as Error & { status?: number }).status = 404;
      throw err;
    }

    const [{ data: isSuper, error: superError }, { data: isOrgAdmin, error: orgError }] =
      await Promise.all([
        context.supabase.rpc("is_super_admin", { _uid: context.userId }),
        context.supabase.rpc("is_org_admin", {
          _uid: context.userId,
          _org: project.organization_id,
        }),
      ]);

    if (superError) throw new Error(superError.message);
    if (orgError) throw new Error(orgError.message);
    if (!isSuper && !isOrgAdmin) {
      const err = new Error("Forbidden: only organization admins can delete a project");
      (err as Error & { status?: number }).status = 403;
      throw err;
    }

    const { error } = await context.supabase.from("projects").delete().eq("id", data.projectId);
    if (error) throw new Error(error.message);

    return { projectId: data.projectId, name: project.name as string };
  });
