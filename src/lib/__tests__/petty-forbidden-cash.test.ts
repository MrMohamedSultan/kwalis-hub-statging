// N08: cash in categories the Film Commission never accepts in cash; QPE base from 197.
import { describe, expect, it } from "vitest";
import { forbiddenCashAlerts, qpeTotal, type RebateTxLite } from "@/lib/payables-reports";

const tx = (o: Partial<RebateTxLite>): RebateTxLite => ({
  source: "petty_cash",
  source_id: "r1",
  ref_no: "PC-1",
  party: "Hotel",
  entry_date: "2026-10-01",
  qpe_category: "accommodation",
  status: "eligible",
  amount_excl_vat: 1000,
  cash_paid: 1000,
  ...o,
});
const cats = [
  { code: "accommodation", label_en: "Accommodation", label_ar: "السكن", cash_forbidden: true },
  { code: "catering", label_en: "Catering", label_ar: "الإعاشة", cash_forbidden: false },
];

describe("forbiddenCashAlerts", () => {
  it("flags cash in forbidden categories and wages, not allowed cash spend", () => {
    const out = forbiddenCashAlerts(
      [
        tx({}),
        tx({ source_id: "r2", qpe_category: "catering" }),
        tx({ source: "payroll", source_id: "p1", qpe_category: null, cash_paid: 3000 }),
        tx({ source_id: "r3", cash_paid: 0 }),
      ],
      cats,
    );
    expect(out.map((a) => a.sourceId)).toEqual(["p1", "r1"]);
  });
});

describe("qpeTotal", () => {
  it("adds the eligible spend excl. VAT only", () => {
    expect(
      qpeTotal([
        tx({}),
        tx({ status: "needs_review", amount_excl_vat: 5 }),
        tx({ amount_excl_vat: 0.1 }),
      ]),
    ).toBe(1000.1);
  });
});
