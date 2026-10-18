import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  UserPlus,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Clock,
  History,
} from "lucide-react";
import {
  useBudgetStatus,
  useBudgetApprovers,
  addBudgetApprover,
  removeBudgetApprover,
  recordApproverDecision,
  resolveStatusFromApprovers,
  setBudgetStatus,
  EXECUTIVE_TITLES,
  type ExecutiveTitle,
  type BudgetStatus,
} from "@/lib/budget-governance";
import { useAuthRoles } from "@/lib/auth-roles";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";

import { useTranslation } from "react-i18next";
const MAX_APPROVERS = 5;

const STATUS_STYLE: Record<
  BudgetStatus,
  { bg: string; text: string; label: string; icon: React.ReactNode }
> = {
  Draft: {
    bg: "bg-surface-2 border-border dark:bg-muted/15 dark:border-border",
    text: "text-foreground dark:text-foreground",
    label: "DRAFT",
    icon: <Unlock className="size-4" />,
  },
  "Pending Approval": {
    bg: "bg-warning border-warning/40 dark:bg-warning/15 dark:border-warning/40",
    text: "text-warning dark:text-warning",
    label: "PENDING APPROVAL",
    icon: <Loader2 className="size-4" />,
  },
  "Locked/Approved": {
    bg: "bg-success border-success/40 dark:bg-success/15 dark:border-success/40",
    text: "text-success dark:text-success",
    label: "LOCKED 🔒",
    icon: <Lock className="size-4" />,
  },
  "Revision Requested": {
    bg: "bg-destructive border-destructive/40 dark:bg-destructive/15 dark:border-destructive/40",
    text: "text-destructive dark:text-destructive",
    label: "REVISION REQUESTED",
    icon: <AlertTriangle className="size-4" />,
  },
};

type OrgUser = { user_id: string; display_name: string | null };

export function BudgetGovernancePanel({
  projectId,
  organizationId,
  isExecutive,
  canManage,
}: {
  projectId: string;
  organizationId: string | null;
  isExecutive: boolean;
  canManage: boolean;
}) {
  const { t } = useTranslation();

  const roles = useAuthRoles();
  const { status, refresh: refreshStatus } = useBudgetStatus(projectId);
  const { approvers, refresh: refreshApprovers } = useBudgetApprovers(projectId);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [allOrgUsers, setAllOrgUsers] = useState<OrgUser[]>([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUser, setAssignUser] = useState("");
  const [assignTitle, setAssignTitle] = useState<ExecutiveTitle>("CFO");

  const loadExecutives = React.useCallback(async () => {
    if (!organizationId) return;
    // 1) All members of this organization
    const { data: oms } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId);
    const memberIds = (oms ?? []).map((r: any) => r.user_id as string);
    if (!memberIds.length) {
      setOrgUsers([]);
      setAllOrgUsers([]);
      return;
    }

    // Who may be GIVEN an executive title on this project: its own members
    // only. Listing the whole organization (as before) let an admin hand a
    // title — and with it access to this project's figures and the right to
    // approve its budget — to someone who was never put on the project.
    const { data: pms } = await supabase
      .from("project_members")
      .select("user_id")
      .eq("project_id", projectId)
      .in("user_id", memberIds);
    const projectMemberIds = Array.from(
      new Set((pms ?? []).map((r: any) => r.user_id as string)),
    );
    if (projectMemberIds.length) {
      const { data: allProfs } = await supabase
        .from("profiles")
        .select("id,display_name")
        .in("id", projectMemberIds);
      setAllOrgUsers(
        (allProfs ?? []).map((p: any) => ({ user_id: p.id, display_name: p.display_name })),
      );
    } else {
      setAllOrgUsers([]);
    }

    // 2) Restrict to users who are actual executives / board members.
    //    An executive is either:
    //      (a) profiles.executive_title ∈ EXECUTIVE_TITLES, OR
    //      (b) project_members.executive_title set on THIS project
    //          (a per-project board assignment is valid for that project only;
    //          a title held on another project of the company does not make
    //          someone an approver of this one)
    //    Board membership is NOT a platform role: user_roles.role is app_role
    //    (super_admin/admin/manager/member) — querying it for 'board_member'
    //    is an enum violation (400) and must never be reintroduced.
    const [profRes, pmRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id,display_name,executive_title" as any)
        .in("id", memberIds)
        .not("executive_title", "is", null),
      supabase
        .from("project_members")
        .select("user_id,executive_title" as any)
        .eq("project_id", projectId)
        .in("user_id", memberIds)
        .not("executive_title", "is", null),
    ]);

    const execIds = new Set<string>();
    for (const p of (profRes.data ?? []) as any[]) if (p.executive_title) execIds.add(p.id);
    for (const r of (pmRes.data ?? []) as any[]) if (r.executive_title) execIds.add(r.user_id);

    if (!execIds.size) {
      setOrgUsers([]);
      return;
    }

    const { data: profs } = await supabase
      .from("profiles")
      .select("id,display_name")
      .in("id", Array.from(execIds));
    setOrgUsers((profs ?? []).map((p: any) => ({ user_id: p.id, display_name: p.display_name })));
  }, [organizationId, projectId]);

  useEffect(() => {
    void loadExecutives();
  }, [loadExecutives]);

  async function handleAssignTitle() {
    if (!assignUser) {
      toast.error("Select a user first.");
      return;
    }
    setBusy(true);
    try {
      const { data: existing } = await supabase
        .from("project_members")
        .select("id")
        .eq("project_id", projectId)
        .eq("user_id", assignUser)
        .maybeSingle();
      if (existing?.id) {
        const { error } = await supabase
          .from("project_members")
          .update({ executive_title: assignTitle } as any)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        // Never add someone to the project as a side effect of giving a title.
        throw new Error(
          "This user is not a member of the project. Add them to the project first, then assign the title.",
        );
      }
      toast.success(`Assigned as ${assignTitle}.`);
      setAssignUser("");
      setAssignOpen(false);
      await loadExecutives();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to assign executive title.");
    } finally {
      setBusy(false);
    }
  }


  const style = STATUS_STYLE[status];
  const myApprover = approvers.find((a) => a.userId === roles.userId);

  const candidates = useMemo(() => {
    const taken = new Set(approvers.map((a) => a.userId));
    return orgUsers.filter((u) => !taken.has(u.user_id));
  }, [orgUsers, approvers]);

  async function reconcile() {
    const next = resolveStatusFromApprovers(await freshApprovers(projectId), status);
    if (next !== status) {
      await setBudgetStatus(projectId, next, roles.userId ?? null);
      await refreshStatus();
      await useStore.getState().loadProjects();
    }
  }

  async function handleAddApprover() {
    if (!selectedUser) {
      toast.error(t("budgetgovernancepanel.select_a_board_member_to_add"));
      return;
    }
    if (approvers.length >= MAX_APPROVERS) {
      toast.error(`Maximum ${MAX_APPROVERS} approvers.`);
      return;
    }
    setBusy(true);
    try {
      await addBudgetApprover(projectId, organizationId, selectedUser);
      // Moving to Pending Approval once approvers exist and status is Draft.
      if (status === "Draft")
        await setBudgetStatus(projectId, "Pending Approval", roles.userId ?? null);
      toast.success(t("budgetgovernancepanel.approver_added"));
      setSelectedUser("");
      await Promise.all([refreshApprovers(), refreshStatus()]);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add approver.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    setBusy(true);
    try {
      await removeBudgetApprover(id);
      toast.success(t("budgetgovernancepanel.approver_removed"));
      await refreshApprovers();
      await reconcile();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to remove approver.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDecision(decision: "approved" | "rejected") {
    if (!myApprover) return;
    const note =
      decision === "rejected"
        ? (prompt("Reason for rejection (optional):", myApprover.note ?? "") ?? null)
        : null;
    setBusy(true);
    try {
      await recordApproverDecision(myApprover.id, decision, note);
      toast.success(
        decision === "approved" ? "Budget approved." : "Rejection recorded — revision requested.",
      );
      await refreshApprovers();
      await reconcile();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to record decision.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestRevision() {
    if (!confirm(t("budgetgovernancepanel.request_revision_this_unlocks_the_budget_for_editing")))
      return;
    setBusy(true);
    try {
      // Reset all approver decisions
      await Promise.all(
        approvers.map((a) =>
          recordApproverDecision(a.id, "approved" as any, null).catch(() => null),
        ),
      );
      const { error } = await supabase
        .from("budget_approvers")
        .update({ decision: "pending", decided_at: null, note: null })
        .eq("project_id", projectId);
      if (error) throw error;
      await setBudgetStatus(projectId, "Draft", roles.userId ?? null);
      toast.success(t("budgetgovernancepanel.budget_unlocked_for_revision"));
      await Promise.all([refreshApprovers(), refreshStatus()]);
      await useStore.getState().loadProjects();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to request revision.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-2xl border ${style.bg} px-4 py-3 mb-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className={`inline-flex items-center gap-2 font-bold ${style.text}`}>
          {style.icon}
          <span>Budget Status: {style.label}</span>
        </div>
        <div className="flex-1" />
        {myApprover && status !== "Locked/Approved" && (
          <>
            <button
              disabled={busy || myApprover.decision === "approved"}
              onClick={() => handleDecision("approved")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-success hover:bg-success disabled:opacity-50 text-foreground text-xs font-semibold px-3 py-1.5"
            >
              <CheckCircle2 className="size-4" /> Approve
            </button>
            <button
              disabled={busy || myApprover.decision === "rejected"}
              onClick={() => handleDecision("rejected")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive hover:bg-destructive disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5"
            >
              <XCircle className="size-4" /> Reject
            </button>
          </>
        )}
        {canManage && status === "Locked/Approved" && (
          <button
            disabled={busy}
            onClick={handleRequestRevision}
            className="inline-flex items-center gap-1.5 rounded-lg bg-warning hover:bg-warning disabled:opacity-50 text-foreground text-xs font-semibold px-3 py-1.5"
          >
            <Unlock className="size-4" />
            {t("budgetgovernancepanel.request_revision")}
          </button>
        )}
      </div>

      {/* Approvers list */}
      {(approvers.length > 0 || canManage) && (
        <div className="mt-3 pt-3 border-t border-border dark:border-border">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-foreground dark:text-muted-foreground mb-2">
            <ShieldCheck className="size-3" />
            Required Approvers ({approvers.length}/{MAX_APPROVERS})
          </div>
          {approvers.length === 0 && (
            <div className="text-xs text-foreground dark:text-muted-foreground">
              {t("budgetgovernancepanel.no_approvers_assigned_yet_assign_board_members_below")}
            </div>
          )}
          {status === "Pending Approval" && approvers.some((a) => a.decision !== "approved") && (
            <div className="mb-2 text-[11px] flex items-center gap-1.5 text-warning dark:text-warning">
              <Clock className="size-3" />
              Waiting on {approvers.filter((a) => a.decision === "pending").length} approver(s)
            </div>
          )}
          <div className="flex flex-col gap-1">
            {approvers.map((a) => {
              const pending = a.decision === "pending";
              const approved = a.decision === "approved";
              const rejected = a.decision === "rejected";
              return (
                <div
                  key={a.id}
                  className={`flex items-center gap-2 text-xs rounded-md px-2 py-1.5 ${
                    approved
                      ? "bg-success dark:bg-success/10 border border-success/40 dark:border-success/30"
                      : rejected
                        ? "bg-destructive dark:bg-destructive/10 border border-destructive/40 dark:border-destructive/30"
                        : "bg-warning dark:bg-warning/10 border border-warning/40 dark:border-warning/30"
                  }`}
                >
                  {approved ? (
                    <CheckCircle2 className="size-4 text-success dark:text-success shrink-0" />
                  ) : rejected ? (
                    <XCircle className="size-4 text-destructive dark:text-destructive shrink-0" />
                  ) : (
                    <Clock className="size-4 text-warning dark:text-warning shrink-0" />
                  )}
                  <span className="flex-1 text-foreground dark:text-foreground font-medium">
                    {a.displayName ?? a.userId.slice(0, 8)}
                  </span>
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      approved
                        ? "bg-success text-success dark:bg-success/25 dark:text-success"
                        : rejected
                          ? "bg-destructive text-destructive dark:bg-destructive/25 dark:text-destructive"
                          : "bg-warning text-warning dark:bg-warning/25 dark:text-warning"
                    }`}
                  >
                    {pending ? "awaiting" : a.decision}
                  </span>
                  {a.decidedAt && (
                    <span className="text-[10px] text-muted-foreground dark:text-muted-foreground hidden sm:inline">
                      {new Date(a.decidedAt).toLocaleDateString()}
                    </span>
                  )}
                  {canManage && !isExecutive && (
                    <button
                      disabled={busy}
                      onClick={() => handleRemove(a.id)}
                      className="p-1 rounded hover:bg-destructive/20 text-destructive dark:text-destructive disabled:opacity-40"
                      title={t("budgetgovernancepanel.remove_approver")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {canManage && !isExecutive && approvers.length < MAX_APPROVERS && (
            <div className="mt-2 flex flex-col sm:flex-row gap-2">
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="flex-1 bg-card text-foreground border border-border dark:bg-card dark:text-white dark:border-border rounded-md px-2 py-1.5 text-xs"
              >
                <option value="">
                  {candidates.length
                    ? "Select board member…"
                    : "No executives available — assign an Executive Title first"}
                </option>
                {candidates.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.display_name ?? u.user_id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void handleAddApprover()}
                disabled={busy || !selectedUser}
                className="inline-flex items-center gap-1 rounded-md bg-brand text-brand-foreground text-xs font-semibold px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
              >
                <UserPlus className="size-3.5" />
                {t("budgetgovernancepanel.add_approver")}
              </button>
            </div>
          )}

          {canManage && !isExecutive && (
            <div className="mt-2">
              <button
                onClick={() => setAssignOpen((v) => !v)}
                className="text-[11px] text-brand hover:underline"
              >
                {assignOpen ? "Hide executive title assignment" : "Assign an Executive Title…"}
              </button>
              {assignOpen && (
                <div className="mt-2 flex flex-col sm:flex-row gap-2">
                  <select
                    value={assignUser}
                    onChange={(e) => setAssignUser(e.target.value)}
                    className="flex-1 bg-card text-foreground border border-border rounded-md px-2 py-1.5 text-xs"
                  >
                    <option value="">Select an organization member…</option>
                    {allOrgUsers.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.display_name ?? u.user_id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={assignTitle}
                    onChange={(e) => setAssignTitle(e.target.value as ExecutiveTitle)}
                    className="bg-card text-foreground border border-border rounded-md px-2 py-1.5 text-xs"
                  >
                    {EXECUTIVE_TITLES.map((title) => (
                      <option key={title} value={title}>
                        {title}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => void handleAssignTitle()}
                    disabled={busy || !assignUser}
                    className="inline-flex items-center gap-1 rounded-md bg-brand text-brand-foreground text-xs font-semibold px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
                  >
                    <ShieldCheck className="size-3.5" />
                    Assign
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ApprovalActivityLog
        projectId={projectId}
        refreshKey={`${status}:${approvers.map((a) => a.decision).join(",")}`}
      />
    </div>
  );
}

function ApprovalActivityLog({ projectId, refreshKey }: { projectId: string; refreshKey: string }) {
  const { t } = useTranslation();

  const [events, setEvents] = useState<
    Array<{
      id: string;
      action: string;
      from_status: string | null;
      to_status: string | null;
      actor_id: string | null;
      actor_name: string | null;
      note: string | null;
      created_at: string;
    }>
  >([]);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("budget_status_events" as any)
        .select("id,action,from_status,to_status,actor_id,note,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(50);
      const rows = (data ?? []) as any[];
      const ids = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean)));
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id,display_name").in("id", ids)
        : { data: [] };
      const nm = new Map((profs ?? []).map((p: any) => [p.id, p.display_name]));
      if (cancel) return;
      setEvents(
        rows.map((r) => ({ ...r, actor_name: r.actor_id ? (nm.get(r.actor_id) ?? null) : null })),
      );
    })();
    return () => {
      cancel = true;
    };
  }, [projectId, refreshKey]);

  if (!events.length) return null;
  const shown = expanded ? events : events.slice(0, 5);

  const labelFor = (a: string) =>
    (
      ({
        status_change: "Status changed",
        approver_added: "Approver added",
        approver_removed: "Approver removed",
        approver_approved: "Approved",
        approver_rejected: "Rejected",
      }) as Record<string, string>
    )[a] ?? a;

  return (
    <div className="mt-3 pt-3 border-t border-border dark:border-border">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-foreground dark:text-muted-foreground mb-2">
        <History className="size-3" />
        {t("budgetgovernancepanel.approval_activity_log")}
      </div>
      <div className="flex flex-col gap-1.5">
        {shown.map((e) => (
          <div
            key={e.id}
            className="grid grid-cols-1 sm:grid-cols-[110px_auto_1fr_auto] items-start gap-x-2 gap-y-0.5 text-[11px] bg-surface-2 dark:bg-black/20 rounded-md px-2 py-1.5"
          >
            <span className="text-muted-foreground dark:text-muted-foreground tabular-nums shrink-0 whitespace-nowrap">
              {new Date(e.created_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="font-semibold text-foreground dark:text-foreground shrink-0">
              {labelFor(e.action)}
            </span>
            <span className="text-foreground dark:text-muted-foreground min-w-0 break-words">
              {e.action === "status_change" && e.from_status && e.to_status && (
                <>
                  {e.from_status} → <b>{e.to_status}</b>
                </>
              )}
              {e.action !== "status_change" && e.note && (
                <span className="italic"> — {e.note}</span>
              )}
            </span>
            <span className="text-muted-foreground dark:text-muted-foreground shrink-0 sm:text-right">
              by {e.actor_name ?? "system"}
            </span>
          </div>
        ))}
      </div>
      {events.length > 5 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-brand hover:underline"
        >
          {expanded ? "Show less" : `Show all ${events.length} events`}
        </button>
      )}
    </div>
  );
}

async function freshApprovers(projectId: string) {
  const { data } = await supabase
    .from("budget_approvers")
    .select("id,project_id,organization_id,user_id,decision,decided_at,note")
    .eq("project_id", projectId);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    projectId: r.project_id,
    organizationId: r.organization_id,
    userId: r.user_id,
    displayName: null,
    decision: r.decision,
    decidedAt: r.decided_at,
    note: r.note,
  }));
}
