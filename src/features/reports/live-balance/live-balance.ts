// =====================================================================
// Live Balance (N02 / D10 / D11, decision 16) — pure calculations.
//
// Incurred to date = the contract value spread over time by the contract's
// accrual method, as of a date:
//   work_days   working days (Sun–Thu) of the contract period
//   shoot_days  shoot days of the shooting schedule inside the period
//   weekly      week rate ÷ working days = the same working-day spread
//   monthly     days of each month (a full month = 1 month)
//   package     evenly over the calendar days of the period
//   one_off     the whole value on the delivery day (end date)
// Never above the contract value; stops at the cancellation date.
// Live Balance = Incurred − Paid: positive = Accrued, negative = Prepaid.
// Amounts are SAR on the contract-value (gross) basis.
// =====================================================================

export const ACCRUAL_METHODS = [
  "work_days",
  "shoot_days",
  "weekly",
  "monthly",
  "package",
  "one_off",
] as const;
export type AccrualMethod = (typeof ACCRUAL_METHODS)[number];

export function isAccrualMethod(v: unknown): v is AccrualMethod {
  return typeof v === "string" && (ACCRUAL_METHODS as readonly string[]).includes(v);
}

/** Same rule as public.accrual_method_suggest (db/pending/198). */
export function suggestAccrualMethod(dealType: string | null | undefined): AccrualMethod {
  switch ((dealType ?? "").trim().toLowerCase()) {
    case "daily":
      return "work_days";
    case "weekly":
      return "weekly";
    case "monthly":
      return "monthly";
    case "one_off":
      return "one_off";
    default:
      return "package";
  }
}

/** Saudi working week: Friday and Saturday off (UTC day numbers). */
export const KSA_WEEKEND = [5, 6] as const;

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

function parseIso(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
const DAY = 86_400_000;

/** Calendar days in [a, b] inclusive (0 when b < a). */
export function calendarDays(a: string, b: string): number {
  const x = parseIso(a);
  const y = parseIso(b);
  if (x == null || y == null || y < x) return 0;
  return Math.round((y - x) / DAY) + 1;
}

/** Working days in [a, b] inclusive. */
export function workingDays(
  a: string,
  b: string,
  weekend: readonly number[] = KSA_WEEKEND,
): number {
  const x = parseIso(a);
  const y = parseIso(b);
  if (x == null || y == null || y < x) return 0;
  const total = Math.round((y - x) / DAY) + 1;
  const full = Math.floor(total / 7);
  let n = full * (7 - weekend.length);
  const startDow = new Date(x).getUTCDay();
  for (let i = 0; i < total % 7; i++) {
    if (!weekend.includes((startDow + full * 7 + i) % 7)) n++;
  }
  return n;
}

/** Months of [a, b]: month by month, overlapped days ÷ days of that month (060 / 198 rule). */
export function monthsBetween(a: string, b: string): number {
  const x = parseIso(a);
  const y = parseIso(b);
  if (x == null || y == null || y < x) return 0;
  let months = 0;
  let cur = new Date(x);
  cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1));
  while (cur.getTime() <= y) {
    const mStart = cur.getTime();
    const next = Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1);
    const mEnd = next - DAY;
    const dim = Math.round((mEnd - mStart) / DAY) + 1;
    const from = Math.max(mStart, x);
    const to = Math.min(mEnd, y);
    if (to >= from) months += (Math.round((to - from) / DAY) + 1) / dim;
    cur = new Date(next);
  }
  return months;
}

export interface LiveBalanceInput {
  id: string;
  /** Kwalis reference (or the contract id when none). */
  ref: string;
  party: string;
  budgetCode: string | null;
  /** Contract value, gross, SAR. */
  value: number;
  method: AccrualMethod;
  /** true when the method is the suggestion from the deal type (not chosen). */
  methodSuggested?: boolean;
  start: string | null;
  end: string | null;
  /** ISO date the contract was cancelled, if it was. */
  cancelledAt?: string | null;
  /** Paid to date (as of), on the contract-value basis (net paid grossed up by gross ÷ net). */
  paid: number;
  /** Decision 12: the company-borne WHT share of an Exclusive contract (code 7099). */
  whtShare?: boolean;
}

export interface LiveBalanceRow extends LiveBalanceInput {
  totalDays: number;
  elapsedDays: number;
  incurred: number;
  accrued: number;
  prepaid: number;
  /** Incurred − Paid (signed). */
  balance: number;
  remainingCommitment: number;
  /** Shoot-day method without a shooting schedule: days estimated from the contract. */
  estimated: boolean;
  /** No start / end date: nothing can be incurred by time. */
  missingDates: boolean;
}

export interface ShootSchedule {
  /** Active shoot dates (ISO) of the project; null = no schedule available. */
  dates: string[] | null;
  /** Fallback number of shoot days when there is no schedule. */
  fallbackDays?: number | null;
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

/** One contract's live balance as of `asOf` (ISO). */
export function computeLiveBalance(
  c: LiveBalanceInput,
  asOf: string,
  schedule: ShootSchedule = { dates: null },
): LiveBalanceRow {
  const value = Math.max(0, Number(c.value) || 0);
  const paid = round2(Number(c.paid) || 0);
  const cancel = c.cancelledAt ? c.cancelledAt.slice(0, 10) : null;
  const stop = cancel ? minIso(asOf, cancel) : asOf;
  let totalDays = 0;
  let elapsedDays = 0;
  let fraction = 0;
  let estimated = false;
  const missingDates = !c.start || !c.end || calendarDays(c.start, c.end) === 0;

  if (!missingDates) {
    const start = c.start!;
    const end = c.end!;
    const upTo = minIso(stop, end);
    const started = upTo >= start;
    switch (c.method) {
      case "work_days":
      case "weekly":
        totalDays = workingDays(start, end);
        elapsedDays = started ? workingDays(start, upTo) : 0;
        fraction = totalDays > 0 ? elapsedDays / totalDays : 0;
        break;
      case "monthly": {
        totalDays = calendarDays(start, end);
        elapsedDays = started ? calendarDays(start, upTo) : 0;
        const tm = monthsBetween(start, end);
        fraction = tm > 0 && started ? monthsBetween(start, upTo) / tm : 0;
        break;
      }
      case "package":
        totalDays = calendarDays(start, end);
        elapsedDays = started ? calendarDays(start, upTo) : 0;
        fraction = totalDays > 0 ? elapsedDays / totalDays : 0;
        break;
      case "one_off":
        totalDays = 1;
        elapsedDays = stop >= end ? 1 : 0;
        fraction = elapsedDays;
        break;
      case "shoot_days": {
        const inPeriod = (schedule.dates ?? []).filter((d) => d >= start && d <= end);
        if (schedule.dates && inPeriod.length > 0) {
          const unique = Array.from(new Set(inPeriod));
          totalDays = unique.length;
          elapsedDays = unique.filter((d) => d <= upTo).length;
          fraction = elapsedDays / totalDays;
        } else {
          // no schedule: the contract's shoot days spread over its calendar period
          estimated = true;
          const cal = calendarDays(start, end);
          const calElapsed = started ? calendarDays(start, upTo) : 0;
          totalDays = Math.max(0, Math.round(Number(schedule.fallbackDays) || 0)) || cal;
          elapsedDays = cal > 0 ? Math.round((totalDays * calElapsed) / cal) : 0;
          fraction = cal > 0 ? calElapsed / cal : 0;
        }
        break;
      }
    }
  }

  const incurred = round2(Math.min(value, value * Math.max(0, Math.min(1, fraction))));
  const balance = round2(incurred - paid);
  return {
    ...c,
    value: round2(value),
    paid,
    totalDays,
    elapsedDays,
    incurred,
    balance,
    accrued: balance > 0 ? balance : 0,
    prepaid: balance < 0 ? -balance : 0,
    remainingCommitment: cancel ? 0 : round2(Math.max(0, value - incurred)),
    estimated,
    missingDates,
  };
}

/** Paid net → contract-value basis (gross ÷ net). */
export function paidOnValueBasis(paidNet: number, gross: number, net: number | null | undefined) {
  const n = Number(net) || 0;
  const g = Number(gross) || 0;
  if (n <= 0 || g <= 0) return round2(paidNet);
  return round2((Number(paidNet) || 0) * (g / n));
}

export type LiveBalanceGrouping = "none" | "line" | "department" | "vendor";

export interface LiveBalanceGroup {
  key: string;
  label: string;
  rows: LiveBalanceRow[];
  value: number;
  incurred: number;
  paid: number;
  accrued: number;
  prepaid: number;
  remainingCommitment: number;
}

const SUM_KEYS = [
  "value",
  "incurred",
  "paid",
  "accrued",
  "prepaid",
  "remainingCommitment",
] as const;

export function sumLiveBalance(rows: LiveBalanceRow[]) {
  const t = { value: 0, incurred: 0, paid: 0, accrued: 0, prepaid: 0, remainingCommitment: 0 };
  for (const r of rows) for (const k of SUM_KEYS) t[k] += r[k];
  for (const k of SUM_KEYS) t[k] = round2(t[k]);
  return t;
}

/** Department = the budget header account of the code (2101 → 2100). */
export function departmentCode(code: string | null | undefined): string | null {
  const c = (code ?? "").trim();
  if (!/^\d{3,}/.test(c)) return null;
  return `${c.slice(0, 2)}00`;
}

export function groupLiveBalance(
  rows: LiveBalanceRow[],
  by: LiveBalanceGrouping,
  labels: { none: string; unassigned: string; department?: (code: string) => string },
): LiveBalanceGroup[] {
  const keyOf = (r: LiveBalanceRow): [string, string] => {
    if (by === "line") return [r.budgetCode ?? "", r.budgetCode ?? labels.unassigned];
    if (by === "department") {
      const d = departmentCode(r.budgetCode);
      return [d ?? "", d ? (labels.department?.(d) ?? d) : labels.unassigned];
    }
    if (by === "vendor") return [r.party.toLowerCase(), r.party];
    return ["all", labels.none];
  };
  const map = new Map<string, LiveBalanceGroup>();
  for (const r of rows) {
    const [k, label] = keyOf(r);
    let g = map.get(k);
    if (!g) {
      g = {
        key: k,
        label,
        rows: [],
        value: 0,
        incurred: 0,
        paid: 0,
        accrued: 0,
        prepaid: 0,
        remainingCommitment: 0,
      };
      map.set(k, g);
    }
    g.rows.push(r);
  }
  const out = Array.from(map.values()).map((g) => ({ ...g, ...sumLiveBalance(g.rows) }));
  out.sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.key.localeCompare(b.key)));
  return out;
}

/**
 * Decision 12 (db/pending/201): an Exclusive (gross-up) contract is two
 * rows — its own line carries the NET, code 7099 the company-borne WHT.
 * Both accrue by the contract's method; payments are net, so the line is
 * paid what was paid and the 7099 row the WHT withheld on it. Totals are
 * the same as one gross row.
 */
export function decision12Inputs(
  base: Omit<LiveBalanceInput, "value" | "paid" | "whtShare">,
  gross: number,
  net: number | null | undefined,
  treatment: string | null | undefined,
  paidNet: number,
  whtCode = "7099",
): LiveBalanceInput[] {
  const g = Number(gross) || 0;
  const n = Number(net) || 0;
  const paidValue = paidOnValueBasis(paidNet, g, net);
  if (treatment !== "exclusive" || n <= 0 || g <= n) {
    return [{ ...base, value: g, paid: paidValue }];
  }
  const p = round2(Number(paidNet) || 0);
  return [
    { ...base, value: round2(n), paid: p },
    {
      ...base,
      id: `${base.id}:wht`,
      budgetCode: whtCode,
      value: round2(g - n),
      paid: round2(paidValue - p),
      whtShare: true,
    },
  ];
}
