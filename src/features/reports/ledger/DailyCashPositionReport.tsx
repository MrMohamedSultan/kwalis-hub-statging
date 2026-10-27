// =====================================================================
// Daily Cash Position (N11 / D10): bank, cash and petty cash at the end of
// every day with a movement — opening, in, out, closing — from the ledger.
// =====================================================================
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/AppShell";
import { formatAmount } from "@/lib/format-number";
import { useActiveProject, useDailyCashPosition } from "./ledger-data";
import {
  accountLabel,
  ExportButtons,
  Money,
  numCls,
  PeriodFilter,
  StateLine,
  thCls,
  thNumCls,
  txtCls,
} from "./ledger-ui";

export function DailyCashPositionReport() {
  const { t } = useTranslation();
  const { projectId, projectCode, projectName } = useActiveProject();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data, loading, error } = useDailyCashPosition(projectId, from, to);

  // latest closing per account = current position
  const latest = useMemo(() => {
    const m = new Map<string, { label: string; closing: number }>();
    for (const r of data)
      m.set(r.gl_code, { label: accountLabel(r.gl_code, r.gl_name), closing: r.closing });
    return [...m.values()];
  }, [data]);

  const build = () => ({
    title: t("journal.daily_cash"),
    subtitle: `${projectCode ?? ""} ${projectName} · ${from || "…"} → ${to || "…"}`,
    headers: [
      t("journal.col.date"),
      t("journal.col.account"),
      t("journal.col.opening"),
      t("journal.col.in"),
      t("journal.col.out"),
      t("journal.col.closing"),
    ],
    rows: data.map((r) => [
      r.day,
      accountLabel(r.gl_code, r.gl_name),
      r.opening,
      r.cash_in,
      r.cash_out,
      r.closing,
    ]),
    numericColumns: [2, 3, 4, 5],
  });

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t("journal.daily_cash")}</h3>
          <p className="text-xs text-muted-foreground">{t("journal.daily_cash_hint")}</p>
        </div>
        <ExportButtons
          build={build}
          projectCode={projectCode}
          report="DailyCashPosition"
          disabled={!data.length}
        />
      </div>
      <PeriodFilter
        from={from}
        to={to}
        onChange={(f, tt) => {
          setFrom(f);
          setTo(tt);
        }}
      />
      {latest.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {latest.map((a) => (
            <div key={a.label} className="rounded-xl border border-border bg-background p-4">
              <div className="text-xs text-muted-foreground">{a.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                <Money v={a.closing} />
              </div>
            </div>
          ))}
        </div>
      )}
      <StateLine loading={loading} error={error} empty={!loading && !error && !data.length} />
      {!loading && !error && data.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className={thCls}>{t("journal.col.date")}</th>
                <th className={thCls}>{t("journal.col.account")}</th>
                <th className={thNumCls}>{t("journal.col.opening")}</th>
                <th className={thNumCls}>{t("journal.col.in")}</th>
                <th className={thNumCls}>{t("journal.col.out")}</th>
                <th className={thNumCls}>{t("journal.col.closing")}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={`${r.day}-${r.gl_code}`} className="border-b border-border/50">
                  <td className={txtCls}>{r.day}</td>
                  <td className={txtCls}>{accountLabel(r.gl_code, r.gl_name)}</td>
                  <td className={numCls}>
                    <Money v={r.opening} />
                  </td>
                  <td className={`${numCls} text-success`}>{formatAmount(r.cash_in, 2)}</td>
                  <td className={numCls}>{formatAmount(r.cash_out, 2)}</td>
                  <td className={`${numCls} font-semibold`}>
                    <Money v={r.closing} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
