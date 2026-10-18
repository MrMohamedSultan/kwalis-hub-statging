// Characters CRUD helpers (project-scoped, series-aware).
// A "Character" is the fictional role a cast member plays. It can be optionally
// tied to a series season/episode and to a single budget line. Cast contracts
// then reference the character (people.character_id), so linking an actor to a
// character automatically flows into the corresponding budget line.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";

/** Free-form label from the per-project taxonomy in `character_role_types`. */
export type CharacterRoleType = string;

export type Character = {
  id: string;
  project_id: string;
  organization_id: string | null;
  season_id: string | null;
  episode_id: string | null;
  name: string;
  role_type: CharacterRoleType;
  description: string | null;
  budget_line_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function listCharacters(projectId: string): Promise<Character[]> {
  const { data, error } = await supabase
    .from("characters" as any)
    .select("*")
    .eq("project_id", projectId)
    .order("role_type", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Character[];
}

export async function createCharacter(input: {
  projectId: string;
  organizationId: string | null;
  name: string;
  roleType: CharacterRoleType;
  description?: string | null;
  seasonId?: string | null;
  episodeId?: string | null;
  budgetLineId?: string | null;
}): Promise<Character> {
  const payload = {
    project_id: input.projectId,
    organization_id: input.organizationId,
    name: input.name.trim(),
    role_type: input.roleType,
    description: input.description ?? null,
    season_id: input.seasonId ?? null,
    episode_id: input.episodeId ?? null,
    budget_line_id: input.budgetLineId ?? null,
  };
  const { data, error } = await supabase
    .from("characters" as any)
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Character;
}

export async function updateCharacter(
  id: string,
  patch: Partial<Omit<Character, "id" | "created_at" | "updated_at">>,
): Promise<void> {
  const { error } = await supabase
    .from("characters" as any)
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCharacter(id: string): Promise<void> {
  const { error } = await supabase
    .from("characters" as any)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export function useCharacters(): {
  characters: Character[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const projectId = useStore((s) => s.activeProjectId);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useMemo(
    () => async () => {
      if (!projectId) {
        setCharacters([]);
        return;
      }
      setLoading(true);
      try {
        const rows = await listCharacters(projectId);
        setCharacters(rows);
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!projectId) return;
      const rows = await listCharacters(projectId).catch(() => []);
      if (!cancelled) setCharacters(rows);
    })();

    if (!projectId)
      return () => {
        cancelled = true;
      };
    const queue = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(refresh, 250);
    };
    const ch = supabase
      .channel(`characters-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "characters", filter: `project_id=eq.${projectId}` },
        queue,
      )
      .subscribe();
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(ch);
    };
  }, [projectId, refresh]);

  return { characters, loading, refresh };
}
