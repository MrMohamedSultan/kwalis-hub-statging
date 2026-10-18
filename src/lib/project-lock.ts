/**
 * Per-project "Lock" mode.
 * When a project is locked, payroll actions (Pay / Structure / Bulk Approve /
 * Bulk Mark Paid) and budget adjustments are disabled at the UI layer.
 * Stored in localStorage — a lightweight version-lock, not a security boundary.
 */
import { useEffect, useState, useCallback } from "react";
import { useStore } from "@/lib/store";
import { recordAudit } from "@/lib/audit-log";
import { supabase } from "@/integrations/supabase/client";

const KEY = "kwalis.project-locks.v1";

type LockMap = Record<string, { locked: boolean; at: string }>;

function read(): LockMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as LockMap;
  } catch {
    return {};
  }
}
function write(map: LockMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {}
  window.dispatchEvent(new CustomEvent("kwalis:project-lock-change"));
}

export function isProjectLocked(projectId: string | null | undefined): boolean {
  if (!projectId) return false;
  return read()[projectId]?.locked === true;
}

export function useProjectLock() {
  const pid = useStore((s) => s.activeProjectId);
  const [locked, setLocked] = useState<boolean>(() => isProjectLocked(pid));
  // The database is authoritative: `projects.budget_status = "Locked/Approved"`
  // is what `is_budget_editable()` enforces in RLS. The local flag can only
  // add a lock on top of it, never remove one.
  const [dbLocked, setDbLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!pid) {
      setDbLocked(false);
      return;
    }
    const refresh = async () => {
      const { data } = await supabase
        .from("projects")
        .select("budget_status" as any)
        .eq("id", pid)
        .maybeSingle();
      if (!cancelled) setDbLocked((data as any)?.budget_status === "Locked/Approved");
    };
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener("kwalis:budget-status-change", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("kwalis:budget-status-change", onChange);
    };
  }, [pid]);

  useEffect(() => {
    const sync = () => setLocked(isProjectLocked(pid));
    sync();
    window.addEventListener("kwalis:project-lock-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("kwalis:project-lock-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, [pid]);

  const toggle = useCallback(() => {
    if (!pid) return;
    const map = read();
    const next = !map[pid]?.locked;
    map[pid] = { locked: next, at: new Date().toISOString() };
    write(map);
    recordAudit({
      category: "other",
      action: next ? "project.locked" : "project.unlocked",
      severity: "info",
      summary: next
        ? "Project version locked — payroll and budget edits disabled"
        : "Project version unlocked",
      entity: "Project",
      project_id: pid,
      details: { projectId: pid, at: map[pid].at },
    });
  }, [pid]);

  return { locked: locked || dbLocked, localLocked: locked, dbLocked, toggle, projectId: pid };
}
