// =====================================================================
// Display-layer currency conversion.
//
// Stored figures are never mutated by anything in this module. The
// accountant's original `transactionAmount` / `transactionCurrency` are
// immutable; only the derived `baseAmount` is ever converted for display.
// =====================================================================

export type CurrencyCode = "SAR" | "USD" | "EUR" | "GBP" | "AED" | (string & {});

export interface FxRate {
  /** 1 TARGET = rate × BASE (e.g. 1 USD = 3.75 SAR). */
  rate: number;
  baseCurrency: CurrencyCode;
  targetCurrency: CurrencyCode;
}

export type ActiveCurrency = "base" | "target";

export interface TransactionRecord {
  /** IMMUTABLE: accountant's exact number. */
  transactionAmount: number;
  /** IMMUTABLE: accountant's chosen currency. */
  transactionCurrency: CurrencyCode;
  /** DERIVED: base-currency equivalent. */
  baseAmount: number;
}

export interface FormatOptions {
  precision?: number;
  locale?: string;
  showCode?: boolean;
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/** True for a positive, finite rate below 1,000,000. */
export function isValidFxRate(rate: unknown): boolean {
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 && n < 1_000_000;
}

/**
 * Converts between base and target currency.
 * Returns 0 — never the original amount — when the rate is unusable, so a
 * broken rate can never silently clone an unconverted figure on screen.
 */
export function convertCurrency(
  amount: number,
  rate: number,
  direction: "toTarget" | "toBase",
  precision = 2,
): number {
  if (!Number.isFinite(rate) || rate <= 0) {
    console.warn(`[currency-conversion] Invalid FX rate: ${rate}. Returning 0.`);
    return 0;
  }
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return round(direction === "toTarget" ? n / rate : n * rate, precision);
}

/** Converts a stored base-currency amount for the active toggle. */
export function getDisplayAmount(
  baseAmount: number,
  fxRate: FxRate,
  activeCurrency: ActiveCurrency,
  precision = 2,
): number {
  if (activeCurrency === "base") {
    const n = Number(baseAmount);
    return Number.isFinite(n) ? round(n, precision) : 0;
  }
  return convertCurrency(baseAmount, fxRate.rate, "toTarget", precision);
}

/**
 * Like {@link getDisplayAmount}, but prefers the accountant's original
 * figure when it is already denominated in the display currency — this
 * avoids round-trip rounding drift on individual transactions.
 */
export function getSmartDisplayAmount(
  record: TransactionRecord,
  fxRate: FxRate,
  activeCurrency: ActiveCurrency,
  precision = 2,
): number {
  if (activeCurrency === "base") {
    const n = Number(record.baseAmount);
    return Number.isFinite(n) ? n : 0;
  }
  if (record.transactionCurrency === fxRate.targetCurrency) {
    const n = Number(record.transactionAmount);
    if (Number.isFinite(n)) return n;
  }
  return convertCurrency(record.baseAmount, fxRate.rate, "toTarget", precision);
}

export function getDisplayCurrencyCode(
  fxRate: FxRate,
  activeCurrency: ActiveCurrency,
): CurrencyCode {
  return activeCurrency === "base" ? fxRate.baseCurrency : fxRate.targetCurrency;
}

function formatNumber(value: number, precision: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
}

export function formatConvertedDisplay(
  baseAmount: number,
  fxRate: FxRate,
  activeCurrency: ActiveCurrency,
  options: FormatOptions = {},
): string {
  const { precision = 2, locale = "en-US", showCode = true } = options;
  const value = getDisplayAmount(baseAmount, fxRate, activeCurrency, precision);
  const text = formatNumber(value, precision, locale);
  return showCode ? `${text} ${getDisplayCurrencyCode(fxRate, activeCurrency)}` : text;
}

export function formatSmartDisplay(
  record: TransactionRecord,
  fxRate: FxRate,
  activeCurrency: ActiveCurrency,
  options: FormatOptions = {},
): string {
  const { precision = 2, locale = "en-US", showCode = true } = options;
  const value = getSmartDisplayAmount(record, fxRate, activeCurrency, precision);
  const text = formatNumber(value, precision, locale);
  return showCode ? `${text} ${getDisplayCurrencyCode(fxRate, activeCurrency)}` : text;
}

/** e.g. "1 USD = 3.75 SAR". */
export function describeFxRate(fxRate: FxRate): string {
  return `1 ${fxRate.targetCurrency} = ${fxRate.rate} ${fxRate.baseCurrency}`;
}
