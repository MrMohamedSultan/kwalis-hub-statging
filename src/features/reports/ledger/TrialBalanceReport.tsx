// =====================================================================
// Trial Balance (N01): per account opening, period debit, period credit,
// closing — from the ledger. Debits = credits always. Click an account to
// open its lines in the General Ledger below.
// =====================================================================
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/AppShell";
import { formatAmount } from "@/lib/format-number";
import { splitBalance, trialBalanceTotals } from "@/lib/ledger-calc";
import { useActiveProject, useTrialBalance } from "./ledger-data";
import { GeneralLedgerReport } from "./GeneralLedgerReport";
import {
  accountLabel,
  ExportButtons,
  Money,
  numCls,
  PeriodFilter,
  PhaseBadge,
  StateLine,
  thCls,
  thNumCls,
  txtCls,
} from "./ledger-ui";

export function TrialBalanceReport() {
  const { t } = useTranslation();
  const { projectId, projectCode, projectName } = useActiveProject();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error } = useTrialBalance(projectId, from, to);
  const totals = trialBalanceTotals(data);

  const build = () => ({
    title: t("journal.trial_balance"),
    subtitle: `${projectCode ?? ""} ${projectName} · ${from || "…"} → ${to || "…"}`,
    headers: [
      t("journal.col.code"),
      t("journal.col.account"),
      t("journal.col.opening"),
      t("journal.col.period_debit"),
      t("journal.col.period_credit"),
      t("journal.col.closing_debit"),
      t("journal.col.closing_credit"),
    ],
    rows: [
      ...data.map((r) => {
        const c = splitBalance(r.closing);
        return [
          r.gl_code ?? "",
          r.gl_name ?? "",
          r.opening,
          r.period_debit,
          r.period_credit,
          c.debit,
          c.credit,
        ];
      }),
      [
        "",
        t("journal.total"),
        totals.opening,
        totals.periodDebit,
        totals.periodCredit,
        totals.closingDebit,
        totals.closingCredit,
      ],
    ],
    numericColumns: [2, 3, 4, 5, 6],
  });

  return (
    <>
      <Panel>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{t("journal.trial_balance")}</h3>
            <p className="text-xs text-muted-foreground">{t("journal.trial_balance_hint")}</p>
          </div>
          <div className="flex items-center gap-2">
            <PhaseBadge phase={data[0]?.phase} />
            <ExportButtons
              build={build}
              projectCode={projectCode}
              report="TrialBalance"
              disabled={!data.length}
            />
          </div>
        </div>
        <PeriodFilter
          from={from}
          to={to}
          onChange={(f, tt) => {
            setFrom(f);
            setTo(tt);
          }}
        />
        <StateLine loading={loading} error={error} empty={!loading && !error && !data.length} />
        {!loading && !error && data.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className={thCls}>{t("journal.col.code")}</th>
                  <th className={thCls}>{t("journal.col.account")}</th>
                  <th className={thNumCls}>{t("journal.col.opening")}</th>
                  <th className={thNumCls}>{t("journal.col.period_debit")}</th>
                  <th className={thNumCls}>{t("journal.col.period_credit")}</th>
                  <th className={thNumCls}>{t("journal.col.closing_debit")}</th>
                  <th className={thNumCls}>{t("journal.col.closing_credit")}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => {
                  const c = splitBalance(r.closing);
                  const active = selected === r.gl_account_id;
                  return (
                    <tr
                      key={r.gl_account_id}
                      onClick={() => setSelected(active ? null : r.gl_account_id)}
                      className={`cursor-pointer border-b border-border/50 hover:bg-muted/50 ${active ? "bg-brand/10" : ""}`}
                      title={t("journal.open_in_gl")}
                    >
                      <td className={txtCls}>{r.gl_code}</td>
                      <td className={`${txtCls} text-brand underline-offset-2 hover:underline`}>
                        {r.gl_name}
                      </td>
                      <td className={numCls}>
                        <Money v={r.opening} blankZero />
                      </td>
                      <td className={numCls}>
                        <Money v={r.period_debit} blankZero />
                      </td>
                      <td className={numCls}>
                        <Money v={r.period_credit} blankZero />
                      </td>
                      <td className={numCls}>
                        <Money v={c.debit} blankZero />
                      </td>
                      <td className={numCls}>
                        <Money v={c.credit} blankZero />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className={txtCls} />
                  <td className={txtCls}>
                    {t("journal.total")}{" "}
                    <span className={totals.balanced ? "text-success" : "text-destructive"}>
                      ({totals.balanced ? t("journal.balanced") : t("journal.not_balanced")})
                    </span>
                  </td>
                  <td className={numCls}>{formatAmount(totals.opening, 2)}</td>
                  <td className={numCls}>{formatAmount(totals.periodDebit, 2)}</td>
                  <td className={numCls}>{formatAmount(totals.periodCredit, 2)}</td>
                  <td className={numCls}>{formatAmount(totals.closingDebit, 2)}</td>
                  <td className={numCls}>{formatAmount(totals.closingCredit, 2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
      {selected && (
        <GeneralLedgerReport
          key={`${selected}-${from}-${to}`}
          initialAccountId={selected}
          initialFrom={from}
          initialTo={to}
          embedded
        />
      )}
    </>
  );
}
