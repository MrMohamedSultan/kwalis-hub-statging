import { useState } from "react";
import { z } from "zod";
import { ArrowRight, Building2, Mail, MessageSquare, Phone, User, Factory } from "lucide-react";
import { INDUSTRIES, submitAccessRequest } from "@/lib/access-requests";

import { useTranslation } from "react-i18next";
const schema = z.object({
  fullName: z.string().trim().min(2, "Please enter your full name.").max(200),
  company: z.string().trim().min(2, "Please enter your company name.").max(200),
  industry: z.string().trim().min(1, "Please select an industry."),
  email: z.string().trim().email("Please enter a valid email address.").max(255),
  mobile: z
    .string()
    .trim()
    .max(40)
    .refine((v) => v.replace(/\D/g, "").length >= 8, "Please enter a valid mobile number."),
  message: z.string().trim().max(500).optional(),
});

const EMPTY = { fullName: "", company: "", industry: "", email: "", mobile: "", message: "" };

export function AccessRequestForm({ onBackToLogin }: { onBackToLogin: () => void }) {
  const { t } = useTranslation();

  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await submitAccessRequest(parsed.data);
      setSuccess(true);
    } catch {
      setSubmitError("Failed to submit your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="mx-auto size-12 rounded-xl bg-success/15 border border-success/30 grid place-items-center text-success text-xl">
          ✓
        </div>
        <h3 className="text-lg font-bold text-foreground">
          {t("accessrequestform.request_submitted_successfully")}
        </h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Thank you for your interest in Kwalis HUB. Our team will review your request and get back
          to you within 1–2 business days.
        </p>
        <button
          type="button"
          onClick={onBackToLogin}
          className="text-sm text-brand hover:underline font-medium"
        >
          ← Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <FormField icon={<User className="size-4" />} label="Full name" error={errors.fullName}>
        <input
          value={form.fullName}
          onChange={(e) => set("fullName", e.target.value)}
          maxLength={200}
          placeholder={t("accessrequestform.your_name")}
          className="w-full bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
      </FormField>

      <FormField
        icon={<Building2 className="size-4" />}
        label="Company name"
        error={errors.company}
      >
        <input
          value={form.company}
          onChange={(e) => set("company", e.target.value)}
          maxLength={200}
          placeholder={t("accessrequestform.production_company")}
          className="w-full bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
      </FormField>

      <FormField icon={<Factory className="size-4" />} label="Industry" error={errors.industry}>
        <select
          value={form.industry}
          onChange={(e) => set("industry", e.target.value)}
          className="w-full bg-transparent outline-none text-sm text-foreground"
        >
          <option value="">Select an industry…</option>
          {INDUSTRIES.map((i) => (
            <option key={i.value} value={i.value} className="bg-surface text-foreground">
              {i.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField icon={<Mail className="size-4" />} label="Work email" error={errors.email}>
        <input
          type="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          maxLength={255}
          placeholder={t("accessrequestform.youstudiocom")}
          className="w-full bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
      </FormField>

      <FormField icon={<Phone className="size-4" />} label="Mobile" error={errors.mobile}>
        <input
          type="tel"
          value={form.mobile}
          onChange={(e) => set("mobile", e.target.value)}
          maxLength={40}
          placeholder="+966 50 000 0000"
          className="w-full bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
      </FormField>

      <FormField
        icon={<MessageSquare className="size-4" />}
        label="Message (optional)"
        error={errors.message}
      >
        <textarea
          value={form.message}
          onChange={(e) => set("message", e.target.value)}
          maxLength={500}
          rows={3}
          placeholder={t("accessrequestform.tell_us_about_your_productions_and_what_youre")}
          className="w-full bg-transparent outline-none text-sm placeholder:text-muted-foreground resize-none"
        />
      </FormField>

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand text-brand-foreground font-semibold py-3 text-sm shadow-lg shadow-brand/20 hover:brightness-110 transition disabled:opacity-60"
      >
        {submitting ? (
          "Submitting…"
        ) : (
          <>
            {t("accessrequestform.submit_request")}
            <ArrowRight className="size-4" />
          </>
        )}
      </button>
    </form>
  );
}

function FormField({
  icon,
  label,
  error,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">
        {label}
      </div>
      <div
        className={`flex items-start gap-2.5 rounded-xl border bg-surface px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-brand transition ${
          error ? "border-destructive/60" : "border-border"
        }`}
      >
        <span className="text-muted-foreground mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
      {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
    </label>
  );
}
