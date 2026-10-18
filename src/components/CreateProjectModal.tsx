// ═══════════════════════════════════════════════════════════════════
// src/components/CreateProjectModal.tsx
// Admin-only "Create New Project" dialog.
//
// Visibility is gated by the caller AND re-checked here via useAuthRoles:
//   - super_admin (user_roles)            → any organization
//   - owner/admin (organization_members)  → only their admin orgs
// RLS on public.projects remains the ultimate enforcement boundary.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useAuthRoles } from "@/lib/auth-roles";
import { DEFAULT_PROJECT_STATUS, DEFAULT_PROJECT_TYPE } from "@/lib/project-constants";
import type { ProductionKind } from "@/lib/store";

type Org = { id: string; name: string; max_projects: number };

const KINDS: readonly ProductionKind[] = ["film", "series", "commercial"];

const KIND_LABEL_KEY: Record<ProductionKind, string> = {
  film: "gateway.kindFilm",
  series: "gateway.kindSeries",
  commercial: "gateway.kindCommercial",
};

const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required.").max(120, "Project name is too long."),
  code: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(
      z
        .string()
        .regex(
          /^[A-Z0-9]{2,12}$/,
          "Project code must be 2–12 uppercase letters or digits (e.g., PROJ26).",
        ),
    ),
  production_kind: z.enum(["film", "series", "commercial"]),
  start_date: z.string().nullable(),
  organization_id: z.string().uuid("Please select a company."),
});

type FormState = {
  name: string;
  code: string;
  production_kind: ProductionKind;
  start_date: string | null;
  organization_id: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  production_kind: "film",
  start_date: null,
  organization_id: "",
};

const INPUT_CLASS =
  "w-full rounded-lg bg-surface-2 border border-border text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand";

export function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { userId, isSuperAdmin, adminOrgIds, loaded } = useAuthRoles();
  const canCreate = loaded && (isSuperAdmin || adminOrgIds.length > 0);

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    if (!loaded || !canCreate) return;
    let cancelled = false;
    (async () => {
      setLoadingOrgs(true);
      let orgQuery = supabase.from("organizations").select("id,name,max_projects").order("name");
      if (!isSuperAdmin) orgQuery = orgQuery.in("id", adminOrgIds);
      const { data: orgRows } = await orgQuery;
      const list = (orgRows ?? []) as Org[];

      const countMap: Record<string, number> = {};
      const ids = list.map((o) => o.id);
      if (ids.length > 0) {
        const { data: projRows } = await supabase
          .from("projects")
          .select("organization_id")
          .in("organization_id", ids);
        for (const row of projRows ?? []) {
          const oid = (row as { organization_id: string | null }).organization_id;
          if (oid) countMap[oid] = (countMap[oid] ?? 0) + 1;
        }
      }

      if (cancelled) return;
      setOrgs(list);
      setCounts(countMap);
      const firstAvailable = list.find((o) => (countMap[o.id] ?? 0) < o.max_projects);
      setForm((f) => ({ ...f, organization_id: (firstAvailable ?? list[0])?.id ?? "" }));
      setLoadingOrgs(false);
    })();
    return () => {
      cancelled = true;
    };
    // adminOrgIds identity is stable (useSyncExternalStore with array compare).
  }, [loaded, canCreate, isSuperAdmin, adminOrgIds]);

  // Defense in depth: never render the form for non-admins, even if a
  // caller mounts this modal by mistake.
  if (loaded && !canCreate) return null;

  const submit = async () => {
    const parsed = createProjectSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input.");
      return;
    }
    const data = parsed.data;

    const org = orgs.find((o) => o.id === data.organization_id);
    if (!org) {
      toast.error(t("gateway.noAdminOrgs"));
      return;
    }
    if ((counts[org.id] ?? 0) >= org.max_projects) {
      toast.error(t("gateway.limitReached", { org: org.name }));
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("projects").insert({
        name: data.name,
        code: data.code,
        status: DEFAULT_PROJECT_STATUS as never,
        project_type: DEFAULT_PROJECT_TYPE,
        production_kind: data.production_kind,
        start_date: data.start_date,
        organization_id: data.organization_id,
        owner_id: userId,
      } as never);
      if (error) throw error;
      toast.success(t("gateway.createdToast", { name: `${data.code} — ${data.name}` }));
      await onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create project.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title={t("gateway.createModalTitle")} dismissible={!saving}>
      {loadingOrgs ? (
        <div className="py-8 text-sm text-muted-foreground text-center">
          {t("gateway.loadingOrgs")}
        </div>
      ) : orgs.length === 0 ? (
        <div className="py-8 text-sm text-muted-foreground text-center">
          {t("gateway.noAdminOrgs")}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                {t("gateway.fieldCode")} *
              </label>
              <input
                value={form.code}
                onChange={(e) =>
                  setForm({
                    ...form,
                    code: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 12),
                  })
                }
                className={`${INPUT_CLASS} font-mono tracking-wider uppercase`}
                placeholder={t("gateway.codePlaceholder")}
                maxLength={12}
                dir="ltr"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{t("gateway.codeHint")}</p>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                {t("gateway.fieldName")} *
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={INPUT_CLASS}
                placeholder={t("gateway.namePlaceholder")}
                maxLength={120}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {t("gateway.fieldOrg")} *
            </label>
            <select
              value={form.organization_id}
              onChange={(e) => setForm({ ...form, organization_id: e.target.value })}
              className={INPUT_CLASS}
            >
              <option value="">{t("gateway.selectOrg")}</option>
              {orgs.map((o) => {
                const used = counts[o.id] ?? 0;
                const full = used >= o.max_projects;
                return (
                  <option key={o.id} value={o.id} disabled={full}>
                    {o.name} ({used}/{o.max_projects}){full ? ` · ${t("gateway.orgFull")}` : ""}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                {t("gateway.fieldKind")} *
              </label>
              <select
                value={form.production_kind}
                onChange={(e) =>
                  setForm({ ...form, production_kind: e.target.value as ProductionKind })
                }
                className={INPUT_CLASS}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(KIND_LABEL_KEY[k])}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                {t("gateway.fieldStart")}
              </label>
              <DateInput
                value={form.start_date ?? ""}
                onChange={(v) => setForm({ ...form, start_date: v || null })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted disabled:opacity-60"
            >
              {t("gateway.cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-brand text-brand-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60"
            >
              {saving ? t("gateway.creating") : t("gateway.submitCreate")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
