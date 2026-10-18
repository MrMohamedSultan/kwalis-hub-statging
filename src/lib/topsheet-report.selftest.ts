// =====================================================================
// Top Sheet Cost Report — self-tests (run on demand from the report page).
// Doctrine under test:
//   Budget    = budget lines (lineTotalSAR)
//   Actual    = canonical ledger entry_kind='actual'  (incurred cost)
//   Committed = canonical ledger entry_kind='commitment' (open POs;
//               Cancelled status is ignored)
//   Paid      = canonical payments ledger (cash out — never counts as
//               Actual, never as Committed)
// =====================================================================
import type { BudgetLine } from "@/lib/store";
import { buildTopSheetReport, makeTxnResolver, type TopsheetAccount } from "@/lib/topsheet-report";
import type { CanonicalLedgerEntry, CanonicalPaidEntry } from "@/lib/canonical-ledger";

export type SelfTestResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

const acc = (
  code: string,
  description: string,
  section: TopsheetAccount["section"],
  sort = 0,
): TopsheetAccount => ({ code, description, section, sort_order: sort });

const bl = (
  id: string,
  mainCode: string,
  total: number,
  topsheetCode: string | null = null,
): BudgetLine =>
  ({
    id,
    topsheetCode,
    mainCode,
    headerCode: mainCode ? String(Math.floor(parseInt(mainCode, 10) / 100) * 100) : "",
    description: `Line ${id}`,
    amount: total,
    rate: 1,
    x: 1,
    prep: 0,
    shooting: 0,
    wrap: 0,
    unit: "flat",
    currency: "SAR",
    excluded: false,
  }) as unknown as BudgetLine;

/** Canonical ledger entry fixture (v_ledger_transactions shape). */
const led = (
  id: string,
  budgetCode: string | null,
  amount: number,
  kind: "actual" | "commitment" = "actual",
  date: string | null = "2026-05-15",
  status: string | null = null,
  reference?: string,
): CanonicalLedgerEntry => ({
  sourceType: "invoice",
  sourceId: id,
  entryKind: kind,
  entryDate: date,
  reference: reference ?? `REF-${id}`,
  description: null,
  counterparty: `Vendor ${id}`,
  budgetCode,
  amount,
  status,
});

/** Canonical paid fixture (payments ledger, code already resolved). */
const payd = (
  id: string,
  budgetCode: string | null,
  amount: number,
  date: string | null = "2026-05-15",
): CanonicalPaidEntry => ({
  id,
  sourceType: "invoice",
  sourceId: null,
  date,
  method: "transfer",
  budgetCode,
  amount,
});

const record = (results: SelfTestResult[], name: string, passed: boolean, detail?: string) =>
  results.push({ name, passed, detail });

export function runTopSheetSelfTests(): SelfTestResult[] {
  const results: SelfTestResult[] = [];

  // 1) Budget rolls up to the correct topsheet account
  {
    const accounts = [acc("1100", "Scripts", "ATL")];
    const budget = [bl("a", "1101", 100_000)];
    const report = buildTopSheetReport({ accounts, budget, ledger: [], paid: [] });
    const row = report.sections.find((s) => s.key === "ATL")!.rows.find((r) => r.code === "1100")!;
    record(
      results,
      "budget line rolls up to topsheet account",
      row.budget === 100_000 && row.lineCount === 1,
      `budget=${row.budget}`,
    );
  }

  // 2) Direct code match wins over heuristics
  {
    const accounts = [acc("2100", "Extra Talent", "Production")];
    const budget = [bl("a", "2100", 50_000)];
    const report = buildTopSheetReport({ accounts, budget, ledger: [], paid: [] });
    const row = report.sections
      .find((s) => s.key === "Production")!
      .rows.find((r) => r.code === "2100")!;
    record(results, "direct code match", row.budget === 50_000, `budget=${row.budget}`);
  }

  // 3) Explicit topsheetCode overrides everything
  {
    const accounts = [acc("4000", "Editorial", "Post"), acc("2100", "Extra Talent", "Production")];
    const budget = [bl("a", "2100", 10_000, "4000")];
    const report = buildTopSheetReport({ accounts, budget, ledger: [], paid: [] });
    const post = report.sections.find((s) => s.key === "Post")!;
    const prod = report.sections.find((s) => s.key === "Production")!;
    record(
      results,
      "explicit topsheetCode wins",
      post.rows[0].budget === 10_000 && prod.rows[0].budget === 0,
      `post=${post.rows[0].budget}, prod=${prod.rows[0].budget}`,
    );
  }

  // 4) Unmappable line lands in Unassigned and raises a validation issue
  {
    const accounts = [acc("1100", "Scripts", "ATL")];
    const budget = [bl("a", "", 5_000)];
    const report = buildTopSheetReport({ accounts, budget, ledger: [], paid: [] });
    record(
      results,
      "unmapped budget line → unassigned + issue",
      report.unassigned.budget === 5_000 &&
        report.validation.issues.some((i) => i.kind === "unassigned_budget_line"),
      `unassigned=${report.unassigned.budget}`,
    );
  }

  // 5) DOCTRINE: incurred cost (invoice) adds to Actual; payment adds to Paid
  {
    const accounts = [acc("2100", "Extra Talent", "Production")];
    const budget = [bl("a", "2100", 100_000)];
    const ledger = [led("i1", "2100", 20_000)];
    const paid = [payd("p1", "2100", 15_000)];
    const report = buildTopSheetReport({ accounts, budget, ledger, paid });
    const row = report.sections
      .find((s) => s.key === "Production")!
      .rows.find((r) => r.code === "2100")!;
    record(
      results,
      "incurred adds to actual; payment adds to paid (never committed)",
      row.committed === 0 &&
        row.actual === 20_000 &&
        row.paid === 15_000 &&
        row.variance === 80_000,
      `committed=${row.committed}, actual=${row.actual}, paid=${row.paid}, variance=${row.variance}`,
    );
  }

  // 6) Cancelled commitments (voided POs) are ignored; open ones count
  {
    const accounts = [acc("2200", "Set Design", "Production")];
    const budget = [bl("a", "2200", 100_000)];
    const ledger = [
      led("po1", "2200", 30_000, "commitment", "2026-05-01", "Approved"),
      led("po2", "2200", 50_000, "commitment", "2026-05-02", "Cancelled"),
    ];
    const report = buildTopSheetReport({ accounts, budget, ledger, paid: [] });
    const row = report.sections
      .find((s) => s.key === "Production")!
      .rows.find((r) => r.code === "2200")!;
    record(
      results,
      "cancelled commitment ignored; open commitment counted",
      row.committed === 30_000,
      `committed=${row.committed}`,
    );
  }

  // 7) Transaction referencing an unknown code raises unmapped issue
  {
    const accounts = [acc("1100", "Scripts", "ATL")];
    const budget = [bl("a", "1101", 10_000)];
    // Non-numeric code the resolver's numeric heuristics cannot map.
    const ledger = [led("i9", "ZZ-UNKNOWN", 7_000, "actual", "2026-05-01", null, "INV-orphan")];
    const report = buildTopSheetReport({ accounts, budget, ledger, paid: [] });
    record(
      results,
      "unmapped transaction code raises issue",
      report.validation.issues.some(
        (i) => i.kind === "unmapped_txn_code" && i.ref === "INV-orphan",
      ),
      report.validation.issues.map((i) => i.message).join(" | ") || "no issues",
    );
  }

  // 8) Grand totals equal section sums (+ unassigned)
  {
    const accounts = [acc("1100", "Scripts", "ATL"), acc("2100", "Extra Talent", "Production")];
    const budget = [bl("a", "1101", 10_000), bl("b", "2100", 20_000)];
    const ledger = [led("i1", "2100", 5_000)];
    const report = buildTopSheetReport({ accounts, budget, ledger, paid: [] });
    const sectionBudget = report.sections.reduce((s, x) => s + x.subtotal.budget, 0);
    record(
      results,
      "grand totals reconcile with sections",
      report.grand.budget === sectionBudget + report.unassigned.budget &&
        report.grand.budget === 30_000 &&
        report.grand.actual === 5_000,
      `grand=${report.grand.budget}, sections=${sectionBudget}`,
    );
  }

  // 9) Over-budget actual spend raises a validation issue
  {
    const accounts = [acc("1100", "Scripts", "ATL")];
    const budget = [bl("a", "1100", 10_000)];
    const ledger = [led("i1", "1100", 15_000)];
    const report = buildTopSheetReport({ accounts, budget, ledger, paid: [] });
    record(
      results,
      "actual over budget raises issue",
      report.validation.issues.some((i) => i.kind === "over_budget"),
      report.validation.issues.map((i) => i.kind).join(",") || "none",
    );
  }

  // 10) Date range filters ledger entries by entry_date
  {
    const accounts = [acc("1100", "Scripts", "ATL")];
    const budget = [bl("a", "1100", 100_000)];
    const ledger = [
      led("i1", "1100", 10_000, "actual", "2026-01-10"),
      led("i2", "1100", 20_000, "actual", "2026-06-10"),
    ];
    const report = buildTopSheetReport({
      accounts,
      budget,
      ledger,
      paid: [],
      range: { from: "2026-01-01", to: "2026-01-31" },
    });
    const row = report.sections.find((s) => s.key === "ATL")!.rows.find((r) => r.code === "1100")!;
    record(
      results,
      "date range filters ledger by entry_date",
      row.actual === 10_000,
      `actual=${row.actual}`,
    );
  }

  // 11) Transaction resolver: topsheet code, GL sub-account, and header all resolve
  {
    const accounts = [acc("2100", "Extra Talent", "Production")];
    const budget = [bl("a", "2101", 1_000)];
    const resolveTxn = makeTxnResolver(accounts, budget);
    record(
      results,
      "txn resolver maps topsheet/GL/header codes",
      resolveTxn("2100") === "2100" &&
        resolveTxn("2101") === "2100" &&
        resolveTxn("2101.2") === "2100",
      `2100→${resolveTxn("2100")}, 2101→${resolveTxn("2101")}, 2101.2→${resolveTxn("2101.2")}`,
    );
  }

  // 12) Payroll + petty-cash ledger entries add to Actual (incurred)
  {
    const accounts = [acc("2100", "Line Producer", "Production")];
    const budget = [bl("a", "2100", 200_000)];
    const ledger = [
      { ...led("p1", "2100", 50_000), sourceType: "payroll" },
      { ...led("r1", "2100", 3_000), sourceType: "petty_cash" },
    ];
    const report = buildTopSheetReport({ accounts, budget, ledger, paid: [] });
    const row = report.sections
      .find((s) => s.key === "Production")!
      .rows.find((r) => r.code === "2100")!;
    record(
      results,
      "payroll and petty-cash ledger entries add to actual",
      row.committed === 0 && row.actual === 53_000,
      `committed=${row.committed}, actual=${row.actual}`,
    );
  }

  // 13) DOCTRINE GUARD: paid with no ledger row → actual stays 0
  {
    const accounts = [acc("2100", "Extra Talent", "Production")];
    const budget = [bl("a", "2100", 100_000)];
    const paid = [payd("p1", "2100", 2_000)];
    const report = buildTopSheetReport({ accounts, budget, ledger: [], paid });
    const row = report.sections
      .find((s) => s.key === "Production")!
      .rows.find((r) => r.code === "2100")!;
    record(
      results,
      "paid never counts as actual (cash ≠ incurred cost)",
      row.actual === 0 && row.paid === 2_000 && row.variance === 100_000,
      `actual=${row.actual}, paid=${row.paid}`,
    );
  }

  return results;
}

export function summarizeSelfTests(results: SelfTestResult[]): {
  total: number;
  passed: number;
  failed: number;
  allPassed: boolean;
} {
  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    allPassed: passed === results.length,
  };
}
