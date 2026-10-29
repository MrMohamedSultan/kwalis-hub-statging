// =====================================================================
// Display-layer money formatting.
//
// Every stored figure is persisted in the project's base currency (SAR).
// These helpers render those figures in whatever currency the global
// toggle is on, using the project's live FX rate. Stored data is never
// mutated — this is presentation only.
// =====================================================================
import { useCallback } from "react";
import { useCurrencyStore, useActiveCurrency, useProjectFxRate } from "@/stores/useCurrencyStore";
import { getDisplayAmount, getDisplayCurrencyCode } from "@/utils/currency-conversion";
import type { ActiveCurrency, FxRate } from "@/utils/currency-conversion";

function group(value: number, decimals: number): string {
  return Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function render(
  amount: number | null | undefined,
  fxRate: FxRate,
  activeCurrency: ActiveCurrency,
  opts: { decimals?: number; showCode?: boolean } = {},
): string {
  const { decimals = 2, showCode = true } = opts; // X07: 2 decimals, like the exports
  const n = Number(amount);
  if (amount == null || !Number.isFinite(n)) return "—";
  const value = getDisplayAmount(n, fxRate, activeCurrency, decimals);
  const text = `${value < 0 ? "-" : ""}${group(value, decimals)}`;
  return showCode ? `${text} ${getDisplayCurrencyCode(fxRate, activeCurrency)}` : text;
}

/**
 * Non-reactive formatter for call sites outside React (exports, CSV, PDF).
 * Components should prefer {@link useMoney} so they re-render on toggle.
 */
export function formatDisplayMoney(
  amount: number | null | undefined,
  opts: { decimals?: number; showCode?: boolean } = {},
): string {
  const { activeCurrency, projectFxRate } = useCurrencyStore.getState();
  return render(amount, projectFxRate, activeCurrency, opts);
}

/** Number only (no currency code) — for columns whose header carries the code. */
export function formatDisplayAmount(amount: number | null | undefined, decimals = 2): string {
  return formatDisplayMoney(amount, { decimals, showCode: false });
}

/** Reactive formatter — subscribes to the toggle and the project FX rate. */
export function useMoney() {
  const activeCurrency = useActiveCurrency();
  const fxRate = useProjectFxRate();

  const money = useCallback(
    (amount: number | null | undefined, opts?: { decimals?: number; showCode?: boolean }) =>
      render(amount, fxRate, activeCurrency, opts),
    [fxRate, activeCurrency],
  );

  const amount = useCallback(
    (value: number | null | undefined, decimals = 2) =>
      render(value, fxRate, activeCurrency, { decimals, showCode: false }),
    [fxRate, activeCurrency],
  );

  const convert = useCallback(
    (value: number, decimals = 2) =>
      getDisplayAmount(Number(value) || 0, fxRate, activeCurrency, decimals),
    [fxRate, activeCurrency],
  );

  return {
    money,
    amount,
    convert,
    code: getDisplayCurrencyCode(fxRate, activeCurrency),
    isConverted: activeCurrency === "target",
  };
}

/** Converts a stored base-currency amount into the active display currency. */
export function convertForDisplay(amount: number, decimals = 2): number {
  const { activeCurrency, projectFxRate } = useCurrencyStore.getState();
  return getDisplayAmount(Number(amount) || 0, projectFxRate, activeCurrency, decimals);
}

/** Currency code the UI is currently rendering figures in. */
export function displayCurrencyCode(): string {
  const { activeCurrency, projectFxRate } = useCurrencyStore.getState();
  return getDisplayCurrencyCode(projectFxRate, activeCurrency);
}
