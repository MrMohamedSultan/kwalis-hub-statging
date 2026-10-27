import { supabase } from "@/integrations/supabase/client";

/**
 * "Remember me" support. Supabase persists sessions in localStorage by
 * default; when the user opts out at sign-in we flag the tab as transient
 * and sign out as the window closes.
 */
export const TRANSIENT_SESSION_KEY = "kwalishub_session_transient";
/** Pre-rename key (G01) — still honoured for tabs opened before the update. */
const LEGACY_TRANSIENT_SESSION_KEY = ["track", "roll_session_transient"].join("");

export function installTransientSessionGuard(): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => {
    try {
      if (
        sessionStorage.getItem(TRANSIENT_SESSION_KEY) === "true" ||
        sessionStorage.getItem(LEGACY_TRANSIENT_SESSION_KEY) === "true"
      ) {
        void supabase.auth.signOut({ scope: "local" });
      }
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}
