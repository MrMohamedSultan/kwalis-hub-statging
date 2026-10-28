import { describe, expect, it } from "vitest";
import {
  agingBucket,
  apAging,
  cashShareOfQpe,
  daysOverdue,
  DEFAULT_CASH_LIMITS,
  filterRegister,
  inDueWindow,
  openPurchaseOrders,
  paymentsDue,
  pettyCashRecon,
  registerTotals,
  resolveCashLimits,
  weekStart,
  type DueItem,
  type RegisterRow,
} from "@/lib/payables-reports";

const today = "2026-10-28"; // a Wednesday

const item = (o: Partial<DueItem>): DueItem => ({
  key: o.key ?? Math.random().toString(),
  kind: "invoice",
  payee: "Vendor",
  ref: null,
  instalment: null,
  dueDate: null,
  amount: 100,
  status: "Approved",
  payable: true,
  sourceId: "x",
  ...o,
});

describe("days overdue and windows (N05)", () => {
  it("counts whole days, positive when late", () => {
    expect(daysOverdue("2026-10-01", today)).toBe(27);
    expect(daysOverdue("2026-11-02", today)).toBe(-5);
    expect(daysOverdue(null, today)).toBeNull();
  });
  it("weeks start on Monday", () => {
    expect(weekStart(today)).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // Sunday
  });
  it("week / month windows keep overdue items", () => {
    expect(inDueWindow("2026-11-01", "this_week", today)).toBe(true);
    expect(inDueWindow("2026-11-02", "this_week", today)).toBe(false);
    expect(inDueWindow("2026-10-31", "this_month", today)).toBe(true);
    expect(inDueWindow("2026-11-01", "this_month", today)).toBe(false);
    expect(inDueWindow("2026-01-01", "this_week", today)).toBe(true);
    expect(inDueWindow("2026-11-20", "overdue", today)).toBe(false);
    expect(inDueWindow("2026-11-27", "next_30", today)).toBe(true);
    expect(inDueWindow("2026-11-28", "next_30", today)).toBe(false);
  });
  it("payments due: unpaid only, sorted by due date, with days overdue", () => {
    const rows = paymentsDue(
      [
        item({ key: "b", dueDate: "2026-10-30" }),
        item({ key: "a", dueDate: "2026-10-01" }),
        item({ key: "paid", dueDate: "2026-10-01", amount: 0 }),
      ],
      "all",
      today,
    );
    expect(rows.map((r) => [r.key, r.daysOverdue])).toEqual([
      ["a", 27],
      ["b", -2],
    ]);
  });
});

describe("AP aging (N06)", () => {
  it("buckets", () => {
    expect([
      agingBucket(-3),
      agingBucket(30),
      agingBucket(31),
      agingBucket(61),
      agingBucket(91),
    ]).toEqual(["0_30", "0_30", "31_60", "61_90", "90_plus"]);
  });
  it("payables only, by payee, totals add up", () => {
    const { rows, totals } = apAging(
      [
        item({ payee: "A", dueDate: "2026-10-20", amount: 100 }),
        item({ payee: "A", dueDate: "2026-08-01", amount: 50 }),
        item({ payee: "B", dueDate: "2026-06-01", amount: 70 }),
        item({ payee: "C", dueDate: "2026-06-01", amount: 999, payable: false }), // pending instalment
      ],
      today,
    );
    expect(rows.map((r) => r.payee)).toEqual(["A", "B"]);
    expect(rows[0]).toMatchObject({ "0_30": 100, "61_90": 50, total: 150, items: 2 });
    expect(totals).toMatchObject({ total: 220, "90_plus": 70 });
  });
});

describe("open purchase orders (N07)", () => {
  it("PO value − matched invoices, closed POs and fully invoiced ones left out", () => {
    const rows = openPurchaseOrders(
      [
        {
          id: "p1",
          ref: "PO-1",
          vendor: "V",
          budgetCode: "2101",
          status: "approved",
          date: null,
          amount: 1000,
        },
        {
          id: "p2",
          ref: "PO-2",
          vendor: "V",
          budgetCode: "2101",
          status: "approved",
          date: null,
          amount: 500,
        },
        {
          id: "p3",
          ref: "PO-3",
          vendor: "V",
          budgetCode: "2101",
          status: "Cancelled",
          date: null,
          amount: 900,
        },
      ],
      [
        { purchaseOrderId: "p1", price: 300 },
        { purchaseOrderId: "p1", price: 200 },
        { purchaseOrderId: "p2", price: 500 },
        { purchaseOrderId: null, price: 50 },
      ],
    );
    expect(rows.map((r) => [r.id, r.invoiced, r.invoiceCount, r.open])).toEqual([
      ["p1", 500, 2, 500],
    ]);
  });
});

describe("petty cash reconciliation (N08)", () => {
  it("issued − spent − returned = remaining; receipts above the limit flagged", () => {
    const { rows, totals } = pettyCashRecon(
      [{ id: "f", holder: "Runner", ref: "PC-1", issued: 3000 }],
      [
        { advanceId: "f", amount: 1000, status: "approved" },
        { advanceId: "f", amount: 6000, status: "pending" },
        { advanceId: "f", amount: 200, status: "rejected" },
      ],
      [{ cashAdvanceId: "f", amount: 500 }],
      DEFAULT_CASH_LIMITS,
    );
    expect(rows[0]).toMatchObject({
      spent: 1000,
      pending: 6000,
      returned: 500,
      remaining: 1500,
      overLimit: 1,
    });
    expect(totals.remaining).toBe(1500);
  });
  it("limits come from the project settings when set, else the defaults", () => {
    expect(resolveCashLimits(null)).toEqual(DEFAULT_CASH_LIMITS);
    expect(resolveCashLimits({ cash_limit_pct_of_qpe: "5", cash_limit_per_txn_sar: null })).toEqual(
      {
        pctOfQpe: 5,
        perTxn: DEFAULT_CASH_LIMITS.perTxn,
        source: "settings",
      },
    );
    expect(cashShareOfQpe(1500, 30000)).toBe(5);
    expect(cashShareOfQpe(10, 0)).toBeNull();
  });
});

describe("payments register (R12)", () => {
  const r = (o: Partial<RegisterRow>): RegisterRow => ({
    event_key: Math.random().toString(),
    event_type: "payment",
    payment_date: "2026-09-10",
    payment_ref: null,
    payee: "Gaffer Co",
    document_type: "invoice",
    document_id: null,
    document_ref: null,
    instalment: null,
    budget_code: "1403",
    method: "Transfer",
    paid_from_code: "9100",
    paid_from_name: "Bank",
    gross: 0,
    wht: 0,
    net: 0,
    ...o,
  });
  const rows = [
    r({ gross: 11500, wht: 500, net: 11000 }),
    r({ payee: "Director X", budget_code: "1101", gross: 10000, wht: 500, net: 9500 }),
    r({
      payee: "Taxi",
      method: "Cash",
      paid_from_code: "9110",
      paid_from_name: "Cash",
      gross: 300,
      net: 300,
    }),
  ];
  it("filters by payee, code and method", () => {
    expect(filterRegister(rows, { payee: "dir" })).toHaveLength(1);
    expect(filterRegister(rows, { code: "1403" })).toHaveLength(2);
    expect(filterRegister(rows, { method: "Cash" })).toHaveLength(1);
    expect(filterRegister(rows, { method: "all" })).toHaveLength(3);
  });
  it("totals per paid-from account; bank total apart", () => {
    const t = registerTotals(rows);
    expect([t.gross, t.wht, t.net, t.bank]).toEqual([21800, 1000, 20800, 20500]);
    expect(t.byAccount.map((a) => [a.code, a.net, a.count])).toEqual([
      ["9100", 20500, 2],
      ["9110", 300, 1],
    ]);
  });
});

import { relatedPartyPayees } from "@/lib/payables-reports";

describe("AP Aging related-party flag (E08)", () => {
  it("lists payees with a related-party invoice", () => {
    const base = {
      kind: "invoice" as const,
      ref: null,
      instalment: null,
      dueDate: null,
      amount: 1,
      status: "Approved",
      payable: true,
      sourceId: "x",
    };
    const s = relatedPartyPayees([
      { ...base, key: "a", payee: "A", e08: { isRelatedParty: true } },
      { ...base, key: "b", payee: "B", e08: { isRelatedParty: false } },
      { ...base, key: "c", payee: "C" },
    ]);
    expect([...s]).toEqual(["A"]);
  });
});
