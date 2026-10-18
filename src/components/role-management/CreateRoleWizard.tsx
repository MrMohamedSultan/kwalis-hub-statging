// ═══════════════════════════════════════════════════════════════════
// src/components/role-management/CreateRoleWizard.tsx
// Phase 7 — Create Custom Role dialog: Identity → Permissions → Review.
//
// "Duplicate from existing" pre-fills the permission draft from any
// visible role's current matrix; the admin can then adjust individual
// cells before the review step. The same implication invariant as the
// main grid is enforced on every toggle.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EMPTY_FLAGS,
  MATRIX_ACTIONS,
  FLAG_BY_ACTION,
  applyToggle,
  countAccessibleModules,
  getFlags,
  isEmptyFlags,
  slugify,
  type MatrixDraft,
  type ModuleRow,
  type RoleFlags,
  type RoleRow,
} from "@/lib/permissions/role-matrix";
import type { PermissionAction } from "@/lib/permissions/types";

const WIZARD_ROLE_ID = "__wizard__";

export interface NewRolePayload {
  name: string;
  description: string;
  layoutType: "operational" | "executive";
  isAdmin: boolean;
  permissions: { moduleKey: string } & RoleFlags[];
}

export function CreateRoleWizard({
  modules,
  roles,
  baseline,
  canSetAdmin,
  busy,
  onClose,
  onCreate,
}: {
  modules: ModuleRow[];
  roles: RoleRow[];
  /** Current server matrix — source for "duplicate from existing". */
  baseline: MatrixDraft;
  /** Only platform super admins may create administrator-level roles. */
  canSetAdmin: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    description: string;
    layoutType: "operational" | "executive";
    isAdmin: boolean;
    permissions: ({ moduleKey: string } & RoleFlags)[];
  }) => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [layoutType, setLayoutType] = useState<"operational" | "executive">("operational");
  const [isAdmin, setIsAdmin] = useState(false);
  const [duplicateFrom, setDuplicateFrom] = useState<string>("");
  const [perms, setPerms] = useState<Record<string, RoleFlags>>({});

  const sortedModules = useMemo(
    () =>
      modules
        .filter(
          (m) =>
            m.layer === layoutType || (layoutType === "operational" && m.layer !== "executive"),
        )
        .sort((a, b) => a.sort_order - b.sort_order),
    [modules, layoutType],
  );

  const applyDuplicate = (roleId: string) => {
    setDuplicateFrom(roleId);
    if (!roleId) {
      setPerms({});
      return;
    }
    const source = baseline[roleId] ?? {};
    const copy: Record<string, RoleFlags> = {};
    for (const [moduleKey, flags] of Object.entries(source)) copy[moduleKey] = { ...flags };
    setPerms(copy);
  };

  const toggle = (moduleKey: string, action: PermissionAction) => {
    setPerms((prev) => ({
      ...prev,
      [moduleKey]: applyToggle(prev[moduleKey] ?? { ...EMPTY_FLAGS }, action),
    }));
  };

  const accessCount = countAccessibleModules(perms);
  const identityValid = name.trim().length >= 2;

  const grantedModules = sortedModules.filter((m) => !isEmptyFlags(perms[m.key] ?? EMPTY_FLAGS));

  const submit = () => {
    onCreate({
      name: name.trim(),
      description: description.trim(),
      layoutType,
      isAdmin,
      permissions: Object.entries(perms)
        .filter(([, f]) => !isEmptyFlags(f))
        .map(([moduleKey, f]) => ({ moduleKey, ...f })),
    });
  };

  const stepTitles = [
    t("roleMgmt.stepIdentity"),
    t("roleMgmt.stepPermissions"),
    t("roleMgmt.stepReview"),
  ];

  return (
    <Modal onClose={onClose} title={t("roleMgmt.createRole")}>
      {/* Step indicator */}
      <div className="mb-4 flex items-center gap-2">
        {stepTitles.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`grid size-6 place-content-center rounded-full text-[10px] font-bold ${
                i < step
                  ? "bg-success/20 text-success"
                  : i === step
                    ? "bg-brand text-brand-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            <span
              className={`text-xs ${i === step ? "font-semibold text-foreground" : "text-muted-foreground"}`}
            >
              {label}
            </span>
            {i < stepTitles.length - 1 && <div className="h-px w-6 bg-border" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">
              {t("roleMgmt.roleName")} *
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("roleMgmt.roleNamePlaceholder")}
              className="mt-1"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("roleMgmt.slug")}: <code className="font-mono">{slugify(name)}</code>
            </p>
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">
              {t("roleMgmt.description")}
            </Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={t("roleMgmt.descriptionPlaceholder")}
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
                  className={`rounded-lg border px-3 py-2 text-start text-xs ${
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
          {canSetAdmin && (
            <label className="flex items-center gap-2 text-xs text-foreground">
              <Checkbox checked={isAdmin} onCheckedChange={(v) => setIsAdmin(v === true)} />
              {t("roleMgmt.adminRole")}
            </label>
          )}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">
              {t("roleMgmt.duplicateFrom")}
            </Label>
            <Select value={duplicateFrom} onValueChange={applyDuplicate}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t("roleMgmt.blankSlate")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("roleMgmt.blankSlate")}</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {t("roleMgmt.modulesWithAccess", { count: accessCount })}
            </span>
            <div className="flex gap-1.5 text-[9px] text-muted-foreground">
              {MATRIX_ACTIONS.map((a) => (
                <span key={a} className="w-4 text-center" title={t(`roleMgmt.${a}`)}>
                  {t(`roleMgmt.flag_${a}`)}
                </span>
              ))}
            </div>
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border border-border">
            {sortedModules.map((m) => (
              <div
                key={m.key}
                className="flex items-center justify-between border-b border-border px-3 py-1.5 last:border-0 hover:bg-muted/30"
              >
                <span className="text-xs font-medium text-foreground">{m.label}</span>
                <div className="flex gap-1.5">
                  {MATRIX_ACTIONS.map((action) => (
                    <span key={action} className="grid w-4 place-content-center">
                      <Checkbox
                        checked={(perms[m.key] ?? EMPTY_FLAGS)[FLAG_BY_ACTION[action]]}
                        onCheckedChange={() => toggle(m.key, action)}
                        className="size-3.5"
                        title={`${m.label} · ${t(`roleMgmt.${action}`)}`}
                      />
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">{t("roleMgmt.invariantHint")}</p>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">{name}</span>
              <code className="font-mono text-[10px] text-muted-foreground">{slugify(name)}</code>
            </div>
            {description && <p className="mt-1 text-muted-foreground">{description}</p>}
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px]">
                {t(`roleMgmt.${layoutType}`)}
              </span>
              {isAdmin && (
                <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
                  {t("roleMgmt.adminRole")}
                </span>
              )}
              <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] text-success">
                {t("roleMgmt.modulesWithAccess", { count: accessCount })}
              </span>
            </div>
          </div>
          {grantedModules.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("roleMgmt.noAccessGranted")}</p>
          ) : (
            <div className="max-h-56 overflow-auto rounded-lg border border-border">
              {grantedModules.map((m) => {
                const f = perms[m.key];
                const granted = MATRIX_ACTIONS.filter((a) => f[FLAG_BY_ACTION[a]]);
                return (
                  <div
                    key={m.key}
                    className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs last:border-0"
                  >
                    <span className="font-medium text-foreground">{m.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {granted.map((a) => t(`roleMgmt.${a}`)).join(" · ")}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 flex justify-between border-t border-border pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (step === 0 ? onClose() : setStep((step - 1) as 0 | 1))}
          disabled={busy}
        >
          <ArrowLeft className="size-3.5 me-1 rtl:rotate-180" />
          {step === 0 ? t("roleMgmt.cancel") : t("roleMgmt.back")}
        </Button>
        {step < 2 ? (
          <Button
            size="sm"
            onClick={() => setStep((step + 1) as 1 | 2)}
            disabled={step === 0 && !identityValid}
          >
            {t("roleMgmt.next")}
            <ArrowRight className="size-3.5 ms-1 rtl:rotate-180" />
          </Button>
        ) : (
          <Button size="sm" onClick={submit} disabled={busy || !identityValid}>
            {busy && <Loader2 className="size-3.5 me-1 animate-spin" />}
            {t("roleMgmt.create")}
          </Button>
        )}
      </div>
    </Modal>
  );
}
