import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { changeDelta, filterChangeLog, type BudgetChangeRow } from "./budget-change-log-data";

const row = (p: Partial<BudgetChangeRow>): BudgetChangeRow => ({
  id: "1",
  changed_at: "2026-10-10T10:00:00Z",
  budget_line_id: "l",
  operation: "UPDATE",
  action: "update",
  actor_name: "Accountant A",
  budget_code: "1403",
  description: "Actor A",
  version_name: "v1.0",
  version_status: "active",
  before_sar: 10000,
  after_sar: 15000,
  reason: "Day rate renegotiated",
  changed_fields: {},
  ...p,
});

describe("Budget Change Log (N10)", () => {
  it("change = after − before; create from 0, delete to 0", () => {
    expect(changeDelta(row({}))).toBe(5000);
    expect(changeDelta(row({ before_sar: null, after_sar: 300 }))).toBe(300);
    expect(changeDelta(row({ before_sar: 300, after_sar: null }))).toBe(-300);
  });
  it("filters by date, version, amount and text", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", before_sar: 5, after_sar: 5, changed_at: "2026-09-01T00:00:00Z" }),
      row({ id: "c", version_name: "v2.0", reason: null, actor_name: "Org1 Admin" }),
    ];
    expect(filterChangeLog(rows, { amountOnly: true }).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterChangeLog(rows, { from: "2026-10-01" }).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterChangeLog(rows, { version: "v2.0" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterChangeLog(rows, { search: "renegot" }).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
