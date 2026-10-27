import { describe, expect, it } from "vitest";
import {
  buildGlTransactionsDoc,
  glTotalBucket,
} from "@/features/reports/gl-transactions/gl-transactions-export";
import type { GlTransaction } from "@/features/reports/gl-transactions/gl-transactions-data";

const base: Omit<GlTransaction, "id" | "entry_kind" | "amount" | "total" | "status"> = {
  source_type: "invoice",
  source_id: null,
  entry_date: "2026-10-27",
  reference: "INV-1",
  description: "Lights",
  counterparty: "Vendor",
  budget_code: "2101",
  gl_account_id: null,
  department: null,
  vat_amount: 0,
  wht_amount: 0,
  currency: "SAR",
  resolvedCurrency: "SAR",
  qfe_eligible: false,
  organization_id: null,
  project_id: null,
  created_at: "2026-10-27T00:00:00Z",
};
const row = (
  id: string,
  kind: GlTransaction["entry_kind"],
  amount: number,
  status: string | null,
) => ({ ...base, id, entry_kind: kind, amount, total: amount, status }) as GlTransaction;

const meta = {
  projectTag: "MON26",
  projectSlug: "mon26",
  dateFrom: "",
  dateTo: "",
  glName: () => "",
};

describe("GL Transactions export totals (G04)", () => {
  const rows = [
    row("a1", "actual", 300000, "approved"),
    row("a2", "actual", 77934.21, null),
    row("a3", "actual", 5000, "pending"), // not approved: not in Total Actual
    row("p1", "payment", 42000, null),
    row("c1", "commitment", 10000, "approved"),
  ];

  it("buckets rows by the glossary", () => {
    expect(rows.map(glTotalBucket)).toEqual(["actual", "actual", null, "paid", "commitment"]);
  });

  it("never adds payments into the actual total", () => {
    const doc = buildGlTransactionsDoc(rows, meta, { mode: "sar", fx: null }, "xlsx");
    const s = doc.sections[0];
    const amountCol = s.columns.findIndex((c) => c.header.startsWith("Amount"));
    const [actual, paid, commitment] = s.totals!;
    expect(actual[amountCol]).toBe(377934.21);
    expect(paid[amountCol]).toBe(42000);
    expect(commitment[amountCol]).toBe(10000);
    expect(s.rows).toHaveLength(5);
    expect(s.columns[0].type).toBe("date");
    expect(s.notes!.join(" ")).not.toContain("projects.fx_rate");
  });
});
