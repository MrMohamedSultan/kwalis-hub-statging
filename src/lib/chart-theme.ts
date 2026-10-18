// =====================================================================
// Chart theme bridge.
//
// Recharts needs real color strings at runtime (it cannot resolve CSS
// variables inside every SVG attribute path), so this module mirrors the
// design tokens defined in src/styles.css and, in the browser, reads the
// resolved computed values from the DOM — charts therefore track light /
// dark mode automatically. The constants below are the dark-theme
// fallback used during SSR / first paint.
// =====================================================================

export interface ChartColors {
  data1: string;
  data2: string;
  data3: string;
  data4: string;
  grid: string;
  axis: string;
  inkPrimary: string;
  inkSecondary: string;
  inkMuted: string;
  surface: string;
  statusGood: string;
  statusWarning: string;
  statusCritical: string;
}

/** Dark-theme fallbacks — must match the :root values in src/styles.css. */
export const CHART_COLORS_DARK: ChartColors = {
  data1: "#e2e6ec",
  data2: "#aeb6c2",
  data3: "#7c8798",
  data4: "#55606f",
  grid: "#24262b",
  axis: "#32353c",
  inkPrimary: "#ffffff",
  inkSecondary: "#b6bcc7",
  inkMuted: "#7e8695",
  surface: "#141518",
  statusGood: "#10b981",
  statusWarning: "#f59e0b",
  statusCritical: "#f87171",
};

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Resolved chart colors for the CURRENT theme (light or dark). */
export function getChartColors(): ChartColors {
  return {
    data1: readVar("--data-1", CHART_COLORS_DARK.data1),
    data2: readVar("--data-2", CHART_COLORS_DARK.data2),
    data3: readVar("--data-3", CHART_COLORS_DARK.data3),
    data4: readVar("--data-4", CHART_COLORS_DARK.data4),
    grid: readVar("--grid", CHART_COLORS_DARK.grid),
    axis: readVar("--axis", CHART_COLORS_DARK.axis),
    inkPrimary: readVar("--ink-primary", CHART_COLORS_DARK.inkPrimary),
    inkSecondary: readVar("--ink-secondary", CHART_COLORS_DARK.inkSecondary),
    inkMuted: readVar("--ink-muted", CHART_COLORS_DARK.inkMuted),
    surface: readVar("--surface", CHART_COLORS_DARK.surface),
    statusGood: readVar("--status-good", CHART_COLORS_DARK.statusGood),
    statusWarning: readVar("--status-warning", CHART_COLORS_DARK.statusWarning),
    statusCritical: readVar("--status-critical", CHART_COLORS_DARK.statusCritical),
  };
}
