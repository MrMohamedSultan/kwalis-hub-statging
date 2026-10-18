// ═══════════════════════════════════════════════════════════════════
// src/lib/permissions/Can.tsx
// Phase 6 — action-level UI gating wrapper.
//
//   <Can module="budget" action="edit">
//     <Button>Edit lines</Button>
//   </Can>
//
//   <Can module="invoices" action="delete" fallback={<DisabledHint />}>
//     <DeleteButton />
//   </Can>
//
// Contract:
//   • loading / error   → renders `fallback` (fail closed; inside
//                         _authenticated the provider blocks render until
//                         ready, so this is only a defensive default)
//   • super admin / RBAC admin → renders children (bridge rule in can())
//   • NO role assigned    → renders children — the agreed rollout
//                           fallback: legacy users keep their current UI
//                           until the Phase 8 backfill assigns roles
//   • otherwise           → the explicit matrix flag decides
//
// This is a RENDERING gate only. Server functions must enforce the same
// check with requireModulePermission(module, action) middleware.
// ═══════════════════════════════════════════════════════════════════

import type { ReactNode } from "react";
import { usePermissions } from "./usePermissions";
import type { PermissionAction } from "./types";

export function Can({
  module,
  action = "view",
  fallback = null,
  children,
}: {
  /** public.modules registry key, e.g. "budget", "payment-approvals". */
  module: string;
  action?: PermissionAction;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const perms = usePermissions();

  // Rollout fallback: unassigned users keep the legacy UI untouched.
  if (perms.status === "ready" && !perms.role && !perms.isSuperAdmin) {
    return <>{children}</>;
  }

  if (!perms.can(module, action)) return <>{fallback}</>;
  return <>{children}</>;
}
