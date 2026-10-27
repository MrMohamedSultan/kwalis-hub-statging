import { describe, expect, it } from "vitest";
import {
  cashPositionConsistent,
  groupByAccount,
  isBalanced,
  ledgerTotals,
  monthRange,
  reconciliationStatus,
  splitBalance,
  trialBalanceTotals,
  type TrialBalanceRow,
} from "../ledger-calc";

const tb = (code: string, opening: number, dr: number, cr: number): TrialBalanceRow => ({
  gl_account_id: code,
  gl_code: code,
  gl_name: code,
  account_type: null,
  category: null,
  opening,
  period_debit: dr,
  period_credit: cr,
  closing: opening + dr - cr,
  phase: 1,
});

describe("ledger-calc", () => {
  it("splits a signed balance into debit / credit", () => {
    expect(splitBalance(150.256)).toEqual({ debit: 150.26, credit: 0 });
    expect(splitBalance(-80)).toEqual({ debit: 0, credit: 80 });
    expect(splitBalance(0)).toEqual({ debit: 0, credit: 0 });
  });

  it("checks balance to the cent", () => {
    expect(isBalanced(100.001, 100)).toBe(true);
    expect(isBalanced(100.01, 100)).toBe(false);
  });

  it("totals a balanced trial balance", () => {
    // bank 100,000 funding − 11,000 paid; funding credit; expense / payable
    const rows = [
      tb("9100", 0, 100000, 11000),
      tb("9300", 0, 0, 100000),
      tb("GL-1300", 0, 10000, 0),
      tb("9220", 0, 1500, 0),
      tb("9200", 0, 11000, 11000),
      tb("9210", 0, 0, 500),
    ];
    const t = trialBalanceTotals(rows);
    expect(t.periodDebit).toBe(122500);
    expect(t.periodCredit).toBe(122500);
    expect(t.closing).toBe(0);
    expect(t.closingDebit).toBe(100500);
    expect(t.closingCredit).toBe(100500);
    expect(t.balanced).toBe(true);
  });

  it("flags an unbalanced trial balance", () => {
    expect(trialBalanceTotals([tb("9100", 0, 100, 0), tb("9300", 0, 0, 90)]).balanced).toBe(false);
  });

  it("totals ledger lines as debit and credit, never mixed", () => {
    const t = ledgerTotals([
      { debit: 10, credit: 0 },
      { debit: 0, credit: 7.5 },
      { debit: 0, credit: 2.5 },
    ]);
    expect(t).toEqual({ debit: 10, credit: 10, balanced: true });
  });

  it("groups lines by account in order", () => {
    const g = groupByAccount([
      { gl_account_id: "a", n: 1 },
      { gl_account_id: "b", n: 2 },
      { gl_account_id: "a", n: 3 },
    ]);
    expect(g.map(([k, v]) => [k, v.map((x) => x.n)])).toEqual([
      ["a", [1, 3]],
      ["b", [2]],
    ]);
  });

  it("checks the daily cash position chain", () => {
    const row = (day: string, opening: number, i: number, o: number) => ({
      day,
      account_type: "bank",
      gl_code: "9100",
      gl_name: "Bank",
      opening,
      cash_in: i,
      cash_out: o,
      closing: opening + i - o,
    });
    expect(
      cashPositionConsistent([row("2026-09-01", 0, 100, 0), row("2026-09-02", 100, 0, 30)]),
    ).toBe(true);
    expect(
      cashPositionConsistent([row("2026-09-01", 0, 100, 0), row("2026-09-02", 90, 0, 30)]),
    ).toBe(false);
  });

  it("gives the days of a month", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-13")).toEqual({ from: "", to: "" });
    expect(monthRange("")).toEqual({ from: "", to: "" });
  });

  it("classifies the reconciliation difference", () => {
    expect(reconciliationStatus(0)).toBe("ok");
    expect(reconciliationStatus(0.4)).toBe("rounding");
    expect(reconciliationStatus(-25)).toBe("check");
  });
});
