// =====================================================================
// Dashboard currency adapter.
//
// Dashboards are STRICTLY SAR: every stored figure is SAR-base and the
// global SAR/USD toggle must never repaint a financial report. `convert`
// is therefore an identity pass-through and `code` is always "SAR" for
// both mock and real data. The store is still readable through `set` for
// API compatibility, but it has no effect on dashboard rendering.
// =====================================================================
import { useCallback } from "react";
import { useCurrencyStore, useProjectFxRate } from "@/stores/useCurrencyStore";

export function useDashboardCurrency() {
  const fx = useProjectFxRate();
  const setActiveCurrency = useCurrencyStore((s) => s.setActiveCurrency);

  /** Stored amounts are already SAR — no conversion on dashboards. */
  const convert = useCallback(
    (amount: number | null | undefined): number => Number(amount) || 0,
    [],
  );

  const set = useCallback(
    (next: string) => setActiveCurrency(next === fx.baseCurrency ? "base" : "target"),
    [fx.baseCurrency, setActiveCurrency],
  );

  return {
    /** Always "SAR" on dashboards — by product decision. */
    code: "SAR",
    base: fx.baseCurrency,
    target: fx.targetCurrency,
    rate: fx.rate,
    isConverted: false,
    convert,
    set,
  } as const;
}
