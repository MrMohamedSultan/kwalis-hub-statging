// ═══════════════════════════════════════════════════════════════════
// src/lib/permissions/route-modules.ts
// Phase 6 — Layer 2: Route → Module mapping (pure, no React/Supabase).
//
// Every operational route maps 1:1 to a public.modules registry key.
// The mapping is static (routes are compile-time) and mirrors the
// registry's route_path column — it is the single lookup used by:
//   • the central guard in _authenticated/route.tsx (every child route)
//   • the requireModule() factory for per-route action-level guards
//
// Fail-safe posture: unmapped paths return null and are NOT blocked
// here — they remain protected by auth, the project gateway, and the
// legacy project-role guard. Assigned roles are only ever DENIED when
// the path is a known module the matrix explicitly withholds.
// ═══════════════════════════════════════════════════════════════════

/** Exact route prefix → public.modules.key. */
const ROUTE_TO_MODULE: Record<string, string> = {
  // Overview
  "/dashboard": "dashboard",
  // Budget & Reporting
  "/budget": "budget",
  "/top-sheet-report": "top-sheet-report",
  "/budget-reconciliation": "budget-reconciliation",
  "/reports": "reports",
  // Payroll & Crew
  "/crew": "crew-contracts",
  "/cast": "cast-contracts",
  "/payroll-hub": "payroll-hub",
  "/payroll": "payroll",
  "/crew-payroll": "crew-payroll",
  "/cast-payroll": "cast-payroll",
  "/per-diem-ledger": "per-diem",
  // Procurement & Payables
  "/vendors": "vendors",
  "/purchase-orders": "purchase-orders",
  "/invoices": "invoices",
  "/payables": "payables",
  "/vendor-payables": "vendor-payables",
  "/crew-cast-payables": "crew-cast-payables",
  "/payment-approvals": "payment-approvals",
  // Treasury & Cash
  "/petty-cash": "petty-cash",
  "/funding": "funding",
  "/gl-accounts": "gl-accounts",
  "/accounting": "accounting",
  // Production & Logistics
  "/locations": "locations",
  "/production-timeline": "timeline",
  "/daily-transport": "transport",
  "/accommodation-roster": "accommodation",
  "/car-rentals": "car-rentals",
  "/picture-assets": "picture-assets",
  "/characters": "characters",
  "/series": "series",
  // Directories & Admin
  "/project-files": "file-library",
  "/notifications": "notifications",
  "/audit-log": "audit-log",
  "/settings": "system-settings",
  "/role-management": "role-management",
  "/invitations": "invitations",
  "/data-audit": "data-audit",
  "/trash": "trash",
  "/support-desk": "support-desk",
  "/support": "support",
  "/account-settings": "account-settings",
  "/field-portal": "field-portal",
};

/**
 * Paths that never carry a module gate:
 *  /main-hub   — the project selection gateway (entry point)
 *  /no-access  — the fail-closed holding page itself
 *  /executive  — executive workspace (handled by layout isolation)
 *  /board      — isolated board-member portal (own guard stack)
 */
const UNGATED_PREFIXES = ["/main-hub", "/no-access", "/executive", "/board"];

/**
 * Resolve the registry module key guarding `pathname`, or null when the
 * path is intentionally ungated / unknown. Longest-prefix matching keeps
 * dynamic segments working ("/series/abc" → "series") while the trailing
 * slash prevents sibling collisions ("/payroll-hub" ≠ "/payroll").
 */
export function moduleKeyForPath(pathname: string): string | null {
  if (UNGATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }
  let best: string | null = null;
  for (const path of Object.keys(ROUTE_TO_MODULE)) {
    if (pathname === path || pathname.startsWith(`${path}/`)) {
      if (!best || path.length > best.length) best = path;
    }
  }
  return best ? ROUTE_TO_MODULE[best] : null;
}
