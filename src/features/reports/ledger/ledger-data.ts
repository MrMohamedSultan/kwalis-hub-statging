// =====================================================================
// Double-entry ledger — data access (db/pending/182).
// Every call is scoped to the active project; the RPCs check access again
// (can_access_project) and RLS protects the underlying tables.
// The RPCs are not in the generated Supabase types yet, hence the casts.
// =====================================================================

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import type {
  BankReconciliation,
  CashPositionRow,
  GeneralLedgerLine,
  TrialBalanceRow,
} from "@/lib/ledger-calc";

type RpcResult<T> = { data: T | null; error: { message: string } | null };
const rpc = <T>(fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult<T>>)(
    fn,
    args,
  );
const table = (name: string) => (supabase.from as unknown as (n: string) => any)(name);

export function useActiveProject() {
  const { activeProjectId, projects } = useStore();
  const project = projects.find((p) => p.id === activeProjectId) ?? null;
  return {
    projectId: activeProjectId ?? null,
    organizationId: (project?.organizationId as string | undefined) ?? null,
    projectCode: project?.code ?? null,
    projectName: project?.name ?? "",
  };
}

/** Generic loader: re-runs when its key changes; `reload` refreshes in place. */
function useRpc<T>(key: string | null, load: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, loading, error, reload };
}

const orNull = (v: string | null | undefined) => (v ? v : null);

export function useTrialBalance(projectId: string | null, from: string, to: string) {
  return useRpc<TrialBalanceRow[]>(
    projectId ? `tb:${projectId}:${from}:${to}` : null,
    async () => {
      const { data, error } = await rpc<TrialBalanceRow[]>("get_trial_balance", {
        p_project_id: projectId,
        p_from: orNull(from),
        p_to: orNull(to),
      });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        ...r,
        opening: Number(r.opening),
        period_debit: Number(r.period_debit),
        period_credit: Number(r.period_credit),
        closing: Number(r.closing),
      }));
    },
    [],
  );
}

export function useGeneralLedger(
  projectId: string | null,
  from: string,
  to: string,
  accountId: string | null,
) {
  return useRpc<GeneralLedgerLine[]>(
    projectId ? `gl:${projectId}:${from}:${to}:${accountId ?? ""}` : null,
    async () => {
      const { data, error } = await rpc<GeneralLedgerLine[]>("get_general_ledger", {
        p_project_id: projectId,
        p_from: orNull(from),
        p_to: orNull(to),
        p_account: accountId,
      });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        ...r,
        debit: Number(r.debit),
        credit: Number(r.credit),
        running_balance: Number(r.running_balance),
      }));
    },
    [],
  );
}

export function useDailyCashPosition(projectId: string | null, from: string, to: string) {
  return useRpc<CashPositionRow[]>(
    projectId ? `cash:${projectId}:${from}:${to}` : null,
    async () => {
      const { data, error } = await rpc<CashPositionRow[]>("get_daily_cash_position", {
        p_project_id: projectId,
        p_from: orNull(from),
        p_to: orNull(to),
      });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        ...r,
        opening: Number(r.opening),
        cash_in: Number(r.cash_in),
        cash_out: Number(r.cash_out),
        closing: Number(r.closing),
      }));
    },
    [],
  );
}

export function useBankReconciliation(projectId: string | null, asOf: string) {
  return useRpc<BankReconciliation | null>(
    projectId ? `rec:${projectId}:${asOf}` : null,
    async () => {
      const { data, error } = await rpc<BankReconciliation>("get_bank_reconciliation", {
        p_project_id: projectId,
        p_as_of: orNull(asOf),
      });
      if (error) throw new Error(error.message);
      return data;
    },
    null,
  );
}

// ------------------------------------------------------------- writes

export type TreasuryKind = "wht_remittance" | "vat_recovery" | "petty_cash_return" | "bank_charge";
export const TREASURY_KINDS: TreasuryKind[] = [
  "wht_remittance",
  "vat_recovery",
  "petty_cash_return",
  "bank_charge",
];

export async function addTreasuryMovement(input: {
  projectId: string;
  organizationId: string;
  kind: TreasuryKind;
  date: string;
  amount: number;
  cashAdvanceId?: string | null;
  budgetCode?: string | null;
  reference?: string | null;
  notes?: string | null;
}) {
  const { error } = await table("treasury_movements").insert({
    project_id: input.projectId,
    organization_id: input.organizationId,
    kind: input.kind,
    movement_date: input.date,
    amount: input.amount,
    cash_advance_id: input.kind === "petty_cash_return" ? (input.cashAdvanceId ?? null) : null,
    budget_code: input.budgetCode?.trim() || null,
    reference: input.reference?.trim() || null,
    notes: input.notes?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function addStatementLine(input: {
  projectId: string;
  organizationId: string;
  date: string;
  amount: number;
  balance?: number | null;
  reference?: string | null;
  narrative?: string | null;
}) {
  const { error } = await table("bank_statement_lines").insert({
    project_id: input.projectId,
    organization_id: input.organizationId,
    value_date: input.date,
    amount: input.amount,
    balance: input.balance ?? null,
    reference: input.reference?.trim() || null,
    narrative: input.narrative?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function matchStatementLine(id: string, eventKey: string | null) {
  const { error } = await table("bank_statement_lines")
    .update({ matched_event_key: eventKey })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteStatementLine(id: string) {
  const { error } = await table("bank_statement_lines").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type FloatOption = { id: string; holder: string };
export async function loadFloats(projectId: string): Promise<FloatOption[]> {
  const { data, error } = await table("cash_advances")
    .select("id, holder")
    .eq("project_id", projectId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as FloatOption[];
}
