export const PLATFORM_SHELL_PREFIXES = [
  "/platform-hub",
  "/invitations",
  // NOTE: "/audit-log" is intentionally NOT here — the org-level audit log
  // renders inside the standard tenant layout. Platform-wide audit events live
  // at /platform-hub/audit-log.

  "/data-audit",
  "/support-desk",
  // NOTE: "/role-management" is intentionally NOT here — it is the WORKSPACE
  // (tenant) role matrix and must render in the tenant shell. Platform-wide
  // role administration lives at /platform-hub/roles.
  "/trash",
] as const;

// The tenant sidebar is unified across ALL organization routes, including
// /settings and its sub-pages. No org route may swap or reset the sidebar,
// so this list is intentionally empty (kept for the platform/tenant split).
export const GLOBAL_SHELL_PREFIXES: readonly string[] = [];

/** Isolated Board Member portal. */
export const BOARD_SHELL_PREFIXES = ["/board"] as const;

export type ShellMode = "platform" | "board" | "global" | "tenant";

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isPlatformShellRoute(pathname: string): boolean {
  return matchesPrefix(pathname, PLATFORM_SHELL_PREFIXES);
}

export function isBoardShellRoute(pathname: string): boolean {
  return matchesPrefix(pathname, BOARD_SHELL_PREFIXES);
}

export function isGlobalShellRoute(pathname: string): boolean {
  return matchesPrefix(pathname, GLOBAL_SHELL_PREFIXES);
}

export function isNonProjectShellRoute(pathname: string): boolean {
  return (
    isPlatformShellRoute(pathname) || isBoardShellRoute(pathname) || isGlobalShellRoute(pathname)
  );
}

export function getShellMode(pathname: string): ShellMode {
  if (isPlatformShellRoute(pathname)) return "platform";
  if (isBoardShellRoute(pathname)) return "board";
  if (isGlobalShellRoute(pathname)) return "global";
  return "tenant";
}
