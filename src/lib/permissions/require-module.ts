// ═══════════════════════════════════════════════════════════════════
// src/lib/permissions/require-module.ts
// Phase 6 — Layer 2: `requireModule(moduleKey, action)` guard factory.
//
// Attach to any route's `beforeLoad` for an explicit, per-route guard:
//
//   export const Route = createFileRoute("/_authenticated/invoices")({
//     beforeLoad: requireModule("invoices"),
//     component: InvoicesPage,
//   });
//
// NOTE: every operational route is ALREADY guarded centrally by the
// `_authenticated` layout beforeLoad via moduleKeyForPath() — this
// factory is for routes that need a stricter ACTION than "view"
// (e.g. beforeLoad: requireModule("payments", "edit")) or that live
// outside the central map.
//
// Resolution contract (fail-closed for assigned roles):
//   • snapshot fetch fails   → allow here; PermissionProvider renders
//                              its blocking error screen (never unlocks)
//   • super admin            → bridge through
//   • no role assigned       → allow (legacy rollout until Phase 8)
//   • can(module, action)    → proceed
//   • otherwise              → redirect to first viewable module
//                              (or /no-access when nothing is viewable)
// ═══════════════════════════════════════════════════════════════════

import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { myPermissionsQueryOptions } from "./queries";
import { buildPermissionState, can, type PermissionAction } from "./types";
import { firstViewableModulePath, NO_ACCESS_PATH } from "./landing";

interface GuardContext {
  queryClient: QueryClient;
}
interface GuardLocation {
  pathname: string;
}

export function requireModule(moduleKey: string, action: PermissionAction = "view") {
  return async ({
    context,
    location,
  }: {
    context: GuardContext;
    location: GuardLocation;
  }): Promise<void> => {
    // The _authenticated subtree is ssr:false and the bearer token lives
    // in the client session — the check is only meaningful in the browser.
    if (typeof window === "undefined") return;

    let state;
    try {
      // Shares its query key with PermissionProvider — deduped, never doubled.
      state = buildPermissionState(
        await context.queryClient.ensureQueryData(myPermissionsQueryOptions()),
      );
    } catch {
      // Transport/RPC failure: the provider fails closed downstream.
      return;
    }

    if (state.isSuperAdmin || !state.role) return;
    if (can(state, moduleKey, action)) return;

    const target = firstViewableModulePath(state) ?? NO_ACCESS_PATH;
    if (location.pathname === target) return; // never redirect onto ourselves
    throw redirect({ to: target as "/" });
  };
}
