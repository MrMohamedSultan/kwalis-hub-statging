import { describe, expect, it } from "vitest";
import {
  headerOptions,
  subAccountOptions,
  subAccountLines,
  lineById,
} from "@/lib/budget-mapping-options";
import {
  isHeaderBudgetCode,
  parentHeaderCodeForLine,
  type ProjectBudgetLine,
} from "@/lib/project-budget-lines";

function line(
  partial: Partial<ProjectBudgetLine> & { id: string; mainCode: string },
): ProjectBudgetLine {
  return {
    headerCode: "",
    description: "",
    name: "",
    group: "",
    amount: 1,
    rate: 100,
    currency: "SAR",
    unit: "day",
    x: 1,
    prep: 0,
    shooting: 0,
    wrap: 0,
    excluded: false,
    ...partial,
  } as ProjectBudgetLine;
}

// Shared fixture: mirrors a real uploaded budget where header_code is wrong
// on some rows and duplicate codes exist under one header.
const LINES: ProjectBudgetLine[] = [
  line({ id: "h-1200", mainCode: "1200", description: "PRODUCERS UNIT", group: "ABOVE THE LINE" }),
  line({
    id: "l-1201-a",
    mainCode: "1201",
    headerCode: "1201",
    description: "DRIVER",
    name: "Mohammed",
  }),
  line({
    id: "l-1201-b",
    mainCode: "1201",
    headerCode: "1201",
    description: "DRIVER",
    name: "Ali",
  }),
  line({ id: "l-1202", mainCode: "1202", headerCode: "1200", description: "LINE PRODUCER" }),
  line({ id: "h-1400", mainCode: "1400", description: "MAIN CAST", group: "CAST" }),
  line({
    id: "l-1401",
    mainCode: "1401",
    headerCode: "1401",
    description: "Main Roles",
    name: "Da'ad",
  }),
  line({
    id: "l-1401-1",
    mainCode: "1401.1",
    headerCode: "1401",
    description: "Main Roles",
    name: "Faisal",
  }),
  line({ id: "l-1402", mainCode: "1402", headerCode: "1400", description: "Supporting Roles" }),
];

describe("header dropdown (shared by Invoices, Crew Contracts, Cast Contracts)", () => {
  const headers = headerOptions(LINES);

  it("lists only parent categories ending in 00", () => {
    expect(headers.map((h) => h.value)).toEqual(["1200", "1400"]);
    for (const h of headers) expect(isHeaderBudgetCode(h.code)).toBe(true);
  });

  it("never lists executable line items or decimal sub-codes", () => {
    const values = headers.map((h) => h.value);
    expect(values).not.toContain("1201");
    expect(values).not.toContain("1401");
    expect(values).not.toContain("1401.1");
  });

  it("labels headers with their category name and searchable full label", () => {
    const cast = headers.find((h) => h.value === "1400")!;
    expect(cast.label).toBe("MAIN CAST");
    expect(cast.keywords).toContain("1400");
  });

  it("returns a memoized identical array for the same lines reference", () => {
    expect(headerOptions(LINES)).toBe(headers);
  });
});

describe("sub-account dropdown filtering", () => {
  it("returns only executable lines under the chosen header", () => {
    expect(subAccountOptions(LINES, "1200").map((o) => o.value)).toEqual([
      "l-1201-a",
      "l-1201-b",
      "l-1202",
    ]);
  });

  it("re-parents lines whose uploaded header_code is itself a line item", () => {
    expect(parentHeaderCodeForLine(LINES.find((l) => l.id === "l-1401")!)).toBe("1400");
    expect(subAccountOptions(LINES, "1400").map((o) => o.value)).toEqual([
      "l-1401",
      "l-1401-1",
      "l-1402",
    ]);
  });

  it("excludes the header row itself from its own sub-accounts", () => {
    const ids = subAccountOptions(LINES, "1400").map((o) => o.value);
    expect(ids).not.toContain("h-1400");
  });

  it("returns nothing when no header is selected", () => {
    expect(subAccountOptions(LINES, "")).toEqual([]);
  });

  it("binds each option to the unique budget_lines row id, not the code", () => {
    const opts = subAccountOptions(LINES, "1200");
    expect(new Set(opts.map((o) => o.value)).size).toBe(opts.length);
    expect(opts.filter((o) => o.code === "1201")).toHaveLength(2);
  });

  it("disambiguates duplicate codes in the visible label", () => {
    const dupes = subAccountOptions(LINES, "1200").filter((o) => o.code === "1201");
    expect(dupes[0].label).not.toBe(dupes[1].label);
    expect(dupes[0].label).toContain("Mohammed");
    expect(dupes[1].label).toContain("Ali");
  });

  it("keeps the row id searchable via keywords", () => {
    const opt = subAccountOptions(LINES, "1400").find((o) => o.value === "l-1401-1")!;
    expect(opt.keywords).toContain("l-1401-1");
    expect(opt.keywords).toContain("1401.1");
  });

  it("memoizes per header code", () => {
    expect(subAccountOptions(LINES, "1200")).toBe(subAccountOptions(LINES, "1200"));
    expect(subAccountLines(LINES, "1400")).toBe(subAccountLines(LINES, "1400"));
  });
});

describe("inline mapping preview resolution", () => {
  it("resolves the bound line by id for the preview strip", () => {
    const l = lineById(LINES, "l-1201-b")!;
    expect(l.mainCode).toBe("1201");
    expect(parentHeaderCodeForLine(l)).toBe("1200");
  });

  it("returns null for an unmapped record", () => {
    expect(lineById(LINES, null)).toBeNull();
    expect(lineById(LINES, "missing")).toBeNull();
  });
});

const FORMS: Array<[string, string, string]> = [
  ["Invoice modal", "1400", "l-1402"],
  ["Crew contract", "1200", "l-1202"],
  ["Cast contract", "1400", "l-1401"],
];

describe.each(FORMS)("%s uses the same cascading rules", (_form, header, expectedId) => {
  it("offers the picked line under its header only", () => {
    const ids = subAccountOptions(LINES, header).map((o) => o.value);
    expect(ids).toContain(expectedId);
    const other = header === "1200" ? "1400" : "1200";
    expect(subAccountOptions(LINES, other).map((o) => o.value)).not.toContain(expectedId);
  });
});
