import { supabase } from "@/integrations/supabase/client";

/**
 * Super-admin "Force Unlock": appends an `admin_unlock` event to the
 * append-only auth_security_log. The login page's rate limiter detects this
 * event through the `check_admin_unlock` RPC and clears the local lockout
 * when the unlock is newer than the moment the lock started.
 *
 * RLS: only super admins may insert `event_type = 'admin_unlock'`
 * (policy "Super admins can insert admin_unlock events"); the broad
 * pre-auth insert policy explicitly excludes this event type.
 */
export async function insertAdminUnlock(email: string, adminUserId: string): Promise<void> {
  const { error } = await supabase.from("auth_security_log").insert({
    event_type: "admin_unlock",
    email: email.trim().toLowerCase().slice(0, 255),
    admin_unlocked: true,
    unlocked_by: adminUserId,
    unlocked_at: new Date().toISOString(),
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
  });
  if (error) throw error;
}
