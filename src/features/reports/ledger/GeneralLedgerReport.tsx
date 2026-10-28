// =====================================================================
// General Ledger (R01-R04): double-entry lines per account with Debit,
// Credit and Running balance. Every line carries party, budget code and
// reference; the description is "document type — name — role / instalment".
// Funding, petty cash and WHT remittances appear as their own entries.
// Totals are Σ debit and Σ credit only — never a mixed "amount" total.
// =====================================================================
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/AppShell";
import { formatAmount } from "@/lib/format-number";
import { groupByAccount, ledgerTotals, type GeneralLedgerLine } from "@/lib/ledger-calc";
import { useActiveProject, useGeneralLedger, useTrialBalance } from "./ledger-data";
import { transactionFromLedgerLine } from "./ledger-drawer";
import { GlTransactionDrawer } from "@/features/reports/gl-transactions/GlTransactionDrawer";
import type { GlTransaction } from "@/features/reports/gl-transactions/gl-transactions-data";
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

export function GeneralLedgerReport({
  initialAccountId = null,
  initialFrom = "",
  initialTo = "",
  embedded = false,
}: {
  initialAccountId?: string | null;
  initialFrom?: string;
  initialTo?: string;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const { projectId, organizationId, projectCode, projectName } = useActiveProject();
  // G09: a line opens the transaction drawer of its document (184)
  const [selected, setSelected] = useState<GlTransaction | null>(null);
  const open = (l: GeneralLedgerLine) =>
    setSelected(transactionFromLedgerLine(l, { organizationId, projectId }));
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [accountId, setAccountId] = useState<string | null>(initialAccountId);
  const [search, setSearch] = useState("");
  const accounts = useTrialBalance(projectId, "", "");
  const { data, loading, error } = useGeneralLedger(projectId, from, to, accountId);

  const lines = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((l) =>
      [l.party, l.budget_code, l.reference, l.description, l.entry_ref]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [data, search]);
  const groups = useMemo(() => groupByAccount(lines), [lines]);
  const totals = ledgerTotals(lines);
  const phase = data[0]?.phase;

  const eventLabel = (l: GeneralLedgerLine) =>
    t(`journal.event.${l.event_type}`, {
      defaultValue: t(`reconcile.event.${l.event_type}`, { defaultValue: l.event_type }),
    });

  const build = () => ({
    title: t("journal.general_ledger"),
    subtitle: `${projectCode ?? ""} ${projectName} · ${from || "…"} → ${to || "…"}`,
    headers: [
      t("journal.col.account"),
      t("journal.col.date"),
      t("journal.col.entry"),
      t("journal.col.type"),
      t("journal.col.description"),
      t("journal.col.party"),
      t("journal.col.budget_code"),
      t("journal.col.reference"),
      t("journal.col.department"),
      t("journal.col.status"),
      t("journal.col.qpe"),
      t("journal.col.debit"),
      t("journal.col.credit"),
      t("journal.col.running_balance"),
    ],
    rows: lines.map((l) => [
      accountLabel(l.gl_code, l.gl_name),
      l.entry_date,
      l.entry_ref ?? "",
      eventLabel(l),
      l.description ?? "",
      l.party ?? "",
      l.budget_code ?? "",
      l.reference ?? "",
      l.department ?? "",
      l.status ?? "",
      l.qpe_eligible ? t("journal.yes") : t("journal.no"),
      l.debit,
      l.credit,
      l.running_balance,
    ]),
    numericColumns: [11, 12, 13],
  });

  return (
    <Panel className={embedded ? "mt-4" : undefined}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t("journal.general_ledger")}</h3>
          <p className="text-xs text-muted-foreground">{t("journal.general_ledger_hint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <PhaseBadge phase={phase} />
          <ExportButtons
            build={build}
            projectCode={projectCode}
            report="GeneralLedger"
            disabled={!lines.length}
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
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("journal.col.account")}
          <select
            value={accountId ?? ""}
            onChange={(e) => setAccountId(e.target.value || null)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            <option value="">{t("journal.all_accounts")}</option>
            {accounts.data.map((a) => (
              <option key={a.gl_account_id} value={a.gl_account_id}>
                {accountLabel(a.gl_code, a.gl_name)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("journal.search")}
          <input
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-56 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </label>
      </PeriodFilter>

      <StateLine loading={loading} error={error} empty={!loading && !error && !lines.length} />
      {!loading && !error && lines.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className={thCls}>{t("journal.col.date")}</th>
                <th className={thCls}>{t("journal.col.entry")}</th>
                <th className={thCls}>{t("journal.col.description")}</th>
                <th className={thCls}>{t("journal.col.party")}</th>
                <th className={thCls}>{t("journal.col.budget_code")}</th>
                <th className={thCls}>{t("journal.col.reference")}</th>
                <th className={thCls}>{t("journal.col.status")}</th>
                <th className={thNumCls}>{t("journal.col.debit")}</th>
                <th className={thNumCls}>{t("journal.col.credit")}</th>
                <th className={thNumCls}>{t("journal.col.running_balance")}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([acc, ls]) => {
                const sub = ledgerTotals(ls);
                const last = ls[ls.length - 1];
                return (
                  <Fragment key={acc}>
                    <tr className="bg-muted/50">
                      <td colSpan={10} className="px-3 py-2 font-semibold">
                        {accountLabel(ls[0].gl_code, ls[0].gl_name)}
                      </td>
                    </tr>
                    {ls.map((l) => (
                      <tr
                        key={`${l.event_key}-${l.entry_seq}-${l.line_no}`}
                        onClick={() => open(l)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") open(l);
                        }}
                        tabIndex={0}
                        title={t("reconcile.gl.openHint")}
                        className={`cursor-pointer border-b border-border/50 hover:bg-muted/60 ${l.is_reversal ? "text-muted-foreground" : ""}`}
                      >
                        <td className={txtCls}>{l.entry_date}</td>
                        <td className={txtCls}>{l.entry_ref ?? eventLabel(l)}</td>
                        <td className="px-3 py-2 min-w-64">{l.description}</td>
                        <td className={txtCls}>{l.party ?? "—"}</td>
                        <td className={txtCls}>{l.budget_code ?? "—"}</td>
                        <td className={txtCls}>{l.reference ?? "—"}</td>
                        <td className={txtCls}>{l.status ?? "—"}</td>
                        <td className={numCls}>
                          <Money v={l.debit} blankZero />
                        </td>
                        <td className={numCls}>
                          <Money v={l.credit} blankZero />
                        </td>
                        <td className={numCls}>
                          <Money v={l.running_balance} />
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b border-border">
                      <td colSpan={7} className="px-3 py-2 text-end text-xs text-muted-foreground">
                        {t("journal.account_total")}
                      </td>
                      <td className={`${numCls} font-semibold`}>{formatAmount(sub.debit, 2)}</td>
                      <td className={`${numCls} font-semibold`}>{formatAmount(sub.credit, 2)}</td>
                      <td className={`${numCls} font-semibold`}>
                        <Money v={last.running_balance} />
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td colSpan={7} className="px-3 py-2 text-end">
                  {t("journal.total")}{" "}
                  <span className={totals.balanced ? "text-success" : "text-destructive"}>
                    ({totals.balanced ? t("journal.balanced") : t("journal.not_balanced")})
                  </span>
                </td>
                <td className={numCls}>{formatAmount(totals.debit, 2)}</td>
                <td className={numCls}>{formatAmount(totals.credit, 2)}</td>
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
