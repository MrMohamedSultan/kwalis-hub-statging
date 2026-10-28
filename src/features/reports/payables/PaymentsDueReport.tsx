// =====================================================================
// Payments Due (N05): contract instalments not paid yet and unpaid invoice
// balances — payee, reference, instalment, due date, amount, status, days
// overdue — with a this week / this month / next 30 days / overdue filter.
// =====================================================================
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/AppShell";
import { formatDate, riyadhToday } from "@/lib/date-format";
import { paymentsDue, type DueWindow } from "@/lib/payables-reports";
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
import { InvoiceE08Details } from "@/components/ap/InvoiceE08Details";
import { GlTransactionDrawer } from "@/features/reports/gl-transactions/GlTransactionDrawer";
import type { GlTransaction } from "@/features/reports/gl-transactions/gl-transactions-data";
import { transactionForDocument } from "@/features/reports/ledger/ledger-drawer";

const WINDOWS: DueWindow[] = ["all", "overdue", "this_week", "this_month", "next_30"];

export function PaymentsDueReport() {
  const { t } = useTranslation();
  const { projectId, organizationId } = useActiveProject();
  // G09: a row opens the transaction drawer of its contract / invoice (184)
  const [selected, setSelected] = useState<GlTransaction | null>(null);
  const [win, setWin] = useState<DueWindow>("this_month");
  const q = useDueItems(projectId);
  const today = riyadhToday();
  const rows = useMemo(() => paymentsDue(q.data ?? [], win, today), [q.data, win, today]);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const overdue = rows.filter((r) => (r.daysOverdue ?? 0) > 0).reduce((a, r) => a + r.amount, 0);
  const statusLabel = (s: string) => t(`reconcile.status.${s}`, { defaultValue: s });
  const kindLabel = (k: string) => t(`reconcile.due.kind.${k}`);
  const head = [
    t("reconcile.due.col.payee"),
    t("reconcile.due.col.type"),
    t("reconcile.due.col.ref"),
    t("reconcile.due.col.instalment"),
    t("reconcile.due.col.dueDate"),
    t("reconcile.due.col.status"),
  ];

  useReportExport(() =>
    q.isLoading
      ? null
      : {
          doc: {
            report: "Payments Due",
            title: t("reconcile.tab.due"),
            subtitle: `${t(`reconcile.due.window.${win}`)} · ${t("exports.currency")}: SAR`,
            sections: [
              {
                columns: [
                  { header: head[0] },
                  { header: head[1] },
                  { header: head[2] },
                  { header: head[3] },
                  { header: head[4], type: "date" },
                  { header: head[5] },
                  { header: `${t("reconcile.due.col.amount")} (SAR)`, type: "money" },
                  { header: t("reconcile.due.col.daysOverdue"), type: "integer" },
                ],
                rows: rows.map((r) => [
                  r.payee,
                  kindLabel(r.kind),
                  r.ref ?? "",
                  r.instalment ?? "",
                  r.dueDate,
                  statusLabel(r.status),
                  r.amount,
                  r.daysOverdue != null && r.daysOverdue > 0 ? r.daysOverdue : null,
                ]),
                totals: [[t("reconcile.common.total"), "", "", "", null, "", total, null]],
              },
            ],
          },
        },
  );

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t("reconcile.tab.due")}</h3>
          <p className="text-xs text-muted-foreground">{t("reconcile.due.hint")}</p>
        </div>
        <div
          className="inline-flex flex-wrap rounded-full border border-border bg-surface p-0.5"
          role="tablist"
        >
          {WINDOWS.map((w) => (
            <button
              key={w}
              role="tab"
              aria-selected={win === w}
              onClick={() => setWin(w)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${win === w ? "bg-brand text-brand-foreground" : "text-muted-foreground"}`}
            >
              {t(`reconcile.due.window.${w}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("reconcile.due.totalDue")}
          </div>
          <div dir="ltr" className="mt-1 text-lg font-semibold tabular-nums">
            <Money v={total} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("reconcile.due.totalOverdue")}
          </div>
          <div
            dir="ltr"
            className={`mt-1 text-lg font-semibold tabular-nums ${overdue > 0 ? "text-destructive" : "text-muted-foreground"}`}
          >
            <Money v={overdue} />
          </div>
        </div>
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
                <th className={thNumCls}>{t("reconcile.due.col.amount")}</th>
                <th className={thNumCls}>{t("reconcile.due.col.daysOverdue")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const late = (r.daysOverdue ?? 0) > 0;
                const tx = transactionForDocument(
                  r.kind === "invoice" ? "invoice" : "payroll",
                  r.sourceId,
                  {
                    date: r.dueDate,
                    reference: r.ref,
                    party: r.payee,
                    amount: r.amount,
                    status: r.status,
                  },
                  { organizationId, projectId },
                );
                return (
                  <tr
                    key={r.key}
                    className={`border-b border-border/50 hover:bg-muted/50 ${tx ? "cursor-pointer" : ""}`}
                    onClick={tx ? () => setSelected(tx) : undefined}
                    title={tx ? t("polish.refs.open_details") : undefined}
                  >
                    <td className={txtCls}>
                      {r.payee}
                      {r.e08 && <InvoiceE08Details invoice={r.e08} />}
                    </td>
                    <td className={txtCls}>{kindLabel(r.kind)}</td>
                    <td className={`${txtCls} font-mono text-xs`}>
                      {r.ref ?? "—"}
                      {r.e08?.poRef && (
                        <div className="text-[10px] text-muted-foreground">
                          {t("polish.e08.po")}: {r.e08.poRef}
                        </div>
                      )}
                    </td>
                    <td className={txtCls}>{r.instalment ?? "—"}</td>
                    <td className={txtCls}>{r.dueDate ? formatDate(r.dueDate) : "—"}</td>
                    <td className={txtCls}>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${r.payable ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}`}
                      >
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    <td className={`${numCls} font-semibold`}>
                      <Money v={r.amount} />
                    </td>
                    <td
                      className={`${numCls} ${late ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                    >
                      {late ? r.daysOverdue : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td colSpan={6} className="px-3 py-2 text-end">
                  {t("reconcile.common.total")}
                </td>
                <td className={numCls}>
                  <Money v={total} />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {selected && <GlTransactionDrawer row={selected} onClose={() => setSelected(null)} />}
    </Panel>
  );
}
