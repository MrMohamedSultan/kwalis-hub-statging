import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  maskDate,
  parseDate,
  riyadhToday,
  toCalendarDay,
  toExcelDate,
  excelDateFormat,
  isoToDMY,
  dmyToIso,
} from "@/lib/date-format";
import {
  exportFileName,
  normalizeExportFileName,
  reportToken,
  projectLabel,
} from "@/lib/export/file-name";
import { formatExportNumber, roundTo } from "@/lib/export/number-format";
import i18n, { isolateForLanguage } from "@/lib/i18n";

describe("platform date format (G05 / B28 / B29)", () => {
  it("formats a stored date in the default dd/MM/yyyy, always with the year", () => {
    expect(formatDate("2026-10-27", "dd/MM/yyyy")).toBe("27/10/2026");
    expect(formatDate("2026-01-05", "dd/MM/yyyy")).toBe("05/01/2026");
  });

  it("follows the chosen platform format", () => {
    expect(formatDate("2026-10-27", "MM/dd/yyyy")).toBe("10/27/2026");
    expect(formatDate("2026-10-27", "yyyy-MM-dd")).toBe("2026-10-27");
    expect(formatDate("2026-10-27", "dd-MM-yyyy")).toBe("27-10-2026");
    expect(formatDate("2026-10-27", "dd.MM.yyyy")).toBe("27.10.2026");
  });

  it("never shifts a date-only value by the browser timezone", () => {
    expect(toCalendarDay("2026-10-27")).toEqual({ y: 2026, m: 10, d: 27 });
    expect(formatDate("2026-10-27T00:00:00", "dd/MM/yyyy")).toBe("27/10/2026");
  });

  it("converts timestamps to Saudi time before taking the day (no off-by-one)", () => {
    // Stored as 21:00 UTC the previous day = midnight in Riyadh (UTC+3).
    expect(formatDate("2026-10-26T21:00:00Z", "dd/MM/yyyy")).toBe("27/10/2026");
    expect(formatDate(new Date("2026-10-26T21:30:00Z"), "dd/MM/yyyy")).toBe("27/10/2026");
    expect(formatDateTime("2026-10-27T11:05:00Z", "dd/MM/yyyy")).toBe("27/10/2026 14:05");
    expect(riyadhToday(new Date("2026-10-27T22:30:00Z"))).toBe("2026-10-28");
  });

  it("writes Excel dates at UTC midnight of the calendar day", () => {
    const d = toExcelDate("2026-10-27")!;
    expect(d.toISOString()).toBe("2026-10-27T00:00:00.000Z");
    expect(toExcelDate("2026-10-26T21:00:00Z")!.toISOString()).toBe("2026-10-27T00:00:00.000Z");
    expect(excelDateFormat("dd/MM/yyyy")).toBe("dd/mm/yyyy");
    expect(excelDateFormat("MM/dd/yyyy")).toBe("mm/dd/yyyy");
  });

  it("masks and parses input in the platform format", () => {
    expect(maskDate("27102026", "dd/MM/yyyy")).toBe("27/10/2026");
    expect(maskDate("2710", "dd/MM/yyyy")).toBe("27/10");
    expect(maskDate("20261027", "yyyy-MM-dd")).toBe("2026-10-27");
    expect(maskDate("27102026999", "dd.MM.yyyy")).toBe("27.10.2026");
    expect(parseDate("27/10/2026", "dd/MM/yyyy")).toBe("2026-10-27");
    expect(parseDate("10/27/2026", "MM/dd/yyyy")).toBe("2026-10-27");
    expect(parseDate("2026-10-27", "yyyy-MM-dd")).toBe("2026-10-27");
    expect(parseDate("31/02/2026", "dd/MM/yyyy")).toBe("");
    expect(parseDate("27/10/26", "dd/MM/yyyy")).toBe("");
  });

  it("keeps the legacy DD/MM/YYYY helpers working", () => {
    expect(isoToDMY("2026-10-27")).toBe("27/10/2026");
    expect(dmyToIso("27/10/2026")).toBe("2026-10-27");
    expect(isoToDMY("")).toBe("");
  });
});

const OLD = ["Track", "Roll"].join(""); // the pre-rename product name (G01)

describe("export file names (G01 / G02)", () => {
  it("builds KwalisHub_{ProjectCode}_{Report}_{YYYY-MM-DD}", () => {
    expect(
      exportFileName({
        projectCode: "MON26",
        report: "Payments Register",
        ext: "xlsx",
        date: "2026-10-27",
      }),
    ).toBe("KwalisHub_MON26_PaymentsRegister_2026-10-27.xlsx");
    expect(reportToken("Tax & VAT — Cash Impact")).toBe("TaxVATCashImpact");
    expect(reportToken("")).toBe("Report");
  });

  it("rewrites legacy names with the old product prefix", () => {
    expect(
      normalizeExportFileName(`${OLD.toLowerCase()}-gl-report-mon26.csv`, "csv", {
        projectCode: "MON26",
        date: "2026-10-27",
      }),
    ).toBe("KwalisHub_MON26_GlReport_2026-10-27.csv");
    expect(
      normalizeExportFileName("funding-inflows-2026-10-01.pdf", "pdf", {
        projectCode: "MON26",
        date: "2026-10-27",
      }),
    ).toBe("KwalisHub_MON26_FundingInflows_2026-10-27.pdf");
    expect(
      normalizeExportFileName("KwalisHub_MON26_Cost_2026-10-27", "pdf", { projectCode: "X" }),
    ).toBe("KwalisHub_MON26_Cost_2026-10-27.pdf");
    expect(normalizeExportFileName("x.pdf", "pdf", { date: "2026-10-27" })).toMatch(
      /^KwalisHub_Project_X_2026-10-27\.pdf$/,
    );
  });

  it("never contains the old product name", () => {
    const n = normalizeExportFileName(`${OLD}_report`, "pdf", { projectCode: "A1" });
    expect(n.toLowerCase()).not.toContain(OLD.toLowerCase());
  });

  it("labels the project", () => {
    expect(projectLabel({ projectCode: "MON26", projectName: "Desert" })).toBe("MON26 — Desert");
    expect(projectLabel({ projectCode: null, projectName: "Desert" })).toBe("Desert");
  });
});

describe("export numbers (G04 / X17)", () => {
  it("rounds and groups with two decimals", () => {
    expect(formatExportNumber(5084801.475000001)).toBe("5,084,801.48");
    expect(formatExportNumber(-1750)).toBe("-1,750.00");
    expect(formatExportNumber(-0.001)).toBe("0.00");
    expect(formatExportNumber(1234.5, 0)).toBe("1,235");
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundTo(1.005, 2)).toBe(1.01);
  });
});

describe("bidi isolation of interpolated values (G14)", () => {
  it("isolates numbers and Latin text inside Arabic sentences only", async () => {
    await i18n.changeLanguage("ar");
    expect(isolateForLanguage("5%")).toBe("\u20685%\u2069");
    expect(isolateForLanguage("محمد")).toBe("محمد");
    expect(i18n.t("exports.page_x_of_y", { page: 1, total: 3 })).toBe(
      "صفحة \u20681\u2069 من \u20683\u2069",
    );
    await i18n.changeLanguage("en");
    expect(isolateForLanguage("5%")).toBe("5%");
    expect(i18n.t("exports.page_x_of_y", { page: 1, total: 3 })).toBe("Page 1 of 3");
  });
});

describe("SheetJS branding rows (G02)", () => {
  it("puts company/project/title on top and the footer underneath", async () => {
    const { brandedRows } = await import("@/lib/export/sheetjs-branding");
    const rows = brandedRows(
      [
        ["Name", "Amount"],
        ["A", 1750],
      ],
      {
        company: "Co",
        project: "MON26 — Film",
        title: "Vendor Ledger",
        footer: "Exported from Kwalis Hub",
      },
    );
    expect(rows[0]).toEqual(["Co"]);
    expect(rows[2]).toEqual(["Vendor Ledger"]);
    expect(rows[4]).toEqual(["Name", "Amount"]);
    expect(rows[5][1]).toBe(1750);
    expect(rows[rows.length - 1]).toEqual(["Exported from Kwalis Hub"]);
  });
});
