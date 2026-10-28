import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { signOut } from "@/lib/auth";
import { accountActionFor, fetchMyAccountStatus } from "@/lib/account-status";
import { NO_ACCESS_PATH } from "@/lib/permissions/landing";
import { getMfaState, isMfaRequiredForMe, needsSecondStep } from "@/lib/mfa";

const ACCOUNT_SETTINGS_PATH = "/account-settings";

/**
 * Applies the platform owner's decisions to the signed-in session (D23 / D08):
 * a disabled account or a forced sign-out ends the session, a pending
 * password change sends the user to Account Settings, and a member whose
 * every company is suspended lands on the no-access page.
 *
 * Renders nothing. Mounted once inside the authenticated layout, so it does
 * not touch the route gate's synchronous fast path.
 */
export function AccountStatusGuard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useLocation({ select: (l) => l.pathname });
  const handled = useRef<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ["account-status"],
    queryFn: fetchMyAccountStatus,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!status) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      const action = accountActionFor(status, data.session?.user?.last_sign_in_at);

      if (action === "sign_out_disabled" || action === "sign_out_revoked") {
        if (handled.current === action) return;
        handled.current = action;
        toast.error(
          action === "sign_out_disabled"
            ? t(
                "accountStatus.disabled",
                "This account has been disabled. Contact your administrator.",
              )
            : t(
                "accountStatus.signedOut",
                "You were signed out by an administrator. Please sign in again.",
              ),
        );
        await queryClient.cancelQueries();
        queryClient.clear();
        await signOut();
        if (!cancelled) await navigate({ to: "/auth", replace: true });
        return;
      }

      if (action === "change_password") {
        if (pathname !== ACCOUNT_SETTINGS_PATH) {
          toast.info(
            t("accountStatus.changePassword", "Choose a new password before you continue."),
          );
          await navigate({ to: ACCOUNT_SETTINGS_PATH, replace: true });
        }
        return;
      }

      if (action === "suspended" && pathname !== NO_ACCESS_PATH) {
        toast.error(
          t(
            "accountStatus.suspended",
            "Your company's subscription is suspended. Contact support.",
          ),
        );
        await navigate({ to: NO_ACCESS_PATH as "/", replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, pathname, navigate, queryClient, t]);

  // X02 — an organization that requires two-step verification sends members
  // without a verified authenticator (or with an unverified session) to
  // Account Settings until it is done.
  const { data: mfa } = useQuery({
    queryKey: ["mfa-requirement"],
    queryFn: async () => {
      const required = await isMfaRequiredForMe();
      if (!required) return { blocked: false };
      const state = await getMfaState();
      return { blocked: state.factors.length === 0 || needsSecondStep(state) };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!mfa?.blocked || pathname === ACCOUNT_SETTINGS_PATH) return;
    toast.info(t("platform.mfa.requiredRedirect"));
    void navigate({ to: ACCOUNT_SETTINGS_PATH, replace: true });
  }, [mfa?.blocked, pathname, navigate, t]);

  return null;
}
