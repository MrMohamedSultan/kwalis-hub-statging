// Dynamic character-role taxonomy. Productions can define their own role types
// (Main, Supporting, Cameo, Stunt Double, …). A curated default list is offered
// when a project hasn't defined any yet — nothing is hardcoded in the UI.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";

export type CharacterRoleTypeRow = {
  id: string;
  project_id: string | null;
  organization_id: string | null;
  label: string;
  sort_order: number;
};

export const DEFAULT_ROLE_LABELS = ["Main", "Supporting", "Recurring", "Guest", "Extra"] as const;

const TONES = [
  "border-highlight/40 bg-highlight/10 text-highlight",
  "border-info/40 bg-info/10 text-info",
  "border-success/40 bg-success/10 text-success",
  "border-warning/40 bg-warning/10 text-warning",
  "border-border bg-muted/10 text-foreground",
  "border-destructive/40 bg-destructive/10 text-destructive",
  "border-success/40 bg-success/10 text-success",
];

/** Stable colour per label so badges stay consistent across renders. */
export function roleTone(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

export async function listRoleTypes(projectId: string): Promise<CharacterRoleTypeRow[]> {
  const { data, error } = await supabase
    .from("character_role_types" as any)
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order")
    .order("label");
  if (error) throw error;
  return (data ?? []) as unknown as CharacterRoleTypeRow[];
}

export async function addRoleType(input: {
  projectId: string;
  organizationId: string | null;
  label: string;
  sortOrder?: number;
}): Promise<CharacterRoleTypeRow> {
  const { data, error } = await supabase
    .from("character_role_types" as any)
    .insert({
      project_id: input.projectId,
      organization_id: input.organizationId,
      label: input.label.trim(),
      sort_order: input.sortOrder ?? 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as CharacterRoleTypeRow;
}

export async function renameRoleType(id: string, label: string): Promise<void> {
  const { error } = await supabase
    .from("character_role_types" as any)
    .update({ label: label.trim() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteRoleType(id: string): Promise<void> {
  const { error } = await supabase
    .from("character_role_types" as any)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/** Seed the default taxonomy for a project that has none yet. */
export async function seedDefaultRoleTypes(
  projectId: string,
  organizationId: string | null,
): Promise<void> {
  const rows = DEFAULT_ROLE_LABELS.map((label, i) => ({
    project_id: projectId,
    organization_id: organizationId,
    label,
    sort_order: i,
  }));
  const { error } = await supabase.from("character_role_types" as any).insert(rows);
  if (error && !/duplicate|unique/i.test(error.message)) throw error;
}

export function useCharacterRoleTypes() {
  const projectId = useStore((s) => s.activeProjectId);
  const orgId = useStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.organizationId ?? null,
  );
  const [roleTypes, setRoleTypes] = useState<CharacterRoleTypeRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setRoleTypes([]);
      return;
    }
    setLoading(true);
    try {
      let rows = await listRoleTypes(projectId);
      if (rows.length === 0) {
        // First visit for this project: materialise the defaults so they are
        // editable/removable like any custom role.
        await seedDefaultRoleTypes(projectId, orgId).catch(() => {});
        rows = await listRoleTypes(projectId).catch(() => []);
      }
      setRoleTypes(rows);
    } catch {
      setRoleTypes([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Labels available in dropdowns — always includes any legacy value in use. */
  const labels = roleTypes.map((r) => r.label);

  return { roleTypes, labels, loading, refresh, projectId, orgId };
}
