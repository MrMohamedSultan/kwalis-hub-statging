import { describe, expect, it } from "vitest";
import {
  BudgetTemplateSchema,
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

describe("BudgetTemplateSchema (mirrors stamp_budget_template, db/pending/204)", () => {
  const line = {
    group: "ATL",
    header_code: "1100",
    header_name: "SCRIPT",
    code: "1101",
    description: "x",
  };
  it("accepts the built-in template and strips unknown keys", () => {
    expect(
      BudgetTemplateSchema.safeParse({ name: "Std", lines: builtinTemplateLines() }).success,
    ).toBe(true);
    const r = BudgetTemplateSchema.parse({ name: " Std ", lines: [{ ...line, evil: "<b>" }] });
    expect(r.name).toBe("Std");
    expect(Object.keys(r.lines[0]).sort()).toEqual([
      "code",
      "description",
      "group",
      "header_code",
      "header_name",
    ]);
  });
  it("refuses what the database refuses", () => {
    for (const bad of [
      { name: "", lines: [line] },
      { name: "x", lines: [] },
      { name: "x", lines: [{ ...line, group: "Nope" }] },
      { name: "x", lines: [{ ...line, code: "has space" }] },
      { name: "x", lines: [{ ...line, description: "d".repeat(301) }] },
      { name: "x", lines: [line, line] },
    ])
      expect(BudgetTemplateSchema.safeParse(bad).success).toBe(false);
  });
});
