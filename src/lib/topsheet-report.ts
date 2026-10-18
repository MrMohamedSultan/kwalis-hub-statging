// =====================================================================
// Top Sheet Cost Report — pure computation layer.
//
// Canonical doctrine (shared with dashboards, budget grid, GL report):
//   Budget    = budget_lines via lineTotalSAR (≡ v_budget_code_position.budget_sar)
//   Actual    = incurred costs — v_ledger_transactions entry_kind='actual'
//   Committed = issued commitments — v_ledger_transactions entry_kind='commitment'
//   Paid      = cash out — payments ledger resolved through source rows
//               (≡ v_paid_by_budget_code)
//   Variance  = Budget − Actual (incurred)
//
// Kept framework-free so it can be unit-tested and reused by exports.
// =====================================================================
import type { BudgetLine } from "@/lib/store";
import { lineTotalSAR } from "@/lib/store";
import { inRange, type DateRange } from "@/lib/date-range";
import {
  ledgerSourceLabel,
  type CanonicalLedgerEntry,
  type CanonicalPaidEntry,
} from "@/lib/canonical-ledger";

export type TopsheetAccount = {
  code: string;
  description: string;
  section: "ATL" | "Production" | "Post" | "Other" | "Adjustments";
  sort_order: number | null;
  default_pct?: number | null;
};

export type TopSheetRow = {
  code: string;
  description: string;
  section: TopsheetAccount["section"];
  budget: number;
  committed: number;
  actual: number;
  paid: number;
  variance: number;
  pctUsed: number; // 0..1 (or >1 if over)
  lineCount: number;
};

export type TopSheetSection = {
  key: TopsheetAccount["section"];
  label: string;
  rows: TopSheetRow[];
  subtotal: {
    budget: number;
    committed: number;
    actual: number;
    paid: number;
    variance: number;
  };
};

export const SECTION_LABEL: Record<TopsheetAccount["section"], string> = {
  ATL: "Above the Line",
  Production: "Production Expenses",
  Post: "Post Production Expenses",
  Other: "Other Expenses",
  Adjustments: "Adjustments",
};

export const REPORT_SECTIONS: TopsheetAccount["section"][] = ["ATL", "Production", "Post", "Other"];

/**
 * Build a resolver mapping a budget-line's own code -> topsheet account code.
 * Prefers explicit line.topsheetCode; otherwise matches by numeric prefix,
 * hundred-bucket, or nearest-lower numeric account.
 */
export function makeCodeResolver(
  accounts: TopsheetAccount[],
): (l: Pick<BudgetLine, "topsheetCode" | "mainCode" | "headerCode">) => string | null {
  return (l) => {
    if (l.topsheetCode && l.topsheetCode.trim()) return l.topsheetCode;
    const raw = String(l.mainCode || l.headerCode || "")
      .trim()
      .replace(/\.0+$/, "");
    if (!raw) return null;
    const direct = accounts.find((a) => a.code === raw);
    if (direct) return direct.code;
    // Manual decimal sub-coding (1201.1, 1201.2) rolls up to its base account.
    const base = raw.includes(".") ? raw.slice(0, raw.indexOf(".")) : raw;
    if (base !== raw) {
      const baseHit = accounts.find((a) => a.code === base);
      if (baseHit) return baseHit.code;
    }
    const num = parseInt(base, 10);

    if (!Number.isFinite(num)) return null;
    for (const a of accounts) {
      const m = a.code.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m && num >= +m[1] && num <= +m[2]) return a.code;
    }
    const hundred = String(Math.floor(num / 100) * 100);
    const h = accounts.find((a) => a.code === hundred);
    if (h) return h.code;
    let best: TopsheetAccount | null = null;
    for (const a of accounts) {
      const an = parseInt(a.code, 10);
      if (Number.isFinite(an) && an <= num && (!best || an > parseInt(best.code, 10))) best = a;
    }
    return best?.code ?? null;
  };
}

/**
 * Shared transaction-code resolver — maps a ledger/payment budget code to a
 * topsheet account, using the project's budget lines as the GL→topsheet
 * bridge. Used identically by the report builder AND both drilldown modals
 * so a cell and its drilldown can never disagree about membership.
 */
export function makeTxnResolver(
  accounts: TopsheetAccount[],
  budget: Pick<BudgetLine, "topsheetCode" | "mainCode" | "headerCode">[],
): (raw: string | null | undefined) => string | null {
  const resolve = makeCodeResolver(accounts);
  const codeIndex = new Map<string, TopsheetAccount>();
  for (const a of accounts) codeIndex.set(a.code, a);

  // Map budget-line GL code -> topsheet code. Both the sub-account
  // (mainCode) and its header are indexed so a transaction booked to either
  // level still resolves instead of being flagged unmapped.
  const glToTop = new Map<string, string>();
  for (const l of budget) {
    const code = resolve(l);
    if (!code) continue;
    if (l.mainCode) glToTop.set(String(l.mainCode).trim(), code);
    if (l.headerCode && !glToTop.has(String(l.headerCode).trim())) {
      glToTop.set(String(l.headerCode).trim(), code);
    }
  }

  return (rawIn: string | null | undefined): string | null => {
    const raw = String(rawIn ?? "").trim();
    if (!raw) return null;
    if (codeIndex.has(raw)) return raw;
    const mapped = glToTop.get(raw);
    if (mapped) return mapped;
    // Normalised forms: strip trailing ".0", pad/unpad decimal sub-codes.
    const normalized = raw.replace(/\.0+$/, "");
    if (codeIndex.has(normalized)) return normalized;
    const byNorm = glToTop.get(normalized);
    if (byNorm) return byNorm;
    // Fall back to the parent sub-account (e.g. "1001.3" -> "1001")
    const parent = normalized.includes(".") ? normalized.split(".")[0] : "";
    if (parent) {
      if (codeIndex.has(parent)) return parent;
      const byParent = glToTop.get(parent);
      if (byParent) return byParent;
    }
    // Try the same numeric heuristics used for budget lines
    return resolve({ topsheetCode: null, mainCode: normalized, headerCode: "" } as BudgetLine);
  };
}

export type ReportInputs = {
  accounts: TopsheetAccount[];
  budget: BudgetLine[];
  /** Canonical incurred/committed rows (v_ledger_transactions). */
  ledger: CanonicalLedgerEntry[];
  /** Canonical payment rows (payments ledger, code resolved via source). */
  paid: CanonicalPaidEntry[];
  /** Date filter — applied to ledger entry_date and payment date. Budget is unfiltered. */
  range?: DateRange;
  sections?: TopsheetAccount["section"][];
};

export type ReportOutput = {
  sections: TopSheetSection[];
  unassigned: TopSheetRow;
  grand: {
    budget: number;
    committed: number;
    actual: number;
    paid: number;
    variance: number;
  };
  validation: RollupValidation;
};

export type RollupValidation = {
  ok: boolean;
  issues: {
    kind:
      "unassigned_budget_line" | "unmapped_txn_code" | "over_budget" | "committed_exceeds_budget";
    message: string;
    ref?: string;
    amount?: number;
  }[];
  totals: {
    accountsBudgetSum: number;
    budgetLinesSum: number;
    diff: number;
  };
};

const UNASSIGNED = "__UNASSIGNED__";

export function buildTopSheetReport(inp: ReportInputs): ReportOutput {
  const { accounts, budget, ledger, paid, range, sections: filterSections } = inp;

  const resolve = makeCodeResolver(accounts);
  const resolveTxn = makeTxnResolver(accounts, budget);

  const zero = () => ({ budget: 0, committed: 0, actual: 0, paid: 0, lineCount: 0 });
  const bucket = new Map<string, ReturnType<typeof zero>>();
  const get = (code: string) => {
    let b = bucket.get(code);
    if (!b) {
      b = zero();
      bucket.set(code, b);
    }
    return b;
  };

  const issues: RollupValidation["issues"] = [];

  // --- Budget ---
  // Every budget line is converted to SAR via lineTotalSAR — the same
  // inputs the v_budget_code_position SQL view sums, so the report's Budget
  // column reconciles with the dashboard and the budget grid to the halala.
  let budgetLinesSum = 0;
  for (const l of budget) {
    if (l.excluded) continue;
    const total = lineTotalSAR(l);

    budgetLinesSum += total;
    const code = resolve(l);
    if (!code) {
      get(UNASSIGNED).budget += total;
      get(UNASSIGNED).lineCount += 1;
      issues.push({
        kind: "unassigned_budget_line",
        message: `Budget line "${l.description || l.mainCode || l.id}" is not mapped to a Top Sheet account.`,
        ref: l.mainCode || l.id,
        amount: total,
      });
    } else {
      const b = get(code);
      b.budget += total;
      b.lineCount += 1;
    }
  }

  // --- Committed & Actual: canonical ledger (v_ledger_transactions) ---
  for (const e of ledger) {
    if (range && !inRange(e.entryDate, range)) continue;
    // Cancelled commitments (e.g. voided POs) never consume budget.
    if (e.entryKind === "commitment" && e.status === "Cancelled") continue;
    const amt = e.amount;
    if (!amt) continue;
    const code = resolveTxn(e.budgetCode);
    const b = get(code ?? UNASSIGNED);
    if (e.entryKind === "actual") b.actual += amt;
    else b.committed += amt;
    if (!code && String(e.budgetCode ?? "").trim()) {
      issues.push({
        kind: "unmapped_txn_code",
        message: `${ledgerSourceLabel(e.sourceType)} ${e.reference ?? e.sourceId.slice(0, 6)} references budget code "${e.budgetCode}" which is not on the Top Sheet.`,
        ref: e.reference ?? e.sourceId,
        amount: amt,
      });
    }
  }

  // --- Paid: canonical payments ledger (≡ v_paid_by_budget_code) ---
  for (const p of paid) {
    if (range && !inRange(p.date, range)) continue;
    const amt = p.amount;
    if (!amt) continue;
    const code = resolveTxn(p.budgetCode);
    get(code ?? UNASSIGNED).paid += amt;
    if (!code && String(p.budgetCode ?? "").trim()) {
      issues.push({
        kind: "unmapped_txn_code",
        message: `Payment (${ledgerSourceLabel(p.sourceType)}) references budget code "${p.budgetCode}" which is not on the Top Sheet.`,
        ref: p.id,
        amount: amt,
      });
    }
  }

  // Compose section rows
  const wantedSections = filterSections && filterSections.length ? filterSections : REPORT_SECTIONS;
  const sortedAccounts = [...accounts].sort((a, b) => {
    const s = REPORT_SECTIONS.indexOf(a.section) - REPORT_SECTIONS.indexOf(b.section);
    if (s !== 0) return s;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code);
  });

  const sections: TopSheetSection[] = wantedSections.map((section) => {
    const rows: TopSheetRow[] = sortedAccounts
      .filter((a) => a.section === section)
      .map((a) => {
        const b = bucket.get(a.code) ?? zero();
        const variance = b.budget - b.actual;
        const pctUsed = b.budget > 0 ? b.actual / b.budget : 0;
        if (b.actual > b.budget && b.budget > 0) {
          issues.push({
            kind: "over_budget",
            message: `${a.code} · ${a.description} — actual spend exceeds budget.`,
            ref: a.code,
            amount: b.actual - b.budget,
          });
        } else if (b.committed > b.budget && b.budget > 0) {
          issues.push({
            kind: "committed_exceeds_budget",
            message: `${a.code} · ${a.description} — committed exceeds budget.`,
            ref: a.code,
            amount: b.committed - b.budget,
          });
        }
        return {
          code: a.code,
          description: a.description,
          section: a.section,
          budget: b.budget,
          committed: b.committed,
          actual: b.actual,
          paid: b.paid,
          variance,
          pctUsed,
          lineCount: b.lineCount,
        };
      });
    const subtotal = rows.reduce(
      (acc, r) => ({
        budget: acc.budget + r.budget,
        committed: acc.committed + r.committed,
        actual: acc.actual + r.actual,
        paid: acc.paid + r.paid,
        variance: acc.variance + r.variance,
      }),
      { budget: 0, committed: 0, actual: 0, paid: 0, variance: 0 },
    );
    return { key: section, label: SECTION_LABEL[section], rows, subtotal };
  });

  const un = bucket.get(UNASSIGNED) ?? zero();
  const unassigned: TopSheetRow = {
    code: "—",
    description: "Unassigned / Unmapped",
    section: "Other",
    budget: un.budget,
    committed: un.committed,
    actual: un.actual,
    paid: un.paid,
    variance: un.budget - un.actual,
    pctUsed: un.budget > 0 ? un.actual / un.budget : 0,
    lineCount: un.lineCount,
  };

  const grand = sections.reduce(
    (a, s) => ({
      budget: a.budget + s.subtotal.budget,
      committed: a.committed + s.subtotal.committed,
      actual: a.actual + s.subtotal.actual,
      paid: a.paid + s.subtotal.paid,
      variance: a.variance + s.subtotal.variance,
    }),
    { budget: 0, committed: 0, actual: 0, paid: 0, variance: 0 },
  );
  // Fold unassigned into grand totals so validation can compare vs raw sums.
  grand.budget += unassigned.budget;
  grand.committed += unassigned.committed;
  grand.actual += unassigned.actual;
  grand.paid += unassigned.paid;
  grand.variance += unassigned.variance;

  const accountsBudgetSum = grand.budget;
  const validation: RollupValidation = {
    ok: issues.length === 0 && Math.abs(accountsBudgetSum - budgetLinesSum) < 0.01,
    issues,
    totals: {
      accountsBudgetSum,
      budgetLinesSum,
      diff: accountsBudgetSum - budgetLinesSum,
    },
  };

  return { sections, unassigned, grand, validation };
}
