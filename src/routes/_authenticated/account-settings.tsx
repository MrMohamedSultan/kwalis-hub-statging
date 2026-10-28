import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { UserCircle, KeyRound, Save, Loader2 } from "lucide-react";
import { z } from "zod";
import i18n from "@/lib/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { clearMyPasswordChangeRequirement } from "@/lib/account-status";
import { MfaSettingsPanel } from "@/components/auth/MfaSettingsPanel";

export const Route = createFileRoute("/_authenticated/account-settings")({
  component: () => (
    <AppShell>
      <AccountSettingsPage />
    </AppShell>
  ),
});

const nameSchema = () =>
  z
    .string()
    .trim()
    .min(1, i18n.t("platform.account.nameRequired"))
    .max(120, i18n.t("platform.account.nameTooLong"));

const passwordSchema = () =>
  z
    .string()
    .min(8, i18n.t("platform.account.passwordTooShort"))
    .max(72, i18n.t("platform.account.passwordTooLong"));

const inputCls =
  "w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand text-sm";
const readOnlyCls =
  "w-full bg-surface-1 border border-border rounded-xl px-3 py-2 text-sm text-muted-foreground";

export function AccountSettingsPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [jobTitle, setJobTitle] = useState<string>("");
  const [savingProfile, setSavingProfile] = useState(false);

  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) {
        if (!cancelled) setLoading(false);
        return;
      }
      const user = userRes.user;
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, job_title")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setUserId(user.id);
      setEmail(user.email ?? "");
      setDisplayName(profile?.display_name ?? "");
      setJobTitle(profile?.job_title ?? "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const parsed = nameSchema().safeParse(displayName);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("platform.account.nameRequired"));
      return;
    }
    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: parsed.data,
          job_title: jobTitle.trim() || null,
        })
        .eq("id", userId);
      if (error) throw error;
      toast.success(t("platform.account.profileUpdated"));
    } catch (err: any) {
      toast.error(err?.message ?? t("platform.account.profileFailed"));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault();
    const parsed = passwordSchema().safeParse(password);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("platform.account.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t("platform.reset.mismatch"));
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: parsed.data });
      if (error) throw error;
      // D08: the first-sign-in requirement is met once the password changed.
      await clearMyPasswordChangeRequirement();
      await queryClient.invalidateQueries({ queryKey: ["account-status"] });
      setPassword("");
      setConfirmPassword("");
      toast.success(t("platform.account.passwordUpdated"));
    } catch (err: any) {
      toast.error(err?.message ?? t("platform.account.passwordFailed"));
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="me-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        {t("account_settings.you_must_be_signed_in_to_view_account")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle title={t("nav.accountSettings", "Account Settings")} />
      <p className="text-sm text-muted-foreground -mt-2">{t("platform.account.subtitle")}</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <div className="flex items-center gap-2 mb-4">
            <UserCircle className="h-5 w-5 text-brand" />
            <h2 className="text-base font-semibold">{t("platform.account.profile")}</h2>
          </div>
          <form onSubmit={handleProfileSave} className="space-y-4">
            <label className="block text-sm">
              <div className="text-muted-foreground mb-1">
                {t("platform.account.email")}{" "}
                <span className="text-[10px]">({t("platform.account.readOnly")})</span>
              </div>
              <input type="email" value={email} readOnly disabled className={readOnlyCls} />
            </label>
            <label className="block text-sm">
              <div className="text-muted-foreground mb-1">{t("platform.account.fullName")}</div>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={120}
                className={inputCls}
                placeholder={t("account_settings.eg_jane_doe")}
              />
            </label>
            <label className="block text-sm">
              <div className="text-muted-foreground mb-1">
                {t("platform.account.jobTitle")}{" "}
                <span className="text-[10px] text-muted-foreground/70">
                  ({t("platform.common.optional")})
                </span>
              </div>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                maxLength={120}
                className={inputCls}
                placeholder={t("platform.common.jobTitlePlaceholder")}
              />
            </label>
            <button
              type="submit"
              disabled={savingProfile}
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60"
            >
              {savingProfile ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t("platform.account.saveProfile")}
            </button>
          </form>
        </Panel>

        <Panel>
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="h-5 w-5 text-brand" />
            <h2 className="text-base font-semibold">{t("platform.account.password")}</h2>
          </div>
          <form onSubmit={handlePasswordSave} className="space-y-4">
            <label className="block text-sm">
              <div className="text-muted-foreground mb-1">{t("platform.account.newPassword")}</div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={inputCls}
                placeholder="At least 8 characters"
              />
            </label>
            <label className="block text-sm">
              <div className="text-muted-foreground mb-1">
                {t("platform.account.confirmPassword")}
              </div>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={inputCls}
              />
            </label>
            <button
              type="submit"
              disabled={savingPassword}
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60"
            >
              {savingPassword ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              {t("platform.account.updatePassword")}
            </button>
            <p className="text-xs text-muted-foreground">{t("platform.account.passwordHint")}</p>
          </form>
        </Panel>
        <MfaSettingsPanel />
      </div>
    </div>
  );
}
