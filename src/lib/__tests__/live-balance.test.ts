import { describe, expect, it } from "vitest";
import {
  calendarDays,
  computeLiveBalance,
  departmentCode,
  groupLiveBalance,
  monthsBetween,
  paidOnValueBasis,
  suggestAccrualMethod,
  workingDays,
  type LiveBalanceInput,
} from "@/features/reports/live-balance/live-balance";

const base: LiveBalanceInput = {
  id: "c1",
  ref: "MON26-CRW-0001",
  party: "Kais",
  budgetCode: "2101",
  value: 10_000,
  method: "package",
  start: "2026-10-01",
  end: "2026-10-10",
  paid: 0,
};

describe("day counting", () => {
  it("counts calendar days inclusive", () => {
    expect(calendarDays("2026-10-01", "2026-10-10")).toBe(10);
    expect(calendarDays("2026-10-10", "2026-10-01")).toBe(0);
  });
  it("counts Saudi working days (Fri/Sat off)", () => {
    // 2026-10-01 is a Thursday; Oct 1–10: Thu, (Fri, Sat), Sun–Thu, (Fri, Sat) = 6
    expect(workingDays("2026-10-01", "2026-10-10")).toBe(6);
    expect(workingDays("2026-10-04", "2026-10-08")).toBe(5);
  });
  it("counts months by the days of each month", () => {
    expect(monthsBetween("2026-10-01", "2026-10-31")).toBe(1);
    expect(monthsBetween("2026-10-16", "2026-11-15")).toBeCloseTo(16 / 31 + 15 / 30, 10);
  });
});

describe("suggested accrual method (decision 16)", () => {
  it("maps deal types", () => {
    expect(suggestAccrualMethod("daily")).toBe("work_days");
    expect(suggestAccrualMethod("weekly")).toBe("weekly");
    expect(suggestAccrualMethod("package")).toBe("package");
    expect(suggestAccrualMethod(undefined)).toBe("package");
  });
});

describe("computeLiveBalance", () => {
  it("package: evenly over calendar days", () => {
    const r = computeLiveBalance(base, "2026-10-04");
    expect(r.totalDays).toBe(10);
    expect(r.elapsedDays).toBe(4);
    expect(r.incurred).toBe(4000);
    expect(r.accrued).toBe(4000);
    expect(r.prepaid).toBe(0);
    expect(r.remainingCommitment).toBe(6000);
  });

  it("paid ahead of the work is Prepaid", () => {
    const r = computeLiveBalance({ ...base, paid: 5000 }, "2026-10-02");
    expect(r.incurred).toBe(2000);
    expect(r.balance).toBe(-3000);
    expect(r.prepaid).toBe(3000);
    expect(r.accrued).toBe(0);
  });

  it("daily deal (D11): incurred follows the working days actually elapsed", () => {
    const r = computeLiveBalance({ ...base, method: "work_days", value: 6000 }, "2026-10-05");
    // working days Oct 1 (Thu), 4 (Sun), 5 (Mon) = 3 of 6
    expect(r.totalDays).toBe(6);
    expect(r.elapsedDays).toBe(3);
    expect(r.incurred).toBe(3000);
  });

  it("weekly: week rate over working days", () => {
    const r = computeLiveBalance({ ...base, method: "weekly", value: 6000 }, "2026-10-01");
    expect(r.incurred).toBe(1000);
  });

  it("monthly: by days of the month", () => {
    const r = computeLiveBalance(
      { ...base, method: "monthly", value: 2000, start: "2026-10-01", end: "2026-11-30" },
      "2026-10-31",
    );
    expect(r.incurred).toBe(1000);
  });

  it("one-off: the whole value on the delivery day", () => {
    const r1 = computeLiveBalance({ ...base, method: "one_off" }, "2026-10-09");
    const r2 = computeLiveBalance({ ...base, method: "one_off" }, "2026-10-10");
    expect(r1.incurred).toBe(0);
    expect(r2.incurred).toBe(10_000);
  });

  it("shoot days from the shooting schedule", () => {
    const dates = ["2026-09-30", "2026-10-02", "2026-10-03", "2026-10-07", "2026-10-09"];
    const r = computeLiveBalance({ ...base, method: "shoot_days" }, "2026-10-05", { dates });
    expect(r.totalDays).toBe(4); // Sep 30 is outside the contract
    expect(r.elapsedDays).toBe(2);
    expect(r.incurred).toBe(5000);
    expect(r.estimated).toBe(false);
  });

  it("shoot days without a schedule: estimated over the calendar period", () => {
    const r = computeLiveBalance({ ...base, method: "shoot_days" }, "2026-10-05", {
      dates: null,
      fallbackDays: 4,
    });
    expect(r.estimated).toBe(true);
    expect(r.totalDays).toBe(4);
    expect(r.elapsedDays).toBe(2);
    expect(r.incurred).toBe(5000);
  });

  it("never above the contract value and stops at the end", () => {
    const r = computeLiveBalance(base, "2027-01-01");
    expect(r.incurred).toBe(10_000);
    expect(r.remainingCommitment).toBe(0);
  });

  it("stops at cancellation; no commitment left", () => {
    const r = computeLiveBalance({ ...base, cancelledAt: "2026-10-03T12:00:00Z" }, "2026-10-08");
    expect(r.elapsedDays).toBe(3);
    expect(r.incurred).toBe(3000);
    expect(r.remainingCommitment).toBe(0);
  });

  it("before the start nothing is incurred; missing dates incur nothing", () => {
    expect(computeLiveBalance(base, "2026-09-30").incurred).toBe(0);
    const r = computeLiveBalance({ ...base, start: null }, "2026-10-05");
    expect(r.missingDates).toBe(true);
    expect(r.incurred).toBe(0);
  });
});

describe("helpers", () => {
  it("grosses paid net up to the contract-value basis", () => {
    // Kais: gross 1,684.21, net 1,600 → 800 net paid = 842.11 of the contract value
    expect(paidOnValueBasis(800, 1684.21, 1600)).toBe(842.11);
    expect(paidOnValueBasis(800, 1000, null)).toBe(800);
  });
  it("department = header account", () => {
    expect(departmentCode("2101")).toBe("2100");
    expect(departmentCode(null)).toBeNull();
  });
  it("groups and sums", () => {
    const rows = [
      computeLiveBalance(base, "2026-10-04"),
      computeLiveBalance({ ...base, id: "c2", budgetCode: "2102", party: "Ali" }, "2026-10-04"),
      computeLiveBalance({ ...base, id: "c3", budgetCode: null, party: "kais" }, "2026-10-04"),
    ];
    const byDept = groupLiveBalance(rows, "department", { none: "All", unassigned: "—" });
    expect(byDept.map((g) => [g.key, g.incurred])).toEqual([
      ["2100", 8000],
      ["", 4000],
    ]);
    const byVendor = groupLiveBalance(rows, "vendor", { none: "All", unassigned: "—" });
    expect(byVendor.find((g) => g.key === "kais")?.rows.length).toBe(2);
  });
});
