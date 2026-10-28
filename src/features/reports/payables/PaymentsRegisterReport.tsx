// =====================================================================
// Payments Register (R12, decision 7 — was "Actual Paid"): every payment
// out of the bank, cash on hand or a petty cash float — vendor invoices,
// contract instalments, POs, petty cash floats and receipts, per diem, WHT
// remittances, VAT payments, bank charges. Read from the ledger
// (get_payments_register, db/pending/196), so the bank total equals the
// bank credits of the General Ledger.
// =====================================================================
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/AppShell";
import { formatDate } from "@/lib/date-format";
import { filterRegister, registerTotals } from "@/lib/payables-reports";
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
import { usePaymentsRegister } from "./payables-data";
import { GlTransactionDrawer } from "@/features/reports/gl-transactions/GlTransactionDrawer";
import type { GlTransaction } from "@/features/reports/gl-transactions/gl-transactions-data";
import { transactionFromRegisterRow } from "@/features/reports/ledger/ledger-drawer";

const inputCls = "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";

export function PaymentsRegisterReport() {
  const { t } = useTranslation();
  const { projectId, organizationId } = useActiveProject();
  // G09: a row opens the transaction drawer of its payment / document (184)
  const [selected, setSelected] = useState<GlTransaction | null>(null);
  const [ref, setRef] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [payee, setPayee] = useState("");
  const [code, setCode] = useState("");
  const [method, setMethod] = useState("all");
  const q = usePaymentsRegister(projectId, from, to);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const methods = useMemo(
    () => [...new Set(all.map((r) => r.method).filter(Boolean))] as string[],
    [all],
  );
  const rows = useMemo(
    () => filterRegister(all, { payee, code, method, ref }),
    [all, payee, code, method, ref],
  );
  const totals = useMemo(() => registerTotals(rows), [rows]);
  const docLabel = (k: string | null) =>
    k ? t(`reconcile.register.doc.${k}`, { defaultValue: k }) : "—";
  const methodLabel = (m: string | null) =>
    m ? t(`reconcile.register.method.${m.replace(/\s+/g, "_")}`, { defaultValue: m }) : "—";

  const head = [
    t("reconcile.register.col.date"),
    t("reconcile.register.col.paymentRef"),
    t("reconcile.register.col.payee"),
    t("reconcile.register.col.document"),
    t("reconcile.register.col.documentRef"),
    t("reconcile.register.col.instalment"),
    t("reconcile.register.col.budgetCode"),
    t("reconcile.register.col.method"),
    t("reconcile.register.col.paidFrom"),
  ];

  useReportExport(() =>
    q.isLoading
      ? null
      : {
          doc: {
            report: "Payments Register",
            title: t("reconcile.tab.paid"),
            subtitle: `${t("exports.currency")}: SAR${from || to ? ` · ${from || "…"} → ${to || "…"}` : ""}`,
            sections: [
              {
                columns: [
                  { header: head[0], type: "date" },
                  ...head.slice(1).map((h) => ({ header: h })),
                  { header: `${t("reconcile.register.col.gross")} (SAR)`, type: "money" },
                  { header: `${t("reconcile.register.col.wht")} (SAR)`, type: "money" },
                  { header: `${t("reconcile.register.col.net")} (SAR)`, type: "money" },
                ],
                rows: rows.map((r) => [
                  r.payment_date,
                  r.payment_ref ?? "",
                  r.payee ?? "",
                  docLabel(r.document_type),
                  r.document_ref ?? "",
                  r.instalment ?? "",
                  r.budget_code ?? "",
                  methodLabel(r.method),
                  [r.paid_from_code, r.paid_from_name].filter(Boolean).join(" "),
                  r.gross,
                  r.wht,
                  r.net,
                ]),
                totals: [
                  [
                    t("reconcile.register.total"),
                    ...Array(8).fill(""),
                    totals.gross,
                    totals.wht,
                    totals.net,
                  ],
                  ...totals.byAccount.map((a) => [
                    t("reconcile.register.totalFrom", { account: `${a.code} ${a.name}` }),
                    ...Array(10).fill(""),
                    a.net,
                  ]),
                ],
              },
            ],
          },
        },
  );

  return (
    <Panel>
      <div className="mb-4">
        <h3 className="text-lg font-semibold">{t("reconcile.tab.paid")}</h3>
        <p className="text-xs text-muted-foreground">{t("reconcile.register.hint")}</p>
      </div>
      <PeriodFilter
        from={from}
        to={to}
        onChange={(f, tt) => {
          setFrom(f);
          setTo(tt);
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("polish.refs.ref_no")}
          <input
            value={ref}
            maxLength={64}
            placeholder={t("polish.refs.filter_placeholder")}
            onChange={(e) => setRef(e.target.value)}
            className={`${inputCls} w-36 font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("reconcile.register.col.payee")}
          <input
            value={payee}
            maxLength={100}
            onChange={(e) => setPayee(e.target.value)}
            className={`${inputCls} w-44`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("reconcile.register.col.budgetCode")}
          <input
            value={code}
            maxLength={64}
            onChange={(e) => setCode(e.target.value)}
            className={`${inputCls} w-28`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("reconcile.register.col.method")}
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
            <option value="all">{t("reconcile.common.all")}</option>
            {methods.map((m) => (
              <option key={m} value={m}>
                {methodLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </PeriodFilter>

      <StateLine
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        empty={!q.isLoading && !q.error && rows.length === 0}
      />
      {rows.some((r) => r.invoice_not_approved) && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">
          {t("decisions.invoice.paidNotApproved", {
            count: rows.filter((r) => r.invoice_not_approved).length,
          })}
        </p>
      )}
      {!q.isLoading && !q.error && rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                {head.map((h) => (
                  <th key={h} className={thCls}>
                    {h}
                  </th>
                ))}
                <th className={thNumCls}>{t("reconcile.register.col.gross")}</th>
                <th className={thNumCls}>{t("reconcile.register.col.wht")}</th>
                <th className={thNumCls}>{t("reconcile.register.col.net")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tx = transactionFromRegisterRow(r, { organizationId, projectId });
                return (
                  <tr
                    key={r.event_key}
                    className={`border-b border-border/50 hover:bg-muted/50 ${tx ? "cursor-pointer" : ""}`}
                    onClick={tx ? () => setSelected(tx) : undefined}
                    title={tx ? t("polish.refs.open_details") : undefined}
                  >
                    <td className={txtCls}>{formatDate(r.payment_date)}</td>
                    <td className={`${txtCls} font-mono text-xs`}>{r.payment_ref ?? "—"}</td>
                    <td className={txtCls}>{r.payee ?? "—"}</td>
                    <td className={txtCls}>{docLabel(r.document_type)}</td>
                    <td className={`${txtCls} font-mono text-xs`}>
                      {r.document_ref ?? "—"}
                      {r.invoice_not_approved && (
                        <span
                          className="ms-1 rounded bg-warning/15 px-1 font-sans text-[10px] text-warning"
                          title={t("decisions.invoice.notApprovedBadgeHint")}
                        >
                          {t("decisions.invoice.notApprovedBadge")}
                        </span>
                      )}
                    </td>
                    <td className={txtCls}>{r.instalment ?? "—"}</td>
                    <td className={`${txtCls} font-mono text-xs`}>{r.budget_code ?? "—"}</td>
                    <td className={txtCls}>{methodLabel(r.method)}</td>
                    <td className={txtCls}>
                      {r.paid_from_code} {r.paid_from_name}
                    </td>
                    <td className={numCls}>
                      <Money v={r.gross} />
                    </td>
                    <td className={numCls}>
                      <Money v={r.wht} blankZero />
                    </td>
                    <td className={`${numCls} font-semibold`}>
                      <Money v={r.net} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td colSpan={9} className="px-3 py-2 text-end">
                  {t("reconcile.register.total")}
                </td>
                <td className={numCls}>
                  <Money v={totals.gross} />
                </td>
                <td className={numCls}>
                  <Money v={totals.wht} />
                </td>
                <td className={numCls}>
                  <Money v={totals.net} />
                </td>
              </tr>
              {totals.byAccount.map((a) => (
                <tr key={a.code} className="text-muted-foreground">
                  <td colSpan={11} className="px-3 py-1 text-end text-xs">
                    {t("reconcile.register.totalFrom", { account: `${a.code} ${a.name}` })}
                    {a.code === "9100" && ` — ${t("reconcile.register.bankNote")}`}
                  </td>
                  <td className={numCls}>
                    <Money v={a.net} />
                  </td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}
      {selected && <GlTransactionDrawer row={selected} onClose={() => setSelected(null)} />}
    </Panel>
  );
}
