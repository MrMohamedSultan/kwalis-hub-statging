// Translate raw Postgres / Supabase error messages from our server-side
// validation triggers into user-friendly messages. Supports i18n via i18next.
import i18n from "@/lib/i18n";
import { parsePaymentScheduleDbError } from "@/lib/payment-schedule-validation";

export function humanizeDbError(err: unknown): string {
  const raw = (err as any)?.message ?? (typeof err === "string" ? err : "");
  const t = (k: string, opts?: Record<string, unknown>) => i18n.t(k, opts) as string;
  if (!raw) return t("validation.unknown");

  const m = String(raw);

  // Field-level payment_schedule precision errors (which milestone, which field).
  const scheduleErr = parsePaymentScheduleDbError(m);
  if (scheduleErr) return scheduleErr.message;

  if (/VAT math mismatch/i.test(m)) return t("validation.vatMismatch");
  if (/Attachment URL is already used on/i.test(m)) return m;

  if (/Invoice total \(price\) is required/i.test(m)) return t("validation.invoiceTotalRequired");
  if (/Invoice date is required/i.test(m)) return t("validation.invoiceDateRequired");
  if (/Invoice must reference a budget_code/i.test(m)) return t("validation.invoiceBudgetCode");
  if (/Payroll ledger entry with amount .* is missing proof-of-payment/i.test(m))
    return t("validation.payrollMissingProof");
  if (/Transaction amount is required/i.test(m)) return t("validation.txAmountRequired");
  if (/Transaction vat_amount cannot be negative/i.test(m)) return t("validation.txVatNegative");
  if (/Transaction date is required/i.test(m)) return t("validation.txDateRequired");

  if (/row-level security|permission denied/i.test(m)) return t("validation.permission");
  if (/duplicate key value/i.test(m)) return t("validation.duplicate");
  if (/violates foreign key/i.test(m)) return t("validation.fk");
  if (/violates not-null/i.test(m)) {
    const field = m.match(/column "([^"]+)"/)?.[1];
    return field ? t("validation.notNullNamed", { field }) : t("validation.notNull");
  }
  return m;
}
