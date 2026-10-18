import { supabase } from "@/integrations/supabase/client";
import { invalidateBudgetCaches } from "@/lib/budget-cache-bus";

export type BudgetUploadBatch = {
  id: string;
  organization_id: string;
  project_id: string;
  uploaded_by: string | null;
  filename: string | null;
  row_count: number;
  note: string | null;
  created_at: string;
  uploader_name?: string | null;
  replaced_snapshot?: unknown;
};

export async function createBudgetBatch(params: {
  projectId: string;
  organizationId: string;
  filename: string;
  rowCount: number;
  note?: string;
  replacedSnapshot?: unknown;
}): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("budget_upload_batches" as never)
    .insert({
      project_id: params.projectId,
      organization_id: params.organizationId,
      uploaded_by: auth.user?.id ?? null,
      filename: params.filename,
      row_count: params.rowCount,
      note: params.note ?? null,
      replaced_snapshot: params.replacedSnapshot ?? null,
    } as never)
    .select("id")
    .single();
  if (error) {
    console.error("createBudgetBatch failed", error);
    return null;
  }
  return (data as { id: string }).id;
}

export async function listBudgetBatches(projectId: string): Promise<BudgetUploadBatch[]> {
  if (!projectId) return [];
  const { data, error } = await supabase
    .from("budget_upload_batches" as never)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("listBudgetBatches failed", error);
    return [];
  }
  const batches = (data ?? []) as unknown as BudgetUploadBatch[];
  const ids = Array.from(new Set(batches.map((b) => b.uploaded_by).filter(Boolean))) as string[];
  if (ids.length) {
    const { data: profs } = await supabase.from("profiles").select("id,display_name").in("id", ids);
    const map = new Map(
      (profs ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name]),
    );
    for (const b of batches)
      b.uploader_name = b.uploaded_by ? (map.get(b.uploaded_by) ?? null) : null;
  }
  return batches;
}
export async function getLatestBudgetBatch(projectId: string): Promise<BudgetUploadBatch | null> {
  const list = await listBudgetBatches(projectId);
  return list[0] ?? null;
}

export async function deleteBudgetBatch(
  batchId: string,
  projectId: string,
): Promise<{ removed: number; restored: number }> {
  void batchId;
  void projectId;
  throw new Error("Budget batch deletion is disabled for production safety.");
}

/** Loads all budget_lines for a project so they can be stored as a Replace-mode snapshot. */
export async function snapshotProjectBudgetLines(projectId: string): Promise<unknown[]> {
  if (!projectId) return [];
  const { data, error } = await supabase
    .from("budget_lines")
    .select("*")
    .eq("project_id", projectId);
  if (error) {
    console.error("snapshotProjectBudgetLines failed", error);
    return [];
  }
  return (data ?? []) as unknown[];
}

export async function stampBudgetLinesWithBatch(params: {
  projectId: string;
  batchId: string;
  lineIds: string[];
}): Promise<void> {
  if (!params.lineIds.length) return;
  const { error } = await supabase
    .from("budget_lines")
    .update({
      upload_batch_id: params.batchId,
      uploaded_at: new Date().toISOString(),
    } as never)
    .in("id", params.lineIds)
    .eq("project_id", params.projectId);
  if (error) console.error("stampBudgetLinesWithBatch failed", error);
  else invalidateBudgetCaches(params.projectId, "lines");
}
