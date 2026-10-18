import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getAuthRolesSnapshot,
  peekAuthRoles,
  useAuthRoles,
  type AuthRolesSnapshot,
} from "@/lib/auth-roles";
import { BOARD_LANDING, entryRedirectFor, isBoardMember } from "@/lib/landing-redirect";
import { PROJECT_GATEWAY_PATH, isProjectScopedRoute } from "@/lib/project-gateway";
import {
  getProjectRoleSnapshot,
  isPathAllowedForSnapshot,
  peekProjectRole,
  type ProjectRoleSnapshot,
} from "@/lib/project-role";
import { PermissionProvider, PermissionLoadingScreen } from "@/lib/permissions/PermissionProvider";
import { usePermissions } from "@/lib/permissions/usePermissions";
import { myPermissionsQueryOptions } from "@/lib/permissions/queries";
import { buildPermissionState, can, type PermissionState } from "@/lib/permissions/types";
import { moduleKeyForPath } from "@/lib/permissions/route-modules";
import {
  EXECUTIVE_HOME,
  NO_ACCESS_PATH,
  firstViewableModulePath,
  isExecutivePath,
} from "@/lib/permissions/landing";
import {
  canEnterExecutiveWorkMode,
  isExecutiveWorkMode,
  useExecutiveWorkMode,
} from "@/lib/executive-work-mode";
import { ExecutiveLayout } from "@/components/layouts/ExecutiveLayout";
import { OperationalLayout } from "@/components/layouts/OperationalLayout";
import i18n from "@/lib/i18n";
import { useStore } from "@/lib/store";

/** Active project + its organization, read synchronously from the store. */
function activeProjectScope() {
  const storeState = useStore.getState();
  const activeProjectId = storeState.activeProjectId ?? null;
  const organizationId = activeProjectId
    ? (storeState.projects.find((p) => p.id === activeProjectId)?.organizationId ?? null)
    : null;
  return { activeProjectId, organizationId };
}

/**
 * Pure gate evaluation. Every input is already resolved, so this runs
 * synchronously on warm navigations — no await means no pending screen and
 * therefore an instant sidebar tab switch.
 */
function evaluateGates(
  pathname: string,
  roles: AuthRolesSnapshot,
  perms: PermissionState | null,
  resolveProjectRole: () => ProjectRoleSnapshot | null,
): void {
  // Roles live in `user_roles`; platform owners never enter org chrome, and
  // board members belong to the isolated /board portal.
  if (isBoardMember(roles)) {
    throw redirect({ to: BOARD_LANDING as "/" });
  }
  const target = entryRedirectFor(pathname, roles);
  if (target) {
    throw redirect({ to: target as "/" });
  }

  // ── Phase 5 · Layer 1: Layout & Routing Isolation ─────────────────
  // Platform super admins keep their own shells. Users WITHOUT an RBAC
  // assignment (role === null) keep the legacy gateway behavior below.
  if (perms && !perms.isSuperAdmin && perms.role) {
    if (perms.role.layout_type === "executive") {
      const workMode =
        isExecutiveWorkMode(roles.userId) && canEnterExecutiveWorkMode(roles, perms);
      // Executives live in the read-only /executive workspace.
      if (!workMode && !isExecutivePath(pathname)) {
        throw redirect({ to: EXECUTIVE_HOME as "/" });
      }
      if (!workMode) return;

      // An explicit in-session return to work never elevates an executive-only
      // account. Non-admins remain limited to operational routes already
      // present in their server-resolved permission matrix.
      const privilegedOperationalAccess =
        roles.isAdmin || roles.adminOrgIds.length > 0 || roles.isSuperAdmin;
      const moduleKey = moduleKeyForPath(pathname);
      if (
        !privilegedOperationalAccess &&
        moduleKey &&
        !can(perms, moduleKey, "view") &&
        pathname !== PROJECT_GATEWAY_PATH
      ) {
        throw redirect({ to: EXECUTIVE_HOME as "/" });
      }
    } else {
      const firstModule = firstViewableModulePath(perms);
      if (!firstModule) {
        if (pathname !== NO_ACCESS_PATH) {
          throw redirect({ to: NO_ACCESS_PATH as "/" });
        }
        return;
      }
      if (pathname === NO_ACCESS_PATH) {
        throw redirect({ to: firstModule as "/" });
      }

      // ── Phase 6 · Layer 2: Dynamic Permission Matrix (route guards) ──
      const moduleKey = moduleKeyForPath(pathname);
      if (moduleKey && !can(perms, moduleKey, "view") && pathname !== firstModule) {
        toast.error(i18n.t("rbac.accessDenied"));
        throw redirect({ to: firstModule as "/" });
      }
    }
  }

  // Project Gateway isolation: every project-scoped tenant route requires an
  // explicit selection made on /main-hub.
  if (isProjectScopedRoute(pathname)) {
    const { activeProjectId } = activeProjectScope();
    if (!activeProjectId) {
      throw redirect({ to: PROJECT_GATEWAY_PATH as "/" });
    }
    const projectRole = resolveProjectRole();
    if (projectRole && !isPathAllowedForSnapshot(projectRole, pathname)) {
      toast.error(i18n.t("rbac.accessDenied"));
      throw redirect({ to: "/dashboard" as "/" });
    }
  }
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Only cold loads actually await anything; give them a short grace period so
  // warm navigations never flash the branded skeleton.
  pendingMs: 300,
  pendingMinMs: 0,
  pendingComponent: PermissionLoadingScreen,
  beforeLoad: ({ location, context }) => {
    // ── Fast path ──────────────────────────────────────────────────────
    // Everything the gate needs is already resolved in memory (role
    // snapshot, permission matrix in the Query cache, project-role cache),
    // so the whole check stays synchronous and the route renders instantly.
    const cachedRoles = peekAuthRoles();
    if (cachedRoles?.userId) {
      const cachedPerms = context.queryClient.getQueryData(myPermissionsQueryOptions().queryKey);
      const { activeProjectId, organizationId } = activeProjectScope();
      const cachedProjectRole = peekProjectRole(activeProjectId, cachedRoles, organizationId);
      if (cachedPerms && (cachedProjectRole || !isProjectScopedRoute(location.pathname))) {
        evaluateGates(
          location.pathname,
          cachedRoles,
          buildPermissionState(cachedPerms),
          () => cachedProjectRole,
        );
        return { userId: cachedRoles.userId };
      }
    }

    // ── Cold path ──────────────────────────────────────────────────────
    return (async () => {
      // Local session read — no Auth-server round-trip on every navigation.
      // This gate is UX-level; RLS remains the server-side enforcement.
      const { data, error } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      if (error || !user) {
        throw redirect({ to: "/auth" });
      }
      const roles = await getAuthRolesSnapshot();

      // Shares its TanStack Query key with the PermissionProvider, so the
      // snapshot fetch is deduped rather than doubled. On fetch failure we
      // skip enforcement here — the provider renders its fail-closed error
      // screen, so the user is never silently unlocked.
      let perms: PermissionState | null = null;
      try {
        perms = buildPermissionState(
          await context.queryClient.ensureQueryData(myPermissionsQueryOptions()),
        );
      } catch {
        perms = null;
      }

      let projectRole: ProjectRoleSnapshot | null = null;
      if (isProjectScopedRoute(location.pathname)) {
        const { activeProjectId, organizationId } = activeProjectScope();
        if (activeProjectId) {
          projectRole = await getProjectRoleSnapshot(activeProjectId, roles, organizationId);
        }
      }

      evaluateGates(location.pathname, roles, perms, () => projectRole);
      return { userId: user.id };
    })();
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    // Phase 4 Permission State Layer: gated chrome never renders until the
    // server-verified permission snapshot resolves (full-screen skeleton
    // inside the provider handles the loading race).
    <PermissionProvider>
      <LayoutIsolation>
        <Outlet />
      </LayoutIsolation>
    </PermissionProvider>
  );
}

/**
 * Phase 5 · Layer 1: the layout itself is derived from the server-verified
 * role — executives get the slim read-only chrome (zero sidebar), everyone
 * else keeps the operational app shell.
 */
function LayoutIsolation({ children }: { children: ReactNode }) {
  const permissions = usePermissions();
  const roles = useAuthRoles();
  const workMode = useExecutiveWorkMode(roles.userId);
  const operationalOverride =
    workMode && roles.loaded && canEnterExecutiveWorkMode(roles, permissions);
  if (permissions.isExecutive && !permissions.isSuperAdmin && !operationalOverride) {
    return <ExecutiveLayout>{children}</ExecutiveLayout>;
  }
  return <OperationalLayout>{children}</OperationalLayout>;
}
