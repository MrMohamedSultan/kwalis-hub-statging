import { describe, expect, it } from "vitest";
import {
  builtinTemplateLines,
  parseTemplateSheet,
  templateHeaders,
  templateToSheet,
} from "@/lib/budget-template";

describe("budget template (D20)", () => {
  it("built-in template = the hard-coded headers and codes", () => {
    const lines = builtinTemplateLines();
    expect(lines.length).toBeGreaterThan(100);
    expect(lines.find((l) => l.code === "1101")?.header_code).toBe("1100");
    expect(new Set(lines.map((l) => l.code)).size).toBe(lines.length);
  });
  it("round-trips through a sheet", () => {
    const lines = builtinTemplateLines();
    const { lines: back, errors } = parseTemplateSheet(templateToSheet(lines));
    expect(errors).toEqual([]);
    expect(back).toEqual(lines);
  });
  it("reads Arabic headers, skips title rows, reports bad rows", () => {
    const { lines, errors } = parseTemplateSheet([
      ["Org One — Budget Template"],
      [],
      ["القسم", "كود الرأس", "اسم الرأس", "الكود", "الوصف"],
      ["ATL", "1100", "SCRIPT", "1101", "Script"],
      ["above the line", "1100", "SCRIPT", "1102", "Research"],
      ["Nope", "1100", "SCRIPT", "1103", "Bad group"],
      ["BTL", "2100", "CAMERA", "1101", "Duplicate code"],
      ["BTL", "", "CAMERA", "2101", "No header"],
      ["BTL", "2100", "CAMERA", "", "no code: skipped"],
    ]);
    expect(lines.map((l) => l.code)).toEqual(["1101", "1102"]);
    expect(errors).toEqual([
      { row: 6, problem: "group" },
      { row: 7, problem: "duplicate" },
      { row: 8, problem: "header" },
    ]);
    expect(templateHeaders(lines)).toEqual([{ code: "1100", name: "SCRIPT", group: "ATL" }]);
  });
  it("needs the code, header code and group columns", () => {
    expect(
      parseTemplateSheet([
        ["Code", "Description"],
        ["1101", "x"],
      ]).errors,
    ).toEqual([{ row: 1, problem: "columns" }]);
  });
});
