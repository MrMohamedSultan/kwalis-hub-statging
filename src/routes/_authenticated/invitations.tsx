import { ProjectMultiSelect } from "@/components/ProjectMultiSelect";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";

import { supabase } from "@/integrations/supabase/client";
import { requireRoles, useAuthRoles } from "@/lib/auth-roles";
import { resendInvitation } from "@/lib/invitations.functions";
import {
  createUserDirect,
  adminResetUserPassword,
  removeOrgMember,
  updateOrgMember,
  assignUserRole,
} from "@/lib/admin-users.functions";
import { usePermissions } from "@/lib/permissions/usePermissions";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Building2,
  Mail,
  Plus,
  Copy,
  X,
  Send,
  Clock,
  CheckCircle2,
  Ban,
  RefreshCw,
  UserPlus,
  KeyRound,
  Users,
  Trash2,
  ChevronRight,
  ChevronDown,
  User as UserIcon,
  Pencil,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/invitations")({
  // Server-trust gate: matches the invitations RLS predicate
  // (is_super_admin OR is_org_admin on any organization).
  beforeLoad: () => requireRoles((r) => r.isSuperAdmin || r.adminOrgIds.length > 0),
  component: () => (
    <AppShell>
      <InvitationsPage />
    </AppShell>
  ),
});

type Org = { id: string; name: string; slug: string };
type Project = { id: string; name: string; organization_id: string };
type Invitation = {
  id: string;
  token: string;
  email: string;
  organization_id: string;
  project_id: string | null;
  org_role: "owner" | "admin" | "member";
  role_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

type Role = {
  id: string;
  name: string;
  organization_id: string | null;
  description?: string | null;
  is_system?: boolean;
};
type RoleAssignment = {
  user_id: string;
  role_id: string;
};
type Member = {
  user_id: string;
  organization_id: string;
  role: string;
  display_name: string | null;
  isPlatformAdmin: boolean;
};

type AccessErrors = {
  orgId?: string;
  projectId?: string;
  roleId?: string;
};

const AccessSelectionSchema = z
  .object({
    orgId: z.string(),
    projectId: z.string(),
    roleId: z.string(),
    hasGlobalAccess: z.boolean(),
    orgOptional: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    if (!input.orgId && !input.orgOptional) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orgId"],
        message: "Organization is required.",
      });
    }
    if (input.hasGlobalAccess) {
      if (input.projectId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectId"],
          message: "Global access users cannot be scoped to a single project.",
        });
      }
      if (input.roleId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["roleId"],
          message: "Global access users already have full access — no RBAC role needed.",
        });
      }
      return;
    }
    if (input.orgId && !input.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectId"],
        message: "Select at least one project for this user.",
      });
    }
  });

/**
 * Central validator for org / project / RBAC-role combinations.
 * Returns a field-keyed error map (empty = valid).
 */
function validateAccessSelection(input: {
  orgId: string;
  projectId: string;
  roleId: string;
  hasGlobalAccess: boolean;
  // When true, orgId is optional — used by the Platform Admin scope so
  // system-level users don't have to be bound to a client tenant.
  orgOptional?: boolean;
}): AccessErrors {
  const parsed = AccessSelectionSchema.safeParse(input);
  if (parsed.success) return {};
  const errors: AccessErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field === "orgId" || field === "projectId" || field === "roleId") {
      errors[field] = issue.message;
    }
  }
  return errors;
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <div className="mt-1 text-[10px] font-medium text-destructive leading-snug">⚠ {msg}</div>;
}

export function InvitationsPage({
  embedded = false,
  allowCreateOrg = !embedded,
}: {
  embedded?: boolean;
  allowCreateOrg?: boolean;
} = {}) {
  const { t } = useTranslation();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const { isSuperAdmin } = useAuthRoles();

  const refresh = useCallback(async () => {
    setLoading(true);
    const [
      { data: o },
      { data: p },
      { data: i },
      { data: r },
      { data: mem },
      { data: sa },
      { data: ura },
    ] = await Promise.all([
      supabase
        .from("organizations")
        .select("id,name,slug")
        .order("created_at", { ascending: false }),
      supabase.from("projects").select("id,name,organization_id"),
      supabase.from("invitations").select("*").order("created_at", { ascending: false }),
      supabase.from("roles").select("id,name,organization_id,description,is_system").order("name"),
      supabase.from("organization_members").select("user_id,organization_id,role"),
      supabase.from("user_roles").select("user_id,role").eq("role", "super_admin"),
      supabase.from("user_role_assignments").select("user_id,role_id"),
    ]);
    const memberRows = (mem ?? []) as Array<{
      user_id: string;
      organization_id: string;
      role: string;
    }>;
    const platformAdminIds = new Set(
      ((sa ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
    );
    const uniqueUserIds = Array.from(new Set(memberRows.map((m) => m.user_id)));
    const profilesById = new Map<string, { display_name: string | null }>();
    if (uniqueUserIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,display_name")
        .in("id", uniqueUserIds);
      for (const p of (profs ?? []) as Array<{ id: string; display_name: string | null }>) {
        profilesById.set(p.id, { display_name: p.display_name });
      }
    }
    setOrgs((o ?? []) as Org[]);
    setProjects((p ?? []) as Project[]);
    setInvites((i ?? []) as Invitation[]);
    setRoles((r ?? []) as Role[]);
    setRoleAssignments((ura ?? []) as RoleAssignment[]);
    setMembers(
      memberRows.map((m) => ({
        user_id: m.user_id,
        organization_id: m.organization_id,
        role: m.role,
        display_name: profilesById.get(m.user_id)?.display_name ?? null,
        isPlatformAdmin: platformAdminIds.has(m.user_id),
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <>
      {!embedded && (
        <>
          <PageTitle title={t("invitations.users_access")} />

          <Panel className="mb-5 p-4 border border-info/20 bg-info/5">
            <div className="flex items-start gap-3">
              <Mail className="size-4 mt-0.5 text-info shrink-0" />
              <div className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-semibold text-info">
                  {t("invitations.unified_users_access")}
                </span>{" "}
                active users are grouped by company below. Expand a company to see who has access
                and to which projects. Accounts are provisioned directly with a password from the{" "}
                <span className="font-semibold">{t("invitations.create_user_directly")}</span> panel
                — no email invitations required.
              </div>
            </div>
          </Panel>
        </>
      )}

      <div className="mb-6">
        <OrgAccessTree
          orgs={orgs}
          members={members}
          invites={invites}
          projects={projects}
          roles={roles}
          roleAssignments={roleAssignments}
          loading={loading}
          onChange={refresh}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {isSuperAdmin && allowCreateOrg && <CreateOrgCard onCreated={refresh} />}
        <CreateUserDirectCard orgs={orgs} projects={projects} roles={roles} onCreated={refresh} />

        <MembersCard
          members={members}
          orgs={orgs}
          roles={roles}
          roleAssignments={roleAssignments}
          onChange={refresh}
        />
      </div>

      <div className="mt-6">
        <Panel className="p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h3 className="text-sm font-semibold">{t("invitations.all_invitations_detail")}</h3>
            <span className="text-xs text-muted-foreground">{invites.length} total</span>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : invites.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              {t("invitations.no_invitations_yet_create_one_above")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table w-full">
                <thead className="bg-surface text-start text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Organization</th>
                    <th className="px-4 py-3">Project</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => (
                    <InviteRow
                      key={inv.id}
                      inv={inv}
                      orgs={orgs}
                      projects={projects}
                      onChange={refresh}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function OrgAccessTree({
  orgs,
  members,
  invites,
  projects,
  roles,
  roleAssignments,
  loading,
  onChange,
}: {
  orgs: Org[];
  members: Member[];
  invites: Invitation[];
  projects: Project[];
  roles: Role[];
  roleAssignments: RoleAssignment[];
  loading: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const assignRole = useServerFn(assignUserRole);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(orgs.map((o) => o.id)));
  const collapseAll = () => setExpanded(new Set());

  const q = search.trim().toLowerCase();
  const orgMatchesSearch = (o: Org) => {
    if (!q) return true;
    if (o.name.toLowerCase().includes(q)) return true;
    const orgMembers = members.filter((m) => m.organization_id === o.id);
    const orgInvites = invites.filter((i) => i.organization_id === o.id);
    return (
      orgMembers.some(
        (m) =>
          (m.display_name ?? "").toLowerCase().includes(q) || m.user_id.toLowerCase().includes(q),
      ) || orgInvites.some((i) => i.email.toLowerCase().includes(q))
    );
  };

  const visibleOrgs = orgs.filter(orgMatchesSearch);
  const pendingTotal = invites.filter((i) => !i.accepted_at && !i.revoked_at).length;

  return (
    <Panel className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-brand" />
          <h3 className="text-sm font-semibold">{t("invitations.users_access_by_organization")}</h3>
          <span className="text-xs text-muted-foreground">
            {orgs.length} companies · {members.length} active · {pendingTotal} pending
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("invitations.search_company_user_or_email")}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs w-64 outline-none focus:ring-2 focus:ring-brand"
          />
          <button
            onClick={expandAll}
            className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
          >
            {t("invitations.expand_all")}
          </button>
          <button
            onClick={collapseAll}
            className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
          >
            Collapse
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : visibleOrgs.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">
          {t("invitations.no_organizations_match_your_search")}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {visibleOrgs.map((o) => {
            const orgMembers = members.filter((m) => m.organization_id === o.id);
            const orgInvites = invites.filter((i) => i.organization_id === o.id);
            const pending = orgInvites.filter(
              (i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) >= new Date(),
            );
            const isOpen = expanded.has(o.id);
            return (
              <div key={o.id}>
                <button
                  onClick={() => toggle(o.id)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-muted text-start"
                >
                  {isOpen ? (
                    <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  )}
                  <Building2 className="size-4 text-brand shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{o.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {orgMembers.length} active · {pending.length} pending
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                    {orgMembers.length} active
                  </span>
                  {pending.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-[10px] font-semibold text-info">
                      {pending.length} pending
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="bg-card/[0.02] border-t border-border px-6 py-3 space-y-4">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
                        <CheckCircle2 className="size-3 text-success" /> Active members (
                        {orgMembers.length})
                      </div>
                      {orgMembers.length === 0 ? (
                        <div className="text-xs text-muted-foreground italic px-2 py-1">
                          {t("invitations.no_active_members_yet")}
                        </div>
                      ) : (
                        <ul className="space-y-1">
                          {orgMembers.map((m) => {
                            // user_role_assignments is UNIQUE(user_id): one RBAC role per user.
                            const assignment = roleAssignments.find((a) => a.user_id === m.user_id);
                            const assignedRole = assignment
                              ? roles.find((r) => r.id === assignment.role_id)
                              : undefined;
                            // Assignable in this org: platform-wide system roles + org-owned roles.
                            const assignableRoles = roles.filter(
                              (r) => r.organization_id === null || r.organization_id === o.id,
                            );
                            return (
                              <li
                                key={`${m.user_id}-${m.organization_id}`}
                                className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                              >
                                <UserIcon className="size-3.5 text-muted-foreground shrink-0" />
                                <span className="text-xs font-medium truncate">
                                  {m.display_name ?? (
                                    <span className="font-mono text-muted-foreground">
                                      {m.user_id.slice(0, 8)}…
                                    </span>
                                  )}
                                </span>
                                <span className="text-[10px] rounded border border-border bg-surface px-1.5 py-0.5 capitalize">
                                  {m.role}
                                </span>
                                {m.isPlatformAdmin && (
                                  <span className="text-[10px] rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-warning">
                                    👑 Platform
                                  </span>
                                )}
                                {assignedRole && (
                                  <span className="inline-flex items-center gap-1 text-[10px] rounded-full border border-highlight/40 bg-highlight/10 px-1.5 py-0.5 text-highlight">
                                    {assignedRole.name}
                                    <button
                                      title={t("invitations.remove_role")}
                                      onClick={async () => {
                                        try {
                                          await assignRole({
                                            data: {
                                              targetUserId: m.user_id,
                                              organizationId: o.id,
                                              roleId: null,
                                            },
                                          });
                                          toast.success(t("invitations.removed"));
                                          onChange();
                                        } catch (err) {
                                          toast.error(
                                            err instanceof Error
                                              ? err.message
                                              : "Could not remove role",
                                          );
                                        }
                                      }}
                                      className="opacity-70 hover:opacity-100"
                                    >
                                      ×
                                    </button>
                                  </span>
                                )}
                                {assignableRoles.length > 0 && (
                                  <select
                                    value=""
                                    onChange={async (e) => {
                                      const rid = e.target.value;
                                      if (!rid) return;
                                      try {
                                        await assignRole({
                                          data: {
                                            targetUserId: m.user_id,
                                            organizationId: o.id,
                                            roleId: rid,
                                          },
                                        });
                                        toast.success(t("invitations.role_assigned"));
                                        onChange();
                                      } catch (err) {
                                        toast.error(
                                          err instanceof Error
                                            ? err.message
                                            : "Could not assign role",
                                        );
                                      }
                                    }}
                                    className="text-[10px] rounded border border-border bg-surface px-1.5 py-0.5 text-muted-foreground"
                                  >
                                    <option value="">
                                      {assignedRole ? "Change role…" : "+ role…"}
                                    </option>
                                    {assignableRoles
                                      .filter((r) => r.id !== assignedRole?.id)
                                      .map((r) => (
                                        <option key={r.id} value={r.id}>
                                          {r.name}
                                        </option>
                                      ))}
                                  </select>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
                        <Clock className="size-3 text-info" /> Pending invitations ({pending.length}
                        )
                      </div>
                      {pending.length === 0 ? (
                        <div className="text-xs text-muted-foreground italic px-2 py-1">
                          {t("invitations.no_pending_invitations")}
                        </div>
                      ) : (
                        <ul className="space-y-1">
                          {pending.map((inv) => (
                            <li
                              key={inv.id}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                            >
                              <Mail className="size-3.5 text-info shrink-0" />
                              <span className="text-xs font-mono truncate">{inv.email}</span>
                              <span className="text-[10px] rounded border border-border bg-surface px-1.5 py-0.5 capitalize">
                                {inv.org_role}
                              </span>
                              {inv.project_id && (
                                <span className="text-[10px] text-muted-foreground truncate">
                                  →{" "}
                                  {projects.find((p) => p.id === inv.project_id)?.name ?? "project"}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function CreateOrgCard({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const slug =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") +
      "-" +
      Math.random().toString(36).slice(2, 6);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("organizations")
      .insert({ name: name.trim(), slug, created_by: user?.id });
    if (error) {
      toast.error(t("invitations.could_not_create_organization") + error.message);
    } else {
      // Auto-add creator as owner
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", slug)
        .single();
      if (org && user) {
        await supabase
          .from("organization_members")
          .insert({ organization_id: org.id, user_id: user.id, role: "owner" });
      }
      toast.success(t("invitations.organization_created"));
      setName("");
      onCreated();
    }
    setBusy(false);
  }

  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Building2 className="size-4 text-brand" />
        <h3 className="text-sm font-semibold">{t("invitations.create_organization")}</h3>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("invitations.acme_productions")}
          className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="size-3.5" /> Create
        </button>
      </form>
    </Panel>
  );
}

// NOTE: The email-based "Invite a user" panel was intentionally removed.
// All provisioning now happens through "Create user directly" so the workspace
// has no dependency on outbound invitation emails. Historic invitation rows
// remain visible below for audit purposes.

function InviteRow({
  inv,
  orgs,
  projects,
  onChange,
}: {
  inv: Invitation;
  orgs: Org[];
  projects: Project[];
  onChange: () => void;
}) {
  const { t } = useTranslation();

  const org = orgs.find((o) => o.id === inv.organization_id);
  const project = inv.project_id ? projects.find((p) => p.id === inv.project_id) : null;
  const expired = new Date(inv.expires_at) < new Date();
  const status = inv.revoked_at
    ? "revoked"
    : inv.accepted_at
      ? "accepted"
      : expired
        ? "expired"
        : "pending";
  const resend = useServerFn(resendInvitation);
  const [resending, setResending] = useState(false);

  const inviteUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/auth?invite=${inv.token}`;

  async function copy() {
    await navigator.clipboard.writeText(inviteUrl);
    toast.success(t("invitations.invitation_link_copied"));
  }

  async function resendEmail() {
    setResending(true);
    try {
      await resend({
        data: {
          invitationId: inv.id,
          redirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth` : undefined,
        },
      });
      toast.success(t("invitations.invitation_email_resent"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend");
    } finally {
      setResending(false);
    }
  }

  async function revoke() {
    const { error } = await supabase
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (error) toast.error(error.message);
    else {
      toast.success(t("invitations.invitation_revoked"));
      onChange();
    }
  }

  async function remove() {
    const { error } = await supabase.from("invitations").delete().eq("id", inv.id);
    if (error) toast.error(error.message);
    else {
      toast.success(t("invitations.invitation_deleted"));
      onChange();
    }
  }

  const tone =
    status === "pending"
      ? "bg-info/20 text-info border-info/40"
      : status === "accepted"
        ? "bg-success/20 text-success border-success/40"
        : status === "revoked"
          ? "bg-muted/20 text-foreground border-border"
          : "bg-warning/20 text-warning border-warning/40";
  const Icon = status === "accepted" ? CheckCircle2 : status === "revoked" ? Ban : Clock;

  return (
    <tr className="border-t border-border align-top hover:bg-muted">
      <td className="px-4 py-3 font-mono text-xs">{inv.email}</td>
      <td className="px-4 py-3 text-xs">{org?.name ?? "—"}</td>
      <td className="px-4 py-3 text-xs">{project?.name ?? "—"}</td>
      <td className="px-4 py-3 text-xs capitalize">{inv.org_role}</td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}
        >
          <Icon className="size-3" /> {status}
        </span>
      </td>
      <td className="px-4 py-3 text-end">
        <div className="inline-flex items-center gap-1.5">
          {status === "pending" && (
            <button
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] hover:bg-muted"
            >
              <Copy className="size-3" />
              {t("invitations.copy_link")}
            </button>
          )}
          {status === "pending" && (
            <button
              onClick={resendEmail}
              disabled={resending}
              className="inline-flex items-center gap-1 rounded-lg border border-info/40 bg-info/10 px-2.5 py-1 text-[11px] text-info hover:bg-info/20 disabled:opacity-50"
            >
              <RefreshCw className={`size-3 ${resending ? "animate-spin" : ""}`} />{" "}
              {resending ? "Sending…" : "Resend email"}
            </button>
          )}
          {status === "pending" && (
            <button
              onClick={revoke}
              className="inline-flex items-center gap-1 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] text-warning hover:bg-warning/20"
            >
              <Ban className="size-3" /> Revoke
            </button>
          )}

          <button
            onClick={remove}
            title="Delete"
            className="inline-flex items-center justify-center rounded-lg border border-destructive/40 bg-destructive/10 p-1 text-destructive hover:bg-destructive/20"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function CreateUserDirectCard({
  orgs,
  projects,
  roles,
  onCreated,
}: {
  orgs: Org[];
  projects: Project[];
  roles: Role[];
  onCreated: () => void;
}) {
  const { t } = useTranslation();

  const createDirect = useServerFn(createUserDirect);
  const { isSuperAdmin, adminOrgIds } = useAuthRoles();
  // Never offer a guaranteed-failure action: non-super actors may only
  // provision users into organizations they actually administer
  // (mirrors assertCanAdminOrg in createUserDirect).
  const creatableOrgs = isSuperAdmin ? orgs : orgs.filter((o) => adminOrgIds.includes(o.id));
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [orgId, setOrgId] = useState("");
  // Multi-project assignment: a user can be a member of several projects at once.
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [orgRole, setOrgRole] = useState<"owner" | "admin" | "member">("member");
  const [roleId, setRoleId] = useState("");
  const [scope, setScope] = useState<"platform" | "company">("company");
  const [busy, setBusy] = useState(false);

  const orgProjects = projects.filter((p) => p.organization_id === orgId);
  // Assignable in this org: platform-wide system roles + org-owned roles.
  const orgRoles = roles.filter((r) => r.organization_id === null || r.organization_id === orgId);
  const selectedRole = orgRoles.find((r) => r.id === roleId) ?? null;
  const hasGlobalAccess = scope === "platform" || orgRole === "owner";
  // Project assignment is an admin-only control. Mirrors assertCanAdminOrg on
  // the server and the RLS policies on project_members.
  const canAssignProjects = isSuperAdmin || (!!orgId && adminOrgIds.includes(orgId));

  useEffect(() => {
    if (hasGlobalAccess && (roleId || projectIds.length > 0)) {
      setRoleId("");
      setProjectIds([]);
    }
  }, [hasGlobalAccess, roleId, projectIds.length]);

  const toggleProject = (id: string) =>
    setProjectIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const errors = validateAccessSelection({
    orgId,
    projectId: projectIds[0] ?? "",
    roleId,
    hasGlobalAccess,
    orgOptional: scope === "platform",
  });
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordValid = password.length >= 8;
  const passwordError =
    password.length > 0 && !passwordValid ? "Password must be at least 8 characters." : undefined;
  const hasErrors = Object.keys(errors).length > 0 || !emailValid || !passwordValid;

  function suggestPassword() {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const pw = Array.from(
      bytes,
      (b) => "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%"[b % 62],
    ).join("");
    setPassword(pw);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (hasErrors) return;

    setBusy(true);
    try {
      const result = await createDirect({
        data: {
          email: email.trim().toLowerCase(),
          password,
          displayName: displayName.trim() || undefined,
          organizationId: scope === "platform" && !orgId ? null : orgId,
          orgRole,
          projectId: projectIds[0] ?? null,
          projectIds,
          roleId: roleId || null,
          scope,
        },
      });

      if ("warning" in result && result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success(t("invitations.user_created_share_the_password_with_them_securely"));
      }
      setEmail("");
      setDisplayName("");
      setPassword("");
      setProjectIds([]);
      setRoleId("");

      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2 mb-1">
        <UserPlus className="size-4 text-brand" />
        <h3 className="text-sm font-semibold">{t("invitations.create_user_directly")}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Provisions an account immediately with a password you set — no email required. Share the
        credentials with the user securely.
      </p>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {isSuperAdmin && (
          <div className="rounded-xl border border-border bg-card/[0.02] p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">
              {t("invitations.access_scope")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScope("company")}
                className={`rounded-lg border px-3 py-2 text-start text-xs transition ${scope === "company" ? "border-brand bg-brand/10 text-foreground" : "border-border bg-surface text-muted-foreground hover:bg-muted"}`}
              >
                <div className="font-semibold">🏢 Company Member</div>
                <div className="text-[10px] opacity-80 mt-0.5">
                  {t("invitations.access_limited_to_the_selected_organization")}
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setScope("platform");
                  setOrgId("");
                  setOrgRole("member");
                  setProjectIds([]);
                  setRoleId("");
                }}
                className={`rounded-lg border px-3 py-2 text-start text-xs transition ${scope === "platform" ? "border-warning/40 bg-warning/10 text-foreground" : "border-border bg-surface text-muted-foreground hover:bg-muted"}`}
              >
                <div className="font-semibold">👑 Platform Admin</div>
                <div className="text-[10px] opacity-80 mt-0.5">
                  {t("invitations.global_access_across_every_organization")}
                </div>
              </button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">
              Email
            </div>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("invitations.userexamplecom")}
              aria-invalid={email.length > 0 && !emailValid}
              className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand ${email.length > 0 && !emailValid ? "border-destructive/60" : "border-border"}`}
            />
            {email.length > 0 && !emailValid && <FieldError msg="Enter a valid email address." />}
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">
              {t("invitations.display_name_optional")}
            </div>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("invitations.jane_doe")}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <label className="block sm:col-span-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">
              {t("invitations.initial_password")}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("invitations.at_least_8_characters")}
                aria-invalid={!!passwordError}
                className={`flex-1 rounded-lg border bg-surface px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-brand ${passwordError ? "border-destructive/60" : "border-border"}`}
              />
              <button
                type="button"
                onClick={suggestPassword}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-xs hover:bg-muted"
              >
                Generate
              </button>
            </div>
            <FieldError msg={passwordError} />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">
              Organization{" "}
              {scope === "platform" ? (
                <span className="normal-case tracking-normal text-warning">
                  (optional — system-level user)
                </span>
              ) : (
                ""
              )}
            </div>
            <select
              required={scope !== "platform"}
              value={orgId}
              onChange={(e) => {
                setOrgId(e.target.value);
                setProjectIds([]);
                setRoleId("");
              }}
              aria-invalid={!!errors.orgId}
              className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand ${errors.orgId ? "border-destructive/60" : "border-border"}`}
            >
              <option value="">
                {scope === "platform" ? "No tenant (global)" : "Select org…"}
              </option>
              {creatableOrgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <FieldError msg={errors.orgId} />
          </label>

          <label className="block">
            <div
              className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1"
              title={t("invitations.org_role_dictates_companylevel_access_billing_members_all")}
            >
              {t("invitations.org_role")}
            </div>
            <select
              value={orgRole}
              onChange={(e) => setOrgRole(e.target.value as "owner" | "admin" | "member")}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              {isSuperAdmin && <option value="owner">Owner</option>}
            </select>
            <div className="mt-1 text-[10px] text-muted-foreground leading-snug">
              {t("invitations.companylevel_access_tier")}
            </div>
          </label>
          {canAssignProjects && (
            <div className="block sm:col-span-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">
                Projects{" "}
                {hasGlobalAccess ? (
                  <span className="normal-case tracking-normal">
                    (not applicable — global access)
                  </span>
                ) : (
                  <span className="text-destructive normal-case tracking-normal">
                    (select at least one)
                  </span>
                )}
              </div>
              <ProjectMultiSelect
                projects={orgProjects}
                value={projectIds}
                onChange={setProjectIds}
                disabled={!orgId || hasGlobalAccess}
                invalid={!!errors.projectId}
                emptyHint={
                  orgId
                    ? "This company has no projects yet."
                    : "Select a company to list its projects."
                }
              />
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {projectIds.length === 0
                    ? "No project selected yet."
                    : `${projectIds.length} project${projectIds.length > 1 ? "s" : ""} selected`}
                </span>
                {orgProjects.length > 0 && !hasGlobalAccess && orgId && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setProjectIds(orgProjects.map((p) => p.id))}
                      className="text-[10px] underline text-muted-foreground hover:text-foreground"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setProjectIds([])}
                      className="text-[10px] underline text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
              <FieldError msg={errors.projectId} />
            </div>
          )}

          <label className="block sm:col-span-2">
            <div
              className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1"
              title="Roles are defined in Role Management. They grant granular per-module permissions (Budgets, Invoices, POs, Payroll…)."
            >
              {t("invitations.role_optional")}
            </div>

            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              disabled={!orgId || hasGlobalAccess}
              aria-invalid={!!errors.roleId}
              className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 ${errors.roleId ? "border-destructive/60" : "border-border"}`}
            >
              <option value="">— None —</option>
              {orgRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <FieldError msg={errors.roleId} />
            {hasGlobalAccess ? (
              <div className="mt-1 text-[10px] leading-snug rounded border border-warning/40 bg-warning/10 px-2 py-1 text-warning">
                {scope === "platform" ? "Platform Admins" : "Owners"} already have full access —
                roles do not apply.
              </div>
            ) : selectedRole ? (
              <div className="mt-1 rounded border border-highlight/30 bg-highlight/5 px-2 py-1.5 text-[10px] leading-snug text-highlight">
                <div className="font-semibold mb-0.5 text-highlight">
                  {t("invitations.permissions_preview")}
                </div>
                {selectedRole.description ?? t("invitations.role_managed_in_role_management")}
              </div>
            ) : (
              <div className="mt-1 text-[10px] text-muted-foreground leading-snug">
                Granular operational permissions (e.g. Producer, Accountant, Coordinator).{" "}
                {orgId && orgRoles.length === 0 && (
                  <span className="text-warning">
                    No roles defined yet — create them in{" "}
                    <span className="font-semibold">Role Management</span>.
                  </span>
                )}
              </div>
            )}
          </label>
        </div>
        <button
          type="submit"
          disabled={busy || hasErrors}
          title={hasErrors ? "Resolve the highlighted fields to enable submit." : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <UserPlus className="size-3.5" /> {busy ? "Creating…" : "Create user"}
        </button>
      </form>
    </Panel>
  );
}

function MembersCard({
  members,
  orgs,
  roles,
  roleAssignments,
  onChange,
}: {
  members: Member[];
  orgs: Org[];
  roles: Role[];
  roleAssignments: RoleAssignment[];
  onChange: () => void;
}) {
  const { t } = useTranslation();

  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? "—";
  const { isSuperAdmin } = useAuthRoles();
  const [scopeFilter, setScopeFilter] = useState<"all" | "platform" | "company">("all");
  const [search, setSearch] = useState("");

  const platformCount = members.filter((m) => m.isPlatformAdmin).length;
  const companyCount = members.filter((m) => !m.isPlatformAdmin).length;

  const filtered = members.filter((m) => {
    const matchesScope =
      scopeFilter === "all"
        ? true
        : scopeFilter === "platform"
          ? m.isPlatformAdmin
          : !m.isPlatformAdmin;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (m.display_name ?? "").toLowerCase().includes(q) ||
      m.user_id.toLowerCase().includes(q) ||
      orgName(m.organization_id).toLowerCase().includes(q);
    return matchesScope && matchesSearch;
  });

  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <Users className="size-4 text-brand" />
        <h3 className="text-sm font-semibold">{t("invitations.team_members")}</h3>
        <span className="ms-auto text-xs text-muted-foreground">{members.length} total</span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        {isSuperAdmin ? (
          <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
            {[
              { key: "all", label: "All", count: members.length },
              { key: "platform", label: "👑 Platform", count: platformCount },
              { key: "company", label: "🏢 Company", count: companyCount },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setScopeFilter(tab.key as typeof scopeFilter)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  scopeFilter === tab.key
                    ? "bg-brand text-brand-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                <span
                  className={`rounded-full px-1.5 py-0 text-[10px] ${scopeFilter === tab.key ? "bg-surface-2 text-white" : "bg-surface-2 text-muted-foreground"}`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div />
        )}

        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("invitations.search_name_org_or_id")}
            className="w-full sm:w-56 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {members.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("invitations.no_members_yet_create_a_user_above_to")}
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("invitations.no_members_match_the_selected_filter")}
        </p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="app-table w-full">
            <thead className="bg-surface text-start text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2">Organization</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2 text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <MemberRow
                  key={`${m.user_id}-${m.organization_id}`}
                  m={m}
                  orgs={orgs}
                  orgName={orgName(m.organization_id)}
                  roles={roles}
                  roleAssignments={roleAssignments}
                  onChange={onChange}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function MemberRow({
  m,
  orgs,
  orgName,
  roles,
  roleAssignments,
  onChange,
}: {
  m: Member;
  orgs: Org[];
  orgName: string;
  roles: Role[];
  roleAssignments: RoleAssignment[];
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const { isSuperAdmin } = usePermissions();

  const [editOpen, setEditOpen] = useState(false);

  const reset = useServerFn(adminResetUserPassword);
  const remove = useServerFn(removeOrgMember);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  function generate() {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    setPw(
      Array.from(
        bytes,
        (b) => "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%"[b % 62],
      ).join(""),
    );
  }

  async function submit() {
    if (pw.length < 8) return toast.error(t("invitations.password_must_be_at_least_8_characters"));
    setBusy(true);
    try {
      await reset({ data: { targetUserId: m.user_id, newPassword: pw } });
      toast.success(t("invitations.password_reset_share_the_new_password_with_the"));
      setOpen(false);
      setPw("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    const label = m.display_name ?? `user ${m.user_id.slice(0, 8)}`;
    const confirmed = window.confirm(
      `Remove ${label} from ${orgName}?\n\nThey will lose access to this organization and all of its projects. This cannot be undone.`,
    );
    if (!confirmed) return;
    // Permanent account deletion is super-admin-only (enforced server-side).
    // Don't even offer it to org admins — it would be a guaranteed failure.
    const purgeAccount =
      isSuperAdmin &&
      window.confirm(
        `Also permanently delete the user's account?\n\nClick OK to delete the account entirely (super admin only).\nClick Cancel to keep the account and only revoke organization access.`,
      );
    setRemoving(true);
    try {
      await remove({
        data: {
          targetUserId: m.user_id,
          organizationId: m.organization_id,
          deleteAuthUser: purgeAccount,
        },
      });
      toast.success(purgeAccount ? "User deleted." : "Member removed from organization.");
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove member");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <tr className="border-t border-border hover:bg-muted">
      <td className="px-3 py-2 text-xs">
        {m.display_name ?? (
          <span className="text-muted-foreground font-mono">{m.user_id.slice(0, 8)}…</span>
        )}
      </td>
      <td className="px-3 py-2">
        {m.isPlatformAdmin ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
            👑 Platform
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[10px] font-semibold text-info">
            🏢 Company
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs">{orgName}</td>
      <td className="px-3 py-2 text-xs capitalize">{m.role}</td>

      <td className="px-3 py-2 text-end">
        {open ? (
          <div className="inline-flex items-center gap-2">
            <input
              type="text"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder={t("invitations.new_password")}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-mono w-44 outline-none focus:ring-2 focus:ring-brand"
            />
            <button
              onClick={generate}
              type="button"
              className="rounded-md border border-border px-2 py-1 text-[10px] hover:bg-muted"
            >
              Gen
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="rounded-md bg-brand px-2 py-1 text-[10px] font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setPw("");
              }}
              className="rounded-md border border-border px-2 py-1 text-[10px] hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5">
            <button
              onClick={() => setEditOpen(true)}
              title={t("invitations.edit_user")}
              className="inline-flex items-center gap-1 rounded-md border border-info/40 bg-info/10 px-2 py-1 text-[11px] text-info hover:bg-info/20"
            >
              <Pencil className="size-3" /> Edit
            </button>
            <button
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning hover:bg-warning/20"
            >
              <KeyRound className="size-3" />
              {t("invitations.reset_password")}
            </button>
            <button
              onClick={handleRemove}
              disabled={removing}
              title={t("invitations.remove_from_organization")}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/20 disabled:opacity-50"
            >
              <Trash2 className="size-3" /> {removing ? "Removing…" : "Remove"}
            </button>
          </div>
        )}
      </td>
      {editOpen && (
        <EditMemberModal
          m={m}
          orgs={orgs}
          roles={roles}
          roleAssignments={roleAssignments}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            onChange();
          }}
        />
      )}
    </tr>
  );
}

function EditMemberModal({
  m,
  orgs,
  roles,
  roleAssignments,
  onClose,
  onSaved,
}: {
  m: Member;
  orgs: Org[];
  roles: Role[];
  roleAssignments: RoleAssignment[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();

  const update = useServerFn(updateOrgMember);
  const { isSuperAdmin, adminOrgIds } = useAuthRoles();
  // Transfer targets are scoped like the create-user panel: only orgs the
  // actor administers. The current org always stays listed — it is the
  // selected, no-transfer value (mirrors assertCanAdminOrg in updateOrgMember).
  const transferableOrgs = isSuperAdmin
    ? orgs
    : orgs.filter((o) => adminOrgIds.includes(o.id) || o.id === m.organization_id);
  // user_role_assignments is UNIQUE(user_id): at most one RBAC role per user.
  const currentAssignment = roleAssignments.find((a) => a.user_id === m.user_id);

  const [displayName, setDisplayName] = useState(m.display_name ?? "");
  // `""` here represents the "Global / Platform Level (No Organization)" option.
  // Only surfaced when both the caller and the target are platform super admins.
  const [orgId, setOrgId] = useState<string>(m.organization_id);
  const [orgRole, setOrgRole] = useState<"owner" | "admin" | "member">(
    ["owner", "admin", "member"].includes(m.role)
      ? (m.role as "owner" | "admin" | "member")
      : "member",
  );
  const [roleId, setRoleId] = useState<string>(currentAssignment?.role_id ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState(false);

  const canGoGlobal = isSuperAdmin && m.isPlatformAdmin;
  const isGlobalTarget = orgId === "";

  // ── PROJECT-LEVEL ISOLATION ────────────────────────────────────────────
  // Only admins of the target organization (or platform super admins) may see
  // or change project assignments. The server re-checks this (assertCanAdminOrg)
  // and RLS on project_members is the final authority.
  const canManageProjects = isSuperAdmin || (!!orgId && adminOrgIds.includes(orgId));
  const [orgProjects, setOrgProjects] = useState<Project[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Assignable roles: platform-wide system roles + roles owned by the target org.
  // Reset when transferring or going global.
  const orgRoles = roles.filter((r) => r.organization_id === null || r.organization_id === orgId);
  useEffect(() => {
    if (orgId !== m.organization_id) setRoleId("");
  }, [orgId, m.organization_id]);

  // Load the target org's projects plus this user's current memberships.
  useEffect(() => {
    if (!canManageProjects || !orgId) {
      setOrgProjects([]);
      setProjectIds([]);
      return;
    }
    let cancelled = false;
    setProjectsLoading(true);
    void (async () => {
      const { data: projs } = await supabase
        .from("projects")
        .select("id,name,organization_id")
        .eq("organization_id", orgId)
        .order("name");
      const list = (projs ?? []) as Project[];
      const ids = list.map((p) => p.id);
      let assigned: string[] = [];
      if (ids.length > 0 && orgId === m.organization_id) {
        const { data: pm } = await supabase
          .from("project_members")
          .select("project_id")
          .eq("user_id", m.user_id)
          .in("project_id", ids);
        assigned = ((pm ?? []) as Array<{ project_id: string }>).map((r) => r.project_id);
      }
      if (cancelled) return;
      setOrgProjects(list);
      setProjectIds(assigned);
      setProjectsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [canManageProjects, orgId, m.organization_id, m.user_id]);

  // Only super admins can grant "owner"; other admins are capped at admin/member.
  const roleOptions: Array<"owner" | "admin" | "member"> = isSuperAdmin
    ? ["owner", "admin", "member"]
    : ["admin", "member"];

  const isTransferring = orgId !== m.organization_id;

  async function performSave() {
    setBusy(true);
    try {
      await update({
        data: {
          targetUserId: m.user_id,
          currentOrganizationId: m.organization_id,
          newOrganizationId: isGlobalTarget ? null : orgId,
          orgRole,
          displayName: displayName.trim() || undefined,
          roleId: isGlobalTarget ? null : roleId || null,
          // Omitted entirely for non-admin actors so project memberships are
          // left untouched (the server would reject them anyway).
          ...(canManageProjects && !isGlobalTarget ? { projectIds } : {}),
        },
      });
      toast.success(
        isGlobalTarget
          ? "User moved to Global / Platform Level."
          : isTransferring
            ? "User transferred and updated."
            : "User updated.",
      );
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update user.");
    } finally {
      setBusy(false);
      setConfirmTransfer(false);
    }
  }

  function save() {
    if (!isGlobalTarget && !orgId) return toast.error(t("invitations.organization_is_required"));
    if (isTransferring) {
      setConfirmTransfer(true);
      return;
    }
    void performSave();
  }

  return (
    <Modal onClose={onClose} title={t("invitations.edit_user")}>
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="text-xs text-muted-foreground">{t("invitations.display_name")}</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
            placeholder={t("invitations.full_name")}
          />
        </label>

        <label className="block">
          <span className="text-xs text-muted-foreground">
            Assigned organization{" "}
            {isTransferring && <span className="text-warning">(transfer)</span>}
          </span>
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
          >
            {canGoGlobal && <option value="">🌐 Global / Platform Level (No Organization)</option>}
            {transferableOrgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {isGlobalTarget && (
            <p className="mt-1 text-[11px] text-warning">
              This Platform Admin will be detached from any tenant organization and belong directly
              to Kwalis HUB at the global level. Their super-admin access is unchanged.
            </p>
          )}
          {isTransferring && !isGlobalTarget && (
            <p className="mt-1 text-[11px] text-warning">
              Transferring will remove this user from projects and role assignments under{" "}
              <b>{orgs.find((o) => o.id === m.organization_id)?.name ?? "the current org"}</b>.
            </p>
          )}
        </label>

        <label className="block">
          <span className="text-xs text-muted-foreground">{t("invitations.org_role")}</span>
          <select
            value={orgRole}
            onChange={(e) => setOrgRole(e.target.value as "owner" | "admin" | "member")}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm capitalize outline-none focus:ring-2 focus:ring-brand"
          >
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        {canManageProjects && !isGlobalTarget && (
          <div className="block">
            <span className="text-xs text-muted-foreground">Projects</span>
            {projectsLoading ? (
              <p className="mt-1 text-[11px] text-muted-foreground">Loading projects…</p>
            ) : (
              <>
                <div className="mt-1">
                  <ProjectMultiSelect
                    projects={orgProjects}
                    value={projectIds}
                    onChange={setProjectIds}
                    emptyHint="This company has no projects yet."
                  />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    {orgRole === "owner" || orgRole === "admin"
                      ? "Admins and owners can reach every project in the company."
                      : projectIds.length === 0
                        ? "No projects assigned — this user will see no projects."
                        : `${projectIds.length} project${projectIds.length > 1 ? "s" : ""} assigned`}
                  </span>
                  {orgProjects.length > 0 && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setProjectIds(orgProjects.map((p) => p.id))}
                        className="text-[10px] underline text-muted-foreground hover:text-foreground"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => setProjectIds([])}
                        className="text-[10px] underline text-muted-foreground hover:text-foreground"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
                {isTransferring && (
                  <p className="mt-1 text-[11px] text-warning">
                    Assignments here apply to the destination company after the transfer.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <label className="block">
          <span className="text-xs text-muted-foreground">{t("invitations.role_optional")}</span>
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">— None —</option>
            {orgRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {orgRoles.length === 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("invitations.no_roles_defined_yet")}
            </p>
          )}
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || (!orgId && !isGlobalTarget)}
            aria-busy={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmTransfer}
        tone="danger"
        title={
          isGlobalTarget
            ? "Move user to Global / Platform Level?"
            : "Transfer user to a different organization?"
        }
        message={
          <>
            {t("invitations.you_are_about_to_move")}
            <b>{m.display_name || m.user_id}</b> from{" "}
            <b>{orgs.find((o) => o.id === m.organization_id)?.name ?? "the current org"}</b> to{" "}
            <b>
              {isGlobalTarget
                ? "Global / Platform Level (Kwalis HUB)"
                : (orgs.find((o) => o.id === orgId)?.name ?? "the selected org")}
            </b>
            .
            <br />
            <br />
            This removes their project memberships and role assignment in the source organization.
            This action is logged in the audit trail.
          </>
        }
        confirmLabel={
          busy
            ? isGlobalTarget
              ? "Moving…"
              : "Transferring…"
            : isGlobalTarget
              ? "Yes, move to global"
              : "Yes, transfer"
        }
        onConfirm={() => void performSave()}
        onCancel={() => setConfirmTransfer(false)}
      />
    </Modal>
  );
}
