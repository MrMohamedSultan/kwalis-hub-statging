import { describe, expect, it } from "vitest";
import { qpeEligibilityLabel, qpeEligibilityOf, qpeLabelForCode } from "@/lib/qpe-eligibility";

describe("QPE eligibility for budget exports (E12)", () => {
  it("only an approved mapping decides", () => {
    expect(
      qpeEligibilityOf({
        budget_code: "2101",
        qpe_category: "equipment",
        ineligible_reason: null,
        status: "approved",
      }),
    ).toBe("eligible");
    expect(
      qpeEligibilityOf({
        budget_code: "7000",
        qpe_category: null,
        ineligible_reason: "overheads",
        status: "approved",
      }),
    ).toBe("not_eligible");
    expect(
      qpeEligibilityOf({
        budget_code: "2101",
        qpe_category: "equipment",
        ineligible_reason: null,
        status: "suggested",
      }),
    ).toBe("suggested_eligible");
    expect(
      qpeEligibilityOf({
        budget_code: "1001",
        qpe_category: null,
        ineligible_reason: "development",
        status: "suggested",
      }),
    ).toBe("suggested_not");
    expect(qpeEligibilityOf(null)).toBe("unmapped");
  });
  it("labels", () => {
    expect(qpeEligibilityLabel("eligible", "equipment")).toBe("Yes (equipment)");
    expect(qpeEligibilityLabel("unmapped")).toBe("Not mapped");
    const map = new Map([
      [
        "2101",
        {
          budget_code: "2101",
          qpe_category: "equipment",
          ineligible_reason: null,
          status: "approved",
        },
      ],
    ]);
    expect(qpeLabelForCode(map, "2101")).toBe("Yes (equipment)");
    expect(qpeLabelForCode(map, "9999")).toBe("Not mapped");
    expect(qpeLabelForCode(map, "")).toBe("Not mapped");
  });
});
