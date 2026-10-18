import { useCallback } from "react";
import { useActiveCurrency, useProjectFxRate } from "@/stores/useCurrencyStore";
import {
  formatConvertedDisplay,
  formatSmartDisplay,
  getDisplayAmount,
  getDisplayCurrencyCode,
  getSmartDisplayAmount,
  type FormatOptions,
  type TransactionRecord,
} from "@/utils/currency-conversion";

/**
 * Display-layer currency helpers. Stored figures are untouched — these
 * only decide what the user sees for the active toggle.
 */
export function useCurrencyDisplay() {
  const projectFxRate = useProjectFxRate();
  const activeCurrency = useActiveCurrency();

  const convert = useCallback(
    (baseAmount: number, precision = 2) =>
      getDisplayAmount(baseAmount, projectFxRate, activeCurrency, precision),
    [projectFxRate, activeCurrency],
  );

  const display = useCallback(
    (baseAmount: number, options?: FormatOptions) =>
      formatConvertedDisplay(baseAmount, projectFxRate, activeCurrency, options),
    [projectFxRate, activeCurrency],
  );

  const smartConvert = useCallback(
    (record: TransactionRecord, precision = 2) =>
      getSmartDisplayAmount(record, projectFxRate, activeCurrency, precision),
    [projectFxRate, activeCurrency],
  );

  const smartDisplay = useCallback(
    (record: TransactionRecord, options?: FormatOptions) =>
      formatSmartDisplay(record, projectFxRate, activeCurrency, options),
    [projectFxRate, activeCurrency],
  );

  return {
    convert,
    display,
    smartConvert,
    smartDisplay,
    displayCode: getDisplayCurrencyCode(projectFxRate, activeCurrency),
    isConverted: activeCurrency === "target",
    activeCurrency,
    projectFxRate,
  };
}
