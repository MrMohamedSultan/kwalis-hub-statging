// ═══════════════════════════════════════════════════════════════════
// src/lib/permissions/legacy-map.ts
// Phase 8 — bridge from legacy permission strings ("budget.edit",
// "payroll.execute", …) to the dynamic (module_key, action) matrix.
//
// Pure module — NO React / Supabase imports — so it is safe to share
// between the client shim (rbac.ts) and server-side enforcement
// (rbac-permissions.functions.ts).
//
// Permissions NOT listed here are platform-tier capabilities
// (workspace.*, system.*) with no module equivalent: they resolve to
// the admin gate (RBAC admin role or platform super admin) only.
// ═══════════════════════════════════════════════════════════════════

import type { PermissionAction } from "./types";

export const LEGACY_PERM_TO_MODULE: Partial<Record<string, readonly [string, PermissionAction]>> = {
  // Budget & Reporting
  "budget.view": ["budget", "view"],
  "budget.edit": ["budget", "edit"],
  "reports.view": ["reports", "view"],
  "reports.export": ["reports", "export"],
  // Finance
  "accounting.view": ["accounting", "view"],
  "transactions.modify": ["accounting", "edit"],
  "invoices.add": ["invoices", "create"],
  "invoices.approve": ["invoices", "edit"],
  "invoices.pay": ["invoices", "edit"],
  "payments.request": ["payables", "create"],
  "payments.approve": ["payment-approvals", "edit"],
  "payments.execute": ["payment-approvals", "edit"],
  "gl.view": ["gl-accounts", "view"],
  "gl.manage": ["gl-accounts", "edit"],
  "pettycash.log": ["petty-cash", "create"],
  "pettycash.reconcile": ["petty-cash", "edit"],
  // Payroll & Crew
  "payroll.view": ["payroll-hub", "view"],
  "payroll.approve": ["payroll-hub", "edit"],
  "payroll.execute": ["payroll-hub", "edit"],
  "crew.manage": ["crew-contracts", "edit"],
  // Production & Field
  "field.receipts": ["field-portal", "create"],
  "files.library": ["file-library", "view"],
  // Administration
  "users.manage": ["role-management", "edit"],
  "system.settings": ["system-settings", "edit"],
};

/** Resolve a legacy permission string to its (moduleKey, action) target. */
export function legacyPermTarget(perm: string): readonly [string, PermissionAction] | null {
  return LEGACY_PERM_TO_MODULE[perm] ?? null;
}
