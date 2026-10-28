// =====================================================================
// Cost Report (R05 R06 R07 R08 R09 R10, decision 5) — GL Report, By GL
// Account and Final Report as ONE report with a grouping switch: by line /
// by account / by category (ATL / BTL / Post / Music / VFX / Other, with EFC).
// Columns follow the glossary and the client Cost Report template
// (drive/SUMMARY.md): Budget, Actual, Commitment, Remaining Budget, ETC
// (editable per line), EFC, Variance, Var% (blank when Budget = 0), % Spent.
// The template's check rows are shown under the table: unmapped spend = 0,
// codes / budget lines / ETC lines not in the chart of accounts = 0.
// Data: public.get_cost_report_detail (db/pending/180). Export: the page's
// branded Excel / PDF (useReportExport).
// =====================================================================
import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Panel } from "@/components/AppShell";
import { formatUSD, useStore } from "@/lib/store";
import { convertForDisplay, displayCurrencyCode } from "@/lib/money-display";
import { useSeriesBudget } from "@/lib/series-budget";
import type { ReportColumn, ReportSection } from "@/lib/export/xlsx-report";
import { useReportExport } from "@/features/reports/report-export";
import {
  COST_CATEGORIES,
  COST_GROUPINGS,
  categoryOfCode,
  costReportChecks,
  costReportTotals,
  filterCostRows,
  groupCostReport,
  useCostReportRows,
  useSaveEtc,
  variancePct,
  varianceTone,
  type CostCategory,
  type CostGroupRow,
  type CostGrouping,
} from "@/lib/cost-report";

const COLS = ["budget", "actual", "commitment", "remaining", "etc", "efc", "variance"] as const;

/** R10: colour by meaning — green saving, red overrun, grey zero / unallocated. */
export const toneCls = (v: number) => {
  const t = varianceTone(v);
  return t === "saving"
    ? "text-success"
    : t === "overrun"
      ? "text-destructive"
      : "text-muted-foreground";
};
const pct = (v: number | null) => (v == null ? "" : `${v.toFixed(1)}%`);
const dm = (n: number) => convertForDisplay(Number(n) || 0, 2);

export function CostReportPanel({ initialGrouping = "line" }: { initialGrouping?: CostGrouping }) {
  const { t } = useTranslation();
  const projectId = useStore((s) => s.activeProjectId);
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  const orgId = project?.organizationId ?? null;
  const [grouping, setGrouping] = useState<CostGrouping>(initialGrouping);
  const [category, setCategory] = useState<CostCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);
  useEffect(() => setGrouping(initialGrouping), [initialGrouping]);

  const q = useCostReportRows(projectId);
  const saveEtc = useSaveEtc(projectId, orgId);
  const series = useSeriesBudget();

  const all = useMemo(() => q.data ?? [], [q.data]);
  const filtered = useMemo(
    () => filterCostRows(all, { category, search, hideEmpty }),
    [all, category, search, hideEmpty],
  );
  const catLabel = (c: CostCategory) => t(`reconcile.cost.category.${c}`);
  const groups = useMemo(
    () =>
      groupCostReport(filtered, grouping, {
        unassigned: t("glossary.cost.unassigned"),
        category: catLabel,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, grouping, t],
  );
  const totals = useMemo(() => costReportTotals(groups), [groups]);
  const checks = useMemo(() => costReportChecks(all), [all]);
  const allTotals = useMemo(() => costReportTotals(groupCostReport(all, "category")), [all]);
  // line view: header account + category of each code
  const metaByCode = useMemo(() => {
    const m = new Map<string, { header: string; category: CostCategory }>();
    for (const r of all)
      if (r.budgetCode)
        m.set(r.budgetCode, {
          header: r.topsheetCode ?? "",
          category: categoryOfCode(r.budgetCode, r.group),
        });
    return m;
  }, [all]);

  const episodes = series.isSeries ? series.bySeason.reduce((a, s) => a + s.episodes.length, 0) : 0;
  const fx = Number(project?.fxRate) || null;

  const checkLabel = (k: string) => t(`reconcile.cost.check.${k}`);
  const head = (k: string) => t(`glossary.term.${k}`);
  const firstCol =
    grouping === "category" ? t("glossary.cost.categoryCol") : t("glossary.cost.codeCol");

  useReportExport(() => {
    if (q.isLoading) return null;
    const cur = displayCurrencyCode();
    const money = (label: string): ReportColumn => ({ header: `${label} (${cur})`, type: "money" });
    const lineView = grouping === "line";
    const columns: ReportColumn[] = [
      ...(lineView ? [{ header: t("reconcile.cost.headerAcct") }] : []),
      { header: firstCol },
      { header: t("glossary.cost.nameCol") },
      ...(lineView ? [{ header: t("glossary.cost.categoryCol") }] : []),
      ...COLS.map((k) => money(head(k))),
      { header: t("reconcile.cost.varPct"), type: "percent" as const },
      { header: head("pctSpent"), type: "percent" as const },
    ];
    const rowOf = (g: CostGroupRow) => {
      const meta = g.code ? metaByCode.get(g.code) : undefined;
      return [
        ...(lineView ? [meta?.header ?? ""] : []),
        g.code ?? "",
        g.label,
        ...(lineView ? [meta ? catLabel(meta.category) : ""] : []),
        ...COLS.map((k) => dm(g[k])),
        variancePct(g.variance, g.budget),
        g.pctSpent,
      ];
    };
    const blank = lineView ? 2 : 0;
    const summary: ReportSection = {
      title: t("reconcile.cost.categorySummary"),
      columns: [
        { header: t("glossary.cost.categoryCol") },
        ...COLS.map((k) => money(head(k))),
        { header: t("reconcile.cost.varPct"), type: "percent" },
      ],
      rows: groupCostReport(all, "category", {
        unassigned: t("glossary.cost.unassigned"),
        category: catLabel,
      }).map((g) => [g.label, ...COLS.map((k) => dm(g[k])), variancePct(g.variance, g.budget)]),
      totals: [
        [
          t("glossary.cost.total"),
          ...COLS.map((k) => dm(allTotals[k])),
          variancePct(allTotals.variance, allTotals.budget),
        ],
      ],
    };
    return {
      doc: {
        report: "Cost Report",
        title: t("glossary.cost.title"),
        subtitle: `${t(`glossary.cost.by.${grouping}`)} · ${t("exports.currency")}: ${cur}`,
        sections: [
          {
            title: t("reconcile.cost.keyFigures"),
            columns: [{ header: t("reconcile.cost.figure") }, { header: "", type: "number" }],
            rows: [
              [`${head("budget")} (${cur})`, dm(allTotals.budget)],
              [`${head("efc")} (${cur})`, dm(allTotals.efc)],
              [`${head("variance")} (${cur})`, dm(allTotals.variance)],
              ...(fx ? [[t("reconcile.cost.fx"), fx]] : []),
              ...(episodes
                ? [
                    [t("reconcile.cost.episodes"), episodes],
                    [
                      `${t("reconcile.cost.costPerEpisode")} (${cur})`,
                      dm(allTotals.efc / episodes),
                    ],
                  ]
                : []),
            ],
          },
          summary,
          {
            title: t("reconcile.cost.checks"),
            columns: [
              { header: t("reconcile.cost.check.col") },
              { header: "", type: "number" },
              { header: t("reconcile.cost.check.status") },
            ],
            rows: checks.map((c) => [
              checkLabel(c.key),
              c.unit === "money" ? dm(c.value) : c.value,
              c.ok == null ? "" : c.ok ? "OK" : "CHECK",
            ]),
          },
          {
            title: t(`glossary.cost.by.${grouping}`),
            columns,
            rows: groups.map(rowOf),
            totals: [
              [
                t("glossary.cost.total"),
                ...Array(blank + 1).fill(""),
                ...COLS.map((k) => dm(totals[k])),
                variancePct(totals.variance, totals.budget),
                totals.pctSpent,
              ],
            ],
          },
        ],
      },
    };
  });

  const colSpanLead = grouping === "line" ? 4 : 2;

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t("glossary.cost.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("glossary.cost.subtitle")}</p>
        </div>
        <div
          role="tablist"
          aria-label={t("glossary.cost.groupBy")}
          className="inline-flex rounded-full border border-border bg-surface p-0.5"
        >
          {COST_GROUPINGS.map((g) => (
            <button
              key={g}
              role="tab"
              aria-selected={grouping === g}
              onClick={() => setGrouping(g)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                grouping === g ? "bg-brand text-brand-foreground" : "text-muted-foreground"
              }`}
            >
              {t(`glossary.cost.by.${g}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label={head("budget")} value={formatUSD(allTotals.budget)} />
        <Figure label={head("efc")} value={formatUSD(allTotals.efc)} />
        <Figure
          label={head("variance")}
          value={formatUSD(allTotals.variance)}
          cls={toneCls(allTotals.variance)}
        />
        {episodes > 0 ? (
          <Figure
            label={t("reconcile.cost.costPerEpisode")}
            value={formatUSD(allTotals.efc / episodes)}
            hint={t("reconcile.cost.episodesCount", { count: episodes })}
          />
        ) : (
          <Figure label={t("reconcile.cost.fx")} value={fx ? String(fx) : "—"} />
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("glossary.cost.categoryCol")}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CostCategory | "all")}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            <option value="all">{t("reconcile.cost.allCategories")}</option>
            {COST_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {catLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("reconcile.common.search")}
          <input
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("reconcile.cost.searchHint")}
            className="h-9 w-56 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </label>
        <label className="flex h-9 items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(e) => setHideEmpty(e.target.checked)}
          />
          {t("glossary.cost.hideZero")}
        </label>
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : q.error ? (
        <p className="py-6 text-sm text-destructive">{(q.error as Error).message}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="app-table w-full">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  {grouping === "line" && <Th>{t("reconcile.cost.headerAcct")}</Th>}
                  <Th>{firstCol}</Th>
                  <Th>{t("glossary.cost.nameCol")}</Th>
                  {grouping === "line" && <Th>{t("glossary.cost.categoryCol")}</Th>}
                  {COLS.map((k) => (
                    <Th key={k} end>
                      {head(k)}
                    </Th>
                  ))}
                  <Th end>{t("reconcile.cost.varPct")}</Th>
                  <Th end>{head("pctSpent")}</Th>
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 ? (
                  <tr>
                    <td
                      colSpan={COLS.length + colSpanLead + 2}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      {t("glossary.cost.empty")}
                    </td>
                  </tr>
                ) : (
                  groups.map((g) => (
                    <CostRow
                      key={g.key}
                      row={g}
                      grouping={grouping}
                      meta={g.code ? metaByCode.get(g.code) : undefined}
                      catLabel={catLabel}
                      onSaveEtc={async (v) => {
                        try {
                          await saveEtc(g.code!, v);
                          toast.success(t("glossary.cost.etcSaved"));
                        } catch (e: any) {
                          toast.error(e?.message ?? t("glossary.cost.etcFailed"));
                        }
                      }}
                    />
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <td className="px-3 py-2" colSpan={colSpanLead}>
                    {t("glossary.cost.total")}
                  </td>
                  {COLS.map((k) => (
                    <td
                      key={k}
                      className={`px-3 py-2 text-end tabular-nums ${k === "variance" ? toneCls(totals.variance) : ""}`}
                    >
                      {formatUSD(totals[k])}
                    </td>
                  ))}
                  <td className={`px-3 py-2 text-end tabular-nums ${toneCls(totals.variance)}`}>
                    {pct(variancePct(totals.variance, totals.budget))}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{pct(totals.pctSpent)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t("glossary.cost.legend")}</p>

          <div className="mt-5">
            <h4 className="mb-2 text-sm font-semibold">{t("reconcile.cost.checks")}</h4>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {checks.map((c) => (
                <li
                  key={c.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    {c.ok === true && <CheckCircle2 className="size-4 text-success" />}
                    {c.ok === false && <AlertTriangle className="size-4 text-destructive" />}
                    {checkLabel(c.key)}
                  </span>
                  <span
                    dir="ltr"
                    className={`tabular-nums ${c.ok === false ? "font-semibold text-destructive" : ""}`}
                  >
                    {c.unit === "money" ? formatUSD(c.value) : c.value}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">{t("reconcile.cost.checksHint")}</p>
          </div>
        </>
      )}

      {series.isSeries && <SeriesAllocations budget={allTotals.budget} />}
    </Panel>
  );
}

function Th({ children, end }: { children: React.ReactNode; end?: boolean }) {
  return (
    <th
      className={`px-3 py-2 text-xs font-medium uppercase tracking-wider ${end ? "text-end" : "text-start"}`}
    >
      {children}
    </th>
  );
}

function Figure({
  label,
  value,
  cls = "",
  hint,
}: {
  label: string;
  value: string;
  cls?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div dir="ltr" className={`mt-1 text-lg font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function CostRow({
  row,
  grouping,
  meta,
  catLabel,
  onSaveEtc,
}: {
  row: CostGroupRow;
  grouping: CostGrouping;
  meta?: { header: string; category: CostCategory };
  catLabel: (c: CostCategory) => string;
  onSaveEtc: (v: number | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const editable = grouping === "line" && row.editable;
  const commit = async () => {
    if (draft == null) return;
    const v = draft.trim() === "" ? null : Number(draft);
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      toast.error(t("glossary.cost.etcInvalid"));
      return;
    }
    await onSaveEtc(v);
    setDraft(null);
  };
  const unassigned = row.code == null;
  return (
    <tr className="border-b border-border hover:bg-muted">
      {grouping === "line" && (
        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{meta?.header || "—"}</td>
      )}
      <td className="px-3 py-2 font-mono text-xs">{row.code ?? "—"}</td>
      <td className={`px-3 py-2 ${unassigned ? "text-muted-foreground italic" : ""}`}>
        {row.label}
      </td>
      {grouping === "line" && (
        <td className="px-3 py-2 text-xs">{meta ? catLabel(meta.category) : "—"}</td>
      )}
      {COLS.map((k) =>
        k === "etc" && editable ? (
          <td key={k} className="px-3 py-1 text-end">
            <input
              type="number"
              min="0"
              step="0.01"
              dir="ltr"
              aria-label={t("glossary.cost.etcEdit", { code: row.code })}
              title={row.etcIsManual ? t("glossary.cost.etcManual") : t("glossary.cost.etcDefault")}
              value={draft ?? String(row.etc)}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commit();
                if (e.key === "Escape") setDraft(null);
              }}
              className={`w-28 rounded border px-2 py-1 text-end text-sm tabular-nums bg-surface ${
                row.etcIsManual ? "border-brand/60" : "border-border"
              }`}
            />
          </td>
        ) : (
          <td
            key={k}
            className={`px-3 py-2 text-end tabular-nums ${
              k === "variance"
                ? toneCls(row.variance)
                : Math.abs(row[k]) < 0.005
                  ? "text-muted-foreground"
                  : ""
            }`}
          >
            {formatUSD(row[k])}
          </td>
        ),
      )}
      <td className={`px-3 py-2 text-end tabular-nums ${toneCls(row.variance)}`}>
        {pct(variancePct(row.variance, row.budget))}
      </td>
      <td className="px-3 py-2 text-end tabular-nums">{pct(row.pctSpent)}</td>
    </tr>
  );
}

/** Series: budget allocated to seasons / episodes (was under the Final Report). */
function SeriesAllocations({ budget }: { budget: number }) {
  const { t } = useTranslation();
  const series = useSeriesBudget();
  const projectId = useStore((s) => s.activeProjectId);
  // the season filter is remembered per project in this browser (as before)
  const key = projectId ? `kwalis.seasonFilter.${projectId}` : null;
  const [season, setSeasonState] = useState("all");
  useEffect(() => {
    if (!key) return;
    try {
      setSeasonState(localStorage.getItem(key) || "all");
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  const setSeason = (v: string) => {
    setSeasonState(v);
    try {
      if (key) localStorage.setItem(key, v);
    } catch {
      /* storage unavailable */
    }
  };
  const shown =
    season === "all" ? series.bySeason : series.bySeason.filter((s) => s.season.id === season);
  const allocated = shown.reduce((a, s) => a + s.allocated, 0);
  const eps = shown.reduce((a, s) => a + s.episodes.length, 0);
  const unallocated = budget - allocated;
  const share = (v: number) => (budget > 0 ? `${((v / budget) * 100).toFixed(1)}%` : "—");
  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("reconcile.series.title", { seasons: shown.length, episodes: eps })}
        </h4>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("reports.filter_by_season")}
          <select
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1 text-foreground"
          >
            <option value="all">{t("reports.all_seasons")}</option>
            {series.bySeason.map(({ season: s }) => (
              <option key={s.id} value={s.id}>
                S{s.season_number} — {s.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="app-table w-full">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <Th>{t("reconcile.series.season")}</Th>
              <Th end>{t("reconcile.series.episodes")}</Th>
              <Th end>{t("reconcile.series.allocated")}</Th>
              <Th end>{t("reconcile.series.share")}</Th>
              <Th end>{t("reconcile.series.perEpisode")}</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ season: s, episodes, allocated: a }) => (
              <Fragment key={s.id}>
                <tr className="border-b border-border hover:bg-muted">
                  <td className="px-3 py-2">
                    <Link
                      to="/series/$seasonId"
                      params={{ seasonId: s.id }}
                      className="text-brand hover:underline"
                    >
                      S{s.season_number} — {s.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{episodes.length}</td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {a > 0 ? (
                      formatUSD(a)
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("reconcile.series.unallocated")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{share(a)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {formatUSD(episodes.length > 0 ? a / episodes.length : 0)}
                  </td>
                </tr>
              </Fragment>
            ))}
            <tr className="bg-surface-2 font-semibold">
              <td className="px-3 py-2">{t("reports.total_allocated")}</td>
              <td className="px-3 py-2 text-end tabular-nums">{eps}</td>
              <td className="px-3 py-2 text-end tabular-nums">{formatUSD(allocated)}</td>
              <td className="px-3 py-2 text-end tabular-nums">{share(allocated)}</td>
              <td className="px-3 py-2 text-end tabular-nums">
                {formatUSD(eps > 0 ? allocated / eps : 0)}
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2 font-semibold">{t("reconcile.series.unallocatedBudget")}</td>
              <td colSpan={3} />
              {/* R10: unallocated budget is not a saving — grey; over-allocation is red */}
              <td
                className={`px-3 py-2 text-end font-semibold tabular-nums ${
                  unallocated < -0.005 ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {formatUSD(unallocated)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CostReportPanel;
