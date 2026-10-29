import { describe, expect, it } from "vitest";
import { canReversePaidRequest } from "@/lib/payment-requests";

const paid = {
  status: "paid" as const,
  reversed_at: null,
  payroll_milestone_id: null,
  source_type: "invoice" as const,
};

describe("canReversePaidRequest (X08)", () => {
  it("org admin, paid, not yet reversed", () => {
    expect(canReversePaidRequest(paid, true)).toBe(true);
    expect(canReversePaidRequest({ ...paid, source_type: "purchase_order" as any }, true)).toBe(
      true,
    );
  });
  it("not for others / other states / instalments / twice", () => {
    expect(canReversePaidRequest(paid, false)).toBe(false);
    expect(canReversePaidRequest({ ...paid, status: "approved" as any }, true)).toBe(false);
    expect(canReversePaidRequest({ ...paid, payroll_milestone_id: "m1" }, true)).toBe(false);
    expect(canReversePaidRequest({ ...paid, source_type: "payroll_row" as any }, true)).toBe(false);
    expect(canReversePaidRequest({ ...paid, reversed_at: "2026-10-29" }, true)).toBe(false);
  });
});
