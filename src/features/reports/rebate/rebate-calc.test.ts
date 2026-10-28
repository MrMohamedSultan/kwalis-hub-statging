import { describe, expect, it } from "vitest";
import {
  countWorkingDays,
  defaultOffDays,
  formRows,
  paidQpeBase,
  periodPosition,
  qpeVariance,
  rebateAmount,
  sumBy,
} from "./rebate-calc";

describe("rebateAmount = least(rate × QPE, cap)", () => {
  it("applies the rate under the cap", () => {
    expect(rebateAmount(40, 100_000, 50_000)).toBe(40_000);
  });
  it("is capped", () => {
    expect(rebateAmount(40, 200_000, 50_000)).toBe(50_000);
  });
  it("no cap = rate only", () => {
    expect(rebateAmount(35, 1_000, null)).toBe(350);
  });
  it("no rate = not configured", () => {
    expect(rebateAmount(null, 1_000, 10)).toBeNull();
  });
  it("never negative", () => {
    expect(rebateAmount(40, -10, null)).toBe(0);
  });
  it("matches the DB fixture (70,600 × 40%)", () => {
    expect(rebateAmount(40, 70_600, 50_000)).toBe(28_240);
  });
});

describe("paidQpeBase", () => {
  it("removes VAT from a paid invoice", () => {
    expect(paidQpeBase(20_000, 23_000, 23_000)).toBe(20_000);
  });
  it("partial payment is pro-rata", () => {
    expect(paidQpeBase(20_000, 11_500, 23_000)).toBe(10_000);
  });
  it("never more than the base", () => {
    expect(paidQpeBase(100, 500, 100)).toBe(100);
  });
  it("nothing paid", () => {
    expect(paidQpeBase(100, 0, 100)).toBe(0);
  });
});

describe("countWorkingDays", () => {
  it("June 2026 with Fri+Sat off = 22", () => {
    expect(countWorkingDays("2026-06-01", "2026-06-30", [5, 6])).toBe(22);
  });
  it("6-day week (Fri off)", () => {
    expect(countWorkingDays("2026-06-01", "2026-06-07", [5])).toBe(6);
  });
  it("invalid range", () => {
    expect(countWorkingDays("2026-06-07", "2026-06-01", [5])).toBe(0);
    expect(countWorkingDays(null, "2026-06-01", [5])).toBe(0);
  });
});

describe("periodPosition", () => {
  const pf = "2026-06-01";
  const pt = "2026-12-31";
  it("inside / partial / outside / unknown", () => {
    expect(periodPosition("2026-06-02", "2026-06-03", pf, pt)).toBe("inside");
    expect(periodPosition("2026-05-02", "2026-06-03", pf, pt)).toBe("partial");
    expect(periodPosition("2025-05-02", "2025-06-03", pf, pt)).toBe("outside");
    expect(periodPosition("2026-06-02", "2026-06-03", null, pt)).toBe("unknown");
  });
  it("a single date", () => {
    expect(periodPosition("2026-07-01", null, pf, pt)).toBe("inside");
  });
  it("flags a 968-day contract as partial", () => {
    expect(periodPosition("2024-01-01", "2026-08-26", pf, pt)).toBe("partial");
  });
});

describe("helpers", () => {
  it("variance sign: positive = saving", () => {
    expect(qpeVariance(80_000, 76_600)).toBe(3_400);
    expect(qpeVariance(10, 15)).toBe(-5);
  });
  it("default off days", () => {
    expect(defaultOffDays(5)).toEqual([5, 6]);
    expect(defaultOffDays(6)).toEqual([5]);
    expect(defaultOffDays(7)).toEqual([]);
  });
  it("form rows keep eligible only", () => {
    const rows = [{ status: "eligible" as const }, { status: "needs_review" as const }];
    expect(formRows(rows)).toHaveLength(1);
    expect(formRows(rows, true)).toHaveLength(2);
  });
  it("sumBy rounds to the halala", () => {
    expect(sumBy([{ v: 0.1 }, { v: 0.2 }], (r) => r.v)).toBe(0.3);
  });
});
