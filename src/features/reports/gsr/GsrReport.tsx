// =====================================================================
// GSR — Global Spend Report (N03, decision 15): payments by the country of
// the payee's bank, stored on each payment at payment time.
// Data: public.get_gsr_payments (db/pending/198). Template sections: by
// country (with drill-down), by tag, country × type, Saudi vs outside.
// =====================================================================
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Panel } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/date-format";
import { formatAmount } from "@/lib/format-number";
import { useReportExport } from "@/features/reports/report-export";
import { useActiveProject } from "@/features/reports/ledger/ledger-data";
import {
  Money,
  PeriodFilter,
  StateLine,
  numCls,
  thCls,
  thNumCls,
  txtCls,
} from "@/features/reports/ledger/ledger-ui";
import { buildGsr, GSR_SPEND_TYPES, payeesOf, UNSPECIFIED, type GsrPayment } from "./gsr-calc";

function useGsrPayments(projectId: string | null, fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ["taxlive-gsr", projectId, fromDate, toDate],
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: async (): Promise<GsrPayment[]> => {
      const { data, error } = await (supabase.rpc as any)("get_gsr_payments", {
        p_project_id: projectId,
        p_from: fromDate || null,
        p_to: toDate || null,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        amount_sar: Number(r.amount_sar) || 0,
        amount_original: r.amount_original == null ? null : Number(r.amount_original),
        wht: Number(r.wht) || 0,
      }));
    },
  });
}

const originalText = (o: Record<string, number>) =>
  Object.entries(o)
    .map(([c, v]) => `${formatAmount(v, 2)} ${c}`)
    .join(" · ") || "—";

export function GsrReport() {
  const { t } = useTranslation();
  const { projectId } = useActiveProject();
  const [fromDate, setFrom] = useState("");
  const [toDate, setTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const q = useGsrPayments(projectId, fromDate, toDate);
  const g = useMemo(() => buildGsr(q.data ?? []), [q.data]);
  const country = (c: string) => (c === UNSPECIFIED ? t("taxlive.gsr.unspecified") : c);
  const type = (k: string) => t(`taxlive.gsr.type.${k}`);
  const period =
    fromDate || toDate
      ? `${fromDate ? formatDate(fromDate) : "…"} – ${toDate ? formatDate(toDate) : "…"}`
      : t("taxlive.common.allDates");

  useReportExport(() =>
    q.isLoading
      ? null
      : {
          doc: {
            report: "GSR",
            title: t("taxlive.gsr.title"),
            subtitle: `${period} · ${t("exports.currency")}: SAR`,
            sections: [
              {
                title: t("taxlive.gsr.byCountry"),
                columns: [
                  { header: t("taxlive.gsr.col.country") },
                  { header: t("taxlive.gsr.col.bank") },
                  { header: t("taxlive.gsr.col.payments"), type: "integer" },
                  { header: t("taxlive.gsr.col.payees"), type: "integer" },
                  { header: t("taxlive.gsr.col.original") },
                  { header: t("taxlive.gsr.col.sar"), type: "money" },
                  { header: t("taxlive.gsr.col.pct"), type: "percent" },
                  { header: t("taxlive.gsr.col.wht"), type: "money" },
                ],
                rows: g.countries.map((c) => [
                  country(c.country),
                  c.banks.join(", "),
                  c.payments,
                  c.payees,
                  originalText(c.original),
                  c.amountSar,
                  c.pct,
                  c.wht,
                ]),
                totals: [[t("taxlive.common.total"), "", null, null, "", g.total, 100, g.wht]],
              },
              {
                title: t("taxlive.gsr.byTag"),
                columns: [
                  { header: t("taxlive.gsr.col.tag") },
                  { header: t("taxlive.gsr.col.spendType") },
                  { header: t("taxlive.gsr.col.country") },
                  { header: t("taxlive.gsr.col.sar"), type: "money" },
                  { header: t("taxlive.gsr.col.pct"), type: "percent" },
                ],
                rows: g.tags.map((r) => [
                  r.tag,
                  type(r.spendType),
                  country(r.country),
                  r.amountSar,
                  r.pct,
                ]),
                totals: [
                  [t("taxlive.gsr.untagged"), "", "", g.unspecified, null],
                  [t("taxlive.common.total"), "", "", g.total, 100],
                ],
              },
              {
                title: t("taxlive.gsr.matrix"),
                columns: [
                  { header: t("taxlive.gsr.col.country") },
                  ...GSR_SPEND_TYPES.map((k) => ({ header: type(k), type: "money" as const })),
                  { header: t("taxlive.common.total"), type: "money" },
                  { header: t("taxlive.gsr.col.pct"), type: "percent" },
                ],
                rows: g.matrix.map((r) => [
                  country(r.country),
                  ...GSR_SPEND_TYPES.map((k) => r.byType[k]),
                  r.total,
                  r.pct,
                ]),
                totals: [
                  [
                    t("taxlive.common.total"),
                    ...GSR_SPEND_TYPES.map((k) => g.typeTotals[k]),
                    g.total,
                    100,
                  ],
                  [
                    t("taxlive.gsr.pctByType"),
                    ...GSR_SPEND_TYPES.map((k) => g.typePct[k]),
                    100,
                    null,
                  ],
                ],
              },
              {
                title: t("taxlive.gsr.localIntl"),
                columns: [
                  { header: t("taxlive.common.item") },
                  { header: t("taxlive.gsr.col.sar"), type: "money" },
                  { header: t("taxlive.gsr.col.pct"), type: "percent" },
                ],
                rows: [
                  [t("taxlive.gsr.inKsa"), g.local, g.total ? (g.local / g.total) * 100 : 0],
                  [
                    t("taxlive.gsr.outside"),
                    g.international,
                    g.total ? (g.international / g.total) * 100 : 0,
                  ],
                  [
                    t("taxlive.gsr.unspecified"),
                    g.unspecified,
                    g.total ? (g.unspecified / g.total) * 100 : 0,
                  ],
                ],
                totals: [[t("taxlive.common.total"), g.total, 100]],
              },
            ],
          },
        },
  );

  return (
    <div className="space-y-5">
      <Panel>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{t("taxlive.gsr.title")}</h3>
            <p className="max-w-3xl text-xs text-muted-foreground">{t("taxlive.gsr.hint")}</p>
          </div>
          <PeriodFilter
            from={fromDate}
            to={toDate}
            onChange={(f, tt) => {
              setFrom(f);
              setTo(tt);
            }}
          />
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {(
            [
              ["inKsa", g.local],
              ["outside", g.international],
              ["unspecified", g.unspecified],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-surface p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {t(`taxlive.gsr.${k}`)}
              </div>
              <div
                dir="ltr"
                className={`mt-1 text-lg font-semibold tabular-nums ${k === "unspecified" && v > 0 ? "text-warning" : ""}`}
              >
                <Money v={v} />
              </div>
              <div className="text-xs text-muted-foreground">
                {g.total ? ((v / g.total) * 100).toFixed(1) : "0.0"}%
              </div>
            </div>
          ))}
        </div>
        {g.unspecified > 0 && (
          <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            {t("taxlive.gsr.untaggedWarn")}
          </p>
        )}
        <StateLine
          loading={q.isLoading}
          error={q.error ? (q.error as Error).message : null}
          empty={!q.isLoading && !q.error && g.countries.length === 0}
        />
        {!q.isLoading && !q.error && g.countries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className={thCls}>{t("taxlive.gsr.col.country")}</th>
                  <th className={thCls}>{t("taxlive.gsr.col.bank")}</th>
                  <th className={thNumCls}>{t("taxlive.gsr.col.payments")}</th>
                  <th className={thNumCls}>{t("taxlive.gsr.col.payees")}</th>
                  <th className={thNumCls}>{t("taxlive.gsr.col.original")}</th>
                  <th className={thNumCls}>{t("taxlive.gsr.col.sar")}</th>
                  <th className={thNumCls}>{t("taxlive.gsr.col.pct")}</th>
                  <th className={thNumCls}>{t("taxlive.gsr.col.wht")}</th>
                </tr>
              </thead>
              <tbody>
                {g.countries.map((c) => {
                  const isOpen = open === c.country;
                  return (
                    <Fragment key={c.country}>
                      <tr
                        className="cursor-pointer border-b border-border/50 hover:bg-muted/50"
                        onClick={() => setOpen(isOpen ? null : c.country)}
                      >
                        <td className={`${txtCls} font-medium`}>
                          <span className="inline-flex items-center gap-1">
                            {isOpen ? (
                              <ChevronDown className="size-3.5" />
                            ) : (
                              <ChevronRight className="size-3.5 rtl:rotate-180" />
                            )}
                            {country(c.country)}
                          </span>
                        </td>
                        <td className={`${txtCls} text-xs text-muted-foreground`}>
                          {c.banks.join(", ") || "—"}
                        </td>
                        <td className={numCls}>{c.payments}</td>
                        <td className={numCls}>{c.payees}</td>
                        <td className={`${numCls} text-xs`} dir="ltr">
                          {originalText(c.original)}
                        </td>
                        <td className={`${numCls} font-semibold`}>
                          <Money v={c.amountSar} />
                        </td>
                        <td className={numCls}>{c.pct.toFixed(1)}%</td>
                        <td className={numCls}>
                          <Money v={c.wht} blankZero />
                        </td>
                      </tr>
                      {isOpen &&
                        payeesOf(c).map((p) => (
                          <Fragment key={`${c.country}-${p.type}-${p.payee}`}>
                            <tr className="bg-surface-2/60">
                              <td className={`${txtCls} ps-8 font-medium`} colSpan={4}>
                                {p.payee}{" "}
                                <span className="text-xs text-muted-foreground">
                                  · {t(`taxlive.gsr.payee.${p.type}`, { defaultValue: p.type })}
                                </span>
                              </td>
                              <td />
                              <td className={numCls}>
                                <Money v={p.amountSar} />
                              </td>
                              <td />
                              <td className={numCls}>
                                <Money v={p.wht} blankZero />
                              </td>
                            </tr>
                            {p.payments.map((pm) => (
                              <tr key={pm.payment_id} className="text-xs text-muted-foreground">
                                <td className={`${txtCls} ps-12`} colSpan={2}>
                                  {pm.payment_date ? formatDate(pm.payment_date) : "—"} ·{" "}
                                  {t(`taxlive.gsr.source.${pm.source_type}`, {
                                    defaultValue: pm.source_type,
                                  })}
                                  {pm.bank_name ? ` · ${pm.bank_name}` : ""}
                                </td>
                                <td colSpan={2} />
                                <td className={numCls} dir="ltr">
                                  {pm.amount_original != null
                                    ? `${formatAmount(pm.amount_original, 2)} ${pm.currency}`
                                    : "—"}
                                </td>
                                <td className={numCls}>
                                  <Money v={pm.amount_sar} />
                                </td>
                                <td />
                                <td className={numCls}>
                                  <Money v={pm.wht} blankZero />
                                </td>
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td colSpan={5} className="px-3 py-2 text-end">
                    {t("taxlive.common.total")}
                  </td>
                  <td className={numCls}>
                    <Money v={g.total} />
                  </td>
                  <td className={numCls}>100%</td>
                  <td className={numCls}>
                    <Money v={g.wht} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      {g.matrix.length > 0 && (
        <Panel>
          <h3 className="mb-3 text-lg font-semibold">{t("taxlive.gsr.matrix")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className={thCls}>{t("taxlive.gsr.col.country")}</th>
                  {GSR_SPEND_TYPES.map((k) => (
                    <th key={k} className={thNumCls}>
                      {type(k)}
                    </th>
                  ))}
                  <th className={thNumCls}>{t("taxlive.common.total")}</th>
                  <th className={thNumCls}>{t("taxlive.gsr.col.pct")}</th>
                </tr>
              </thead>
              <tbody>
                {g.matrix.map((r) => (
                  <tr key={r.country} className="border-b border-border/50">
                    <td className={txtCls}>{country(r.country)}</td>
                    {GSR_SPEND_TYPES.map((k) => (
                      <td key={k} className={numCls}>
                        <Money v={r.byType[k]} blankZero />
                      </td>
                    ))}
                    <td className={`${numCls} font-semibold`}>
                      <Money v={r.total} />
                    </td>
                    <td className={numCls}>{r.pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className={txtCls}>{t("taxlive.common.total")}</td>
                  {GSR_SPEND_TYPES.map((k) => (
                    <td key={k} className={numCls}>
                      <Money v={g.typeTotals[k]} />
                    </td>
                  ))}
                  <td className={numCls}>
                    <Money v={g.total} />
                  </td>
                  <td className={numCls}>100%</td>
                </tr>
                <tr className="text-xs text-muted-foreground">
                  <td className={txtCls}>{t("taxlive.gsr.pctByType")}</td>
                  {GSR_SPEND_TYPES.map((k) => (
                    <td key={k} className={numCls}>
                      {g.typePct[k].toFixed(1)}%
                    </td>
                  ))}
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {g.tags.map((r) => (
              <span
                key={r.tag}
                className="rounded-full border border-border bg-surface px-2.5 py-1 font-mono text-xs"
                dir="ltr"
              >
                {r.tag} · {formatAmount(r.amountSar, 2)} · {r.pct.toFixed(1)}%
              </span>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

export default GsrReport;
