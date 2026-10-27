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
