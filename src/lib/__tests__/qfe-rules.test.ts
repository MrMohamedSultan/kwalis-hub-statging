import { describe, expect, it } from "vitest";
import { explainAutoQfe } from "../qfe-rules";

const base = { serviceInsideKsa: true, description: "Camera package" };

describe("invoice QPE rules (mirror of rebate_transactions)", () => {
  it("E06: vendor without CR needs review and is NOT eligible", () => {
    const r = explainAutoQfe({ ...base, vendorNationality: null, vendorCrNo: null });
    expect(r.value).toBe(false);
    expect(r.needsReview).toBe(true);
    expect(r.reason).not.toMatch(/assumed/i);
  });
  it("Saudi vendor with CR is eligible", () => {
    expect(
      explainAutoQfe({ ...base, vendorNationality: "Saudi Arabia", vendorCrNo: "1010" }).value,
    ).toBe(true);
  });
  it("CR on file, nationality blank = KSA registration", () => {
    expect(explainAutoQfe({ ...base, vendorCrNo: "1010" }).value).toBe(true);
  });
  it("foreign vendor not eligible even with a CR", () => {
    expect(explainAutoQfe({ ...base, vendorNationality: "UAE", vendorCrNo: "AE1" }).value).toBe(
      false,
    );
  });
  it("service outside KSA never eligible", () => {
    const r = explainAutoQfe({ ...base, serviceInsideKsa: false, vendorCrNo: "1" });
    expect(r.value).toBe(false);
    expect(r.rule).toBe("C");
  });
  it("logistics follow the person: Saudi mother is eligible", () => {
    const r = explainAutoQfe({
      serviceInsideKsa: true,
      description: "Hotel nights",
      beneficiaryNationality: "Egypt",
      beneficiaryMotherSaudi: true,
    });
    expect(r.rule).toBe("A");
    expect(r.value).toBe(true);
  });
  it("logistics for a foreign person not eligible", () => {
    expect(
      explainAutoQfe({
        serviceInsideKsa: true,
        description: "Hotel nights",
        beneficiaryNationality: "Egypt",
      }).value,
    ).toBe(false);
  });
});
