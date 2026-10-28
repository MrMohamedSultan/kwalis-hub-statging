import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { Panel } from "@/components/AppShell";
import {
  cleanTotpCode,
  getMfaState,
  isMfaRequiredForMe,
  needsSecondStep,
  removeFactor,
  startTotpEnrolment,
  verifyTotp,
  type MfaState,
  type TotpEnrolment,
} from "@/lib/mfa";
import { formatDate } from "@/lib/date-format";

/** X02 — Account Settings: turn two-step verification (authenticator app) on or off. */
export function MfaSettingsPanel() {
  const { t } = useTranslation();
  const [state, setState] = useState<MfaState | null>(null);
  const [required, setRequired] = useState(false);
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([getMfaState(), isMfaRequiredForMe()]);
      setState(s);
      setRequired(r);
      void queryClient.invalidateQueries({ queryKey: ["mfa-requirement"] });
    } catch {
      setState({ currentLevel: null, nextLevel: null, factors: [] });
    }
  }, [queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const start = async () => {
    setBusy(true);
    try {
      setEnrolment(await startTotpEnrolment(t("platform.mfa.factorName")));
      setCode("");
    } catch (e) {
      toast.error(t("platform.mfa.enrolFailed"));
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (factorId: string) => {
    if (code.length !== 6) return;
    setBusy(true);
    try {
      await verifyTotp(factorId, code);
      toast.success(t("platform.mfa.enabled"));
      setEnrolment(null);
      setCode("");
      await refresh();
    } catch {
      toast.error(t("platform.mfa.invalidCode"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (factorId: string) => {
    if (required && (state?.factors.length ?? 0) <= 1) {
      toast.error(t("platform.mfa.requiredCannotRemove"));
      return;
    }
    if (!window.confirm(t("platform.mfa.removeConfirm"))) return;
    setBusy(true);
    try {
      await removeFactor(factorId);
      toast.success(t("platform.mfa.disabled"));
      await refresh();
    } catch {
      toast.error(t("platform.mfa.removeFailed"));
    } finally {
      setBusy(false);
    }
  };

  const codeInput = (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      dir="ltr"
      maxLength={6}
      value={code}
      onChange={(e) => setCode(cleanTotpCode(e.target.value))}
      placeholder="000000"
      aria-label={t("platform.mfa.codeLabel")}
      className="w-40 bg-surface-2 border border-border rounded-xl px-3 py-2 font-mono text-center tracking-[0.3em] outline-none focus:ring-2 ring-brand"
    />
  );

  const enabled = (state?.factors.length ?? 0) > 0;
  const pendingStep = state ? needsSecondStep(state) : false;

  return (
    <Panel>
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="size-4 text-brand" />
        <h2 className="text-base font-semibold">{t("platform.mfa.title")}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t("platform.mfa.intro")}</p>
      {required && !enabled && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning"
        >
          {t("platform.mfa.requiredByOrg")}
        </p>
      )}

      {!state ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : enrolment ? (
        <div className="space-y-3">
          <p className="text-sm">{t("platform.mfa.scanQr")}</p>
          <img
            src={enrolment.qrCode}
            alt={t("platform.mfa.qrAlt")}
            className="size-44 rounded-lg bg-background p-2 border border-border"
          />
          <p className="text-xs text-muted-foreground">
            {t("platform.mfa.manualKey")}{" "}
            <code dir="ltr" className="font-mono break-all text-foreground">
              {enrolment.secret}
            </code>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {codeInput}
            <button
              type="button"
              disabled={busy || code.length !== 6}
              onClick={() => void confirm(enrolment.factorId)}
              className="px-4 py-2 rounded-xl bg-brand text-brand-foreground text-sm font-semibold disabled:opacity-60"
            >
              {t("platform.mfa.confirm")}
            </button>
            <button
              type="button"
              onClick={() => setEnrolment(null)}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              {t("common.cancel", "Cancel")}
            </button>
          </div>
        </div>
      ) : enabled ? (
        <div className="space-y-3">
          {pendingStep && (
            <div className="space-y-2 rounded-xl border border-border p-3">
              <p className="text-sm">{t("platform.mfa.verifyThisSession")}</p>
              <div className="flex flex-wrap items-center gap-2">
                {codeInput}
                <button
                  type="button"
                  disabled={busy || code.length !== 6}
                  onClick={() => void confirm(state.factors[0].id)}
                  className="px-4 py-2 rounded-xl bg-brand text-brand-foreground text-sm font-semibold disabled:opacity-60"
                >
                  {t("platform.mfa.verify")}
                </button>
              </div>
            </div>
          )}
          <ul className="divide-y divide-border">
            {state.factors.map((f) => (
              <li key={f.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {f.friendlyName || t("platform.mfa.factorName")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("platform.mfa.addedOn", { date: formatDate(f.createdAt) })}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(f.id)}
                  className="flex items-center gap-1.5 text-xs text-destructive hover:underline disabled:opacity-60"
                >
                  <ShieldOff className="size-3.5" /> {t("platform.mfa.remove")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void start()}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-brand-foreground text-sm font-semibold disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t("platform.mfa.turnOn")}
        </button>
      )}
    </Panel>
  );
}
