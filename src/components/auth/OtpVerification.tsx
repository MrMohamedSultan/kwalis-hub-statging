import { useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceHash, getDeviceLabel } from "@/lib/device-fingerprint";
import { toast } from "sonner";

import { useTranslation } from "react-i18next";
/**
 * New-device verification.
 *
 * The one-time code is generated, stored and validated entirely by Supabase
 * Auth (`signInWithOtp` / `verifyOtp`) — never by the browser — so the code
 * can't be read or forged client-side. Once verified, the device fingerprint
 * is remembered so the step is skipped next time.
 */
export async function isDeviceVerified(userId: string): Promise<boolean> {
  const { data } = await (supabase as any)
    .from("verified_devices")
    .select("id")
    .eq("user_id", userId)
    .eq("device_hash", getDeviceHash())
    .maybeSingle();

  if (data?.id) {
    await (supabase as any)
      .from("verified_devices")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id);
    return true;
  }
  return false;
}

export async function sendDeviceOtp(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
}

export function OtpVerification({
  email,
  onVerified,
  onCancel,
}: {
  email: string;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data, error: verifyErr } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "email",
      });
      if (verifyErr || !data.user) {
        setError("Invalid or expired code. Please try again.");
        return;
      }
      await (supabase as any).from("verified_devices").insert({
        user_id: data.user.id,
        device_hash: getDeviceHash(),
        device_label: getDeviceLabel(),
      });
      await (supabase as any)
        .from("profiles")
        .update({ email_verified_at: new Date().toISOString() })
        .eq("id", data.user.id);
      onVerified();
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try {
      await sendDeviceOtp(email);
      toast.success(t("otpverification.a_new_code_is_on_its_way"));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not resend the code.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 text-center">
      <div>
        <div className="mx-auto mb-3 size-12 rounded-xl bg-brand/15 border border-brand/30 grid place-items-center">
          <ShieldCheck className="size-6 text-brand" />
        </div>
        <h2 className="text-xl font-bold text-foreground">
          {t("otpverification.verify_your_identity")}
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          We don&apos;t recognise this device. We sent a 6-digit code to
          <br />
          <span className="font-mono text-foreground">{email}</span>.
        </p>
      </div>

      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        className="w-full bg-surface border border-border rounded-xl px-4 py-4 text-2xl font-mono text-center text-foreground tracking-[0.5em] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-brand"
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={otp.length !== 6 || busy}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand text-brand-foreground font-semibold py-3 text-sm disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? "Verifying…" : "Verify & continue"}
      </button>

      <div className="flex items-center justify-center gap-4 text-xs">
        <button
          type="button"
          onClick={resend}
          className="text-muted-foreground hover:text-foreground"
        >
          Didn&apos;t receive it? Resend code
        </button>
        <span className="text-border">|</span>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted-foreground hover:text-destructive"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
