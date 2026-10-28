// =====================================================================
// Open Purchase Orders (N07): POs not fully matched by invoices —
// PO value − invoices raised on it (invoices.purchase_order_id, 174).
// =====================================================================
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/AppShell";
import { formatDate } from "@/lib/date-format";
import { openPurchaseOrders } from "@/lib/payables-reports";
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
import { useOpenPoData } from "./payables-data";

export function OpenPurchaseOrdersReport() {
  const { t } = useTranslation();
  const { projectId } = useActiveProject();
  const q = useOpenPoData(projectId);
  const rows = useMemo(
    () => (q.data ? openPurchaseOrders(q.data.pos, q.data.invoices) : []),
    [q.data],
  );
  const sum = (k: "amount" | "invoiced" | "open") => rows.reduce((a, r) => a + r[k], 0);
  const head = [
    t("reconcile.po.col.ref"),
    t("reconcile.po.col.vendor"),
    t("reconcile.po.col.date"),
    t("reconcile.po.col.budgetCode"),
    t("reconcile.po.col.status"),
  ];

  useReportExport(() =>
    q.isLoading
      ? null
      : {
          doc: {
            report: "Open Purchase Orders",
            title: t("reconcile.tab.openpo"),
            subtitle: `${t("exports.currency")}: SAR`,
            sections: [
              {
                columns: [
                  { header: head[0] },
                  { header: head[1] },
                  { header: head[2], type: "date" },
                  { header: head[3] },
                  { header: head[4] },
                  { header: `${t("reconcile.po.col.value")} (SAR)`, type: "money" },
                  { header: t("reconcile.po.col.invoices"), type: "integer" },
                  { header: `${t("reconcile.po.col.invoiced")} (SAR)`, type: "money" },
                  { header: `${t("reconcile.po.col.open")} (SAR)`, type: "money" },
                ],
                rows: rows.map((r) => [
                  r.ref ?? "",
                  r.vendor ?? "",
                  r.date,
                  r.budgetCode ?? "",
                  r.status ?? "",
                  r.amount,
                  r.invoiceCount,
                  r.invoiced,
                  r.open,
                ]),
                totals: [
                  [
                    t("reconcile.common.total"),
                    "",
                    null,
                    "",
                    "",
                    sum("amount"),
                    null,
                    sum("invoiced"),
                    sum("open"),
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
        <h3 className="text-lg font-semibold">{t("reconcile.tab.openpo")}</h3>
        <p className="text-xs text-muted-foreground">{t("reconcile.po.hint")}</p>
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
                {head.map((h) => (
                  <th key={h} className={thCls}>
                    {h}
                  </th>
                ))}
                <th className={thNumCls}>{t("reconcile.po.col.value")}</th>
                <th className={thNumCls}>{t("reconcile.po.col.invoices")}</th>
                <th className={thNumCls}>{t("reconcile.po.col.invoiced")}</th>
                <th className={thNumCls}>{t("reconcile.po.col.open")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-muted/50">
                  <td className={`${txtCls} font-mono text-xs`}>{r.ref ?? "—"}</td>
                  <td className={txtCls}>{r.vendor ?? "—"}</td>
                  <td className={txtCls}>{r.date ? formatDate(r.date) : "—"}</td>
                  <td className={`${txtCls} font-mono text-xs`}>{r.budgetCode ?? "—"}</td>
                  <td className={txtCls}>{r.status ?? "—"}</td>
                  <td className={numCls}>
                    <Money v={r.amount} />
                  </td>
                  <td className={numCls}>{r.invoiceCount}</td>
                  <td className={numCls}>
                    <Money v={r.invoiced} blankZero />
                  </td>
                  <td className={`${numCls} font-semibold`}>
                    <Money v={r.open} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td colSpan={5} className="px-3 py-2 text-end">
                  {t("reconcile.common.total")}
                </td>
                <td className={numCls}>
                  <Money v={sum("amount")} />
                </td>
                <td />
                <td className={numCls}>
                  <Money v={sum("invoiced")} />
                </td>
                <td className={numCls}>
                  <Money v={sum("open")} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );
}
