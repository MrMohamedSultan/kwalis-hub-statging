// G04 / X17: CSV exports write money with 2 decimals and thousands separators.
import { describe, expect, it } from "vitest";
import { csvMoneyColumns, toCSV } from "@/lib/export-csv";

describe("toCSV money formatting", () => {
  it("formats money columns (by header or fractional values) and keeps the rest raw", () => {
    const rows = [
      { Date: "2026-10-01", "Amount (SAR)": 5084801.475000001, "FX Rate": 0.266667, Qty: 3 },
      { Date: "2026-10-02", "Amount (SAR)": 1500, "FX Rate": 1, Qty: 2 },
    ];
    const csv = toCSV(rows).split("\n");
    expect(csv[1]).toBe('2026-10-01,"5,084,801.48",0.266667,3');
    expect(csv[2]).toBe('2026-10-02,"1,500.00",1,2');
  });
  it("reads numeric strings produced with toFixed and negatives", () => {
    const csv = toCSV([{ Amount: "-1750.5", Note: "x" }]).split("\n");
    expect(csv[1]).toBe('"-1,750.50",x');
  });
  it("does not touch codes, accounts or text columns", () => {
    const rows = [{ "Budget Code": "1100", Account: "5100", Status: "Paid", Total: "n/a" }];
    expect([...csvMoneyColumns(rows, Object.keys(rows[0]))]).toEqual([]);
  });
  it("honours explicit money / raw columns", () => {
    const rows = [{ reserved: 10, misc: 2.5 }];
    expect([
      ...csvMoneyColumns(rows, ["reserved", "misc"], { money: ["reserved"], raw: ["misc"] }),
    ]).toEqual(["reserved"]);
  });
});
