// =====================================================================
// Build guard — the Top Sheet Cost Report MUST stay wired to the
// canonical financial doctrine layer (v_ledger_transactions + payments
// ledger + lineTotalSAR budget basis).
//
// Two tripwires:
//   1. TYPE-LEVEL: ReportInputs must keep requiring CanonicalLedgerEntry[]
//      and CanonicalPaidEntry[]. If the report's data contract ever drifts
//      back to store collections (invoices / POs / payroll / receipts),
//      this file fails `bun run typecheck`.
//   2. RUNTIME: all rollup self-tests run in CI via `bun run test` — any
//      doctrinal regression (paid counted as actual, cancelled commitments
//      included, section sums ≠ grand total, …) fails the suite.
// =====================================================================
import { describe, expect, it } from "vitest";
import { runTopSheetSelfTests, summarizeSelfTests } from "@/lib/topsheet-report.selftest";
import type { ReportInputs } from "@/lib/topsheet-report";
import type { CanonicalLedgerEntry, CanonicalPaidEntry } from "@/lib/canonical-ledger";

// Type-level divergence guard — compile fails if the report's data contract
// stops requiring the canonical ledger shapes.
type Assert<T extends true> = T;
type _InputsStayCanonical = Assert<
  ReportInputs["ledger"] extends CanonicalLedgerEntry[]
    ? ReportInputs["paid"] extends CanonicalPaidEntry[]
      ? true
      : false
    : false
>;
export const __topsheetCanonicalGuard: _InputsStayCanonical = true;

describe("Top Sheet canonical doctrine (build guard)", () => {
  it("all rollup self-tests pass against canonical inputs", () => {
    const results = runTopSheetSelfTests();
    const failures = results.filter((r) => !r.passed).map((r) => `${r.name}: ${r.detail ?? ""}`);
    expect(failures).toEqual([]);
    expect(summarizeSelfTests(results).allPassed).toBe(true);
  });
});
