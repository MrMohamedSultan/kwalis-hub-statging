// =====================================================================
// Numeric guards for dashboard data.
//
// A single NaN reaching Recharts blanks an entire chart with no error
// message — every derived value on the dashboards passes through these.
// =====================================================================

/** Coerces anything to a finite number, falling back when it is not. */
export function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Division that can never produce NaN/Infinity — returns `fallback` when the denominator is 0. */
export function safeDivide(a: unknown, b: unknown, fallback = 0): number {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) return fallback;
  return x / y;
}

/** Null-safe array passthrough. */
export function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
