import { describe, expect, it } from "vitest";
import { invoiceE08View } from "@/lib/invoice-e08";

describe("E08 invoice fields for list rows", () => {
  it("foreign invoice shows original amount, rate and source", () => {
    const v = invoiceE08View(
      {
        currency: "usd",
        fxRate: 3.75,
        amountOriginal: 1000,
        fxRateSource: "sama",
        fxRateDate: "2026-10-01",
      },
      "SAR",
    );
    expect(v.fx).toMatch(/^USD 1,000\.00 × 3\.75/);
    expect(v.fxSource).toBe("sama");
    expect(v.fxDate).toBeTruthy();
  });
  it("base-currency invoice has no FX line", () => {
    const v = invoiceE08View({ currency: "SAR", fxRate: 1, fxRateSource: "project" });
    expect(v.fx).toBeNull();
    expect(v.fxSource).toBeNull();
  });
  it("service period, received date and related party", () => {
    const v = invoiceE08View({
      servicePeriodFrom: "2026-09-01",
      serviceReceivedDate: "2026-09-30",
      isRelatedParty: true,
      relatedPartyNote: "Owner's brother",
    });
    expect(v.servicePeriod).toMatch(/– …$/);
    expect(v.serviceReceived).toBeTruthy();
    expect(v.relatedParty).toBe(true);
    expect(v.relatedPartyNote).toBe("Owner's brother");
    expect(invoiceE08View({}).servicePeriod).toBeNull();
  });
});
