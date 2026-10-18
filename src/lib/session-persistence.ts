import { supabase } from "@/integrations/supabase/client";

/**
 * "Remember me" support. Supabase persists sessions in localStorage by
 * default; when the user opts out at sign-in we flag the tab as transient
 * and sign out as the window closes.
 */
export const TRANSIENT_SESSION_KEY = "trackroll_session_transient";

export function installTransientSessionGuard(): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => {
    try {
      if (sessionStorage.getItem(TRANSIENT_SESSION_KEY) === "true") {
        void supabase.auth.signOut({ scope: "local" });
      }
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}
