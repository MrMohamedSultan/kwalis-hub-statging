import { describe, expect, it } from "vitest";
import { countShootDays, wasPostponed } from "../shoot-schedule";

const days = [
  { shoot_date: "2026-06-10", status: "shot" as const },
  { shoot_date: "2026-06-10", status: "planned" as const }, // second unit, same day
  { shoot_date: "2026-06-11", status: "cancelled" as const },
  { shoot_date: "2026-06-20", status: "planned" as const },
  { shoot_date: "2026-07-01", status: "postponed" as const },
];

describe("countShootDays", () => {
  it("counts distinct active dates", () => {
    expect(countShootDays(days)).toBe(2);
  });
  it("respects the range", () => {
    expect(countShootDays(days, "2026-06-11", "2026-06-30")).toBe(1);
    expect(countShootDays(days, null, "2026-06-10")).toBe(1);
  });
});

describe("wasPostponed", () => {
  it("compares with the first date", () => {
    expect(wasPostponed({ shoot_date: "2026-06-20", original_date: "2026-06-12" })).toBe(true);
    expect(wasPostponed({ shoot_date: "2026-06-20", original_date: "2026-06-20" })).toBe(false);
    expect(wasPostponed({ shoot_date: "2026-06-20", original_date: null })).toBe(false);
  });
});
