// ═══════════════════════════════════════════════════════════════════
// src/components/role-management/RoleManagementPage.tsx
// Phase 7 — Role Management page (admin only).
//
// Composes the Permission Matrix Grid, the sticky batched-save bar and
// the Create Custom Role wizard. The draft is a pure overlay on the
// server baseline (src/lib/permissions/role-matrix.ts); saving sends
// only the diffed cells in one batched request.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import { PageTitle, Panel } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthRoles } from "@/lib/auth-roles";
import { usePermissions } from "@/lib/permissions/usePermissions";
import { permissionsKeys } from "@/lib/permissions/queries";
import {
  buildBaseline,
  diffMatrix,
  setRoleAll,
  toggleCell,
  type MatrixDraft,
  type RoleFlags,
  type RoleRow,
} from "@/lib/permissions/role-matrix";
import {
  createCustomRole,
  deleteCustomRole,
  getRoleManagementMatrix,
  saveRolePermissionBatch,
  updateRoleIdentity,
} from "@/lib/permissions/role-admin.functions";
import type { PermissionAction } from "@/lib/permissions/types";
import { RoleMatrixGrid } from "./RoleMatrixGrid";
import { UnsavedChangesBar } from "./UnsavedChangesBar";
import { CreateRoleWizard } from "./CreateRoleWizard";

export function RoleManagementPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const auth = useAuthRoles();
  const perms = usePermissions();

  const isAdminUser = perms.isAdmin || auth.isSuperAdmin || (auth.adminOrgIds?.length ?? 0) > 0;

  // Super admins may scope the grid to one organization; everyone else is
  // automatically scoped server-side to the orgs they administrate.
  const [scopeOrg, setScopeOrg] = useState<string>("all");

  const matrixQuery = useQuery({
    queryKey: ["role-management-matrix", scopeOrg],
    queryFn: () =>
      getRoleManagementMatrix({
        data: { organizationId: scopeOrg === "all" ? null : scopeOrg },
      }),
    enabled: isAdminUser,
    staleTime: 30_000,
  });

  const payload = matrixQuery.data;
  const baseline = useMemo(() => (payload ? buildBaseline(payload.permissions) : {}), [payload]);

  // Draft overlay — null means "identical to baseline".
  const [draft, setDraft] = useState<MatrixDraft | null>(null);
  useEffect(() => setDraft(null), [payload]);
  const value = draft ?? baseline;

  const changes = useMemo(() => diffMatrix(baseline, value), [baseline, value]);

  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);

  const editableRoleIds = useMemo(() => new Set(payload?.editableRoleIds ?? []), [payload]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["role-management-matrix"] });
    // The caller's own snapshot may have changed — refresh the provider.
    void queryClient.invalidateQueries({ queryKey: permissionsKeys.mine() });
  };

  const handleToggle = (roleId: string, moduleKey: string, action: PermissionAction) => {
    setDraft((prev) => toggleCell(prev ?? baseline, roleId, moduleKey, action));
  };

  const handleSetRoleModules = (roleId: string, moduleKeys: string[], on: boolean) => {
    setDraft((prev) => setRoleAll(prev ?? baseline, roleId, moduleKeys, on));
  };

  const handleSave = async () => {
    if (changes.length === 0) return;
    setSaving(true);
    try {
      await saveRolePermissionBatch({
        data: {
          changes: changes.map((c) => ({
            roleId: c.role_id,
            moduleKey: c.module_key,
            canView: c.can_view,
            canCreate: c.can_create,
            canEdit: c.can_edit,
            canDelete: c.can_delete,
            canExport: c.can_export,
          })),
        },
      });
      toast.success(t("roleMgmt.saved"));
      setDraft(null);
      invalidate();
    } catch (e) {
      toast.error(`${t("roleMgmt.saveFailed")}: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (newRole: {
    name: string;
    description: string;
    layoutType: "operational" | "executive";
    isAdmin: boolean;
    permissions: ({ moduleKey: string } & RoleFlags)[];
  }) => {
    // Custom roles need a home org: the selected scope, or the caller's
    // first administrated org.
    const orgId =
      scopeOrg !== "all"
        ? scopeOrg
        : (auth.adminOrgIds?.[0] ?? payload?.editableOrgIds[0] ?? payload?.orgs[0]?.id ?? null);
    if (!orgId) {
      toast.error(t("roleMgmt.selectOrgFirst"));
      return;
    }
    setCreateBusy(true);
    try {
      await createCustomRole({
        data: {
          organizationId: orgId,
          name: newRole.name,
          description: newRole.description || undefined,
          layoutType: newRole.layoutType,
          isAdmin: newRole.isAdmin,
          permissions: newRole.permissions.map((p) => ({
            moduleKey: p.moduleKey,
            canView: p.can_view,
            canCreate: p.can_create,
            canEdit: p.can_edit,
            canDelete: p.can_delete,
            canExport: p.can_export,
          })),
        },
      });
      toast.success(t("roleMgmt.roleCreated"));
      setCreating(false);
      invalidate();
    } catch (e) {
      toast.error(`${t("roleMgmt.createFailed")}: ${(e as Error).message}`);
    } finally {
      setCreateBusy(false);
    }
  };

  if (!isAdminUser) {
    return (
      <>
        <PageTitle title={t("roleMgmt.title")} />
        <Panel className="p-8 text-center">
          <ShieldAlert className="mx-auto mb-3 size-8 text-destructive" />
          <p className="text-sm text-muted-foreground">{t("roleMgmt.adminOnly")}</p>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageTitle
        title={t("roleMgmt.title")}
        action={
          <div className="flex items-center gap-2">
            {payload?.isSuperAdmin && payload.orgs.length > 0 && (
              <Select value={scopeOrg} onValueChange={setScopeOrg}>
                <SelectTrigger className="h-8 w-48 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("roleMgmt.allOrganizations")}</SelectItem>
                  {payload.orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" className="h-8 text-xs" onClick={() => setCreating(true)}>
              <Plus className="size-3.5 me-1" />
              {t("roleMgmt.createRole")}
            </Button>
          </div>
        }
      />

      <Panel className="mb-4 border border-info/20 bg-info/5 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-info" />
          <p className="text-xs leading-relaxed text-muted-foreground">{t("roleMgmt.subtitle")}</p>
        </div>
      </Panel>

      {matrixQuery.isPending ? (
        <Panel className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("roleMgmt.loadingMatrix")}
        </Panel>
      ) : matrixQuery.isError || !payload ? (
        <Panel className="p-8 text-center">
          <ShieldAlert className="mx-auto mb-3 size-8 text-destructive" />
          <p className="mb-3 text-sm text-muted-foreground">{t("roleMgmt.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => void matrixQuery.refetch()}>
            {t("rbac.retry")}
          </Button>
        </Panel>
      ) : (
        <RoleMatrixGrid
          modules={payload.modules}
          roles={payload.roles}
          draft={value}
          editableRoleIds={editableRoleIds}
          assignmentCounts={payload.assignmentCounts}
          onToggle={handleToggle}
          onSetRoleModules={handleSetRoleModules}
          onEditRole={setEditing}
          onDeleteRole={setDeleting}
        />
      )}

      <UnsavedChangesBar
        count={changes.length}
        saving={saving}
        onSave={handleSave}
        onDiscard={() => setDraft(null)}
      />

      {creating && payload && (
        <CreateRoleWizard
          modules={payload.modules}
          roles={payload.roles}
          baseline={baseline}
          canSetAdmin={payload.isSuperAdmin}
          busy={createBusy}
          onClose={() => setCreating(false)}
          onCreate={handleCreate}
        />
      )}

      {editing && (
        <EditRoleDialog
          role={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast.success(t("roleMgmt.roleUpdated"));
            invalidate();
          }}
        />
      )}

      {deleting && (
        <DeleteRoleDialog
          role={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            toast.success(t("roleMgmt.roleDeleted"));
            invalidate();
          }}
        />
      )}
    </>
  );
}

// ─── Edit identity dialog ───────────────────────────────────────────

function EditRoleDialog({
  role,
  onClose,
  onSaved,
}: {
  role: RoleRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [layoutType, setLayoutType] = useState<"operational" | "executive">(role.layout_type);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (name.trim().length < 2) return;
    setBusy(true);
    try {
      await updateRoleIdentity({
        data: {
          roleId: role.id,
          name: name.trim(),
          description: description.trim() || undefined,
          layoutType,
        },
      });
      onSaved();
    } catch (e) {
      toast.error(`${t("roleMgmt.updateFailed")}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={`${t("roleMgmt.editRole")} — ${role.name}`}>
      <div className="space-y-4">
        <div>
          <Label className="text-xs font-semibold text-muted-foreground">
            {t("roleMgmt.roleName")} *
          </Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs font-semibold text-muted-foreground">
            {t("roleMgmt.description")}
          </Label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div>
          <Label className="text-xs font-semibold text-muted-foreground">
            {t("roleMgmt.layoutType")}
          </Label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(["operational", "executive"] as const).map((lt) => (
              <button
                key={lt}
                type="button"
                onClick={() => setLayoutType(lt)}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  layoutType === lt
                    ? "border-brand bg-brand/10 font-semibold text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {t(`roleMgmt.${lt}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {t("roleMgmt.cancel")}
          </Button>
          <Button size="sm" onClick={save} disabled={busy || name.trim().length < 2}>
            {busy && <Loader2 className="size-3.5 me-1 animate-spin" />}
            {t("roleMgmt.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Delete confirmation dialog ─────────────────────────────────────

function DeleteRoleDialog({
  role,
  onClose,
  onDeleted,
}: {
  role: RoleRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const del = async () => {
    setBusy(true);
    try {
      await deleteCustomRole({ data: { roleId: role.id } });
      onDeleted();
    } catch (e) {
      toast.error(`${t("roleMgmt.deleteFailed")}: ${(e as Error).message}`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={t("roleMgmt.deleteRole")}>
      <p className="text-sm text-muted-foreground">
        {t("roleMgmt.confirmDelete", { name: role.name })}
      </p>
      <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {t("roleMgmt.cancel")}
        </Button>
        <Button variant="destructive" size="sm" onClick={del} disabled={busy}>
          {busy && <Loader2 className="size-3.5 me-1 animate-spin" />}
          {t("roleMgmt.deleteRole")}
        </Button>
      </div>
    </Modal>
  );
}
