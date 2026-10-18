// =====================================================================
// Dashboard controls store — shared between the executive and
// operational dashboards. Holds the date-range filter only; both
// dashboards always run on the live Supabase data engine. Persisted
// so the choice survives reloads and project switches.
// =====================================================================
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DashboardControlsState {
  /** ISO "yyyy-MM-dd" bounds — null means unbounded. */
  rangeFrom: string | null;
  rangeTo: string | null;
  setRange: (from: string | null, to: string | null) => void;
}

export const useDashboardControls = create<DashboardControlsState>()(
  persist(
    (set) => ({
      rangeFrom: null,
      rangeTo: null,
      setRange: (from, to) => set({ rangeFrom: from, rangeTo: to }),
    }),
    { name: "kwalis-dashboard-controls" },
  ),
);
