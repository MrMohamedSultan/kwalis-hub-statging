import { describe, expect, it } from "vitest";
import {
  computeWht,
  displayDaysAndRate,
  guessIdType,
  inclusiveDays,
  positionSelectValue,
  POSITION_OTHER,
  rateToBase,
  resolveWhtRate,
  suggestTaxResidency,
  toBase,
  validateIban,
  validateIdNumber,
  validateSwift,
  whtInBase,
} from "@/lib/contract-terms";

describe("contract currency → project base (SAR)", () => {
  it("B01: 2,000 USD at 3.75 commits 7,500 SAR", () => {
    expect(rateToBase("USD", "SAR", 3.75)).toBe(3.75);
    expect(toBase(2000, "USD", "SAR", 3.75)).toBe(7500);
  });

  it("B01: remaining on a 30,000 SAR line is 22,500", () => {
    expect(30000 - 0 - toBase(2000, "USD", "SAR", 3.75)!).toBe(22500);
  });

  it("B02: a SAR contract is never divided by the rate", () => {
    expect(rateToBase("SAR", "SAR", 3.75)).toBe(1);
    expect(toBase(7000, "SAR", "SAR", 3.75)).toBe(7000);
  });

  it("uses the project rate, not a fixed one", () => {
    expect(toBase(1000, "USD", "SAR", 3.76)).toBe(3760);
  });

  it("converts the pegged AED through USD", () => {
    expect(toBase(3672.5, "AED", "SAR", 3.75)).toBe(3750);
  });

  it("refuses currencies without a rate", () => {
    expect(rateToBase("EUR", "SAR", 3.75)).toBeNull();
    expect(toBase(100, "EUR", "SAR", 3.75)).toBeNull();
  });

  it("a USD-based project divides SAR by the rate", () => {
    expect(toBase(7500, "SAR", "USD", 3.75)).toBe(2000);
  });
});

describe("withholding tax", () => {
  it("E03: 2,000 inclusive 5% → WHT 100, net 1,900", () => {
    expect(computeWht(2000, 5, "inclusive")).toEqual({ gross: 2000, wht: 100, net: 1900 });
  });

  it("E03: 2,000 exclusive 5% → gross 2,105.26, WHT 105.26, net 2,000", () => {
    expect(computeWht(2000, 5, "exclusive")).toEqual({ gross: 2105.26, wht: 105.26, net: 2000 });
  });

  it("B04: 10 days × 700 exclusive → gross 7,368.42, WHT 368.42, net 7,000", () => {
    const b = computeWht(10 * 700, 5, "exclusive");
    expect(b).toEqual({ gross: 7368.42, wht: 368.42, net: 7000 });
    // instalments are built on the net: 2 × 50% = 3,500 each
    expect(b.net / 2).toBe(3500);
  });

  it("no rate means no withholding", () => {
    expect(computeWht(7000, 0, "exclusive")).toEqual({ gross: 7000, wht: 0, net: 7000 });
  });

  it("net always equals gross − WHT in the base currency", () => {
    const b = whtInBase(computeWht(2000, 5, "exclusive"), 3.75);
    expect(b.gross).toBe(7894.73);
    expect(b.net).toBe(7500);
    expect(b.wht).toBe(394.73);
    expect(b.gross - b.wht).toBeCloseTo(b.net, 6);
  });

  it("rate table: exact service type, organization first, else default, else 5%", () => {
    const rules = [
      { serviceType: "default", ratePct: 5 },
      { serviceType: "royalties", ratePct: 15 },
      { serviceType: "royalties", ratePct: 12, orgSpecific: true },
    ];
    expect(resolveWhtRate(rules, "royalties")).toBe(12);
    expect(resolveWhtRate(rules, "unknown")).toBe(5);
    expect(resolveWhtRate([], null)).toBe(5);
  });
});

describe("tax residency suggestion", () => {
  it("non-Saudi with a bank outside KSA → non-resident", () => {
    expect(suggestTaxResidency({ nationality: "Egypt", bankCountry: "Egypt" })).toBe(
      "non_resident",
    );
  });
  it("non-Saudi paid into a Saudi bank → resident", () => {
    expect(suggestTaxResidency({ nationality: "Egypt", bankCountry: "Saudi Arabia" })).toBe(
      "resident",
    );
  });
  it("Saudi → resident", () => {
    expect(suggestTaxResidency({ nationality: "Saudi Arabia", bankCountry: "France" })).toBe(
      "resident",
    );
  });
});

describe("package days (B03)", () => {
  it("01/10 → 30/10 is 30 days", () => {
    expect(inclusiveDays("2026-10-01", "2026-10-30")).toBe(30);
    expect(inclusiveDays("2026-10-01", "2026-10-01")).toBe(1);
    expect(inclusiveDays("2026-10-02", "2026-10-01")).toBe(0);
  });
  it("package list row: Days 30, Daily = total ÷ 30", () => {
    const r = displayDaysAndRate({
      dealType: "package",
      shootingDays: 1,
      dailyRate: 9000,
      startDate: "2026-10-01",
      endDate: "2026-10-30",
    });
    expect(r).toEqual({ days: 30, daily: 300, total: 9000 });
  });
  it("other deal types keep their stored days and rate", () => {
    expect(displayDaysAndRate({ dealType: "daily", shootingDays: 10, dailyRate: 700 })).toEqual({
      days: 10,
      daily: 700,
      total: 7000,
    });
  });
});

describe("identity validation (E02/B26)", () => {
  it("national ID: 10 digits starting with 1", () => {
    expect(validateIdNumber("national_id", "1012345678")).toBeNull();
    expect(validateIdNumber("national_id", "2012345678")).toBe("id_national_format");
    expect(validateIdNumber("national_id", "101234567")).toBe("id_national_format");
  });
  it("iqama: 10 digits starting with 2", () => {
    expect(validateIdNumber("iqama", "2012345678")).toBeNull();
    expect(validateIdNumber("iqama", "1012345678")).toBe("id_iqama_format");
  });
  it("passport: free-form", () => {
    expect(validateIdNumber("passport", "A1234567")).toBeNull();
  });
  it("empty or 0 is refused", () => {
    expect(validateIdNumber("passport", "")).toBe("id_required");
    expect(validateIdNumber("passport", "0")).toBe("id_required");
    expect(validateIdNumber(null, "A123")).toBe("id_type_required");
  });
  it("guesses the type from the number", () => {
    expect(guessIdType("1012345678")).toBe("national_id");
    expect(guessIdType("2012345678")).toBe("iqama");
    expect(guessIdType("X99")).toBeNull();
  });
});

describe("bank validation (E02)", () => {
  it("SA IBAN: 24 chars and mod-97", () => {
    expect(validateIban("Saudi Arabia", "SA03 8000 0000 6080 1016 7519")).toBeNull();
    expect(validateIban("Saudi Arabia", "SA0380000000608010167518")).toBe("iban_checksum");
    expect(validateIban("Saudi Arabia", "SA038000000060801016751")).toBe("iban_length");
    expect(validateIban("Saudi Arabia", "AE070331234567890123456")).toBe("iban_prefix");
  });
  it("other IBAN countries use their own prefix and length", () => {
    expect(validateIban("United Kingdom", "GB82WEST12345698765432")).toBeNull();
    expect(validateIban("United Arab Emirates", "AE070331234567890123456")).toBeNull();
  });
  it("non-IBAN countries accept a local account number", () => {
    expect(validateIban("United States", "000123456789")).toBeNull();
    expect(validateIban("United States", "12")).toBe("account_format");
    expect(validateIban("United States", "")).toBe("iban_required");
  });
  it("SWIFT is required outside KSA", () => {
    expect(validateSwift("Egypt", "")).toBe("swift_required");
    expect(validateSwift("Saudi Arabia", "")).toBeNull();
    expect(validateSwift("Egypt", "NBEGEGCX")).toBeNull();
    expect(validateSwift("Egypt", "NBEGEGCX001")).toBeNull();
    expect(validateSwift("Egypt", "NBE")).toBe("swift_format");
  });
});

describe("positions", () => {
  it("maps known labels and keeps free text as Other", () => {
    expect(positionSelectValue("gaffer")).toBe("Gaffer");
    expect(positionSelectValue("F M")).toBe(POSITION_OTHER);
    expect(positionSelectValue("")).toBe("");
  });
});
