import { describe, expect, it } from "vitest";
import { buildGsr, gsrTag, payeesOf, type GsrPayment } from "@/features/reports/gsr/gsr-calc";
import {
  allocatedCost,
  overheadTotals,
  trueCost,
  type OverheadLine,
} from "@/features/reports/company-overhead/overhead-calc";

const pay = (o: Partial<GsrPayment>): GsrPayment => ({
  payment_id: Math.random().toString(36),
  payment_date: "2026-10-01",
  country: "Saudi Arabia",
  city: null,
  bank_name: null,
  payee: "X",
  payee_type: "vendor",
  source_type: "invoice",
  source_id: "s",
  currency: "SAR",
  amount_original: null,
  amount_sar: 0,
  wht: 0,
  method: "Transfer",
  ...o,
});

describe("GSR (N03)", () => {
  const rows = [
    pay({
      country: "Egypt",
      bank_name: "CIB",
      payee: "Kais",
      payee_type: "crew",
      currency: "USD",
      amount_original: 200,
      amount_sar: 750,
      wht: 39.47,
    }),
    pay({
      country: "Egypt",
      bank_name: "CIB",
      payee: "Kais",
      payee_type: "crew",
      currency: "USD",
      amount_original: 100,
      amount_sar: 375,
    }),
    pay({ country: "Saudi Arabia", payee: "Lens house", amount_sar: 1150 }),
    pay({
      country: "Saudi Arabia",
      payee: "Runner",
      payee_type: "petty_cash",
      source_type: "petty_cash",
      amount_sar: 500,
    }),
    pay({ country: "Unspecified", payee: "Sara", payee_type: "cast", amount_sar: 225 }),
  ];
  const g = buildGsr(rows);
  it("totals and percentages", () => {
    expect(g.total).toBe(3000);
    expect(g.countries.map((c) => [c.country, c.amountSar, c.pct])).toEqual([
      ["Saudi Arabia", 1650, 55],
      ["Egypt", 1125, 37.5],
      ["Unspecified", 225, 7.5],
    ]);
  });
  it("payment and payee counts, original currency, WHT", () => {
    const eg = g.countries.find((c) => c.country === "Egypt")!;
    expect(eg.payments).toBe(2);
    expect(eg.payees).toBe(1);
    expect(eg.original).toEqual({ USD: 300 });
    expect(eg.banks).toEqual(["CIB"]);
    expect(eg.wht).toBe(39.47);
  });
  it("template sections: tag, country × type, local vs international", () => {
    expect(gsrTag("Crew", "Saudi Arabia")).toBe("CREW-KSA");
    expect(g.tags.find((t) => t.tag === "CREW-EGYPT")?.amountSar).toBe(1125);
    expect(g.tags.find((t) => t.tag === "VENDOR-KSA")?.amountSar).toBe(1650); // petty cash = vendor
    expect(g.typeTotals).toEqual({ Crew: 1125, Cast: 225, Vendor: 1650 });
    expect(g.local).toBe(1650);
    expect(g.international).toBe(1125);
    expect(g.unspecified).toBe(225);
  });
  it("drill-down lists payees with their payments", () => {
    const eg = g.countries.find((c) => c.country === "Egypt")!;
    const p = payeesOf(eg);
    expect(p).toHaveLength(1);
    expect(p[0].payments).toHaveLength(2);
    expect(p[0].amountSar).toBe(1125);
  });
});

describe("Company Overhead (R25 / R11)", () => {
  const line = (o: Partial<OverheadLine>): OverheadLine => ({
    kind: "staff",
    id: "x",
    label: "x",
    position: null,
    basis: "monthly",
    monthly_amount: null,
    pct_of_budget: null,
    allocation_pct: 100,
    start_date: null,
    end_date: null,
    months: null,
    amount: 0,
    budget_code: null,
    budgeted: false,
    over_allocated: false,
    project_budget: 100_000,
    notes: null,
    ...o,
  });
  it("totals, unbudgeted part and % of budget", () => {
    const t = overheadTotals([
      line({ kind: "staff", amount: 12_000 }),
      line({ kind: "office_rent", amount: 16_000 }),
      line({ kind: "equipment", amount: 1000, budgeted: true, budget_code: "2101" }),
    ]);
    expect(t.total).toBe(29_000);
    expect(t.unbudgeted).toBe(28_000);
    expect(t.budgeted).toBe(1000);
    expect(t.byKind).toEqual({ staff: 12_000, office_rent: 16_000, equipment: 1000 });
    expect(t.pctOfBudget).toBe(29);
  });
  it("true cost = EFC + unbudgeted overhead", () => {
    expect(trueCost(250_000.5, 28_000)).toBe(278_000.5);
  });
  it("monthly cost × allocation × months", () => {
    expect(allocatedCost(12_000, 50, 2)).toBe(12_000);
  });
  it("no budget → no percentage", () => {
    expect(overheadTotals([]).pctOfBudget).toBeNull();
  });
});
