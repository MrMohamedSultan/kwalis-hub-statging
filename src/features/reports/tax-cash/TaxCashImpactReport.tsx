// =====================================================================
// Tax Cash Impact (R23 / R24 / D14 / D15, decision 12) — replaces
// "Tax & VAT Compliance". The cash effect of WHT and VAT, not the return.
// =====================================================================
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Panel } from "@/components/AppShell";
import { formatDate, riyadhToday } from "@/lib/date-format";
import { useVatStandardRate } from "@/lib/ap-data";
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
import { buildWhtRows, summarizeVat, summarizeWht, WHT_BUDGET_CODE } from "./tax-cash-calc";
import { useTaxCashData } from "./tax-cash-data";

const STATUS_CLS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  due: "bg-warning/15 text-warning",
  overdue: "bg-destructive/15 text-destructive",
  remitted: "bg-success/15 text-success",
};

function Card({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div dir="ltr" className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? ""}`}>
        <Money v={value} />
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function TaxCashImpactReport() {
  const { t } = useTranslation();
  const { projectId } = useActiveProject();
  const q = useTaxCashData(projectId);
  const vatRate = useVatStandardRate();
  const today = riyadhToday();

  const whtRows = useMemo(
    () => buildWhtRows(q.data?.whtDocs ?? [], q.data?.movements.whtRemitted ?? 0, today),
    [q.data, today],
  );
  const wht = useMemo(() => summarizeWht(whtRows, q.data?.budget7099 ?? 0), [whtRows, q.data]);
  const vat = useMemo(
    () =>
      summarizeVat(
        q.data?.vatInvoices ?? [],
        {
          vatPaid: q.data?.movements.vatPaid ?? 0,
          vatRecovered: q.data?.movements.vatRecovered ?? 0,
        },
        q.data?.openCommitments ?? 0,
        vatRate,
      ),
    [q.data, vatRate],
  );

  const yes = t("taxlive.common.yes");
  const no = t("taxlive.common.no");
  const residency = (r: string | null) =>
    r ? t(`taxlive.tax.residency.${r}`) : t("taxlive.tax.residency.unknown");
  const treatment = (v: string) => t(`taxlive.tax.treatment.${v}`);
  const status = (s: string) => t(`taxlive.tax.status.${s}`);
  const kind = (k: string) => t(`taxlive.tax.kind.${k}`);
  const whtHead = [
    t("taxlive.tax.col.party"),
    t("taxlive.tax.col.document"),
    t("taxlive.tax.col.residency"),
    t("taxlive.tax.col.serviceType"),
    t("taxlive.tax.col.bearing"),
  ];

  useReportExport(() =>
    q.isLoading || !q.data
      ? null
      : {
          doc: {
            report: "Tax Cash Impact",
            title: t("taxlive.tax.title"),
            subtitle: `${t("exports.currency")}: SAR`,
            sections: [
              {
                title: t("taxlive.tax.whtTitle"),
                columns: [
                  { header: whtHead[0] },
                  { header: whtHead[1] },
                  { header: whtHead[2] },
                  { header: whtHead[3] },
                  { header: whtHead[4] },
                  { header: t("taxlive.tax.col.base"), type: "money" },
                  { header: t("taxlive.tax.col.rate"), type: "percent" },
                  { header: t("taxlive.tax.col.amount"), type: "money" },
                  { header: t("taxlive.tax.col.charged") },
                  { header: t("taxlive.tax.col.paymentDate"), type: "date" },
                  { header: t("taxlive.tax.col.dueDate"), type: "date" },
                  { header: t("taxlive.tax.col.status") },
                ],
                rows: whtRows.map((r) => [
                  r.party,
                  `${kind(r.kind)} ${r.ref}`,
                  residency(r.residency),
                  r.serviceType ?? "",
                  treatment(r.treatment),
                  r.base,
                  r.rate,
                  r.amount,
                  r.chargedToBudget ? yes : no,
                  r.lastPaymentDate,
                  r.dueDate,
                  status(r.status),
                ]),
                totals: [
                  [
                    t("taxlive.common.total"),
                    "",
                    "",
                    "",
                    "",
                    null,
                    null,
                    wht.total,
                    "",
                    null,
                    null,
                    "",
                  ],
                ],
              },
              {
                title: t("taxlive.tax.compareTitle"),
                columns: [{ header: t("taxlive.common.item") }, { header: "SAR", type: "money" }],
                rows: [
                  [t("taxlive.tax.companyBorne"), wht.companyBorne],
                  [t("taxlive.tax.budget7099"), wht.budget7099],
                  [t("taxlive.tax.over7099"), wht.over7099],
                  [t("taxlive.tax.onOtherLines"), wht.companyBorneOnOtherLines],
                ],
              },
              {
                title: t("taxlive.tax.vatTitle"),
                columns: [
                  { header: t("taxlive.tax.col.month") },
                  { header: t("taxlive.tax.vatInputPaid"), type: "money" },
                  { header: t("taxlive.tax.reverseCharge"), type: "money" },
                ],
                rows: vat.months.map((m) => [m.month, m.inputPaid, m.reverseCharge]),
                totals: [[t("taxlive.common.total"), vat.inputPaid, vat.reverseCharge]],
              },
              {
                title: t("taxlive.tax.vatSummary"),
                columns: [{ header: t("taxlive.common.item") }, { header: "SAR", type: "money" }],
                rows: [
                  [t("taxlive.tax.vatInputBooked"), vat.inputBooked],
                  [t("taxlive.tax.vatInputPaid"), vat.inputPaid],
                  [t("taxlive.tax.vatRecovered"), vat.recovered],
                  [t("taxlive.tax.vatPending"), vat.pendingRecovery],
                  [t("taxlive.tax.vatPaidZatca"), vat.paidToZatca],
                  [t("taxlive.tax.vatForecast", { rate: vatRate }), vat.forecastOnCommitments],
                  [t("taxlive.tax.reverseCharge"), vat.reverseCharge],
                ],
              },
            ],
          },
        },
  );

  return (
    <div className="space-y-5">
      <StateLine
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        empty={false}
      />
      {q.data && (
        <>
          <Panel>
            <div className="mb-3">
              <h3 className="text-lg font-semibold">{t("taxlive.tax.whtTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("taxlive.tax.whtHint")}</p>
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card
                label={t("taxlive.tax.whtTotal")}
                value={wht.total}
                hint={t("taxlive.tax.whtTotalHint")}
              />
              <Card label={t("taxlive.tax.whtWithheld")} value={wht.withheld} />
              <Card label={t("taxlive.tax.whtRemitted")} value={wht.remitted} tone="text-success" />
              <Card
                label={t("taxlive.tax.whtOutstanding")}
                value={wht.outstanding}
                tone={wht.overdue > 0 ? "text-destructive" : "text-warning"}
                hint={
                  wht.overdue > 0
                    ? t("taxlive.tax.whtOverdueHint", { amount: wht.overdue.toFixed(2) })
                    : undefined
                }
              />
            </div>
            {whtRows.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{t("taxlive.tax.noWht")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      {whtHead.map((h) => (
                        <th key={h} className={thCls}>
                          {h}
                        </th>
                      ))}
                      <th className={thNumCls}>{t("taxlive.tax.col.base")}</th>
                      <th className={thNumCls}>{t("taxlive.tax.col.rate")}</th>
                      <th className={thNumCls}>{t("taxlive.tax.col.amount")}</th>
                      <th className={thCls}>{t("taxlive.tax.col.charged")}</th>
                      <th className={thCls}>{t("taxlive.tax.col.paymentDate")}</th>
                      <th className={thCls}>{t("taxlive.tax.col.dueDate")}</th>
                      <th className={thCls}>{t("taxlive.tax.col.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {whtRows.map((r) => (
                      <tr
                        key={`${r.kind}-${r.id}`}
                        className="border-b border-border/50 hover:bg-muted/50"
                      >
                        <td className={`${txtCls} font-medium`}>{r.party}</td>
                        <td className={txtCls}>
                          <span className="text-muted-foreground">{kind(r.kind)}</span>{" "}
                          <span className="font-mono text-xs">{r.ref}</span>
                        </td>
                        <td className={txtCls}>{residency(r.residency)}</td>
                        <td className={txtCls}>{r.serviceType ?? "—"}</td>
                        <td className={txtCls}>{treatment(r.treatment)}</td>
                        <td className={numCls}>
                          <Money v={r.base} />
                        </td>
                        <td className={numCls}>{r.rate.toFixed(2)}%</td>
                        <td className={`${numCls} font-semibold`}>
                          <Money v={r.amount} />
                        </td>
                        <td className={txtCls}>{r.chargedToBudget ? yes : no}</td>
                        <td className={txtCls}>
                          {r.lastPaymentDate ? formatDate(r.lastPaymentDate) : "—"}
                        </td>
                        <td className={txtCls}>{r.dueDate ? formatDate(r.dueDate) : "—"}</td>
                        <td className={txtCls}>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLS[r.status]}`}
                          >
                            {status(r.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border font-semibold">
                      <td colSpan={7} className="px-3 py-2 text-end">
                        {t("taxlive.common.total")}
                      </td>
                      <td className={numCls}>
                        <Money v={wht.total} />
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Panel>

          <Panel>
            <h3 className="mb-1 text-lg font-semibold">{t("taxlive.tax.compareTitle")}</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("taxlive.tax.compareHint", { code: WHT_BUDGET_CODE })}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card label={t("taxlive.tax.companyBorne")} value={wht.companyBorne} />
              <Card label={t("taxlive.tax.budget7099")} value={wht.budget7099} />
              <Card
                label={t("taxlive.tax.over7099")}
                value={wht.over7099}
                tone={wht.over7099 > 0 ? "text-destructive" : "text-success"}
              />
            </div>
            {wht.companyBorneOnOtherLines > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {t("taxlive.tax.openDecision", {
                    amount: wht.companyBorneOnOtherLines.toFixed(2),
                    code: WHT_BUDGET_CODE,
                  })}
                </span>
              </div>
            )}
          </Panel>

          <Panel>
            <div className="mb-3">
              <h3 className="text-lg font-semibold">{t("taxlive.tax.vatTitle")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("taxlive.tax.vatHint", {
                  standard: vat.standardCount,
                  exempt: vat.exemptCount,
                  zero: vat.zeroRatedCount,
                })}
              </p>
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Card
                label={t("taxlive.tax.vatInputPaid")}
                value={vat.inputPaid}
                hint={t("taxlive.tax.vatUnpaidHint", { amount: vat.inputUnpaid.toFixed(2) })}
              />
              <Card
                label={t("taxlive.tax.vatRecovered")}
                value={vat.recovered}
                tone="text-success"
              />
              <Card
                label={t("taxlive.tax.vatPending")}
                value={vat.pendingRecovery}
                tone="text-warning"
              />
              <Card label={t("taxlive.tax.vatPaidZatca")} value={vat.paidToZatca} />
              <Card
                label={t("taxlive.tax.vatForecast", { rate: vatRate })}
                value={vat.forecastOnCommitments}
                hint={t("taxlive.tax.vatForecastHint")}
              />
              <Card
                label={t("taxlive.tax.reverseCharge")}
                value={vat.reverseCharge}
                hint={t("taxlive.tax.reverseChargeHint")}
              />
            </div>
            {vat.months.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      <th className={thCls}>{t("taxlive.tax.col.month")}</th>
                      <th className={thNumCls}>{t("taxlive.tax.vatInputPaid")}</th>
                      <th className={thNumCls}>{t("taxlive.tax.reverseCharge")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vat.months.map((m) => (
                      <tr key={m.month} className="border-b border-border/50">
                        <td className={`${txtCls} font-mono`}>{m.month}</td>
                        <td className={numCls}>
                          <Money v={m.inputPaid} blankZero />
                        </td>
                        <td className={numCls}>
                          <Money v={m.reverseCharge} blankZero />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel>
            <h3 className="mb-1 text-lg font-semibold">{t("taxlive.tax.cashTitle")}</h3>
            <p className="mb-3 text-xs text-muted-foreground">{t("taxlive.tax.cashHint")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card label={t("taxlive.tax.vatPaidZatca")} value={-q.data.movements.vatPaid} />
              <Card label={t("taxlive.tax.vatRecovered")} value={q.data.movements.vatRecovered} />
              <Card label={t("taxlive.tax.whtRemitted")} value={-q.data.movements.whtRemitted} />
            </div>
            <Link
              to="/funding"
              className="mt-3 inline-block text-xs font-semibold text-brand underline decoration-dotted"
            >
              {t("taxlive.tax.openFunding")}
            </Link>
          </Panel>
        </>
      )}
    </div>
  );
}

export default TaxCashImpactReport;
