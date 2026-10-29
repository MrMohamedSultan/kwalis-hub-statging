import { describe, expect, it } from "vitest";
import { buildCrewCastCsv, canExportPersonalData } from "@/lib/crewcast-csv";

const row = {
  fullName: "Sara, A.",
  role: "Gaffer",
  nationality: "SA",
  idNumber: "1012345678",
  phoneNumber: "+966500000000",
  email: "s@example.com",
  iban: "SA0380000000608010167519",
  bank: "Rajhi",
  startDate: "2026-10-01",
  endDate: "2026-11-01",
  currency: "SAR",
  days: 20,
  daily: 1500,
  perDiem: 100,
  gross: 30000,
  status: "Active",
};

describe("crew / cast list CSV", () => {
  it("leaves out contact, bank, ID and money columns without permission", () => {
    const csv = buildCrewCastCsv([row], { kind: "crew", includeSensitive: false, label: (k) => k });
    expect(csv.split("\n")[0]).toBe(
      "full_name,position,nationality,start,end,days,tax_residency,status",
    );
    expect(csv).not.toContain("SA0380000000608010167519");
    expect(csv).not.toContain("30000");
    expect(csv).not.toContain("+966");
    expect(csv.split("\n")[1]).toBe('"Sara, A.",Gaffer,SA,2026-10-01,2026-11-01,20,,Active');
  });
  it("includes them for users allowed to see contact data", () => {
    const csv = buildCrewCastCsv([row], { kind: "cast", includeSensitive: true, label: (k) => k });
    expect(csv.split("\n")[0]).toContain("character");
    expect(csv).toContain("SA0380000000608010167519");
    expect(csv).toContain(`"30,000.00"`);
  });
  it("header labels come from the translator", () => {
    const csv = buildCrewCastCsv([], {
      kind: "crew",
      includeSensitive: false,
      label: (k) => `[${k}]`,
    });
    expect(csv.startsWith("[full_name],[position]")).toBe(true);
  });
});

describe("canExportPersonalData", () => {
  const none = { rebateAdmin: false, canEditCrew: false, canEditCast: false };
  it("allows a rebate settings admin for every kind", () => {
    for (const k of ["crew", "cast", "vendor", null])
      expect(canExportPersonalData({ ...none, rebateAdmin: true }, k)).toBe(true);
  });
  it("needs edit rights on that kind of contract (vendor follows crew)", () => {
    expect(canExportPersonalData({ ...none, canEditCrew: true }, "crew")).toBe(true);
    expect(canExportPersonalData({ ...none, canEditCrew: true }, "cast")).toBe(false);
    expect(canExportPersonalData({ ...none, canEditCast: true }, "Cast")).toBe(true);
    expect(canExportPersonalData({ ...none, canEditCrew: true }, "vendor")).toBe(true);
    expect(canExportPersonalData(none, "crew")).toBe(false);
  });
});

describe("crew / cast CSV money (G04)", () => {
  it("writes daily, per diem and contract value with 2 decimals; days and IDs as-is", () => {
    const csv = buildCrewCastCsv([{ ...row, daily: 1500.5, perDiem: 100, gross: 30010 }], {
      kind: "crew",
      includeSensitive: true,
      label: (k) => k,
    });
    const [head, line] = csv.split("\n");
    const cols = head.split(",");
    const cells = line.match(/("[^"]*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, ""));
    expect(cells[cols.indexOf("daily")]).toBe('"1,500.50"');
    expect(cells[cols.indexOf("per_diem")]).toBe("100.00");
    expect(cells[cols.indexOf("contract_value")]).toBe('"30,010.00"');
    expect(cells[cols.indexOf("days")]).toBe("20");
    expect(cells[cols.indexOf("id_number")]).toBe("1012345678");
  });
});
