import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "kwalis_login_attempts";

/** Show the "attempts remaining" warning from this many failures upward. */
export const WARN_THRESHOLD = 3;
/** First lockout tier — used for the "attempt X of N" counter. */
export const FIRST_LOCK_AT = 5;

type AttemptsState = {
  count: number;
  lockedUntil: string | null;
  /** When the current lock started — an admin unlock newer than this clears it. */
  lockedAt: string | null;
  email: string;
};

const EMPTY_STATE: AttemptsState = { count: 0, lockedUntil: null, lockedAt: null, email: "" };

/**
 * Progressive lockout schedule (failures → lock minutes):
 *   5 → 2 min, 8 → 15 min, 12 → 60 min.
 * Between tiers there is no lock; past the top tier every failure re-locks.
 */
function lockMinutesFor(count: number): number {
  if (count >= 12) return 60;
  if (count === 8) return 15;
  if (count === 5) return 2;
  return 0;
}

function readState(): AttemptsState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<AttemptsState>;
    return {
      count: typeof parsed.count === "number" && parsed.count > 0 ? parsed.count : 0,
      lockedUntil: typeof parsed.lockedUntil === "string" ? parsed.lockedUntil : null,
      lockedAt: typeof parsed.lockedAt === "string" ? parsed.lockedAt : null,
      email: typeof parsed.email === "string" ? parsed.email : "",
    };
  } catch {
    return EMPTY_STATE;
  }
}

function writeState(state: AttemptsState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — lockout degrades to in-memory only */
  }
}

function clearState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export type RecordFailureResult = {
  /** Total consecutive failures including this one. */
  count: number;
  /** Lock minutes when THIS failure triggered a new lock, otherwise 0. */
  lockedMinutes: number;
};

/**
 * Client-side progressive login rate limiter backed by localStorage.
 * Works fully offline — DB security logging is a separate, optional layer.
 *
 * Super-admin force unlock: while a lock is stored, the hook asks the DB
 * (via the `check_admin_unlock` RPC — the log table itself is not readable
 * pre-auth) whether an admin_unlock event is newer than the moment the lock
 * started. If so, the local lockout is cleared automatically.
 */
export function useLoginRateLimiter() {
  const [state, setState] = useState<AttemptsState>(readState);
  const [now, setNow] = useState(() => Date.now());

  const lockedUntilMs = state.lockedUntil ? Date.parse(state.lockedUntil) : null;
  const isLocked = lockedUntilMs !== null && Number.isFinite(lockedUntilMs) && lockedUntilMs > now;

  // Tick once a second while a lock timestamp exists; auto-release on expiry.
  useEffect(() => {
    if (lockedUntilMs === null) return;
    const id = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= lockedUntilMs) {
        setState((prev) => {
          const next = { ...prev, lockedUntil: null, lockedAt: null };
          writeState(next);
          return next;
        });
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [lockedUntilMs]);

  // Admin force-unlock check: on mount and every 30s while a lock is stored.
  // No realtime channel needed — login time plus a light poll is enough.
  useEffect(() => {
    if (!state.lockedUntil || !state.email) return;
    const email = state.email;
    // Compare against the lock START (an unlock issued while the lock is
    // active must count); legacy states without lockedAt fall back to the
    // lock expiry timestamp.
    const referenceTs = state.lockedAt ?? state.lockedUntil;
    let cancelled = false;

    const check = async () => {
      try {
        const { data, error } = await supabase.rpc("check_admin_unlock", {
          _email: email,
          _locked_until: referenceTs,
        });
        if (cancelled) return;
        if (error) {
          console.warn("[rate-limiter] admin-unlock check failed:", error.message);
          return;
        }
        if (data === true) {
          clearState();
          setState(EMPTY_STATE);
        }
      } catch (err) {
        if (!cancelled) console.warn("[rate-limiter] admin-unlock check unavailable:", err);
      }
    };

    void check();
    const id = window.setInterval(check, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state.lockedUntil, state.lockedAt, state.email]);

  /** "m:ss" countdown while locked, e.g. "1:45". */
  const lockTimeRemaining = useMemo(() => {
    if (!isLocked || lockedUntilMs === null) return "0:00";
    const total = Math.max(0, Math.ceil((lockedUntilMs - now) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }, [isLocked, lockedUntilMs, now]);

  const recordFailure = useCallback((email: string): RecordFailureResult => {
    const prev = readState();
    const count = prev.count + 1;
    const lockedMinutes = lockMinutesFor(count);
    const nowMs = Date.now();
    const next: AttemptsState = {
      count,
      email,
      lockedAt: lockedMinutes > 0 ? new Date(nowMs).toISOString() : null,
      lockedUntil:
        lockedMinutes > 0 ? new Date(nowMs + lockedMinutes * 60_000).toISOString() : null,
    };
    writeState(next);
    setState(next);
    setNow(Date.now());
    return { count, lockedMinutes };
  }, []);

  const resetAttempts = useCallback(() => {
    clearState();
    setState(EMPTY_STATE);
  }, []);

  return {
    isLocked,
    lockTimeRemaining,
    failedAttempts: state.count,
    recordFailure,
    recordSuccess: resetAttempts,
    resetAttempts,
  };
}
