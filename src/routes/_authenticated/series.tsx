import { createFileRoute } from "@tanstack/react-router";
import { DateInput } from "@/components/ui/date-input";
import { useEffect, useState, useCallback } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, Film, ChevronDown, ChevronRight, Clapperboard } from "lucide-react";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/series")({
  component: () => (
    <AppShell>
      <SeriesGate />
    </AppShell>
  ),
});

type Season = {
  id: string;
  project_id: string;
  season_number: number;
  title: string;
  description: string | null;
};

type Episode = {
  id: string;
  season_id: string;
  project_id: string;
  episode_number: number;
  title: string;
  duration: number | null;
  shooting_date: string | null;
  budget_allocation: number;
};

function SeriesGate() {
  const { t } = useTranslation();

  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const active = projects.find((p) => p.id === activeProjectId) ?? null;

  if (!active) {
    return (
      <>
        <PageTitle title={t("series.series_management")} />
        <Panel className="p-6 text-sm text-muted-foreground">
          {t("series.select_a_project_to_manage_its_series")}
        </Panel>
      </>
    );
  }

  if (active.productionKind !== "series") {
    return (
      <>
        <PageTitle title={t("series.series_management")} />
        <Panel className="p-6">
          <div className="flex items-start gap-3">
            <Clapperboard className="size-5 text-brand mt-0.5" />
            <div>
              <h2 className="text-base font-semibold">{t("series.not_a_series_project")}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                “{active.name}” is a{" "}
                <span className="uppercase font-medium">{active.productionKind}</span> project.
                Seasons and Episodes are available only when the Project Type is set to “Series”.
                Change it in Settings → Active Project.
              </p>
            </div>
          </div>
        </Panel>
      </>
    );
  }

  return <SeriesManagement projectId={active.id} projectName={active.name} />;
}

function SeriesManagement({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { t } = useTranslation();

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const [s, e] = await Promise.all([
      supabase
        .from("series_seasons" as any)
        .select("*")
        .eq("project_id", projectId)
        .order("season_number"),
      supabase
        .from("series_episodes" as any)
        .select("*")
        .eq("project_id", projectId)
        .order("episode_number"),
    ]);
    setSeasons((s.data ?? []) as unknown as Season[]);
    setEpisodes((e.data ?? []) as unknown as Episode[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addSeason = async () => {
    const nextNum = (seasons.at(-1)?.season_number ?? 0) + 1;
    const title = window.prompt(`Title for Season ${nextNum}?`, `Season ${nextNum}`);
    if (!title) return;
    const { error } = await supabase.from("series_seasons" as any).insert({
      project_id: projectId,
      season_number: nextNum,
      title,
    } as any);
    if (error) return toast.error(error.message);
    toast.success(t("series.season_created"));
    void refresh();
  };

  const removeSeason = async (id: string) => {
    if (!window.confirm(t("series.delete_this_season_and_all_its_episodes"))) return;
    const { error } = await supabase
      .from("series_seasons" as any)
      .delete()
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("series.season_deleted"));
    void refresh();
  };

  const addEpisode = async (season: Season) => {
    const seasonEps = episodes.filter((ep) => ep.season_id === season.id);
    const nextNum = (seasonEps.at(-1)?.episode_number ?? 0) + 1;
    const title = window.prompt(
      `Title for S${season.season_number}E${nextNum}?`,
      `Episode ${nextNum}`,
    );
    if (!title) return;
    const { error } = await supabase.from("series_episodes" as any).insert({
      project_id: projectId,
      season_id: season.id,
      episode_number: nextNum,
      title,
      budget_allocation: 0,
    } as any);
    if (error) return toast.error(error.message);
    toast.success(t("series.episode_added"));
    void refresh();
  };

  const updateEpisode = async (id: string, patch: Partial<Episode>) => {
    const { error } = await supabase
      .from("series_episodes" as any)
      .update(patch as any)
      .eq("id", id);
    if (error) return toast.error(error.message);
    setEpisodes((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeEpisode = async (id: string) => {
    if (!window.confirm(t("series.delete_this_episode"))) return;
    const { error } = await supabase
      .from("series_episodes" as any)
      .delete()
      .eq("id", id);
    if (error) return toast.error(error.message);
    setEpisodes((rows) => rows.filter((r) => r.id !== id));
  };

  return (
    <>
      <PageTitle title={`Series Management — ${projectName}`} />
      <Panel className="p-4 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="size-4 text-brand" />
          <span className="text-sm text-muted-foreground">
            {seasons.length} season{seasons.length === 1 ? "" : "s"} · {episodes.length} episode
            {episodes.length === 1 ? "" : "s"}
          </span>
        </div>
        <button
          onClick={addSeason}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand text-brand-foreground text-sm font-semibold px-3 py-1.5 hover:brightness-110"
        >
          <Plus className="size-4" />
          {t("series.add_season")}
        </button>
      </Panel>

      {loading ? (
        <Panel className="p-6 text-sm text-muted-foreground">Loading…</Panel>
      ) : seasons.length === 0 ? (
        <Panel className="p-6 text-sm text-muted-foreground">
          {t("series.no_seasons_yet_start_by_adding_season_1")}
        </Panel>
      ) : (
        <div className="space-y-3">
          {seasons.map((season) => {
            const seasonEps = episodes.filter((ep) => ep.season_id === season.id);
            const isOpen = expanded[season.id] ?? true;
            return (
              <Panel key={season.id} className="p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [season.id]: !isOpen }))}
                    className="flex items-center gap-2 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                    <span className="font-semibold">
                      Season {season.season_number}: {season.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      · {seasonEps.length} episode{seasonEps.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => addEpisode(season)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-surface text-sm px-2.5 py-1 hover:bg-muted"
                    >
                      <Plus className="size-3.5" /> Episode
                    </button>
                    <button
                      onClick={() => removeSeason(season.id)}
                      className="p-1 text-destructive hover:text-destructive"
                      title={t("series.delete_season")}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-2">#</th>
                          <th className="text-left py-2 px-2">Title</th>
                          <th className="text-left py-2 px-2">{t("series.duration_min")}</th>
                          <th className="text-left py-2 px-2">Shoot Date</th>
                          <th className="text-right py-2 px-2">Budget</th>
                          <th className="py-2 px-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {seasonEps.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-3 px-2 text-muted-foreground">
                              {t("series.no_episodes_yet")}
                            </td>
                          </tr>
                        ) : (
                          seasonEps.map((ep) => (
                            <tr key={ep.id} className="border-b border-border">
                              <td className="py-2 px-2 font-medium">E{ep.episode_number}</td>
                              <td className="py-2 px-2">
                                <input
                                  defaultValue={ep.title}
                                  onBlur={(e) =>
                                    e.target.value !== ep.title &&
                                    updateEpisode(ep.id, { title: e.target.value })
                                  }
                                  className="bg-transparent border border-border rounded px-2 py-1 w-full outline-none"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  type="number"
                                  defaultValue={ep.duration ?? ""}
                                  onBlur={(e) => {
                                    const v = e.target.value === "" ? null : Number(e.target.value);
                                    if (v !== ep.duration) updateEpisode(ep.id, { duration: v });
                                  }}
                                  className="bg-transparent border border-border rounded px-2 py-1 w-24 outline-none"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <DateInput
                                  value={ep.shooting_date ?? ""}
                                  onChange={(iso) => {
                                    const v = iso || null;
                                    if (v !== ep.shooting_date)
                                      updateEpisode(ep.id, { shooting_date: v });
                                  }}
                                  className="bg-transparent border border-border rounded px-2 py-1 outline-none"
                                />
                              </td>
                              <td className="py-2 px-2 text-right">
                                <input
                                  type="number"
                                  defaultValue={ep.budget_allocation}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value) || 0;
                                    if (v !== ep.budget_allocation)
                                      updateEpisode(ep.id, { budget_allocation: v });
                                  }}
                                  className="bg-transparent border border-border rounded px-2 py-1 w-28 text-right outline-none"
                                />
                              </td>
                              <td className="py-2 px-2 text-right">
                                <button
                                  onClick={() => removeEpisode(ep.id)}
                                  className="p-1 text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
