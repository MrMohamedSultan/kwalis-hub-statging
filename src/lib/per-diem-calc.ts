/**
 * X13 — per diem arithmetic, identical to the database trigger
 * public.per_diem_compute_total (db/pending/195):
 *   total = shoot_days × on_set_rate + off_days × off_set_rate, rounded to 2 dp.
 * Totals only count rows that are SAVED (have an id): the suggested draft
 * row shown for every person is not money until it is saved.
 */
export type PerDiemLike = {
  id?: string | null;
  person_id?: string;
  shoot_days: number;
  off_days: number;
  on_set_rate: number;
  off_set_rate: number;
  status: "pending" | "paid" | string;
  currency: string;
  budget_code?: string | null;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function perDiemRowTotal(
  r: Pick<PerDiemLike, "shoot_days" | "off_days" | "on_set_rate" | "off_set_rate">,
): number {
  const v =
    (Number(r.shoot_days) || 0) * (Number(r.on_set_rate) || 0) +
    (Number(r.off_days) || 0) * (Number(r.off_set_rate) || 0);
  return round2(v);
}

export type PerDiemTotals = {
  paid: Record<string, number>;
  pending: Record<string, number>;
  days: { shoot: number; off: number };
  rows: number;
};

export function perDiemTotals(rows: PerDiemLike[]): PerDiemTotals {
  const out: PerDiemTotals = { paid: {}, pending: {}, days: { shoot: 0, off: 0 }, rows: 0 };
  for (const r of rows) {
    if (!r.id) continue;
    const bucket = r.status === "paid" ? out.paid : out.pending;
    const ccy = (r.currency || "SAR").toUpperCase();
    bucket[ccy] = round2((bucket[ccy] ?? 0) + perDiemRowTotal(r));
    out.days.shoot += Number(r.shoot_days) || 0;
    out.days.off += Number(r.off_days) || 0;
    out.rows += 1;
  }
  return out;
}

/** SAR equivalent of a currency map (USD × project rate; SAR as is). */
export function toSar(byCurrency: Record<string, number>, sarPerUsd: number): number {
  let sum = 0;
  for (const [ccy, v] of Object.entries(byCurrency)) {
    sum += ccy === "USD" ? v * (Number(sarPerUsd) || 0) : v;
  }
  return round2(sum);
}

export type PerDiemGroup = {
  key: string;
  paid: Record<string, number>;
  pending: Record<string, number>;
  shootDays: number;
  offDays: number;
  rows: number;
};

/** Saved rows grouped by person or budget code (for the report). */
export function groupPerDiem(rows: PerDiemLike[], by: "person" | "code"): PerDiemGroup[] {
  const map = new Map<string, PerDiemLike[]>();
  for (const r of rows) {
    if (!r.id) continue;
    const key = (by === "person" ? r.person_id : r.budget_code) || "";
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const t = perDiemTotals(list);
      return {
        key,
        paid: t.paid,
        pending: t.pending,
        shootDays: t.days.shoot,
        offDays: t.days.off,
        rows: t.rows,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
