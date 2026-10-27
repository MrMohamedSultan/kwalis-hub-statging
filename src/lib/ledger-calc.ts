// =====================================================================
// Double-entry ledger helpers (pure, unit-tested in __tests__/ledger-calc.test.ts).
// The figures themselves come from the database (db/pending/182:
// get_trial_balance, get_general_ledger, get_daily_cash_position,
// get_bank_reconciliation); these helpers only total, split and check them.
// =====================================================================

export const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A signed balance (positive = debit) shown as a Debit / Credit pair. */
export function splitBalance(net: number): { debit: number; credit: number } {
  const n = round2(num(net));
  return n >= 0 ? { debit: n, credit: 0 } : { debit: 0, credit: -n };
}

/** Debits equal credits, to the cent. */
export function isBalanced(debit: number, credit: number): boolean {
  return Math.abs(round2(num(debit)) - round2(num(credit))) < 0.005;
}

export type TrialBalanceRow = {
  gl_account_id: string;
  gl_code: string | null;
  gl_name: string | null;
  account_type: string | null;
  category: string | null;
  opening: number;
  period_debit: number;
  period_credit: number;
  closing: number;
  phase: number;
};

export type TrialBalanceTotals = {
  opening: number;
  periodDebit: number;
  periodCredit: number;
  closing: number;
  /** Σ closing debit balances (positive closings). */
  closingDebit: number;
  /** Σ closing credit balances, as a positive number. */
  closingCredit: number;
  balanced: boolean;
};

/** Totals of a trial balance; balanced when period Dr = Cr and closing Dr = Cr. */
export function trialBalanceTotals(rows: TrialBalanceRow[]): TrialBalanceTotals {
  let opening = 0,
    periodDebit = 0,
    periodCredit = 0,
    closing = 0,
    closingDebit = 0,
    closingCredit = 0;
  for (const r of rows) {
    opening += num(r.opening);
    periodDebit += num(r.period_debit);
    periodCredit += num(r.period_credit);
    closing += num(r.closing);
    const s = splitBalance(num(r.closing));
    closingDebit += s.debit;
    closingCredit += s.credit;
  }
  return {
    opening: round2(opening),
    periodDebit: round2(periodDebit),
    periodCredit: round2(periodCredit),
    closing: round2(closing),
    closingDebit: round2(closingDebit),
    closingCredit: round2(closingCredit),
    balanced:
      isBalanced(periodDebit, periodCredit) &&
      isBalanced(closingDebit, closingCredit) &&
      Math.abs(round2(opening)) < 0.005,
  };
}

export type GeneralLedgerLine = {
  entry_ref: string | null;
  entry_seq: number;
  event_key: string;
  event_type: string;
  entry_date: string;
  line_no: number;
  gl_account_id: string;
  gl_code: string | null;
  gl_name: string | null;
  debit: number;
  credit: number;
  running_balance: number;
  party: string | null;
  budget_code: string | null;
  reference: string | null;
  description: string | null;
  department: string | null;
  status: string | null;
  qpe_eligible: boolean;
  is_reversal: boolean;
  phase: number;
};

/** Debit / credit totals of a set of ledger lines (never a mixed "amount" total). */
export function ledgerTotals(lines: Pick<GeneralLedgerLine, "debit" | "credit">[]): {
  debit: number;
  credit: number;
  balanced: boolean;
} {
  let debit = 0,
    credit = 0;
  for (const l of lines) {
    debit += num(l.debit);
    credit += num(l.credit);
  }
  return { debit: round2(debit), credit: round2(credit), balanced: isBalanced(debit, credit) };
}

/** Groups GL lines by account, keeping the server's order (code, date, entry, line). */
export function groupByAccount<T extends { gl_account_id: string }>(lines: T[]): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const l of lines) {
    const arr = out.get(l.gl_account_id);
    if (arr) arr.push(l);
    else out.set(l.gl_account_id, [l]);
  }
  return [...out.entries()];
}

export type CashPositionRow = {
  day: string;
  account_type: string;
  gl_code: string;
  gl_name: string;
  opening: number;
  cash_in: number;
  cash_out: number;
  closing: number;
};

/** True when every day's closing = opening + in − out and follows the previous day. */
export function cashPositionConsistent(rows: CashPositionRow[]): boolean {
  const last = new Map<string, number>();
  for (const r of rows) {
    if (
      Math.abs(
        round2(num(r.opening) + num(r.cash_in) - num(r.cash_out)) - round2(num(r.closing)),
      ) >= 0.005
    )
      return false;
    const prev = last.get(r.gl_code);
    if (prev !== undefined && Math.abs(prev - round2(num(r.opening))) >= 0.005) return false;
    last.set(r.gl_code, round2(num(r.closing)));
  }
  return true;
}

/** First / last ISO day of a "YYYY-MM" month; empty strings for an invalid month. */
export function monthRange(month: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m) return { from: "", to: "" };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return { from: "", to: "" };
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}` };
}

export type BankReconciliation = {
  as_of: string;
  book_balance: number;
  statement_balance: number;
  statement_from_balance_column: boolean;
  difference: number;
  unmatched_book: {
    event_key: string;
    entry_date: string;
    description: string | null;
    party: string | null;
    reference: string | null;
    amount: number;
  }[];
  unmatched_book_total: number;
  unmatched_statement: {
    id: string;
    value_date: string;
    reference: string | null;
    narrative: string | null;
    amount: number;
    balance: number | null;
  }[];
  unmatched_statement_total: number;
  unexplained: number;
};

/** Reconciliation status: OK, rounding (|d| < 1) or check. */
export function reconciliationStatus(unexplained: number): "ok" | "rounding" | "check" {
  const d = Math.abs(round2(num(unexplained)));
  if (d < 0.005) return "ok";
  if (d < 1) return "rounding";
  return "check";
}
