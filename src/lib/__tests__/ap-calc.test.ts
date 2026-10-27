import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  defaultGlCodeForBudgetCode,
  deriveGlAccountId,
  dueDateFromTerms,
  expectedVat,
  invoiceAmountDue,
  invoiceGrossTotal,
  matchInvoiceToPo,
  normalizeVatTreatment,
  paymentTermDays,
  rentalDays,
  rentalTotal,
  stayNights,
  stayTotal,
  toBaseAmount,
  vatWithinTolerance,
} from "@/lib/ap-calc";

describe("VAT (E07)", () => {
  it("standard rate comes from the setting", () => {
    expect(expectedVat(1000, "standard", 15)).toBe(150);
    expect(expectedVat(1000, "standard", 5)).toBe(50);
  });
  it("zero-rated, exempt and reverse charge carry no vendor VAT", () => {
    expect(expectedVat(1000, "zero_rated", 15)).toBe(0);
    expect(expectedVat(1000, "exempt", 15)).toBe(0);
    expect(expectedVat(1000, "reverse_charge", 15)).toBe(0);
  });
  it("accepts a rounding difference against the original invoice", () => {
    expect(vatWithinTolerance(1500.01, expectedVat(10000, "standard", 15))).toBe(true);
    expect(vatWithinTolerance(1501, 1500)).toBe(true);
    expect(vatWithinTolerance(1510, 1500)).toBe(false);
  });
  it("legacy rows map from the vatable flag", () => {
    expect(normalizeVatTreatment(null, true)).toBe("standard");
    expect(normalizeVatTreatment(undefined, false)).toBe("exempt");
    expect(normalizeVatTreatment("reverse_charge", true)).toBe("reverse_charge");
    expect(normalizeVatTreatment("bogus", true)).toBe("standard");
  });
});

describe("invoice totals (B06 B16)", () => {
  it("payment request and status use the amount incl. VAT", () => {
    expect(invoiceGrossTotal({ price: 1000, vatAmount: 150 })).toBe(1150);
    expect(invoiceAmountDue({ price: 1000, vatAmount: 150 })).toBe(1150);
  });
  it("withholding tax is not paid to the vendor", () => {
    expect(invoiceAmountDue({ price: 1000, vatAmount: 0, whtAmount: 50 })).toBe(950);
  });
});

describe("due date from payment terms (B15)", () => {
  it("parses terms", () => {
    expect(paymentTermDays("Net 30")).toBe(30);
    expect(paymentTermDays("Net 15")).toBe(15);
    expect(paymentTermDays("Advance")).toBe(0);
    expect(paymentTermDays("")).toBeNull();
    expect(paymentTermDays("whenever")).toBeNull();
  });
  it("05/10/2026 + Net 30 = 04/11/2026", () => {
    expect(dueDateFromTerms("2026-10-05", "Net 30")).toBe("2026-11-04");
  });
  it("unknown terms fall back to the invoice date", () => {
    expect(dueDateFromTerms("2026-10-05", null)).toBe("2026-10-05");
  });
  it("crosses month / year ends", () => {
    expect(addDaysIso("2026-12-20", 15)).toBe("2027-01-04");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("bad", 1)).toBe("");
  });
});

describe("currency (B09)", () => {
  it("converts to the record currency", () => {
    expect(toBaseAmount(1000, 3.75)).toBe(3750);
    expect(toBaseAmount(1000, 1)).toBe(1000);
    expect(toBaseAmount(100.005, 1)).toBe(100.01);
  });
  it("an invalid rate never zeroes the amount", () => {
    expect(toBaseAmount(1000, 0)).toBe(1000);
    expect(toBaseAmount(1000, Number.NaN)).toBe(1000);
  });
});

describe("PO match (X12)", () => {
  it("exact match", () => {
    expect(matchInvoiceToPo(1000, 0, 1000)).toEqual({
      openBefore: 1000,
      difference: 0,
      status: "match",
    });
  });
  it("warns when the invoice differs from the PO", () => {
    expect(matchInvoiceToPo(1000, 0, 1200).status).toBe("over");
    expect(matchInvoiceToPo(1000, 0, 800)).toEqual({
      openBefore: 1000,
      difference: -200,
      status: "under",
    });
  });
  it("counts earlier invoices on the same PO", () => {
    expect(matchInvoiceToPo(1000, 600, 400).status).toBe("match");
    expect(matchInvoiceToPo(1000, 1200, 100)).toEqual({
      openBefore: 0,
      difference: 100,
      status: "over",
    });
  });
});

describe("GL account from budget code (E09)", () => {
  const accounts = [
    { id: "a1", code: "GL-1000" },
    { id: "a2", code: "GL-1300" },
    { id: "a3", code: "GL-4400" },
    { id: "a4", code: "GL-2600", isActive: false },
  ];
  it("maps budget code ranges", () => {
    expect(defaultGlCodeForBudgetCode("1101")).toBe("GL-1000");
    expect(defaultGlCodeForBudgetCode("1403")).toBe("GL-1300");
    expect(defaultGlCodeForBudgetCode("3601")).toBe("GL-2600");
    expect(defaultGlCodeForBudgetCode("6101")).toBe("GL-3100");
    expect(defaultGlCodeForBudgetCode("7201")).toBe("GL-4000");
    expect(defaultGlCodeForBudgetCode("")).toBe("GL-4400");
  });
  it("explicit mapping wins, never empty", () => {
    expect(deriveGlAccountId("1403", accounts, "mapped")).toBe("mapped");
    expect(deriveGlAccountId("1403", accounts)).toBe("a2");
    expect(deriveGlAccountId("3601", accounts)).toBe("a3"); // inactive target -> catch-all
    expect(deriveGlAccountId("", accounts)).toBeNull();
  });
});

describe("car rental / accommodation totals (B20)", () => {
  it("car 10 days x 300 = 3,000", () => {
    expect(rentalDays("2026-10-01", "2026-10-10")).toBe(10);
    expect(
      rentalTotal({
        rate_type: "daily",
        daily_rate: 300,
        monthly_rate: 0,
        rental_start_date: "2026-10-01",
        rental_end_date: "2026-10-10",
      }),
    ).toBe(3000);
  });
  it("monthly rate prorates by 30 days", () => {
    expect(
      rentalTotal({
        rate_type: "monthly",
        daily_rate: 0,
        monthly_rate: 9000,
        rental_start_date: "2026-10-01",
        rental_end_date: "2026-10-15",
      }),
    ).toBe(4500);
  });
  it("hotel 10 nights x 500 = 5,000", () => {
    expect(stayNights("2026-10-01", "2026-10-11")).toBe(10);
    expect(stayTotal(10, 500)).toBe(5000);
  });
  it("missing or reversed dates give 0", () => {
    expect(stayNights("2026-10-11", "2026-10-01")).toBe(0);
    expect(rentalDays("", "2026-10-01")).toBe(0);
  });
});
