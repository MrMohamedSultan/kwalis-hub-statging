import { describe, expect, it } from "vitest";
import { formPaymentMethod, generalExpenseFormRows, payrollFormRows } from "./rebate-export";
import type { GeneralExpenseRow, PayrollRow57 } from "./rebate-types";

const ge: GeneralExpenseRow = {
  source: "invoice",
  source_id: "x",
  ref_no: "MON26-INV-0001",
  qpe_category: "equipment_rental",
  description: "ARRI",
  budget_code: "3101",
  supplier: "Riyadh Rentals",
  invoice_no: "S-100",
  invoice_date: "2026-07-01",
  amount_excl_vat: 20000,
  vat_amount: 3000,
  amount_total: 23000,
  paid: 23000,
  payment_methods: "Transfer",
  payments_count: 1,
  bank_refs: "TRX-1",
  documented: true,
  status: "eligible",
  reason: "vendor_saudi_cr",
  claimable_excl: 20000,
  flags: [],
};

const pr: PayrollRow57 = {
  source_id: "y",
  crew_no: "MON26-CRW-0001",
  name: "Saudi Gaffer",
  position: "Gaffer",
  nationality: "Saudi Arabia",
  basic: 30000,
  housing: 0,
  transport: 0,
  telephone: 0,
  other_allowances: 0,
  overtime: 1000,
  per_diem: 0,
  total_salary: 31000,
  actual: 30000,
  paid: 30000,
  payments_count: 1,
  documented: true,
  status: "eligible",
  reason: "person_saudi",
  claimable_excl: 30000,
  flags: [],
};

describe("official form rows", () => {
  it("5.6 has # + 21 numbered columns", () => {
    const [row] = generalExpenseFormRows([ge]);
    expect(row).toHaveLength(22);
    expect(row[12]).toBe(20000); // (12) SAR value without VAT
    expect(row[16]).toBe(23000); // (16) amount paid — from payments, not the contract
    expect(row[19]).toBe("TRX-1"); // (19) transfer reference
  });
  it("5.7 has # + 27 numbered columns; crew no is the reference, not a UUID", () => {
    const [row] = payrollFormRows([pr]);
    expect(row).toHaveLength(28);
    expect(row[1]).toBe("MON26-CRW-0001");
    expect(row[3]).toBe("Gaffer");
    expect(row[19]).toBe(31000); // (19) total salary
    expect(row[21]).toBe(30000); // (21) amount paid
  });
  it("payment method in the form's words", () => {
    expect(formPaymentMethod("Transfer, Bank")).toBe("Transfer - تحويل");
    expect(formPaymentMethod("Cash")).toBe("Cash - نقدي");
    expect(formPaymentMethod(null)).toBe("");
  });
});
