import React, { createContext, useContext, useCallback, useMemo, useEffect } from "react";
import { setDisplayCurrency } from "@/lib/display-currency";
import { useStore } from "@/lib/store";
import { useCurrencyStore, useActiveCurrency, useProjectFxRate } from "@/stores/useCurrencyStore";
import { useMoney } from "@/lib/money-display";

type ActiveCurrency = "SAR" | "USD";

interface CurrencyContextType {
  /** The currently active display currency */
  active: ActiveCurrency;
  /** Toggle between base ↔ target currency */
  toggle: () => void;
  /** Format any base-currency (SAR) number for display in the active currency */
  fmt: (amount: number | null | undefined) => string;
}

const CurrencyCtx = createContext<CurrencyContextType | null>(null);

/**
 * Single source of truth is the FX Zustand store: `activeCurrency` is
 * "base" (project base, normally SAR) or "target" (normally USD), and the
 * rate comes from the project's configured FX rate. Nothing here writes to
 * the database — display only.
 */
export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const activeCurrency = useActiveCurrency();
  const fxRate = useProjectFxRate();
  const toggleCurrency = useCurrencyStore((s) => s.toggleCurrency);
  const loadProjectFxRate = useCurrencyStore((s) => s.loadProjectFxRate);
  const checkAdminStatus = useCurrencyStore((s) => s.checkAdminStatus);
  const projectId = useStore((s) => s.activeProjectId);
  const { money } = useMoney();

  // Load the active project's live FX rate (and admin rights) on switch.
  useEffect(() => {
    if (!projectId) return;
    void loadProjectFxRate(projectId);
    void checkAdminStatus(projectId);
  }, [projectId, loadProjectFxRate, checkAdminStatus]);

  const active: ActiveCurrency =
    activeCurrency === "base"
      ? ((fxRate.baseCurrency as ActiveCurrency) ?? "SAR")
      : ((fxRate.targetCurrency as ActiveCurrency) ?? "USD");

  const toggle = useCallback(() => toggleCurrency(), [toggleCurrency]);

  const fmt = useCallback((amount: number | null | undefined) => money(amount), [money]);

  // Keep the report/table display-currency layer in sync with the toggle.
  useEffect(() => {
    setDisplayCurrency(active);
  }, [active]);

  const value = useMemo(() => ({ active, toggle, fmt }), [active, toggle, fmt]);

  return <CurrencyCtx.Provider value={value}>{children}</CurrencyCtx.Provider>;
}

/** Standalone formatter kept for callers outside the provider tree. */
export function formatForDisplay(
  amount: number | null | undefined,
  _active?: ActiveCurrency,
): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  const { activeCurrency, projectFxRate } = useCurrencyStore.getState();
  const rate = projectFxRate.rate || 1;
  const value = activeCurrency === "target" ? amount / rate : amount;
  const code =
    activeCurrency === "target" ? projectFxRate.targetCurrency : projectFxRate.baseCurrency;
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} ${code}`;
}

export function useCurrency() {
  const ctx = useContext(CurrencyCtx);
  if (!ctx) throw new Error("useCurrency must be inside <CurrencyProvider>");
  return ctx;
}
