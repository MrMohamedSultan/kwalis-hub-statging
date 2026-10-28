// N02 / E10: invoices and POs with a service period, and the project's working week.
import { describe, expect, it } from "vitest";
import {
  computeLiveBalance,
  serviceAccrualInputs,
  weekendFromSettings,
  type ServiceInvoice,
  type ServicePo,
} from "@/features/reports/live-balance/live-balance";
import { resolveVatRate } from "@/lib/ap-data";

describe("weekendFromSettings", () => {
  it("uses the project's off days and falls back to Fri + Sat", () => {
    expect(weekendFromSettings({ weekly_off_days: [6, 0] })).toEqual([0, 6]);
    expect(weekendFromSettings(null)).toEqual([5, 6]);
    expect(weekendFromSettings({ weekly_off_days: [0, 1, 2, 3, 4, 5, 6] })).toEqual([5, 6]);
  });
  it("changes the working-day spread of a daily contract", () => {
    const c = {
      id: "c",
      ref: "R",
      party: "P",
      budgetCode: null,
      value: 1000,
      method: "work_days" as const,
      start: "2026-10-04", // Sunday
      end: "2026-10-10", // Saturday
      paid: 0,
    };
    // KSA: Sun–Thu = 5 days, as of Tue = 3 of 5
    expect(computeLiveBalance(c, "2026-10-06").incurred).toBe(600);
    // Sat + Sun off: Mon–Fri = 5 days, as of Tue = 2 of 5
    expect(computeLiveBalance(c, "2026-10-06", { dates: null }, { weekend: [0, 6] }).incurred).toBe(
      400,
    );
  });
});

describe("serviceAccrualInputs", () => {
  const po: ServicePo = {
    id: "po1",
    ref: "PO-1",
    party: "Rentals Co",
    budgetCode: "2101",
    amount: 10000,
    status: "Approved",
    from: "2026-10-01",
    to: "2026-10-10",
  };
  const inv = (o: Partial<ServiceInvoice>): ServiceInvoice => ({
    id: "i1",
    ref: "INV-1",
    party: "Rentals Co",
    budgetCode: "2101",
    net: 4000,
    due: 4400,
    from: null,
    to: null,
    purchaseOrderId: "po1",
    ...o,
  });
  it("accrues the PO remainder and lets the invoice inherit the PO period", () => {
    const rows = serviceAccrualInputs([inv({})], [po], (k) => (k === "invoice" ? 2200 : 0));
    const i = rows.find((r) => r.source === "invoice")!;
    const p = rows.find((r) => r.source === "po")!;
    expect(i.start).toBe("2026-10-01");
    expect(i.value).toBe(4000);
    expect(i.paid).toBe(2000); // 2,200 paid incl. VAT − WHT → 2,000 on the excl.-VAT basis
    expect(p.value).toBe(6000);
    // evenly over 10 calendar days: as of day 5 → half
    expect(computeLiveBalance(p, "2026-10-05").incurred).toBe(3000);
  });
  it("skips invoices without any period and POs that are not commitments", () => {
    const rows = serviceAccrualInputs(
      [inv({ purchaseOrderId: null })],
      [{ ...po, status: "Cancelled" }],
      () => 0,
    );
    expect(rows).toEqual([]);
  });
  it("uses a one-sided period as a single day", () => {
    const rows = serviceAccrualInputs(
      [inv({ purchaseOrderId: null, to: "2026-10-03" })],
      [],
      () => 0,
    );
    expect([rows[0].start, rows[0].end]).toEqual(["2026-10-03", "2026-10-03"]);
  });
});

describe("resolveVatRate (E10)", () => {
  it("prefers the project rate, then the platform, then 15", () => {
    expect(resolveVatRate(5, 15)).toBe(5);
    expect(resolveVatRate(0, 15)).toBe(0);
    expect(resolveVatRate(null, "14")).toBe(14);
    expect(resolveVatRate(null, null)).toBe(15);
    expect(resolveVatRate(150, "x")).toBe(15);
  });
});
