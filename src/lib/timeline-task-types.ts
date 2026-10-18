import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { recordAudit } from "@/lib/audit-log";
import { useStore } from "@/lib/store";
import { MACRO_PHASES, normalizeMacroPhase, type MacroPhase } from "@/lib/timeline-phases";

export type TaskCategory = MacroPhase;

export const TASK_CATEGORIES: TaskCategory[] = [...MACRO_PHASES];

/** Semantic token classes only — never raw Tailwind colours. */
export const TASK_COLORS: { key: string; label: string }[] = [
  { key: "bg-info", label: "Info" },
  { key: "bg-success", label: "Success" },
  { key: "bg-warning", label: "Warning" },
  { key: "bg-destructive", label: "Critical" },
  { key: "bg-highlight", label: "Highlight" },
  { key: "bg-muted", label: "Neutral" },
];

export type TimelineTaskType = {
  id: string;
  organizationId: string | null;
  projectId: string | null;
  code: string;
  name: string;
  color: string;
  category: TaskCategory;
  requiredCount: number;
  sortOrder: number;
  isActive: boolean;
  isHidden: boolean;
  /** True when this row is a project-level override of a shared/default card. */
  isOverride: boolean;
};

const SELECT =
  "id, organization_id, project_id, code, name, color, category, required_count, sort_order, is_active, is_hidden, overrides_code";

function mapRow(r: any): TimelineTaskType {
  return {
    id: r.id,
    organizationId: r.organization_id ?? null,
    projectId: r.project_id ?? null,
    code: r.code,
    name: r.name,
    color: r.color ?? "bg-info",
    category: normalizeMacroPhase(r.category),
    requiredCount: r.required_count ?? 0,
    sortOrder: r.sort_order ?? 0,
    isActive: r.is_active !== false,
    isHidden: r.is_hidden === true,
    isOverride: !!r.project_id && !!r.overrides_code,
  };
}

let cache: TimelineTaskType[] | null = null;
let rawCache: TimelineTaskType[] = [];
let cacheProjectId: string | null = null;
const listeners = new Set<(rows: TimelineTaskType[]) => void>();
const rawListeners = new Set<(rows: TimelineTaskType[]) => void>();

/** Project overrides win over shared rows with the same code; hidden rows disappear. */
function resolve(rows: TimelineTaskType[]): TimelineTaskType[] {
  const overrides = new Map<string, TimelineTaskType>();
  for (const r of rows) if (r.projectId) overrides.set(r.code, r);
  const out: TimelineTaskType[] = [];
  for (const r of rows) {
    if (!r.projectId && overrides.has(r.code)) continue;
    if (r.isHidden || !r.isActive) continue;
    out.push(r);
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function emit(rows: TimelineTaskType[]) {
  const resolved = resolve(rows);
  cache = resolved;
  rawCache = rows;
  listeners.forEach((l) => l(resolved));
  rawListeners.forEach((l) => l(rows));
}

/**
 * Platform defaults this project has customised or hidden, paired with the
 * project-scoped override row that shadows them.
 */
export type TaskTypeOverrideEntry = {
  defaultRow: TimelineTaskType | null;
  override: TimelineTaskType;
  hidden: boolean;
};

export function listOverriddenDefaults(rows: TimelineTaskType[]): TaskTypeOverrideEntry[] {
  const defaults = new Map<string, TimelineTaskType>();
  for (const r of rows) if (!r.projectId) defaults.set(r.code, r);
  return rows
    .filter((r) => !!r.projectId && !!r.isOverride)
    .map((override) => ({
      override,
      defaultRow: defaults.get(override.code) ?? null,
      hidden: override.isHidden,
    }))
    .sort((a, b) => a.override.name.localeCompare(b.override.name));
}

/**
 * Drops the project-scoped override row so the shared platform default becomes
 * visible again for this project (undoes both an edit and a hide).
 */
export async function restoreTaskTypeDefault(overrideId: string): Promise<void> {
  const projectId = requireProject();
  const before = rawCache.find((r) => r.id === overrideId) ?? null;
  if (before && !before.projectId) {
    throw new Error("This card is already the platform default.");
  }
  const { error } = await supabase
    .from("timeline_task_types")
    .delete()
    .eq("id", overrideId)
    .eq("project_id", projectId);
  if (error) throw error;

  recordAudit({
    category: "other",
    action: "timeline_task_type.restore_default",
    entity: `timeline_task_type:${overrideId}`,
    summary: before
      ? `Restored platform default for timeline task ${before.code} · ${before.name}`
      : `Restored platform default for timeline task ${overrideId}`,
    details: { old: before, projectId },
  });
  await refreshTimelineTaskTypes();
}

function activeProjectId(): string | null {
  return useStore.getState().activeProjectId ?? null;
}

function requireProject(): string {
  const pid = activeProjectId();
  if (!pid) {
    throw new Error("Select an active project before changing the task dictionary.");
  }
  return pid;
}

export async function fetchTimelineTaskTypes(): Promise<TimelineTaskType[]> {
  const pid = activeProjectId();
  let q = supabase.from("timeline_task_types").select(SELECT);
  q = pid ? q.or(`project_id.is.null,project_id.eq.${pid}`) : q.is("project_id", null);
  const { data, error } = await q.order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function refreshTimelineTaskTypes(): Promise<TimelineTaskType[]> {
  const rows = await fetchTimelineTaskTypes();
  cacheProjectId = activeProjectId();
  emit(rows);
  return resolve(rows);
}

export async function createTaskType(input: {
  code: string;
  name: string;
  color: string;
  category: TaskCategory;
  requiredCount?: number;
  sortOrder?: number;
}): Promise<TimelineTaskType> {
  const projectId = requireProject();
  const { data, error } = await supabase
    .from("timeline_task_types")
    .insert({
      project_id: projectId,
      organization_id: null,
      code: input.code.trim(),
      name: input.name.trim(),
      color: input.color,
      category: input.category,
      required_count: input.requiredCount ?? 0,
      sort_order: input.sortOrder ?? 999,
    })
    .select(SELECT)
    .single();
  if (error) throw error;
  const row = mapRow(data);
  recordAudit({
    category: "other",
    action: "timeline_task_type.create",
    entity: `timeline_task_type:${row.id}`,
    summary: `Created timeline task ${row.code} · ${row.name}`,
    details: { new: row, projectId },
  });
  await refreshTimelineTaskTypes();
  return row;
}

type Patch = Partial<{
  code: string;
  name: string;
  color: string;
  category: TaskCategory;
  requiredCount: number;
  sortOrder: number;
  isActive: boolean;
}>;

function toDbPatch(patch: Patch) {
  const dbPatch: {
    code?: string;
    name?: string;
    color?: string;
    category?: string;
    required_count?: number;
    sort_order?: number;
    is_active?: boolean;
  } = {};

  if (patch.code !== undefined) dbPatch["code"] = patch.code.trim();
  if (patch.name !== undefined) dbPatch["name"] = patch.name.trim();
  if (patch.color !== undefined) dbPatch["color"] = patch.color;
  if (patch.category !== undefined) dbPatch["category"] = patch.category;
  if (patch.requiredCount !== undefined) dbPatch["required_count"] = patch.requiredCount;
  if (patch.sortOrder !== undefined) dbPatch["sort_order"] = patch.sortOrder;
  if (patch.isActive !== undefined) dbPatch["is_active"] = patch.isActive;
  return dbPatch;
}

/**
 * Editing a project-owned card updates it in place. Editing a shared/default card
 * creates a project-scoped override instead — the shared card is never touched.
 */
export async function updateTaskType(id: string, patch: Patch): Promise<TimelineTaskType> {
  const projectId = requireProject();
  const before = (cache ?? []).find((r) => r.id === id) ?? null;

  if (before && !before.projectId) {
    const { data, error } = await supabase
      .from("timeline_task_types")
      .insert({
        project_id: projectId,
        organization_id: null,
        overrides_code: before.code,
        code: (patch.code ?? before.code).trim(),
        name: (patch.name ?? before.name).trim(),
        color: patch.color ?? before.color,
        category: patch.category ?? before.category,
        required_count: patch.requiredCount ?? before.requiredCount,
        sort_order: patch.sortOrder ?? before.sortOrder,
        is_active: patch.isActive ?? before.isActive,
      })
      .select(SELECT)
      .single();
    if (error) throw error;
    const row = mapRow(data);
    recordAudit({
      category: "other",
      action: "timeline_task_type.override",
      entity: `timeline_task_type:${row.id}`,
      summary: `Created project override for timeline task ${row.code}`,
      details: { old: before, new: row, projectId },
    });
    await refreshTimelineTaskTypes();
    return row;
  }

  const { data, error } = await supabase
    .from("timeline_task_types")
    .update(toDbPatch(patch))
    .eq("id", id)
    .eq("project_id", projectId)
    .select(SELECT)
    .single();
  if (error) throw error;
  const row = mapRow(data);
  recordAudit({
    category: "other",
    action: "timeline_task_type.update",
    entity: `timeline_task_type:${row.id}`,
    summary: `Updated timeline task ${row.code} · ${row.name}`,
    details: { old: before, new: row, projectId },
  });
  await refreshTimelineTaskTypes();
  return row;
}

/**
 * Deleting a project-owned card removes it. Deleting a shared/default card records a
 * hidden project-scoped override so the card disappears for this project only.
 */
export async function deleteTaskType(id: string): Promise<void> {
  const projectId = requireProject();
  const before = (cache ?? []).find((r) => r.id === id) ?? null;

  if (before && !before.projectId) {
    const { error } = await supabase.from("timeline_task_types").insert({
      project_id: projectId,
      organization_id: null,
      overrides_code: before.code,
      code: before.code,
      name: before.name,
      color: before.color,
      category: before.category,
      required_count: before.requiredCount,
      sort_order: before.sortOrder,
      is_hidden: true,
      is_active: false,
    });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("timeline_task_types")
      .delete()
      .eq("id", id)
      .eq("project_id", projectId);
    if (error) throw error;
  }

  recordAudit({
    category: "other",
    action: "timeline_task_type.delete",
    entity: `timeline_task_type:${id}`,
    severity: "warning",
    summary: before
      ? `Removed timeline task ${before.code} · ${before.name} from this project`
      : `Removed timeline task ${id} from this project`,
    details: { old: before, projectId },
  });
  await refreshTimelineTaskTypes();
}

export function useTimelineTaskTypes() {
  const projectId = useStore((s) => s.activeProjectId);
  const [rows, setRows] = useState<TimelineTaskType[]>(
    cacheProjectId === (projectId ?? null) ? (cache ?? []) : [],
  );
  const [loading, setLoading] = useState(cache === null || cacheProjectId !== (projectId ?? null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cb = (r: TimelineTaskType[]) => {
      if (!cancelled) setRows(r);
    };
    listeners.add(cb);
    if (cache === null || cacheProjectId !== (projectId ?? null)) {
      setLoading(true);
      fetchTimelineTaskTypes()
        .then((r) => {
          if (cancelled) return;
          cacheProjectId = projectId ?? null;
          emit(r);
          setLoading(false);
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e?.message ?? "Failed to load timeline task types");
          setLoading(false);
        });
    } else {
      setRows(cache);
      setLoading(false);
    }
    return () => {
      cancelled = true;
      listeners.delete(cb);
    };
  }, [projectId]);

  return { rows, loading, error };
}

/** Raw rows (including hidden project overrides) for the active project. */
export function useTimelineTaskTypeOverrides() {
  const projectId = useStore((s) => s.activeProjectId);
  const [raw, setRaw] = useState<TimelineTaskType[]>(
    cacheProjectId === (projectId ?? null) ? rawCache : [],
  );

  useEffect(() => {
    const cb = (r: TimelineTaskType[]) => setRaw(r);
    rawListeners.add(cb);
    if (cacheProjectId === (projectId ?? null)) setRaw(rawCache);
    return () => {
      rawListeners.delete(cb);
    };
  }, [projectId]);

  return useMemo(() => listOverriddenDefaults(raw), [raw]);
}
