import { describe, expect, it } from "vitest";
import { computeWht } from "@/lib/contract-terms";
import {
  companyBorneWht,
  lineShareOfContract,
  splitCompanyWht,
  WHT_BUDGET_CODE,
} from "@/lib/company-wht";
import { KSA_REGIONS, normalizeKsaRegion, regionSlug } from "@/lib/ksa-regions";
import { whtServiceLabel } from "@/lib/wht-rates";
import { invoiceCounts, invoicedOnPo, poOpenCommitment } from "@/lib/budget-position";
import { decision12Inputs, computeLiveBalance } from "@/features/reports/live-balance/live-balance";

describe("decision 12 — company-borne WHT on 7099 (B04)", () => {
  const b04 = computeWht(7000, 5, "exclusive");

  it("B04 gross-up: 7,000 net → 7,368.42 gross, 368.42 WHT", () => {
    expect(b04).toEqual({ gross: 7368.42, wht: 368.42, net: 7000 });
    expect(companyBorneWht("exclusive", b04.gross, b04.net)).toBe(368.42);
  });

  it("the contract line carries the net, inclusive keeps the gross", () => {
    expect(lineShareOfContract(b04, "exclusive")).toBe(7000);
    const inc = computeWht(2000, 5, "inclusive");
    expect(lineShareOfContract(inc, "inclusive")).toBe(2000);
    expect(companyBorneWht("inclusive", inc.gross, inc.net)).toBe(0);
    expect(WHT_BUDGET_CODE).toBe("7099");
  });

  it("split of Actual / Commitment matches the database (payroll_company_wht_split)", () => {
    expect(splitCompanyWht(0, 7368.42, 7000, "exclusive")).toEqual({
      lineActual: 0,
      whtActual: 0,
      lineCommitment: 7000,
      whtCommitment: 368.42,
    });
    expect(splitCompanyWht(3684.21, 7368.42, 7000, "exclusive")).toEqual({
      lineActual: 3500,
      whtActual: 184.21,
      lineCommitment: 3500,
      whtCommitment: 184.21,
    });
    const full = splitCompanyWht(7368.42, 7368.42, 7000, "exclusive");
    expect(full.lineActual + full.lineCommitment).toBe(7000);
    expect(full.whtActual + full.whtCommitment).toBe(368.42);
    expect(splitCompanyWht(1000, 2000, 1900, "inclusive")).toEqual({
      lineActual: 1000,
      whtActual: 0,
      lineCommitment: 1000,
      whtCommitment: 0,
    });
  });

  it("Live Balance: an exclusive contract is a net line row + a 7099 row, same totals", () => {
    const base = {
      id: "c1",
      ref: "CST-1",
      party: "B04 Actor",
      budgetCode: "1403",
      method: "package" as const,
      start: "2026-10-01",
      end: "2026-10-10",
      cancelledAt: null,
    };
    const rows = decision12Inputs(base, 7368.42, 7000, "exclusive", 3500);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ budgetCode: "1403", value: 7000, paid: 3500 });
    expect(rows[1]).toMatchObject({
      id: "c1:wht",
      budgetCode: "7099",
      value: 368.42,
      paid: 184.21,
      whtShare: true,
    });
    const live = rows.map((r) => computeLiveBalance(r, "2026-10-10"));
    expect(live.reduce((a, r) => a + r.incurred, 0)).toBeCloseTo(7368.42, 2);
    expect(decision12Inputs(base, 2000, 1900, "inclusive", 950)).toEqual([
      { ...base, value: 2000, paid: 1000 },
    ]);
  });
});

describe("invoice approval (db/pending/201)", () => {
  it("approved = Actual, pending = Commitment, rejected / cancelled = neither", () => {
    expect(invoiceCounts({ approvalStatus: "approved" })).toBe("actual");
    expect(invoiceCounts({ approvalStatus: "pending" })).toBe("commitment");
    expect(invoiceCounts({ approvalStatus: "rejected" })).toBeNull();
    expect(invoiceCounts({ approvalStatus: "cancelled" })).toBeNull();
    expect(invoiceCounts({})).toBe("actual"); // saved before 201
  });

  it("a rejected invoice no longer reduces its PO", () => {
    const po = { id: "po1", amount: 5000, status: "approved" };
    const inv = [
      { price: 2000, purchaseOrderId: "po1", approvalStatus: "rejected" as const },
      { price: 1000, purchaseOrderId: "po1", approvalStatus: "pending" as const },
    ];
    expect(invoicedOnPo("po1", inv)).toBe(1000);
    expect(poOpenCommitment(po, inv)).toBe(4000);
  });
});

describe("KSA regions", () => {
  it("13 regions, cities and Arabic names normalised", () => {
    expect(KSA_REGIONS).toHaveLength(13);
    expect(normalizeKsaRegion("Jeddah")).toBe("Makkah");
    expect(normalizeKsaRegion(" AlUla ")).toBe("Madinah");
    expect(normalizeKsaRegion("الرياض")).toBe("Riyadh");
    expect(normalizeKsaRegion("Ha'il")).toBe("Hail");
    expect(normalizeKsaRegion("eastern-province")).toBe("Eastern Province");
    expect(normalizeKsaRegion("Paris")).toBeNull();
    expect(normalizeKsaRegion("")).toBeNull();
    expect(regionSlug("Eastern Province")).toBe("eastern_province");
  });
});

describe("WHT service labels", () => {
  const t = (k: string) => `T:${k}`;
  it("seeded types are translated, admin rows use their own label", () => {
    expect(whtServiceLabel("royalties", "en", null, t)).toBe(
      "T:decisions.wht.service_types.royalties",
    );
    expect(
      whtServiceLabel(
        "film_rights",
        "ar",
        { label_en: "Film rights", label_ar: "حقوق الأفلام" },
        t,
      ),
    ).toBe("حقوق الأفلام");
    expect(whtServiceLabel("x_custom", "en", null, t)).toBe("x_custom");
  });
});
