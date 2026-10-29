import { describe, expect, it } from "vitest";
import { formatAmount, formatCurrency as formatCode } from "@/lib/format-number";
import { formatCurrency } from "@/lib/format";
import { formatExportNumber } from "@/lib/export/number-format";

describe("X07 / G16: money on screens = money in exports", () => {
  it("2 decimals by default, never abbreviated", () => {
    expect(formatAmount(243039.47)).toBe("243,039.47");
    expect(formatAmount(1750)).toBe("1,750.00");
    expect(formatCode(12417300, "SAR")).toBe("12,417,300.00 SAR");
    expect(formatCurrency(1750, { currency: "SAR" })).toBe("SAR 1,750.00");
  });
  it("screen text equals the export text", () => {
    for (const v of [0, 0.5, 1234.567, -9876543.21])
      expect(formatAmount(v)).toBe(formatExportNumber(v, 2));
  });
  it("explicit decimals still win (counts, percentages)", () => {
    expect(formatAmount(12, 0)).toBe("12");
  });
});
