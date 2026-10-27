// =====================================================================
// Cost Report (R06 / R07) — one report, three groupings: by budget line
// (code), by GL account, by category (ATL / BTL / Post / Other).
//
// Rows come from public.get_cost_report_detail (db/pending/180), which is
// public.get_cost_report plus Remaining / Payable / % spent / GL account.
// Grouped totals are sums of the code rows, so every grouping shows the
// same Actual / Commitment / EFC totals (X07).
// =====================================================================
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { round2 } from "@/lib/ap-calc";

export type CostReportRow = {
  group: string | null;
  topsheetCode: string | null;
  topsheetName: string | null;
  budgetCode: string | null;
  description: string | null;
  glCode: string | null;
  glName: string | null;
  budget: number;
  actual: number;
  commitment: number;
  remaining: number;
  paidToDate: number;
  payable: number;
  etc: number;
  efc: number;
  variance: number;
  pctSpent: number | null;
  etcIsManual: boolean;
};

export type CostGrouping = "line" | "account" | "category";
export const COST_GROUPINGS: CostGrouping[] = ["line", "account", "category"];

/** Final-report categories (context: ATL / BTL / Post / Other). */
export type CostCategory = "ATL" | "BTL" | "Post" | "Other";
export const COST_CATEGORIES: CostCategory[] = ["ATL", "BTL", "Post", "Other"];

/** Top-sheet section of get_cost_report → report category. */
export function categoryOf(section: string | null | undefined): CostCategory {
  const s = String(section ?? "").toLowerCase();
  if (s === "atl" || s.startsWith("above")) return "ATL";
  if (s === "btl" || s === "production" || s.startsWith("below")) return "BTL";
  if (s.startsWith("post")) return "Post";
  return "Other";
}

export type CostGroupRow = {
  key: string;
  code: string | null;
  label: string;
  budget: number;
  actual: number;
  commitment: number;
  remaining: number;
  paidToDate: number;
  payable: number;
  etc: number;
  efc: number;
  variance: number;
  pctSpent: number | null;
  /** Line grouping only: the ETC of this code can be edited. */
  editable: boolean;
  etcIsManual: boolean;
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function fromRpcRow(r: any): CostReportRow {
  return {
    group: r.group ?? null,
    topsheetCode: r.topsheet_code ?? null,
    topsheetName: r.topsheet_name ?? null,
    budgetCode: r.budget_code ?? null,
    description: r.description ?? null,
    glCode: r.gl_code ?? null,
    glName: r.gl_name ?? null,
    budget: n(r.budget),
    actual: n(r.actual),
    commitment: n(r.commitment),
    remaining: n(r.remaining),
    paidToDate: n(r.paid_to_date),
    payable: n(r.payable),
    etc: n(r.etc),
    efc: n(r.efc),
    variance: n(r.variance),
    pctSpent: r.pct_spent == null ? null : n(r.pct_spent),
    etcIsManual: !!r.etc_is_manual,
  };
}

function emptyGroup(key: string, code: string | null, label: string): CostGroupRow {
  return {
    key,
    code,
    label,
    budget: 0,
    actual: 0,
    commitment: 0,
    remaining: 0,
    paidToDate: 0,
    payable: 0,
    etc: 0,
    efc: 0,
    variance: 0,
    pctSpent: null,
    editable: false,
    etcIsManual: false,
  };
}

const MONEY_KEYS = [
  "budget",
  "actual",
  "commitment",
  "remaining",
  "paidToDate",
  "payable",
  "etc",
  "efc",
  "variance",
] as const;

function finish(g: CostGroupRow): CostGroupRow {
  for (const k of MONEY_KEYS) g[k] = round2(g[k]);
  g.pctSpent = g.budget !== 0 ? round2((g.actual / g.budget) * 100) : null;
  return g;
}

/** Group the code rows. `labels.unassigned` names rows with no code / account. */
export function groupCostReport(
  rows: CostReportRow[],
  grouping: CostGrouping,
  labels: { unassigned: string; category?: (c: CostCategory) => string } = {
    unassigned: "—",
  },
): CostGroupRow[] {
  const map = new Map<string, CostGroupRow>();
  for (const r of rows) {
    let key: string;
    let code: string | null;
    let label: string;
    if (grouping === "line") {
      key = r.budgetCode ?? "__none__";
      code = r.budgetCode;
      label = r.description ?? labels.unassigned;
    } else if (grouping === "account") {
      key = r.glCode ?? "__none__";
      code = r.glCode;
      label = r.glName ?? labels.unassigned;
    } else {
      const c = categoryOf(r.group);
      key = c;
      code = c;
      label = labels.category ? labels.category(c) : c;
    }
    const g = map.get(key) ?? emptyGroup(key, code, label);
    for (const k of MONEY_KEYS) g[k] += r[k];
    if (grouping === "line") {
      g.editable = r.budgetCode != null;
      g.etcIsManual = r.etcIsManual;
    }
    map.set(key, g);
  }
  const out = Array.from(map.values()).map(finish);
  if (grouping === "category") {
    out.sort(
      (a, b) =>
        COST_CATEGORIES.indexOf(a.key as CostCategory) -
        COST_CATEGORIES.indexOf(b.key as CostCategory),
    );
  } else if (grouping === "account") {
    out.sort((a, b) => (a.code ?? "￿").localeCompare(b.code ?? "￿"));
  }
  return out;
}

export function costReportTotals(rows: CostGroupRow[]): CostGroupRow {
  const t = emptyGroup("__total__", null, "");
  for (const r of rows) for (const k of MONEY_KEYS) t[k] += r[k];
  return finish(t);
}

export const costReportKey = (projectId: string | null) => ["cost-report-detail", projectId];

export function useCostReportRows(projectId: string | null) {
  return useQuery({
    queryKey: costReportKey(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: async (): Promise<CostReportRow[]> => {
      const { data, error } = await (supabase.rpc as any)("get_cost_report_detail", {
        p_project_id: projectId,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map(fromRpcRow);
    },
  });
}

/** Save (or clear, with null) the accountant's ETC for one budget code. */
export function useSaveEtc(projectId: string | null, organizationId: string | null) {
  const qc = useQueryClient();
  return async (budgetCode: string, etc: number | null) => {
    if (!projectId || !organizationId) return;
    const table = (supabase.from as any)("cost_report_etc");
    const { error } =
      etc == null
        ? await table.delete().eq("project_id", projectId).eq("budget_code", budgetCode)
        : await table.upsert(
            {
              project_id: projectId,
              organization_id: organizationId,
              budget_code: budgetCode,
              etc_amount: round2(Math.max(0, etc)),
            },
            { onConflict: "project_id,budget_code" },
          );
    if (error) throw error;
    await Promise.all([
      qc.invalidateQueries({ queryKey: costReportKey(projectId) }),
      qc.invalidateQueries({ queryKey: ["perf-overview", "cost-report", projectId] }),
    ]);
  };
}

/** Legacy Final Report shape (reports.tsx useSummary), from the same rows. */
export function finalReportSummary(rows: CostReportRow[], groups: readonly string[]) {
  const byCat = groupCostReport(rows, "category");
  const get = (g: string) => byCat.find((r) => r.key === g);
  const out = groups.map((g) => {
    const r = get(g);
    return {
      group: g,
      actualPaid: r?.actual ?? 0, // glossary: Actual (column kept for the export code)
      commitments: r?.commitment ?? 0,
      budget: r?.budget ?? 0,
      efc: r?.efc ?? 0,
      variance: r?.variance ?? 0,
    };
  });
  const totals = out.reduce(
    (a, r) => ({
      actualPaid: a.actualPaid + r.actualPaid,
      commitments: a.commitments + r.commitments,
      budget: a.budget + r.budget,
      efc: a.efc + r.efc,
      variance: a.variance + r.variance,
    }),
    { actualPaid: 0, commitments: 0, budget: 0, efc: 0, variance: 0 },
  );
  return { rows: out, totals };
}
