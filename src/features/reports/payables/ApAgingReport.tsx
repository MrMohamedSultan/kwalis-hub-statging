// =====================================================================
// AP Aging (N06): what is payable (Actual − Paid: approved instalments and
// unpaid invoice balances) by payee, aged on the due date in 0–30, 31–60,
// 61–90 and 90+ days. Not-yet-due amounts sit in 0–30.
// =====================================================================
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/AppShell";
import { riyadhToday } from "@/lib/date-format";
import { AGING_BUCKETS, apAging, relatedPartyPayees } from "@/lib/payables-reports";
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
import { useDueItems } from "./payables-data";

export function ApAgingReport() {
  const { t } = useTranslation();
  const { projectId } = useActiveProject();
  const q = useDueItems(projectId);
  const today = riyadhToday();
  const { rows, totals } = useMemo(() => apAging(q.data ?? [], today), [q.data, today]);
  // E08: flag payees with related-party invoices
  const related = useMemo(() => relatedPartyPayees(q.data ?? []), [q.data]);
  const bucket = (b: string) => t(`reconcile.aging.bucket.${b}`);

  useReportExport(() =>
    q.isLoading
      ? null
      : {
          doc: {
            report: "AP Aging",
            title: t("reconcile.tab.aging"),
            subtitle: `${t("reconcile.aging.asOf", { date: today })} · ${t("exports.currency")}: SAR`,
            sections: [
              {
                columns: [
                  { header: t("reconcile.aging.payee") },
                  { header: t("reconcile.aging.items"), type: "integer" },
                  ...AGING_BUCKETS.map((b) => ({
                    header: `${bucket(b)} (SAR)`,
                    type: "money" as const,
                  })),
                  { header: `${t("reconcile.common.total")} (SAR)`, type: "money" },
                ],
                rows: rows.map((r) => [
                  r.payee,
                  r.items,
                  ...AGING_BUCKETS.map((b) => r[b]),
                  r.total,
                ]),
                totals: [
                  [
                    t("reconcile.common.total"),
                    totals.items,
                    ...AGING_BUCKETS.map((b) => totals[b]),
                    totals.total,
                  ],
                ],
              },
            ],
          },
        },
  );

  return (
    <Panel>
      <div className="mb-4">
        <h3 className="text-lg font-semibold">{t("reconcile.tab.aging")}</h3>
        <p className="text-xs text-muted-foreground">{t("reconcile.aging.hint")}</p>
      </div>
      <StateLine
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        empty={!q.isLoading && !q.error && rows.length === 0}
      />
      {!q.isLoading && !q.error && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className={thCls}>{t("reconcile.aging.payee")}</th>
                <th className={thNumCls}>{t("reconcile.aging.items")}</th>
                {AGING_BUCKETS.map((b) => (
                  <th key={b} className={thNumCls}>
                    {bucket(b)}
                  </th>
                ))}
                <th className={thNumCls}>{t("reconcile.common.total")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.payee} className="border-b border-border/50 hover:bg-muted/50">
                  <td className={txtCls}>
                    {r.payee}
                    {related.has(r.payee) && (
                      <span className="ms-2 rounded-full border border-warning/40 bg-warning/15 px-1.5 text-[10px] text-warning">
                        {t("ap.related_party")}
                      </span>
                    )}
                  </td>
                  <td className={numCls}>{r.items}</td>
                  {AGING_BUCKETS.map((b) => (
                    <td
                      key={b}
                      className={`${numCls} ${b !== "0_30" && r[b] > 0 ? "text-destructive" : ""}`}
                    >
                      <Money v={r[b]} blankZero />
                    </td>
                  ))}
                  <td className={`${numCls} font-semibold`}>
                    <Money v={r.total} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className={txtCls}>{t("reconcile.common.total")}</td>
                <td className={numCls}>{totals.items}</td>
                {AGING_BUCKETS.map((b) => (
                  <td key={b} className={numCls}>
                    <Money v={totals[b]} />
                  </td>
                ))}
                <td className={numCls}>
                  <Money v={totals.total} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );
}
