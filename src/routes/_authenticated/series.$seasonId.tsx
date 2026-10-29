import { formatDate } from "@/lib/date-format";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { useStore, lineTotal, formatUSD } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, Film, AlertTriangle, Download, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

import { useTranslation } from "react-i18next";
type Season = {
  id: string;
  project_id: string;
  season_number: number;
  title: string;
  description: string | null;
  variance_note?: string | null;
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
  variance_note?: string | null;
};

type SearchParams = { episode?: string };

export const Route = createFileRoute("/_authenticated/series/$seasonId")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    episode: typeof s.episode === "string" ? s.episode : undefined,
  }),
  component: () => (
    <AppShell>
      <SeasonDetail />
    </AppShell>
  ),
});

function SeasonDetail() {
  const { t } = useTranslation();

  const { seasonId } = Route.useParams();
  const { episode: focusEpisode } = useSearch({
    from: "/_authenticated/series/$seasonId",
  }) as SearchParams;
  const activeProjectId = useStore((s) => s.activeProjectId);
  const budget = useStore((s) => s.budget);
  const projects = useStore((s) => s.projects);
  const active = projects.find((p) => p.id === activeProjectId) ?? null;

  const [season, setSeason] = useState<Season | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [txns, setTxns] = useState<
    Array<{
      id: string;
      entry_date: string | null;
      description: string | null;
      amount: number;
      reference_no: string | null;
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [s, e, t] = await Promise.all([
        supabase
          .from("series_seasons" as any)
          .select("*")
          .eq("id", seasonId)
          .maybeSingle(),
        supabase
          .from("series_episodes" as any)
          .select("*")
          .eq("season_id", seasonId)
          .order("episode_number"),
        activeProjectId
          ? supabase
              .from("transactions" as any)
              .select("id, entry_date, description, amount, reference_no")
              .eq("project_id", activeProjectId)
              .order("entry_date", { ascending: false })
              .limit(50)
          : Promise.resolve({ data: [] as any }),
      ]);
      if (cancelled) return;
      setSeason((s.data ?? null) as unknown as Season | null);
      setEpisodes((e.data ?? []) as unknown as Episode[]);
      setTxns((t.data ?? []) as unknown as any[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [seasonId, activeProjectId]);

  const totalAllocated = episodes.reduce((a, ep) => a + Number(ep.budget_allocation || 0), 0);
  const totalProjectBudget = useMemo(() => budget.reduce((a, l) => a + lineTotal(l), 0), [budget]);

  const focused = focusEpisode ? (episodes.find((e) => e.id === focusEpisode) ?? null) : null;

  if (loading) {
    return (
      <>
        <PageTitle title={t("series_seasonid.season_detail")} />
        <Panel className="p-6 text-sm text-muted-foreground">Loading…</Panel>
      </>
    );
  }

  if (!season) {
    return (
      <>
        <PageTitle title={t("series_seasonid.season_detail")} />
        <Panel className="p-6 text-sm text-muted-foreground">
          Season not found or you don't have access to it.{" "}
          <Link to="/series" className="text-brand hover:underline">
            {t("series_seasonid.back_to_series")}
          </Link>
        </Panel>
      </>
    );
  }

  const saveEpisodeNote = async (id: string, note: string) => {
    const clean = note.trim();
    const { error } = await supabase
      .from("series_episodes" as any)
      .update({ variance_note: clean || null })
      .eq("id", id);
    if (error) {
      toast.error(t("series_seasonid.failed_to_save_note"));
      return;
    }
    setEpisodes((prev) =>
      prev.map((ep) => (ep.id === id ? { ...ep, variance_note: clean || null } : ep)),
    );
    toast.success(t("series_seasonid.variance_note_saved"));
  };

  const saveSeasonNote = async (note: string) => {
    if (!season) return;
    const clean = note.trim();
    const { error } = await supabase
      .from("series_seasons" as any)
      .update({ variance_note: clean || null })
      .eq("id", season.id);
    if (error) {
      toast.error(t("series_seasonid.failed_to_save_note"));
      return;
    }
    setSeason({ ...season, variance_note: clean || null });
    toast.success(t("series_seasonid.season_note_saved"));
  };

  const handleExport = async () => {
    const [{ downloadSectionedCSV }, { formatExportNumber }] = await Promise.all([
      import("@/lib/export-csv"),
      import("@/lib/export/number-format"),
    ]);
    const pct = (part: number, whole: number) =>
      `${whole > 0 ? formatExportNumber((part / whole) * 100, 2) : "0.00"}%`;
    // G04: one CSV writer (project header, 2-decimal money, export footer).
    const summary: { Metric: string; Value: string | number }[] = [
      { Metric: "Season", Value: `Season ${season.season_number} — ${season.title}` },
      { Metric: "Episodes", Value: episodes.length },
      { Metric: "Total Allocated", Value: formatExportNumber(totalAllocated, 2) },
      {
        Metric: "Avg / Episode",
        Value: formatExportNumber(episodes.length > 0 ? totalAllocated / episodes.length : 0, 2),
      },
      { Metric: "% of Project Budget", Value: pct(totalAllocated, totalProjectBudget) },
    ];
    if (season.variance_note)
      summary.push({ Metric: "Season Variance Note", Value: season.variance_note });
    const episodeRows = episodes.map((ep) => {
      const allocated = Number(ep.budget_allocation || 0);
      return {
        "Ep #": `E${ep.episode_number}`,
        Title: ep.title,
        "Shoot Date": ep.shooting_date ? formatDate(ep.shooting_date) : "",
        Allocated: allocated,
        "% of Season": pct(allocated, totalAllocated),
        "Variance Note": ep.variance_note ?? "",
      };
    });
    downloadSectionedCSV(`season-${season.season_number}-report`, [
      { title: "Summary", rows: summary, opts: { raw: ["Value"] } },
      {
        title: "Episodes",
        rows: episodeRows,
        headers: ["Ep #", "Title", "Shoot Date", "Allocated", "% of Season", "Variance Note"],
        opts: { money: ["Allocated"], raw: ["% of Season"] },
      },
    ]);
    toast.success(t("series_seasonid.season_report_exported"));
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <Link
          to="/series"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {t("series_seasonid.back_to_series")}
        </Link>
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-2 rounded-md bg-brand/90 hover:bg-brand text-white px-3 py-1.5 text-sm"
        >
          <Download className="size-4" />
          {t("series_seasonid.export_season_report")}
        </button>
      </div>
      <PageTitle title={`Season ${season.season_number} — ${season.title}`} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <MiniStat label="Episodes" value={String(episodes.length)} />
        <MiniStat label="Total Allocated" value={formatUSD(totalAllocated)} />
        <MiniStat
          label="Avg / Episode"
          value={formatUSD(episodes.length > 0 ? totalAllocated / episodes.length : 0)}
        />
        <MiniStat
          label="% of Project Budget"
          value={`${totalProjectBudget > 0 ? ((totalAllocated / totalProjectBudget) * 100).toFixed(1) : "0.0"}%`}
        />
      </div>

      <Panel className="p-4 mb-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("series_seasonid.season_variance_explanation")}
          </div>
        </div>
        <VarianceNoteEditor
          value={season.variance_note ?? ""}
          placeholder={t("series_seasonid.explain_why_this_season_is_over_or_under")}
          onSave={saveSeasonNote}
        />
      </Panel>

      <Panel className="p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Film className="size-4 text-brand" />
          <h3 className="text-sm font-semibold uppercase tracking-wider">
            {t("series_seasonid.episodes")}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-start py-2 px-2">#</th>
                <th className="text-start py-2 px-2">Title</th>
                <th className="text-start py-2 px-2">{t("series_seasonid.shoot_date")}</th>
                <th className="text-end py-2 px-2">Allocated</th>
                <th className="text-end py-2 px-2">% of Season</th>
                <th className="text-start py-2 px-2">
                  {t("series_seasonid.variance_explanation")}
                </th>
              </tr>
            </thead>
            <tbody>
              {episodes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 px-2 text-muted-foreground">
                    {t("series_seasonid.no_episodes")}
                  </td>
                </tr>
              ) : (
                episodes.map((ep) => {
                  const allocated = Number(ep.budget_allocation || 0);
                  const unallocated = allocated <= 0;
                  const isFocused = focused?.id === ep.id;
                  return (
                    <tr
                      key={ep.id}
                      className={`border-b border-border ${isFocused ? "bg-brand/10" : ""}`}
                    >
                      <td className="py-2 px-2 font-medium align-top">E{ep.episode_number}</td>
                      <td className="py-2 px-2 align-top">{ep.title}</td>
                      <td className="py-2 px-2 text-muted-foreground align-top">
                        {formatDate(ep.shooting_date) || "—"}
                      </td>
                      <td className="py-2 px-2 text-end tabular-nums align-top">
                        {unallocated ? (
                          <span className="inline-flex items-center gap-1 text-warning text-xs">
                            <AlertTriangle className="size-3" /> Unallocated
                          </span>
                        ) : (
                          formatUSD(allocated)
                        )}
                      </td>
                      <td className="py-2 px-2 text-end tabular-nums text-muted-foreground align-top">
                        {totalAllocated > 0
                          ? ((allocated / totalAllocated) * 100).toFixed(1)
                          : "0.0"}
                        %
                      </td>
                      <td className="py-2 px-2 align-top min-w-[220px]">
                        <VarianceNoteEditor
                          value={ep.variance_note ?? ""}
                          placeholder={t("series_seasonid.add_explanation")}
                          onSave={(note) => saveEpisodeNote(ep.id, note)}
                          compact
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="p-4 mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">
          Project Budget Lines {active ? `— ${active.name}` : ""}
        </h3>
        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground sticky top-0 bg-surface">
              <tr className="border-b border-border">
                <th className="text-start py-2 px-2">Code</th>
                <th className="text-start py-2 px-2">Description</th>
                <th className="text-start py-2 px-2">Group</th>
                <th className="text-end py-2 px-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {budget.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 px-2 text-muted-foreground">
                    {t("series_seasonid.no_budget_lines")}
                  </td>
                </tr>
              ) : (
                budget.map((l) => (
                  <tr key={l.id} className="border-b border-border">
                    <td className="py-2 px-2 tabular-nums">{l.mainCode}</td>
                    <td className="py-2 px-2">{l.description}</td>
                    <td className="py-2 px-2 text-muted-foreground">{l.group}</td>
                    <td className="py-2 px-2 text-end tabular-nums">{formatUSD(lineTotal(l))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">
          {t("series_seasonid.recent_transactions")}
        </h3>
        <div className="overflow-x-auto max-h-[360px]">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground sticky top-0 bg-surface">
              <tr className="border-b border-border">
                <th className="text-start py-2 px-2">Date</th>
                <th className="text-start py-2 px-2">Description</th>
                <th className="text-start py-2 px-2">Ref</th>
                <th className="text-end py-2 px-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {txns.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 px-2 text-muted-foreground">
                    {t("series_seasonid.no_transactions_recorded")}
                  </td>
                </tr>
              ) : (
                txns.map((t) => (
                  <tr key={t.id} className="border-b border-border">
                    <td className="py-2 px-2 text-muted-foreground">
                      {formatDate(t.entry_date) || "—"}
                    </td>
                    <td className="py-2 px-2">{t.description ?? "—"}</td>
                    <td className="py-2 px-2 text-muted-foreground">{t.reference_no ?? "—"}</td>
                    <td className="py-2 px-2 text-end tabular-nums">
                      {formatUSD(Number(t.amount || 0))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Panel className="!p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums mt-1">{value}</div>
    </Panel>
  );
}

function VarianceNoteEditor({
  value,
  placeholder,
  onSave,
  compact = false,
}: {
  value: string;
  placeholder?: string;
  onSave: (note: string) => void | Promise<void>;
  compact?: boolean;
}) {
  const { t } = useTranslation();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <div
          className={`flex-1 ${compact ? "text-xs" : "text-sm"} ${value ? "text-foreground" : "text-muted-foreground italic"}`}
        >
          {value || (placeholder ?? "No explanation.")}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-xs text-brand hover:underline shrink-0"
          aria-label={t("series_seasonid.edit_variance_note")}
        >
          <Pencil className="size-3" /> Edit
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        rows={compact ? 2 : 3}
        className="flex-1 bg-surface border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <div className="flex flex-col gap-1 shrink-0">
        <button
          type="button"
          onClick={async () => {
            await onSave(draft);
            setEditing(false);
          }}
          className="inline-flex items-center gap-1 text-xs bg-brand/90 hover:bg-brand text-white rounded px-2 py-1"
        >
          <Check className="size-3" /> Save
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setEditing(false);
          }}
          className="inline-flex items-center gap-1 text-xs bg-surface hover:bg-muted text-muted-foreground rounded px-2 py-1"
        >
          <X className="size-3" /> Cancel
        </button>
      </div>
    </div>
  );
}
