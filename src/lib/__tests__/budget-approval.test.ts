import { describe, it, expect } from "vitest";
import {
  canDecide,
  canPublishDirectly,
  canSubmitBudget,
  decisionProgress,
  rejectReasonError,
  submittableVersions,
} from "@/lib/budget-approval";

const base = {
  isSuperAdmin: false,
  isOrgAdmin: false,
  projectRole: null as string | null,
  isExecutive: false,
};

describe("who may send the budget", () => {
  it.each(["owner", "admin", "producer"])("project %s may", (role) => {
    expect(canSubmitBudget({ ...base, projectRole: role })).toBe(true);
  });
  it.each(["member", "accountant", "coordinator", null])("project %s may not", (role) => {
    expect(canSubmitBudget({ ...base, projectRole: role })).toBe(false);
  });
  it("org admin may, an executive never (unless platform owner)", () => {
    expect(canSubmitBudget({ ...base, isOrgAdmin: true })).toBe(true);
    expect(canSubmitBudget({ ...base, projectRole: "producer", isExecutive: true })).toBe(false);
    expect(canSubmitBudget({ ...base, isSuperAdmin: true, isExecutive: true })).toBe(true);
  });
});

describe("versions that can be sent", () => {
  const versions = [
    { id: "a", status: "active" as const },
    { id: "d", status: "draft" as const },
    { id: "x", status: "archived" as const },
  ];
  it("drafts and the not-yet-approved active budget", () => {
    expect(submittableVersions(versions, "Draft", false).map((v) => v.id)).toEqual(["a", "d"]);
    expect(submittableVersions(versions, "Revision Requested", false).map((v) => v.id)).toEqual([
      "a",
      "d",
    ]);
  });
  it("only drafts once the budget is locked", () => {
    expect(submittableVersions(versions, "Locked/Approved", false).map((v) => v.id)).toEqual(["d"]);
  });
  it("nothing while a request is pending", () => {
    expect(submittableVersions(versions, "Draft", true)).toEqual([]);
  });
  it("direct publish only for budgets that never went to the board", () => {
    expect(canPublishDirectly("Draft", false)).toBe(true);
    expect(canPublishDirectly("Draft", true)).toBe(false);
    expect(canPublishDirectly("Locked/Approved", false)).toBe(false);
    expect(canPublishDirectly("Revision Requested", false)).toBe(false);
  });
});

describe("decisions", () => {
  const decisions = [
    { approverId: "f", decision: "pending" as const },
    { approverId: "g", decision: "approved" as const },
  ];
  it("only an assigned approver with a pending row, never the sender", () => {
    expect(canDecide({ status: "pending", submittedBy: "a" }, decisions, "f")).toBe(true);
    expect(canDecide({ status: "pending", submittedBy: "a" }, decisions, "g")).toBe(false);
    expect(canDecide({ status: "pending", submittedBy: "a" }, decisions, "c")).toBe(false);
    expect(canDecide({ status: "pending", submittedBy: "f" }, decisions, "f")).toBe(false);
    expect(canDecide({ status: "approved", submittedBy: "a" }, decisions, "f")).toBe(false);
    expect(canDecide({ status: "pending", submittedBy: "a" }, decisions, null)).toBe(false);
  });
  it("progress and reject reason", () => {
    expect(decisionProgress(decisions)).toEqual({ total: 2, approved: 1, rejected: 0, pending: 1 });
    expect(rejectReasonError("   ")).toBe("required");
    expect(rejectReasonError("x".repeat(1001))).toBe("too_long");
    expect(rejectReasonError("Camera too expensive")).toBeNull();
  });
});
