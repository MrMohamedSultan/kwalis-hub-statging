import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { LegalLinks } from "@/components/LegalLinks";
import { passwordResetProblem } from "@/lib/password-policy";

/**
 * X02 — landing page of the "Forgot password?" e-mail. Supabase Auth puts a
 * one-time recovery session in the link; the user picks a new password here.
 * Without a recovery session (expired or reused link) nothing can be changed.
 */
export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "Reset password — Kwalis HUB" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ready, setReady] = useState<"checking" | "ok" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let settled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) {
        settled = true;
        setReady("ok");
      }
    });
    // The client parses the link on load; give it a moment, then decide.
    const timer = window.setTimeout(async () => {
      if (settled) return;
      const { data } = await supabase.auth.getSession();
      setReady(data.session ? "ok" : "invalid");
    }, 1200);
    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordResetProblem(password, confirm);
    if (problem) {
      setError(t(`platform.reset.${problem}`));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password });
      if (upErr) throw upErr;
      // End every other session that may still use the old password.
      await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
      toast.success(t("platform.reset.done"));
      await supabase.auth.signOut();
      await navigate({ to: "/auth" });
    } catch {
      setError(t("platform.reset.failed"));
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand";

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 text-brand" />
          <h1 className="text-2xl font-bold">{t("platform.reset.title")}</h1>
        </div>
        {ready === "checking" && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {ready === "invalid" && (
          <div className="space-y-4">
            <p role="alert" className="text-sm text-destructive">
              {t("platform.reset.invalidLink")}
            </p>
            <button
              type="button"
              onClick={() => void navigate({ to: "/auth" })}
              className="text-sm font-semibold text-brand hover:underline"
            >
              {t("platform.reset.backToSignIn")}
            </button>
          </div>
        )}
        {ready === "ok" && (
          <form onSubmit={submit} noValidate className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">
                {t("platform.reset.newPassword")}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">
                {t("platform.reset.confirmPassword")}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputCls}
              />
            </label>
            <p className="text-xs text-muted-foreground">{t("platform.reset.rules")}</p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand text-brand-foreground font-semibold py-3 text-sm disabled:opacity-60"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("platform.reset.save")}
            </button>
          </form>
        )}
        <LegalLinks />
      </div>
    </div>
  );
}
