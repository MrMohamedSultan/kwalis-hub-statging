// ═══════════════════════════════════════════════════════════════════
// src/lib/permissions/role-matrix.ts
// Phase 7 — Role Management matrix draft logic (pure, no React/Supabase).
//
// Powers the admin Permission Matrix Grid: an immutable draft overlay on
// top of the server baseline, the implication invariant (view gates all
// other flags), tri-state resolution for the select-all checkboxes, and
// the diff that produces the batched save payload.
// ═══════════════════════════════════════════════════════════════════

import type { PermissionAction } from "./types";

/** The five flags stored per role × module cell (mirrors public.role_permissions). */
export interface RoleFlags {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

export const EMPTY_FLAGS: RoleFlags = {
  can_view: false,
  can_create: false,
  can_edit: false,
  can_delete: false,
  can_export: false,
};

export const FULL_FLAGS: RoleFlags = {
  can_view: true,
  can_create: true,
  can_edit: true,
  can_delete: true,
  can_export: true,
};

export const MATRIX_ACTIONS: readonly PermissionAction[] = [
  "view",
  "create",
  "edit",
  "delete",
  "export",
];

export const FLAG_BY_ACTION: Record<PermissionAction, keyof RoleFlags> = {
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
  delete: "can_delete",
  export: "can_export",
};

/** roleId → moduleKey → flags. */
export type MatrixDraft = Record<string, Record<string, RoleFlags>>;

/** One upsert row for public.role_permissions. */
export interface MatrixChange extends RoleFlags {
  role_id: string;
  module_key: string;
}

// ─── Rows returned by the admin server functions ────────────────────

export interface RoleRow {
  id: string;
  organization_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  layout_type: "operational" | "executive";
  is_admin: boolean;
  is_system: boolean;
}

export interface ModuleRow {
  key: string;
  label: string;
  icon: string | null;
  route_path: string | null;
  parent_key: string | null;
  sort_order: number;
  layer: string;
}

export interface RolePermissionRow extends RoleFlags {
  role_id: string;
  module_key: string;
}

export interface RoleMatrixPayload {
  roles: RoleRow[];
  modules: ModuleRow[];
  permissions: RolePermissionRow[];
  /** roleId → number of users currently holding the role. */
  assignmentCounts: Record<string, number>;
  /** Roles the caller may edit (system roles require platform super admin). */
  editableRoleIds: string[];
  /** Organizations whose custom roles the caller may manage. */
  editableOrgIds: string[];
  isSuperAdmin: boolean;
  /** Organizations list (super admin scope switcher; empty otherwise). */
  orgs: { id: string; name: string }[];
}

// ─── Pure helpers ───────────────────────────────────────────────────

export function flagsEqual(a: RoleFlags, b: RoleFlags): boolean {
  return (
    a.can_view === b.can_view &&
    a.can_create === b.can_create &&
    a.can_edit === b.can_edit &&
    a.can_delete === b.can_delete &&
    a.can_export === b.can_export
  );
}

export function isEmptyFlags(f: RoleFlags): boolean {
  return flagsEqual(f, EMPTY_FLAGS);
}

export function isFullFlags(f: RoleFlags): boolean {
  return flagsEqual(f, FULL_FLAGS);
}

/** Read a cell, defaulting to all-false when absent. */
export function getFlags(draft: MatrixDraft, roleId: string, moduleKey: string): RoleFlags {
  return draft[roleId]?.[moduleKey] ?? EMPTY_FLAGS;
}

/**
 * The implication invariant, enforced identically on client and server:
 *  • turning OFF view clears every other flag;
 *  • turning ON any write/export flag implicitly grants view.
 */
export function applyToggle(flags: RoleFlags, action: PermissionAction): RoleFlags {
  const key = FLAG_BY_ACTION[action];
  const next: RoleFlags = { ...flags, [key]: !flags[key] };
  if (action === "view" && !next.can_view) return { ...EMPTY_FLAGS };
  if (action !== "view" && next[key]) next.can_view = true;
  return next;
}

/** Server-side normalization mirror of applyToggle (applied to whole rows). */
export function normalizeFlags(f: RoleFlags): RoleFlags {
  const anyWrite = f.can_create || f.can_edit || f.can_delete || f.can_export;
  if (!f.can_view && !anyWrite) return { ...EMPTY_FLAGS };
  if (!f.can_view) return { ...f, can_view: true };
  return { ...f };
}

/** Immutably toggle one cell. */
export function toggleCell(
  draft: MatrixDraft,
  roleId: string,
  moduleKey: string,
  action: PermissionAction,
): MatrixDraft {
  const next = applyToggle(getFlags(draft, roleId, moduleKey), action);
  return setCell(draft, roleId, moduleKey, next);
}

/** Immutably write one cell. */
export function setCell(
  draft: MatrixDraft,
  roleId: string,
  moduleKey: string,
  flags: RoleFlags,
): MatrixDraft {
  return {
    ...draft,
    [roleId]: { ...draft[roleId], [moduleKey]: flags },
  };
}

/** Immutably set every module cell of one role to all-on or all-off. */
export function setRoleAll(
  draft: MatrixDraft,
  roleId: string,
  moduleKeys: string[],
  on: boolean,
): MatrixDraft {
  const flags = on ? FULL_FLAGS : EMPTY_FLAGS;
  const roleCells = { ...draft[roleId] };
  for (const key of moduleKeys) roleCells[key] = { ...flags };
  return { ...draft, [roleId]: roleCells };
}

export type TriState = "all" | "some" | "none";

/**
 * Tri-state resolution for select-all checkboxes:
 *  "all"  — every cell fully granted (all five flags)
 *  "none" — every cell fully empty
 *  "some" — anything in between
 */
export function triStateOf(cells: RoleFlags[]): TriState {
  if (cells.length === 0) return "none";
  if (cells.every(isFullFlags)) return "all";
  if (cells.every(isEmptyFlags)) return "none";
  return "some";
}

/** Build the baseline draft from server permission rows. */
export function buildBaseline(permissions: RolePermissionRow[]): MatrixDraft {
  const draft: MatrixDraft = {};
  for (const p of permissions) {
    (draft[p.role_id] ??= {})[p.module_key] = {
      can_view: p.can_view,
      can_create: p.can_create,
      can_edit: p.can_edit,
      can_delete: p.can_delete,
      can_export: p.can_export,
    };
  }
  return draft;
}

/**
 * Diff draft against baseline → the minimal batched save payload.
 * Only cells that differ are returned, normalized through the invariant.
 */
export function diffMatrix(baseline: MatrixDraft, draft: MatrixDraft): MatrixChange[] {
  const changes: MatrixChange[] = [];
  const roleIds = new Set([...Object.keys(baseline), ...Object.keys(draft)]);
  for (const roleId of roleIds) {
    const moduleKeys = new Set([
      ...Object.keys(baseline[roleId] ?? {}),
      ...Object.keys(draft[roleId] ?? {}),
    ]);
    for (const moduleKey of moduleKeys) {
      const before = getFlags(baseline, roleId, moduleKey);
      const after = getFlags(draft, roleId, moduleKey);
      if (!flagsEqual(before, after)) {
        changes.push({ role_id: roleId, module_key: moduleKey, ...normalizeFlags(after) });
      }
    }
  }
  return changes;
}

/** Count modules where the role holds at least one flag (wizard review). */
export function countAccessibleModules(cells: Record<string, RoleFlags>): number {
  return Object.values(cells).filter((f) => !isEmptyFlags(f)).length;
}

/** kebab-case slug derived from a display name. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "role"
  );
}
