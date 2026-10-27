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
