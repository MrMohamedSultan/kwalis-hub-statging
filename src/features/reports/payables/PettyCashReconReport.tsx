// =====================================================================
// Petty Cash Reconciliation (N08): per float — issued, spent with approved
// receipts, pending receipts, returned to the bank, remaining — and the
// Film Commission cash limits: cash share of the qualifying spend and the
// per-transaction limit. The limits are project settings (E10,
// project_rebate_settings of the Film Commission batch); until they are set
// the defaults are used and the screen says so.
// =====================================================================
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Panel } from "@/components/AppShell";
import { formatAmount } from "@/lib/format-number";
import { cashShareOfQpe, pettyCashRecon } from "@/lib/payables-reports";
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
import { usePettyData } from "./payables-data";

const COLS = ["issued", "spent", "pending", "returned", "remaining"] as const;

export function PettyCashReconReport() {
  const { t } = useTranslation();
  const { projectId } = useActiveProject();
  const q = usePettyData(projectId);
  const d = q.data;
  const recon = useMemo(
    () => (d ? pettyCashRecon(d.floats, d.receipts, d.returns, d.limits) : null),
    [d],
  );
  const share = d ? cashShareOfQpe(d.cashSpent, d.qpeBase) : null;
  const shareOver = d != null && share != null && share > d.limits.pctOfQpe;
  const txnOver = d != null && d.largestCash > d.limits.perTxn + 0.005;
  const col = (k: string) => t(`reconcile.petty.col.${k}`);

  useReportExport(() =>
    !d || !recon
      ? null
      : {
          doc: {
            report: "Petty Cash Reconciliation",
            title: t("reconcile.tab.pettyrec"),
            subtitle: `${t("exports.currency")}: SAR`,
            sections: [
              {
                columns: [
                  { header: col("float") },
                  { header: col("holder") },
                  ...COLS.map((k) => ({ header: `${col(k)} (SAR)`, type: "money" as const })),
                  { header: col("receipts"), type: "integer" },
                  { header: col("overLimit"), type: "integer" },
                ],
                rows: recon.rows.map((r) => [
                  r.ref ?? "",
                  r.holder,
                  ...COLS.map((k) => r[k]),
                  r.receipts,
                  r.overLimit,
                ]),
                totals: [
                  [
                    t("reconcile.common.total"),
                    "",
                    ...COLS.map((k) => recon.totals[k]),
                    recon.totals.receipts,
                    recon.totals.overLimit,
                  ],
                ],
              },
              {
                title: t("reconcile.petty.limits"),
                columns: [{ header: "" }, { header: "", type: "number" }, { header: "" }],
                rows: [
                  [t("reconcile.petty.cashSpent"), d.cashSpent, ""],
                  [t("reconcile.petty.qpeBase"), d.qpeBase, ""],
                  [t("reconcile.petty.cashShare"), share, shareOver ? "CHECK" : "OK"],
                  [t("reconcile.petty.limitPct"), d.limits.pctOfQpe, ""],
                  [t("reconcile.petty.largest"), d.largestCash, txnOver ? "CHECK" : "OK"],
                  [t("reconcile.petty.limitTxn"), d.limits.perTxn, ""],
                ],
                notes: [
                  d.limits.source === "default"
                    ? t("reconcile.petty.defaultLimits")
                    : t("reconcile.petty.settingsLimits"),
                  t("reconcile.petty.qpeNote"),
                ],
              },
            ],
          },
        },
  );

  return (
    <Panel>
      <div className="mb-4">
        <h3 className="text-lg font-semibold">{t("reconcile.tab.pettyrec")}</h3>
        <p className="text-xs text-muted-foreground">{t("reconcile.petty.hint")}</p>
      </div>
      <StateLine
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        empty={!q.isLoading && !q.error && !recon?.rows.length}
      />
      {d && recon && (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-2">
            <LimitCard
              ok={!shareOver}
              title={t("reconcile.petty.cashShare")}
              value={share == null ? "—" : `${share.toFixed(1)}%`}
              detail={t("reconcile.petty.limitPctValue", { pct: d.limits.pctOfQpe })}
            />
            <LimitCard
              ok={!txnOver}
              title={t("reconcile.petty.largest")}
              value={formatAmount(d.largestCash, 2)}
              detail={t("reconcile.petty.limitTxnValue", {
                amount: formatAmount(d.limits.perTxn, 0),
              })}
            />
          </div>
          <p className="mb-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {d.limits.source === "default"
              ? t("reconcile.petty.defaultLimits")
              : t("reconcile.petty.settingsLimits")}{" "}
            {t("reconcile.petty.qpeNote")}
          </p>
          {recon.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className={thCls}>{col("float")}</th>
                    <th className={thCls}>{col("holder")}</th>
                    {COLS.map((k) => (
                      <th key={k} className={thNumCls}>
                        {col(k)}
                      </th>
                    ))}
                    <th className={thNumCls}>{col("receipts")}</th>
                    <th className={thNumCls}>{col("overLimit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {recon.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/50">
                      <td className={`${txtCls} font-mono text-xs`}>{r.ref ?? "—"}</td>
                      <td className={txtCls}>{r.holder}</td>
                      {COLS.map((k) => (
                        <td
                          key={k}
                          className={`${numCls} ${k === "remaining" ? (r.remaining < -0.005 ? "font-semibold text-destructive" : "font-semibold") : ""}`}
                        >
                          <Money v={r[k]} blankZero={k === "pending" || k === "returned"} />
                        </td>
                      ))}
                      <td className={numCls}>{r.receipts}</td>
                      <td
                        className={`${numCls} ${r.overLimit ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                      >
                        {r.overLimit || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td colSpan={2} className="px-3 py-2 text-end">
                      {t("reconcile.common.total")}
                    </td>
                    {COLS.map((k) => (
                      <td key={k} className={numCls}>
                        <Money v={recon.totals[k]} />
                      </td>
                    ))}
                    <td className={numCls}>{recon.totals.receipts}</td>
                    <td className={numCls}>{recon.totals.overLimit}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function LimitCard({
  ok,
  title,
  value,
  detail,
}: {
  ok: boolean;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${ok ? "border-border bg-surface" : "border-destructive/40 bg-destructive/10"}`}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {ok ? (
          <CheckCircle2 className="size-4 text-success" />
        ) : (
          <AlertTriangle className="size-4 text-destructive" />
        )}
        {title}
      </div>
      <div
        dir="ltr"
        className={`mt-1 text-lg font-semibold tabular-nums ${ok ? "" : "text-destructive"}`}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
