import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Users, UserPlus, Trash2, Shield } from "lucide-react";

import { useTranslation } from "react-i18next";
import { PROJECT_ROLES, type ProjectRole } from "@/lib/project-role";
type ExecutiveTitle = "CEO" | "CFO" | "Executive Producer" | "Board Member";
const EXEC_TITLES: ExecutiveTitle[] = ["CEO", "CFO", "Executive Producer", "Board Member"];
// Roles an admin may hand out — "owner" is set only by project creation.
const ASSIGNABLE_ROLES = PROJECT_ROLES.filter((r) => r !== "owner");

type Member = {
  id: string;
  user_id: string;
  role: string;
  executive_title: ExecutiveTitle | null;
  display_name: string | null;
};

type OrgUser = {
  user_id: string;
  role: string;
  display_name: string | null;
};

export function ProjectMembersPanel({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  const { t } = useTranslation();

  const [members, setMembers] = useState<Member[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedUser, setSelectedUser] = useState("");
  const [role, setRole] = useState<ProjectRole>("member");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pmRes, omRes] = await Promise.all([
        supabase
          .from("project_members")
          .select("id,user_id,role,executive_title" as any)
          .eq("project_id", projectId),
        supabase
          .from("organization_members")
          .select("user_id,role")
          .eq("organization_id", organizationId),
      ]);
      const pmRows = (pmRes.data ?? []) as unknown as {
        id: string;
        user_id: string;
        role: string;
        executive_title: ExecutiveTitle | null;
      }[];
      const omRows = (omRes.data ?? []) as { user_id: string; role: string }[];
      const ids = Array.from(
        new Set([...pmRows.map((r) => r.user_id), ...omRows.map((r) => r.user_id)]),
      );
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id,display_name").in("id", ids)
        : { data: [] as { id: string; display_name: string | null }[] };
      const profMap = new Map((profs ?? []).map((p) => [p.id, p.display_name]));
      setMembers(
        pmRows.map((r) => ({
          ...r,
          executive_title: (r as any).executive_title ?? null,
          display_name: profMap.get(r.user_id) ?? null,
        })),
      );
      setOrgUsers(omRows.map((r) => ({ ...r, display_name: profMap.get(r.user_id) ?? null })));
    } finally {
      setLoading(false);
    }
  }, [projectId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentMemberIds = new Set(members.map((m) => m.user_id));
  const candidates = orgUsers.filter((u) => !currentMemberIds.has(u.user_id));

  const addMember = async () => {
    if (!selectedUser) {
      toast.error(t("projectmemberspanel.select_a_user_from_the_organization_first"));
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("project_members")
        .insert({ project_id: projectId, user_id: selectedUser, role });
      if (error) throw error;
      toast.success(t("projectmemberspanel.member_added_to_project"));
      setSelectedUser("");
      setRole("member");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add member.");
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (m: Member) => {
    if (!confirm(`Remove ${m.display_name ?? "this user"} from the project?`)) return;
    try {
      const { error } = await supabase.from("project_members").delete().eq("id", m.id);
      if (error) throw error;
      toast.success(t("projectmemberspanel.member_removed"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove member.");
    }
  };

  const changeRole = async (m: Member, newRole: string) => {
    try {
      const { error } = await supabase
        .from("project_members")
        .update({ role: newRole })
        .eq("id", m.id);
      if (error) throw error;
      toast.success(t("projectmemberspanel.role_updated"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update role.");
    }
  };

  const changeExecutiveTitle = async (m: Member, value: string) => {
    const newTitle = value === "" ? null : (value as ExecutiveTitle);
    try {
      const { error } = await supabase
        .from("project_members")
        .update({ executive_title: newTitle } as any)
        .eq("id", m.id);
      if (error) throw error;
      toast.success(
        newTitle ? `Assigned as ${newTitle} (Executive View).` : "Executive title cleared.",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update executive title.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-brand" />
        <h3 className="text-sm font-semibold text-foreground">
          {t("projectmemberspanel.project_members")}
        </h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Only users listed here (plus organization admins) can access this project's budget, payroll,
        invoices, and financial data.
      </p>

      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <UserPlus className="w-3 h-3" />
          {t("projectmemberspanel.add_member")}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            className="flex-1 bg-card text-foreground border border-border rounded-md px-2 py-1.5 text-sm"
          >
            <option value="">Select an organization member…</option>
            {candidates.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.display_name ?? u.user_id.slice(0, 8)} · {u.role}
              </option>
            ))}
          </select>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as ProjectRole)}
            className="bg-card text-foreground border border-border rounded-md px-2 py-1.5 text-sm"
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`projectRoles.${r}`)}
              </option>
            ))}
          </select>
          <button
            onClick={() => void addMember()}
            disabled={saving || !selectedUser}
            className="px-3 py-1.5 rounded-md bg-brand text-brand-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
        {!loading && candidates.length === 0 && (
          <div className="text-[11px] text-muted-foreground">
            All organization members are already on this project. Invite more users at the
            organization level to add them here.
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground py-4">Loading members…</div>
      ) : members.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
          {t("projectmemberspanel.no_project_members_yet_add_one_above")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Executive Title</th>
                <th className="py-2 pr-3 text-end">Action</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border">
                  <td className="py-2 pr-3 text-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Shield className="w-3 h-3 text-muted-foreground" />
                      {m.display_name ?? m.user_id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={m.role}
                      onChange={(e) => void changeRole(m, e.target.value)}
                      disabled={m.role === "owner"}
                      className="bg-card text-foreground border border-border rounded-md px-2 py-1 text-xs disabled:opacity-70"
                    >
                      {PROJECT_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`projectRoles.${r}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={m.executive_title ?? ""}
                      onChange={(e) => void changeExecutiveTitle(m, e.target.value)}
                      className="bg-card text-foreground border border-border rounded-md px-2 py-1 text-xs"
                      title={t(
                        "projectmemberspanel.executive_titles_get_a_strict_readonly_view_dashboard",
                      )}
                    >
                      <option value="">— None —</option>
                      {EXEC_TITLES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3 text-end">
                    <button
                      onClick={() => void removeMember(m)}
                      disabled={m.role === "owner"}
                      className="p-1.5 rounded-md hover:bg-destructive/20 text-destructive disabled:opacity-40"
                      title={m.role === "owner" ? "Cannot remove project owner" : "Remove member"}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
