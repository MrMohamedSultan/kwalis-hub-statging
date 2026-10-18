import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Save, RotateCcw, Loader2, UserCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageTitle, Panel } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { clearMyPasswordChangeRequirement } from "@/lib/account-status";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_platform-hub/platform-hub/settings")({
  head: () => ({
    meta: [
      { title: "Platform Settings — Kwalis HUB" },
      {
        name: "description",
        content: "System-wide configuration: currency rates, templates and integrations.",
      },
      { property: "og:title", content: "Platform Settings — Kwalis HUB" },
      {
        property: "og:description",
        content: "System-wide configuration: currency rates, templates and integrations.",
      },
    ],
  }),
  component: PlatformSettingsPage,
});

const STORAGE_KEY = "kwalis.platform-settings";

type PlatformSettings = {
  baseCurrency: string;
  usdRate: string;
  eurRate: string;
  aedRate: string;
  whtRate: string;
  vatRate: string;
  fiscalYearStart: string;
  defaultProjectLimit: string;
  defaultLanguage: "en" | "ar";
  requireApprovalAbove: string;
};

const DEFAULTS: PlatformSettings = {
  baseCurrency: "SAR",
  usdRate: "3.75",
  eurRate: "4.05",
  aedRate: "1.02",
  whtRate: "5",
  vatRate: "15",
  fiscalYearStart: "01-01",
  defaultProjectLimit: "5",
  defaultLanguage: "en",
  requireApprovalAbove: "50000",
};

type SettingsTab = "config" | "profile";

function PlatformSettingsPage() {
  const { t } = useTranslation();

  const [tab, setTab] = useState<SettingsTab>("config");

  const tabs: { key: SettingsTab; label: string; icon: typeof ShieldCheck }[] = [
    { key: "config", label: "Platform Configuration", icon: ShieldCheck },
    { key: "profile", label: "My Super Admin Profile", icon: UserCircle },
  ];

  return (
    <>
      <PageTitle title={t("hub_settings.platform_settings")} back={false} />
      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
        {tabs.map((tItem) => {
          const active = tab === tItem.key;
          const Icon = tItem.icon;
          return (
            <button
              key={tItem.key}
              type="button"
              onClick={() => setTab(tItem.key)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-brand font-semibold text-brand-foreground"
                  : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {tItem.label}
            </button>
          );
        })}
      </div>
      {tab === "config" ? <PlatformConfigTab /> : <MyProfileTab />}
    </>
  );
}

function MyProfileTab() {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, job_title")
        .eq("id", data.user.id)
        .maybeSingle();
      if (cancelled) return;
      setUserId(data.user.id);
      setEmail(data.user.email ?? "");
      setDisplayName(profile?.display_name ?? "");
      setJobTitle(profile?.job_title ?? "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const name = displayName.trim();
    if (name.length < 2 || name.length > 120) {
      toast.error(t("hub_settings.display_name_must_be_between_2_and_120"));
      return;
    }
    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: name, job_title: jobTitle.trim() || null })
        .eq("id", userId);
      if (error) throw error;
      toast.success(t("hub_settings.profile_updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8 || password.length > 128) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t("hub_settings.passwords_do_not_match"));
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await clearMyPasswordChangeRequirement(); // D08
      setPassword("");
      setConfirmPassword("");
      toast.success(t("hub_settings.password_updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="me-2 size-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        {t("hub_settings.you_must_be_signed_in_to_manage_your")}
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel>
        <h3 className="mb-4 text-sm font-semibold">{t("hub_settings.personal_details")}</h3>
        <form onSubmit={saveProfile} className="space-y-4">
          <Field label="Email (read-only)">
            <input
              type="email"
              value={email}
              readOnly
              disabled
              className="w-full cursor-not-allowed rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground outline-none"
            />
          </Field>
          <Field label="Display name">
            <Input value={displayName} onChange={setDisplayName} />
          </Field>
          <Field label="Job title">
            <Input value={jobTitle} onChange={setJobTitle} />
          </Field>
          <button
            type="submit"
            disabled={savingProfile}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
          >
            {savingProfile && <Loader2 className="size-3.5 animate-spin" />} Save profile
          </button>
        </form>
      </Panel>

      <Panel>
        <h3 className="mb-4 text-sm font-semibold">Security</h3>
        <form onSubmit={savePassword} className="space-y-4">
          <Field label="New password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Min. 8 characters"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
            />
          </Field>
          <button
            type="submit"
            disabled={savingPassword}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
          >
            {savingPassword && <Loader2 className="size-3.5 animate-spin" />} Update password
          </button>
          <p className="text-xs text-muted-foreground">
            Changing your password signs you out of other devices the next time their session
            refreshes.
          </p>
        </form>
      </Panel>
    </div>
  );
}

function PlatformConfigTab() {
  const { t } = useTranslation();

  const [form, setForm] = useState<PlatformSettings>(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setForm({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<PlatformSettings>) });
    } catch {
      /* ignore malformed cache */
    }
  }, []);

  function set<K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    setDirty(false);
    toast.success(t("hub_settings.platform_settings_saved"));
  }

  function reset() {
    setForm(DEFAULTS);
    setDirty(true);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          <RotateCcw className="size-3.5" />
          {t("hub_settings.reset_defaults")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-40"
        >
          <Save className="size-3.5" />
          {t("hub_settings.save_changes")}
        </button>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        System-wide configuration applied as defaults across every client company. This is platform
        configuration, not your personal profile.
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <h3 className="mb-4 text-sm font-semibold">{t("hub_settings.currency_fx_rates")}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Base currency">
              <Select
                value={form.baseCurrency}
                onChange={(v) => set("baseCurrency", v)}
                options={["SAR", "USD", "EUR", "AED"]}
              />
            </Field>
            <Field label="USD → base rate">
              <Input value={form.usdRate} onChange={(v) => set("usdRate", v)} type="number" />
            </Field>
            <Field label="EUR → base rate">
              <Input value={form.eurRate} onChange={(v) => set("eurRate", v)} type="number" />
            </Field>
            <Field label="AED → base rate">
              <Input value={form.aedRate} onChange={(v) => set("aedRate", v)} type="number" />
            </Field>
          </div>
        </Panel>

        <Panel>
          <h3 className="mb-4 text-sm font-semibold">{t("hub_settings.tax_defaults")}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Withholding tax (%)">
              <Input value={form.whtRate} onChange={(v) => set("whtRate", v)} type="number" />
            </Field>
            <Field label="VAT (%)">
              <Input value={form.vatRate} onChange={(v) => set("vatRate", v)} type="number" />
            </Field>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Applied as the default for new companies; each production can override per contract.
          </p>
        </Panel>

        <Panel>
          <h3 className="mb-4 text-sm font-semibold">{t("hub_settings.company_defaults")}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fiscal year start (MM-DD)">
              <Input value={form.fiscalYearStart} onChange={(v) => set("fiscalYearStart", v)} />
            </Field>
            <Field label="Default project limit">
              <Input
                value={form.defaultProjectLimit}
                onChange={(v) => set("defaultProjectLimit", v)}
                type="number"
              />
            </Field>
            <Field label="Default language">
              <Select
                value={form.defaultLanguage}
                onChange={(v) => set("defaultLanguage", v as "en" | "ar")}
                options={["en", "ar"]}
              />
            </Field>
          </div>
        </Panel>

        <Panel>
          <h3 className="mb-4 text-sm font-semibold">{t("hub_settings.approval_policy")}</h3>
          <Field label="Require board approval above (base currency)">
            <Input
              value={form.requireApprovalAbove}
              onChange={(v) => set("requireApprovalAbove", v)}
              type="number"
            />
          </Field>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("hub_settings.payments_above_this_threshold_require_an_additional_approval")}
          </p>
        </Panel>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
    />
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
