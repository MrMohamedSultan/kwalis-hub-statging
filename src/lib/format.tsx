import type { ReactNode } from "react";
import i18n from "@/lib/i18n";
import { formatDate } from "@/lib/date-format";

/**
 * Localization-safe numeric primitives.
 *
 * These wrappers guarantee LTR + tabular-nums for any figure rendered on
 * screen, regardless of the active language direction (EN/LTR or AR/RTL).
 * Use them for all SAR amounts, VAT, percentages, dates, IBANs, and any
 * other numeric or latin-only identifier that must stay column-aligned
 * inside financial grids and metric cards.
 */

type Common = { className?: string; children?: ReactNode };

const base = "tabular-nums";

export function Num({ children, className = "" }: Common) {
  return (
    <span dir="ltr" className={`${base} ${className}`.trim()}>
      {children}
    </span>
  );
}

export function Money({
  value,
  currency = "SAR",
  className = "",
  locale = "en-US",
}: {
  value: number | null | undefined;
  currency?: string;
  className?: string;
  locale?: string;
}) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const text = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
  return (
    <span dir="ltr" className={`${base} ${className}`.trim()}>
      {text}
    </span>
  );
}

export function Percent({
  value,
  digits = 1,
  className = "",
}: {
  value: number;
  digits?: number;
  className?: string;
}) {
  const n = Number.isFinite(value) ? value : 0;
  return (
    <span dir="ltr" className={`${base} ${className}`.trim()}>
      {n.toFixed(digits)}%
    </span>
  );
}

export function DateText({
  value,
  className = "",
}: {
  value: string | Date | null | undefined;
  className?: string;
}) {
  if (!value) return null;
  // Platform date format (G05); stored dates are never shifted by timezone.
  const d = formatDate(value) || (typeof value === "string" ? value : "");
  return (
    <span dir="ltr" className={`${base} ${className}`.trim()}>
      {d}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Dashboard formatter suite
   Every figure on the dashboards goes through one of these — raw
   numbers are never rendered. Latin digits in both languages; the
   currency CODE is always shown beside the number.
   ═══════════════════════════════════════════════════════════════════ */

function dashLocale(): string {
  // i18next is the source of truth for the UI language; Latin digits always.
  const lng = (i18n?.language || "en").toLowerCase();
  return lng.startsWith("ar") ? "ar-SA-u-nu-latn" : "en-US";
}

/**
 * Money with its ISO currency code — "SAR 12,417,300" at full precision,
 * "SAR 12.4M" in compact mode (KPI tiles, axis ticks).
 */
export function formatCurrency(
  value: number | null | undefined,
  opts: { currency?: string; compact?: boolean; decimals?: number } = {},
): string {
  const { currency = "SAR", compact = false, decimals } = opts;
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return "—";
  const locale = dashLocale();
  if (compact) {
    const text = new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
    return `${currency} ${text}`;
  }
  const d = decimals ?? 0;
  const text = new Intl.NumberFormat(locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
  return `${currency} ${text}`;
}

/** Plain percentage — "64.3%". */
export function formatPercent(value: number, digits = 1): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/**
 * Adaptive share-of-whole percentage — THE one precision rule for every
 * "percent of budget / spend / total" figure in the app: 2 decimals below
 * 10%, whole numbers at or above. Exists so the same 1.4187…% can never
 * render as "1.42%" in one card and "1%" four inches away.
 */
export function formatPercentAdaptive(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return formatPercent(n, Math.abs(n) < 10 ? 2 : 0);
}

/** Signed percentage delta — "+4.2%" / "-1.3%". */
export function formatDelta(value: number, digits = 1): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

/**
 * Compact axis tick — clean numbers only (0 / 10M / 20M …), never a raw
 * 12417300. Trailing ".0" is stripped so ticks stay round.
 */
export function formatCompactAxis(value: number, currency?: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (n === 0) return currency ? `${currency} 0` : "0";
  const text = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  })
    .format(n)
    .replace(/\.0(?=[KMB])/, "");
  return currency ? `${currency} ${text}` : text;
}
