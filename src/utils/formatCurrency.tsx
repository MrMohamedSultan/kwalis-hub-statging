import React from "react";

export type CurrencyCode = "SAR" | "USD";

/**
 * Formats a number with locale-aware thousand separators.
 * Returns a plain string like "1,234,567.89"
 */
function formatNumber(value: number, decimals: number = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Returns a React node with the formatted number + ISO currency code.
 *
 * Always renders `50,000.00 SAR` / `1,200.00 USD` — text codes only.
 */
export function formatCurrency(
  value: number | null | undefined,
  currency: CurrencyCode = "SAR",
  decimals: number = 2,
): React.ReactNode {
  if (value == null) return "—";

  const formatted = formatNumber(value, decimals);

  // Platform standard: grouped number + ISO text code ("1,234.00 SAR").
  return (
    <span dir="ltr" className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
      {formatted}
      <span>{currency}</span>
    </span>
  );
}

/**
 * String-only fallback for contexts that cannot render JSX
 * (tooltips, CSV exports, plain-text logs).
 */
export function formatCurrencyString(
  value: number | null | undefined,
  currency: CurrencyCode = "SAR",
  decimals: number = 2,
): string {
  if (value == null) return "—";
  const formatted = formatNumber(value, decimals);
  return `${formatted} ${currency}`;
}
