import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/store", () => ({ useStore: () => null }));
vi.mock("@/lib/i18n", () => ({ default: { t: (k: string) => k } }));

import { lockStateFromRow } from "@/lib/project-lock";

describe("project lock state (X15)", () => {
  it("locked in the database", () => {
    expect(
      lockStateFromRow({ locked_at: "2026-10-01T00:00:00Z", lock_reason: "Wrap" }),
    ).toMatchObject({
      projectLocked: true,
      archived: false,
      reason: "Wrap",
    });
  });
  it("archived counts as locked", () => {
    expect(lockStateFromRow({ status: "Archived" })).toMatchObject({
      projectLocked: true,
      archived: true,
    });
  });
  it("approved budget is a separate lock", () => {
    expect(lockStateFromRow({ budget_status: "Locked/Approved" })).toMatchObject({
      projectLocked: false,
      budgetLocked: true,
    });
    expect(lockStateFromRow(null).projectLocked).toBe(false);
  });
});
