// ═══════════════════════════════════════════════════════════════════
// src/components/role-management/RoleMatrixGrid.tsx
// Phase 7 — Permission Matrix Grid.
//
// Y-axis: modules (grouped by their registry parent, executive layer
// last). X-axis: roles. Each cell holds the five flag checkboxes
// (View / Create / Edit / Delete / Export). Sticky header row + sticky
// module column keep context visible while scrolling. Tri-state
// select-all checkboxes live in the role column headers (whole role)
// and in each group header row (role × group).
// ═══════════════════════════════════════════════════════════════════

import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Crown, ShieldCheck, Pencil, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MATRIX_ACTIONS,
  FLAG_BY_ACTION,
  getFlags,
  triStateOf,
  type MatrixDraft,
  type ModuleRow,
  type RoleRow,
  type TriState,
} from "@/lib/permissions/role-matrix";
import type { PermissionAction } from "@/lib/permissions/types";

interface ModuleGroup {
  key: string;
  label: string;
  modules: ModuleRow[];
}

function triToChecked(state: TriState): boolean | "indeterminate" {
  return state === "all" ? true : state === "some" ? "indeterminate" : false;
}

export function RoleMatrixGrid({
  modules,
  roles,
  draft,
  editableRoleIds,
  assignmentCounts,
  onToggle,
  onSetRoleModules,
  onEditRole,
  onDeleteRole,
}: {
  modules: ModuleRow[];
  roles: RoleRow[];
  draft: MatrixDraft;
  editableRoleIds: Set<string>;
  assignmentCounts: Record<string, number>;
  onToggle: (roleId: string, moduleKey: string, action: PermissionAction) => void;
  onSetRoleModules: (roleId: string, moduleKeys: string[], on: boolean) => void;
  onEditRole: (role: RoleRow) => void;
  onDeleteRole: (role: RoleRow) => void;
}) {
  const { t } = useTranslation();

  const groups = useMemo<ModuleGroup[]>(() => {
    const ops = modules.filter((m) => m.layer === "operational");
    const exec = modules.filter((m) => m.layer === "executive");
    const parents = ops.filter((m) => !m.parent_key && ops.some((c) => c.parent_key === m.key));
    const out: ModuleGroup[] = parents
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => ({
        key: p.key,
        label: p.label,
        modules: ops
          .filter((c) => c.parent_key === p.key)
          .sort((a, b) => a.sort_order - b.sort_order),
      }));
    const orphans = ops.filter((m) => !m.parent_key && !parents.some((p) => p.key === m.key));
    if (orphans.length > 0) {
      out.unshift({
        key: "__general",
        label: t("roleMgmt.groupGeneral"),
        modules: orphans.sort((a, b) => a.sort_order - b.sort_order),
      });
    }
    if (exec.length > 0) {
      out.push({
        key: "__executive",
        label: t("roleMgmt.groupExecutive"),
        modules: exec.sort((a, b) => a.sort_order - b.sort_order),
      });
    }
    return out;
  }, [modules, t]);

  const allModuleKeys = useMemo(() => modules.map((m) => m.key), [modules]);

  return (
    <div className="overflow-auto max-h-[calc(100vh-16rem)] rounded-xl border border-border bg-card">
      {/* Legend: explains the V / C / E / D / X flag abbreviations. */}
      <div className="sticky start-0 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/40 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("roleMgmt.legendTitle")}
        </span>
        {MATRIX_ACTIONS.map((a) => (
          <span key={a} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="grid size-4 place-content-center rounded border border-border bg-card text-[9px] font-bold text-foreground">
              {t(`roleMgmt.flag_${a}`)}
            </span>
            {t(`roleMgmt.action_${a}`)}
          </span>
        ))}
      </div>
      <table className="border-collapse text-xs w-full">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky start-0 top-0 z-30 min-w-52 bg-card text-start px-3 py-2 border-b border-e border-border font-semibold">
              {t("roleMgmt.modules")}
              <div className="mt-1 flex gap-1.5 text-[9px] font-normal text-muted-foreground">
                {MATRIX_ACTIONS.map((a) => (
                  <span key={a} className="w-4 text-center" title={t(`roleMgmt.action_${a}`)}>
                    {t(`roleMgmt.flag_${a}`)}
                  </span>
                ))}
              </div>
            </th>
            {roles.map((role) => {
              const editable = editableRoleIds.has(role.id);
              const state = triStateOf(allModuleKeys.map((k) => getFlags(draft, role.id, k)));
              return (
                <th
                  key={role.id}
                  className="min-w-44 bg-card px-2 py-2 border-b border-e border-border align-top"
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="text-start">
                      <div className="font-semibold text-foreground flex items-center gap-1">
                        {role.name}
                        {role.is_admin && (
                          <Crown
                            className="size-3 text-warning"
                            aria-label={t("roleMgmt.adminRole")}
                          />
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {role.is_system && (
                          <span className="rounded-full border border-border bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
                            {t("roleMgmt.systemBadge")}
                          </span>
                        )}
                        {role.layout_type === "executive" && (
                          <span className="rounded-full border border-info/40 bg-info/10 px-1.5 py-px text-[9px] text-info">
                            {t("roleMgmt.executive")}
                          </span>
                        )}
                        {(assignmentCounts[role.id] ?? 0) > 0 && (
                          <span className="text-[9px] text-muted-foreground">
                            {t("roleMgmt.assignments", { count: assignmentCounts[role.id] })}
                          </span>
                        )}
                      </div>
                    </div>
                    {editable ? (
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => onEditRole(role)}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title={t("roleMgmt.editRole")}
                        >
                          <Pencil className="size-3" />
                        </button>
                        {!role.is_system && (
                          <button
                            type="button"
                            onClick={() => onDeleteRole(role)}
                            className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title={t("roleMgmt.deleteRole")}
                          >
                            <Trash2 className="size-3" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <Lock
                        className="size-3 text-muted-foreground"
                        aria-label={t("roleMgmt.readOnlyColumn")}
                      />
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Checkbox
                      checked={triToChecked(state)}
                      disabled={!editable}
                      onCheckedChange={() =>
                        onSetRoleModules(role.id, allModuleKeys, state !== "all")
                      }
                      className="size-3.5"
                      title={t("roleMgmt.selectAll")}
                    />
                    <span className="text-[9px] text-muted-foreground">
                      {t("roleMgmt.selectAll")}
                    </span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              <tr className="bg-muted/60">
                <td className="sticky start-0 z-10 bg-muted px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground border-e border-border">
                  {group.label}
                </td>
                {roles.map((role) => {
                  const editable = editableRoleIds.has(role.id);
                  const keys = group.modules.map((m) => m.key);
                  const state = triStateOf(keys.map((k) => getFlags(draft, role.id, k)));
                  return (
                    <td key={role.id} className="px-2 py-1.5 border-e border-border">
                      <Checkbox
                        checked={triToChecked(state)}
                        disabled={!editable}
                        onCheckedChange={() => onSetRoleModules(role.id, keys, state !== "all")}
                        className="size-3.5"
                        title={`${role.name} · ${group.label}`}
                      />
                    </td>
                  );
                })}
              </tr>
              {group.modules.map((mod) => (
                <tr key={mod.key} className="border-t border-border hover:bg-muted/30">
                  <td className="sticky start-0 z-10 bg-card px-3 py-1.5 border-e border-border">
                    <div className="font-medium text-foreground">{mod.label}</div>
                    <div className="text-[9px] text-muted-foreground">{mod.key}</div>
                  </td>
                  {roles.map((role) => {
                    const editable = editableRoleIds.has(role.id);
                    const flags = getFlags(draft, role.id, mod.key);
                    return (
                      <td key={role.id} className="px-2 py-1.5 border-e border-border">
                        <div className="flex gap-1.5">
                          {MATRIX_ACTIONS.map((action) => (
                            <span key={action} className="grid w-4 place-content-center">
                              <Checkbox
                                checked={flags[FLAG_BY_ACTION[action]]}
                                disabled={!editable}
                                onCheckedChange={() => onToggle(role.id, mod.key, action)}
                                className="size-3.5"
                                title={`${role.name} · ${mod.label} · ${t(`roleMgmt.action_${action}`)}`}
                              />
                            </span>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      {roles.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground">
          <ShieldCheck className="mx-auto mb-2 size-6" />
          {t("roleMgmt.noRoles")}
        </div>
      )}
    </div>
  );
}
