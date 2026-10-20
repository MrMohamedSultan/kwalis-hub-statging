// ═══════════════════════════════════════════════════════════════════
// UserAccessPage — Platform Hub "Users & Access".
//
// Super-admin user management for every account on the platform:
//   · directory with company memberships, platform role, status and last sign-in
//   · add a user (same form and server function as the Invitations screen)
//   · operational role (one RBAC role per user, user_role_assignments)
//   · account actions: reset password, require a new password at next sign-in,
//     force sign-out, disable / re-enable (db/pending/120 + auth admin API)
// Every write goes through a server function or RLS-protected table; the
// database re-checks that the caller is a super admin.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import {
  Ban,
  CheckCircle2,
  KeyRound,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCog,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { PageTitle } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { adminResetUserPassword } from "@/lib/admin-users.functions";
import {
  adminForceLogout,
  adminRequirePasswordChange,
  adminSetUserDisabled,
  listPlatformUsers,
  type PlatformUserRow,
} from "@/lib/platform-admin.functions";
import { useAuthRoles } from "@/lib/auth-roles";
import { permissionsKeys } from "@/lib/permissions/queries";
import { CreateUserDirectCard } from "@/routes/_authenticated/invitations";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
type OrgOption = { id: string; name: string; slug: string };
type ProjectOption = { id: string; name: string; organization_id: string };

type StatusFilter = "all" | "active" | "disabled" | "mustChange" | "neverSignedIn";
type PendingAction =
  | { kind: "reset"; user: PlatformUserRow }
  | { kind: "disable"; user: PlatformUserRow }
  | { kind: "enable"; user: PlatformUserRow }
  | { kind: "logout"; user: PlatformUserRow };

const NONE = "__none__";

function suggestPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function StatusBadge({ user }: { user: PlatformUserRow }) {
  const { t } = useTranslation();
  if (user.disabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        <Ban className="size-3" />
        {t("platformUsers.status.disabled")}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      <span className="inline-flex items-center gap-1 rounded-full border border-status-good/30 bg-status-good/10 px-2 py-0.5 text-xs font-medium text-status-good">
        <CheckCircle2 className="size-3" />
        {t("platformUsers.status.active")}
      </span>
      {user.mustChangePassword && (
        <span className="inline-flex items-center gap-1 rounded-full border border-status-warning/30 bg-status-warning/10 px-2 py-0.5 text-xs font-medium text-status-warning">
          <KeyRound className="size-3" />
          {t("platformUsers.status.mustChange")}
        </span>
      )}
    </div>
  );
}

export function UserAccessPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { userId: myId } = useAuthRoles();

  const listUsers = useServerFn(listPlatformUsers);
  const resetPassword = useServerFn(adminResetUserPassword);
  const requireChange = useServerFn(adminRequirePasswordChange);
  const forceLogout = useServerFn(adminForceLogout);
  const setDisabled = useServerFn(adminSetUserDisabled);

  const [users, setUsers] = useState<PlatformUserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [saving, setSaving] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, rolesRes, assignRes, orgRes, projRes] = await Promise.all([
        listUsers(),
        supabase.from("roles").select("id, name, is_system, organization_id").order("name"),
        supabase.from("user_role_assignments").select("user_id, role_id"),
        supabase.from("organizations").select("id, name, slug").order("name"),
        supabase.from("projects").select("id, name, organization_id").order("name"),
      ]);
      setUsers(list);
      if (rolesRes.error) throw rolesRes.error;
      setRoles((rolesRes.data ?? []) as RoleOption[]);
      if (assignRes.error) throw assignRes.error;
      const am: Record<string, string> = {};
      for (const a of (assignRes.data ?? []) as Array<{ user_id: string; role_id: string }>) {
        am[a.user_id] = a.role_id;
      }
      setAssignments(am);
      setOrgs((orgRes.data ?? []) as OrgOption[]);
      setProjects((projRes.data ?? []) as ProjectOption[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("platformUsers.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [listUsers, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign(userId: string, roleId: string | null) {
    setSaving(userId);
    try {
      if (!roleId) {
        // "Clear role" is intentionally platform-wide on this screen.
        const { error } = await supabase
          .from("user_role_assignments")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        // One org-scoped row per organization the user belongs to — never an org-less row.
        const orgIds = [
          ...new Set(
            (users.find((u) => u.userId === userId)?.memberships ?? []).map(
              (m) => m.organizationId,
            ),
          ),
        ];
        if (orgIds.length === 0) throw new Error(t("platformUsers.noCompanyForRole"));
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
            assigned_by: myId,
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
      toast.success(t("platformUsers.roleUpdated"));
      queryClient.invalidateQueries({ queryKey: permissionsKeys.all });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("platformUsers.actionFailed"));
    } finally {
      setSaving(null);
    }
  }

  async function toggleMustChange(user: PlatformUserRow) {
    setSaving(user.userId);
    try {
      await requireChange({
        data: { targetUserId: user.userId, required: !user.mustChangePassword },
      });
      toast.success(
        user.mustChangePassword
          ? t("platformUsers.toast.mustChangeCleared")
          : t("platformUsers.toast.mustChangeSet"),
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("platformUsers.actionFailed"));
    } finally {
      setSaving(null);
    }
  }

  const counts = useMemo(
    () => ({
      all: users.length,
      active: users.filter((u) => !u.disabled).length,
      disabled: users.filter((u) => u.disabled).length,
      mustChange: users.filter((u) => u.mustChangePassword && !u.disabled).length,
      neverSignedIn: users.filter((u) => !u.lastSignInAt).length,
    }),
    [users],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => {
      if (status === "active" && u.disabled) return false;
      if (status === "disabled" && !u.disabled) return false;
      if (status === "mustChange" && (!u.mustChangePassword || u.disabled)) return false;
      if (status === "neverSignedIn" && u.lastSignInAt) return false;
      if (!needle) return true;
      return (
        u.displayName.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle) ||
        u.memberships.some((m) => m.organizationName.toLowerCase().includes(needle))
      );
    });
  }, [users, q, status]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === "ar" ? "ar-EG" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language],
  );

  const filters: StatusFilter[] = ["all", "active", "disabled", "mustChange", "neverSignedIn"];

  return (
    <>
      <PageTitle title={t("platformHub.nav.users")} back={false} />
      <div className="-mt-2 mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("platformUsers.intro")}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            {t("platformUsers.refresh")}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="size-4" />
            {t("platformUsers.addUser")}
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("platformUsers.searchPlaceholder")}
            className="ps-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatus(f)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                status === f
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {t(`platformUsers.filter.${f}`)} · {counts[f]}
            </button>
          ))}
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card">
        {loading && users.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{t("platformUsers.loading")}</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{t("platformUsers.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 text-start font-medium">
                    {t("platformUsers.col.user")}
                  </th>
                  <th className="px-4 py-3 text-start font-medium">
                    {t("platformUsers.col.companies")}
                  </th>
                  <th className="px-4 py-3 text-start font-medium">
                    {t("platformUsers.col.status")}
                  </th>
                  <th className="px-4 py-3 text-start font-medium">
                    {t("platformUsers.col.lastSignIn")}
                  </th>
                  <th className="px-4 py-3 text-start font-medium">
                    {t("platformUsers.col.operationalRole")}
                  </th>
                  <th className="px-4 py-3 text-end font-medium">
                    <span className="sr-only">{t("platformUsers.col.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const isMe = u.userId === myId;
                  const isPlatformAdmin = u.appRoles.includes("super_admin");
                  return (
                    <tr
                      key={u.userId}
                      className={`border-b border-border/60 last:border-0 ${u.disabled ? "opacity-70" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          <Link
                            to="/platform-hub/users/$userId"
                            params={{ userId: u.userId }}
                            className="hover:underline"
                          >
                            {u.displayName}
                          </Link>
                          {isPlatformAdmin && (
                            <span className="inline-flex rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-brand">
                              {t("platformUsers.superAdmin")}
                            </span>
                          )}
                          {isMe && (
                            <span className="text-xs text-muted-foreground">
                              ({t("platformUsers.you")})
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground" dir="ltr">
                          {u.email}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {u.memberships.length === 0
                          ? "—"
                          : u.memberships.map((m) => (
                              <div key={m.organizationId}>
                                {m.organizationName}{" "}
                                <span className="text-xs">
                                  · {t(`platformUsers.orgRole.${m.orgRole}`, m.orgRole)}
                                </span>
                              </div>
                            ))}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge user={u} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {u.lastSignInAt
                          ? dateFmt.format(new Date(u.lastSignInAt))
                          : t("platformUsers.neverSignedIn")}
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={assignments[u.userId] ?? NONE}
                          onValueChange={(v) => void assign(u.userId, v === NONE ? null : v)}
                          disabled={saving === u.userId}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue placeholder={t("platformUsers.noRole")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>{t("platformUsers.noRole")}</SelectItem>
                            {roles.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name}
                                {r.is_system ? "" : ` (${t("platformUsers.custom")})`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("platformUsers.col.actions")}
                              disabled={saving === u.userId}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-60">
                            <DropdownMenuItem asChild>
                              <Link to="/platform-hub/users/$userId" params={{ userId: u.userId }}>
                                <UserCog className="size-4" />
                                {t("platformUsers.action.details")}
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setPending({ kind: "reset", user: u })}
                            >
                              <KeyRound className="size-4" />
                              {t("platformUsers.action.resetPassword")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void toggleMustChange(u)}>
                              <ShieldAlert className="size-4" />
                              {u.mustChangePassword
                                ? t("platformUsers.action.clearMustChange")
                                : t("platformUsers.action.requireMustChange")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={isMe}
                              onSelect={() => setPending({ kind: "logout", user: u })}
                            >
                              <LogOut className="size-4 rtl:-scale-x-100" />
                              {t("platformUsers.action.forceLogout")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {u.disabled ? (
                              <DropdownMenuItem
                                onSelect={() => setPending({ kind: "enable", user: u })}
                              >
                                <CheckCircle2 className="size-4" />
                                {t("platformUsers.action.enable")}
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                disabled={isMe}
                                className="text-destructive focus:text-destructive"
                                onSelect={() => setPending({ kind: "disable", user: u })}
                              >
                                <Ban className="size-4" />
                                {t("platformUsers.action.disable")}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("platformUsers.addUser")}</DialogTitle>
            <DialogDescription>{t("platformUsers.addUserHint")}</DialogDescription>
          </DialogHeader>
          <CreateUserDirectCard
            orgs={orgs}
            projects={projects}
            roles={roles}
            onCreated={() => {
              setAddOpen(false);
              void load();
            }}
          />
        </DialogContent>
      </Dialog>

      <ActionDialog
        pending={pending}
        onClose={() => setPending(null)}
        onDone={() => {
          setPending(null);
          void load();
        }}
        run={{ resetPassword, requireChange, forceLogout, setDisabled }}
      />
    </>
  );
}

function ActionDialog({
  pending,
  onClose,
  onDone,
  run,
}: {
  pending: PendingAction | null;
  onClose: () => void;
  onDone: () => void;
  run: {
    resetPassword: (a: { data: { targetUserId: string; newPassword: string } }) => Promise<unknown>;
    requireChange: (a: { data: { targetUserId: string; required: boolean } }) => Promise<unknown>;
    forceLogout: (a: { data: { targetUserId: string } }) => Promise<unknown>;
    setDisabled: (a: {
      data: { targetUserId: string; disabled: boolean; reason?: string };
    }) => Promise<unknown>;
  };
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pending) {
      setPassword(pending.kind === "reset" ? suggestPassword() : "");
      setMustChange(true);
      setReason("");
    }
  }, [pending]);

  if (!pending) return null;
  const { user } = pending;
  const name = user.displayName || user.email;

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "reset") {
        await run.resetPassword({ data: { targetUserId: user.userId, newPassword: password } });
        if (mustChange) {
          await run.requireChange({ data: { targetUserId: user.userId, required: true } });
        }
        try {
          await navigator.clipboard.writeText(password);
          toast.success(t("platformUsers.toast.passwordResetCopied"));
        } catch {
          toast.success(t("platformUsers.toast.passwordReset"));
        }
      } else if (pending.kind === "logout") {
        await run.forceLogout({ data: { targetUserId: user.userId } });
        toast.success(t("platformUsers.toast.loggedOut", { name }));
      } else {
        const disabled = pending.kind === "disable";
        await run.setDisabled({
          data: { targetUserId: user.userId, disabled, reason: reason.trim() || undefined },
        });
        toast.success(
          disabled
            ? t("platformUsers.toast.disabled", { name })
            : t("platformUsers.toast.enabled", { name }),
        );
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("platformUsers.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  const titles = {
    reset: t("platformUsers.action.resetPassword"),
    logout: t("platformUsers.action.forceLogout"),
    disable: t("platformUsers.action.disable"),
    enable: t("platformUsers.action.enable"),
  } as const;
  const bodies = {
    reset: t("platformUsers.confirm.reset", { name }),
    logout: t("platformUsers.confirm.logout", { name }),
    disable: t("platformUsers.confirm.disable", { name }),
    enable: t("platformUsers.confirm.enable", { name }),
  } as const;
  const invalid = pending.kind === "reset" && password.length < 8;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titles[pending.kind]}</DialogTitle>
          <DialogDescription>{bodies[pending.kind]}</DialogDescription>
        </DialogHeader>

        {pending.kind === "reset" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">{t("platformUsers.newPassword")}</Label>
              <div className="flex gap-2">
                <Input
                  id="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  dir="ltr"
                  autoComplete="off"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPassword(suggestPassword())}
                >
                  {t("platformUsers.generate")}
                </Button>
              </div>
              {invalid && (
                <p className="text-xs text-destructive">{t("platformUsers.passwordTooShort")}</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={mustChange} onCheckedChange={(v) => setMustChange(v === true)} />
              {t("platformUsers.mustChangeOnNextSignIn")}
            </label>
          </div>
        )}

        {pending.kind === "disable" && (
          <div className="space-y-1.5">
            <Label htmlFor="disable-reason">{t("platformUsers.reason")}</Label>
            <Textarea
              id="disable-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("platformUsers.reasonPlaceholder")}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={pending.kind === "disable" ? "destructive" : "default"}
            onClick={() => void confirm()}
            disabled={busy || invalid}
          >
            {titles[pending.kind]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
