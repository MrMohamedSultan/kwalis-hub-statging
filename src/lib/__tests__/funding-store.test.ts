import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/store", () => ({ useStore: () => null }));

import { fromFundingRow, toFundingRow, treasurySign } from "@/lib/funding-store";

describe("funding rows keep their currency (B28)", () => {
  it("writes currency, original amount and rate beside the SAR amount", () => {
    expect(
      toFundingRow({ amount: 150000, currency: "USD", originalAmount: 40000, fxRate: 3.75 }),
    ).toEqual({ amount: 150000, currency: "USD", original_amount: 40000, fx_rate: 3.75 });
  });
  it("a SAR inflow clears the foreign fields", () => {
    expect(toFundingRow({ amount: 1000, currency: "SAR" })).toEqual({
      amount: 1000,
      currency: "SAR",
      original_amount: null,
      fx_rate: null,
    });
  });
  it("reads them back; SAR rows show no foreign amount", () => {
    const usd = fromFundingRow({
      id: "1",
      funding_date: "2026-09-01",
      amount: "150000",
      currency: "USD",
      original_amount: "40000",
      fx_rate: "3.75",
      kind: "Capital",
    });
    expect([usd.currency, usd.originalAmount, usd.fxRate, usd.amount]).toEqual([
      "USD",
      40000,
      3.75,
      150000,
    ]);
    const sar = fromFundingRow({
      id: "2",
      funding_date: "2026-09-01",
      amount: 5,
      currency: "SAR",
      kind: "x",
    });
    expect([sar.currency, sar.originalAmount, sar.kind]).toEqual([undefined, undefined, "Other"]);
  });
  it("bank movements in and out", () => {
    expect([
      treasurySign("vat_recovery"),
      treasurySign("petty_cash_return"),
      treasurySign("vat_payment"),
      treasurySign("bank_charge"),
    ]).toEqual([1, 1, -1, -1]);
  });
});
