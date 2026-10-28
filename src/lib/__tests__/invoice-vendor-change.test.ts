import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { invoiceVendorChangePatch } from "@/components/ap/VendorProfileFields";
import type { Vendor } from "@/lib/store";

const vendor = {
  id: "v2",
  name: "Gulf Lights",
  crNo: " 101 ",
  vatNo: "300",
  companyNationality: "Saudi Arabia",
  taxResidency: "resident",
  bankCountry: "SA",
  bankName: "SNB",
  relatedParty: true,
  relatedPartyNote: "Owner's brother",
} as unknown as Vendor;

describe("invoice edit: vendor change re-inherits the vendor profile (E05)", () => {
  it("takes the new vendor's snapshot fields and related-party flag", () => {
    const { patch, whtDiffers } = invoiceVendorChangePatch(
      { vendorName: "Old", isNonSaudiVendor: false },
      vendor,
      true,
    );
    expect(patch).toMatchObject({
      vendorName: "Gulf Lights",
      vendorId: "v2",
      vendorCrNo: "101",
      vendorVatNo: "300",
      vendorTaxResidency: "resident",
      vendorBankName: "SNB",
      isRelatedParty: true,
      relatedPartyNote: "Owner's brother",
    });
    expect("isNonSaudiVendor" in patch).toBe(false);
    expect(whtDiffers).toBe(false);
  });
  it("flags a WHT difference instead of changing the saved WHT", () => {
    const { patch, whtDiffers } = invoiceVendorChangePatch(
      { vendorName: "Old", isNonSaudiVendor: false },
      { ...vendor, taxResidency: "non_resident" } as Vendor,
      true,
    );
    expect(whtDiffers).toBe(true);
    expect("isNonSaudiVendor" in patch).toBe(false);
  });
  it("without db/pending/190 only the name and related-party flag change", () => {
    const { patch } = invoiceVendorChangePatch({ vendorName: "Old" }, vendor, false);
    expect(Object.keys(patch).sort()).toEqual(["isRelatedParty", "relatedPartyNote", "vendorName"]);
  });
});
