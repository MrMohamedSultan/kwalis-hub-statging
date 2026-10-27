import { describe, expect, it } from "vitest";
import { PLATFORM_FX_DEFAULTS } from "@/lib/fx-settings";
import { fundingCurrencies, toLedgerAmount } from "@/lib/funding-currency";

describe("funding inflow currency (B28)", () => {
  it("books SAR as-is", () => {
    expect(toLedgerAmount(PLATFORM_FX_DEFAULTS, 100000, "SAR")).toEqual({
      amount: 100000,
      rate: 1,
    });
  });
  it("converts a USD inflow at the configured rate", () => {
    expect(toLedgerAmount(PLATFORM_FX_DEFAULTS, 100000, "USD")).toEqual({
      amount: 375000,
      rate: 3.75,
    });
    expect(toLedgerAmount(PLATFORM_FX_DEFAULTS, 1234.567, "EUR")!.amount).toBe(5000.0);
  });
  it("refuses a currency without a rate", () => {
    expect(toLedgerAmount(PLATFORM_FX_DEFAULTS, 10, "JPY")).toBeNull();
    expect(toLedgerAmount(null, 10, "USD")).toBeNull();
  });
  it("lists SAR first, then the configured currencies", () => {
    expect(fundingCurrencies(PLATFORM_FX_DEFAULTS)).toEqual(["SAR", "USD", "EUR", "AED"]);
    expect(fundingCurrencies(null)).toEqual(["SAR"]);
  });
});
