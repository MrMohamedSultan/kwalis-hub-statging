import { describe, expect, it } from "vitest";
import { planPageSlices } from "@/lib/export/element-pdf";

describe("planPageSlices (G02 dashboard PDF)", () => {
  it("one page when it fits", () => {
    expect(planPageSlices(500, 800, [100, 300])).toEqual([{ start: 0, end: 500 }]);
  });
  it("breaks between cards when one fits", () => {
    // cards end at 300, 700, 1100, 1500; a page holds 800
    expect(planPageSlices(1500, 800, [300, 700, 1100, 1500])).toEqual([
      { start: 0, end: 700 },
      { start: 700, end: 1500 },
    ]);
  });
  it("cuts at the page height when no boundary fits", () => {
    expect(planPageSlices(2000, 800, [1900])).toEqual([
      { start: 0, end: 800 },
      { start: 800, end: 1600 },
      { start: 1600, end: 2000 },
    ]);
  });
  it("ignores boundaries that would leave a nearly empty page", () => {
    expect(planPageSlices(1000, 800, [100])).toEqual([
      { start: 0, end: 800 },
      { start: 800, end: 1000 },
    ]);
  });
  it("nothing to print", () => {
    expect(planPageSlices(0, 800, [])).toEqual([]);
  });
});
