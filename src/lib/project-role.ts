// ═══════════════════════════════════════════════════════════════════
// src/lib/project-role.ts — Project-scoped role snapshot (legacy fallback)
//
// The primary permission engine is the dynamic RBAC matrix
// (src/lib/permissions/*). This module remains as the pre-matrix fallback
// for users with no RBAC role assignment: it resolves the caller's
// membership role inside the ACTIVE project and narrows the tenant shell
// (sidebar sections + route prefixes) accordingly.
//
// The per-project permission matrix (project_role_permissions) was removed
// in Phase 9 — module visibility for the fallback path is derived from the
// static PROJECT_ROLE_SECTIONS map below.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { useAuthRoles, type AuthRolesSnapshot } from "@/lib/auth-roles";
import { SIDEBAR_SECTIONS, SERIES_NAV_ITEM } from "@/config/navigation";

export type ProjectRole = "owner" | "admin" | "accountant" | "producer" | "coordinator" | "member";

export const PROJECT_ROLES: ProjectRole[] = [
  "owner",
  "admin",
  "accountant",
  "producer",
  "coordinator",
  "member",
];

/**
 * Which sidebar sections each project role may see. `null` = unrestricted.
 * Coordinators are limited to Overview + Payroll & Crew (timesheets,
 * per diem, transport…) — they must not see budgets, payables, treasury,
 * or admin surfaces.
 */
export const PROJECT_ROLE_SECTIONS: Record<ProjectRole, string[] | null> = {
  owner: null,
  admin: null,
  accountant: null,
  producer: null,
  member: null,
  coordinator: ["overview", "payroll-crew"],
};

/**
 * Route prefixes a role may NOT visit (defense-in-depth alongside the
 * sidebar filter — a Coordinator typing /budget directly is bounced).
 * `null` = unrestricted.
 */
const PROJECT_ROLE_BLOCKED_PREFIXES: Record<ProjectRole, string[] | null> = {
  owner: null,
  admin: null,
  accountant: null,
  producer: null,
  member: null,
  coordinator: [
    "/budget",
    "/top-sheet-report",
    "/budget-reconciliation",
    "/reports",
    "/vendors",
    "/purchase-orders",
    "/invoices",
    "/vendor-payables",
    "/crew-cast-payables",
    "/payment-approvals",
    "/petty-cash",
    "/funding",
    "/gl-accounts",
    "/locations",
    "/production-timeline",
    "/daily-transport",
    "/accommodation-roster",
    "/car-rentals",
    "/picture-assets",
    "/characters",
    "/series",
    "/project-files",
    "/audit-log",
    "/timeline-task-dictionary",
  ],
};

/**
 * Prefixes every authenticated user may visit regardless of role —
 * identity, notifications, support, and the "no access" explainer page.
 */
const ALWAYS_ALLOWED_PREFIXES: string[] = [
  "/dashboard",
  "/main-hub",
  "/account-settings",
  "/notifications",
  "/settings",
  "/support",
  "/no-access",
];

/** Sidebar module id → owning section id (children included). */
const MODULE_SECTION: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const section of SIDEBAR_SECTIONS) {
    for (const item of section.items) {
      map[item.id] = section.id;
      for (const child of item.children ?? []) {
        map[child.id] = section.id;
      }
    }
  }
  map[SERIES_NAV_ITEM.id] = "scripts";
  return map;
})();

/** Blocked prefixes for a role (empty array when unrestricted). */
export function restrictedPrefixesFor(role: ProjectRole): string[] {
  return PROJECT_ROLE_BLOCKED_PREFIXES[role] ?? [];
}

/** Is `pathname` allowed for `role`? Unknown prefixes are allowed. */
export function isPathAllowedForProjectRole(pathname: string, role: ProjectRole): boolean {
  const blocked = restrictedPrefixesFor(role);
  if (blocked.length === 0) return true;
  if (ALWAYS_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return true;
  }
  return !blocked.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Is a sidebar section visible for `role`? */
export function isSectionAllowedForProjectRole(sectionId: string, role: ProjectRole): boolean {
  const allow = PROJECT_ROLE_SECTIONS[role];
  if (!allow) return true;
  return allow.includes(sectionId);
}

// ─── Snapshot (cached, auth-aware) ──────────────────────────────────

export interface ProjectRoleSnapshot {
  /** True once the initial fetch has completed (role may still be null). */
  loaded: boolean;
  userId: string | null;
  projectId: string | null;
  /** null = unrestricted (no membership row, admin, or signed out). */
  role: ProjectRole | null;
}

const EMPTY: ProjectRoleSnapshot = { loaded: false, userId: null, projectId: null, role: null };

let cache: ProjectRoleSnapshot = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setCache(next: ProjectRoleSnapshot) {
  cache = next;
  emit();
}

/** Drop the cached snapshot (called on sign-out and project switch). */
export function invalidateProjectRoles() {
  cache = EMPTY;
  emit();
}

/**
 * Awaitable snapshot for route guards and components.
 *
 * `roles` is the DB-trusted auth snapshot — platform super admins, global
 * admins, and admins/owners of the project's organization are always
 * unrestricted (role → null) without hitting project_members.
 */
export async function getProjectRoleSnapshot(
  activeProjectId: string | null,
  roles: AuthRolesSnapshot,
  organizationId: string | null,
): Promise<ProjectRoleSnapshot> {
  const userId = roles.userId;
  if (!userId || !activeProjectId) {
    return { loaded: true, userId, projectId: activeProjectId, role: null };
  }
  if (
    roles.isSuperAdmin ||
    roles.isAdmin ||
    (organizationId !== null && roles.adminOrgIds.includes(organizationId))
  ) {
    const snap: ProjectRoleSnapshot = {
      loaded: true,
      userId,
      projectId: activeProjectId,
      role: null,
    };
    cache = snap;
    return snap;
  }
  if (cache.userId === userId && cache.projectId === activeProjectId && cache.loaded) {
    return cache;
  }
  const { data, error } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", activeProjectId)
    .eq("user_id", userId)
    .maybeSingle();
  // Fail open on read errors (RLS already scopes rows); the route guard
  // still blocks restricted prefixes for known-restricted roles only.
  const role = (!error && data?.role ? data.role : null) as ProjectRole | null;
  const snap: ProjectRoleSnapshot = { loaded: true, userId, projectId: activeProjectId, role };
  cache = snap;
  return snap;
}

/**
 * Resolve the current user's role in the active project.
 * Re-fetches when the user or active project changes.
 */
export function useProjectRole(): ProjectRoleSnapshot & { ready: boolean } {
  const roles = useAuthRoles();
  const projectId = useStore((s) => s.activeProjectId ?? null);
  const organizationId = useStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.organizationId ?? null,
  );
  const [, force] = useState(0);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    if (!roles.loaded) return;
    if (cache.loaded && cache.userId === roles.userId && cache.projectId === projectId) {
      return;
    }
    void getProjectRoleSnapshot(projectId, roles, organizationId).then(setCache);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles.loaded, roles.userId, roles.isSuperAdmin, roles.isAdmin, projectId, organizationId]);

  const current =
    cache.userId === roles.userId && cache.projectId === projectId
      ? cache
      : { ...EMPTY, userId: roles.userId, projectId };
  return { ...current, ready: current.loaded };
}

/**
 * Synchronous read of the cached project-role snapshot for warm navigations.
 * Returns `null` when nothing usable is cached (caller must await the async
 * resolver instead). Admin-style roles short-circuit without any cache.
 */
export function peekProjectRole(
  activeProjectId: string | null,
  roles: AuthRolesSnapshot,
  organizationId: string | null,
): ProjectRoleSnapshot | null {
  const userId = roles.userId;
  if (!userId || !activeProjectId) {
    return { loaded: true, userId, projectId: activeProjectId, role: null };
  }
  if (
    roles.isSuperAdmin ||
    roles.isAdmin ||
    (organizationId !== null && roles.adminOrgIds.includes(organizationId))
  ) {
    return { loaded: true, userId, projectId: activeProjectId, role: null };
  }
  if (cache.loaded && cache.userId === userId && cache.projectId === activeProjectId) {
    return cache;
  }
  return null;
}

/** Convenience: is `pathname` allowed given the snapshot? */
export function isPathAllowedForSnapshot(snap: ProjectRoleSnapshot, pathname: string): boolean {
  if (!snap.role) return true;
  return isPathAllowedForProjectRole(pathname, snap.role);
}

/** Convenience: is a sidebar module visible given the snapshot? */
export function canViewModuleForSnapshot(snap: ProjectRoleSnapshot, moduleKey: string): boolean {
  if (!snap.role) return true;
  const allow = PROJECT_ROLE_SECTIONS[snap.role];
  if (!allow) return true;
  const sectionId = MODULE_SECTION[moduleKey];
  if (!sectionId) return true;
  return allow.includes(sectionId);
}
