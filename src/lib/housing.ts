// Housing allowance is stored as a MONTHLY rate. Payroll must prorate it over
// the person's active days in the payroll period using: (monthly / 30) * days.
//
// Callers usually don't have a discrete payroll period, so `activeDaysForPerson`
// returns the contract-day span (endDate − startDate + 1) with a `shootingDays`
// fallback when dates are missing.

import type { Person } from "@/lib/store";

const DAYS_IN_MONTH = 30;

export function proratedHousing(monthlyAllowance: number, activeDays: number): number {
  if (!monthlyAllowance || monthlyAllowance <= 0) return 0;
  if (!activeDays || activeDays <= 0) return 0;
  return +((monthlyAllowance / DAYS_IN_MONTH) * activeDays).toFixed(2);
}

/** Inclusive day-count between two ISO dates. Returns 0 on invalid input. */
export function daysBetween(startISO?: string | null, endISO?: string | null): number {
  if (!startISO || !endISO) return 0;
  const s = new Date(startISO);
  const e = new Date(endISO);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  const ms = e.getTime() - s.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000) + 1;
}

/** Active days used for prorating housing over a contract's lifetime. */
export function activeDaysForPerson(
  p: Pick<Person, "startDate" | "endDate" | "shootingDays">,
): number {
  const span = daysBetween(p.startDate, p.endDate);
  if (span > 0) return span;
  return Math.max(0, Number(p.shootingDays ?? 0));
}

/** Full prorated housing owed across a person's contract span. */
export function contractHousingTotal(p: Person): number {
  if (!p.housingAllowance) return 0;
  return proratedHousing(p.housingAllowance, activeDaysForPerson(p));
}
