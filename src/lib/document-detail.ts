// ═══════════════════════════════════════════════════════════════════
// Plain-language view of one financial document (G09 / G10) — pure
// helpers used by the transaction detail drawer. No React, no Supabase.
// ═══════════════════════════════════════════════════════════════════

import { invoiceAmountDue, invoiceGrossTotal } from "@/lib/ap-calc";

type Row = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface DocumentAmounts {
  gross: number;
  wht: number;
  net: number;
}

/** Gross / WHT / Net of a document (Net = Gross − WHT, glossary). */
export function documentAmounts(source: string, r: Row): DocumentAmounts {
  switch (source) {
    case "invoice": {
      const i = { price: num(r.price), vatAmount: num(r.vat_amount), whtAmount: num(r.wht_amount) };
      return { gross: invoiceGrossTotal(i), wht: round2(i.whtAmount), net: invoiceAmountDue(i) };
    }
    case "payroll": {
      const gross = round2(num(r.total_amount));
      const wht = round2(num(r.wht_amount));
      const net = r.net_payable == null ? round2(gross - wht) : round2(num(r.net_payable));
      return { gross, wht, net };
    }
    case "per_diem":
      return flat(num(r.total_amount));
    case "cash_advance":
      return flat(num(r.total_advance));
    default:
      return flat(num(r.amount));
  }
}
function flat(n: number): DocumentAmounts {
  const v = round2(n);
  return { gross: v, wht: 0, net: v };
}

/** The human name of a document: who it is with and what it is for. */
export function documentName(source: string, r: Row, fallback?: string | null): string | null {
  const parts: (string | null)[] = (() => {
    switch (source) {
      case "invoice":
        return [str(r.vendor_name), str(r.description)];
      case "payroll":
        return [str(r.name)];
      case "purchase_order":
        return [str(r.vendor_name), str(r.description)];
      case "petty_cash":
        return [str(r.vendor) ?? str(r.recipient), str(r.description)];
      case "cash_advance":
        return [str(r.holder)];
      case "overtime":
        return [str(r.person_name)];
      case "funding":
        return [str(r.source)];
      default:
        return [];
    }
  })();
  const out = parts.filter(Boolean).join(" — ");
  return out || str(fallback) || null;
}

/** The vendor's / other party's own number, kept apart from ref_no (G08). */
export function externalNumber(source: string, r: Row): string | null {
  if (source === "invoice") return str(r.invoice_no);
  if (source === "purchase_order") {
    const po = str(r.po_number);
    return po && po !== str(r.ref_no) ? po : null;
  }
  if (source === "funding") return str(r.reference);
  return null;
}

export interface ScheduleRow {
  id: string;
  label: string;
  percent: number | null;
  amount: number;
  dueDate: string | null;
  status: string;
  paidDate: string | null;
  method: string | null;
  receipt: string | null;
}

/**
 * payment_schedule (jsonb) as table rows. A milestone with no explicit
 * amount is percent × contract value — the same rule the database uses
 * (db/pending/160).
 */
export function scheduleRows(raw: unknown, contractValue: number): ScheduleRow[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((e): e is Row => !!e && typeof e === "object")
    .map((e, i) => {
      const pct = e.percent == null || e.percent === "" ? null : num(e.percent);
      const explicit = e.amount == null || e.amount === "" ? null : num(e.amount);
      const amount = round2(explicit ?? ((pct ?? 0) * num(contractValue)) / 100);
      return {
        id: str(e.id) ?? String(i),
        label: str(e.label) ?? `#${i + 1}`,
        percent: pct,
        amount,
        dueDate: str(e.dueDate) ?? str(e.due_date),
        status: str(e.status) ?? "Pending",
        paidDate: str(e.paidDate) ?? str(e.paid_date),
        method: str(e.paymentMethod) ?? str(e.payment_method),
        receipt: str(e.receiptUrl) ?? str(e.proofPath) ?? str(e.paidRef),
      };
    });
}

export function scheduleTotal(rows: ScheduleRow[]): { amount: number; percent: number } {
  return {
    amount: round2(rows.reduce((s, r) => s + r.amount, 0)),
    percent: round2(rows.reduce((s, r) => s + (r.percent ?? 0), 0)),
  };
}

/** User ids worth resolving to names for a record. */
export function recordUserIds(r: Row): string[] {
  const keys = [
    "created_by",
    "updated_by",
    "approved_by",
    "recorded_by",
    "requested_by",
    "submitted_by",
  ];
  return Array.from(new Set(keys.map((k) => str(r[k])).filter((v): v is string => !!v)));
}
