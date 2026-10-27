import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/storage-audit", () => ({ storageAudited: {} }));
vi.mock("@/lib/auth-roles", () => ({ useAuthRoles: () => ({ userId: null }) }));

import {
  amountInSar,
  filterApprovalRows,
  requestForMilestone,
  requestModule,
  requestTypeKey,
  requiredLevels,
  toRequestMethod,
  type ApprovalLevel,
  type PaymentRequest,
} from "@/lib/payment-requests";

const req = (p: Partial<PaymentRequest>): PaymentRequest =>
  ({
    id: "r",
    organization_id: "o1",
    project_id: "p1",
    source_type: "invoice",
    source_id: "s",
    source_label: null,
    total_amount: 0,
    previously_paid: 0,
    requested_amount: 100,
    currency: "SAR",
    status: "waiting_approval",
    requested_by: "u1",
    created_at: "2026-10-01T00:00:00Z",
    ...p,
  }) as PaymentRequest;

describe("request module / type", () => {
  it("contract instalments are contracts, payroll-run lines are payroll", () => {
    expect(requestModule({ source_type: "payroll_row", payroll_milestone_id: "m1" })).toBe(
      "contracts",
    );
    expect(requestModule({ source_type: "payroll_row", payroll_milestone_id: "run" })).toBe(
      "payroll",
    );
    expect(requestModule({ source_type: "payroll_row", payroll_milestone_id: null })).toBe(
      "payroll",
    );
    expect(requestModule({ source_type: "cast_contract" })).toBe("contracts");
    expect(requestModule({ source_type: "purchase_order" })).toBe("vendor");
    expect(requestModule({ source_type: "petty_cash" })).toBe("petty_cash");
  });
  it("type keys", () => {
    expect(requestTypeKey({ source_type: "payroll_row", payroll_milestone_id: "m1" })).toBe(
      "approvals.type.instalment",
    );
    expect(requestTypeKey({ source_type: "payroll_row", payroll_milestone_id: "run" })).toBe(
      "approvals.type.payroll_run",
    );
    expect(requestTypeKey({ source_type: "invoice" })).toBe("approvals.type.invoice");
  });
});

describe("requestForMilestone", () => {
  const rows = [
    req({
      id: "old",
      source_id: "pr1",
      payroll_milestone_id: "m1",
      status: "rejected",
      created_at: "2026-10-01",
    }),
    req({
      id: "open",
      source_id: "pr1",
      payroll_milestone_id: "m1",
      status: "waiting_approval",
      created_at: "2026-09-01",
    }),
    req({
      id: "c",
      source_id: "pr1",
      payroll_milestone_id: "m2",
      status: "cancelled",
      created_at: "2026-10-02",
    }),
  ];
  it("prefers the open request over a newer closed one", () => {
    expect(requestForMilestone(rows, "pr1", "m1")?.id).toBe("open");
  });
  it("falls back to the latest closed request (for its reason)", () => {
    expect(requestForMilestone(rows, "pr1", "m2")?.id).toBe("c");
    expect(requestForMilestone(rows, "pr1", "m3")).toBeNull();
  });
});

describe("filterApprovalRows", () => {
  const rows = [
    req({ id: "a", project_id: "p1", requested_by: "u1" }),
    req({ id: "b", project_id: "p2", requested_by: "u1" }),
    req({ id: "c", project_id: "p1", requested_by: "u2", status: "paid" }),
    req({ id: "d", project_id: "p1", requested_by: "u2", source_type: "petty_cash" }),
  ];
  const base = {
    projectId: "p1",
    tab: "all" as const,
    module: "all" as const,
    myTurn: new Set<string>(),
    seesAll: true,
    userId: "u9",
  };
  it("never shows another project's requests (no 'all projects' inside a project)", () => {
    expect(filterApprovalRows(rows, base).map((r) => r.id)).toEqual(["a", "c", "d"]);
  });
  it("my-turn tab shows only requests the user can act on", () => {
    expect(
      filterApprovalRows(rows, { ...base, tab: "my_turn", myTurn: new Set(["d", "b"]) }).map(
        (r) => r.id,
      ),
    ).toEqual(["d"]);
  });
  it("status and module filters", () => {
    expect(filterApprovalRows(rows, { ...base, tab: "paid" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterApprovalRows(rows, { ...base, module: "petty_cash" }).map((r) => r.id)).toEqual([
      "d",
    ]);
  });
  it("a requester without approve/execute sees only their own requests", () => {
    expect(
      filterApprovalRows(rows, { ...base, seesAll: false, userId: "u2" }).map((r) => r.id),
    ).toEqual(["c", "d"]);
  });
});

describe("approval levels by amount", () => {
  const lv = (level_no: number, min: number): ApprovalLevel => ({
    id: String(level_no),
    organization_id: "o1",
    level_no,
    label: `L${level_no}`,
    min_amount_sar: min,
    approver_kind: "org_admin",
    role_id: null,
  });
  const levels = [lv(2, 50000), lv(1, 0), lv(3, 250000)];
  it("small requests need fewer levels than large ones, in order", () => {
    expect(requiredLevels(levels, 5000).map((l) => l.level_no)).toEqual([1]);
    expect(requiredLevels(levels, 50000).map((l) => l.level_no)).toEqual([1, 2]);
    expect(requiredLevels(levels, 300000).map((l) => l.level_no)).toEqual([1, 2, 3]);
  });
  it("converts the project currency at the locked rate", () => {
    const project = { currency: "USD", fxRate: 3.75 };
    expect(amountInSar(1000, "SAR", project)).toBe(1000);
    expect(amountInSar(1000, "USD", project)).toBe(3750);
    expect(amountInSar(1000, "EUR", project)).toBe(1000);
    expect(amountInSar(0.1 + 0.2, "SAR", project)).toBe(0.3);
  });
});

describe("toRequestMethod", () => {
  it("maps grid methods to the request methods", () => {
    expect(toRequestMethod("cash")).toBe("Cash");
    expect(toRequestMethod("check")).toBe("Check");
    expect(toRequestMethod("credit_card")).toBe("Card");
    expect(toRequestMethod("wire_transfer")).toBe("Transfer");
    expect(toRequestMethod(undefined)).toBe("Transfer");
  });
});
