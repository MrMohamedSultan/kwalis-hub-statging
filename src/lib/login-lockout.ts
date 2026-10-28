/**
 * X02 — pure helpers shared by the sign-in server function and the login
 * page. The authoritative counters live in public.login_throttle
 * (db/pending/195_platform.sql); `lockMinutesFor` mirrors
 * public.login_lock_minutes so the page can explain the schedule.
 */

/** Show the "attempts remaining" warning from this many failures upward. */
export const WARN_THRESHOLD = 3;
/** First lockout tier — used for the "attempt X of N" counter. */
export const FIRST_LOCK_AT = 5;

/** 5 → 2 min, 8 → 15 min, 12+ → 60 min (per e-mail / user); IP: 20 → 15, 40+ → 60. */
export function lockMinutesFor(count: number, kind: "email" | "ip" = "email"): number {
  if (kind === "ip") {
    if (count >= 40) return 60;
    if (count === 20) return 15;
    return 0;
  }
  if (count >= 12) return 60;
  if (count === 8) return 15;
  if (count === 5) return 2;
  return 0;
}

const IP_RE = /^[0-9a-fA-F:.]{2,64}$/;

/**
 * Caller IP from proxy headers (nginx sets X-Real-IP / X-Forwarded-For).
 * Only the first, well-formed address is used; anything else is ignored so
 * a forged header cannot inject text into the counter key.
 */
export function clientIpFrom(headers: Headers | null | undefined): string {
  if (!headers) return "";
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const c of candidates) {
    const v = (c ?? "").trim();
    if (IP_RE.test(v)) return v;
  }
  return "";
}

/** "m:ss" until `lockedUntil`, or null when the lock is over. */
export function lockRemaining(lockedUntil: string | null, nowMs: number): string | null {
  if (!lockedUntil) return null;
  const until = Date.parse(lockedUntil);
  if (!Number.isFinite(until) || until <= nowMs) return null;
  const total = Math.ceil((until - nowMs) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
