// Payroll Hub — client-side data access for rate_cards, timesheets,
// payroll_runs, and contract_budget_splits. All queries run under RLS with
// the authenticated user context; server-side policy enforces project scope.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import type { Database } from "@/integrations/supabase/types";

export type Cadence = "day" | "weekly" | "monthly" | "milestone";
export type PayrollRunStatus = "draft" | "submitted" | "approved" | "posted" | "cancelled";
export type TimesheetStatus = "draft" | "submitted" | "approved" | "posted" | "rejected";

export type RateCard = Database["public"]["Tables"]["rate_cards"]["Row"];
export type Timesheet = Database["public"]["Tables"]["timesheets"]["Row"];
export type TimesheetEntry = Database["public"]["Tables"]["timesheet_entries"]["Row"];
export type PayrollRun = Database["public"]["Tables"]["payroll_runs"]["Row"];
export type PayrollRunItem = Database["public"]["Tables"]["payroll_run_items"]["Row"];
export type ContractSplit = Database["public"]["Tables"]["contract_budget_splits"]["Row"];

function useActiveScope() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const active = projects.find((p) => p.id === activeProjectId) ?? null;
  return {
    projectId: activeProjectId,
    organizationId: active?.organizationId ?? null,
  };
}

// ---------------- Rate cards ----------------

export function useRateCards() {
  const { projectId } = useActiveScope();
  const [rows, setRows] = useState<RateCard[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setRows([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("rate_cards")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (!error) setRows(data ?? []);
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, loading, refresh };
}

// ---------------- Timesheets ----------------

export function useTimesheets() {
  const { projectId } = useActiveScope();
  const [rows, setRows] = useState<Timesheet[]>([]);
  const [entriesBySheet, setEntriesBySheet] = useState<Record<string, TimesheetEntry[]>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setRows([]);
      setEntriesBySheet({});
      return;
    }
    setLoading(true);
    const { data: sheets } = await supabase
      .from("timesheets")
      .select("*")
      .eq("project_id", projectId)
      .order("period_start", { ascending: false });
    const ids = (sheets ?? []).map((s) => s.id);
    let entries: TimesheetEntry[] = [];
    if (ids.length > 0) {
      const { data } = await supabase.from("timesheet_entries").select("*").in("timesheet_id", ids);
      entries = data ?? [];
    }
    const grouped: Record<string, TimesheetEntry[]> = {};
    for (const e of entries) {
      (grouped[e.timesheet_id] ??= []).push(e);
    }
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => a.work_date.localeCompare(b.work_date));
    }
    setRows(sheets ?? []);
    setEntriesBySheet(grouped);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, entriesBySheet, loading, refresh };
}

export function computeTimesheetTotal(
  entries: TimesheetEntry[],
  baseRate: number,
  otRate: number,
  cadence: Cadence,
  periodDays: number,
): number {
  if (cadence === "day") {
    const daysWorked = entries.filter((e) => e.worked).length;
    const ot = entries.reduce((a, e) => a + Number(e.ot_hours || 0), 0);
    return daysWorked * baseRate + ot * otRate;
  }
  if (cadence === "weekly") {
    const weeks = Math.max(1, Math.ceil(periodDays / 7));
    return weeks * baseRate;
  }
  if (cadence === "monthly") {
    return baseRate;
  }
  // milestone — flat per timesheet
  return baseRate;
}

// ---------------- Payroll runs ----------------

export function usePayrollRuns() {
  const { projectId } = useActiveScope();
  const [rows, setRows] = useState<PayrollRun[]>([]);
  const [itemsByRun, setItemsByRun] = useState<Record<string, PayrollRunItem[]>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setRows([]);
      setItemsByRun({});
      return;
    }
    setLoading(true);
    const { data: runs } = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("project_id", projectId)
      .order("period_start", { ascending: false });
    const ids = (runs ?? []).map((r) => r.id);
    let items: PayrollRunItem[] = [];
    if (ids.length > 0) {
      const { data } = await supabase
        .from("payroll_run_items")
        .select("*")
        .in("payroll_run_id", ids);
      items = data ?? [];
    }
    const grouped: Record<string, PayrollRunItem[]> = {};
    for (const it of items) (grouped[it.payroll_run_id] ??= []).push(it);
    setRows(runs ?? []);
    setItemsByRun(grouped);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, itemsByRun, loading, refresh };
}

// ---------------- Contract budget splits ----------------

export function useContractSplits(params: {
  personId?: string | null;
  crewMemberId?: string | null;
}) {
  const { personId, crewMemberId } = params;
  const { projectId } = useActiveScope();
  const [rows, setRows] = useState<ContractSplit[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId || (!personId && !crewMemberId)) {
      setRows([]);
      return;
    }
    setLoading(true);
    let q = supabase.from("contract_budget_splits").select("*").eq("project_id", projectId);
    if (personId) q = q.eq("person_id", personId);
    if (crewMemberId) q = q.eq("crew_member_id", crewMemberId);
    const { data } = await q.order("created_at", { ascending: true });
    setRows(data ?? []);
    setLoading(false);
  }, [projectId, personId, crewMemberId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, loading, refresh, setRows };
}

// ---------------- Helpers ----------------

export function useScope() {
  return useActiveScope();
}

export function formatMoney(n: number, ccy = "USD") {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: ccy,
      maximumFractionDigits: 2,
    }).format(n || 0);
  } catch {
    return `${(n || 0).toFixed(2)} ${ccy}`;
  }
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from);
  const end = new Date(to);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return out;
  const d = new Date(start);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export const CADENCE_LABEL: Record<Cadence, string> = {
  day: "Day rate",
  weekly: "Weekly salary",
  monthly: "Monthly + allowances",
  milestone: "Milestone / flat fee",
};

export const RUN_STATUS_TONE: Record<PayrollRunStatus, string> = {
  draft: "bg-muted/20 text-foreground border-border",
  submitted: "bg-warning/15 text-warning border-warning/40",
  approved: "bg-info/15 text-info border-info/40",
  posted: "bg-success/15 text-success border-success/40",
  cancelled: "bg-destructive/15 text-destructive border-destructive/40",
};
