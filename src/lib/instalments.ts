// =====================================================================
// Contract instalments — glossary words and schedule rules (A02, A05).
//
// Stored statuses (payroll.payment_schedule, written by the 160/176
// triggers) are Pending / Hold / Approved / Paid. Every screen shows the
// glossary words Pending → Requested → Approved → Paid; a rejected or
// cancelled request puts the instalment back to Pending.
//
// The schedule rules mirror public.enforce_payroll_schedule_rules
// (db/pending/180): a name and a due date on every instalment, and the
// instalments add up to the contract (net payable) value. Dates out of
// order are only a warning.
// =====================================================================

export type InstalmentWord = "pending" | "requested" | "approved" | "paid";

/** Stored status → glossary word. */
export function instalmentWord(stored: string | null | undefined): InstalmentWord {
  switch (stored) {
    case "Hold":
    case "Requested":
      return "requested";
    case "Approved":
      return "approved";
    case "Paid":
      return "paid";
    default:
      return "pending";
  }
}

/** i18n key of the glossary word (glossary.status.*). */
export const instalmentWordKey = (w: InstalmentWord) => `glossary.status.${w}`;

/** Payment request status → instalment word (rejected / cancelled → pending). */
export function requestStatusWord(status: string | null | undefined): InstalmentWord | null {
  switch (status) {
    case "waiting_approval":
      return "requested";
    case "approved":
      return "approved";
    case "paid":
      return "paid";
    case "draft":
    case "rejected":
    case "cancelled":
      return "pending";
    default:
      return null;
  }
}

/** Approved / Paid instalments are Actual and frozen (A03). */
export const isFrozen = (w: InstalmentWord) => w === "approved" || w === "paid";

export type ScheduleRow = {
  id: string;
  label?: string | null;
  dueDate?: string | null;
  percent?: number | null;
  amount?: number | null;
};

/** Same as public.payroll_milestone_amount: flat amount, else percent of the base. */
export function instalmentAmount(row: ScheduleRow, base: number): number {
  const v =
    row.amount !== null && row.amount !== undefined && String(row.amount) !== ""
      ? Number(row.amount)
      : ((Number(base) || 0) * (Number(row.percent) || 0)) / 100;
  return Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
}

export type ScheduleIssue =
  | { kind: "missing_label"; id: string; index: number }
  | { kind: "missing_due_date"; id: string; index: number }
  | { kind: "sum_mismatch"; total: number; expected: number; difference: number }
  | { kind: "date_order"; id: string; index: number };

export type ScheduleCheck = {
  /** Block the save. */
  errors: ScheduleIssue[];
  /** Ask, do not block. */
  warnings: ScheduleIssue[];
  total: number;
};

const ISO = /^\d{4}-\d{2}-\d{2}/;

/**
 * `base` = the value the instalments must add up to (net payable, or the
 * contract value when there is no WHT). An empty schedule is valid: the whole
 * contract is then a commitment.
 */
export function checkInstalmentSchedule(rows: ScheduleRow[], base: number): ScheduleCheck {
  const errors: ScheduleIssue[] = [];
  const warnings: ScheduleIssue[] = [];
  let total = 0;
  let lastDate = "";
  rows.forEach((r, index) => {
    if (!String(r.label ?? "").trim()) errors.push({ kind: "missing_label", id: r.id, index });
    const d = String(r.dueDate ?? "");
    if (!ISO.test(d)) errors.push({ kind: "missing_due_date", id: r.id, index });
    else {
      const day = d.slice(0, 10);
      if (lastDate && day < lastDate) warnings.push({ kind: "date_order", id: r.id, index });
      lastDate = day > lastDate ? day : lastDate;
    }
    total += instalmentAmount(r, base);
  });
  total = Math.round(total * 100) / 100;
  const expected = Math.round((Number(base) || 0) * 100) / 100;
  if (rows.length > 0 && Math.abs(total - expected) > 0.01) {
    errors.push({
      kind: "sum_mismatch",
      total,
      expected,
      difference: Math.round((expected - total) * 100) / 100,
    });
  }
  return { errors, warnings, total };
}
