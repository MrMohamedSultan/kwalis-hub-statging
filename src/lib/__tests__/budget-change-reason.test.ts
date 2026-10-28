import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { withChangeReason } from "@/lib/store";

describe("budget line reason for change (N10)", () => {
  it("adds the trimmed reason to the update row", () => {
    expect(withChangeReason({ id: "a" }, "  Rate agreed with DOP ")).toEqual({
      id: "a",
      change_reason: "Rate agreed with DOP",
    });
  });
  it("leaves the row untouched when no reason was typed", () => {
    expect(withChangeReason({ id: "a" }, "   ")).toEqual({ id: "a" });
    expect(withChangeReason({ id: "a" })).toEqual({ id: "a" });
  });
  it("caps the reason at 500 characters (DB check)", () => {
    const r = withChangeReason({ id: "a" }, "x".repeat(600)) as { change_reason?: string };
    expect(r.change_reason).toHaveLength(500);
  });
});
