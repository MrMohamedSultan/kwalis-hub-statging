// Single source of truth for the Production Timeline macro phases.
// Used by the timeline lanes, the Create Event modal "Target Row" dropdown,
// and the Timeline Task Dictionary "Category" selector.

export const MACRO_PHASES = [
  "Development",
  "Soft prep",
  "Pre-Production",
  "Production",
  "Post production",
  "Wrap",
] as const;

export type MacroPhase = (typeof MACRO_PHASES)[number];

export const DEFAULT_MACRO_PHASE: MacroPhase = "Pre-Production";

/** Arabic labels for the timeline lane gutter. */
export const MACRO_PHASE_AR: Record<MacroPhase, string> = {
  Development: "التطوير",
  "Soft prep": "التحضير المبدئي",
  "Pre-Production": "التحضير",
  Production: "الإنتاج",
  "Post production": "ما بعد الإنتاج",
  Wrap: "الإنهاء",
};

/** Stable lane ids so previously stored bars keep resolving to a lane. */
export const MACRO_PHASE_ID: Record<MacroPhase, string> = {
  Development: "development",
  "Soft prep": "soft-prep",
  "Pre-Production": "prep",
  Production: "shoot",
  "Post production": "post",
  Wrap: "wrap",
};

/** Legacy/uppercase category values stored before the phase list was unified. */
const LEGACY: Record<string, MacroPhase> = {
  DEVELOPMENT: "Development",
  "SOFT PREP": "Soft prep",
  "PRE-PRODUCTION": "Pre-Production",
  PREPRODUCTION: "Pre-Production",
  PREP: "Pre-Production",
  PRODUCTION: "Production",
  "POST PRODUCTION": "Post production",
  "POST-PRODUCTION": "Post production",
  POST: "Post production",
  VFX: "Post production",
  WRAP: "Wrap",
};

/** Lane id → macro phase, for film-mode lanes derived from MACRO_PHASES. */
export const LANE_PHASE: Record<string, MacroPhase> = Object.fromEntries(
  MACRO_PHASES.map((p) => [MACRO_PHASE_ID[p], p]),
) as Record<string, MacroPhase>;

/** Resolves a timeline lane id to its macro phase (null for series lanes). */
export function phaseOfLaneId(laneId: string): MacroPhase | null {
  return LANE_PHASE[laneId] ?? null;
}

/** Maps any stored/legacy category string onto the canonical macro phase. */
export function normalizeMacroPhase(value: string | null | undefined): MacroPhase {
  if (!value) return DEFAULT_MACRO_PHASE;
  const exact = MACRO_PHASES.find((p) => p.toLowerCase() === value.trim().toLowerCase());
  if (exact) return exact;
  return LEGACY[value.trim().toUpperCase()] ?? DEFAULT_MACRO_PHASE;
}
