// ═══════════════════════════════════════════════════════════════════
// Film Commission rebate — pure calculations. The database
// (db/pending/197: rebate_amount, count_working_days,
// rebate_period_position, rebate_transactions) is the source of truth;
// these mirror it for the screen, the exports and unit tests.
// ═══════════════════════════════════════════════════════════════════
import type { EligibilityStatus } from "./rebate-types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** rebate = least(rate × QPE, cap). No rate → null (not configured). */
export function rebateAmount(
  ratePct: number | null | undefined,
  qpe: number,
  cap: number | null | undefined,
): number | null {
  if (ratePct == null || !Number.isFinite(ratePct)) return null;
  const raw = (Math.max(0, Number(qpe) || 0) * ratePct) / 100;
  const capped = cap == null || !Number.isFinite(cap) ? raw : Math.min(raw, cap);
  return round2(capped);
}

/**
 * The part of a document's QPE base (excl. VAT) that has been paid:
 * least(base, paid × base / payBasis). payBasis is what the payments settle
 * (invoice incl. VAT net of WHT, contract net payable, …).
 */
export function paidQpeBase(base: number, paid: number, payBasis: number): number {
  if (!(payBasis > 0) || !(paid > 0) || !(base > 0)) return 0;
  return round2(Math.min(base, (paid * base) / payBasis));
}

const DAY = 86_400_000;
const toUtc = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
};

/** Days in [from, to] that are not weekly off days (0 = Sunday … 6 = Saturday). */
export function countWorkingDays(
  from: string | null | undefined,
  to: string | null | undefined,
  offDays: readonly number[],
): number {
  if (!from || !to) return 0;
  const a = toUtc(from);
  const b = toUtc(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  const off = new Set(offDays);
  let n = 0;
  for (let t = a; t <= b; t += DAY) if (!off.has(new Date(t).getUTCDay())) n++;
  return n;
}

export type PeriodPosition = "inside" | "partial" | "outside" | "unknown";

/** Where a date range sits against the official production period. */
export function periodPosition(
  from: string | null | undefined,
  to: string | null | undefined,
  periodFrom: string | null | undefined,
  periodTo: string | null | undefined,
): PeriodPosition {
  if (!periodFrom || !periodTo) return "unknown";
  const f = from ?? to;
  const t = to ?? from;
  if (!f || !t) return "unknown";
  if (t < periodFrom || f > periodTo) return "outside";
  if (f >= periodFrom && t <= periodTo) return "inside";
  return "partial";
}

/** Glossary sign: variance = estimate − actual; positive = saving, negative = over. */
export function qpeVariance(estimate: number, actual: number): number {
  return round2((Number(estimate) || 0) - (Number(actual) || 0));
}

/** Off days that match a working week of `workDays` days (KSA default: Fri + Sat). */
export function defaultOffDays(workDays: number): number[] {
  const order = [5, 6, 4, 0, 3, 2, 1]; // Fri, Sat, Thu, Sun, …
  return order.slice(0, Math.max(0, Math.min(7, 7 - workDays))).sort((a, b) => a - b);
}

export function statusTone(s: EligibilityStatus): "success" | "warning" | "destructive" {
  return s === "eligible" ? "success" : s === "needs_review" ? "warning" : "destructive";
}

export function sumBy<T>(rows: readonly T[], pick: (r: T) => number | null | undefined): number {
  return round2(rows.reduce((s, r) => s + (Number(pick(r)) || 0), 0));
}

/** Rows that go on the official forms (5.6 / 5.7): eligible ones only. */
export function formRows<T extends { status: EligibilityStatus }>(
  rows: readonly T[],
  includeAll = false,
): T[] {
  return includeAll ? [...rows] : rows.filter((r) => r.status === "eligible");
}
