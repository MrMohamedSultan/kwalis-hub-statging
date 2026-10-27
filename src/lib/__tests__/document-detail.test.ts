import { describe, expect, it } from "vitest";
import {
  documentAmounts,
  documentName,
  externalNumber,
  scheduleRows,
  scheduleTotal,
} from "@/lib/document-detail";

describe("documentAmounts (G09) — Net = Gross − WHT", () => {
  it("invoice: gross incl. VAT, net after WHT", () => {
    expect(documentAmounts("invoice", { price: 1000, vat_amount: 150, wht_amount: 50 })).toEqual({
      gross: 1150,
      wht: 50,
      net: 1100,
    });
  });
  it("contract: stored net wins, else gross − WHT", () => {
    expect(
      documentAmounts("payroll", { total_amount: 10000, wht_amount: 500, net_payable: 9500 }).net,
    ).toBe(9500);
    expect(documentAmounts("payroll", { total_amount: 10000, wht_amount: 500 }).net).toBe(9500);
  });
  it("other documents have no WHT", () => {
    expect(documentAmounts("per_diem", { total_amount: 600 })).toEqual({
      gross: 600,
      wht: 0,
      net: 600,
    });
    expect(documentAmounts("cash_advance", { total_advance: 2000 }).gross).toBe(2000);
    expect(documentAmounts("petty_cash", { amount: "80.5" }).net).toBe(80.5);
  });
});

describe("names and numbers", () => {
  it("name from the counterparty and purpose", () => {
    expect(documentName("invoice", { vendor_name: "Grip Co", description: "Rental" })).toBe(
      "Grip Co — Rental",
    );
    expect(documentName("payment", {}, "invoice payment")).toBe("invoice payment");
  });
  it("vendor number kept apart from ref_no (G08)", () => {
    expect(externalNumber("invoice", { invoice_no: "V-77" })).toBe("V-77");
    expect(
      externalNumber("purchase_order", { po_number: "MON26-PO-0001", ref_no: "MON26-PO-0001" }),
    ).toBeNull();
    expect(externalNumber("purchase_order", { po_number: "VEND-9", ref_no: "MON26-PO-0002" })).toBe(
      "VEND-9",
    );
  });
});

describe("scheduleRows (G10)", () => {
  const raw = [
    {
      id: "m1",
      label: "On Signing",
      percent: 20,
      amount: null,
      status: "Paid",
      paidDate: "2026-09-01",
      paymentMethod: "Bank Transfer",
    },
    {
      id: "m2",
      label: "On Wrap",
      percent: 0,
      amount: 40000,
      status: "Pending",
      dueDate: "2026-12-01",
    },
    { id: "m3", label: "P3", percent: 0, amount: 46000 },
  ];
  it("derives percent milestones from the contract value, total = contract value", () => {
    const rows = scheduleRows(raw, 107500);
    expect(rows.map((r) => r.amount)).toEqual([21500, 40000, 46000]);
    expect(scheduleTotal(rows).amount).toBe(107500);
    expect(rows[0]).toMatchObject({
      status: "Paid",
      paidDate: "2026-09-01",
      method: "Bank Transfer",
    });
    expect(rows[2].status).toBe("Pending");
  });
  it("accepts a JSON string and ignores junk", () => {
    expect(scheduleRows(JSON.stringify(raw), 107500)).toHaveLength(3);
    expect(scheduleRows("not json", 1)).toEqual([]);
    expect(scheduleRows({}, 1)).toEqual([]);
  });
});
