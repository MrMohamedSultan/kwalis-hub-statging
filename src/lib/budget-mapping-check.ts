// =====================================================================
// Budget code (Header Account / Sub-Account) mapping validation.
//
// Accounting rule: money may only post to a *sub-account*. A contract or
// payroll line mapped to nothing, to a header account, or to a code that
// does not exist in the Master COA will silently fall out of the Top Sheet
// rollups — so we surface it before saving or posting instead of after.
//
// IMPORTANT (many-to-one mapping): budget codes are NOT unique. Film budgets
// routinely repeat the same code across several rows (three drivers on 1201,
// two producers on 1101…). The authoritative mapping key is therefore the
// budget_lines row UUID, not the 4-digit string. When an exact row is picked,
// duplicate codes are legitimate and must never block a save.
// =====================================================================
import { supabase } from "@/integrations/supabase/client";

export type MappingSeverity = "error" | "warning";

export type MappingIssue = {
  /** Row/beneficiary the issue belongs to (blank for single-record checks). */
  subject?: string;
  code: string | null;
  severity: MappingSeverity;
  message: string;
};

export type MasterCodeInfo = {
  budget_code: string;
  description: string | null;
  is_header: boolean;
  /** How many Master COA rows carry this exact code (duplicates are allowed). */
  duplicates?: number;
};

/** Trim + collapse a budget code. Decimal sub-codes ("1201.2") are preserved. */
export function normalizeBudgetCode(code: string | null | undefined): string {
  return (code ?? "").trim();
}

/**
 * Base account for a decimal sub-code: "1201.2" -> "1201".
 * Manual decimal sub-coding is a supported way to split one account across
 * several people, so validation and rollups must resolve to the base code.
 */
export function baseBudgetCode(code: string | null | undefined): string {
  const c = normalizeBudgetCode(code);
  const dot = c.indexOf(".");
  return dot > 0 ? c.slice(0, dot) : c;
}

export const isDecimalSubCode = (code: string | null | undefined) =>
  /^\d+\.\d+$/.test(normalizeBudgetCode(code));

/**
 * Look the given codes up in the Master COA. Unknown codes are simply absent.
 * Duplicate rows for one code are collapsed: a code counts as a *header* only
 * when every row carrying it is a header, otherwise the postable sub-account
 * row wins. Decimal sub-codes fall back to their base account.
 */
export async function fetchMasterCodes(
  codes: (string | null | undefined)[],
): Promise<Map<string, MasterCodeInfo>> {
  const wanted = Array.from(new Set(codes.map(normalizeBudgetCode).filter((c) => c.length > 0)));
  const map = new Map<string, MasterCodeInfo>();
  if (wanted.length === 0) return map;

  // Query both the literal codes and the base codes behind decimal sub-codes.
  const lookups = Array.from(new Set(wanted.flatMap((c) => [c, baseBudgetCode(c)])));
  const { data } = await supabase
    .from("master_budget")
    .select("budget_code, description, is_header")
    .in("budget_code", lookups);

  const grouped = new Map<string, MasterCodeInfo[]>();
  for (const row of (data ?? []) as MasterCodeInfo[]) {
    const key = normalizeBudgetCode(row.budget_code);
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  const collapse = (rows: MasterCodeInfo[]): MasterCodeInfo => {
    const postable = rows.find((r) => !r.is_header);
    const chosen = postable ?? rows[0];
    return { ...chosen, is_header: !postable, duplicates: rows.length };
  };

  for (const code of wanted) {
    const exact = grouped.get(code);
    if (exact?.length) {
      map.set(code, collapse(exact));
      continue;
    }
    // Decimal sub-code: inherit from its base account and treat it as postable.
    const base = baseBudgetCode(code);
    const parent = base !== code ? grouped.get(base) : undefined;
    if (parent?.length) {
      const info = collapse(parent);
      map.set(code, {
        budget_code: code,
        description: info.description,
        is_header: false,
        duplicates: parent.length,
      });
    }
  }
  return map;
}

/**
 * Validate one mapping. `matchingProjectLines` is how many project budget
 * lines carry this code — more than one *without* an exact row selected is
 * ambiguous. With an exact `budget_lines.id` selected, duplicates are fine.
 */
export function evaluateMapping(opts: {
  subject?: string;
  code: string | null | undefined;
  headerCode?: string | null;
  master?: MasterCodeInfo | null;
  matchingProjectLines?: number;
  explicitLineSelected?: boolean;
  /** The exact budget_lines row UUID the cost posts to (authoritative key). */
  lineId?: string | null;
  /**
   * True when the code exists as a line in the *project* budget. A project
   * budget line is an authoritative mapping target, so a missing Master COA
   * row must not be reported as an unknown code (false negative).
   */
  projectLineExists?: boolean;
}): MappingIssue[] {
  const { subject, headerCode, master } = opts;
  const code = normalizeBudgetCode(opts.code);
  const issues: MappingIssue[] = [];
  const inProjectBudget = !!opts.projectLineExists || (opts.matchingProjectLines ?? 0) > 0;
  // An exact budget_lines row is the authoritative mapping target.
  const exactRow = !!opts.lineId || !!opts.explicitLineSelected;

  if (!code) {
    issues.push({
      subject,
      code: null,
      severity: "error",
      message: headerCode
        ? "A Header Account is selected but no Sub-Account — costs cannot post to a header."
        : "No Header Account / Sub-Account (Budget Code) mapped.",
    });
    return issues;
  }

  // Header checks only apply when no exact budget row was picked. When the
  // user selected a specific project budget line, a repeated code is a
  // legitimate many-to-one mapping, not a header account.
  if (!exactRow) {
    if (headerCode && code === headerCode) {
      issues.push({
        subject,
        code,
        severity: "error",
        message: `${code} is a Header Account. Pick a Sub-Account underneath it.`,
      });
    } else if (master?.is_header) {
      issues.push({
        subject,
        code,
        severity: "error",
        message: `${code} is a Header Account in the Master COA. Pick a Sub-Account.`,
      });
    }
  } else if (master?.is_header && !inProjectBudget) {
    issues.push({
      subject,
      code,
      severity: "warning",
      message: `${code} is flagged as a Header Account in the Master COA — confirm this line should carry costs.`,
    });
  }

  if ((master === null || master === undefined) && !inProjectBudget) {
    issues.push({
      subject,
      code,
      severity: "warning",
      message: `${code} was not found in the Master Budget — actuals booked to it will not roll up until the code is added.`,
    });
  }

  if (!exactRow && (opts.matchingProjectLines ?? 0) > 1) {
    issues.push({
      subject,
      code,
      severity: "warning",
      message: `${code} matches ${opts.matchingProjectLines} project budget lines — pick the exact line so the cost posts to the right row.`,
    });
  }

  return issues;
}

export const hasBlockingIssue = (issues: MappingIssue[]) =>
  issues.some((i) => i.severity === "error");

/** Batch check for payroll runs / bulk lines. */
export async function checkBudgetCodes(
  rows: { subject: string; code: string | null | undefined; lineId?: string | null }[],
): Promise<MappingIssue[]> {
  const master = await fetchMasterCodes(rows.map((r) => r.code));
  return rows.flatMap((r) =>
    evaluateMapping({
      subject: r.subject,
      code: r.code,
      master: master.get(normalizeBudgetCode(r.code)) ?? null,
      lineId: r.lineId ?? null,
      explicitLineSelected: true,
    }),
  );
}
