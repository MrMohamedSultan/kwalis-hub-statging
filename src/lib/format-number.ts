import i18n from "i18next";

/**
 * Canonical plain-number money formatter.
 *
 * Renders a grouped, fixed-decimal figure with no currency glyph — pair it
 * with the currency code/symbol the caller already renders. This replaces the
 * several identical `n.toLocaleString("en-US", { min/maxFractionDigits })`
 * helpers that were copied across grids and exports.
 *
 * The grouping follows the active UI language, but financial figures always
 * keep Latin digits (`-u-nu-latn`) so monospaced columns stay aligned and
 * exports remain machine-readable in both EN and AR.
 *
 * Note: `formatMoney` in `store.ts` is a *compact* abbreviator ($1.2m / $12k)
 * used by dashboard tiles — it is intentionally a different function and is
 * left untouched.
 */
export function numberLocale(): string {
  const lng = (i18n?.language || "en").toLowerCase();
  return lng.startsWith("ar") ? "ar-SA-u-nu-latn" : "en-US";
}

// X07: money on screens has 2 decimals by default, the same as the exports.
export function formatAmount(n: number, decimals = 2): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return v.toLocaleString(numberLocale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Money with its ISO currency code appended — the platform standard.
 * Always "12,500 SAR" / "3,333 USD"; localized glyphs ($, ر.س) are never used.
 */
export function formatCurrency(n: number, currency?: string, decimals = 2): string {
  const amount = formatAmount(n, decimals);
  return currency ? `${amount} ${currency}` : amount;
}

/**
 * STATIC dual-currency formatters.
 *
 * Dual-display components (budget summary cards, group header totals and the
 * "TOTAL SAR" / "TOTAL USD" columns) must always show both currencies at once,
 * so they must NOT go through the global SAR/USD toggle formatters — doing so
 * double-converts the figure and mislabels the code. These render the amount
 * exactly as given, with a hardcoded currency label.
 */
export function formatStaticSAR(n: number, decimals = 2): string {
  return formatAmount(Number(n) || 0, decimals);
}

export function formatStaticUSD(n: number, decimals = 2): string {
  return `${formatAmount(Number(n) || 0, decimals)} USD`;
}
