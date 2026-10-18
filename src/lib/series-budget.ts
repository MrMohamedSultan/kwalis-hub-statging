// Fetches series season/episode budget allocations for the active project
// and exposes rollups for variance calculations in Dashboard + Cost Reports.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";

export type SeriesSeasonRow = {
  id: string;
  project_id: string;
  season_number: number;
  title: string;
};

export type SeriesEpisodeRow = {
  id: string;
  project_id: string;
  season_id: string;
  episode_number: number;
  title: string;
  duration: number | null;
  shooting_date: string | null;
  budget_allocation: number;
  variance_note?: string | null;
};

export type SeriesRollup = {
  isSeries: boolean;
  seasons: SeriesSeasonRow[];
  episodes: SeriesEpisodeRow[];
  totalAllocated: number;
  episodeCount: number;
  seasonCount: number;
  bySeason: Array<{
    season: SeriesSeasonRow;
    episodes: SeriesEpisodeRow[];
    allocated: number;
  }>;
};

const EMPTY: SeriesRollup = {
  isSeries: false,
  seasons: [],
  episodes: [],
  totalAllocated: 0,
  episodeCount: 0,
  seasonCount: 0,
  bySeason: [],
};

export function useSeriesBudget(): SeriesRollup {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const active = projects.find((p) => p.id === activeProjectId) ?? null;
  const isSeries = active?.productionKind === "series";

  const [seasons, setSeasons] = useState<SeriesSeasonRow[]>([]);
  const [episodes, setEpisodes] = useState<SeriesEpisodeRow[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isSeries || !activeProjectId) {
      setSeasons([]);
      setEpisodes([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const [s, e] = await Promise.all([
        supabase
          .from("series_seasons" as any)
          .select("*")
          .eq("project_id", activeProjectId)
          .order("season_number"),
        supabase
          .from("series_episodes" as any)
          .select("*")
          .eq("project_id", activeProjectId)
          .order("episode_number"),
      ]);
      if (cancelled) return;
      setSeasons((s.data ?? []) as unknown as SeriesSeasonRow[]);
      setEpisodes((e.data ?? []) as unknown as SeriesEpisodeRow[]);
    };
    void load();

    const queue = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(load, 300);
    };
    // Channel names must be unique per hook instance: two components using
    // this hook (or a StrictMode double-mount) would otherwise reuse an
    // already-subscribed channel and throw
    // "cannot add postgres_changes callbacks ... after subscribe()".
    const channelName = `series-budget-${activeProjectId}-${Math.random().toString(36).slice(2, 10)}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "series_seasons",
            filter: `project_id=eq.${activeProjectId}`,
          },
          queue,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "series_episodes",
            filter: `project_id=eq.${activeProjectId}`,
          },
          queue,
        )
        .subscribe();
    } catch (err) {
      // Realtime is a nice-to-have here — never let it take down the page.
      console.warn("[series-budget] realtime subscription failed", err);
      channel = null;
    }
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [isSeries, activeProjectId]);

  return useMemo<SeriesRollup>(() => {
    if (!isSeries) return EMPTY;
    const totalAllocated = episodes.reduce((a, e) => a + Number(e.budget_allocation || 0), 0);
    const bySeason = seasons.map((season) => {
      const eps = episodes.filter((ep) => ep.season_id === season.id);
      return {
        season,
        episodes: eps,
        allocated: eps.reduce((a, ep) => a + Number(ep.budget_allocation || 0), 0),
      };
    });
    return {
      isSeries: true,
      seasons,
      episodes,
      totalAllocated,
      episodeCount: episodes.length,
      seasonCount: seasons.length,
      bySeason,
    };
  }, [isSeries, seasons, episodes]);
}
