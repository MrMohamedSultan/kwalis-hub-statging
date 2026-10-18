// ═══════════════════════════════════════════════════════════════════
// src/lib/permissions/require-module-permission.ts
// Server-side enforcement companion to the client Permission State
// Layer. Chain AFTER requireSupabaseAuth on any createServerFn:
//
//   export const editBudgetLine = createServerFn({ method: "POST" })
//     .middleware([requireSupabaseAuth, requireModulePermission("budget", "edit")])
//     .inputValidator(...)
//     .handler(...);
//
// The check runs through the Phase 2 SECURITY DEFINER helpers
// (can_view/can_create/can_edit/can_delete/can_export), so the exact
// same matrix that drives the UI also guards the backend. Platform
// super admins bridge through; everyone else needs the explicit flag.
// ═══════════════════════════════════════════════════════════════════

import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PermissionAction } from "./types";

const RPC_BY_ACTION = {
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
  delete: "can_delete",
  export: "can_export",
} as const;

export function requireModulePermission(moduleKey: string, action: PermissionAction = "view") {
  return createMiddleware({ type: "function" })
    .middleware([requireSupabaseAuth])
    .server(async ({ next, context }) => {
      const { supabase, userId } = context;

      const { data: isSuperAdmin } = await supabase.rpc("is_super_admin", { _uid: userId });
      if (isSuperAdmin) return next();

      const rpcName = RPC_BY_ACTION[action] as "can_view";
      const { data: allowed, error } = await supabase.rpc(rpcName, { _module_key: moduleKey });
      if (error || !allowed) {
        const err = new Error(`Forbidden: missing ${action} access to module "${moduleKey}"`);
        (err as Error & { status?: number }).status = 403;
        throw err;
      }
      return next();
    });
}
