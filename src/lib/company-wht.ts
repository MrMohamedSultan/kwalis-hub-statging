// =====================================================================
// Decision 12 (owner, 28/10) — company-borne WHT is charged to budget
// line 7099. Pure helpers, mirror of public.payroll_company_wht_split
// (db/pending/201).
//
//   Exclusive (gross-up) contract: the contract's own budget line carries
//   the NET; the WHT on top (gross − net) is a cost of code 7099.
//   Inclusive contract: the WHT is the payee's tax, deducted inside the
//   contract line — the line carries the gross, nothing goes to 7099.
//
//   B04: 7,000 net @5% exclusive → gross 7,368.42 → line 7,000.00 + 7099 368.42.
// =====================================================================
import { round2, type WhtBreakdown, type WhtTreatment } from "@/lib/contract-terms";

export const WHT_BUDGET_CODE = "7099";

/** Company-borne WHT of a contract (gross − net on an Exclusive contract), else 0. */
export function companyBorneWht(
  treatment: WhtTreatment | string | null | undefined,
  gross: number,
  net: number | null | undefined,
): number {
  const g = Number(gross) || 0;
  const n = Number(net) || 0;
  if (treatment !== "exclusive" || n <= 0 || g <= n) return 0;
  return round2(g - n);
}

export interface CompanyWhtSplit {
  /** Actual carried by the contract's own budget line. */
  lineActual: number;
  /** Actual charged to 7099. */
  whtActual: number;
  /** Commitment carried by the contract's own line. */
  lineCommitment: number;
  /** Commitment charged to 7099. */
  whtCommitment: number;
}

/**
 * Split of a contract's Actual (gross basis) and the rest of it between its
 * line and 7099. line totals = net and 7099 totals = gross − net, to the cent.
 */
export function splitCompanyWht(
  actual: number,
  gross: number,
  net: number | null | undefined,
  treatment: WhtTreatment | string | null | undefined,
): CompanyWhtSplit {
  const a = round2(Number(actual) || 0);
  const g = Number(gross) || 0;
  const n = Number(net) || 0;
  const rest = round2(Math.max(g - a, 0));
  if (companyBorneWht(treatment, g, n) === 0) {
    return { lineActual: a, whtActual: 0, lineCommitment: rest, whtCommitment: 0 };
  }
  const lineActual = round2((a * n) / g);
  const lineCommitment = round2(Math.min(rest, Math.max(n - lineActual, 0)));
  return {
    lineActual,
    whtActual: round2(a - lineActual),
    lineCommitment,
    whtCommitment: round2(rest - lineCommitment),
  };
}

/** What a contract commits on its own budget line (decision 12): net if Exclusive, else gross. */
export function lineShareOfContract(b: WhtBreakdown, treatment: WhtTreatment): number {
  return treatment === "exclusive" && b.wht > 0 ? b.net : b.gross;
}
