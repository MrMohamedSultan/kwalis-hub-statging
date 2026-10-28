// =====================================================================
// Company Overhead (R25 / D16, decision 14) — replaces "GOSI & Localization".
// Company employees (monthly cost incl. the company GOSI share × allocation
// × months), office rent share, company equipment share. Never enters the
// ledger, payments or cash. Details and changes: Edit on "reports" only.
// =====================================================================
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Panel } from "@/components/AppShell";
import { formatDate } from "@/lib/date-format";
import { usePermissions } from "@/lib/permissions/usePermissions";
import { useProjectLock } from "@/lib/project-lock";
import { useReportExport } from "@/features/reports/report-export";
import { useActiveProject } from "@/features/reports/ledger/ledger-data";
import {
  Money,
  StateLine,
  numCls,
  thCls,
  thNumCls,
  txtCls,
} from "@/features/reports/ledger/ledger-ui";
import {
  OVERHEAD_KINDS,
  overheadTotals,
  type OverheadKind,
  type OverheadLine,
} from "./overhead-calc";
import { useCompanyOverhead, useOverheadMutations } from "./overhead-data";
import { CompanyEmployeeDialog, OverheadItemDialog } from "./OverheadForms";

export function CompanyOverheadReport() {
  const { t } = useTranslation();
  const { projectId, organizationId } = useActiveProject();
  const q = useCompanyOverhead(projectId);
  const m = useOverheadMutations(projectId, organizationId);
  const perms = usePermissions();
  const { locked } = useProjectLock();
  const canEdit = perms.canEdit("reports") && !locked;
  const [dialog, setDialog] = useState<null | OverheadKind>(null);
  const lines = useMemo(() => q.data ?? [], [q.data]);
  const totals = useMemo(() => overheadTotals(lines), [lines]);
  const kindLabel = (k: OverheadKind) => t(`taxlive.oh.kind.${k}`);
  const basisText = (l: OverheadLine) =>
    l.basis === "pct_budget"
      ? t("taxlive.oh.pctText", { pct: l.pct_of_budget ?? 0 })
      : l.monthly_amount == null
        ? t("taxlive.oh.hidden")
        : t("taxlive.oh.monthlyText", {
            amount: l.monthly_amount.toFixed(2),
            pct: l.allocation_pct,
          });

  const head = [
    t("taxlive.oh.col.type"),
    t("taxlive.oh.col.label"),
    t("taxlive.oh.col.basis"),
    t("taxlive.oh.col.period"),
    t("taxlive.oh.col.months"),
    t("taxlive.oh.col.budgetLine"),
  ];

  useReportExport(() =>
    q.isLoading
      ? null
      : {
          doc: {
            report: "Company Overhead",
            title: t("taxlive.oh.title"),
            subtitle: `${t("exports.currency")}: SAR`,
            sections: [
              {
                columns: [
                  { header: head[0] },
                  { header: head[1] },
                  { header: head[2] },
                  { header: t("taxlive.oh.col.start"), type: "date" },
                  { header: t("taxlive.oh.col.end"), type: "date" },
                  { header: head[4], type: "number" },
                  { header: head[5] },
                  { header: t("taxlive.oh.col.amount"), type: "money" },
                ],
                rows: lines.map((l) => [
                  kindLabel(l.kind),
                  l.label,
                  basisText(l),
                  l.start_date,
                  l.end_date,
                  l.months,
                  l.budgeted ? l.budget_code : t("taxlive.oh.unbudgeted"),
                  l.amount,
                ]),
                totals: [
                  [
                    t("taxlive.oh.unbudgetedTotal"),
                    "",
                    "",
                    null,
                    null,
                    null,
                    "",
                    totals.unbudgeted,
                  ],
                  [t("taxlive.common.total"), "", "", null, null, null, "", totals.total],
                  [
                    t("taxlive.oh.pctOfBudget"),
                    "",
                    "",
                    null,
                    null,
                    null,
                    "",
                    totals.pctOfBudget == null ? null : `${totals.pctOfBudget}%`,
                  ],
                ],
              },
            ],
          },
        },
  );

  const remove = async (l: OverheadLine) => {
    if (
      !confirm(
        t("taxlive.oh.removeConfirm", { name: l.label, interpolation: { escapeValue: false } }),
      )
    )
      return;
    try {
      await m.remove(l.kind, l.id);
      toast.success(t("taxlive.oh.removed"));
    } catch (e: any) {
      toast.error(e?.message ?? t("taxlive.common.saveFailed"));
    }
  };

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t("taxlive.oh.title")}</h3>
          <p className="max-w-3xl text-xs text-muted-foreground">{t("taxlive.oh.hint")}</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {OVERHEAD_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setDialog(k)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                <Plus className="size-3.5" /> {t(`taxlive.oh.add.${k}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {OVERHEAD_KINDS.map((k) => (
          <div key={k} className="rounded-xl border border-border bg-surface p-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {kindLabel(k)}
            </div>
            <div dir="ltr" className="mt-1 text-lg font-semibold tabular-nums">
              <Money v={totals.byKind[k]} />
            </div>
          </div>
        ))}
        <div className="rounded-xl border border-brand/40 bg-surface p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("taxlive.common.total")}
          </div>
          <div dir="ltr" className="mt-1 text-lg font-semibold tabular-nums text-brand">
            <Money v={totals.total} />
          </div>
          <div className="text-xs text-muted-foreground">
            {totals.pctOfBudget == null
              ? t("taxlive.oh.noBudget")
              : t("taxlive.oh.ofBudget", { pct: totals.pctOfBudget.toFixed(2) })}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("taxlive.oh.unbudgetedTotal")}
          </div>
          <div dir="ltr" className="mt-1 text-lg font-semibold tabular-nums text-warning">
            <Money v={totals.unbudgeted} />
          </div>
        </div>
      </div>

      <StateLine
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        empty={!q.isLoading && !q.error && lines.length === 0}
      />
      {!q.isLoading && !q.error && lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                {head.slice(0, 4).map((h) => (
                  <th key={h} className={thCls}>
                    {h}
                  </th>
                ))}
                <th className={thNumCls}>{head[4]}</th>
                <th className={thCls}>{head[5]}</th>
                <th className={thNumCls}>{t("taxlive.oh.col.amount")}</th>
                {canEdit && <th className={thCls} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr
                  key={`${l.kind}-${l.id}`}
                  className="border-b border-border/50 hover:bg-muted/50"
                >
                  <td className={txtCls}>{kindLabel(l.kind)}</td>
                  <td className={`${txtCls} font-medium`}>
                    {l.label}
                    {l.position && (
                      <span className="ms-1 text-xs text-muted-foreground">· {l.position}</span>
                    )}
                    {l.over_allocated && (
                      <span className="ms-1.5 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
                        {t("taxlive.oh.overAllocated")}
                      </span>
                    )}
                  </td>
                  <td className={`${txtCls} text-xs`}>{basisText(l)}</td>
                  <td className={`${txtCls} text-xs`}>
                    {l.start_date ? `${formatDate(l.start_date)} – ${formatDate(l.end_date)}` : "—"}
                  </td>
                  <td className={numCls}>{l.months == null ? "—" : l.months.toFixed(2)}</td>
                  <td className={txtCls}>
                    {l.budgeted ? (
                      <span className="font-mono text-xs">{l.budget_code}</span>
                    ) : (
                      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">
                        {t("taxlive.oh.unbudgeted")}
                      </span>
                    )}
                  </td>
                  <td className={`${numCls} font-semibold`}>
                    <Money v={l.amount} />
                  </td>
                  {canEdit && (
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        aria-label={t("taxlive.oh.remove")}
                        onClick={() => void remove(l)}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td colSpan={6} className="px-3 py-2 text-end">
                  {t("taxlive.common.total")}
                </td>
                <td className={numCls}>
                  <Money v={totals.total} />
                </td>
                {canEdit && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t("taxlive.oh.notCash")}</p>
      {!canEdit && (
        <p className="mt-1 text-xs text-muted-foreground">{t("taxlive.oh.restricted")}</p>
      )}

      {dialog === "staff" && <CompanyEmployeeDialog open onClose={() => setDialog(null)} />}
      {(dialog === "office_rent" || dialog === "equipment") && (
        <OverheadItemDialog open kind={dialog} onClose={() => setDialog(null)} />
      )}
    </Panel>
  );
}

export default CompanyOverheadReport;
