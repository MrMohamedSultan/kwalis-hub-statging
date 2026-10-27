import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { auditValueText, fieldChanges, humanizeField } from "@/lib/audit-trail";
import { isPermissionError, userFacingErrorMessage } from "@/lib/error-message";

describe("audit trail values (G12)", () => {
  it("shows before -> after in plain text, bookkeeping columns dropped", () => {
    const rows = fieldChanges({
      changed_fields: {
        price: { from: 1000, to: 1200 },
        updated_at: { from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" },
        vatable: { from: false, to: true },
        notes: { from: null, to: "x" },
      },
    });
    expect(rows.map((r) => r.field)).toEqual(["notes", "price", "vatable"]);
    expect(rows[1]).toEqual({ field: "price", from: "1,000", to: "1,200" });
    expect(rows[0].from).toBe("—");
  });
  it("never prints JSON for arrays or objects", () => {
    expect(auditValueText([])).toBe("—");
    expect(auditValueText([1, 2])).toBe("2 ×");
    expect(auditValueText({ a: 1 })).toBe("…");
  });
  it("humanises column names", () => {
    expect(humanizeField("budget_code")).toBe("Budget code");
  });
});

describe("error screens (X22)", () => {
  it("hides technical messages in production", () => {
    expect(userFacingErrorMessage(new Error("relation x does not exist"), false)).toBeUndefined();
    expect(userFacingErrorMessage(new Error("boom"), true)).toBe("boom");
  });
  it("recognises permission refusals", () => {
    expect(isPermissionError({ code: "42501", message: "x" })).toBe(true);
    expect(isPermissionError({ message: "new row violates row-level security policy" })).toBe(true);
    expect(isPermissionError(new Error("network"))).toBe(false);
  });
});
