// Section-level drilldown — expands a Top Sheet section into every account
// with Budget / Committed / Actual / Paid / Variance, plus the canonical
// transactions behind each figure. Rows are sourced from the SAME inputs
// the report was built with (canonical ledger + payments ledger + shared
// makeTxnResolver), so the modal can never disagree with the report.
import { formatDate } from "@/lib/date-format";
import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  Search,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { formatSAR, lineTotalSAR, useStore } from "@/lib/store";
import { inRange, type DateRange } from "@/lib/date-range";
import { downloadCSV } from "@/lib/export-csv";
import { GuardedButton } from "@/lib/permission-guard";
import { useTranslation } from "react-i18next";
import { makeTxnResolver, type TopSheetSection, type TopsheetAccount } from "@/lib/topsheet-report";
import {
  ledgerSourceLabel,
  type CanonicalLedgerEntry,
  type CanonicalPaidEntry,
} from "@/lib/canonical-ledger";

type Txn = {
  key: string;
  accountCode: string;
  date: string | null;
  source: string;
  reference: string;
  budgetCode: string | null;
  budget: number;
  committed: number;
  actual: number;
  paid: number;
};

export function TopSheetSectionDrilldownModal({
  section,
  accounts,
  ledger,
  paid,
  range,
  onClose,
}: {
  section: TopSheetSection;
  accounts: TopsheetAccount[];
  ledger: CanonicalLedgerEntry[];
  paid: CanonicalPaidEntry[];
  range?: DateRange;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const budget = useStore((s) => s.budget);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");

  const rowsByAccount = useMemo(() => {
    const resolveTxn = makeTxnResolver(accounts, budget);
    const sectionCodes = new Set(section.rows.map((r) => r.code));
    const map = new Map<string, Txn[]>();
    const push = (txn: Txn) => {
      const list = map.get(txn.accountCode);
      if (list) list.push(txn);
      else map.set(txn.accountCode, [txn]);
    };

    // Budget lines — the Budget column source (lineTotalSAR basis).
    for (const l of budget) {
      if (l.excluded) continue;
      const code = resolveTxn(l.topsheetCode || l.mainCode || l.headerCode);
      if (!code || !sectionCodes.has(code)) continue;
      push({
        key: `bl-${l.id}`,
        accountCode: code,
        date: null,
        source: t("topsheetdrilldownmodal.budget_line", "Budget line"),
        reference: l.mainCode || "",
        budgetCode: l.mainCode || null,
        budget: lineTotalSAR(l),
        committed: 0,
        actual: 0,
        paid: 0,
      });
    }

    // Canonical ledger — incurred actuals and open commitments.
    for (const e of ledger) {
      if (range && !inRange(e.entryDate, range)) continue;
      if (e.entryKind === "commitment" && e.status === "Cancelled") continue;
      const code = resolveTxn(e.budgetCode);
      if (!code || !sectionCodes.has(code)) continue;
      push({
        key: `led-${e.sourceType}-${e.sourceId}`,
        accountCode: code,
        date: e.entryDate,
        source: ledgerSourceLabel(e.sourceType),
        reference: e.description ?? e.counterparty ?? "",
        budgetCode: e.budgetCode,
        budget: 0,
        committed: e.entryKind === "commitment" ? e.amount : 0,
        actual: e.entryKind === "actual" ? e.amount : 0,
        paid: 0,
      });
    }

    // Payments ledger — cash out the door.
    for (const p of paid) {
      if (range && !inRange(p.date, range)) continue;
      const code = resolveTxn(p.budgetCode);
      if (!code || !sectionCodes.has(code)) continue;
      push({
        key: `pay-${p.id}`,
        accountCode: code,
        date: p.date,
        source: t("topsheetdrilldownmodal.payment", "Payment"),
        reference: p.method
          ? `${ledgerSourceLabel(p.sourceType)} · ${p.method}`
          : ledgerSourceLabel(p.sourceType),
        budgetCode: p.budgetCode,
        budget: 0,
        committed: 0,
        actual: 0,
        paid: p.amount,
      });
    }

    for (const list of map.values()) {
      list.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    }
    return map;
  }, [section, accounts, budget, ledger, paid, range, t]);

  const filtered = useMemo(() => {
    if (!query) return rowsByAccount;
    const q = query.toLowerCase();
    const out = new Map<string, Txn[]>();
    for (const [code, rows] of rowsByAccount) {
      const match = rows.filter(
        (r) =>
          r.source.toLowerCase().includes(q) ||
          r.reference.toLowerCase().includes(q) ||
          (r.budgetCode ?? "").toLowerCase().includes(q),
      );
      if (match.length > 0) out.set(code, match);
    }
    return out;
  }, [rowsByAccount, query]);

  const toggleAll = (expand: boolean) => {
    if (!expand) return setExpanded({});
    const next: Record<string, boolean> = {};
    for (const code of filtered.keys()) next[code] = true;
    setExpanded(next);
  };

  const exportSection = () => {
    const rows = [...rowsByAccount.entries()].flatMap(([code, txns]) =>
      txns.map((r) => ({
        [t("topsheetdrilldownmodal.account", "Account")]: code,
        [t("topsheetdrilldownmodal.date", "Date")]: r.date ?? "",
        [t("topsheetdrilldownmodal.source", "Source")]: r.source,
        [t("topsheetdrilldownmodal.reference", "Reference")]: r.reference,
        [t("topsheetsectiondrilldownmodal.budget_code")]: r.budgetCode ?? "",
        [t("report.budget")]: r.budget,
        [t("report.committed")]: r.committed,
        [t("report.actual", "Actual")]: r.actual,
        [t("report.paid", "Paid")]: r.paid,
      })),
    );
    downloadCSV(`topsheet-${section.key.toLowerCase()}.csv`, rows);
  };

  return (
    <Modal onClose={onClose} title={section.label}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <p className="text-xs text-muted-foreground mt-0.5">
          {section.rows.length} {t("topsheetsectiondrilldownmodal.accounts")}
          {range ? " · filtered" : ""}
        </p>
        <GuardedButton
          perm="reports.export"
          actionLabel="export section"
          onClick={exportSection}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-card hover:bg-card/80 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          CSV
        </GuardedButton>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
        {[
          [t("report.budget"), section.subtotal.budget],
          [t("report.committed"), section.subtotal.committed],
          [t("report.actual", "Actual"), section.subtotal.actual],
          [t("report.paid", "Paid"), section.subtotal.paid],
          [t("report.variance"), section.subtotal.variance],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-card rounded-lg p-2.5">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
              {label as string}
            </div>
            <div className="text-sm font-semibold tabular-nums mt-0.5">
              {formatSAR(value as number)}
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("topsheetsectiondrilldownmodal.filter_transactions")}
            className="w-full ps-8 pe-3 py-1.5 text-xs rounded-lg bg-card border border-border focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <button
          onClick={() => toggleAll(true)}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ChevronsUpDown className="w-3.5 h-3.5" /> {t("topsheetsectiondrilldownmodal.expand_all")}
        </button>
        <button
          onClick={() => toggleAll(false)}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ChevronsDownUp className="w-3.5 h-3.5" />{" "}
          {t("topsheetsectiondrilldownmodal.collapse_all")}
        </button>
      </div>

      {/* Account groups */}
      <div className="space-y-2 max-h-[55vh] overflow-y-auto pe-1">
        {[...filtered.entries()].map(([code, txns]) => {
          const open = expanded[code] ?? false;
          const account = accounts.find((a) => a.code === code);
          const row = section.rows.find((r) => r.code === code);
          const totals = txns.reduce(
            (acc, r) => ({
              budget: acc.budget + r.budget,
              committed: acc.committed + r.committed,
              actual: acc.actual + r.actual,
              paid: acc.paid + r.paid,
            }),
            { budget: 0, committed: 0, actual: 0, paid: 0 },
          );
          return (
            <div key={code} className="border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded((p) => ({ ...p, [code]: !open }))}
                className="w-full flex items-center justify-between px-3 py-2 bg-card hover:bg-card/70 transition-colors"
              >
                <span className="flex items-center gap-2">
                  {open ? (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                  <span className="font-mono text-[11px] text-muted-foreground">{code}</span>
                  <span className="text-xs font-medium">{account?.description ?? code}</span>
                </span>
                <span className="flex items-center gap-3 text-[11px] tabular-nums">
                  <span className="text-muted-foreground">
                    {t("report.budget")} {formatSAR(totals.budget)}
                  </span>
                  <span className="text-warning">
                    {t("report.committed")} {formatSAR(totals.committed)}
                  </span>
                  <span className="text-info">
                    {t("report.actual", "Actual")} {formatSAR(totals.actual)}
                  </span>
                  <span className="text-success">
                    {t("report.paid", "Paid")} {formatSAR(totals.paid)}
                  </span>
                  {row && (
                    <span
                      className={`font-semibold ${
                        row.variance < 0 ? "text-destructive" : "text-success"
                      }`}
                    >
                      {formatSAR(row.variance)}
                    </span>
                  )}
                </span>
              </button>
              {open && (
                <table className="w-full text-[11px]">
                  <thead className="text-[9px] uppercase tracking-wider text-muted-foreground bg-card">
                    <tr className="text-start">
                      <th className="px-3 py-1.5 text-start">
                        {t("topsheetdrilldownmodal.date", "Date")}
                      </th>
                      <th className="px-3 py-1.5 text-start">
                        {t("topsheetdrilldownmodal.source", "Source")}
                      </th>
                      <th className="px-3 py-1.5 text-start">
                        {t("topsheetdrilldownmodal.reference", "Reference")}
                      </th>
                      <th className="px-3 py-1.5 text-start">
                        {t("topsheetsectiondrilldownmodal.budget_code")}
                      </th>
                      <th className="px-3 py-1.5 text-end">{t("report.budget")}</th>
                      <th className="px-3 py-1.5 text-end">{t("report.committed")}</th>
                      <th className="px-3 py-1.5 text-end">{t("report.actual", "Actual")}</th>
                      <th className="px-3 py-1.5 text-end">{t("report.paid", "Paid")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((r) => (
                      <tr key={r.key} className="border-t border-border/60">
                        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                          {formatDate(r.date) || "—"}
                        </td>
                        <td className="px-3 py-1.5">{r.source}</td>
                        <td className="px-3 py-1.5">{r.reference || "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-[10px]">{r.budgetCode ?? "—"}</td>
                        <td className="px-3 py-1.5 text-end tabular-nums">
                          {r.budget ? formatSAR(r.budget) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-end tabular-nums">
                          {r.committed ? formatSAR(r.committed) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-end tabular-nums">
                          {r.actual ? formatSAR(r.actual) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-end tabular-nums">
                          {r.paid ? formatSAR(r.paid) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
