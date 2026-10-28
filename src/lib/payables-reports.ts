// =====================================================================
// Pure calculations behind the new reports (no I/O, unit tested):
//   N05 Payments Due      — unpaid instalments + invoices, days overdue, week / month window
//   N06 AP Aging          — what is payable (Actual − Paid) by payee, 0–30 / 31–60 / 61–90 / 90+
//   N07 Open POs          — PO value − matched invoices
//   N08 Petty Cash Recon  — issued, spent (approved receipts), returned, remaining; cash limits
//   R12 Payments Register — filters and totals per paid-from account
// =====================================================================
import { round2 } from "@/lib/ap-calc";

const DAY = 86_400_000;
const isoDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** Whole days from `due` to `today` (positive = overdue), null without a due date. */
export function daysOverdue(due: string | null | undefined, today: string): number | null {
  if (!due || !/^\d{4}-\d{2}-\d{2}/.test(due)) return null;
  return Math.round((isoDay(today) - isoDay(due.slice(0, 10))) / DAY);
}

/** Monday of the ISO week of `iso`. */
export function weekStart(iso: string): string {
  const t = isoDay(iso);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(t - dow * DAY).toISOString().slice(0, 10);
}

export type DueWindow = "all" | "overdue" | "this_week" | "this_month" | "next_30";

/** N05 filter: is a due date inside the window (overdue items always count in week / month). */
export function inDueWindow(due: string | null, window: DueWindow, today: string): boolean {
  if (window === "all") return true;
  const d = daysOverdue(due, today);
  if (d == null) return window === "overdue" ? false : true;
  if (window === "overdue") return d > 0;
  if (d > 0) return true; // overdue items stay visible in every forward window
  const dueIso = due!.slice(0, 10);
  if (window === "this_week") {
    const ws = weekStart(today);
    const we = new Date(isoDay(ws) + 6 * DAY).toISOString().slice(0, 10);
    return dueIso <= we;
  }
  if (window === "this_month") return dueIso.slice(0, 7) <= today.slice(0, 7);
  return -d <= 30; // next_30
}

export type DueItem = {
  key: string;
  kind: "instalment" | "invoice";
  payee: string;
  ref: string | null;
  instalment: string | null;
  dueDate: string | null;
  /** Amount still to pay (net, SAR). */
  amount: number;
  /** Glossary status: Pending / Requested / Approved (instalments), Approved (invoices). */
  status: string;
  /** Payable = Actual not paid yet (approved instalments, invoices); Pending / Requested are Commitment. */
  payable: boolean;
  sourceId: string;
  /** E08 fields of an invoice item (PO ref, currency / FX + source, service dates, related party). */
  e08?: {
    poRef?: string | null;
    currency?: string | null;
    fxRate?: number | null;
    amountOriginal?: number | null;
    fxRateSource?: string | null;
    fxRateDate?: string | null;
    servicePeriodFrom?: string | null;
    servicePeriodTo?: string | null;
    serviceReceivedDate?: string | null;
    isRelatedParty?: boolean | null;
    relatedPartyNote?: string | null;
  };
};

/** Payees with at least one related-party invoice among the items (E08). */
export function relatedPartyPayees(items: DueItem[]): Set<string> {
  return new Set(items.filter((i) => i.e08?.isRelatedParty).map((i) => i.payee));
}

export type DueRow = DueItem & { daysOverdue: number | null };

export function paymentsDue(items: DueItem[], window: DueWindow, today: string): DueRow[] {
  return items
    .filter((i) => i.amount > 0.005 && inDueWindow(i.dueDate, window, today))
    .map((i) => ({ ...i, daysOverdue: daysOverdue(i.dueDate, today) }))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
}

export const AGING_BUCKETS = ["0_30", "31_60", "61_90", "90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Age bucket of an overdue count (not yet due and undated count as 0–30). */
export function agingBucket(days: number | null): AgingBucket {
  const d = Math.max(0, days ?? 0);
  if (d <= 30) return "0_30";
  if (d <= 60) return "31_60";
  if (d <= 90) return "61_90";
  return "90_plus";
}

export type AgingRow = { payee: string; items: number; total: number } & Record<
  AgingBucket,
  number
>;

/** N06: payables only (Actual − Paid), grouped by payee, aged on the due date. */
export function apAging(items: DueItem[], today: string): { rows: AgingRow[]; totals: AgingRow } {
  const by = new Map<string, AgingRow>();
  const empty = (payee: string): AgingRow => ({
    payee,
    items: 0,
    total: 0,
    "0_30": 0,
    "31_60": 0,
    "61_90": 0,
    "90_plus": 0,
  });
  const totals = empty("");
  for (const i of items) {
    if (!i.payable || i.amount <= 0.005) continue;
    const b = agingBucket(daysOverdue(i.dueDate, today));
    const r = by.get(i.payee) ?? empty(i.payee);
    for (const x of [r, totals]) {
      x[b] = round2(x[b] + i.amount);
      x.total = round2(x.total + i.amount);
      x.items += 1;
    }
    by.set(i.payee, r);
  }
  return { rows: [...by.values()].sort((a, b) => b.total - a.total), totals };
}

export type OpenPoInput = {
  id: string;
  ref: string | null;
  vendor: string | null;
  budgetCode: string | null;
  status: string | null;
  date: string | null;
  amount: number;
};
export type OpenPoRow = OpenPoInput & { invoiced: number; invoiceCount: number; open: number };

/** N07: PO value − invoices matched to it (invoices.purchase_order_id), only the ones still open. */
export function openPurchaseOrders(
  pos: OpenPoInput[],
  invoices: { purchaseOrderId: string | null; price: number }[],
): OpenPoRow[] {
  const inv = new Map<string, { sum: number; n: number }>();
  for (const i of invoices) {
    if (!i.purchaseOrderId) continue;
    const c = inv.get(i.purchaseOrderId) ?? { sum: 0, n: 0 };
    c.sum += Number(i.price) || 0;
    c.n += 1;
    inv.set(i.purchaseOrderId, c);
  }
  const closed = /^(cancel|reject|closed|void)/i;
  return pos
    .filter((p) => !closed.test(p.status ?? ""))
    .map((p) => {
      const m = inv.get(p.id) ?? { sum: 0, n: 0 };
      return {
        ...p,
        invoiced: round2(m.sum),
        invoiceCount: m.n,
        open: round2(Math.max(0, p.amount - m.sum)),
      };
    })
    .filter((p) => p.open > 0.005);
}

export type CashLimits = {
  pctOfQpe: number;
  perTxn: number;
  /** "settings" when read from the project's Film Commission settings, else the defaults below. */
  source: "settings" | "default";
};
/** Used until the project's Film Commission settings set them (the documents differ per agreement). */
export const DEFAULT_CASH_LIMITS: CashLimits = { pctOfQpe: 10, perTxn: 5000, source: "default" };

/** Reads the limits from a project_rebate_settings row (db/pending/197) when it has them. */
export function resolveCashLimits(row: Record<string, unknown> | null | undefined): CashLimits {
  const num = (v: unknown) =>
    v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  const pct = num(row?.cash_limit_pct_of_qpe);
  const txn = num(row?.cash_limit_per_txn_sar);
  if (pct == null && txn == null) return DEFAULT_CASH_LIMITS;
  return {
    pctOfQpe: pct ?? DEFAULT_CASH_LIMITS.pctOfQpe,
    perTxn: txn ?? DEFAULT_CASH_LIMITS.perTxn,
    source: "settings",
  };
}

export type FloatInput = { id: string; holder: string; ref: string | null; issued: number };
export type PettyRow = FloatInput & {
  spent: number;
  pending: number;
  returned: number;
  remaining: number;
  receipts: number;
  overLimit: number;
};

/** N08: per float — issued, spent with approved receipts, returned to the bank, remaining. */
export function pettyCashRecon(
  floats: FloatInput[],
  receipts: { advanceId: string | null; amount: number; status: string }[],
  returns: { cashAdvanceId: string | null; amount: number }[],
  limits: CashLimits,
): { rows: PettyRow[]; totals: Omit<PettyRow, "id" | "holder" | "ref"> } {
  const rows = floats.map((f) => {
    const rs = receipts.filter((r) => r.advanceId === f.id);
    const spent = round2(
      rs.filter((r) => r.status === "approved").reduce((a, r) => a + r.amount, 0),
    );
    const pending = round2(
      rs.filter((r) => r.status === "pending").reduce((a, r) => a + r.amount, 0),
    );
    const returned = round2(
      returns.filter((r) => r.cashAdvanceId === f.id).reduce((a, r) => a + r.amount, 0),
    );
    return {
      ...f,
      issued: round2(f.issued),
      spent,
      pending,
      returned,
      remaining: round2(f.issued - spent - returned),
      receipts: rs.filter((r) => r.status === "approved").length,
      overLimit: rs.filter((r) => r.status !== "rejected" && r.amount > limits.perTxn + 0.005)
        .length,
    };
  });
  const sum = (
    k: "issued" | "spent" | "pending" | "returned" | "remaining" | "receipts" | "overLimit",
  ) => round2(rows.reduce((a, r) => a + r[k], 0));
  return {
    rows,
    totals: {
      issued: sum("issued"),
      spent: sum("spent"),
      pending: sum("pending"),
      returned: sum("returned"),
      remaining: sum("remaining"),
      receipts: sum("receipts"),
      overLimit: sum("overLimit"),
    },
  };
}

/** Cash share of the qualifying spend, in % (null when there is no spend yet). */
export function cashShareOfQpe(cashSpent: number, qpe: number): number | null {
  return qpe > 0.005 ? round2((cashSpent / qpe) * 100) : null;
}

// ------------------------------------------------------------ R12 Payments Register

export type RegisterRow = {
  event_key: string;
  event_type: string;
  payment_date: string;
  payment_ref: string | null;
  payee: string | null;
  document_type: string | null;
  document_id: string | null;
  document_ref: string | null;
  instalment: string | null;
  budget_code: string | null;
  method: string | null;
  paid_from_code: string | null;
  paid_from_name: string | null;
  gross: number;
  wht: number;
  net: number;
};

export type RegisterFilter = {
  payee?: string;
  code?: string;
  method?: string;
  /** G08: payment or document reference number (partial). */
  ref?: string;
};

export function filterRegister(rows: RegisterRow[], f: RegisterFilter): RegisterRow[] {
  const has = (v: string | null, q?: string) =>
    !q?.trim() || (v ?? "").toLowerCase().includes(q.trim().toLowerCase());
  return rows.filter(
    (r) =>
      has(r.payee, f.payee) &&
      has(r.budget_code, f.code) &&
      (has(r.payment_ref, f.ref) || has(r.document_ref, f.ref)) &&
      (!f.method || f.method === "all" || r.method === f.method),
  );
}

export type RegisterTotals = {
  gross: number;
  wht: number;
  net: number;
  /** Net per paid-from account code; "9100" is the bank total (= GL bank credits). */
  byAccount: { code: string; name: string; net: number; count: number }[];
  bank: number;
};

export function registerTotals(rows: RegisterRow[]): RegisterTotals {
  const by = new Map<string, { code: string; name: string; net: number; count: number }>();
  let gross = 0;
  let wht = 0;
  let net = 0;
  for (const r of rows) {
    gross += Number(r.gross) || 0;
    wht += Number(r.wht) || 0;
    net += Number(r.net) || 0;
    const code = r.paid_from_code ?? "";
    const a = by.get(code) ?? { code, name: r.paid_from_name ?? "", net: 0, count: 0 };
    a.net = round2(a.net + (Number(r.net) || 0));
    a.count += 1;
    by.set(code, a);
  }
  const byAccount = [...by.values()].sort((a, b) => a.code.localeCompare(b.code));
  return {
    gross: round2(gross),
    wht: round2(wht),
    net: round2(net),
    byAccount,
    bank: byAccount.find((a) => a.code === "9100")?.net ?? 0,
  };
}
