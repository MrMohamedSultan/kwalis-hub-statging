// ═══════════════════════════════════════════════════════════════════
// src/lib/board-access.ts — what a board / executive member may open.
//
// A member with an executive title on the ACTIVE project
// (project_members.executive_title: Board Member, CEO, CFO, Executive
// Producer — the profile-level title is a fallback) works in the normal app
// shell, but the sidebar shows only BOARD_NAV_ITEMS and the route guard
// (src/routes/_authenticated/route.tsx) bounces every other path to
// /dashboard. Data stays protected by RLS; budget lines are read-only for
// executives in the database (db/pending/206).
// ═══════════════════════════════════════════════════════════════════

export const BOARD_HOME = "/dashboard";

/** Sidebar of a board member, in this order. */
export const BOARD_NAV_ITEMS: ReadonlyArray<{ to: string; labelKey: string; icon: string }> = [
  { to: "/dashboard", labelKey: "nav.dashboard", icon: "LayoutDashboard" },
  { to: "/budget", labelKey: "nav.budget", icon: "FileSpreadsheet" },
  { to: "/production-timeline", labelKey: "nav.productionTimeline", icon: "GanttChart" },
  // The cash flow lives on the Funding page (cash flow tab only for executives).
  { to: "/funding", labelKey: "nav.funding", icon: "Landmark" },
  { to: "/notifications", labelKey: "nav.notifications", icon: "Bell" },
];

/**
 * Paths a board member may visit: the sidebar items plus the project gateway,
 * own account, support, the explainer page and the RBAC executive workspace
 * (so an RBAC executive layout never loops).
 */
const BOARD_ALLOWED_PREFIXES: readonly string[] = [
  ...BOARD_NAV_ITEMS.map((i) => i.to),
  "/main-hub",
  "/account-settings",
  "/support",
  "/no-access",
  "/executive",
];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** True when an executive / board member may open `pathname`. */
export function isPathAllowedForExecutive(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/" || path === "") return true; // the index only redirects to the gateway
  return BOARD_ALLOWED_PREFIXES.some((p) => matches(path, p));
}

/**
 * Redirect target for a member holding `executiveTitle`, or null when the
 * path is allowed (or the user is not an executive).
 */
export function executiveRedirectFor(
  pathname: string,
  executiveTitle: string | null | undefined,
): string | null {
  if (!executiveTitle) return null;
  return isPathAllowedForExecutive(pathname) ? null : BOARD_HOME;
}

/**
 * The old /board portal now lives in the main app; its links keep working.
 */
export function legacyBoardPortalTarget(pathname: string): {
  to: string;
  search?: Record<string, string>;
} {
  if (matches(pathname, "/board/budget-review"))
    return { to: "/budget", search: { focus: "governance" } };
  if (matches(pathname, "/board/settings")) return { to: "/account-settings" };
  return { to: BOARD_HOME };
}
