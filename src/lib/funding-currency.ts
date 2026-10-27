// B28 — a funding inflow can be received in any configured currency. The
// ledger keeps the original amount + currency + the rate used, and books
// the SAR equivalent (every cash figure in the platform is in SAR).
import { convert, rateFor, type FxSettings } from "@/lib/fx-settings";
import { roundTo } from "@/lib/export/number-format";

export const LEDGER_CURRENCY = "SAR";

/** Currencies offered for an inflow: the ledger currency first, then every configured rate. */
export function fundingCurrencies(settings: FxSettings | null): string[] {
  const out = [LEDGER_CURRENCY];
  if (!settings) return out;
  for (const c of [settings.baseCurrency, ...Object.keys(settings.rates)]) {
    const code = c.toUpperCase();
    if (
      !out.includes(code) &&
      (code === LEDGER_CURRENCY || convert(settings, 1, code, LEDGER_CURRENCY) != null)
    ) {
      out.push(code);
    }
  }
  return out;
}

/**
 * SAR amount + the rate applied (SAR per 1 unit of `currency`), rounded to
 * the halala. Null when no rate is configured for that currency.
 */
export function toLedgerAmount(
  settings: FxSettings | null,
  amount: number,
  currency: string,
): { amount: number; rate: number } | null {
  const c = (currency || LEDGER_CURRENCY).toUpperCase();
  if (c === LEDGER_CURRENCY) return { amount: roundTo(amount, 2), rate: 1 };
  if (!settings) return null;
  const sar = convert(settings, amount, c, LEDGER_CURRENCY);
  if (sar == null) return null;
  const rate =
    settings.baseCurrency.toUpperCase() === LEDGER_CURRENCY
      ? (rateFor(settings, c) ?? sar / amount)
      : sar / amount;
  return { amount: roundTo(sar, 2), rate: roundTo(rate, 6) };
}
