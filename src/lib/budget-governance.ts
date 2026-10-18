import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { useAuthRoles } from "@/lib/auth-roles";

export type BudgetStatus = "Draft" | "Pending Approval" | "Locked/Approved" | "Revision Requested";
export type ExecutiveTitle = "CEO" | "CFO" | "Executive Producer" | "Board Member";

export const EXECUTIVE_TITLES: ExecutiveTitle[] = [
  "CEO",
  "CFO",
  "Executive Producer",
  "Board Member",
];

export type BudgetApprover = {
  id: string;
  projectId: string;
  organizationId: string | null;
  userId: string;
  displayName: string | null;
  decision: "pending" | "approved" | "rejected";
  decidedAt: string | null;
  note: string | null;
};

// -------------------- Executive title lookup --------------------

/**
 * Executive title of the current user in the ACTIVE project.
 * Returns `null` when the user has no executive title (regular member/admin).
 * Executives get a strict read-only view of Dashboard, Budget, Reports only.
 */
export function useExecutiveTitle(enabled = true): {
  loaded: boolean;
  title: ExecutiveTitle | null;
} {
  const roles = useAuthRoles();
  const activeProjectId = useStore((s) => (enabled ? s.activeProjectId : null));
  const [state, setState] = useState<{ loaded: boolean; title: ExecutiveTitle | null }>({
    loaded: false,
    title: null,
  });
  useEffect(() => {
    let cancel = false;
    if (!enabled) {
      setState({ loaded: true, title: null });
      return;
    }
    if (!roles.loaded) return;
    if (!roles.userId) {
      setState({ loaded: true, title: null });
      return;
    }
    // Super admins bypass executive lockdown.
    if (roles.isSuperAdmin) {
      setState({ loaded: true, title: null });
      return;
    }
    (async () => {
      // 1) Project-level override (per-project title) if a project is active.
      let title: ExecutiveTitle | null = null;
      if (activeProjectId) {
        const { data } = await supabase
          .from("project_members")
          .select("executive_title" as any)
          .eq("project_id", activeProjectId)
          .eq("user_id", roles.userId!)
          .maybeSingle();
        title = ((data as any)?.executive_title ?? null) as ExecutiveTitle | null;
      }
      // 2) Fallback to the global profile title (persists across all projects).
      if (!title && roles.executiveTitle) {
        title = roles.executiveTitle as ExecutiveTitle;
      }
      if (cancel) return;
      setState({ loaded: true, title });
    })();
    return () => {
      cancel = true;
    };
  }, [
    enabled,
    roles.loaded,
    roles.userId,
    roles.isSuperAdmin,
    roles.executiveTitle,
    activeProjectId,
  ]);
  return state;
}

// -------------------- Budget status --------------------

export function useBudgetStatus(projectId: string | null): {
  status: BudgetStatus;
  lockedAt: string | null;
  lockedBy: string | null;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<BudgetStatus>("Draft");
  const [lockedAt, setLockedAt] = useState<string | null>(null);
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!projectId) return;
    const { data } = await supabase
      .from("projects")
      .select("budget_status,budget_locked_at,budget_locked_by" as any)
      .eq("id", projectId)
      .maybeSingle();
    const row = data as any;
    if (row) {
      setStatus((row.budget_status ?? "Draft") as BudgetStatus);
      setLockedAt(row.budget_locked_at ?? null);
      setLockedBy(row.budget_locked_by ?? null);
    }
  }, [projectId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, lockedAt, lockedBy, refresh };
}

export async function setBudgetStatus(
  projectId: string,
  status: BudgetStatus,
  actorId: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { budget_status: status };
  if (status === "Locked/Approved") {
    patch.budget_locked_at = new Date().toISOString();
    patch.budget_locked_by = actorId;
  } else {
    patch.budget_locked_at = null;
    patch.budget_locked_by = null;
  }
  const { error } = await supabase
    .from("projects")
    .update(patch as any)
    .eq("id", projectId);
  if (error) throw error;
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("kwalis:budget-status-change", { detail: { projectId } }));
}

// -------------------- Budget approvers --------------------

export function useBudgetApprovers(projectId: string | null): {
  approvers: BudgetApprover[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [approvers, setApprovers] = useState<BudgetApprover[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setApprovers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase
        .from("budget_approvers")
        .select("id,project_id,organization_id,user_id,decision,decided_at,note")
        .eq("project_id", projectId);
      const rows = (data ?? []) as any[];
      const ids = Array.from(new Set(rows.map((r) => r.user_id)));
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id,display_name").in("id", ids)
        : { data: [] as { id: string; display_name: string | null }[] };
      const nameMap = new Map(
        (profs ?? []).map((p: any) => [p.id as string, p.display_name as string | null]),
      );
      setApprovers(
        rows.map((r) => ({
          id: r.id,
          projectId: r.project_id,
          organizationId: r.organization_id,
          userId: r.user_id,
          displayName: nameMap.get(r.user_id) ?? null,
          decision: r.decision,
          decidedAt: r.decided_at,
          note: r.note,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { approvers, loading, refresh };
}

export async function addBudgetApprover(
  projectId: string,
  organizationId: string | null,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("budget_approvers")
    .insert({ project_id: projectId, organization_id: organizationId, user_id: userId });
  if (error) throw error;
}

export async function removeBudgetApprover(id: string): Promise<void> {
  const { error } = await supabase.from("budget_approvers").delete().eq("id", id);
  if (error) throw error;
}

export async function recordApproverDecision(
  id: string,
  decision: "approved" | "rejected",
  note: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("budget_approvers")
    .update({ decision, decided_at: new Date().toISOString(), note })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Resolve the aggregate budget status from the approver decisions:
 * - any 'rejected' → Revision Requested
 * - all 'approved' AND at least one approver → Locked/Approved
 * - otherwise → Pending Approval (if approvers exist) or Draft
 */
export function resolveStatusFromApprovers(
  approvers: BudgetApprover[],
  current: BudgetStatus,
): BudgetStatus {
  if (!approvers.length) return current === "Locked/Approved" ? current : "Draft";
  if (approvers.some((a) => a.decision === "rejected")) return "Revision Requested";
  if (approvers.every((a) => a.decision === "approved")) return "Locked/Approved";
  return "Pending Approval";
}
