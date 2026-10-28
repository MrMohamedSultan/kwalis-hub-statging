/**
 * X14 — report tabs that are not ready stay hidden behind a flag.
 *
 * Checked tab by tab (2026-10):
 *   gosi  GOSI & Localization — every Saudi is shown "GOSI active" and every
 *         foreigner "work permit" without any data behind it, and decision 14
 *         replaces the tab with Company Overhead → HIDDEN.
 *   All other tabs read real project data (some are being renamed/merged by
 *   the reports batch: Cost Report, Film Commission, Payments Register) → shown.
 *
 * Override per deployment (comma separated tab keys):
 *   VITE_REPORT_TABS_ENABLE=gosi        show a hidden tab
 *   VITE_REPORT_TABS_DISABLE=qfe,vat    hide a tab
 */
// "gosi" now renders Company Overhead (decision 14), so nothing is hidden by default.
export const REPORT_TABS_HIDDEN_BY_DEFAULT: readonly string[] = [];

function list(v: unknown): string[] {
  return typeof v === "string"
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

export function isReportTabEnabled(
  key: string,
  env: Record<string, unknown> = (import.meta as { env?: Record<string, unknown> }).env ?? {},
): boolean {
  if (list(env.VITE_REPORT_TABS_DISABLE).includes(key)) return false;
  if (list(env.VITE_REPORT_TABS_ENABLE).includes(key)) return true;
  return !REPORT_TABS_HIDDEN_BY_DEFAULT.includes(key);
}
