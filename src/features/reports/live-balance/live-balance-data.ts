// Data for Live Balance (N02). Crew / cast contracts of the active project,
// their payments and the shooting schedule. RLS scopes every read.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { fetchShootDays, isActiveShootDay } from "@/lib/shoot-schedule";
import {
  ACCRUAL_METHODS,
  isAccrualMethod,
  suggestAccrualMethod,
  type AccrualMethod,
} from "./live-balance";

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const from = (t: string) => (supabase.from as any)(t);

export interface LiveBalanceSource {
  id: string;
  personId: string | null;
  ref: string;
  party: string;
  kind: string;
  budgetCode: string | null;
  gross: number;
  net: number | null;
  method: AccrualMethod;
  methodSuggested: boolean;
  start: string | null;
  end: string | null;
  cancelledAt: string | null;
  shootingDays: number | null;
  payments: { date: string; amount: number }[];
}

export interface LiveBalanceData {
  contracts: LiveBalanceSource[];
  /** Active shoot dates of the schedule (db/pending/197); null when unavailable. */
  shootDates: string[] | null;
  projectShootDays: number | null;
}

/**
 * Shoot dates for the "shoot days" method: the shooting schedule
 * (public.project_shoot_days, db/pending/197) when present; null when the
 * table is not there or holds no day for the project — the calculation
 * then falls back to the contract's / project's shoot-day count.
 */
export async function fetchShootDates(projectId: string): Promise<string[] | null> {
  try {
    const days = await fetchShootDays(projectId);
    const dates = days.filter(isActiveShootDay).map((d) => d.shoot_date.slice(0, 10));
    return dates.length ? dates : null;
  } catch {
    return null;
  }
}

export const liveBalanceKey = (projectId: string | null) => ["taxlive-live-balance", projectId];

export function useLiveBalanceData(projectId: string | null) {
  return useQuery({
    queryKey: liveBalanceKey(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: async (): Promise<LiveBalanceData> => {
      const pid = projectId!;
      const [payroll, people, payments, project, shootDates] = await Promise.all([
        from("payroll").select("*").eq("project_id", pid).in("kind", ["crew", "cast"]),
        from("people").select("*").eq("project_id", pid),
        from("payments")
          .select("source_id, amount, payment_date")
          .eq("project_id", pid)
          .eq("source_type", "payroll"),
        from("projects").select("shoot_days").eq("id", pid).maybeSingle(),
        fetchShootDates(pid),
      ]);
      for (const r of [payroll, people, payments]) if (r.error) throw r.error;
      const personById = new Map<string, any>(((people.data ?? []) as any[]).map((p) => [p.id, p]));
      const paysBy = new Map<string, { date: string; amount: number }[]>();
      for (const p of (payments.data ?? []) as any[]) {
        const list = paysBy.get(p.source_id) ?? [];
        list.push({ date: String(p.payment_date ?? "").slice(0, 10), amount: n(p.amount) });
        paysBy.set(p.source_id, list);
      }
      const contracts: LiveBalanceSource[] = ((payroll.data ?? []) as any[]).map((r) => {
        const pe = personById.get(r.ref_id) ?? null;
        const stored = pe?.accrual_method;
        return {
          id: r.id,
          personId: pe?.id ?? null,
          ref: r.ref_no ?? pe?.ref_no ?? r.id.slice(0, 8),
          party: r.name,
          kind: r.kind,
          budgetCode: r.budget_code ?? null,
          gross: n(r.total_amount),
          net: r.net_payable == null ? null : n(r.net_payable),
          method: isAccrualMethod(stored) ? stored : suggestAccrualMethod(pe?.deal_type),
          methodSuggested: !isAccrualMethod(stored),
          start: pe?.start_date ?? null,
          end: pe?.end_date ?? null,
          cancelledAt: r.contract_cancelled_at ?? null,
          shootingDays: pe?.shooting_days != null ? n(pe.shooting_days) : null,
          payments: paysBy.get(r.id) ?? [],
        };
      });
      return {
        contracts,
        shootDates,
        projectShootDays: project.data?.shoot_days != null ? n(project.data.shoot_days) : null,
      };
    },
  });
}

const methodSchema = z.enum(ACCRUAL_METHODS).nullable();

/** Decision 16: the accrual method is editable per contract (null = back to the suggestion). */
export function useSaveAccrualMethod(projectId: string | null) {
  const qc = useQueryClient();
  return async (personId: string, method: AccrualMethod | null) => {
    const v = methodSchema.parse(method);
    const { error } = await from("people")
      .update({ accrual_method: v })
      .eq("id", z.string().uuid().parse(personId))
      .eq("project_id", z.string().uuid().parse(projectId));
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: liveBalanceKey(projectId) });
  };
}
