// =====================================================================
// Date-range filter helper for the dashboard data hooks. Bounds are ISO
// "yyyy-MM-dd" strings; a null bound means unbounded. Lexicographic
// comparison is safe because both sides are ISO dates.
// =====================================================================

/** True when `dateStr` (any ISO timestamp) falls inside [from, to]. */
export function inDateRange(
  dateStr: string | null | undefined,
  from: string | null,
  to: string | null,
): boolean {
  if (!from && !to) return true;
  if (!dateStr) return false;
  const day = dateStr.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}
