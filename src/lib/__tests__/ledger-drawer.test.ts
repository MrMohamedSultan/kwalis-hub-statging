import { describe, expect, it } from "vitest";
import {
  documentOfEventKey,
  transactionFromLedgerLine,
} from "@/features/reports/ledger/ledger-drawer";

const id = "51960000-0000-0000-0000-000000000001";

describe("General Ledger line → drawer document", () => {
  it("reads the document from the event key", () => {
    expect(documentOfEventKey(`instalment:${id}:m1`)).toEqual({
      source: "payroll",
      id,
      instalment: "m1",
    });
    expect(documentOfEventKey(`petty_issue:${id}`)?.source).toBe("cash_advance");
    expect(documentOfEventKey(`treasury:${id}`)?.source).toBe("treasury");
    expect(documentOfEventKey("x:y")).toBeNull();
    expect(documentOfEventKey("invoice:not-a-uuid")).toBeNull();
  });
  it("builds the drawer row with the line amount", () => {
    const row = transactionFromLedgerLine(
      {
        entry_ref: null,
        entry_seq: 1,
        event_key: `payment:${id}`,
        event_type: "payment",
        entry_date: "2026-09-10",
        line_no: 2,
        gl_account_id: "g",
        gl_code: "9100",
        gl_name: "Bank",
        debit: 0,
        credit: 11000,
        running_balance: 0,
        party: "Gaffer Co",
        budget_code: "1403",
        reference: "INV-77",
        description: "Payment — Invoice — Gaffer Co",
        department: null,
        status: "Paid",
        qpe_eligible: false,
        is_reversal: false,
        phase: 1,
      },
      { organizationId: "o", projectId: "p" },
    );
    expect(row).toMatchObject({
      id,
      source_type: "payment",
      entry_kind: "payment",
      amount: 11000,
      counterparty: "Gaffer Co",
    });
  });
});
