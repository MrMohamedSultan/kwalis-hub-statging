// =====================================================================
// Cost Report (R06 / R07, decision 5) — GL Report, By GL Account and Final
// Report as ONE report with a grouping switch: by line / by account / by
// category. Columns follow the glossary: Budget, Actual, Commitment,
// Remaining Budget, ETC (editable per line), EFC, Variance, % Spent.
// Data: public.get_cost_report_detail (db/pending/180).
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Panel } from "@/components/AppShell";
import { formatUSD, useStore } from "@/lib/store";
import { downloadCSV } from "@/lib/export-csv";
import {
  COST_GROUPINGS,
  costReportTotals,
  groupCostReport,
  useCostReportRows,
  useSaveEtc,
  type CostCategory,
  type CostGroupRow,
  type CostGrouping,
} from "@/lib/cost-report";

const COLS = ["budget", "actual", "commitment", "remaining", "etc", "efc", "variance"] as const;

export function CostReportPanel({ initialGrouping = "line" }: { initialGrouping?: CostGrouping }) {
  const { t } = useTranslation();
  const projectId = useStore((s) => s.activeProjectId);
  const orgId = useStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.organizationId ?? null,
  );
  const [grouping, setGrouping] = useState<CostGrouping>(initialGrouping);
  const [hideZero, setHideZero] = useState(true);
  useEffect(() => setGrouping(initialGrouping), [initialGrouping]);

  const q = useCostReportRows(projectId);
  const saveEtc = useSaveEtc(projectId, orgId);

  const groups = useMemo(
    () =>
      groupCostReport(q.data ?? [], grouping, {
        unassigned: t("glossary.cost.unassigned"),
        category: (c: CostCategory) => t(`glossary.cost.category.${c}`),
      }),
    [q.data, grouping, t],
  );
  const visible = useMemo(
    () =>
      hideZero
        ? groups.filter((g) => COLS.some((k) => Math.abs(g[k]) >= 0.005) || g.paidToDate !== 0)
        : groups,
    [groups, hideZero],
  );
  const totals = useMemo(() => costReportTotals(groups), [groups]);

  const exportCsv = () => {
    const head = (k: string) => t(`glossary.term.${k}`);
    downloadCSV(
      `cost-report-${grouping}-${new Date().toISOString().slice(0, 10)}`,
      [...visible, { ...totals, code: "", label: t("glossary.cost.total") }].map((g) => ({
        [t("glossary.cost.codeCol")]: g.code ?? "",
        [t("glossary.cost.nameCol")]: g.label,
        [head("budget")]: g.budget,
        [head("actual")]: g.actual,
        [head("commitment")]: g.commitment,
        [head("remaining")]: g.remaining,
        [head("etc")]: g.etc,
        [head("efc")]: g.efc,
        [head("variance")]: g.variance,
        [head("pctSpent")]: g.pctSpent ?? "",
        [head("paid")]: g.paidToDate,
        [head("payable")]: g.payable,
      })),
    );
  };

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t("glossary.cost.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("glossary.cost.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={hideZero}
              onChange={(e) => setHideZero(e.target.checked)}
            />
            {t("glossary.cost.hideZero")}
          </label>
          <button
            onClick={exportCsv}
            disabled={!visible.length}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-40"
          >
            <Download className="size-3.5" /> {t("glossary.export.csv")}
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : q.error ? (
        <p className="py-6 text-sm text-destructive">{(q.error as Error).message}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="app-table w-full">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-start text-xs font-medium uppercase tracking-wider">
                  {grouping === "category"
                    ? t("glossary.cost.categoryCol")
                    : t("glossary.cost.codeCol")}
                </th>
                <th className="px-3 py-2 text-start text-xs font-medium uppercase tracking-wider">
                  {t("glossary.cost.nameCol")}
                </th>
                {COLS.map((k) => (
                  <th
                    key={k}
                    className="px-3 py-2 text-end text-xs font-medium uppercase tracking-wider"
                  >
                    {t(`glossary.term.${k}`)}
                  </th>
                ))}
                <th className="px-3 py-2 text-end text-xs font-medium uppercase tracking-wider">
                  {t("glossary.term.pctSpent")}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLS.length + 3}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    {t("glossary.cost.empty")}
                  </td>
                </tr>
              ) : (
                visible.map((g) => (
                  <CostRow
                    key={g.key}
                    row={g}
                    grouping={grouping}
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
                <td className="px-3 py-2" colSpan={2}>
                  {t("glossary.cost.total")}
                </td>
                {COLS.map((k) => (
                  <td
                    key={k}
                    className={`px-3 py-2 text-end tabular-nums ${k === "variance" ? toneOf(totals.variance) : ""}`}
                  >
                    {formatUSD(totals[k])}
                  </td>
                ))}
                <td className="px-3 py-2 text-end tabular-nums">{pct(totals.pctSpent)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">{t("glossary.cost.legend")}</p>
        </div>
      )}
    </Panel>
  );
}

const toneOf = (v: number) => (v < -0.005 ? "text-destructive" : v > 0.005 ? "text-success" : "");
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

function CostRow({
  row,
  grouping,
  onSaveEtc,
}: {
  row: CostGroupRow;
  grouping: CostGrouping;
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
  return (
    <tr className="border-b border-border hover:bg-muted">
      <td className="px-3 py-2 font-mono text-xs">{row.code ?? "—"}</td>
      <td className="px-3 py-2">{row.label}</td>
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
            className={`px-3 py-2 text-end tabular-nums ${k === "variance" ? toneOf(row.variance) : ""}`}
          >
            {formatUSD(row[k])}
          </td>
        ),
      )}
      <td className="px-3 py-2 text-end tabular-nums">{pct(row.pctSpent)}</td>
    </tr>
  );
}

export default CostReportPanel;
