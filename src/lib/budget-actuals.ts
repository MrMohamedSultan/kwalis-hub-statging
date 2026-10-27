// Per-line money badges sourced from the DOCTRINE layer
// (v_budget_code_position) — never from the legacy budget_line_actuals
// view. Doctrine: budget is built by LINE, money is reported by account
// CODE. Every line carrying a code therefore displays that code's
// rollup; `sharedLines` tells the UI how many lines share the account.
//   actual    = glossary Actual: approved instalments, invoices, approved
//               petty cash (v_ledger_transactions, entry_kind='actual')
//   committed = glossary Commitment: contract / PO value − actual on it
//   paid      = cash out the door (canonical payments ledger)
// Subscribed to realtime channels on every table feeding the ledger.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { fetchCodePosition, type CodePositionRow } from "@/lib/dashboard/real-financials";

export type LineMoney = {
  actual: number;
  committed: number;
  paid: number;
  /** How many budget lines share this account code (1 = exclusive). */
  sharedLines: number;
};

export type ActualsMap = Record<string, LineMoney>;

/** Tables whose writes move the doctrine position views. */
const LEDGER_SOURCE_TABLES = [
  "invoices",
  "payroll",
  "purchase_orders",
  "cash_advance_receipts",
  "overtime_entries",
  "per_diem_ledger",
  "payments",
  "budget_lines",
  // 180: approving / un-approving an instalment moves Actual ↔ Commitment
  "payment_requests",
  "car_rentals",
  "accommodations",
] as const;

export function useBudgetLineActuals(): ActualsMap {
  const projectId = useStore((s) => s.activeProjectId);
  const [position, setPosition] = useState<CodePositionRow[]>([]);
  const [codeToLineIds, setCodeToLineIds] = useState<Record<string, string[]>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useMemo(
    () => async () => {
      if (!projectId) {
        setPosition([]);
        setCodeToLineIds({});
        return;
      }
      const [posRows, linesRes] = await Promise.all([
        fetchCodePosition(projectId),
        supabase
          .from("v_active_budget_lines" as any)
          .select("id,main_code")
          .eq("project_id", projectId)
          .not("main_code", "is", null),
      ]);
      setPosition(posRows);
      const map: Record<string, string[]> = {};
      for (const l of (linesRes.data ?? []) as any[]) {
        const code = String(l.main_code ?? "").trim();
        if (!code) continue;
        (map[code] ||= []).push(l.id);
      }
      setCodeToLineIds(map);
    },
    [projectId],
  );

  useEffect(() => {
    void load();
    if (!projectId) return;
    const queue = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(load, 300);
    };
    let ch = supabase.channel(`budget-actuals-${projectId}`);
    for (const table of LEDGER_SOURCE_TABLES) {
      ch = ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` },
        queue,
      );
    }
    ch.subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(ch);
    };
  }, [projectId, load]);

  return useMemo<ActualsMap>(() => {
    const byCode = new Map<string, CodePositionRow>();
    for (const row of position) {
      if (row.budget_code) byCode.set(row.budget_code, row);
    }
    const m: ActualsMap = {};
    for (const [code, ids] of Object.entries(codeToLineIds)) {
      const pos = byCode.get(code);
      if (!pos) continue;
      for (const id of ids) {
        m[id] = {
          actual: pos.actual_sar,
          committed: pos.committed_sar,
          paid: pos.paid_sar,
          sharedLines: ids.length,
        };
      }
    }
    return m;
  }, [position, codeToLineIds]);
}

/**
 * Cast/Crew split of payroll money for the budget page's Actual Paid
 * cards — doctrine definitions: incurred = payroll ledger actuals
 * (v_ledger_transactions, description carries the payroll kind),
 * paid = canonical payments ledger rows whose source is a payroll row.
 */
export type PayrollKindPosition = {
  cast: { actual: number; paid: number };
  crew: { actual: number; paid: number };
};

export function usePayrollKindPosition(): PayrollKindPosition {
  const projectId = useStore((s) => s.activeProjectId);
  const [value, setValue] = useState<PayrollKindPosition>({
    cast: { actual: 0, paid: 0 },
    crew: { actual: 0, paid: 0 },
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useMemo(
    () => async () => {
      if (!projectId) {
        setValue({ cast: { actual: 0, paid: 0 }, crew: { actual: 0, paid: 0 } });
        return;
      }
      const [ledgerRes, paymentsRes, payrollRes] = await Promise.all([
        (supabase.from as any)("v_ledger_transactions")
          .select("source_id, description, amount")
          .eq("project_id", projectId)
          .eq("source_type", "payroll")
          .eq("entry_kind", "actual"),
        supabase
          .from("payments")
          .select("source_id, amount")
          .eq("project_id", projectId)
          .eq("source_type", "payroll"),
        supabase.from("payroll").select("id, kind").eq("project_id", projectId),
      ]);
      const kindByPayrollId = new Map<string, string>();
      for (const p of (payrollRes.data ?? []) as any[]) {
        kindByPayrollId.set(p.id, String(p.kind ?? "").toLowerCase());
      }
      const next: PayrollKindPosition = {
        cast: { actual: 0, paid: 0 },
        crew: { actual: 0, paid: 0 },
      };
      for (const r of (ledgerRes.data ?? []) as any[]) {
        const kind = String(r.description ?? "").toLowerCase();
        const slot = kind === "cast" ? next.cast : next.crew;
        slot.actual += Number(r.amount) || 0;
      }
      for (const pay of (paymentsRes.data ?? []) as any[]) {
        const kind = kindByPayrollId.get(pay.source_id) ?? "crew";
        const slot = kind === "cast" ? next.cast : next.crew;
        slot.paid += Number(pay.amount) || 0;
      }
      setValue(next);
    },
    [projectId],
  );

  useEffect(() => {
    void load();
    if (!projectId) return;
    const queue = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(load, 300);
    };
    let ch = supabase.channel(`payroll-kind-position-${projectId}`);
    for (const table of ["payroll", "payments"] as const) {
      ch = ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` },
        queue,
      );
    }
    ch.subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(ch);
    };
  }, [projectId, load]);

  return value;
}

// Fetch linked-name lists per budget line (crew, cast, POs) for the active project.
export type LinkedNamesMap = Record<string, { crew: string[]; cast: string[]; pos: string[] }>;

export function useBudgetLineLinkedNames(): LinkedNamesMap {
  const projectId = useStore((s) => s.activeProjectId);
  const [map, setMap] = useState<LinkedNamesMap>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useMemo(
    () => async () => {
      if (!projectId) {
        setMap({});
        return;
      }
      const [crew, cast, pos] = await Promise.all([
        supabase
          .from("crew_members")
          .select("full_name, linked_budget_line_id")
          .eq("project_id", projectId)
          .not("linked_budget_line_id", "is", null),
        supabase
          .from("people")
          .select("full_name, linked_budget_line_id, kind")
          .eq("project_id", projectId)
          .not("linked_budget_line_id", "is", null),
        supabase
          .from("purchase_orders")
          .select("vendor_name, linked_budget_line_id")
          .eq("project_id", projectId)
          .not("linked_budget_line_id", "is", null),
      ]);
      const out: LinkedNamesMap = {};
      const bucket = (id: string) => (out[id] ||= { crew: [], cast: [], pos: [] });
      for (const r of crew.data ?? []) bucket(r.linked_budget_line_id!).crew.push(r.full_name);
      for (const r of (cast.data ?? []) as any[]) {
        if (r.kind === "cast") bucket(r.linked_budget_line_id).cast.push(r.full_name);
        else bucket(r.linked_budget_line_id).crew.push(r.full_name);
      }
      for (const r of pos.data ?? []) bucket(r.linked_budget_line_id!).pos.push(r.vendor_name);
      setMap(out);
    },
    [projectId],
  );

  useEffect(() => {
    void load();
    if (!projectId) return;
    const queue = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(load, 300);
    };
    const ch = supabase
      .channel(`budget-linked-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "crew_members",
          filter: `project_id=eq.${projectId}`,
        },
        queue,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "people", filter: `project_id=eq.${projectId}` },
        queue,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "purchase_orders",
          filter: `project_id=eq.${projectId}`,
        },
        queue,
      )
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(ch);
    };
  }, [projectId, load]);

  return map;
}

/**
 * Raw code-level doctrine position rows (v_budget_code_position) for the
 * Top Sheet cost report. Rows with line_count = 0 carry ledger money whose
 * account code has no matching budget line — callers must surface those
 * separately, never fold them into a line.
 */
export function useCodePositionRows(): CodePositionRow[] {
  const projectId = useStore((s) => s.activeProjectId);
  const [rows, setRows] = useState<CodePositionRow[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useMemo(
    () => async () => {
      if (!projectId) {
        setRows([]);
        return;
      }
      setRows(await fetchCodePosition(projectId));
    },
    [projectId],
  );

  useEffect(() => {
    void load();
    if (!projectId) return;
    const queue = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(load, 300);
    };
    let ch = supabase.channel(`code-position-${projectId}`);
    for (const table of LEDGER_SOURCE_TABLES) {
      ch = ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` },
        queue,
      );
    }
    ch.subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(ch);
    };
  }, [projectId, load]);

  return rows;
}
