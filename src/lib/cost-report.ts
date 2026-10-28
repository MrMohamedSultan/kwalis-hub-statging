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

/**
 * Report categories of the client's Cost Report template (drive/SUMMARY.md):
 * ATL / BTL / Post / Music / VFX / Other (R09: Music 6000, VFX 6100 are their
 * own categories, not Post).
 */
export type CostCategory = "ATL" | "BTL" | "Post" | "Music" | "VFX" | "Other";
export const COST_CATEGORIES: CostCategory[] = ["ATL", "BTL", "Post", "Music", "VFX", "Other"];

/** Header accounts of the client chart of accounts (02_Chart-of-Accounts.csv) → category. */
export const CLIENT_COA_HEADERS: Readonly<Record<string, CostCategory>> = {
  "1100": "ATL",
  "1200": "ATL",
  "1300": "ATL",
  "1400": "ATL",
  "1600": "ATL",
  "2000": "BTL",
  "2100": "BTL",
  "2200": "BTL",
  "2300": "BTL",
  "2400": "BTL",
  "2500": "BTL",
  "2600": "BTL",
  "2700": "BTL",
  "2800": "BTL",
  "2900": "BTL",
  "3000": "BTL",
  "3100": "BTL",
  "3200": "BTL",
  "3300": "BTL",
  "3400": "BTL",
  "3500": "BTL",
  "3600": "BTL",
  "3700": "BTL",
  "3800": "BTL",
  "3900": "BTL",
  "4000": "BTL",
  "4100": "BTL",
  "4700": "BTL",
  "5000": "Post",
  "5100": "Post",
  "5200": "Post",
  "5300": "Post",
  "5400": "Post",
  "6000": "Music",
  "6100": "VFX",
  "7000": "Other",
  "7200": "Other",
  "7400": "Other",
  "7900": "Other",
  "8200": "Other",
};

/** Header account of a detail code ("6101" → "6100"); null when the code is not 4 digits. */
export function coaHeaderOf(code: string | null | undefined): string | null {
  const m = /^(\d{4})/.exec(String(code ?? "").trim());
  if (!m) return null;
  return `${m[1].slice(0, 2)}00`;
}

/** True when the code is a detail code under a header of the client chart of accounts. */
export function inClientCoa(code: string | null | undefined): boolean {
  const h = coaHeaderOf(code);
  return h != null && h in CLIENT_COA_HEADERS && String(code).trim() !== h;
}

/**
 * Category of a cost row: from its budget code when the code is in the client
 * chart of accounts (so 6001 is Music and 6101 VFX, R09), else from the Top
 * Sheet section get_cost_report returns.
 */
export function categoryOfCode(
  code: string | null | undefined,
  section: string | null | undefined,
): CostCategory {
  const h = coaHeaderOf(code);
  if (h && CLIENT_COA_HEADERS[h]) return CLIENT_COA_HEADERS[h];
  return categoryOf(section);
}

/** Top-sheet section of get_cost_report → report category. */
export function categoryOf(section: string | null | undefined): CostCategory {
  const s = String(section ?? "").toLowerCase();
  if (s === "atl" || s.startsWith("above")) return "ATL";
  if (s === "btl" || s === "production" || s.startsWith("below")) return "BTL";
  if (s.startsWith("post")) return "Post";
  if (s === "music") return "Music";
  if (s === "vfx" || s.startsWith("visual")) return "VFX";
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
      const c = categoryOfCode(r.budgetCode, r.group);
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

// ------------------------------------------------------------ R08 / R10 / template checks

/** Var% of the template: Variance / Budget, blank (null) when Budget = 0. */
export function variancePct(variance: number, budget: number): number | null {
  return Math.abs(budget) < 0.005 ? null : round2((variance / budget) * 100);
}

/** R10 colour by meaning: saving (green), overrun (red), zero / unallocated (grey). */
export type Tone = "saving" | "overrun" | "neutral";
export function varianceTone(v: number): Tone {
  if (v > 0.005) return "saving";
  if (v < -0.005) return "overrun";
  return "neutral";
}

export type CostFilter = {
  category?: CostCategory | "all";
  search?: string;
  /** Hide rows with no budget and no money at all. */
  hideEmpty?: boolean;
};

/** R08: the filters apply to the code rows before any grouping. */
export function filterCostRows(rows: CostReportRow[], f: CostFilter): CostReportRow[] {
  const q = (f.search ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.category && f.category !== "all" && categoryOfCode(r.budgetCode, r.group) !== f.category)
      return false;
    if (
      q &&
      ![r.budgetCode, r.description, r.glCode, r.glName, r.topsheetCode, r.topsheetName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
      return false;
    if (
      f.hideEmpty &&
      [r.budget, r.actual, r.commitment, r.paidToDate, r.etc].every((v) => Math.abs(v) < 0.005)
    )
      return false;
    return true;
  });
}

export type CostCheck = {
  key:
    | "gl_total"
    | "actual_mapped"
    | "unmapped_spend"
    | "codes_not_in_coa"
    | "budget_not_in_coa"
    | "etc_not_in_coa";
  value: number;
  /** "count" checks are numbers of codes, the others SAR. */
  unit: "money" | "count";
  /** null = information only (no pass / fail). */
  ok: boolean | null;
};

/**
 * The check rows of the client Cost Report template: spend that has no budget
 * code must be 0, and every code with spend / budget / ETC must be a detail
 * code of the chart of accounts.
 */
export function costReportChecks(rows: CostReportRow[]): CostCheck[] {
  const total = round2(rows.reduce((a, r) => a + r.actual, 0));
  const mapped = round2(rows.filter((r) => r.budgetCode).reduce((a, r) => a + r.actual, 0));
  const unmapped = round2(
    rows
      .filter((r) => !r.budgetCode)
      .reduce((a, r) => a + Math.abs(r.actual) + Math.abs(r.commitment), 0),
  );
  const notIn = (pred: (r: CostReportRow) => boolean) =>
    rows.filter((r) => r.budgetCode && !inClientCoa(r.budgetCode) && pred(r)).length;
  const spendNotIn = notIn((r) => Math.abs(r.actual) + Math.abs(r.commitment) >= 0.005);
  const budgetNotIn = notIn((r) => Math.abs(r.budget) >= 0.005);
  const etcNotIn = notIn((r) => r.etcIsManual);
  return [
    { key: "gl_total", value: total, unit: "money", ok: null },
    { key: "actual_mapped", value: mapped, unit: "money", ok: null },
    { key: "unmapped_spend", value: unmapped, unit: "money", ok: unmapped < 0.005 },
    { key: "codes_not_in_coa", value: spendNotIn, unit: "count", ok: spendNotIn === 0 },
    { key: "budget_not_in_coa", value: budgetNotIn, unit: "count", ok: budgetNotIn === 0 },
    { key: "etc_not_in_coa", value: etcNotIn, unit: "count", ok: etcNotIn === 0 },
  ];
}
