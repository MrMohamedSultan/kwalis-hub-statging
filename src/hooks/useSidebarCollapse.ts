import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "sidebar-collapsed";

/**
 * Desktop sidebar collapse preference. All shell variants read the same
 * localStorage key so the rail state is shared across route branches.
 */
export function useSidebarCollapse() {
  // Start expanded so SSR/client markup match, then hydrate the stored value.
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setIsCollapsed(localStorage.getItem(STORAGE_KEY) === "true");
    } catch {
      // Storage unavailable — silently degrade
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(isCollapsed));
    } catch {
      // Storage unavailable — silently degrade
    }
  }, [isCollapsed, hydrated]);

  const toggle = useCallback(() => setIsCollapsed((prev) => !prev), []);

  return { isCollapsed, setIsCollapsed, toggle } as const;
}
