// =====================================================================
// Accounts-payable calculations (pure, unit-tested in __tests__/ap-calc.test.ts).
//
// Amounts are in the record currency (SAR) unless a name says otherwise.
// The SQL side (db/pending/174) mirrors: payment_term_days,
// default_gl_code_for_budget_code, car_rentals.total_amount,
// accommodations.nights / total_amount. Keep both in step.
// =====================================================================

export const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------- VAT (E07)

export const VAT_TREATMENTS = ["standard", "zero_rated", "exempt", "reverse_charge"] as const;
export type VatTreatment = (typeof VAT_TREATMENTS)[number];

/** Fallback when the platform setting `vat_standard_rate_pct` cannot be read. */
export const DEFAULT_VAT_RATE_PCT = 15;
/** Accepted difference between the VAT on the vendor's invoice and rate × net (rounding). */
export const VAT_ROUNDING_TOLERANCE = 1;

export function normalizeVatTreatment(v: unknown, legacyVatable?: boolean): VatTreatment {
  if (typeof v === "string" && (VAT_TREATMENTS as readonly string[]).includes(v)) {
    return v as VatTreatment;
  }
  return legacyVatable === false ? "exempt" : "standard";
}

/** VAT the vendor charges on the invoice. Reverse charge: the buyer self-accounts, vendor charges 0. */
export function expectedVat(net: number, treatment: VatTreatment, ratePct: number): number {
  if (treatment !== "standard") return 0;
  return round2((Number(net) || 0) * ((Number(ratePct) || 0) / 100));
}

/** Entered VAT matches the expected VAT within the rounding tolerance (1,500.01 vs 1,500 is fine). */
export function vatWithinTolerance(
  entered: number,
  expected: number,
  tolerance = VAT_ROUNDING_TOLERANCE,
): boolean {
  return Math.abs((Number(entered) || 0) - (Number(expected) || 0)) <= tolerance + 1e-9;
}

// ------------------------------------------------- invoice totals (B06 B16)

type InvoiceAmounts = { price: number; vatAmount?: number | null; whtAmount?: number | null };

/** Invoice total incl. VAT (what the vendor bills). */
export function invoiceGrossTotal(i: InvoiceAmounts): number {
  return round2((Number(i.price) || 0) + (Number(i.vatAmount) || 0));
}

/** What the vendor actually receives: excl. VAT + VAT − WHT withheld. Basis of payment requests and status. */
export function invoiceAmountDue(i: InvoiceAmounts): number {
  return round2(invoiceGrossTotal(i) - (Number(i.whtAmount) || 0));
}

// ------------------------------------------------------ due date (B15)

/** "Net 30" → 30, "Advance" → 0, unknown → null. */
export function paymentTermDays(terms: string | null | undefined): number | null {
  if (!terms || !terms.trim()) return null;
  const t = terms.trim().toLowerCase();
  if (t === "advance" || t === "due on receipt" || t === "immediate") return 0;
  const m = t.match(/(\d+)/);
  return m ? Math.min(Number(m[1]), 3650) : null;
}

/** Adds whole days to an ISO date (YYYY-MM-DD), timezone-safe. */
export function addDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Invoice date + payment terms; falls back to the invoice date when terms are unknown. */
export function dueDateFromTerms(invoiceDateIso: string, terms: string | null | undefined): string {
  if (!invoiceDateIso) return "";
  const days = paymentTermDays(terms);
  return addDaysIso(invoiceDateIso, days ?? 0);
}

// ------------------------------------------------------ currency (B09 E08)

/** Converts an amount in a foreign currency to the record currency. */
export function toBaseAmount(original: number, fxRate: number): number {
  const rate = Number(fxRate);
  return round2((Number(original) || 0) * (Number.isFinite(rate) && rate > 0 ? rate : 1));
}

// ------------------------------------------------ PO ↔ invoice (B05 X12)

export type PoMatch = {
  /** PO value not yet invoiced before this invoice. */
  openBefore: number;
  /** this invoice − openBefore; > 0 over-invoiced, < 0 under. */
  difference: number;
  status: "match" | "under" | "over";
};

/**
 * Compares an invoice with the PO it is raised against.
 * `otherInvoiced` = excl.-VAT total of the OTHER invoices already on the PO.
 */
export function matchInvoiceToPo(
  poAmount: number,
  otherInvoiced: number,
  invoiceAmount: number,
): PoMatch {
  const openBefore = round2(Math.max(0, (Number(poAmount) || 0) - (Number(otherInvoiced) || 0)));
  const difference = round2((Number(invoiceAmount) || 0) - openBefore);
  const status = Math.abs(difference) < 0.01 ? "match" : difference > 0 ? "over" : "under";
  return { openBefore, difference, status };
}

// ------------------------------------------------------ GL account (E09)

/**
 * Default GL code for a budget code range, used when no budget_code_gl_map
 * row applies. Mirrors public.default_gl_code_for_budget_code (db/pending/174).
 */
export function defaultGlCodeForBudgetCode(code: string | null | undefined): string {
  const h = /^(\d{2})/.exec((code ?? "").trim())?.[1];
  if (!h) return "GL-4400";
  const n = Number(h);
  if (n === 10 || n === 11) return "GL-1000";
  if (n === 12) return "GL-1100";
  if (n === 13) return "GL-1200";
  if (n === 14 || n === 15) return "GL-1300";
  if (n >= 16 && n <= 19) return "GL-1400";
  if (n === 20) return "GL-2000";
  if (n === 21) return "GL-2800";
  if (n >= 22 && n <= 25) return "GL-2300";
  if (n === 26) return "GL-2600";
  if (n === 27 || n === 28) return "GL-2400";
  if (n === 29 || n === 30) return "GL-2200";
  if (n === 31 || n === 35) return "GL-2100";
  if (n === 32) return "GL-2700";
  if (n === 33) return "GL-2300";
  if (n === 34) return "GL-2500";
  if (n === 36) return "GL-2600";
  if (n === 37) return "GL-4400";
  if (n === 38) return "GL-3000";
  if (n >= 39 && n <= 49) return "GL-2000";
  if (n === 50 || n === 51) return "GL-3000";
  if (n === 52 || n === 54) return "GL-3400";
  if (n === 53) return "GL-3200";
  if (n === 55) return "GL-4500";
  if (n === 56) return "GL-4100";
  if (n === 60) return "GL-3300";
  if (n === 61) return "GL-3100";
  if (n >= 57 && n <= 69) return "GL-3400";
  if (n === 72) return "GL-4000";
  return "GL-4400";
}

/** Resolves the GL account id for a budget code: explicit mapping first, then the range default. */
export function deriveGlAccountId(
  budgetCode: string | null | undefined,
  accounts: { id: string; code: string; isActive?: boolean }[],
  mappedId?: string | null,
): string | null {
  if (mappedId) return mappedId;
  if (!budgetCode || !budgetCode.trim()) return null;
  const want = defaultGlCodeForBudgetCode(budgetCode);
  const hit = accounts.find((a) => a.code === want && a.isActive !== false);
  return hit?.id ?? accounts.find((a) => a.code === "GL-4400")?.id ?? null;
}

// --------------------------------------------- car rental / hotel (B20)

function isoDayNumber(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** Rental days, both ends included (1 → 10 Oct = 10 days). 0 when dates are missing/invalid. */
export function rentalDays(
  start: string | null | undefined,
  end: string | null | undefined,
): number {
  const s = isoDayNumber(start);
  const e = isoDayNumber(end);
  if (s == null || e == null || e < s) return 0;
  return e - s + 1;
}

export function rentalTotal(r: {
  rate_type: "daily" | "monthly" | string;
  daily_rate: number;
  monthly_rate: number;
  rental_start_date: string | null | undefined;
  rental_end_date: string | null | undefined;
}): number {
  const days = rentalDays(r.rental_start_date, r.rental_end_date);
  if (!days) return 0;
  if (r.rate_type === "monthly") return round2((days / 30) * (Number(r.monthly_rate) || 0));
  return round2(days * (Number(r.daily_rate) || 0));
}

/** Hotel nights (check-out day not counted: 1 → 11 Oct = 10 nights). */
export function stayNights(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): number {
  const s = isoDayNumber(checkIn);
  const e = isoDayNumber(checkOut);
  if (s == null || e == null || e < s) return 0;
  return e - s;
}

export function stayTotal(nights: number, nightlyRate: number): number {
  return round2(Math.max(0, nights) * (Number(nightlyRate) || 0));
}
