import { describe, expect, it } from "vitest";
import { noInput } from "@/lib/server-input";

describe("noInput (X05)", () => {
  it("accepts no payload", () => {
    expect(noInput(undefined)).toBeUndefined();
    expect(noInput(null)).toBeUndefined();
    expect(noInput({})).toBeUndefined();
  });
  it("refuses any payload", () => {
    expect(() => noInput({ orgId: "x" })).toThrow();
    expect(() => noInput("x")).toThrow();
    expect(() => noInput([1])).toThrow();
  });
});
