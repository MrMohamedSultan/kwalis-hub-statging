import { describe, expect, it } from "vitest";
import { archiveCodeMatches, isArchivedProject } from "@/lib/project-archive";

describe("project archive (D02)", () => {
  it("accepts the typed code regardless of case and surrounding spaces", () => {
    expect(archiveCodeMatches(" mon26 ", "MON26")).toBe(true);
  });

  it("rejects a wrong or partial code", () => {
    expect(archiveCodeMatches("MON2", "MON26")).toBe(false);
    expect(archiveCodeMatches("", "MON26")).toBe(false);
  });

  it("never confirms a project that has no code", () => {
    expect(archiveCodeMatches("", null)).toBe(false);
    expect(archiveCodeMatches("", "")).toBe(false);
  });

  it("recognises the archived status", () => {
    expect(isArchivedProject("Archived")).toBe(true);
    expect(isArchivedProject("Production")).toBe(false);
    expect(isArchivedProject(null)).toBe(false);
  });
});
