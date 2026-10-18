// ═══════════════════════════════════════════════════════════════════
// src/lib/permissions/usePermissions.ts
// Consumer hook for the Permission State Layer.
//
//   const { can, isAdmin, isExecutive, role } = usePermissions();
//   if (can("budget", "edit")) …
//
// `can()` is a thin synchronous binding over the pure resolver in
// ./types — no fetching, no effects, safe to call during render.
// Outside a PermissionProvider the context defaults to the loading
// state, which fails closed on every check.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useContext, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PermissionContext } from "./PermissionProvider";
import { permissionsKeys } from "./queries";
import { can, type PermissionAction } from "./types";

export function usePermissions() {
  const state = useContext(PermissionContext);
  const queryClient = useQueryClient();

  const canBound = useCallback(
    (moduleKey: string, action: PermissionAction = "view") => can(state, moduleKey, action),
    [state],
  );

  return useMemo(
    () => ({
      ...state,
      isReady: state.status === "ready",
      /**
       * The full resolved module rows (sorted by sort_order) — the single
       * source of truth the Sidebar and navigation render from.
       */
      modules: state.permissions,
      /** RBAC admin role OR platform super admin. */
      isAdmin: state.isSuperAdmin || Boolean(state.role?.is_admin),
      /** Board/executive layout — read-only across the platform. */
      isExecutive: state.role?.layout_type === "executive",
      layoutType: state.role?.layout_type ?? null,
      can: canBound,
      canView: (moduleKey: string) => canBound(moduleKey, "view"),
      canCreate: (moduleKey: string) => canBound(moduleKey, "create"),
      canEdit: (moduleKey: string) => canBound(moduleKey, "edit"),
      canDelete: (moduleKey: string) => canBound(moduleKey, "delete"),
      canExport: (moduleKey: string) => canBound(moduleKey, "export"),
      /**
       * Force a re-fetch after any mutation that changes roles,
       * permissions, or assignments.
       */
      refresh: () => queryClient.invalidateQueries({ queryKey: permissionsKeys.mine() }),
    }),
    [state, canBound, queryClient],
  );
}
