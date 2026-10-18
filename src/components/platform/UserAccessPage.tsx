// ═══════════════════════════════════════════════════════════════════
// UserAccessPage — Platform Hub "Users & Access".
//
// Cross-company user directory with dynamic RBAC assignment: each user
// holds at most ONE operational role (user_role_assignments is UNIQUE
// on user_id). Writes go through the browser client — RLS on
// user_role_assignments restricts management to org admins and
// platform super admins.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { PageTitle } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { listOrgMembers } from "@/lib/admin-users.functions";
import { permissionsKeys } from "@/lib/permissions/queries";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type RoleOption = {
  id: string;
  name: string;
  is_system: boolean;
  organization_id: string | null;
};

type UserGroup = {
  userId: string;
  email: string;
  displayName: string;
  orgs: string[];
  appRoles: string[];
};

const NONE = "__none__";

export function UserAccessPage() {
  const queryClient = useQueryClient();
  const [users, setUsers] = useState<UserGroup[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [members, rolesRes, assignRes] = await Promise.all([
        listOrgMembers(),
        supabase.from("roles").select("id, name, is_system, organization_id").order("name"),
        supabase.from("user_role_assignments").select("user_id, role_id"),
      ]);

      const map = new Map<string, UserGroup>();
      for (const m of members) {
        const g =
          map.get(m.userId) ??
          ({
            userId: m.userId,
            email: m.email,
            displayName: "",
            orgs: [],
            appRoles: [],
          } as UserGroup);
        if (m.displayName && !g.displayName) g.displayName = m.displayName;
        if (m.email && !g.email) g.email = m.email;
        if (m.orgName && !g.orgs.includes(m.orgName)) g.orgs.push(m.orgName);
        for (const r of m.appRoles) if (!g.appRoles.includes(r)) g.appRoles.push(r);
        map.set(m.userId, g);
      }
      setUsers(
        Array.from(map.values()).sort((a, b) =>
          (a.displayName || a.email).localeCompare(b.displayName || b.email),
        ),
      );

      if (rolesRes.error) throw rolesRes.error;
      setRoles((rolesRes.data ?? []) as RoleOption[]);

      if (assignRes.error) throw assignRes.error;
      const am: Record<string, string> = {};
      for (const a of assignRes.data ?? []) {
        am[(a as { user_id: string }).user_id] = (a as { role_id: string }).role_id;
      }
      setAssignments(am);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign(userId: string, roleId: string | null) {
    setSaving(userId);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!roleId) {
        // "Clear role" is intentionally platform-wide on this screen.
        const { error } = await supabase
          .from("user_role_assignments")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        // Assignments are per (user, organization, project). This page's
        // "one role per user" semantics now means one org-scoped row per
        // organization the user belongs to — never an org-less row.
        const { data: mems, error: memErr } = await supabase
          .from("organization_members")
          .select("organization_id")
          .eq("user_id", userId);
        if (memErr) throw memErr;
        const orgIds = [...new Set((mems ?? []).map((m) => m.organization_id as string))];
        if (orgIds.length === 0) {
          throw new Error(
            "User has no organization membership — add them to an organization first",
          );
        }
        const { error: delErr } = await supabase
          .from("user_role_assignments")
          .delete()
          .eq("user_id", userId)
          .is("project_id", null);
        if (delErr) throw delErr;
        const { error } = await supabase.from("user_role_assignments").upsert(
          orgIds.map((oid) => ({
            user_id: userId,
            organization_id: oid,
            role_id: roleId,
            assigned_by: user?.id ?? null,
          })),
          { onConflict: "user_id,organization_id,project_id" },
        );
        if (error) throw error;
      }
      setAssignments((prev) => {
        const next = { ...prev };
        if (roleId) next[userId] = roleId;
        else delete next[userId];
        return next;
      });
      toast.success("Role assignment updated");
      // Any permission caches (own or others') should re-resolve.
      queryClient.invalidateQueries({ queryKey: permissionsKeys.all });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update assignment");
    } finally {
      setSaving(null);
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle) ||
        u.orgs.some((o) => o.toLowerCase().includes(needle)),
    );
  }, [users, q]);

  return (
    <>
      <PageTitle title="Users & Access" back={false} />
      <p className="-mt-2 mb-5 text-sm text-muted-foreground">
        Cross-company user directory. Assign each person one operational role — the permission
        matrix takes effect immediately across layout, routes and data.
      </p>

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, email or company…"
          className="ps-9"
        />
      </div>

      <section className="rounded-xl border border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading users…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No users match your search.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 text-start font-medium">User</th>
                  <th className="px-4 py-3 text-start font-medium">Companies</th>
                  <th className="px-4 py-3 text-start font-medium">Platform</th>
                  <th className="px-4 py-3 text-start font-medium">Operational Role</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.userId} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">
                        {u.displayName || u.email.split("@")[0]}
                      </div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.orgs.length ? u.orgs.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.appRoles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          u.appRoles.map((r) => (
                            <span
                              key={r}
                              className="inline-flex rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand"
                            >
                              {r.replace(/_/g, " ")}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={assignments[u.userId] ?? NONE}
                        onValueChange={(v) => void assign(u.userId, v === NONE ? null : v)}
                        disabled={saving === u.userId}
                      >
                        <SelectTrigger className="w-52">
                          <SelectValue placeholder="No role assigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>— No role (legacy fallback) —</SelectItem>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name}
                              {r.is_system ? "" : " (custom)"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
