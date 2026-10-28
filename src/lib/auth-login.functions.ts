import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { clientIpFrom } from "@/lib/login-lockout";

/**
 * X02 — password sign-in with a server-side lockout.
 *
 * The browser never calls /auth/v1/token for a password sign-in any more:
 * it sends the credentials here, the server checks the failure counters in
 * public.login_throttle (per e-mail, per IP, per user — db/pending/195),
 * signs in with the publishable key, records the outcome, and hands the
 * session tokens back for `supabase.auth.setSession()`.
 *
 * The counters can only be read and written with the service role, so a
 * script that skips this function still meets the GoTrue
 * password-verification hook (same table, per user id).
 *
 * `unavailable` means the server is not configured for it (no service role
 * key, or 195 not applied yet): the client then signs in directly and only
 * the GoTrue hook protects the account.
 */
const SignInInput = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(128),
});

export type SignInResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; reason: "locked"; lockedUntil: string; failedCount: number }
  | {
      ok: false;
      reason: "invalid";
      failedCount: number;
      /** Supabase Auth error text when it is not a plain wrong password (e.g. unconfirmed e-mail). */
      message: string | null;
    }
  | { ok: false; reason: "unavailable" };

type ThrottleRow = { locked?: boolean; locked_until?: string | null; failed_count?: number };

function firstRow(data: unknown): ThrottleRow {
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? {}) as ThrottleRow;
}

export const signInWithLockout = createServerFn({ method: "POST" })
  .inputValidator((data) => SignInInput.parse(data))
  .handler(async ({ data }): Promise<SignInResult> => {
    const url = process.env.SUPABASE_URL;
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishableKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { ok: false, reason: "unavailable" };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // The throttle functions are new (195) and not in the generated types yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    const ip = clientIpFrom(getRequest()?.headers ?? null);

    const check = await admin.rpc("login_throttle_check", { _email: data.email, _ip: ip });
    if (check.error) {
      console.error("[auth] login_throttle_check failed:", check.error.message);
      return { ok: false, reason: "unavailable" };
    }
    const state = firstRow(check.data);
    if (state.locked && state.locked_until) {
      return {
        ok: false,
        reason: "locked",
        lockedUntil: state.locked_until,
        failedCount: state.failed_count ?? 0,
      };
    }

    const anon = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: ip ? { headers: { "X-Forwarded-For": ip } } : undefined,
    });
    const { data: auth, error } = await anon.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error || !auth.session) {
      const wrongPassword = !error || /invalid login credentials/i.test(error.message);
      const hookLocked = !!error && /too many failed sign-in attempts/i.test(error.message);
      if (!wrongPassword && !hookLocked) {
        // Not a credential failure (unconfirmed e-mail, Auth down…): do not count it.
        return { ok: false, reason: "invalid", failedCount: 0, message: error?.message ?? null };
      }
      const rec = await admin.rpc("login_throttle_record", {
        _email: data.email,
        _ip: ip,
        _success: false,
      });
      const after = firstRow(rec.data);
      if (after.locked_until) {
        return {
          ok: false,
          reason: "locked",
          lockedUntil: after.locked_until,
          failedCount: after.failed_count ?? 0,
        };
      }
      return { ok: false, reason: "invalid", failedCount: after.failed_count ?? 0, message: null };
    }

    await admin.rpc("login_throttle_record", { _email: data.email, _ip: ip, _success: true });
    return {
      ok: true,
      accessToken: auth.session.access_token,
      refreshToken: auth.session.refresh_token,
    };
  });
