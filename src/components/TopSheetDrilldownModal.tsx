// =====================================================================
// TopSheetDrilldownModal — transaction-level drilldown for ONE account
// cell. Rows are sourced from the SAME canonical inputs the report was
// built with (ledger + paid + shared makeTxnResolver), so a cell and its
// drilldown always agree to the halala.
//   budget    → contributing budget lines (lineTotalSAR)
//   committed → ledger entry_kind='commitment' (Cancelled ignored)
//   actual    → ledger entry_kind='actual' (incurred)
//   paid      → payments ledger entries
//   variance  → budget lines (+) and incurred actuals (−)
// =====================================================================
import { formatDate } from "@/lib/date-format";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStore, lineTotalSAR } from "@/lib/store";
import { inRange, type DateRange } from "@/lib/date-range";
import { Modal } from "@/components/Modal";
import { SarAmount } from "@/components/ui/currency";
import { makeTxnResolver, type TopsheetAccount } from "@/lib/topsheet-report";
import {
  ledgerSourceLabel,
  type CanonicalLedgerEntry,
  type CanonicalPaidEntry,
} from "@/lib/canonical-ledger";

export type DrilldownKind = "budget" | "committed" | "actual" | "paid" | "variance";

type DrillRow = {
  key: string;
  date: string | null;
  source: string;
  reference: string | null;
  description: string;
  amount: number;
};

export function TopSheetDrilldownModal({
  accountCode,
  accountDescription,
  kind,
  range,
  accounts,
  ledger,
  paid,
  onClose,
}: {
  accountCode: string;
  accountDescription: string;
  kind: DrilldownKind;
  range?: DateRange;
  accounts: TopsheetAccount[];
  ledger: CanonicalLedgerEntry[];
  paid: CanonicalPaidEntry[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const budget = useStore((s) => s.budget);

  const resolveTxn = useMemo(() => makeTxnResolver(accounts, budget), [accounts, budget]);

  const rows = useMemo<DrillRow[]>(() => {
    const out: DrillRow[] = [];
    const inThis = (raw: string | null | undefined) => resolveTxn(raw) === accountCode;

    const pushBudgetLines = (sign: 1 | -1) => {
      for (const l of budget) {
        if (l.excluded) continue;
        if (resolveTxn(l.topsheetCode || l.mainCode || l.headerCode) !== accountCode) continue;
        const total = lineTotalSAR(l); // SAR — same basis as the Budget column
        out.push({
          key: `bl-${sign}-${l.id}`,
          date: null,
          source: t("topsheetdrilldownmodal.budget_line", "Budget line"),
          reference: l.mainCode || null,
          description: l.description || l.id,
          amount: sign * total,
        });
      }
    };

    switch (kind) {
      case "budget": {
        pushBudgetLines(1);
        break;
      }
      case "committed": {
        for (const e of ledger) {
          if (e.entryKind !== "commitment") continue;
          if (e.status === "Cancelled") continue;
          if (range && !inRange(e.entryDate, range)) continue;
          if (!inThis(e.budgetCode)) continue;
          out.push({
            key: `led-c-${e.sourceType}-${e.sourceId}`,
            date: e.entryDate,
            source: ledgerSourceLabel(e.sourceType),
            reference: e.reference,
            description: e.description ?? e.counterparty ?? "",
            amount: e.amount,
          });
        }
        break;
      }
      case "actual": {
        for (const e of ledger) {
          if (e.entryKind !== "actual") continue;
          if (range && !inRange(e.entryDate, range)) continue;
          if (!inThis(e.budgetCode)) continue;
          out.push({
            key: `led-a-${e.sourceType}-${e.sourceId}`,
            date: e.entryDate,
            source: ledgerSourceLabel(e.sourceType),
            reference: e.reference,
            description: e.description ?? e.counterparty ?? "",
            amount: e.amount,
          });
        }
        break;
      }
      case "paid": {
        for (const p of paid) {
          if (range && !inRange(p.date, range)) continue;
          if (!inThis(p.budgetCode)) continue;
          out.push({
            key: `pay-${p.id}`,
            date: p.date,
            source: t("topsheetdrilldownmodal.payment", "Payment"),
            reference: p.method
              ? `${ledgerSourceLabel(p.sourceType)} · ${p.method}`
              : ledgerSourceLabel(p.sourceType),
            description: p.method ?? "",
            amount: p.amount,
          });
        }
        break;
      }
      case "variance": {
        pushBudgetLines(1);
        for (const e of ledger) {
          if (e.entryKind !== "actual") continue;
          if (range && !inRange(e.entryDate, range)) continue;
          if (!inThis(e.budgetCode)) continue;
          out.push({
            key: `led-v-${e.sourceType}-${e.sourceId}`,
            date: e.entryDate,
            source: ledgerSourceLabel(e.sourceType),
            reference: e.reference,
            description: e.description ?? e.counterparty ?? "",
            amount: -e.amount,
          });
        }
        break;
      }
    }
    out.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    return out;
  }, [accountCode, kind, range, budget, ledger, paid, resolveTxn, t]);

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const KIND_LABEL: Record<DrilldownKind, string> = {
    budget: t("report.budget"),
    committed: t("report.committed"),
    actual: t("report.actual", "Actual"),
    paid: t("report.paid", "Paid"),
    variance: t("report.variance"),
  };

  return (
    <Modal onClose={onClose} title={`${accountCode} · ${accountDescription} — ${KIND_LABEL[kind]}`}>
      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {t("topsheetdrilldownmodal.no_transactions", "No transactions for this cell.")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-start text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">{t("topsheetdrilldownmodal.date", "Date")}</th>
                <th className="py-2 pr-3">{t("topsheetdrilldownmodal.source", "Source")}</th>
                <th className="py-2 pr-3">{t("topsheetdrilldownmodal.reference", "Reference")}</th>
                <th className="py-2 pr-3">
                  {t("topsheetdrilldownmodal.description", "Description")}
                </th>
                <th className="py-2 text-end">
                  {t("topsheetdrilldownmodal.amount_sar", "Amount (SAR)")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border/60">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                    {formatDate(r.date) || "—"}
                  </td>
                  <td className="py-2 pr-3">{r.source}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.reference ?? "—"}</td>
                  <td className="py-2 pr-3">{r.description}</td>
                  <td
                    className={`py-2 text-end font-mono ${
                      r.amount < 0 ? "text-destructive" : "text-foreground"
                    }`}
                  >
                    <SarAmount amount={r.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2 pr-3" colSpan={4}>
                  {t("topsheetdrilldownmodal.total", "Total")}
                </td>
                <td className="py-2 text-end font-mono">
                  <SarAmount amount={total} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Modal>
  );
}
