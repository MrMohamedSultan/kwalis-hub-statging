import { describe, expect, it } from "vitest";
import { buildCrewCastCsv } from "@/lib/crewcast-csv";

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
    expect(csv).toContain("30000");
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
