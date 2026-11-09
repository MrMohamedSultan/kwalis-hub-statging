// ═══════════════════════════════════════════════════════════════════
// Where a budget upload lands — so re-importing never duplicates silently.
// ═══════════════════════════════════════════════════════════════════
//
// The upload writes into the SELECTED budget version (store.toBudgetRow →
// version_id). Committing the same workbook twice used to append every line
// a second time. When the version already has lines the commit now offers:
//
//   new_draft      (default) a new draft version holding ONLY the file's lines;
//                  the approved budget is untouched until someone publishes it.
//   replace_draft  (drafts only) the draft's own lines are replaced by the
//                  file's; the old lines are kept in the upload batch snapshot.
//   add            append to the selected version (the previous behaviour).
//
// Replacing the lines of the ACTIVE version is never offered: actuals,
// commitments and reports read it, and bulk wipes of it are disabled on
// purpose (store.clearProjectBudget).

import { supabase } from "@/integrations/supabase/client";
import { createBudgetDraft } from "@/lib/budget-versions";
import { setSelectedVersion, invalidateVersionResolution } from "@/lib/budget-version-selection";
import { duplicateKey } from "@/lib/budget-import-clean";
import type { BudgetLine } from "@/lib/store";

export type ImportTarget = "new_draft" | "replace_draft" | "add";

export type ImportTargetChoice = { options: ImportTarget[]; defaultTarget: ImportTarget };

export function importTargetChoices(
  selectedStatus: "draft" | "active" | "archived" | null | undefined,
  existingLines: number,
  /** false when the project has no budget versions (database without versioning). */
  versioning = true,
): ImportTargetChoice {
  if (existingLines <= 0 || !versioning) return { options: ["add"], defaultTarget: "add" };
  if (selectedStatus === "draft")
    return { options: ["new_draft", "replace_draft", "add"], defaultTarget: "new_draft" };
  return { options: ["new_draft", "add"], defaultTarget: "new_draft" };
}

/** Incoming lines identical to a line already in the version (same key as the import's duplicate check). */
export function countExistingMatches(incoming: BudgetLine[], existing: BudgetLine[]): number {
  const keys = new Set(existing.map(duplicateKey));
  return incoming.filter((l) => keys.has(duplicateKey(l))).length;
}

/**
 * Prepares the target version before the lines are inserted. Returns the
 * lines that were replaced (for the upload batch snapshot).
 */
export async function prepareImportTarget(params: {
  target: ImportTarget;
  projectId: string;
  selectedVersionId: string | null;
  selectedStatus: "draft" | "active" | "archived" | null | undefined;
  currentLines: BudgetLine[];
  draftName: string;
}): Promise<{ versionId: string | null; replaced: BudgetLine[] }> {
  const { target, projectId } = params;
  if (target === "add") return { versionId: params.selectedVersionId, replaced: [] };

  if (target === "replace_draft") {
    if (params.selectedStatus !== "draft" || !params.selectedVersionId)
      throw new Error("Only a draft budget version can be replaced.");
    const { error } = await supabase
      .from("budget_lines")
      .delete()
      .eq("project_id", projectId)
      .eq("version_id", params.selectedVersionId);
    if (error) throw error;
    return { versionId: params.selectedVersionId, replaced: params.currentLines };
  }

  // new_draft: create_budget_draft copies the active lines — remove that copy
  // (it only exists in the brand-new draft) so the draft holds the file alone.
  const draftId = await createBudgetDraft(projectId, params.draftName.slice(0, 80));
  const { error } = await supabase
    .from("budget_lines")
    .delete()
    .eq("project_id", projectId)
    .eq("version_id", draftId);
  if (error) throw error;
  invalidateVersionResolution(projectId);
  setSelectedVersion(projectId, draftId);
  return { versionId: draftId, replaced: [] };
}
