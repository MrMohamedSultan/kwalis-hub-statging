/**
 * True budget versioning.
 *
 * Every project has exactly one `active` budget version — the one every
 * financial view (v_project_position, v_budget_code_position,
 * budget_line_actuals, ...) sums. Drafts live side by side and are invisible
 * to actuals/commitments until published.
 *
 * The selected version (what the Budget grid edits) is remembered per project
 * in localStorage; it always falls back to the active version.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import {
  BUDGET_VERSION_CHANGE_EVENT,
  invalidateVersionResolution,
  resolveSelectedVersionId,
  selectedVersionIdSync,
  setSelectedVersion,
} from "@/lib/budget-version-selection";

export type BudgetVersionStatus = "draft" | "active" | "archived";

export type BudgetVersion = {
  id: string;
  projectId: string;
  versionNo: number;
  versionName: string;
  status: BudgetVersionStatus;
  createdAt: string;
  publishedAt: string | null;
};

const fromRow = (r: any): BudgetVersion => ({
  id: r.id,
  projectId: r.project_id,
  versionNo: Number(r.version_no ?? 1),
  versionName: String(r.version_name ?? "v1"),
  status: (r.status ?? "draft") as BudgetVersionStatus,
  createdAt: r.created_at,
  publishedAt: r.published_at ?? null,
});

export async function fetchBudgetVersions(projectId: string): Promise<BudgetVersion[]> {
  const { data, error } = await supabase
    .from("budget_versions" as any)
    .select("id, project_id, version_no, version_name, status, created_at, published_at")
    .eq("project_id", projectId)
    .order("version_no", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map(fromRow);
}

export async function createBudgetDraft(projectId: string, name?: string): Promise<string> {
  const { data, error } = await (supabase as any).rpc("create_budget_draft", {
    _project: projectId,
    _name: name ?? null,
  });
  if (error) throw error;
  invalidateVersionResolution(projectId);
  return String(data);
}

export async function publishBudgetVersion(versionId: string): Promise<void> {
  const { error } = await (supabase as any).rpc("publish_budget_version", { _version: versionId });
  if (error) throw error;
  invalidateVersionResolution();
}

export async function deleteBudgetDraft(versionId: string): Promise<void> {
  // RLS only allows deleting draft versions; lines cascade with the version.
  const { error } = await supabase
    .from("budget_versions" as any)
    .delete()
    .eq("id", versionId);
  if (error) throw error;
  invalidateVersionResolution();
}

export function useBudgetVersions() {
  const projectId = useStore((s) => s.activeProjectId);
  const [versions, setVersions] = useState<BudgetVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!projectId) {
      setVersions([]);
      setSelectedId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await fetchBudgetVersions(projectId);
      setVersions(list);
      const id = await resolveSelectedVersionId(projectId, true);
      setSelectedId(id);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const sync = () => setSelectedId(selectedVersionIdSync(projectId));
    window.addEventListener(BUDGET_VERSION_CHANGE_EVENT, sync);
    return () => window.removeEventListener(BUDGET_VERSION_CHANGE_EVENT, sync);
  }, [projectId]);

  const selected = versions.find((v) => v.id === selectedId) ?? null;

  return {
    projectId,
    versions,
    selected,
    selectedId,
    loading,
    reload,
    isDraft: selected?.status === "draft",
    isActive: selected?.status === "active",
    select: (id: string) => {
      if (projectId) setSelectedVersion(projectId, id);
      setSelectedId(id);
    },
  };
}

export {
  BUDGET_VERSION_CHANGE_EVENT,
  invalidateVersionResolution,
  resolveSelectedVersionId,
  selectedVersionIdSync,
  setSelectedVersion,
};
