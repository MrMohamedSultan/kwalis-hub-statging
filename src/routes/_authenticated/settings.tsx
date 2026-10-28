import { createFileRoute } from "@tanstack/react-router";
import { OrgMfaPanel } from "@/components/settings/OrgMfaPanel";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { ProjectsManagementPanel } from "@/components/ProjectsManagementPanel";
import { ProjectTeamPanel } from "@/components/ProjectTeamPanel";

import { supabase } from "@/integrations/supabase/client";
import { changeOwnPassword } from "@/lib/admin-users.functions";
import { toast } from "sonner";
import { Lock, User, FolderCog, Building2, ShieldAlert, Users } from "lucide-react";
import { useCurrentUser } from "@/lib/rbac";
import { PROJECT_STATUSES, PROJECT_TYPES } from "@/lib/project-constants";
import {
  deleteProjectHard,
  updateActiveProjectSettings,
  updateProjectProductionKind,
} from "@/lib/projects.functions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AccessControlSelfTest } from "@/components/AccessControlSelfTest";
import { seedDemoProject } from "@/lib/demo-seed.functions";
import { useAuthRoles } from "@/lib/auth-roles";
import { useAdminScope } from "@/lib/admin-scope";
import { InvitationsPage } from "@/routes/_authenticated/invitations";
import { Globe2 } from "lucide-react";
import { OrganizationCurrencyPanel, ProjectCurrencyPanel } from "@/components/CurrencyFxSettings";
import { ExportBrandingPanel } from "@/components/settings/ExportBrandingPanel";
import { Button } from "@/components/ui/button";
import { z } from "zod";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/settings")({
  component: () => (
    <AppShell>
      <SettingsPage />
    </AppShell>
  ),
});

const CURRENCIES = ["USD", "SAR", "EUR", "GBP", "AED"] as const;
const UNITS = ["Flat", "Day", "Week", "Month", "Split"] as const;
const STATUSES = PROJECT_STATUSES;

const projectSettingsSchema = z.object({
  project_name: z.string().trim().min(1).max(120),
  project_type: z.enum(PROJECT_TYPES),
  currency: z.enum(CURRENCIES),
  default_unit: z.enum(UNITS),
  project_status: z.enum(PROJECT_STATUSES),
});

type Settings = {
  project_name: string;
  project_type: string;
  currency: string;
  default_unit: string;
  project_status: string;
};

type TabKey = "personal" | "project" | "organization" | "users";

function SettingsPage() {
  const { t } = useTranslation();

  const me = useCurrentUser();
  const roles = useAuthRoles();
  const selectedOrgId = useAdminScope((s) => s.orgId);
  const navigate = Route.useNavigate();

  // Route guard: Platform Admins with no tenant context (no org memberships
  // AND no selected admin-scope org) don't belong on tenant Settings —
  // bounce them to the Platform Hub so they can't accidentally poke at a
  // tenant workspace with a null org context.
  useEffect(() => {
    if (!roles.loaded) return;
    if (roles.isSuperAdmin && roles.adminOrgIds.length === 0 && !selectedOrgId) {
      navigate({ to: "/platform-hub/dashboard", replace: true });
    }
  }, [roles.loaded, roles.isSuperAdmin, roles.adminOrgIds.length, selectedOrgId, navigate]);

  // A "Company Admin" is anyone who is owner/admin of at least one organization
  // in the DB (adminOrgIds populated by RLS-mirrored predicates). Super Admins
  // and platform owners also qualify. This must NOT depend on the derived UI
  // role label — Company Admins can legitimately resolve to "Producer" when
  // they have no top-level `admin` app_role, and we'd wrongly hide their tabs.
  const isCompanyAdmin =
    roles.loaded && (roles.isSuperAdmin || roles.isAdmin || roles.adminOrgIds.length > 0);
  const canProject =
    isCompanyAdmin ||
    me.role === "System Owner" ||
    me.role === "Super Admin" ||
    me.role === "Admin" ||
    me.role === "Producer";
  const canOrg =
    isCompanyAdmin ||
    me.role === "System Owner" ||
    me.role === "Super Admin" ||
    me.role === "Admin";
  const canUsers = isCompanyAdmin;

  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string; icon: React.ReactNode; visible: boolean }[] = [
      {
        key: "personal",
        label: t("platform.settings.tabPersonal"),
        icon: <User className="size-4" />,
        visible: true,
      },
      {
        key: "project",
        label: t("platform.settings.tabProject"),
        icon: <FolderCog className="size-4" />,
        visible: canProject,
      },
      {
        key: "organization",
        label: t("platform.settings.tabOrganization"),
        icon: <Building2 className="size-4" />,
        visible: canOrg,
      },
      {
        key: "users",
        label: t("platform.settings.tabUsers"),
        icon: <Users className="size-4" />,
        visible: canUsers,
      },
    ];
    return list.filter((t) => t.visible);
  }, [canProject, canOrg, canUsers, t]);

  const [tab, setTab] = useState<TabKey>("personal");

  return (
    <>
      <PageTitle title={t("settings.settings")} />
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        {/* Sidebar */}
        <aside className="md:sticky md:top-4 self-start">
          <Panel className="p-2">
            <nav className="flex md:flex-col gap-1 overflow-x-auto">
              {tabs.map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left whitespace-nowrap transition-colors ${
                      active
                        ? "bg-brand text-brand-foreground font-semibold"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {t.icon}
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </nav>
          </Panel>
          <div className="mt-3 px-2 text-xs text-muted-foreground">
            {t("settings.signed_in_as")}
            <span className="font-medium text-foreground">{me.name}</span>
            <div className="opacity-70">{me.role}</div>
          </div>
        </aside>

        {/* Content */}
        <section className="min-w-0 space-y-6">
          {tab === "personal" && <SecurityPanel />}
          {tab === "project" &&
            (canProject ? (
              <>
                <ProjectSettingsPanel />
                <ProjectTeamPanel />
              </>
            ) : (
              <AccessDenied section={t("platform.settings.sectionProject")} />
            ))}

          {tab === "organization" &&
            (canOrg ? (
              <>
                <ScopeBanner />
                <Panel className="p-5">
                  <OrganizationCurrencyPanel
                    organizationId={
                      selectedOrgId ?? roles.adminOrgIds[0] ?? roles.memberOrgIds[0] ?? null
                    }
                  />
                </Panel>
                <Panel className="p-5">
                  <ExportBrandingPanel
                    organizationId={
                      selectedOrgId ?? roles.adminOrgIds[0] ?? roles.memberOrgIds[0] ?? null
                    }
                  />
                </Panel>
                <Panel className="p-5">
                  <OrgMfaPanel
                    organizationId={
                      selectedOrgId ?? roles.adminOrgIds[0] ?? roles.memberOrgIds[0] ?? null
                    }
                  />
                </Panel>
                <ProjectsManagementPanel />
                <AccessControlSelfTest />
              </>
            ) : (
              <AccessDenied section={t("platform.settings.sectionOrganization")} />
            ))}
          {tab === "users" &&
            (canUsers ? (
              <>
                <ScopeBanner />
                <InvitationsPage embedded />
              </>
            ) : (
              <AccessDenied section={t("platform.settings.sectionUsers")} />
            ))}
        </section>
      </div>
    </>
  );
}

function ScopeBanner() {
  const { t } = useTranslation();

  const { isSuperAdmin, loaded } = useAuthRoles();
  const orgId = useAdminScope((s) => s.orgId);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded || !isSuperAdmin || !orgId) {
      setOrgName(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", orgId)
        .maybeSingle();
      setOrgName((data as { name: string } | null)?.name ?? null);
    })();
  }, [loaded, isSuperAdmin, orgId]);

  if (!loaded || !isSuperAdmin) return null;

  return (
    <Panel className="p-3 border border-warning/30 bg-warning/5">
      <div className="flex items-center gap-2 text-xs">
        <Globe2 className="w-4 h-4 text-warning" />
        <span className="font-semibold text-warning">{t("settings.super_admin_scope")}</span>
        <span className="text-muted-foreground">
          {orgId ? (
            <>
              {t("platform.settings.viewingAsTenant", {
                org: orgName ?? t("platform.settings.selectedOrganization"),
              })}
            </>
          ) : (
            <>
              {t("platform.settings.noOrgSelected")}{" "}
              <a
                className="text-brand font-semibold hover:underline"
                href="/platform-hub/dashboard"
              >
                {t("settings.platform_hub")}
              </a>
              .
            </>
          )}
        </span>
      </div>
    </Panel>
  );
}

function AccessDenied({ section }: { section: string }) {
  const { t } = useTranslation();

  useEffect(() => {
    // Fire-and-forget audit for section-level denials
    import("@/lib/permission-audit").then(({ logPermissionDenied }) =>
      logPermissionDenied({
        perm: "settings.section",
        action: `view ${section}`,
        surface: "SettingsAccessDenied",
      }),
    );
  }, [section]);
  return (
    <Panel className="p-6">
      <div className="flex items-start gap-3">
        <ShieldAlert className="size-5 text-destructive mt-0.5" />
        <div>
          <h2 className="text-base font-semibold text-destructive">
            {t("settings.permission_required")}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("platform.settings.restricted", { section })}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function ProjectSettingsPanel() {
  const { t } = useTranslation();

  const projectName = useStore((s) => s.projectName);
  const projectType = useStore((s) => s.projectType);
  const projectStatus = useStore((s) => s.projectStatus);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const saveProjectSettings = useServerFn(updateActiveProjectSettings);
  const saveProductionKind = useServerFn(updateProjectProductionKind);
  const loadProjects = useStore((s) => s.loadProjects);
  const setProjectName = useStore((s) => s.setProjectName);
  const setProjectType = useStore((s) => s.setProjectType);
  const setProjectCurrency = useStore((s) => s.setProjectCurrency);
  const setProjectStatus = useStore((s) => s.setProjectStatus);

  const activeProjectForm = useMemo<Settings>(
    () => ({
      project_name: activeProject?.name ?? projectName,
      project_type: activeProject?.projectType ?? projectType,
      currency: activeProject?.currency ?? "USD",
      default_unit: "Week",
      project_status: activeProject?.status ?? projectStatus,
    }),
    [
      activeProject?.currency,
      activeProject?.name,
      activeProject?.projectType,
      activeProject?.status,
      projectName,
      projectStatus,
      projectType,
    ],
  );

  const [form, setForm] = useState<Settings>(activeProjectForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(false);
    setForm(activeProjectForm);
  }, [activeProjectId, activeProjectForm]);

  const update = async () => {
    const parsed = projectSettingsSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(t("settings.please_choose_a_valid_project_type"));
      return;
    }
    if (!activeProjectId) return;
    setSaving(true);
    try {
      const normalized = await saveProjectSettings({
        data: { projectId: activeProjectId, ...parsed.data },
      });
      setProjectName(normalized.projectName);
      setProjectType(normalized.projectType);
      setProjectCurrency(normalized.currency);
      const nextProjectStatus = PROJECT_STATUSES.find(
        (status) => status === normalized.projectStatus,
      );
      if (nextProjectStatus) {
        setProjectStatus(nextProjectStatus);
      }
      toast.success(t("settings.project_settings_updated"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Panel className="max-w-2xl space-y-4 p-5">
        <div className="flex items-center gap-2 mb-2">
          <FolderCog className="w-4 h-4 text-brand" />
          <h2 className="text-base font-semibold">{t("settings.active_project")}</h2>
        </div>
        <p className="text-sm text-muted-foreground -mt-2 mb-3">
          Metadata for the currently selected project. Only project admins and managers can edit
          these values.
        </p>
        <Field label={t("platform.settings.projectName")}>
          <input
            value={form.project_name}
            onChange={(e) => setForm({ ...form, project_name: e.target.value })}
            disabled={loading}
            className="bg-sidebar-active text-sidebar-foreground border border-border rounded-lg px-3 py-2 w-64 outline-none text-right font-medium"
          />
        </Field>
        <Field label={t("platform.settings.projectType")}>
          <Select
            value={form.project_type}
            onChange={(v) => setForm({ ...form, project_type: v })}
            options={PROJECT_TYPES}
            disabled={loading}
          />
        </Field>
        <Field label={t("platform.settings.productionKind")}>
          <select
            value={activeProject?.productionKind ?? "film"}
            disabled={!activeProject}
            onChange={async (e) => {
              if (!activeProject) return;
              const kind = e.target.value as "film" | "series" | "commercial";
              try {
                await saveProductionKind({
                  data: { projectId: activeProject.id, productionKind: kind },
                });
                await loadProjects();
                toast.success(`Project type set to ${kind}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to update project type");
              }
            }}
            className="bg-sidebar-active text-sidebar-foreground border border-border rounded-lg px-3 py-2 w-64 outline-none font-medium"
          >
            <option value="film">{t("platform.settings.kindFilm")}</option>
            <option value="series">{t("platform.settings.kindSeries")}</option>
            <option value="commercial">{t("platform.settings.kindCommercial")}</option>
          </select>
        </Field>
        <Field label={t("platform.settings.currency")}>
          <Select
            value={form.currency}
            onChange={(v) => setForm({ ...form, currency: v })}
            options={CURRENCIES}
            disabled={loading}
          />
        </Field>
        <Field label={t("platform.settings.defaultUnit")}>
          <Select
            value={form.default_unit}
            onChange={(v) => setForm({ ...form, default_unit: v })}
            options={UNITS}
            disabled={loading}
          />
        </Field>
        <Field label={t("platform.settings.projectStatus")}>
          <Select
            value={form.project_status}
            onChange={(v) => setForm({ ...form, project_status: v })}
            options={STATUSES}
            disabled={loading}
          />
        </Field>
        <div className="flex justify-end pt-2">
          <Button onClick={update} disabled={saving || loading}>
            {saving ? t("platform.common.updating") : t("platform.common.update")}
          </Button>
        </div>
      </Panel>

      <Panel className="max-w-2xl p-5 mt-6">
        <ProjectCurrencyPanel projectId={activeProjectId} />
      </Panel>

      <DemoSeederPanel
        activeProjectId={activeProjectId}
        projectName={activeProject?.name ?? form.project_name}
      />

      <DeleteProjectPanel
        activeProjectId={activeProjectId}
        projectName={activeProject?.name ?? form.project_name}
      />
    </>
  );
}

function DeleteProjectPanel({
  activeProjectId,
  projectName,
}: {
  activeProjectId: string | null;
  projectName: string;
}) {
  const { t } = useTranslation();
  const roles = useAuthRoles();
  const navigate = Route.useNavigate();
  const removeProject = useServerFn(deleteProjectHard);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const loadProjects = useStore((s) => s.loadProjects);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Organization owners/admins only (super admins included). RLS enforces the
  // same rule server-side; this only hides an action the user cannot perform.
  const canDelete = roles.loaded && (roles.isSuperAdmin || roles.adminOrgIds.length > 0);
  if (!canDelete || !activeProjectId) return null;

  const run = async () => {
    setDeleting(true);
    try {
      await removeProject({ data: { projectId: activeProjectId } });
      toast.success(`“${projectName}” deleted`);
      await setActiveProject(null);
      await loadProjects();
      navigate({ to: "/main-hub", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete project.");
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <Panel className="max-w-2xl p-5 mt-6 border border-destructive/40 bg-destructive/5">
      <div className="flex items-center gap-2 mb-2">
        <ShieldAlert className="w-4 h-4 text-destructive" />
        <h2 className="text-base font-semibold">{t("platform.settings.dangerZone")}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {t("platform.settings.deleteProjectBody", { name: projectName })}
      </p>
      <Button variant="destructive" onClick={() => setConfirming(true)} disabled={deleting}>
        {t("platform.settings.deleteProject")}
      </Button>

      {confirming && (
        <ConfirmDialog
          open
          tone="danger"
          loading={deleting}
          title={t("platform.settings.deleteProjectTitle")}
          message={t("platform.settings.deleteProjectMessage", { name: projectName })}
          confirmLabel={t("platform.settings.deleteProject")}
          onCancel={() => !deleting && setConfirming(false)}
          onConfirm={() => void run()}
        />
      )}
    </Panel>
  );
}

function DemoSeederPanel({
  activeProjectId,
  projectName,
}: {
  activeProjectId: string | null;
  projectName: string;
}) {
  const { t } = useTranslation();

  const seedFn = useServerFn(seedDemoProject);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [result, setResult] = useState<null | {
    created: Record<string, number>;
    cleared: Record<string, number>;
    totalCreated: number;
    totalCleared: number;
  }>(null);
  const isDemo = /(demo|sandbox)/i.test(projectName ?? "");

  if (!isDemo) return null; // hard fail-safe — only visible on demo/sandbox projects

  const stages = [
    "Verifying project & permissions…",
    "Clearing existing demo rows…",
    "Seeding budget top sheet…",
    "Seeding crew & cast…",
    "Seeding accommodations & vehicles…",
    "Seeding invoices, petty cash & POs…",
    "Finalizing…",
  ];

  const run = async () => {
    if (!activeProjectId) return;
    setRunning(true);
    setResult(null);
    // Animated stage cycling while the server does its work.
    let stage = 0;
    setProgress(stages[0]);
    const timer = setInterval(() => {
      stage = Math.min(stage + 1, stages.length - 1);
      setProgress(stages[stage]);
    }, 700);
    try {
      const res = (await seedFn({ data: { projectId: activeProjectId } })) as {
        created: Record<string, number>;
        cleared: Record<string, number>;
        totalCreated: number;
        totalCleared: number;
      };
      clearInterval(timer);
      setProgress("");
      setResult(res);
      toast.success(`Demo data generated: ${res.totalCreated} rows created.`);
    } catch (e) {
      clearInterval(timer);
      setProgress("");
      toast.error(e instanceof Error ? e.message : "Failed to seed demo data.");
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  };

  return (
    <Panel className="max-w-2xl p-5 mt-6 border border-warning/30 bg-warning/5">
      <div className="flex items-center gap-2 mb-2">
        <ShieldAlert className="w-4 h-4 text-warning" />
        <h2 className="text-base font-semibold text-foreground dark:text-foreground">
          {t("settings.demo_data_seeder")}
        </h2>
      </div>
      <p className="text-sm text-foreground dark:text-muted-foreground mb-3">
        Generate realistic ~$5.5M feature-film data for <b>{projectName}</b>: 10 Top Sheet lines, 5
        crew, 2 cast, 2 hotels, 2 vehicles, a Daily Transport sheet, 3 vendor invoices, 2 petty cash
        advances, and 1 PO. Existing project-scoped rows will be replaced.
      </p>
      <p className="text-xs text-warning dark:text-warning mb-3">
        {t("settings.only_enabled_for_projects_whose_name_contains")}
        <b>“Demo”</b> or <b>“Sandbox”</b>.
      </p>
      {!confirming ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setConfirming(true);
            setResult(null);
          }}
        >
          {t("settings.generate_demo_data")}
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button type="button" variant="destructive" onClick={run} disabled={running}>
            {running ? "Seeding…" : "Yes, replace project data"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirming(false)}
            disabled={running}
          >
            Cancel
          </Button>
        </div>
      )}

      {running && (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm text-foreground dark:text-foreground mb-2">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-warning/40 border-t-transparent animate-spin" />
            {progress || "Working…"}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-warning/15">
            <div className="h-full w-1/3 bg-warning/70 animate-pulse rounded-full" />
          </div>
        </div>
      )}

      {result && !running && (
        <div className="mt-5 rounded-lg border border-success/30 bg-success/5 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-success dark:text-success">
              Seeding complete — {result.totalCreated} rows created
              {result.totalCleared > 0 ? ` · ${result.totalCleared} replaced` : ""}
            </h3>
            <button
              onClick={() => window.location.reload()}
              className="text-xs font-semibold text-success dark:text-success underline underline-offset-2"
            >
              {t("settings.reload_to_see_data")}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(result.created).map(([table, n]) => (
              <div
                key={table}
                className="flex items-center justify-between rounded-md bg-surface-2 dark:bg-card border border-border dark:border-border px-3 py-2"
              >
                <span className="text-xs text-foreground dark:text-muted-foreground truncate">
                  {table}
                </span>
                <span className="text-sm font-semibold tabular-nums text-foreground dark:text-foreground">
                  {n}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function SecurityPanel() {
  const { t } = useTranslation();

  const changePassword = useServerFn(changeOwnPassword);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (pw.length < 8) return toast.error(t("platform.account.passwordTooShort"));
    if (pw !== pw2) return toast.error(t("settings.passwords_do_not_match"));
    setSaving(true);
    try {
      await changePassword({ data: { newPassword: pw } });
      toast.success(t("settings.password_updated"));
      setPw("");
      setPw2("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("platform.account.passwordFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Lock className="w-4 h-4 text-brand" />
        <h2 className="text-base font-semibold">{t("platform.settings.security")}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {t("settings.update_your_account_password_you_will_stay_signed")}
      </p>
      <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
        <input
          type="password"
          autoComplete="new-password"
          placeholder={t("settings.new_password_min_8_chars")}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="bg-sidebar-active text-sidebar-foreground border border-border rounded-lg px-3 py-2 outline-none"
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder={t("platform.reset.confirmPassword")}
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          className="bg-sidebar-active text-sidebar-foreground border border-border rounded-lg px-3 py-2 outline-none"
        />
      </div>
      <div className="flex justify-end pt-4">
        <Button type="button" onClick={submit} disabled={saving || !pw || !pw2}>
          {saving ? t("platform.common.updating") : t("platform.settings.updatePassword")}
        </Button>
      </div>
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0">
      <div className="text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: T) => void;
  options: readonly T[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className="bg-sidebar-active text-sidebar-foreground border border-border rounded-lg px-3 py-2 w-64 outline-none font-medium"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
