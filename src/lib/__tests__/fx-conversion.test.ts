import { describe, expect, it } from "vitest";
import { PLATFORM_FX_DEFAULTS, convert, rateFor, normalizeSettings } from "@/lib/fx-settings";

const s = PLATFORM_FX_DEFAULTS; // base SAR, USD 3.75, EUR 4.05, AED 1.02

describe("fx conversion", () => {
  it("treats the base currency as 1", () => {
    expect(rateFor(s, "SAR")).toBe(1);
    expect(convert(s, 1000, "SAR", "SAR")).toBe(1000);
  });

  it("converts base -> foreign using the stored rate", () => {
    expect(convert(s, 3750, "SAR", "USD")).toBeCloseTo(1000, 6);
    expect(convert(s, 4050, "SAR", "EUR")).toBeCloseTo(1000, 6);
  });

  it("round-trips without drift", () => {
    // CORRECTED FIXTURE (2026-08-24): this test previously used 4_590_687 —
    // the exact *un-converted* mixed-currency total produced by the old
    // v_budget_line_financials formula (amount × rate × GREATEST(x,1), no
    // FX). That figure was a bug, not a reference: the canonical budget
    // formula (now public.budget_line_total_sar in the database) converts
    // at the project FX rate, yielding 17,143,076.48 SAR for the same
    // budget. Keeping the buggy total as a fixture invited a future "fix
    // the test" regression. The fixture below is deliberately neutral.
    const usd = convert(s, 8_641_523, "SAR", "USD")!;
    expect(convert(s, usd, "USD", "SAR")).toBeCloseTo(8_641_523, 4);
  });

  it("cross-converts through the base", () => {
    expect(convert(s, 1000, "USD", "AED")).toBeCloseTo((1000 * 3.75) / 1.02, 6);
  });

  it("returns null for unknown currencies", () => {
    expect(rateFor(s, "XYZ")).toBeNull();
    expect(convert(s, 100, "SAR", "XYZ")).toBeNull();
  });

  it("drops invalid rates and the base from the matrix", () => {
    const n = normalizeSettings("sar", { SAR: 1, USD: 3.75, EUR: 0, GBP: "x" }, s);
    expect(n.baseCurrency).toBe("SAR");
    expect(n.rates).toEqual({ USD: 3.75 });
  });
});
