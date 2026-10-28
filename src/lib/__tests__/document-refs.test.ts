import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  documentLink,
  ilikeContains,
  looksLikeRef,
  normalizeSource,
  parseOpenParam,
} from "@/lib/document-refs";

const ID = "18400000-0000-0000-0000-000000000001";
const PARENT = "18400000-0000-0000-0000-000000000002";

describe("documentLink (G11)", () => {
  it("opens each document type on its own page", () => {
    expect(documentLink("invoice", ID)).toEqual({ to: "/invoices", open: ID, module: "invoices" });
    expect(documentLink("purchase_order", ID)?.to).toBe("/purchase-orders");
    expect(documentLink("petty_cash", ID)?.to).toBe("/petty-cash");
    expect(documentLink("cash_advance", ID)?.to).toBe("/petty-cash");
    expect(documentLink("per_diem", ID)).toEqual({
      to: "/per-diem-ledger",
      open: ID,
      module: "per-diem",
    });
  });
  it("sends a contract to crew or cast by its kind", () => {
    expect(documentLink("payroll", ID, { kind: "cast" })).toEqual({
      to: "/cast",
      open: ID,
      module: "cast-contracts",
    });
    expect(documentLink("payroll", ID, { kind: "crew" })?.to).toBe("/crew");
    expect(documentLink("payroll", ID)?.to).toBe("/crew");
  });
  it("a payment opens its parent document", () => {
    expect(documentLink("payment", ID, { parentType: "po", parentId: PARENT })).toEqual({
      to: "/purchase-orders",
      open: PARENT,
      module: "purchase-orders",
    });
    expect(
      documentLink("payment", ID, { parentType: "payroll", parentId: PARENT, kind: "cast" })?.to,
    ).toBe("/cast");
    expect(documentLink("payment", ID)).toBeNull();
  });
  it("no button for types without a record page", () => {
    expect(documentLink("overtime", ID)).toBeNull();
    expect(documentLink("funding", ID)).toBeNull();
    expect(documentLink("whatever", ID)).toBeNull();
  });
});

describe("helpers", () => {
  it("normalises payment source spellings", () => {
    expect(normalizeSource("receipt")).toBe("petty_cash");
    expect(normalizeSource("cash_advance_receipt")).toBe("petty_cash");
    expect(normalizeSource("PO")).toBe("purchase_order");
  });
  it("accepts only a UUID for ?open=", () => {
    expect(parseOpenParam(ID)).toBe(ID);
    expect(parseOpenParam("<script>")).toBeUndefined();
    expect(parseOpenParam(42)).toBeUndefined();
  });
  it("recognises full and partial references (G08)", () => {
    for (const q of ["MON26-PO-0012", "PO-0012", "po-12", "INV", "MON26-INV", "0012"])
      expect(looksLikeRef(q)).toBe(true);
    for (const q of ["camera", "ab", "Lens rental"]) expect(looksLikeRef(q)).toBe(false);
  });
  it("escapes ILIKE wildcards", () => {
    expect(ilikeContains(" PO_1% ")).toBe("%PO\\_1\\%%");
  });
});

import { refMatches } from "@/lib/document-refs";
import {
  sourceOfDocumentType,
  transactionForDocument,
  transactionFromRegisterRow,
} from "@/features/reports/ledger/ledger-drawer";

describe("G08 reference filter on list pages", () => {
  it("matches partial numbers, any case, dashes optional", () => {
    expect(refMatches("MON26-PO-0012", "")).toBe(true);
    expect(refMatches("MON26-PO-0012", "po-0012")).toBe(true);
    expect(refMatches("MON26-PO-0012", "po0012")).toBe(true);
    expect(refMatches("MON26-PO-0012", " 0012 ")).toBe(true);
    expect(refMatches("MON26-PO-0012", "INV")).toBe(false);
    expect(refMatches(null, "PO")).toBe(false);
  });
});

describe("G09 drawer rows from other reports", () => {
  const id = "51990000-0000-0000-0000-000000000001";
  const ctx = { organizationId: "o", projectId: "p" };
  it("a payments register row opens its payment", () => {
    const r = transactionFromRegisterRow(
      {
        event_key: `payment:${id}`,
        payment_date: "2026-10-01",
        payment_ref: "MON26-PMT-0001",
        payee: "Gulf Lights",
        document_type: "invoice",
        document_id: "51990000-0000-0000-0000-000000000002",
        document_ref: "MON26-INV-0003",
        budget_code: "2101",
        gross: 1150,
      },
      ctx,
    );
    expect(r).toMatchObject({ id, source_type: "payment", entry_kind: "payment", amount: 1150 });
    expect(r?.reference).toBe("MON26-PMT-0001");
  });
  it("falls back to the paid document when the event key is not a document", () => {
    const r = transactionFromRegisterRow(
      {
        event_key: "bank_charge:x",
        payment_date: null,
        payment_ref: null,
        payee: null,
        document_type: "po",
        document_id: id,
        document_ref: "MON26-PO-0001",
        budget_code: null,
        gross: 10,
      },
      ctx,
    );
    expect(r?.source_type).toBe("purchase_order");
  });
  it("needs a real id", () => {
    expect(transactionForDocument("invoice", "nope", {}, ctx)).toBeNull();
    expect(sourceOfDocumentType("cash_advance_receipt")).toBe("petty_cash");
  });
});
