// Per-project header metadata (Production Company, Line Producer, Shoot Days,
// Filming Locations). Persisted on `public.projects` so every surface — Budget
// header, Top Sheet, exports — reads the same source of truth instead of a
// per-browser localStorage copy.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";

export type ProjectMetadata = {
  productionCompany: string;
  lineProducer: string;
  producer: string;
  preparedBy: string;
  budgetSetting: string;
  shootDays: number | null;
  prepDays: number | null;
  filmingLocations: string;
};

export const EMPTY_PROJECT_METADATA: ProjectMetadata = {
  productionCompany: "",
  lineProducer: "",
  producer: "",
  preparedBy: "",
  budgetSetting: "",
  shootDays: null,
  prepDays: null,
  filmingLocations: "",
};

const EVENT = "project-metadata:changed";

/** In-memory cache + subscribers so every header updates in the same tick as a save. */
const cache = new Map<string, ProjectMetadata>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

/** Publish metadata for a project to every mounted consumer immediately. */
export function publishProjectMetadata(projectId: string, meta: ProjectMetadata) {
  cache.set(projectId, { ...meta });
  notify();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { projectId } }));
  }
}

export function getCachedProjectMetadata(projectId: string | null): ProjectMetadata {
  if (!projectId) return { ...EMPTY_PROJECT_METADATA };
  return cache.get(projectId) ?? { ...EMPTY_PROJECT_METADATA };
}

export async function fetchProjectMetadata(projectId: string): Promise<ProjectMetadata> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      "production_company, line_producer, producer, prepared_by, budget_setting, shoot_days, prep_days, filming_locations",
    )
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) return { ...EMPTY_PROJECT_METADATA };
  const row = data as any;
  const meta: ProjectMetadata = {
    productionCompany: row.production_company ?? "",
    lineProducer: row.line_producer ?? "",
    producer: row.producer ?? "",
    preparedBy: row.prepared_by ?? "",
    budgetSetting: row.budget_setting ?? "",
    shootDays: row.shoot_days == null ? null : Number(row.shoot_days),
    prepDays: row.prep_days == null ? null : Number(row.prep_days),
    filmingLocations: row.filming_locations ?? "",
  };
  cache.set(projectId, meta);
  return meta;
}

/** Whole, non-negative day counts only — blank stays blank. */
function normalizeDays(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

export function normalizeProjectMetadata(meta: ProjectMetadata): ProjectMetadata {
  return {
    productionCompany: meta.productionCompany.trim(),
    lineProducer: meta.lineProducer.trim(),
    producer: meta.producer.trim(),
    preparedBy: meta.preparedBy.trim(),
    budgetSetting: meta.budgetSetting.trim(),
    shootDays: normalizeDays(meta.shootDays),
    prepDays: normalizeDays(meta.prepDays),
    filmingLocations: meta.filmingLocations.trim(),
  };
}

/**
 * Optimistic save: headers repaint immediately with the new values, the write
 * happens in the background, and the previous snapshot is restored if the
 * database rejects the update.
 */
export async function saveProjectMetadata(projectId: string, meta: ProjectMetadata): Promise<void> {
  const normalized = normalizeProjectMetadata(meta);
  const previous = getCachedProjectMetadata(projectId);

  // Paint first — every mounted header updates in this tick.
  publishProjectMetadata(projectId, normalized);

  const { error } = await supabase
    .from("projects")
    .update({
      production_company: normalized.productionCompany || null,
      line_producer: normalized.lineProducer || null,
      producer: normalized.producer || null,
      prepared_by: normalized.preparedBy || null,
      budget_setting: normalized.budgetSetting || null,
      shoot_days: normalized.shootDays,
      prep_days: normalized.prepDays,
      filming_locations: normalized.filmingLocations || null,
    } as any)
    .eq("id", projectId);

  if (error) {
    // Roll back to the last known-good values.
    publishProjectMetadata(projectId, previous);
    throw error;
  }
}

/** Live project metadata for the active project. Refreshes when it is saved anywhere in the app. */
export function useProjectMetadata(): {
  metadata: ProjectMetadata;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const projectId = useStore((s) => s.activeProjectId);
  const latestProjectIdRef = useRef(projectId);
  const [metadata, setMetadata] = useState<ProjectMetadata>(() =>
    getCachedProjectMetadata(projectId),
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    latestProjectIdRef.current = projectId;
  }, [projectId]);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setMetadata({ ...EMPTY_PROJECT_METADATA });
      setLoading(false);
      return;
    }
    const requestedProjectId = projectId;
    setLoading(true);
    try {
      const nextMetadata = await fetchProjectMetadata(requestedProjectId);
      if (latestProjectIdRef.current !== requestedProjectId) return;
      setMetadata(nextMetadata);
    } finally {
      if (latestProjectIdRef.current === requestedProjectId) {
        setLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    // Paint cached values first (instant), then revalidate from the DB.
    setMetadata(getCachedProjectMetadata(projectId));
    void refresh();
    const sync = () => setMetadata(getCachedProjectMetadata(projectId));
    listeners.add(sync);
    window.addEventListener(EVENT, sync);
    return () => {
      listeners.delete(sync);
      window.removeEventListener(EVENT, sync);
    };
  }, [projectId, refresh]);

  return { metadata, loading, refresh };
}

/** Map metadata onto the Budget-header field ids used by `budget-header.ts`. */
export function metadataFieldValues(meta: ProjectMetadata): Record<string, string[]> {
  const split = (v: string) =>
    v
      .split(/[,\n;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    "prod-co": split(meta.productionCompany),
    "line-producer": split(meta.lineProducer),
    producer: split(meta.producer),
    "prepared-by": split(meta.preparedBy),
    "budget-setting": split(meta.budgetSetting),
    "shoot-days": meta.shootDays != null && meta.shootDays > 0 ? [String(meta.shootDays)] : [],
    "prep-days": meta.prepDays != null && meta.prepDays > 0 ? [String(meta.prepDays)] : [],
    "filming-locations": split(meta.filmingLocations),
  };
}

/**
 * Latest saved production-header values for the active project, read straight
 * from the shared cache so exports always carry the newest Project Settings
 * without waiting for a refetch or a page refresh.
 */
export function getActiveProjectMetadata(): ProjectMetadata {
  try {
    return getCachedProjectMetadata(useStore.getState().activeProjectId);
  } catch {
    return { ...EMPTY_PROJECT_METADATA };
  }
}

/** Header label/value pairs for report exports (Excel, CSV, PDF). */
export function projectHeaderPairs(
  meta: ProjectMetadata = getActiveProjectMetadata(),
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [
    ["Production Company", meta.productionCompany],
    ["Producer", meta.producer],
    ["Line Producer", meta.lineProducer],
    ["Prepared By", meta.preparedBy],
    ["Budget Setting", meta.budgetSetting],
    ["Shoot Days", meta.shootDays != null ? String(meta.shootDays) : ""],
    ["Prep Days", meta.prepDays != null ? String(meta.prepDays) : ""],
    ["Filming Locations", meta.filmingLocations],
  ];
  return pairs.filter(([, v]) => Boolean(v));
}

/** Single-line summary used as an export subtitle. */
export function projectHeaderLine(meta?: ProjectMetadata): string {
  return projectHeaderPairs(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join("  ·  ");
}
