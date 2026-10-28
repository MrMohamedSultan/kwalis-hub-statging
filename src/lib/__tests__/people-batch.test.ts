import { describe, expect, it } from "vitest";
import {
  findDuplicatePairs,
  findSimilarPersons,
  idNumberKey,
  nameSimilarity,
  normalizeName,
} from "@/lib/person-match";
import { computeDealSummary, dealSummaryTotals } from "@/lib/deal-summary";
import { amountInBase, pickRateFor, totalInBase, type DatedRate } from "@/lib/fx-dated";

describe("person-match (E01)", () => {
  it("normalizes case, spaces and Arabic letter variants", () => {
    expect(normalizeName("  Mohammed   ABDULLAH ")).toBe("mohammed abdullah");
    expect(normalizeName("أحمد  عبدالله")).toBe(normalizeName("احمد عبداللّه"));
  });

  it("flags the client's look-alike spelling", () => {
    expect(
      nameSimilarity("Mohammed Abdullah Alajmi", "Moahmmed Abdullah AlAjami"),
    ).toBeGreaterThanOrEqual(0.85);
  });

  it("does not flag different people", () => {
    expect(nameSimilarity("Mohammed Abdullah Alajmi", "Sara Ali Hassan")).toBeLessThan(0.5);
    expect(nameSimilarity("Khalid Omar", "Khalid Nasser")).toBeLessThan(0.85);
  });

  it("ignores word order", () => {
    expect(nameSimilarity("Alajmi Mohammed", "Mohammed Alajmi")).toBe(1);
  });

  it("compares ID numbers on letters and digits only", () => {
    expect(idNumberKey(" 10 9876-5432 ")).toBe("1098765432");
    expect(idNumberKey("a1234567")).toBe("A1234567");
    expect(idNumberKey("  ")).toBeNull();
  });

  const persons = [
    { id: "p1", fullName: "Mohammed Abdullah Alajmi", idNumber: "1098765432" },
    { id: "p2", fullName: "Sara Ali", idNumber: "2087654321" },
    { id: "p3", fullName: "Moahmmed Abdullah AlAjami", idNumber: "" },
  ];

  it("same ID number comes first, then similar names", () => {
    const m = findSimilarPersons(
      { fullName: "Mohamed Abdulla Alajmi", idNumber: "2087654321" },
      persons,
    );
    expect(m[0]).toMatchObject({ reason: "same_id", person: { id: "p2" } });
    expect(
      m
        .slice(1)
        .map((x) => x.person.id)
        .sort(),
    ).toEqual(["p1", "p3"]);
  });

  it("the chosen profile is not its own duplicate", () => {
    const m = findSimilarPersons(
      { fullName: "Mohammed Abdullah Alajmi", idNumber: "1098765432" },
      persons,
      "p1",
    );
    expect(m.map((x) => x.person.id)).toEqual(["p3"]);
  });

  it("duplicate pairs skip two different ID numbers", () => {
    const pairs = findDuplicatePairs([
      ...persons,
      { id: "p4", fullName: "Mohammed Abdullah Alajmi", idNumber: "1000000001" },
    ]);
    const ids = pairs.map((p) => [p.a.id, p.b.id].sort().join("-"));
    expect(ids).toContain("p1-p3");
    expect(ids).toContain("p3-p4");
    expect(ids).not.toContain("p1-p4");
  });
});

describe("deal summary (N09)", () => {
  const rows = computeDealSummary({
    contracts: [
      { id: "c1", personId: "P", fullName: "Khalid", kind: "crew", position: "Gaffer" },
      { id: "c2", personId: "P", fullName: "Khaled", kind: "cast", character: "Guard" },
      { id: "c3", personId: null, fullName: "Unlinked", kind: "crew" },
    ],
    payroll: [
      // exclusive 5%: net 9,500 agreed → gross 10,000
      { id: "r1", refId: "c1", totalAmount: 10000, netPayable: 9500 },
      { id: "r2", refId: "c2", totalAmount: 4000, netPayable: null },
      { id: "r3", refId: "c3", totalAmount: 1000, netPayable: 1000 },
    ],
    instalments: [
      { payrollId: "r1", status: "Paid", grossAmount: 5000, netAmount: 4750 },
      { payrollId: "r1", status: "Approved", grossAmount: 3000, netAmount: 2850 },
      { payrollId: "r1", status: "Pending", grossAmount: 2000, netAmount: 1900 },
      { payrollId: "r2", status: "Hold", grossAmount: 4000, netAmount: 4000 },
    ],
    payments: [
      { sourceId: "r1", amount: 4750 },
      { sourceId: "rX", amount: 999 },
    ],
    personNames: new Map([["P", "Khalid Omar"]]),
  });

  it("one line per person with all contracts", () => {
    expect(rows).toHaveLength(2);
    const k = rows.find((r) => r.personId === "P")!;
    expect(k).toMatchObject({
      name: "Khalid Omar",
      contracts: 2,
      kinds: ["crew", "cast"],
      roles: ["Gaffer", "Guard"],
    });
  });

  it("applies the glossary", () => {
    const k = rows.find((r) => r.personId === "P")!;
    expect(k.value).toBe(14000); // gross on both contracts
    expect(k.actual).toBe(8000); // approved + paid instalments
    expect(k.commitment).toBe(6000); // value − actual
    expect(k.paid).toBe(4750); // payments ledger
    expect(k.payable).toBe(2850); // net actual 7,600 − paid 4,750
    expect(k.wht).toBe(500);
  });

  it("a contract with no profile stays its own line", () => {
    expect(rows.find((r) => r.key === "contract:c3")).toMatchObject({ contracts: 1, value: 1000 });
  });

  it("totals add up", () => {
    expect(dealSummaryTotals(rows)).toMatchObject({ contracts: 3, value: 15000, commitment: 7000 });
  });
});

describe("dated FX rates (D03)", () => {
  const settings = { baseCurrency: "SAR", rates: { USD: 3.75, EUR: 4.05 } };
  const rates: DatedRate[] = [
    { currency: "EUR", rateDate: "2026-10-01", rate: 4.1, source: "sama", sourceRef: "SAMA" },
    { currency: "EUR", rateDate: "2026-10-15", rate: 4.2, source: "bank" },
  ];

  it("takes the latest rate on or before the date, with source and date", () => {
    expect(pickRateFor(rates, "eur", "2026-10-10", settings)).toEqual({
      rate: 4.1,
      source: "sama",
      rateDate: "2026-10-01",
      sourceRef: "SAMA",
    });
    expect(pickRateFor(rates, "EUR", "2026-10-31", settings)?.rate).toBe(4.2);
  });

  it("falls back to the project rate (no date) and never guesses", () => {
    expect(pickRateFor(rates, "EUR", "2026-09-01", settings)).toEqual({
      rate: 4.05,
      source: "project",
      rateDate: null,
    });
    expect(pickRateFor(rates, "USD", "2026-10-10", settings)?.source).toBe("project");
    expect(pickRateFor(rates, "GBP", "2026-10-10", settings)).toBeNull();
    expect(pickRateFor(rates, "SAR", "2026-10-10", settings)).toEqual({
      rate: 1,
      source: null,
      rateDate: null,
    });
  });

  it("SAR totals of a USD and a EUR expense", () => {
    expect(amountInBase(1000, 3.75)).toBe(3750);
    expect(amountInBase(333.33, 4.1)).toBe(1366.65);
    expect(
      totalInBase([
        { amount: 1000, rate: 3.75 },
        { amount: 1000, rate: 4.1 },
        { amount: 250, rate: 1 },
      ]),
    ).toBe(8100);
  });
});
