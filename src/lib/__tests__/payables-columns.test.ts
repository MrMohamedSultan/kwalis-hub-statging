import { describe, expect, it } from "vitest";
import { milestoneColumnTotals, pivotByBeneficiary } from "@/components/payables/payables-utils";
import type { PayableMilestone } from "@/components/payables/payables-types";

const ms = (o: Partial<PayableMilestone>): PayableMilestone => ({
  id: "c1:m1",
  contract_id: "c1",
  beneficiary_id: "p1",
  beneficiary_name: "Kais",
  beneficiary_role: "",
  contract_total: 1600,
  contract_gross: 1684.21,
  contract_wht: 84.21,
  currency: "SAR",
  milestone_number: 1,
  milestone_amount: 800,
  milestone_status: "paid",
  ...o,
});

describe("Crew Payables columns (R13 / R14)", () => {
  const rows = pivotByBeneficiary([
    ms({}),
    ms({ id: "c1:m2", milestone_number: 2, milestone_status: "approved", milestone_amount: 400 }),
    ms({ id: "c1:m3", milestone_number: 3, milestone_status: "pending", milestone_amount: 400 }),
    ms({
      id: "c2:m1",
      contract_id: "c2",
      beneficiary_name: "Adel",
      contract_total: 6500,
      contract_gross: 6500,
      contract_wht: 0,
      milestone_amount: 3250,
      milestone_status: "pending",
    }),
  ]);
  it("Contract Value is gross, WHT and Net beside it (Kais 1,684.21 / 84.21 / 1,600)", () => {
    const k = rows.find((r) => r.contract_id === "c1")!;
    expect([k.contract_gross, k.contract_wht, k.contract_total]).toEqual([1684.21, 84.21, 1600]);
    expect([k.total_paid, k.payable, k.commitment]).toEqual([800, 400, 400]);
  });
  it("per instalment column: due, paid, remaining — not only the paid part", () => {
    expect(milestoneColumnTotals(rows, 3)).toEqual([
      { due: 4050, paid: 800, remaining: 3250 },
      { due: 400, paid: 0, remaining: 400 },
      { due: 400, paid: 0, remaining: 400 },
    ]);
  });
});
