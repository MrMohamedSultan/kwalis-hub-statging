import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FIRST_LOCK_AT, WARN_THRESHOLD, lockMinutesFor, lockRemaining } from "@/lib/login-lockout";

export { FIRST_LOCK_AT, WARN_THRESHOLD };

type AttemptsState = {
  count: number;
  lockedUntil: string | null;
  /** When the current lock started — an admin unlock newer than this clears it. */
  lockedAt: string | null;
  email: string;
};

const EMPTY_STATE: AttemptsState = { count: 0, lockedUntil: null, lockedAt: null, email: "" };

export type RecordFailureResult = {
  /** Total consecutive failures including this one. */
  count: number;
  /** Lock minutes when THIS failure triggered a new lock, otherwise 0. */
  lockedMinutes: number;
};

/**
 * Login page lock display (X02).
 *
 * The lock itself is decided by the server (public.login_throttle via
 * `signInWithLockout`); this hook only mirrors what the server answered so
 * the form can show the countdown. Nothing is kept in localStorage any more,
 * so clearing the browser or switching browsers changes nothing: the next
 * attempt is refused by the server again.
 *
 * `recordFailure` is the fallback for a server without the lockout function
 * (it only drives the UI; the GoTrue hook still protects the account).
 *
 * Super-admin force unlock: while locked, the hook polls `check_admin_unlock`
 * and clears the display when an unlock newer than the lock exists (the
 * unlock also clears the server counters — 195 trigger).
 */
export function useLoginRateLimiter() {
  const [state, setStateRaw] = useState<AttemptsState>(EMPTY_STATE);
  const stateRef = useRef<AttemptsState>(EMPTY_STATE);
  const setState = useCallback((next: AttemptsState | ((prev: AttemptsState) => AttemptsState)) => {
    const value = typeof next === "function" ? next(stateRef.current) : next;
    stateRef.current = value;
    setStateRaw(value);
  }, []);
  const [now, setNow] = useState(() => Date.now());

  const lockTimeRemaining = useMemo(
    () => lockRemaining(state.lockedUntil, now) ?? "0:00",
    [state.lockedUntil, now],
  );
  const isLocked = lockRemaining(state.lockedUntil, now) !== null;

  useEffect(() => {
    if (!state.lockedUntil) return;
    const id = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (lockRemaining(state.lockedUntil, current) === null) {
        setState((prev) => ({ ...prev, lockedUntil: null, lockedAt: null }));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [state.lockedUntil, setState]);

  useEffect(() => {
    if (!state.lockedUntil || !state.email) return;
    const email = state.email;
    const referenceTs = state.lockedAt ?? state.lockedUntil;
    let cancelled = false;
    const check = async () => {
      try {
        const { data, error } = await supabase.rpc("check_admin_unlock", {
          _email: email,
          _locked_until: referenceTs,
        });
        if (!cancelled && !error && data === true) setState(EMPTY_STATE);
      } catch {
        /* the next poll retries */
      }
    };
    void check();
    const id = window.setInterval(check, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state.lockedUntil, state.lockedAt, state.email, setState]);

  /** Mirror the server's answer after a refused attempt. */
  const applyServerState = useCallback(
    (email: string, failedCount: number, lockedUntil: string | null) => {
      setNow(Date.now());
      setState({
        email,
        count: failedCount,
        lockedUntil,
        lockedAt: lockedUntil ? new Date().toISOString() : null,
      });
    },
    [setState],
  );

  /** Fallback (no server lockout): count locally for the display only. */
  const recordFailure = useCallback(
    (email: string): RecordFailureResult => {
      const prev = stateRef.current;
      const count = (prev.email === email ? prev.count : 0) + 1;
      const lockedMinutes = lockMinutesFor(count);
      const nowMs = Date.now();
      setState({
        count,
        email,
        lockedAt: lockedMinutes > 0 ? new Date(nowMs).toISOString() : null,
        lockedUntil:
          lockedMinutes > 0 ? new Date(nowMs + lockedMinutes * 60_000).toISOString() : null,
      });
      setNow(nowMs);
      return { count, lockedMinutes };
    },
    [setState],
  );

  const resetAttempts = useCallback(() => setState(EMPTY_STATE), [setState]);

  return {
    isLocked,
    lockTimeRemaining,
    failedAttempts: state.count,
    applyServerState,
    recordFailure,
    recordSuccess: resetAttempts,
    resetAttempts,
  };
}
