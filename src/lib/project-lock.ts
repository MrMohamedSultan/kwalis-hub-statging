/**
 * Per-project "Lock" (X15).
 *
 * The lock lives in the database: projects.locked_at, set through the
 * set_project_lock() RPC (db/pending/184). While a project is locked or
 * archived the database refuses new or changed invoices, contracts, POs,
 * petty cash, per diem, overtime, payments, funding and payment requests
 * unless the user holds the "Project Lock Override" permission. The UI lock
 * below only mirrors that rule so screens are read-only up front.
 *
 * `dbLocked` is the approved-budget lock (`budget_status = Locked/Approved`,
 * enforced by is_budget_editable() in RLS) — unchanged.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import i18n from "@/lib/i18n";

export const PROJECT_LOCK_EVENT = "kwalis:project-lock-change";

type LockRow = {
  budget_status?: string | null;
  status?: string | null;
  locked_at?: string | null;
  lock_reason?: string | null;
};

export interface ProjectLockState {
  /** Project locked (or archived) in the database. */
  projectLocked: boolean;
  archived: boolean;
  lockedAt: string | null;
  reason: string | null;
  /** Approved-budget lock. */
  budgetLocked: boolean;
}

export function lockStateFromRow(row: LockRow | null): ProjectLockState {
  const archived = row?.status === "Archived";
  return {
    projectLocked: !!row?.locked_at || archived,
    archived,
    lockedAt: row?.locked_at ?? null,
    reason: row?.lock_reason ?? null,
    budgetLocked: row?.budget_status === "Locked/Approved",
  };
}

export function useProjectLock() {
  const pid = useStore((s) => s.activeProjectId);
  const [state, setState] = useState<ProjectLockState>(() => lockStateFromRow(null));
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!pid) {
      setState(lockStateFromRow(null));
      return;
    }
    // locked_at / lock_reason come from db/pending/184; before it is applied
    // the select fails and only the budget lock is known.
    const full = await supabase
      .from("projects")
      .select("budget_status, status, locked_at, lock_reason" as never)
      .eq("id", pid)
      .maybeSingle();
    if (!full.error) {
      setState(lockStateFromRow(full.data as LockRow | null));
      return;
    }
    const { data } = await supabase
      .from("projects")
      .select("budget_status, status" as never)
      .eq("id", pid)
      .maybeSingle();
    setState(lockStateFromRow(data as LockRow | null));
  }, [pid]);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) void refresh();
    };
    run();
    window.addEventListener("kwalis:budget-status-change", run);
    window.addEventListener(PROJECT_LOCK_EVENT, run);
    return () => {
      cancelled = true;
      window.removeEventListener("kwalis:budget-status-change", run);
      window.removeEventListener(PROJECT_LOCK_EVENT, run);
    };
  }, [refresh]);

  const setLocked = useCallback(
    async (next: boolean, reason?: string) => {
      if (!pid || busy) return;
      setBusy(true);
      const { error } = await supabase.rpc(
        "set_project_lock" as never,
        { p_project_id: pid, p_locked: next, p_reason: reason ?? null } as never,
      );
      setBusy(false);
      if (error) {
        toast.error(i18n.t("refs.lock_failed"));
        return;
      }
      toast.success(i18n.t(next ? "refs.lock_done" : "refs.unlock_done"));
      window.dispatchEvent(new CustomEvent(PROJECT_LOCK_EVENT));
    },
    [pid, busy],
  );

  const toggle = useCallback(() => {
    void setLocked(!(state.projectLocked && !state.archived));
  }, [setLocked, state.projectLocked, state.archived]);

  return {
    locked: state.projectLocked || state.budgetLocked,
    /** The project lock itself (kept under its old name for callers). */
    localLocked: state.projectLocked,
    projectLocked: state.projectLocked,
    archived: state.archived,
    lockReason: state.reason,
    dbLocked: state.budgetLocked,
    busy,
    toggle,
    setLocked,
    projectId: pid,
  };
}
