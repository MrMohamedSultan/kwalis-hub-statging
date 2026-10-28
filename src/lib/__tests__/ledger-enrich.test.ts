// R03: General Ledger QPE from rebate_transactions() and department from the budget header.
import { describe, expect, it } from "vitest";
import {
  departmentResolver,
  enrichLedgerLines,
  qpeKeyForEvent,
  type LedgerEnrichment,
} from "@/features/reports/ledger/ledger-enrich";
import type { GeneralLedgerLine } from "@/lib/ledger-calc";

const line = (event_key: string, extra: Partial<GeneralLedgerLine> = {}): GeneralLedgerLine => ({
  entry_ref: null,
  entry_seq: 1,
  event_key,
  event_type: event_key.split(":")[0],
  entry_date: "2026-10-01",
  line_no: 1,
  gl_account_id: "gl",
  gl_code: "5100",
  gl_name: "Expense",
  debit: 100,
  credit: 0,
  running_balance: 100,
  party: "X",
  budget_code: "2101",
  reference: null,
  description: null,
  department: null,
  status: null,
  qpe_eligible: true,
  is_reversal: false,
  phase: 1,
  ...extra,
});

const payments = new Map<string, [string, string]>([
  ["pay1", ["payroll", "pr1"]],
  ["pay2", ["purchase_order", "po1"]],
]);

describe("qpeKeyForEvent", () => {
  it("maps journal events and payments to the rebate_transactions source", () => {
    expect(qpeKeyForEvent("invoice:i1", payments)).toBe("invoice:i1");
    expect(qpeKeyForEvent("instalment:pr1:m1", payments)).toBe("payroll:pr1");
    expect(qpeKeyForEvent("petty_receipt:r1", payments)).toBe("petty_cash:r1");
    expect(qpeKeyForEvent("payment:pay1", payments)).toBe("payroll:pr1");
    expect(qpeKeyForEvent("payment:pay2", payments)).toBeNull();
    expect(qpeKeyForEvent("funding:f1", payments)).toBeNull();
  });
});

describe("enrichLedgerLines", () => {
  const e: LedgerEnrichment = {
    qpe: new Map([
      ["invoice:i1", "not_eligible"],
      ["payroll:pr1", "eligible"],
    ]),
    payments,
    department: departmentResolver([
      { headerCode: "2100", mainCode: "2100", description: "CAMERA" },
      { headerCode: "2100", mainCode: "2101", description: "DOP" },
    ]),
  };
  it("replaces the old invoice flag with the eligibility source", () => {
    const [inv, inst, pay] = enrichLedgerLines(
      [line("invoice:i1"), line("instalment:pr1:m1"), line("payment:pay1")],
      e,
    );
    expect(inv.qpe_eligible).toBe(false);
    expect(inv.qpe_status).toBe("not_eligible");
    expect(inst.qpe_eligible).toBe(true);
    expect(pay.qpe_status).toBe("eligible");
  });
  it("fills the department from the budget header and keeps an existing one", () => {
    const [a, b] = enrichLedgerLines(
      [line("overtime:o1"), line("invoice:i1", { department: "Art" })],
      e,
    );
    expect(a.department).toBe("2100 CAMERA");
    expect(b.department).toBe("Art");
  });
  it("falls back to the journal flag without the eligibility source", () => {
    expect(enrichLedgerLines([line("invoice:i1")], null)[0].qpe_status).toBe("eligible");
  });
});

describe("departmentResolver", () => {
  it("derives the header numerically when the code is not in the budget", () => {
    expect(departmentResolver([])("3405.1")).toBe("3400");
    expect(departmentResolver([])("")).toBeNull();
  });
});
