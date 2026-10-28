import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, ShieldCheck } from "lucide-react";
import { cleanTotpCode, verifyTotp } from "@/lib/mfa";

/**
 * X02 — second sign-in step: the 6-digit code from the user's
 * authenticator app. Supabase Auth checks the code and upgrades the
 * session to aal2.
 */
export function MfaChallenge({
  factorId,
  onVerified,
  onCancel,
}: {
  factorId: string;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(factorId, code);
      onVerified();
    } catch {
      setError(t("platform.mfa.invalidCode"));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 text-center">
      <div>
        <div className="mx-auto mb-3 size-12 rounded-xl bg-brand/15 border border-brand/30 grid place-items-center">
          <ShieldCheck className="size-6 text-brand" />
        </div>
        <h2 className="text-xl font-bold text-foreground">{t("platform.mfa.challengeTitle")}</h2>
        <p className="text-sm text-muted-foreground mt-2">{t("platform.mfa.challengeBody")}</p>
      </div>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        dir="ltr"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(cleanTotpCode(e.target.value))}
        placeholder="000000"
        aria-label={t("platform.mfa.codeLabel")}
        className="w-full bg-surface border border-border rounded-xl px-4 py-4 text-2xl font-mono text-center text-foreground tracking-[0.5em] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-brand"
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={code.length !== 6 || busy}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand text-brand-foreground font-semibold py-3 text-sm disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? t("platform.mfa.verifying") : t("platform.mfa.verify")}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-muted-foreground hover:text-destructive"
      >
        {t("platform.mfa.cancelSignIn")}
      </button>
    </form>
  );
}
