// ═══════════════════════════════════════════════════════════════════
// E10 / decision 9 — Film Commission settings of the active project:
// rebate rate, cap (SAR excl. VAT), agreement number / date / duration,
// official production period, cash limits, VAT rate, working week.
// Only an administrator can save; once approved the settings are locked
// and a change needs a reason. Every change is in the audit trail and the
// rebate report's change log. The FX rate is shown read-only (it has its
// own locked setting and log in the currency panel).
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/AppShell";
import { DateInput } from "@/components/ui/date-input";
import { useStore } from "@/lib/store";
import { formatDateTime } from "@/lib/date-format";
import { humanizeDbError } from "@/lib/db-errors";
import {
  approveRebateSettings,
  rebateSettingsSchema,
  saveRebateSettings,
  useInvalidateRebateSettings,
  useRebateSettings,
  type RebateSettingsInput,
} from "@/lib/rebate-settings";
import { defaultOffDays } from "@/features/reports/rebate/rebate-calc";

type Form = {
  rebate_rate_pct: string;
  rebate_cap_sar: string;
  fc_agreement_no: string;
  fc_agreement_date: string;
  fc_agreement_months: string;
  production_period_from: string;
  production_period_to: string;
  cash_limit_pct_of_qpe: string;
  cash_limit_per_txn_sar: string;
  vat_rate_pct: string;
  work_days_per_week: string;
  weekly_off_days: number[];
};

const EMPTY: Form = {
  rebate_rate_pct: "",
  rebate_cap_sar: "",
  fc_agreement_no: "",
  fc_agreement_date: "",
  fc_agreement_months: "",
  production_period_from: "",
  production_period_to: "",
  cash_limit_pct_of_qpe: "",
  cash_limit_per_txn_sar: "",
  vat_rate_pct: "15",
  work_days_per_week: "5",
  weekly_off_days: [5, 6],
};

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: string) => (v.trim() === "" ? null : Number(v));

function toInput(f: Form): RebateSettingsInput {
  return {
    rebate_rate_pct: n(f.rebate_rate_pct),
    rebate_cap_sar: n(f.rebate_cap_sar),
    fc_agreement_no: f.fc_agreement_no.trim() || null,
    fc_agreement_date: f.fc_agreement_date || null,
    fc_agreement_months: n(f.fc_agreement_months),
    production_period_from: f.production_period_from || null,
    production_period_to: f.production_period_to || null,
    cash_limit_pct_of_qpe: n(f.cash_limit_pct_of_qpe),
    cash_limit_per_txn_sar: n(f.cash_limit_per_txn_sar),
    vat_rate_pct: Number(f.vat_rate_pct || 15),
    work_days_per_week: Number(f.work_days_per_week || 5),
    weekly_off_days: f.weekly_off_days,
  };
}

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function FilmCommissionSettingsPanel() {
  const { t } = useTranslation();
  const project = useStore((st) => st.projects.find((p) => p.id === st.activeProjectId) ?? null);
  const projectId = project?.id ?? null;
  const q = useRebateSettings(projectId);
  const invalidate = useInvalidateRebateSettings();
  const [form, setForm] = useState<Form>(EMPTY);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<null | "save" | "approve">(null);
  const settings = q.data?.settings ?? null;
  const canAdmin = !!q.data?.canAdmin;
  const locked = !!settings?.approved_at;

  useEffect(() => {
    if (!settings) {
      setForm(EMPTY);
      return;
    }
    setForm({
      rebate_rate_pct: s(settings.rebate_rate_pct),
      rebate_cap_sar: s(settings.rebate_cap_sar),
      fc_agreement_no: s(settings.fc_agreement_no),
      fc_agreement_date: s(settings.fc_agreement_date),
      fc_agreement_months: s(settings.fc_agreement_months),
      production_period_from: s(settings.production_period_from),
      production_period_to: s(settings.production_period_to),
      cash_limit_pct_of_qpe: s(settings.cash_limit_pct_of_qpe),
      cash_limit_per_txn_sar: s(settings.cash_limit_per_txn_sar),
      vat_rate_pct: s(settings.vat_rate_pct),
      work_days_per_week: s(settings.work_days_per_week),
      weekly_off_days: settings.weekly_off_days,
    });
    setReason("");
  }, [settings]);

  if (!projectId) return null;
  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const readOnly = !canAdmin;

  const save = async () => {
    const parsed = rebateSettingsSchema.safeParse(toInput(form));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      toast.error(
        t(`rebate.set.err_${String(issue?.message ?? "invalid")}`, {
          defaultValue: t("rebate.set.err_invalid"),
        }),
      );
      return;
    }
    if (locked && reason.trim().length < 5) {
      toast.error(t("rebate.set.reason_required"));
      return;
    }
    setBusy("save");
    try {
      await saveRebateSettings(projectId, parsed.data, reason);
      toast.success(t("rebate.set.saved"));
      await invalidate();
    } catch (e) {
      toast.error(humanizeDbError(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleApprove = async () => {
    if (locked && reason.trim().length < 5) {
      toast.error(t("rebate.set.unlock_reason_required"));
      return;
    }
    setBusy("approve");
    try {
      await approveRebateSettings(projectId, !locked, reason);
      toast.success(locked ? t("rebate.set.unlocked") : t("rebate.set.approved"));
      await invalidate();
    } catch (e) {
      toast.error(humanizeDbError(e));
    } finally {
      setBusy(null);
    }
  };

  const input =
    "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-60";
  const field = (
    k: keyof Form,
    labelKey: string,
    type: "number" | "text" = "number",
    hint?: string,
  ) => (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{t(labelKey)}</span>
      <input
        type={type}
        inputMode={type === "number" ? "decimal" : undefined}
        value={form[k] as string}
        onChange={(e) => set(k)(e.target.value)}
        disabled={readOnly}
        className={input}
        maxLength={type === "text" ? 100 : undefined}
      />
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
  const dateField = (k: keyof Form, labelKey: string) => (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{t(labelKey)}</span>
      <DateInput value={form[k] as string} onChange={set(k)} disabled={readOnly} />
    </label>
  );

  return (
    <Panel className="max-w-3xl space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{t("rebate.set.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("rebate.set.subtitle")}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
            locked ? "border-success/30 text-success" : "border-warning/30 text-warning"
          }`}
        >
          {locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
          {locked
            ? t("rebate.set.locked_on", { date: formatDateTime(settings?.approved_at) })
            : t("rebate.set.not_approved")}
        </span>
      </div>
      {q.isLoading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <>
          {readOnly && (
            <p className="text-xs text-muted-foreground">{t("rebate.set.admin_only")}</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {field("rebate_rate_pct", "rebate.set.rate")}
            {field("rebate_cap_sar", "rebate.set.cap", "number", t("rebate.set.cap_hint"))}
            {field("fc_agreement_no", "rebate.set.agreement_no", "text")}
            {dateField("fc_agreement_date", "rebate.set.agreement_date")}
            {field("fc_agreement_months", "rebate.set.agreement_months")}
            <div className="hidden sm:block" />
            {dateField("production_period_from", "rebate.set.period_from")}
            {dateField("production_period_to", "rebate.set.period_to")}
            {field("cash_limit_pct_of_qpe", "rebate.set.cash_pct")}
            {field("cash_limit_per_txn_sar", "rebate.set.cash_txn")}
            {field("vat_rate_pct", "rebate.set.vat")}
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                {t("rebate.set.fx")}
              </span>
              <input value={s(project?.fxRate)} disabled className={input} />
              <span className="text-[11px] text-muted-foreground">{t("rebate.set.fx_hint")}</span>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                {t("rebate.set.work_days")}
              </span>
              <select
                value={form.work_days_per_week}
                disabled={readOnly}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    work_days_per_week: e.target.value,
                    weekly_off_days: defaultOffDays(Number(e.target.value)),
                  }))
                }
                className={input}
              >
                {[7, 6, 5, 4].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                {t("rebate.set.off_days")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d) => {
                  const on = form.weekly_off_days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={readOnly}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          weekly_off_days: on
                            ? f.weekly_off_days.filter((x) => x !== d)
                            : [...f.weekly_off_days, d].sort(),
                        }))
                      }
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        on ? "border-brand bg-brand/15 text-brand" : "border-border"
                      } disabled:opacity-60`}
                    >
                      {t(`rebate.day.${d}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {canAdmin && (
            <div className="space-y-3 border-t border-border pt-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {locked ? t("rebate.set.reason_locked") : t("rebate.set.reason_optional")}
                </span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                  className={input}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground disabled:opacity-40"
                >
                  {busy === "save" && <Loader2 className="size-3.5 animate-spin" />}
                  {t("rebate.set.save")}
                </button>
                <button
                  type="button"
                  onClick={toggleApprove}
                  disabled={busy !== null || !settings}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-40"
                >
                  {busy === "approve" && <Loader2 className="size-3.5 animate-spin" />}
                  {locked ? t("rebate.set.unlock") : t("rebate.set.approve")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
