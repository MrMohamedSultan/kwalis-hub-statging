import { supabase } from "@/integrations/supabase/client";

export type SecurityEventType =
  "failed_login" | "account_locked" | "successful_login_after_failures";

export interface SecurityEventInput {
  event_type: SecurityEventType;
  email: string;
  attempt_count?: number;
  lock_duration_minutes?: number | null;
}

/**
 * Append-only login security log (auth_security_log table).
 *
 * This is the SECONDARY protection layer: the localStorage rate limiter is
 * primary. Logging must never block or break the auth flow, so every failure
 * is swallowed to the console. Callers should use `void logSecurityEvent(...)`.
 */
export async function logSecurityEvent(event: SecurityEventInput): Promise<void> {
  try {
    // Direct table INSERT is revoked; entries go through a validating
    // SECURITY DEFINER RPC that constrains event types and bounds values.
    const { error } = await supabase.rpc("log_auth_security_event", {
      p_event_type: event.event_type,
      p_email: event.email.trim().toLowerCase().slice(0, 255),
      p_attempt_count: event.attempt_count ?? 1,
      p_lock_duration_minutes: event.lock_duration_minutes ?? undefined,
      p_user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : undefined,
    });
    if (error) console.warn("[security-log] insert failed:", error.message);
  } catch (err) {
    console.warn("[security-log] unavailable:", err);
  }
}
