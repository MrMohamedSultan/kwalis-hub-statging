// ═══════════════════════════════════════════════════════════════════
// src/lib/project-gateway.ts
// Project Selection Gateway — strict project-isolation routing helpers.
//
// The tenant workspace requires an explicit project selection made on
// /main-hub. Any project-scoped route visited WITHOUT an active project
// redirects to the gateway (see src/routes/_authenticated/route.tsx).
// ═══════════════════════════════════════════════════════════════════

import { isNonProjectShellRoute } from "@/lib/shell-routes";

export const PROJECT_GATEWAY_PATH = "/main-hub";

/**
 * Tenant routes a signed-in user may visit WITHOUT an active project.
 * `/settings` is the escape hatch: a user with zero projects must be able
 * to reach project creation/management. Everything else in the tenant
 * shell requires a selection and bounces to the gateway.
 */
const PROJECT_EXEMPT_PREFIXES = [
  PROJECT_GATEWAY_PATH,
  "/settings",
  "/account-settings",
  // Role management is org-scoped (roles belong to the organization, not a
  // project), so it must be reachable without an active project selection.
  "/role-management",
  "/support",
  "/notifications",
  // Phase 5 layout-isolation surfaces never require a project selection.
  "/executive",
  "/no-access",
] as const;

/** True when `pathname` is a project-scoped tenant route. */
export function isProjectScopedRoute(pathname: string): boolean {
  if (pathname === "/") return false; // `/` itself redirects to the gateway
  if (isNonProjectShellRoute(pathname)) return false; // platform / board shells
  return !PROJECT_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
