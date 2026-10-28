import { describe, expect, it } from "vitest";
import {
  allocateRemittances,
  buildWhtRows,
  displayRate,
  summarizeVat,
  summarizeWht,
  vatTreatmentOf,
  whtEvents,
  zatcaWhtDueDate,
  type VatInvoice,
  type WhtDocument,
} from "@/features/reports/tax-cash/tax-cash-calc";

const doc = (o: Partial<WhtDocument>): WhtDocument => ({
  kind: "contract",
  id: "x",
  ref: "R",
  party: "P",
  residency: "non_resident",
  serviceType: null,
  treatment: "inclusive",
  base: 0,
  storedRate: null,
  storedAmount: 0,
  payBasis: 0,
  budgetCode: "2101",
  payments: [],
  ...o,
});

// The client's current data: Kais gross-up 84.21, two more contracts with WHT,
// Adel 6,500 WITHOUT WHT on his contract (the old screen taxed him 5%).
const kais = doc({
  id: "kais",
  party: "Kais",
  treatment: "exclusive",
  base: 1684.21,
  storedRate: 5,
  storedAmount: 84.21,
  payBasis: 1600,
  payments: [{ date: "2026-09-15", amount: 800 }],
});
const omar = doc({
  id: "omar",
  party: "Omar",
  base: 4000,
  storedRate: 5,
  storedAmount: 200,
  payBasis: 3800,
  payments: [
    { date: "2026-09-20", amount: 1900 },
    { date: "2026-10-20", amount: 1900 },
  ],
});
const lina = doc({ id: "lina", party: "Lina", base: 3000, storedAmount: 150, payBasis: 2850 });
const adel = doc({ id: "adel", party: "Adel", residency: null, base: 6500, storedAmount: 0, payBasis: 6500 });

describe("WHT is read from the stored fields only (R23)", () => {
  it("total = Σ contract WHT fields (434.21), Adel is not taxed", () => {
    const rows = buildWhtRows([kais, omar, lina, adel], 0, "2026-10-28");
    expect(rows.map((r) => r.party)).toEqual(["Kais", "Omar", "Lina"]);
    expect(summarizeWht(rows, 0).total).toBe(434.21);
  });
  it("rate is the stored rate, else amount ÷ base (display only)", () => {
    expect(displayRate(5, 84.21, 1684.21)).toBe(5);
    expect(displayRate(null, 150, 3000)).toBe(5);
    expect(displayRate(null, 1, 0)).toBe(0);
  });
});

describe("withholding and ZATCA due dates", () => {
  it("due by the 10th of the following month", () => {
    expect(zatcaWhtDueDate("2026-09-15")).toBe("2026-10-10");
    expect(zatcaWhtDueDate("2026-12-31")).toBe("2027-01-10");
  });
  it("WHT withheld per payment = its share of the stored WHT, capped", () => {
    expect(whtEvents(kais).map((e) => e.amount)).toEqual([42.11]);
    expect(whtEvents(omar).map((e) => e.amount)).toEqual([100, 100]);
    const over = doc({ ...omar, payments: [{ date: "2026-09-01", amount: 99999 }] });
    expect(whtEvents(over).map((e) => e.amount)).toEqual([200]);
  });
  it("remittances are allocated oldest due first", () => {
    const evs = [...whtEvents(omar), ...whtEvents(kais)];
    const a = allocateRemittances(evs, 120);
    const byKey = evs.map((e) => [e.docId, e.dueDate, a.get(e)]);
    expect(byKey).toEqual([
      ["omar", "2026-10-10", 77.89],
      ["omar", "2026-11-10", 0],
      ["kais", "2026-10-10", 42.11],
    ]);
  });
  it("status: overdue / due / pending / remitted", () => {
    const rows = buildWhtRows([kais, omar, lina], 142.11, "2026-10-28");
    const st = Object.fromEntries(rows.map((r) => [r.party, r.status]));
    // 142.11 covers Kais 42.11 + Omar Sep 100 → Omar Oct (due Nov 10) still open
    expect(st).toEqual({ Kais: "remitted", Omar: "due", Lina: "pending" });
    const late = buildWhtRows([kais], 0, "2026-10-28");
    expect(late[0].status).toBe("overdue");
    expect(late[0].dueDate).toBe("2026-10-10");
  });
});

describe("decision 12 — company-borne WHT vs line 7099", () => {
  it("only gross-up (exclusive) WHT is charged to the budget", () => {
    const rows = buildWhtRows([kais, omar, lina], 0, "2026-10-28");
    const s = summarizeWht(rows, 50);
    expect(s.companyBorne).toBe(84.21);
    expect(s.deducted).toBe(350);
    expect(s.over7099).toBe(34.21);
    // Kais's contract sits on 2101, not on 7099 — the open decision is flagged
    expect(s.companyBorneOnOtherLines).toBe(84.21);
  });
});

describe("VAT (D14): standard and exempt", () => {
  const inv = (o: Partial<VatInvoice>): VatInvoice => ({
    id: "i",
    ref: "INV",
    vendor: "V",
    date: "2026-09-01",
    treatment: "standard",
    net: 1000,
    vat: 150,
    payBasis: 1150,
    payments: [],
    ...o,
  });
  it("input VAT by payment month, pending recovery, forecast, reverse charge", () => {
    const s = summarizeVat(
      [
        inv({ id: "a", payments: [{ date: "2026-09-10", amount: 575 }, { date: "2026-10-02", amount: 575 }] }),
        inv({ id: "b", vat: 300, net: 2000, payBasis: 2300 }),
        inv({ id: "c", treatment: "exempt", vat: 0, payBasis: 500, net: 500 }),
        inv({ id: "d", treatment: "reverse_charge", vat: 0, net: 2000, date: "2026-10-05" }),
      ],
      { vatPaid: 0, vatRecovered: 75 },
      10_000,
      15,
    );
    expect(s.inputBooked).toBe(450);
    expect(s.inputPaid).toBe(150);
    expect(s.inputUnpaid).toBe(300);
    expect(s.months).toEqual([
      { month: "2026-09", inputPaid: 75, reverseCharge: 0 },
      { month: "2026-10", inputPaid: 75, reverseCharge: 300 },
    ]);
    expect(s.pendingRecovery).toBe(75);
    expect(s.forecastOnCommitments).toBe(1500);
    expect(s.exemptCount).toBe(1);
    expect(s.standardCount).toBe(2);
    expect(s.reverseCharge).toBe(300);
  });
  it("legacy vatable flag", () => {
    expect(vatTreatmentOf(null, true)).toBe("standard");
    expect(vatTreatmentOf(undefined, false)).toBe("exempt");
    expect(vatTreatmentOf("zero_rated", true)).toBe("zero_rated");
  });
});
