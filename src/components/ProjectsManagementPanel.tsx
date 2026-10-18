import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { Panel } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Briefcase,
  Plus,
  Pencil,
  Trash2,
  Lock,
  Search,
  ArchiveRestore,
  ShieldAlert,
} from "lucide-react";
import { z } from "zod";
import { useAuthRoles } from "@/lib/auth-roles";
import { useAdminScope } from "@/lib/admin-scope";
import {
  PROJECT_STATUSES,
  SELECTABLE_PROJECT_STATUSES,
  PROJECT_TYPES,
  DEFAULT_PROJECT_STATUS,
  DEFAULT_PROJECT_TYPE,
  type ProjectStatusOption,
  type ProjectTypeOption,
} from "@/lib/project-constants";
import { ProjectStatusBadge, ProjectTypeBadge } from "@/components/ProjectBadges";
import { ProjectMembersPanel } from "@/components/ProjectMembersPanel";

import { useTranslation } from "react-i18next";
type Org = { id: string; name: string; max_projects: number };
type Project = {
  id: string;
  name: string;
  code: string | null;
  status: ProjectStatusOption;
  project_type: ProjectTypeOption;
  start_date: string | null;
  end_date: string | null;
  organization_id: string | null;
  created_at: string;
};

type FormState = {
  name: string;
  code: string;
  status: ProjectStatusOption;
  project_type: ProjectTypeOption;
  start_date: string | null;
  organization_id: string;
};

const projectSchema = z.object({
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
  status: z.enum(PROJECT_STATUSES, {
    errorMap: () => ({ message: "Please choose a valid project status." }),
  }),
  project_type: z.enum(PROJECT_TYPES, {
    errorMap: () => ({ message: "Please choose a valid project type." }),
  }),
  start_date: z.string().nullable(),
  organization_id: z.string().uuid("Please select an organization."),
});

const emptyForm = (orgId = ""): FormState => ({
  name: "",
  code: "",
  status: DEFAULT_PROJECT_STATUS,
  project_type: DEFAULT_PROJECT_TYPE,
  start_date: null,
  organization_id: orgId,
});

export function ProjectsManagementPanel() {
  const { t } = useTranslation();

  const { isSuperAdmin, adminOrgIds, loaded: rolesLoaded } = useAuthRoles();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [modalTab, setModalTab] = useState<"details" | "members">("details");
  const [userId, setUserId] = useState<string>("");

  // Project Code field: the value is uppercased/filtered as the user types, so
  // the caret must be restored manually after each controlled re-render.
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const codeCaretRef = useRef<number | null>(null);
  const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useIsoLayoutEffect(() => {
    const pos = codeCaretRef.current;
    if (pos == null || !codeInputRef.current) return;
    codeCaretRef.current = null;
    codeInputRef.current.setSelectionRange(pos, pos);
  });


  // Confirmation state for archive / restore (destructive-ish actions)
  const [confirmArchive, setConfirmArchive] = useState<Project | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<Project | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<ProjectStatusOption>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<ProjectTypeOption>>(new Set());
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    if (!rolesLoaded) return;
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setLoading(false);
      return;
    }
    setUserId(auth.user.id);

    // Tenant isolation: non-super-admins can only see/manage orgs where they are
    // owner/admin. Super Admins retain global oversight across every company.
    let orgQuery = supabase.from("organizations").select("id,name,max_projects");
    if (!isSuperAdmin) {
      if (adminOrgIds.length === 0) {
        setOrgs([]);
        setProjects([]);
        setLoading(false);
        return;
      }
      orgQuery = orgQuery.in("id", adminOrgIds);
    }
    const { data: orgRows } = await orgQuery;
    const visibleOrgs = (orgRows ?? []) as Org[];
    setOrgs(visibleOrgs);

    let projQuery = supabase
      .from("projects")
      .select("id,name,code,status,project_type,start_date,end_date,organization_id,created_at")
      .order("created_at", { ascending: false });
    if (!isSuperAdmin) {
      projQuery = projQuery.in(
        "organization_id",
        visibleOrgs.map((o) => o.id),
      );
    }
    const { data: projRows } = await projQuery;
    setProjects((projRows ?? []) as unknown as Project[]);
    setLoading(false);
  }, [isSuperAdmin, adminOrgIds, rolesLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  const countFor = (orgId: string | null) =>
    projects.filter((p) => p.organization_id === orgId).length;

  const scopeOrgId = useAdminScope((s) => s.orgId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (isSuperAdmin && scopeOrgId && p.organization_id !== scopeOrgId) return false;
      if (!showArchived && p.status === "Archived") return false;
      if (q && !p.name.toLowerCase().includes(q) && !(p.code ?? "").toLowerCase().includes(q))
        return false;
      if (statusFilter.size > 0 && !statusFilter.has(p.status)) return false;
      if (typeFilter.size > 0 && !typeFilter.has(p.project_type)) return false;
      return true;
    });
  }, [projects, search, statusFilter, typeFilter, showArchived, isSuperAdmin, scopeOrgId]);

  const toggleSet = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const openCreate = () => {
    setForm(emptyForm(orgs[0]?.id ?? ""));
    setCreating(true);
  };

  const openEdit = (p: Project) => {
    setEditing(p);
    setModalTab("details");
    setForm({
      name: p.name,
      code: p.code ?? "",
      status: p.status,
      project_type: p.project_type ?? DEFAULT_PROJECT_TYPE,
      start_date: p.start_date,
      organization_id: p.organization_id ?? "",
    });
  };

  // Stable identity: the dialog's focus trap keys off this handler, so a new
  // function on every keystroke would re-run the trap and steal focus.
  const closeModal = useCallback(() => {
    setCreating(false);
    setEditing(null);
    setModalTab("details");
  }, []);


  const submit = async () => {
    const parsed = projectSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input.");
      return;
    }
    const data = parsed.data;

    const org = orgs.find((o) => o.id === data.organization_id);
    if (!org) return toast.error(t("projectsmanagementpanel.organization_not_found"));

    setSaving(true);
    try {
      if (creating) {
        if (countFor(org.id) >= org.max_projects) {
          throw new Error(
            `Project limit reached for ${org.name}. Upgrade your plan to add more projects.`,
          );
        }
        const { error } = await supabase.from("projects").insert({
          name: data.name,
          code: data.code,
          status: data.status as never,
          project_type: data.project_type,
          start_date: data.start_date,
          organization_id: data.organization_id,
          owner_id: userId,
        } as never);
        if (error) throw error;
        toast.success(`Project "${data.code} — ${data.name}" created.`);
      } else if (editing) {
        const { error } = await supabase
          .from("projects")
          .update({
            name: data.name,
            code: data.code,
            status: data.status as never,
            project_type: data.project_type,
            start_date: data.start_date,
            organization_id: data.organization_id,
          } as never)
          .eq("id", editing.id);
        if (error) throw error;
        toast.success(t("projectsmanagementpanel.project_updated"));
      }
      closeModal();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save project.");
    } finally {
      setSaving(false);
    }
  };

  // Archive/restore are destructive-ish and gated to Super Admin only.
  // The confirmation flows are wired through ConfirmDialog (not window.confirm).
  const doArchive = async (p: Project) => {
    if (!isSuperAdmin) {
      toast.error(t("projectsmanagementpanel.only_the_super_admin_may_archive_projects"));
      return;
    }
    if (p.status === "Archived") {
      toast.info(t("projectsmanagementpanel.this_project_is_already_archived"));
      return;
    }
    try {
      const { error } = await supabase
        .from("projects")
        .update({ status: "Archived" as never } as never)
        .eq("id", p.id);
      if (error) throw error;
      toast.success(`Project "${p.name}" archived.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to archive project.");
    } finally {
      setConfirmArchive(null);
    }
  };

  const doRestore = async (p: Project) => {
    if (!isSuperAdmin) {
      toast.error(t("projectsmanagementpanel.only_the_super_admin_may_restore_projects"));
      return;
    }
    try {
      const { error } = await supabase
        .from("projects")
        .update({ status: DEFAULT_PROJECT_STATUS as never } as never)
        .eq("id", p.id);
      if (error) throw error;
      toast.success(`Project "${p.name}" restored to "${DEFAULT_PROJECT_STATUS}".`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restore project.");
    } finally {
      setConfirmRestore(null);
    }
  };

  const totalLimit = orgs.reduce((s, o) => s + o.max_projects, 0);
  const atLimitEverywhere = orgs.length > 0 && orgs.every((o) => countFor(o.id) >= o.max_projects);
  const activeFilters = statusFilter.size + typeFilter.size + (search ? 1 : 0);

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-brand" />
          <h2 className="text-base font-semibold">
            {t("projectsmanagementpanel.projects_management")}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {filtered.length} / {projects.length} shown · {totalLimit || "—"} max
          </span>
          <button
            onClick={openCreate}
            disabled={loading || orgs.length === 0 || atLimitEverywhere}
            title={
              atLimitEverywhere ? "Upgrade your plan to add more projects." : "Create new project"
            }
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-brand-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {atLimitEverywhere ? <Lock className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            New Project
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-sidebar-active text-white border border-border outline-none text-sm"
          />
        </div>
        <MultiSelectFilter
          label="Status"
          values={PROJECT_STATUSES as readonly ProjectStatusOption[]}
          selected={statusFilter}
          onToggle={(v) => setStatusFilter((s) => toggleSet(s, v))}
          onClear={() => setStatusFilter(new Set())}
        />
        <MultiSelectFilter
          label="Type"
          values={PROJECT_TYPES as readonly ProjectTypeOption[]}
          selected={typeFilter}
          onToggle={(v) => setTypeFilter((s) => toggleSet(s, v))}
          onClear={() => setTypeFilter(new Set())}
        />
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="accent-current"
          />
          {t("projectsmanagementpanel.show_archived")}
        </label>
        {activeFilters > 0 && (
          <button
            onClick={() => {
              setSearch("");
              setStatusFilter(new Set());
              setTypeFilter(new Set());
            }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Manage projects across your organizations. Each new project automatically initializes its
        Budget, Crew, Payables, and Reports data structures.
      </p>

      {loading ? (
        <div className="text-sm text-muted-foreground py-6">Loading projects…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg">
          {projects.length === 0
            ? 'No projects yet. Click "New Project" to create one.'
            : "No projects match the current filters."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Organization</th>
                <th className="py-2 pr-3">{t("projectsmanagementpanel.type")}</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Start Date</th>
                <th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const org = orgs.find((o) => o.id === p.organization_id);
                return (
                  <tr key={p.id} className="border-b border-border hover:bg-card/[0.02]">
                    <td className="py-2 pr-3">
                      {p.code ? (
                        <span className="inline-flex items-center rounded-md border border-brand/40 bg-brand/15 text-brand px-1.5 py-0.5 text-[11px] font-bold tracking-wider">
                          {p.code}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-medium">{p.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{org?.name ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <ProjectTypeBadge value={p.project_type} />
                    </td>
                    <td className="py-2 pr-3">
                      <ProjectStatusBadge value={p.status} />
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {p.start_date ? new Date(p.start_date).toLocaleDateString("en-GB") : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1.5 rounded-md hover:bg-muted"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {p.status === "Archived" ? (
                          <button
                            onClick={() => setConfirmRestore(p)}
                            disabled={!isSuperAdmin}
                            className="p-1.5 rounded-md hover:bg-success/20 text-success disabled:opacity-40 disabled:cursor-not-allowed"
                            title={
                              isSuperAdmin
                                ? "Restore project"
                                : "Only the Super Admin may restore projects"
                            }
                          >
                            {isSuperAdmin ? (
                              <ArchiveRestore className="w-4 h-4" />
                            ) : (
                              <ShieldAlert className="w-4 h-4" />
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirmArchive(p)}
                            disabled={!isSuperAdmin}
                            className="p-1.5 rounded-md hover:bg-destructive/20 text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
                            title={
                              isSuperAdmin
                                ? "Archive (soft delete — data is preserved)"
                                : "Only the Super Admin may archive projects"
                            }
                          >
                            {isSuperAdmin ? (
                              <Trash2 className="w-4 h-4" />
                            ) : (
                              <ShieldAlert className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {orgs.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            {t("projectsmanagementpanel.quota_by_organization")}
          </div>
          {orgs.map((o) => {
            const used = countFor(o.id);
            const full = used >= o.max_projects;
            return (
              <div key={o.id} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{o.name}</span>
                <span className={full ? "text-destructive font-semibold" : ""}>
                  {used} / {o.max_projects}
                  {full ? " · limit reached" : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {(creating || editing) && (
        <Modal onClose={closeModal} title={creating ? "New Project" : "Edit Project"}>
          {editing && (
            <div className="mb-4 flex gap-1 border-b border-border">
              <button
                onClick={() => setModalTab("details")}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${modalTab === "details" ? "border-brand text-white" : "border-transparent text-muted-foreground hover:text-white"}`}
              >
                Details
              </button>
              <button
                onClick={() => setModalTab("members")}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${modalTab === "members" ? "border-brand text-white" : "border-transparent text-muted-foreground hover:text-white"}`}
              >
                Members
              </button>
            </div>
          )}
          {editing && modalTab === "members" && editing.organization_id ? (
            <ProjectMembersPanel projectId={editing.id} organizationId={editing.organization_id} />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Project Code *</label>
                  <input
                    ref={codeInputRef}
                    value={form.code}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const caret = e.target.selectionStart ?? raw.length;
                      const next = raw
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, "")
                        .slice(0, 12);
                      const dropped = raw.slice(0, caret).replace(/[A-Za-z0-9]/g, "").length;
                      codeCaretRef.current = Math.min(Math.max(caret - dropped, 0), next.length);
                      setForm((f) => ({ ...f, code: next }));
                    }}
                    className="w-full bg-sidebar-active text-white border border-border rounded-lg px-3 py-2 outline-none font-mono tracking-wider uppercase"
                    placeholder="e.g., PROJ26"
                    maxLength={12}
                    dir="ltr"
                  />

                  <p className="mt-1 text-[11px] text-muted-foreground">
                    2–12 letters / digits, uppercase.
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Project Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-sidebar-active text-white border border-border rounded-lg px-3 py-2 outline-none"
                    placeholder="e.g., My New Production"
                    maxLength={120}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Organization *</label>
                <select
                  value={form.organization_id}
                  onChange={(e) => setForm({ ...form, organization_id: e.target.value })}
                  disabled={!creating}
                  className="w-full bg-sidebar-active text-white border border-border rounded-lg px-3 py-2 outline-none disabled:opacity-60"
                >
                  <option value="">Select…</option>
                  {orgs.map((o) => {
                    const used = countFor(o.id);
                    const full = used >= o.max_projects;
                    return (
                      <option key={o.id} value={o.id} disabled={creating && full}>
                        {o.name} ({used}/{o.max_projects}){creating && full ? " · full" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Type *</label>
                  <select
                    value={form.project_type}
                    onChange={(e) =>
                      setForm({ ...form, project_type: e.target.value as ProjectTypeOption })
                    }
                    className="w-full bg-sidebar-active text-white border border-border rounded-lg px-3 py-2 outline-none"
                  >
                    {PROJECT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Status *</label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value as ProjectStatusOption })
                    }
                    className="w-full bg-sidebar-active text-white border border-border rounded-lg px-3 py-2 outline-none"
                  >
                    {SELECTABLE_PROJECT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Start Date</label>
                <DateInput
                  value={form.start_date ?? ""}
                  onChange={(v) => setForm({ ...form, start_date: v || null })}
                />
              </div>
              <div className="pt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Preview:</span>
                <ProjectTypeBadge value={form.project_type} />
                <ProjectStatusBadge value={form.status} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-brand text-brand-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60"
                >
                  {saving ? "Saving…" : creating ? "Create Project" : "Save Changes"}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
      <ConfirmDialog
        open={!!confirmArchive}
        title={t("projectsmanagementpanel.archive_project")}
        tone="danger"
        confirmLabel="Archive project"
        message={
          confirmArchive
            ? `Archive project "${confirmArchive.name}"?\n\nThe project — and all its budgets, invoices, and payroll records — will be hidden from tenant views but preserved in the database. You can restore it any time from the "Show archived" filter.`
            : ""
        }
        onCancel={() => setConfirmArchive(null)}
        onConfirm={() => confirmArchive && doArchive(confirmArchive)}
      />
      <ConfirmDialog
        open={!!confirmRestore}
        title={t("projectsmanagementpanel.restore_project")}
        tone="success"
        confirmLabel="Restore project"
        message={
          confirmRestore
            ? `Restore project "${confirmRestore.name}" back to "${DEFAULT_PROJECT_STATUS}"? It will re-appear in tenant views immediately.`
            : ""
        }
        onCancel={() => setConfirmRestore(null)}
        onConfirm={() => confirmRestore && doRestore(confirmRestore)}
      />
    </Panel>
  );
}

function MultiSelectFilter<T extends string>({
  label,
  values,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  values: readonly T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-sidebar-active border border-border text-sm text-white hover:brightness-110"
      >
        {label}
        {selected.size > 0 && (
          <span className="px-1.5 py-0.5 rounded-md bg-brand text-brand-foreground text-[10px] font-semibold">
            {selected.size}
          </span>
        )}
        <span className="text-muted-foreground">▾</span>
      </button>
      {open && (
        <>
          <button
            aria-label={t("projectsmanagementpanel.close_filter")}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute z-20 mt-1 min-w-[200px] rounded-lg border border-border bg-sidebar-active shadow-lg p-2">
            {values.map((v) => {
              const checked = selected.has(v);
              return (
                <label
                  key={v}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm text-white rounded-md hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(v)}
                    className="accent-current"
                  />
                  <span>{v}</span>
                </label>
              );
            })}
            <div className="border-t border-border mt-1 pt-1 flex justify-end">
              <button
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
              >
                Clear
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
