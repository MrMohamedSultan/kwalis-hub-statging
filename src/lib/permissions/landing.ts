// ═══════════════════════════════════════════════════════════════════
// src/lib/permissions/landing.ts
// Phase 5 — Layer 1: Layout & Routing Isolation (pure helpers).
//
// Derives WHERE a user belongs from the server-verified permission
// snapshot:
//   layout_type = 'executive'   → /executive (read-only workspace)
//   layout_type = 'operational' → first viewable module by sort_order
//   zero viewable modules       → /no-access
//
// Pure functions only — no React/Supabase imports — so route guards,
// components, and tests all share the same logic.
// ═══════════════════════════════════════════════════════════════════

import type { ModulePermission, PermissionState } from "./types";

/** Executive workspace home (read-only, zero sidebar). */
export const EXECUTIVE_HOME = "/executive";
/** Dedicated page for assigned roles with zero viewable modules. */
export const NO_ACCESS_PATH = "/no-access";
/** Fallback landing for admins whose matrix rows are sparse. */
export const OPERATIONAL_FALLBACK = "/dashboard";

/** True for the executive workspace namespace. */
export function isExecutivePath(pathname: string): boolean {
  return pathname === EXECUTIVE_HOME || pathname.startsWith(`${EXECUTIVE_HOME}/`);
}

/**
 * Operational modules the role may open: can_view rows with a concrete
 * route, excluding the executive `/board/*` namespace. Defensively
 * re-sorted by sort_order (stable — preserves server order within ties).
 */
export function viewableOperationalModules(state: PermissionState): ModulePermission[] {
  if (state.status !== "ready") return [];
  return state.permissions
    .filter((p) => p.can_view && Boolean(p.route_path) && !p.route_path!.startsWith("/board"))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * The first module (by sort_order) an operational user may view, or
 * `null` when the role grants nothing (caller routes to /no-access).
 * Admins and super admins hold every module by bridge rule, so a sparse
 * matrix still lands them on the operational fallback.
 */
export function firstViewableModulePath(state: PermissionState): string | null {
  if (state.status !== "ready") return null;
  const first = viewableOperationalModules(state)[0];
  if (first?.route_path) return first.route_path;
  if (state.isSuperAdmin || state.role?.is_admin) return OPERATIONAL_FALLBACK;
  return null;
}
