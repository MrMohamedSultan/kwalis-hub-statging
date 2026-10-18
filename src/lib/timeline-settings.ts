// Per-project Production Timeline settings: macro-phase lane visibility and
// default bar durations. Persisted in localStorage, keyed strictly by
// projectId so settings never bleed between projects.
import { useCallback, useEffect, useState } from "react";
import { MACRO_PHASES, type MacroPhase } from "@/lib/timeline-phases";

export type PhaseSetting = { visible: boolean; defaultDays: number };
export type TimelinePhaseSettings = Record<MacroPhase, PhaseSetting>;

/** Sensible default durations (days) per macro phase. */
export const DEFAULT_PHASE_DAYS: Record<MacroPhase, number> = {
  Development: 90,
  "Soft prep": 21,
  "Pre-Production": 30,
  Production: 35,
  "Post production": 60,
  Wrap: 14,
};

export function defaultTimelinePhaseSettings(): TimelinePhaseSettings {
  return Object.fromEntries(
    MACRO_PHASES.map((p) => [p, { visible: true, defaultDays: DEFAULT_PHASE_DAYS[p] }]),
  ) as TimelinePhaseSettings;
}

const storageKey = (projectId: string | null | undefined) =>
  `kwalis:timeline-settings:${projectId || "global"}`;

export function loadTimelinePhaseSettings(
  projectId: string | null | undefined,
): TimelinePhaseSettings {
  const base = defaultTimelinePhaseSettings();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<string, Partial<PhaseSetting>>>;
    for (const p of MACRO_PHASES) {
      const s = parsed?.[p];
      if (!s) continue;
      if (typeof s.visible === "boolean") base[p].visible = s.visible;
      if (typeof s.defaultDays === "number" && s.defaultDays >= 1 && s.defaultDays <= 3650) {
        base[p].defaultDays = Math.round(s.defaultDays);
      }
    }
  } catch {
    /* corrupted cache → defaults */
  }
  return base;
}

/** In-memory mirror so repeat mounts never re-parse localStorage. */
const memoryCache = new Map<string, TimelinePhaseSettings>();

function readSettings(projectId: string | null | undefined): TimelinePhaseSettings {
  const key = storageKey(projectId);
  const hit = memoryCache.get(key);
  if (hit) return hit;
  const value = loadTimelinePhaseSettings(projectId);
  memoryCache.set(key, value);
  return value;
}

/** Persist off the render path so a write never blocks paint. */
function schedulePersist(key: string, value: TimelinePhaseSettings) {
  if (typeof window === "undefined") return;
  const write = () => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full/blocked — non-fatal */
    }
  };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (ric) ric(write);
  else window.setTimeout(write, 0);
}

export function useTimelinePhaseSettings(projectId: string | null | undefined) {
  const [settings, setSettings] = useState<TimelinePhaseSettings>(() => readSettings(projectId));

  // Re-sync when switching projects (project-scoped cache isolation).
  useEffect(() => {
    setSettings(readSettings(projectId));
  }, [projectId]);

  const update = useCallback(
    (phase: MacroPhase, patch: Partial<PhaseSetting>) => {
      setSettings((cur) => {
        const next: TimelinePhaseSettings = {
          ...cur,
          [phase]: {
            ...cur[phase],
            ...patch,
            defaultDays: Math.max(
              1,
              Math.min(3650, Math.round(patch.defaultDays ?? cur[phase].defaultDays)),
            ),
          },
        };
        const key = storageKey(projectId);
        memoryCache.set(key, next);
        schedulePersist(key, next);
        return next;
      });
    },
    [projectId],
  );

  return { settings, update };
}
