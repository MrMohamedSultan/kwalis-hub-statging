/**
 * Field-level validation for payment_schedule milestones.
 *
 * Mirrors the server trigger `public.enforce_payment_schedule_precision()`
 * so the user sees WHICH milestone and WHICH field (amount / percent) is
 * invalid before the write, and a readable field-level message if the
 * database rejects the payload anyway.
 */

export type ScheduleField = "amount" | "percent";

export type ScheduleFieldError = {
  /** 1-based milestone number, matching the server's row numbering. */
  index: number;
  /** Row id when known (client-side validation). */
  id?: string;
  field: ScheduleField;
  message: string;
};

type ScheduleLike = {
  id?: string;
  label?: string;
  percent?: number | null;
  amount?: number | null;
};

const hasCents = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

const milestoneName = (row: ScheduleLike, index: number) =>
  row.label?.trim() ? `"${row.label.trim()}"` : `#${index}`;

/** Validate a schedule the same way the database trigger does. */
export function validatePaymentSchedule(
  rows: ScheduleLike[] | undefined | null,
): ScheduleFieldError[] {
  const errors: ScheduleFieldError[] = [];
  (rows ?? []).forEach((row, i) => {
    const index = i + 1;
    const name = milestoneName(row, index);

    const amount = row.amount;
    if (amount !== null && amount !== undefined) {
      const a = Number(amount);
      if (!Number.isFinite(a)) {
        errors.push({
          index,
          id: row.id,
          field: "amount",
          message: `Milestone ${name}: amount must be a number.`,
        });
      } else if (a < 0) {
        errors.push({
          index,
          id: row.id,
          field: "amount",
          message: `Milestone ${name}: amount cannot be negative.`,
        });
      } else if (!hasCents(a)) {
        errors.push({
          index,
          id: row.id,
          field: "amount",
          message: `Milestone ${name}: amount ${a} has more than 2 decimals — use at most cents (e.g. ${a.toFixed(2)}).`,
        });
      }
    }

    const percent = row.percent;
    if (percent !== null && percent !== undefined) {
      const p = Number(percent);
      if (!Number.isFinite(p)) {
        errors.push({
          index,
          id: row.id,
          field: "percent",
          message: `Milestone ${name}: percent must be a number.`,
        });
      } else if (p < 0 || p > 100) {
        errors.push({
          index,
          id: row.id,
          field: "percent",
          message: `Milestone ${name}: percent must be between 0 and 100.`,
        });
      } else if (!hasCents(p)) {
        errors.push({
          index,
          id: row.id,
          field: "percent",
          message: `Milestone ${name}: percent ${p} has more than 2 decimals — use at most 2 (e.g. ${p.toFixed(2)}%).`,
        });
      }
    }
  });
  return errors;
}

/**
 * Turn the raw trigger exception into a field-level error.
 * e.g. `payment_schedule row 2 amount 1200.456 exceeds 2-decimal precision`
 */
export function parsePaymentScheduleDbError(err: unknown): ScheduleFieldError | null {
  const raw = (err as any)?.message ?? (typeof err === "string" ? err : "");
  const m = String(raw);
  if (!/payment_schedule/i.test(m)) return null;

  const rowMatch = m.match(/payment_schedule row (\d+)/i);
  const index = rowMatch ? Number(rowMatch[1]) : 0;
  const field: ScheduleField = /percent/i.test(m) ? "percent" : "amount";
  const label = field === "percent" ? "percent" : "amount";

  let detail = m;
  if (/exceeds 2-decimal precision/i.test(m)) {
    const value = m.match(/(?:amount|percent) ([\d.-]+) exceeds/i)?.[1];
    detail = `${label} ${value ?? ""} has more than 2 decimals — use at most cents.`.replace(
      "  ",
      " ",
    );
  } else if (/cannot be negative/i.test(m)) {
    detail = `${label} cannot be negative.`;
  } else if (/must be between 0 and 100/i.test(m)) {
    detail = `${label} must be between 0 and 100.`;
  } else if (/non-numeric/i.test(m)) {
    detail = `${label} must be a number.`;
  } else if (/must be an object|must be a JSON array/i.test(m)) {
    detail = "the payment schedule is malformed.";
  }

  return {
    index,
    field,
    message: index
      ? `Payment schedule milestone #${index}: ${detail}`
      : `Payment schedule: ${detail}`,
  };
}
