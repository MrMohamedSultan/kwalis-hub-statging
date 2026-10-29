import { describe, expect, it } from "vitest";
import { poStatusMoveNeedsReason } from "@/lib/po-status";

describe("poStatusMoveNeedsReason (X08, db/pending/204)", () => {
  it("approved PO moved back to Draft / Open or to Rejected needs a reason", () => {
    const approved = { status: "Approved", first_approved_at: "2026-10-01" };
    expect(poStatusMoveNeedsReason(approved, "Draft")).toBe(true);
    expect(poStatusMoveNeedsReason(approved, "Open")).toBe(true);
    expect(poStatusMoveNeedsReason(approved, "Rejected")).toBe(true);
    expect(poStatusMoveNeedsReason({ status: "Issued" }, "Open")).toBe(true);
  });
  it("no reason for Closed / Cancelled (own rules), unchanged, re-approval or never-approved POs", () => {
    const approved = { status: "Approved", first_approved_at: "2026-10-01" };
    expect(poStatusMoveNeedsReason(approved, "Closed")).toBe(false);
    expect(poStatusMoveNeedsReason(approved, "Cancelled")).toBe(false);
    expect(poStatusMoveNeedsReason(approved, "Approved")).toBe(false);
    expect(poStatusMoveNeedsReason(approved, "Issued")).toBe(false);
    expect(poStatusMoveNeedsReason({ status: "Draft", first_approved_at: null }, "Open")).toBe(
      false,
    );
    expect(poStatusMoveNeedsReason(null, "Draft")).toBe(false);
  });
  it("a once-approved PO in Draft: Rejected needs a reason, Open does not", () => {
    const once = { status: "Draft", first_approved_at: "2026-10-01" };
    expect(poStatusMoveNeedsReason(once, "Rejected")).toBe(true);
    expect(poStatusMoveNeedsReason(once, "Open")).toBe(false);
  });
});
