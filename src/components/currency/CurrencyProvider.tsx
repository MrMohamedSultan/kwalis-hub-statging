import { useEffect, type ReactNode } from "react";
import { useCurrencyStore } from "@/stores/useCurrencyStore";

interface Props {
  projectId: string;
  children: ReactNode;
}

/**
 * Loads the active project's FX rate and admin status. Renders nothing of
 * its own — the toggle state resets to base currency on every project change.
 */
export function CurrencyProvider({ projectId, children }: Props) {
  const setActiveCurrency = useCurrencyStore((s) => s.setActiveCurrency);
  const loadProjectFxRate = useCurrencyStore((s) => s.loadProjectFxRate);
  const checkAdminStatus = useCurrencyStore((s) => s.checkAdminStatus);

  useEffect(() => {
    if (!projectId) return;
    setActiveCurrency("base");
    void loadProjectFxRate(projectId);
    void checkAdminStatus(projectId);
  }, [projectId, setActiveCurrency, loadProjectFxRate, checkAdminStatus]);

  return <>{children}</>;
}

export default CurrencyProvider;
