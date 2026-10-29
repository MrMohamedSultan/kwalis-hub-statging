import { describe, expect, it } from "vitest";
import {
  canReversePaidRequest,
  ReasonSchema,
  RefundReferenceSchema,
  sumCommittedForSource,
  sumPaidForSource,
} from "@/lib/payment-requests";

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

describe("reversal maker-checker and reversed sums (db/pending/204)", () => {
  it("an admin who requested, approved or paid it cannot reverse it; a super admin can", () => {
    for (const k of ["requested_by", "approved_by", "executed_by"] as const) {
      const r = { ...paid, [k]: "u1" };
      expect(canReversePaidRequest(r, true, { userId: "u1" })).toBe(false);
      expect(canReversePaidRequest(r, true, { userId: "u2" })).toBe(true);
      expect(canReversePaidRequest(r, true, { userId: "u1", isSuperAdmin: true })).toBe(true);
    }
  });
  it("a reversed request counts neither as paid nor as committed", () => {
    const base = {
      source_type: "invoice" as const,
      source_id: "i1",
      requested_amount: 100,
      status: "paid" as const,
    };
    const rows = [
      { ...base, reversed_at: "2026-10-29" },
      { ...base, requested_amount: 40, reversed_at: null },
      { ...base, requested_amount: 10, status: "approved" as const, reversed_at: null },
    ] as any[];
    expect(sumPaidForSource(rows, "invoice", "i1")).toBe(40);
    expect(sumCommittedForSource(rows, "invoice", "i1")).toBe(50);
  });
  it("reason and refund reference follow the database bounds", () => {
    expect(ReasonSchema.safeParse("  ab ").success).toBe(false);
    expect(ReasonSchema.safeParse(" Vendor refunded ").data).toBe("Vendor refunded");
    expect(ReasonSchema.safeParse("x".repeat(1001)).success).toBe(false);
    expect(RefundReferenceSchema.safeParse("x".repeat(201)).success).toBe(false);
    expect(RefundReferenceSchema.safeParse(" CN-1 ").data).toBe("CN-1");
  });
});
