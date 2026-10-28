import { useTranslation } from "react-i18next";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  Mail,
  Lock,
  ArrowRight,
  Shield,
  ShieldCheck,
  User,
  AlertTriangle,
  MailCheck,
  Eye,
  EyeOff,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { AccessRequestForm } from "@/components/auth/AccessRequestForm";
import { BetaBadge } from "@/components/BetaBadge";
import { TRANSIENT_SESSION_KEY } from "@/lib/session-persistence";
import { useLoginRateLimiter, WARN_THRESHOLD, FIRST_LOCK_AT } from "@/hooks/useLoginRateLimiter";
import { logSecurityEvent } from "@/lib/security-logger";
import { signInWithLockout, type SignInResult } from "@/lib/auth-login.functions";
import { MfaChallenge } from "@/components/auth/MfaChallenge";
import { LegalLinks } from "@/components/LegalLinks";
import { getMfaState, needsSecondStep } from "@/lib/mfa";
import i18n from "@/lib/i18n";

const searchSchema = z.object({
  invite: z.string().uuid().optional(),
  next: z.string().optional(),
});

// Messages are resolved when validation runs, so they follow the active language.
const credentialsSchema = () =>
  z.object({
    email: z
      .string()
      .trim()
      .min(1, i18n.t("platform.auth.emailRequired"))
      .email(i18n.t("platform.auth.emailInvalid"))
      .max(255, i18n.t("platform.auth.emailTooLong")),
    password: z
      .string()
      .min(6, i18n.t("platform.auth.passwordTooShort"))
      .max(72, i18n.t("platform.auth.passwordTooLong")),
    displayName: z.string().trim().max(100, i18n.t("platform.auth.nameTooLong")).optional(),
  });

type FieldErrors = Partial<Record<"email" | "password" | "displayName", string>>;

// Only allow same-origin relative paths for post-auth redirects.

function safeNext(next?: string): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

/** Fork post-login destination: platform owners never enter org chrome. */
async function landingPath(): Promise<string> {
  const { getAuthRolesSnapshot } = await import("@/lib/auth-roles");
  const { landingPathForRoles } = await import("@/lib/landing-redirect");
  return landingPathForRoles(await getAuthRolesSnapshot());
}

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — Kwalis HUB" },
      {
        name: "description",
        content: "Access your Kwalis HUB workspace. Beyond the Scenes, In Control.",
      },
    ],
  }),
  component: AuthPortal,
});

type InviteInfo = {
  email: string;
  organization_name: string;
  expires_at: string;
  accepted: boolean;
  revoked: boolean;
};

function AuthPortal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { invite, next } = useSearch({ from: "/auth" });
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const {
    isLocked,
    lockTimeRemaining,
    failedAttempts,
    applyServerState,
    recordFailure,
    recordSuccess,
  } = useLoginRateLimiter();
  // X02: set when the password was right and the account has an authenticator app.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);

  /** Validate the current form values; returns field-level messages. */
  const validate = (): FieldErrors => {
    const values = {
      email: mode === "signup" && inviteInfo ? inviteInfo.email : email,
      password,
      displayName,
    };
    const parsed = credentialsSchema().safeParse(values);
    if (parsed.success) return {};
    const next: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof FieldErrors;
      if (key && !next[key]) next[key] = issue.message;
    }
    return next;
  };

  /** Re-run validation for one field once the user has interacted with it. */
  const handleBlur = (field: keyof FieldErrors) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const result = validate();
    setErrors((prev) => ({ ...prev, [field]: result[field] }));
  };

  const errorFor = (field: keyof FieldErrors) => (touched[field] ? errors[field] : undefined);

  // Lockout state is read from localStorage, so it only exists on the client.
  // Gate those blocks behind hydration to keep SSR and client markup identical.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const [sendingReset, setSendingReset] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const sendPasswordReset = async () => {
    const addr = email.trim();
    if (!addr || !z.string().email().safeParse(addr).success) {
      setTouched((prev) => ({ ...prev, email: true }));
      setErrors((prev) => ({ ...prev, email: t("platform.auth.emailInvalid") }));
      toast.error(t("auth.resetEnterEmail"));
      return;
    }
    setSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(addr, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Same answer whether or not the address has an account (no user
      // enumeration); only a rate limit is worth telling the user.
      if (error && /rate limit|too many/i.test(error.message)) throw error;
      setResetSent(true);
      toast.success(t("auth.resetSent"));
    } catch {
      toast.error(t("platform.auth.resetFailed"));
    } finally {
      setSendingReset(false);
    }
  };

  const target = safeNext(next);

  // Redirect signed-in users away — platform owners go to the isolated
  // admin branch, everyone else lands in their org workspace.
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user) {
        if (target) window.location.href = target;
        else navigate({ to: (await landingPath()) as "/" });
      }
    });
  }, [navigate, target]);

  // Fetch invitation if token present
  useEffect(() => {
    if (!invite) return;
    setLoadingInvite(true);
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_invitation_by_token", { _token: invite });
        if (error) {
          setInviteError(error.message);
          return;
        }
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) {
          setInviteError(t("platform.auth.inviteNotFound"));
          return;
        }
        if (row.revoked) setInviteError(t("platform.auth.inviteRevoked"));
        else if (row.accepted) setInviteError(t("platform.auth.inviteUsed"));
        else if (new Date(row.expires_at) < new Date())
          setInviteError(t("platform.auth.inviteExpired"));
        else {
          setInviteInfo(row as InviteInfo);
          setEmail(row.email);
          setMode("signup");
        }
      } finally {
        setLoadingInvite(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite]);

  /** Land the user in their workspace once the session is fully trusted. */
  const finishSignIn = async () => {
    if (target) window.location.href = target;
    else navigate({ to: (await landingPath()) as "/" });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    const validation = validate();
    setTouched({ email: true, password: true, displayName: true });
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    setSubmitting(true);
    try {
      if (mode === "signup") {
        if (!inviteInfo) {
          toast.error(t("auth.signup_is_invitationonly_ask_an_admin_for_an"));
          setSubmitting(false);
          return;
        }
        const { error } = await supabase.auth.signUp({
          email: inviteInfo.email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName || inviteInfo.email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success(t("auth.account_created_welcome_to") + inviteInfo.organization_name);
      } else {
        const isDemo = email.trim().toLowerCase() === "demo@kwalishub.com";
        let result = await serverSignIn(email, password);
        if (isDemo && !result.ok && result.reason === "invalid" && !result.message) {
          toast.message(t("platform.auth.preparingDemo"));
          const { ensureDemoSignInReady } = await import("@/lib/demo.functions");
          await ensureDemoSignInReady();
          result = await serverSignIn(email, password);
          if (result.ok) toast.success(t("auth.demo_account_ready"));
        }
        if (!result.ok) {
          if (result.reason === "locked") {
            applyServerState(email, result.failedCount, result.lockedUntil);
            void logSecurityEvent({
              event_type: "account_locked",
              email,
              attempt_count: result.failedCount,
            });
            throw new Error(t("security.loginLockedTitle"));
          }
          if (result.reason === "invalid") {
            applyServerState(email, result.failedCount, null);
            void logSecurityEvent({
              event_type: "failed_login",
              email,
              attempt_count: result.failedCount,
            });
            throw new Error(result.message ?? t("platform.auth.invalidCredentials"));
          }
          // Server lockout not configured: sign in directly (GoTrue hook still applies).
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) {
            const { count, lockedMinutes } = recordFailure(email);
            void logSecurityEvent({ event_type: "failed_login", email, attempt_count: count });
            if (lockedMinutes > 0) {
              void logSecurityEvent({
                event_type: "account_locked",
                email,
                attempt_count: count,
                lock_duration_minutes: lockedMinutes,
              });
            }
            throw error;
          }
        }

        // "Remember me" off → drop the session when the browser closes.
        try {
          if (rememberMe) sessionStorage.removeItem(TRANSIENT_SESSION_KEY);
          else sessionStorage.setItem(TRANSIENT_SESSION_KEY, "true");
        } catch {
          /* storage unavailable — session persistence stays at the default */
        }
      }
      if (mode === "signin") {
        // A success after earlier failures is a security signal worth logging.
        if (failedAttempts > 0) {
          void logSecurityEvent({
            event_type: "successful_login_after_failures",
            email,
            attempt_count: failedAttempts,
          });
        }
        recordSuccess();
        // X02: second step when the account has an authenticator app.
        const mfa = await getMfaState().catch(() => null);
        if (mfa && needsSecondStep(mfa) && mfa.factors[0]) {
          setMfaFactorId(mfa.factors[0].id);
          return;
        }
      }
      await finishSignIn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("platform.auth.authFailed");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const showSignup = mode === "signup" && !!inviteInfo;

  return (
    // Pinned dark in BOTH themes: the `dark` class re-declares the canonical
    // dark token set (see styles.css) and sets color-scheme:dark, so this page
    // never splits dark-brand-panel vs light-form, regardless of saved theme.
    // Strictly scoped — the class leaves the DOM with this route.
    <div className="dark min-h-screen w-full grid lg:grid-cols-[1.05fr_1fr] bg-background text-foreground">
      <aside className="on-dark relative hidden lg:flex flex-col justify-between p-12 overflow-hidden bg-gradient-to-br from-[#12173a] via-[#1b2160] to-[#0d1030] text-white">
        <div className="absolute inset-0 opacity-30 pointer-events-none [background-image:radial-gradient(circle_at_20%_15%,oklch(0.7_0.18_290)_0%,transparent_45%),radial-gradient(circle_at_85%_75%,oklch(0.65_0.18_250)_0%,transparent_50%)]" />
        <div className="relative flex flex-col items-start">
          <div dir="ltr" className="flex items-center gap-2">
            <img
              src="/kwalis-logo.png"
              alt={t("common.platformName")}
              className="w-64 md:w-72 h-auto object-contain max-w-none shrink-0"
            />
            <BetaBadge />
          </div>
        </div>

        <div className="relative space-y-6 max-w-md">
          <h1 className="text-4xl xl:text-5xl font-bold leading-[1.05] tracking-tight text-white">
            {t("auth.hero.line1")}
            <br />
            {t("auth.hero.line2")}
            <br />
            <span className="text-[#9b99ff]">{t("auth.hero.line3")}</span>
          </h1>
          <p className="text-base leading-relaxed text-white/90">{t("auth.hero.blurb")}</p>
        </div>

        <div className="relative text-xs text-white/60">
          © {new Date().getFullYear()} {t("common.platformName")} · {t("auth.hero.footer")}
        </div>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div dir="ltr" className="lg:hidden flex items-center gap-3 mb-8">
            <img
              src="/kwalis-logo.png"
              alt={t("common.platformName")}
              className="h-12 w-auto object-contain max-w-none shrink-0"
            />
            <BetaBadge />
          </div>

          {showRequestForm ? (
            <div className="space-y-6">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-brand mb-3">
                  <ShieldCheck className="size-3.5" /> {t("auth.requestAccessEyebrow")}
                </div>
                <h2 className="text-3xl font-bold tracking-tight">
                  {t("auth.tellUsAboutCompany")}
                </h2>
                <p className="text-muted-foreground mt-1.5 text-sm">{t("auth.onboardBlurb")}</p>
              </div>
              <AccessRequestForm onBackToLogin={() => setShowRequestForm(false)} />
              <p className="text-center text-xs text-muted-foreground">
                {t("platform.auth.haveAccount")}{" "}
                <button
                  type="button"
                  onClick={() => setShowRequestForm(false)}
                  className="text-brand font-semibold hover:underline"
                >
                  {t("auth.sign_in")}
                </button>
              </p>
            </div>
          ) : mfaFactorId ? (
            <MfaChallenge
              factorId={mfaFactorId}
              onVerified={() => void finishSignIn()}
              onCancel={() => {
                setMfaFactorId(null);
                void supabase.auth.signOut();
              }}
            />
          ) : (
            <>
              <div className="mb-7">
                <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-brand mb-3">
                  <ShieldCheck className="size-3.5" />{" "}
                  {showSignup ? t("platform.auth.acceptInvitation") : t("platform.auth.secureSignIn")}
                </div>
                <h2 className="text-3xl font-bold tracking-tight">
                  {showSignup ? t("platform.auth.completeAccount") : t("platform.auth.welcomeBack")}
                </h2>
                <p className="text-muted-foreground mt-1.5 text-sm">
                  {showSignup
                    ? t("platform.auth.invitedTo", { org: inviteInfo!.organization_name })
                    : t("platform.auth.signInBlurb")}
                </p>
              </div>

              {/* Invite status banners */}
              {loadingInvite && (
                <div className="mb-4 rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground">
                  {t("platform.auth.verifyingInvitation")}
                </div>
              )}
              {inviteError && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">{t("auth.invitationProblem")}</div>
                    <div>{inviteError}</div>
                    <div className="mt-1 text-destructive">{t("auth.invitationContactAdmin")}</div>
                  </div>
                </div>
              )}
              {showSignup && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-success/40 bg-success/10 p-3 text-xs text-success">
                  <MailCheck className="size-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">{t("auth.invitationVerified")}</div>
                    <div>
                      {t("auth.joiningAs", {
                        org: inviteInfo!.organization_name,
                        email: inviteInfo!.email,
                      })}
                    </div>
                  </div>
                </div>
              )}

              {hydrated && isLocked && (
                <div
                  role="alert"
                  className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                >
                  <Shield className="size-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">{t("security.loginLockedTitle")}</div>
                    <div>{t("security.loginLockedBody", { time: lockTimeRemaining })}</div>
                  </div>
                </div>
              )}
              {hydrated && !isLocked && mode === "signin" && failedAttempts >= WARN_THRESHOLD && (
                <div
                  role="alert"
                  className="mb-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning"
                >
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <div>
                    {t("security.attemptsRemaining", {
                      count: Math.max(0, FIRST_LOCK_AT - failedAttempts),
                    })}
                  </div>
                </div>
              )}

              <form onSubmit={onSubmit} noValidate className="space-y-4">
                {showSignup && (
                  <Field
                    icon={<User className="size-4" />}
                    label={t("auth.displayName")}
                    error={errorFor("displayName")}
                    errorId="auth-displayname-error"
                  >
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      onBlur={() => handleBlur("displayName")}
                      placeholder={t("auth.displayNamePlaceholder")}
                      autoComplete="name"
                      aria-invalid={!!errorFor("displayName")}
                      aria-describedby={
                        errorFor("displayName") ? "auth-displayname-error" : undefined
                      }
                      className="w-full bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                    />
                  </Field>
                )}

                <Field
                  icon={<Mail className="size-4" />}
                  label={t("auth.workEmail")}
                  error={errorFor("email")}
                  errorId="auth-email-error"
                >
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (touched.email) setErrors((prev) => ({ ...prev, email: undefined }));
                    }}
                    onBlur={() => handleBlur("email")}
                    placeholder={t("auth.emailPlaceholder")}
                    autoComplete="email"
                    readOnly={showSignup}
                    disabled={isLocked}
                    aria-invalid={!!errorFor("email")}
                    aria-describedby={errorFor("email") ? "auth-email-error" : undefined}
                    className="w-full bg-transparent outline-none text-sm placeholder:text-muted-foreground disabled:opacity-60"
                    required
                  />
                </Field>

                <Field
                  icon={<Lock className="size-4" />}
                  label={t("auth.password")}
                  error={errorFor("password")}
                  errorId="auth-password-error"
                >
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (touched.password) setErrors((prev) => ({ ...prev, password: undefined }));
                    }}
                    onBlur={() => handleBlur("password")}
                    placeholder="••••••••••••"
                    autoComplete={showSignup ? "new-password" : "current-password"}
                    minLength={6}
                    disabled={isLocked}
                    aria-invalid={!!errorFor("password")}
                    aria-describedby={errorFor("password") ? "auth-password-error" : undefined}
                    className="w-full bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                    aria-pressed={showPassword}
                    className="text-muted-foreground hover:text-foreground transition shrink-0"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </Field>

                {!showSignup && (
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="size-4 rounded border-border accent-[var(--brand)] cursor-pointer"
                      />
                      <span className="text-sm text-muted-foreground">{t("auth.rememberMe")}</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => void sendPasswordReset()}
                      disabled={sendingReset}
                      className="text-xs font-semibold text-brand hover:underline disabled:opacity-60"
                    >
                      {sendingReset ? t("auth.resetSending") : t("auth.forgotPassword")}
                    </button>
                  </div>
                )}

                {resetSent && (
                  <p className="text-xs text-muted-foreground">{t("auth.resetSentHint")}</p>
                )}

                <button
                  type="submit"
                  disabled={submitting || isLocked || (mode === "signup" && !inviteInfo)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand text-brand-foreground font-semibold py-3 text-sm shadow-lg shadow-brand/20 hover:brightness-110 transition disabled:opacity-60"
                >
                  {submitting ? (
                    showSignup ? (
                      t("platform.auth.creatingAccount")
                    ) : (
                      t("platform.auth.signingIn")
                    )
                  ) : (
                    <>
                      {showSignup ? t("platform.auth.createAccount") : t("auth.sign_in")}{" "}
                      <ArrowRight className="size-4 rtl:rotate-180" />
                    </>
                  )}
                </button>

                {mode === "signin" && failedAttempts > 0 && !isLocked && (
                  <p className="text-center text-[11px] text-muted-foreground tabular-nums">
                    {t("security.attemptCounter", { count: failedAttempts, max: FIRST_LOCK_AT })}
                  </p>
                )}
              </form>

              <p className="text-center text-xs text-muted-foreground mt-8">
                {showSignup ? (
                  <>
                    {t("platform.auth.haveAccount")}{" "}
                    <button
                      onClick={() => {
                        setMode("signin");
                        setInviteInfo(null);
                      }}
                      className="text-brand font-semibold hover:underline"
                    >
                      {t("auth.sign_in")}
                    </button>
                  </>
                ) : (
                  <>
                    {t("platform.auth.noAccount")}{" "}
                    <button
                      type="button"
                      onClick={() => setShowRequestForm(true)}
                      className="text-brand font-semibold hover:underline"
                    >
                      {t("auth.request_access")}
                    </button>
                  </>
                )}
              </p>
            </>
          )}
          <LegalLinks className="mt-6 justify-center" />
        </div>
      </main>
    </div>
  );
}

/** Sign-in through the server lockout; a transport failure counts as "unavailable". */
async function serverSignIn(email: string, password: string): Promise<SignInResult> {
  try {
    const result = await signInWithLockout({ data: { email, password } });
    if (result.ok) {
      const { error } = await supabase.auth.setSession({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      });
      if (error) throw error;
    }
    return result;
  } catch (err) {
    console.warn("[auth] server sign-in unavailable:", err);
    return { ok: false, reason: "unavailable" };
  }
}

function Field({
  icon,
  label,
  hint,
  error,
  errorId,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  error?: string;
  errorId?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">
        {label}
      </div>
      <div
        className={`flex items-center gap-2.5 rounded-xl border bg-surface px-3.5 py-2.5 transition focus-within:ring-2 ${
          error
            ? "border-destructive focus-within:ring-destructive"
            : "border-border focus-within:ring-brand"
        }`}
      >
        <span className={error ? "text-destructive" : "text-muted-foreground"}>{icon}</span>
        <div className="flex-1 min-w-0">{children}</div>
        {hint && <span className="text-xs text-muted-foreground whitespace-nowrap">{hint}</span>}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </label>
  );
}
