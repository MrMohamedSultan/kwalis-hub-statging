import { describe, expect, it, vi } from "vitest";

// store.ts pulls in the Supabase client; the position helper only needs its types.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { computeBudgetPosition, poIsCommitment, poOpenCommitment } from "@/lib/budget-position";
import type { Invoice, PayrollRow, PurchaseOrder } from "@/lib/store";

const inv = (p: Partial<Invoice>): Invoice =>
  ({
    id: "i1",
    description: "",
    department: "",
    budgetCode: "1002",
    price: 1000,
    vatable: true,
    vatAmount: 150,
    date: "2026-10-05",
    invoiceNo: "1",
    vendorName: "V",
    ...p,
  }) as Invoice;
const po = (p: Partial<PurchaseOrder>): PurchaseOrder =>
  ({
    id: "po1",
    poNumber: "MON26-PO-0001",
    vendorName: "V",
    description: "",
    budgetCode: "1002",
    amount: 1000,
    status: "Approved",
    date: "2026-10-01",
    ...p,
  }) as PurchaseOrder;
const contract = (p: Partial<PayrollRow>): PayrollRow => ({
  id: "c1",
  refId: "person-1",
  name: "Crew",
  kind: "crew",
  totalAmount: 16000,
  payments: [],
  receipts: [],
  percents: [],
  budgetCode: "1201",
  ...p,
});
const base = {
  payroll: [] as PayrollRow[],
  invoices: [] as Invoice[],
  purchaseOrders: [] as PurchaseOrder[],
  payments: [],
  receipts: [],
  legacyPaidFor: () => 0,
};

describe("PO commitment", () => {
  it("draft / cancelled / closed are not commitments", () => {
    expect(poIsCommitment("Approved")).toBe(true);
    expect(poIsCommitment("open")).toBe(true);
    expect(poIsCommitment("Draft")).toBe(false);
    expect(poIsCommitment("Cancelled")).toBe(false);
    expect(poIsCommitment("closed")).toBe(false);
  });
  it("an invoice on the PO converts the commitment", () => {
    expect(poOpenCommitment(po({}), [inv({ purchaseOrderId: "po1", price: 600 })])).toBe(400);
    expect(poOpenCommitment(po({}), [inv({ purchaseOrderId: "po1", price: 1200 })])).toBe(0);
    expect(poOpenCommitment(po({}), [inv({ purchaseOrderId: null })])).toBe(1000);
  });
});

describe("computeBudgetPosition (B05 B17)", () => {
  it("PO 1,000 + invoice 1,000 on it = 1,000, not 2,000", () => {
    const p = computeBudgetPosition({
      ...base,
      totalBudget: 93750,
      purchaseOrders: [po({})],
      invoices: [inv({ purchaseOrderId: "po1" })],
    });
    expect(p.actual + p.commitment).toBe(1000);
  });
  it("remaining = budget − actual − commitment, contracts included", () => {
    const p = computeBudgetPosition({
      ...base,
      totalBudget: 93750,
      payroll: [contract({})],
      purchaseOrders: [po({ id: "po2", amount: 1000 })],
      invoices: [inv({ purchaseOrderId: null })],
    });
    expect(p.parts.contractsCommitment).toBe(16000);
    expect(p.commitment).toBe(17000);
    expect(p.actual).toBe(1000);
    expect(p.remaining).toBe(93750 - 1000 - 17000);
  });
  it("VAT stays outside the budget", () => {
    const p = computeBudgetPosition({
      ...base,
      totalBudget: 0,
      invoices: [inv({ vatAmount: 150 })],
    });
    expect(p.actual).toBe(1000);
  });
  it("approved / paid installments move from commitment to actual", () => {
    const p = computeBudgetPosition({
      ...base,
      totalBudget: 0,
      payroll: [
        contract({
          paymentSchedule: [
            { id: "m1", label: "Sign", percent: 25, dueDate: "", amount: null, status: "Paid" },
            { id: "m2", label: "Wrap", percent: 75, dueDate: "", amount: null, status: "Pending" },
          ],
        }),
      ],
    });
    expect(p.parts.contractsActual).toBe(4000);
    expect(p.parts.contractsCommitment).toBe(12000);
  });
  it("invoice installment rows are not counted as contracts", () => {
    const p = computeBudgetPosition({
      ...base,
      totalBudget: 0,
      payroll: [contract({ refId: "invoice:i1:0", totalAmount: 500 })],
    });
    expect(p.commitment).toBe(0);
  });
  it("only approved petty-cash receipts are actual", () => {
    const p = computeBudgetPosition({
      ...base,
      totalBudget: 0,
      receipts: [
        { id: "r1", recipient: "", method: "Cash", amount: 80, status: "approved" },
        { id: "r2", recipient: "", method: "Cash", amount: 20, status: "pending" },
      ],
    });
    expect(p.actual).toBe(80);
  });
  it("car rentals and hotels are commitments until invoiced", () => {
    const p = computeBudgetPosition({
      ...base,
      totalBudget: 10000,
      invoices: [inv({ id: "hotel-inv", price: 5000 })],
      logistics: [{ amount: 3000 }, { amount: 5000, invoiceId: "hotel-inv" }],
    });
    expect(p.parts.logisticsCommitment).toBe(3000);
    expect(p.remaining).toBe(10000 - 5000 - 3000);
  });
  it("paid and payable", () => {
    const p = computeBudgetPosition({
      ...base,
      totalBudget: 0,
      invoices: [inv({})],
      payments: [
        {
          id: "p1",
          sourceType: "invoice",
          sourceId: "i1",
          amount: 400,
          paymentDate: "",
          method: "Bank",
        },
      ],
    });
    expect(p.paid).toBe(400);
    expect(p.payable).toBe(600);
  });
});

// ---- db/pending/180: glossary scenario -------------------------------------
import { cashPosition, costLine, legacyContractPaid } from "@/lib/budget-position";

describe("glossary scenario (180)", () => {
  const contracts = [
    contract({
      id: "ka",
      totalAmount: 10000,
      paymentSchedule: [
        {
          id: "m1",
          label: "Signing",
          percent: 0,
          dueDate: "2026-09-20",
          amount: 4000,
          status: "Approved",
        },
        {
          id: "m2",
          label: "Final",
          percent: 60,
          dueDate: "2026-11-20",
          amount: null,
          status: "Pending",
        },
      ],
    }),
    contract({
      id: "kb",
      totalAmount: 6000,
      paymentSchedule: [
        {
          id: "m1",
          label: "Prep",
          percent: 0,
          dueDate: "2026-09-25",
          amount: 2000,
          status: "Paid",
        },
        {
          id: "m2",
          label: "Wrap",
          percent: 0,
          dueDate: "2026-12-01",
          amount: 4000,
          status: "Hold",
        },
      ],
    }),
  ];
  const input = {
    ...base,
    totalBudget: 93750,
    payroll: contracts,
    invoices: [inv({ id: "i1", price: 1000, purchaseOrderId: "po1" })],
    purchaseOrders: [po({ id: "po1", amount: 1000 })],
    payments: [{ id: "p", sourceType: "payroll", sourceId: "kb", amount: 2000 } as any],
    logistics: [{ amount: 3000 }, { amount: 5000 }],
  };
  it("matches the database numbers", () => {
    const p = computeBudgetPosition(input);
    expect([p.actual, p.commitment, p.paid, p.payable, p.remaining]).toEqual([
      7000, 18000, 2000, 5000, 68750,
    ]);
  });
  it("a cancelled contract keeps its Actual and drops its Commitment (A04)", () => {
    const p = computeBudgetPosition({
      ...input,
      payroll: [{ ...contracts[0], contractCancelledAt: "2026-10-28" }, contracts[1]],
    });
    expect([p.actual, p.commitment]).toEqual([7000, 12000]);
  });
  it("legacy contract without schedule: payments ledger or Paid slots", () => {
    const r = contract({
      id: "x",
      totalAmount: 1000,
      payments: ["Paid", "Upcoming"],
      percents: [30, 70],
    });
    expect(legacyContractPaid(r, [])).toBe(300);
    expect(
      legacyContractPaid(r, [{ sourceType: "payroll", sourceId: "x", amount: 500 } as any]),
    ).toBe(500);
  });
});

describe("cost line (R06)", () => {
  it("default ETC = Remaining, EFC = Budget, Variance 0", () => {
    expect(costLine(20000, 4000, 6000)).toMatchObject({
      remaining: 10000,
      etc: 10000,
      efc: 20000,
      variance: 0,
      pctSpent: 20,
    });
  });
  it("editing ETC moves EFC and Variance", () => {
    expect(costLine(20000, 4000, 6000, 15000)).toMatchObject({ efc: 25000, variance: -5000 });
  });
  it("overspent line: ETC never below 0", () => {
    expect(costLine(1000, 900, 300)).toMatchObject({
      remaining: -200,
      etc: 0,
      efc: 1200,
      variance: -200,
    });
    expect(costLine(0, 50, 0).pctSpent).toBeNull();
  });
});

describe("cash position (A12)", () => {
  it("Cash = Funding − Paid − VAT paid + VAT recovered − WHT remitted", () => {
    const c = cashPosition({
      funding: 50000,
      paid: 2000,
      vatPaid: 300,
      vatRecovered: 100,
      whtRemitted: 50,
      upcoming: 5000,
    });
    expect([c.cashBalance, c.expectedBalance, c.utilisationPct]).toEqual([47750, 42750, 4]);
    expect(c.hasFunding).toBe(true);
  });
  it("no funding: flagged, no utilisation %", () => {
    const c = cashPosition({
      funding: 0,
      paid: 2000,
      vatPaid: 0,
      vatRecovered: 0,
      whtRemitted: 0,
      upcoming: 0,
    });
    expect([c.hasFunding, c.paymentsExceedFunding, c.overdrawn, c.utilisationPct]).toEqual([
      false,
      true,
      true,
      null,
    ]);
  });
});
