// =====================================================================
// GSR — Global Spend Report (N03, decision 15) — pure calculations.
//
// Source: payments only (the Payments Register's money out), one row per
// payment from public.get_gsr_payments (db/pending/198). Country = the
// payee's bank country stored on the payment at payment time; petty cash,
// cash and local payments = Saudi Arabia; nothing recorded = Unspecified.
// Layout follows the client GSR template (drive/03): by tag (TYPE-COUNTRY),
// country × type (Crew / Cast / Vendor), spent in Saudi Arabia vs outside.
// Amounts SAR.
// =====================================================================

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const SAUDI = "Saudi Arabia";
export const UNSPECIFIED = "Unspecified";

export type GsrPayeeType = "crew" | "cast" | "vendor" | "petty_cash" | "other";
export type GsrSpendType = "Crew" | "Cast" | "Vendor";
export const GSR_SPEND_TYPES: GsrSpendType[] = ["Crew", "Cast", "Vendor"];

export interface GsrPayment {
  payment_id: string;
  payment_date: string | null;
  country: string;
  city: string | null;
  bank_name: string | null;
  payee: string;
  payee_type: GsrPayeeType | string;
  source_type: string;
  source_id: string;
  currency: string;
  amount_original: number | null;
  amount_sar: number;
  wht: number;
  method: string | null;
  /** db/pending/203: a payment on an invoice that is not approved (listed, flagged). */
  invoice_not_approved?: boolean;
}

/** Template spend type: petty cash and other payments are vendors. */
export function spendTypeOf(t: string): GsrSpendType {
  if (t === "crew") return "Crew";
  if (t === "cast") return "Cast";
  return "Vendor";
}

/** GSR tag TYPE-COUNTRY (CREW-KSA, VENDOR-EGYPT …). */
export function gsrTag(type: GsrSpendType, country: string): string {
  const c = country === SAUDI ? "KSA" : country.toUpperCase().replace(/\s+/g, "-");
  return `${type.toUpperCase()}-${c}`;
}

export interface GsrCountryRow {
  country: string;
  banks: string[];
  payments: number;
  payees: number;
  amountSar: number;
  /** Σ in each original currency. */
  original: Record<string, number>;
  pct: number;
  wht: number;
  rows: GsrPayment[];
}

export interface GsrTagRow {
  tag: string;
  spendType: GsrSpendType;
  country: string;
  amountSar: number;
  pct: number;
}

export interface GsrMatrixRow {
  country: string;
  byType: Record<GsrSpendType, number>;
  total: number;
  pct: number;
}

export interface GsrReport {
  total: number;
  wht: number;
  countries: GsrCountryRow[];
  tags: GsrTagRow[];
  matrix: GsrMatrixRow[];
  typeTotals: Record<GsrSpendType, number>;
  typePct: Record<GsrSpendType, number>;
  local: number;
  international: number;
  unspecified: number;
}

const pctOf = (v: number, total: number) => (total !== 0 ? round2((v / total) * 100) : 0);

export function buildGsr(payments: GsrPayment[]): GsrReport {
  const total = round2(payments.reduce((a, p) => a + num(p.amount_sar), 0));
  const byCountry = new Map<string, GsrPayment[]>();
  for (const p of payments) {
    const c = (p.country || UNSPECIFIED).trim() || UNSPECIFIED;
    const list = byCountry.get(c) ?? [];
    list.push(p);
    byCountry.set(c, list);
  }
  const countries: GsrCountryRow[] = Array.from(byCountry.entries()).map(([country, rows]) => {
    const original: Record<string, number> = {};
    for (const r of rows) {
      if (r.amount_original == null) continue;
      const cur = r.currency || "SAR";
      original[cur] = round2((original[cur] ?? 0) + num(r.amount_original));
    }
    const amountSar = round2(rows.reduce((a, r) => a + num(r.amount_sar), 0));
    return {
      country,
      banks: Array.from(
        new Set(rows.map((r) => r.bank_name).filter((b): b is string => !!b)),
      ).sort(),
      payments: rows.length,
      payees: new Set(rows.map((r) => `${r.payee_type}|${r.payee.trim().toLowerCase()}`)).size,
      amountSar,
      original,
      pct: pctOf(amountSar, total),
      wht: round2(rows.reduce((a, r) => a + num(r.wht), 0)),
      rows,
    };
  });
  countries.sort(
    (a, b) =>
      Number(a.country === UNSPECIFIED) - Number(b.country === UNSPECIFIED) ||
      b.amountSar - a.amountSar ||
      a.country.localeCompare(b.country),
  );

  const tagMap = new Map<string, GsrTagRow>();
  const typeTotals: Record<GsrSpendType, number> = { Crew: 0, Cast: 0, Vendor: 0 };
  const matrixMap = new Map<string, GsrMatrixRow>();
  for (const p of payments) {
    const type = spendTypeOf(p.payee_type);
    const country = (p.country || UNSPECIFIED).trim() || UNSPECIFIED;
    const amt = num(p.amount_sar);
    const tag = gsrTag(type, country);
    const tr = tagMap.get(tag) ?? { tag, spendType: type, country, amountSar: 0, pct: 0 };
    tr.amountSar += amt;
    tagMap.set(tag, tr);
    typeTotals[type] += amt;
    const mr = matrixMap.get(country) ?? {
      country,
      byType: { Crew: 0, Cast: 0, Vendor: 0 },
      total: 0,
      pct: 0,
    };
    mr.byType[type] += amt;
    mr.total += amt;
    matrixMap.set(country, mr);
  }
  const tags = Array.from(tagMap.values())
    .map((r) => ({ ...r, amountSar: round2(r.amountSar), pct: pctOf(r.amountSar, total) }))
    .sort((a, b) => b.amountSar - a.amountSar || a.tag.localeCompare(b.tag));
  const matrix = Array.from(matrixMap.values())
    .map((r) => ({
      ...r,
      byType: {
        Crew: round2(r.byType.Crew),
        Cast: round2(r.byType.Cast),
        Vendor: round2(r.byType.Vendor),
      },
      total: round2(r.total),
      pct: pctOf(r.total, total),
    }))
    .sort((a, b) => b.total - a.total);
  for (const k of GSR_SPEND_TYPES) typeTotals[k] = round2(typeTotals[k]);
  const sumWhere = (f: (c: string) => boolean) =>
    round2(countries.filter((c) => f(c.country)).reduce((a, c) => a + c.amountSar, 0));
  return {
    total,
    wht: round2(payments.reduce((a, p) => a + num(p.wht), 0)),
    countries,
    tags,
    matrix,
    typeTotals,
    typePct: {
      Crew: pctOf(typeTotals.Crew, total),
      Cast: pctOf(typeTotals.Cast, total),
      Vendor: pctOf(typeTotals.Vendor, total),
    },
    local: sumWhere((c) => c === SAUDI),
    international: sumWhere((c) => c !== SAUDI && c !== UNSPECIFIED),
    unspecified: sumWhere((c) => c === UNSPECIFIED),
  };
}

/** Payees of one country with their payments (drill-down). */
export function payeesOf(row: GsrCountryRow) {
  const map = new Map<
    string,
    { payee: string; type: string; amountSar: number; wht: number; payments: GsrPayment[] }
  >();
  for (const p of row.rows) {
    const k = `${p.payee_type}|${p.payee.trim().toLowerCase()}`;
    const e = map.get(k) ?? {
      payee: p.payee,
      type: p.payee_type,
      amountSar: 0,
      wht: 0,
      payments: [],
    };
    e.amountSar = round2(e.amountSar + num(p.amount_sar));
    e.wht = round2(e.wht + num(p.wht));
    e.payments.push(p);
    map.set(k, e);
  }
  return Array.from(map.values()).sort((a, b) => b.amountSar - a.amountSar);
}
