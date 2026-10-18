/**
 * Selected-budget-version state (no store dependency, so `store.ts` can import
 * it without a cycle).
 */
import { supabase } from "@/integrations/supabase/client";

const SELECTION_KEY = "kwalis.budget-version.v1";
export const BUDGET_VERSION_CHANGE_EVENT = "kwalis:budget-version-change";

const selectedByProject = new Map<string, string>();

function readSelection(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SELECTION_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeSelection(map: Record<string, string>) {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(map));
  } catch {
    /* private mode — in-memory selection still applies */
  }
}

/** Synchronous read — valid after `resolveSelectedVersionId` has run once. */
export function selectedVersionIdSync(projectId: string | null | undefined): string | null {
  if (!projectId) return null;
  return selectedByProject.get(projectId) ?? null;
}

export function setSelectedVersion(projectId: string, versionId: string) {
  if (selectedByProject.get(projectId) === versionId) return; // no-op: avoid re-render storms
  selectedByProject.set(projectId, versionId);
  resolvedProjects.add(projectId);
  const map = readSelection();
  map[projectId] = versionId;
  writeSelection(map);
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent(BUDGET_VERSION_CHANGE_EVENT, { detail: { projectId, versionId } }),
    );
}

/** Projects whose selection has already been validated against the DB. */
const resolvedProjects = new Set<string>();

/** Forget the cached resolution (after create/publish/delete of a version). */
export function invalidateVersionResolution(projectId?: string | null) {
  if (projectId) resolvedProjects.delete(projectId);
  else resolvedProjects.clear();
}

/**
 * Resolves the version the grid should read/write for a project: the stored
 * selection when it still exists, otherwise the project's active version.
 *
 * Resolution is cached in memory — every scoped reload used to pay for a
 * round-trip here, which is a large part of the perceived lag.
 */
export async function resolveSelectedVersionId(
  projectId: string | null | undefined,
  force = false,
): Promise<string | null> {
  if (!projectId) return null;
  if (!force && resolvedProjects.has(projectId)) {
    return selectedByProject.get(projectId) ?? null;
  }
  const { data, error } = await supabase
    .from("budget_versions" as any)
    .select("id, status")
    .eq("project_id", projectId);
  if (error) return null;
  const rows = (data ?? []) as any[];
  const stored = readSelection()[projectId];
  const match =
    rows.find((r) => r.id === stored) ?? rows.find((r) => r.status === "active") ?? null;
  if (match) selectedByProject.set(projectId, match.id);
  else selectedByProject.delete(projectId);
  resolvedProjects.add(projectId);
  return match?.id ?? null;
}
