// ═══════════════════════════════════════════════════════════════════
// src/lib/permissions/queries.ts
// TanStack Query wiring for the Permission State Layer.
//
// Fetches the caller's resolved role × module matrix from the
// organization-aware SECURITY DEFINER function
// public.get_my_permissions(p_org_id, p_project_id) (granted to
// `authenticated`; every row is scoped to auth.uid() server-side, so
// the browser client can call it directly and safely).
//
// The payload is validated with zod before it ever touches UI state —
// a malformed response throws and the provider fails closed.
// ═══════════════════════════════════════════════════════════════════

import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import type { MyPermissionsPayload } from "./types";

const RoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  layout_type: z.enum(["operational", "executive"]),
  is_admin: z.boolean(),
});

const ModulePermissionSchema = z.object({
  module_key: z.string(),
  label: z.string(),
  icon: z.string().nullable(),
  route_path: z.string().nullable(),
  parent_key: z.string().nullable(),
  sort_order: z.number(),
  can_view: z.boolean(),
  can_create: z.boolean(),
  can_edit: z.boolean(),
  can_delete: z.boolean(),
  can_export: z.boolean(),
});

const PayloadSchema = z.object({
  role: RoleSchema.nullable(),
  permissions: z.array(ModulePermissionSchema),
});

export const permissionsKeys = {
  all: ["permissions"] as const,
  mine: (orgId: string | null = null, projectId: string | null = null) =>
    [...permissionsKeys.all, "me", orgId, projectId] as const,
};

/** Active scope from the store (null-safe; no active project on Main Hub). */
function activeScope() {
  const s = useStore.getState();
  const projectId = s.activeProjectId ?? null;
  let orgId = projectId
    ? (s.projects.find((p) => p.id === projectId)?.organizationId ?? null)
    : null;
  // No active project (Main Hub / Platform Hub): borrow the org of any
  // loaded project so org-level resolution still has a context. Super
  // admins short-circuit inside the RPC regardless of which org this is.
  if (!orgId) {
    orgId = s.projects.find((p) => p.organizationId)?.organizationId ?? null;
  }
  return { orgId, projectId };
}

/**
 * Loads the caller's permission payload for the ACTIVE organization/project
 * scope. The RPC is organization-aware: super admins short-circuit inside it
 * regardless of scope; everyone else resolves through org membership +
 * scoped role assignment.
 *
 * SCOPE GUARD (no casts, no fake ids): the RPC is never called without a
 * resolved organization — the single exception is the platform owner, whose
 * Layer 1 short-circuit ignores scope entirely. A non-super-admin user with
 * no resolvable org gets a typed no-scope payload (role null, no
 * permissions); downstream that is the rollout bridge, never a denial or an
 * error screen. While this query is pending, PermissionProvider renders the
 * skeleton — never a lock screen. RPC/validation failures still throw
 * (fail closed).
 */
async function fetchMyPermissions(): Promise<MyPermissionsPayload> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { role: null, permissions: [], isSuperAdmin: false };

  // Resolve super-admin FIRST: the platform-owner layer needs no org scope.
  // Best-effort bridge — if this call fails we simply don't elevate.
  const superRes = await supabase.rpc("is_super_admin", { _uid: user.id });
  const isSuperAdmin = superRes.error ? false : Boolean(superRes.data);

  const scope = activeScope();
  let orgId = scope.orgId;
  if (!orgId) {
    const { data: mems } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1);
    orgId = mems?.[0]?.organization_id ?? null;
  }

  // Guard: no org + not platform owner → typed no-scope, RPC not executed.
  if (!orgId && !isSuperAdmin) {
    return { role: null, permissions: [], isSuperAdmin };
  }

  // Only include keys that are actually resolved — undefined falls through
  // to the SQL DEFAULT NULL; null is never sent.
  const args: { p_org_id?: string; p_project_id?: string } = {};
  if (orgId) args.p_org_id = orgId;
  if (orgId && scope.projectId) args.p_project_id = scope.projectId;

  const permsRes = await supabase.rpc("get_my_permissions", args);
  if (permsRes.error) throw permsRes.error;

  const parsed = PayloadSchema.parse(permsRes.data ?? { role: null, permissions: [] });
  return {
    role: parsed.role,
    permissions: parsed.permissions,
    isSuperAdmin,
  };
}

export function myPermissionsQueryOptions() {
  const scope = activeScope();
  return queryOptions({
    queryKey: permissionsKeys.mine(scope.orgId, scope.projectId),
    queryFn: fetchMyPermissions,
    // NOTE on `enabled`: org scope resolves asynchronously on project-less
    // screens (Main Hub store load, membership fallback), so a synchronous
    // `enabled: !!orgId` would strand those users on an eternal skeleton.
    // The guard lives in fetchMyPermissions instead — the RPC never runs
    // without an org, and pending always renders the skeleton.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}
