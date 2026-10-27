import { describe, expect, it } from "vitest";
import {
  checkInstalmentSchedule,
  instalmentAmount,
  instalmentWord,
  requestStatusWord,
} from "@/lib/instalments";

describe("instalment words (A02)", () => {
  it("maps stored statuses to the glossary", () => {
    expect(instalmentWord("Hold")).toBe("requested");
    expect(instalmentWord("Approved")).toBe("approved");
    expect(instalmentWord("Paid")).toBe("paid");
    expect(instalmentWord(undefined)).toBe("pending");
  });
  it("a rejected / cancelled request is Pending again", () => {
    expect(requestStatusWord("waiting_approval")).toBe("requested");
    expect(requestStatusWord("rejected")).toBe("pending");
    expect(requestStatusWord("cancelled")).toBe("pending");
    expect(requestStatusWord(undefined)).toBeNull();
  });
});

describe("schedule rules (A05)", () => {
  const ok = [
    { id: "a", label: "Signing", dueDate: "2026-09-01", amount: 2000, percent: 0 },
    { id: "b", label: "Wrap", dueDate: "2026-10-01", amount: null, percent: 70 },
  ];
  it("amount: flat, else percent of the base", () => {
    expect(instalmentAmount(ok[0], 6650)).toBe(2000);
    expect(instalmentAmount(ok[1], 6650)).toBe(4655);
  });
  it("a schedule that adds up to the contract passes", () => {
    const c = checkInstalmentSchedule(ok, 2000 / 0.3);
    expect(c.errors).toEqual([]);
  });
  it("Youssef: 2,000 of 6,650 is refused with the difference", () => {
    const c = checkInstalmentSchedule([ok[0]], 6650);
    expect(c.errors).toEqual([
      { kind: "sum_mismatch", total: 2000, expected: 6650, difference: 4650 },
    ]);
  });
  it("name and due date are required", () => {
    const c = checkInstalmentSchedule([{ id: "x", label: " ", dueDate: "", amount: 10 }], 10);
    expect(c.errors.map((e) => e.kind)).toEqual(["missing_label", "missing_due_date"]);
  });
  it("dates out of order are a warning only", () => {
    const c = checkInstalmentSchedule(
      [
        { id: "a", label: "A", dueDate: "2026-10-01", amount: 5 },
        { id: "b", label: "B", dueDate: "2026-09-01", amount: 5 },
      ],
      10,
    );
    expect(c.errors).toEqual([]);
    expect(c.warnings).toEqual([{ kind: "date_order", id: "b", index: 1 }]);
  });
  it("no schedule = valid (whole contract committed)", () => {
    expect(checkInstalmentSchedule([], 5000).errors).toEqual([]);
  });
});
