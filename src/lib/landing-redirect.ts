// Single source of truth for role-based landing / entry redirects.
// Platform owners (super_admin) live in the isolated /admin branch; every
// other role stays in the org (tenant) chrome.

/** Entry paths that a platform owner should never land on. */
export const ORG_ENTRY_PATHS = new Set(["/", "/dashboard", "/main-hub"]);

export const ADMIN_LANDING = "/platform-hub/dashboard";
export const BOARD_LANDING = "/board/dashboard";
/** Org users land on the Project Selection Gateway, not a data surface. */
export const ORG_LANDING = "/main-hub";

export type LandingRoles = { isSuperAdmin: boolean; executiveTitle?: string | null };

/**
 * Board members are identified by `profiles.executive_title = 'Board Member'`
 * (roles never live on `profiles.role`). Platform ownership always wins.
 */
export function isBoardMember(roles: LandingRoles): boolean {
  return !roles.isSuperAdmin && roles.executiveTitle === "Board Member";
}

/** Post-login destination for a role snapshot. */
export function landingPathForRoles(roles: LandingRoles): string {
  if (roles.isSuperAdmin) return ADMIN_LANDING;
  if (isBoardMember(roles)) return BOARD_LANDING;
  return ORG_LANDING;
}

/**
 * Redirect target for an org-branch entry path, or `null` when the user may
 * stay where they are. Non-entry paths are never rewritten so deep links
 * keep working for platform owners who intentionally open an org page.
 */
export function entryRedirectFor(pathname: string, roles: LandingRoles): string | null {
  if (!ORG_ENTRY_PATHS.has(pathname)) return null;
  if (roles.isSuperAdmin) return ADMIN_LANDING;
  // Board members never enter the full tenant workspace.
  if (isBoardMember(roles)) return BOARD_LANDING;
  return null;
}
