// =====================================================================
// BudgetLineActualsModal — doctrine-grade drill-down for a budget line.
// Money is reported by account CODE, so every figure here is the code's
// rollup (matching the grid badge and the dashboards), sourced from the
// ledger layer only:
//   Actual    = incurred costs (v_ledger_transactions, entry_kind='actual')
//   Committed = issued but not consumed (entry_kind='commitment' — POs)
//   Paid      = cash out the door (canonical payments ledger, resolved to
//               the account code through each payment's source row)
// =====================================================================
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal } from "@/components/Modal";
import { SarAmount } from "@/components/ui/currency";
import { supabase } from "@/integrations/supabase/client";
import { Receipt, ShoppingCart, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";

export type Focus = "actual" | "committed" | "paid";

type LedgerRow = {
  key: string;
  at: string;
  counterparty: string | null;
  reference: string | null;
  sourceType: string;
  status: string | null;
  amount: number;
};

type PaymentRow = {
  id: string;
  date: string | null;
  method: string | null;
  sourceType: string;
  amount: number;
};

/** Resolves a payment's source row to its budget account code. Shared with
 *  the Reports → Actual Paid tab (reports.tsx PaidReport). */
export const SOURCE_TABLE_BY_TYPE: Record<string, string> = {
  invoice: "invoices",
  purchase_order: "purchase_orders",
  po: "purchase_orders",
  payroll: "payroll",
  cash_advance_receipt: "cash_advance_receipts",
  cash_advance: "cash_advance_receipts",
  petty_cash: "cash_advance_receipts",
  receipt: "cash_advance_receipts",
  overtime: "overtime_entries",
  per_diem: "per_diem_ledger",
};

export function BudgetLineActualsModal({
  lineId,
  projectId,
  lineLabel,
  focus,
  onClose,
}: {
  lineId: string;
  projectId: string;
  lineLabel: string;
  focus: Focus;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [mainCode, setMainCode] = useState<string | null>(null);
  const [incurred, setIncurred] = useState<LedgerRow[]>([]);
  const [commitments, setCommitments] = useState<LedgerRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);

      // Resolve the line's account code — the doctrine reporting key.
      const bl = await supabase
        .from("v_active_budget_lines" as any)
        .select("main_code")
        .eq("id", lineId)
        .maybeSingle();
      const code = ((bl.data as any)?.main_code as string | null | undefined) ?? null;
      if (cancelled) return;
      setMainCode(code);
      if (!code) {
        setIncurred([]);
        setCommitments([]);
        setPayments([]);
        setLoading(false);
        return;
      }

      const [ledgerRes, payRes] = await Promise.all([
        (supabase.from as any)("v_ledger_transactions")
          .select(
            "source_type, source_id, entry_kind, entry_date, amount, counterparty, reference, status",
          )
          .eq("project_id", projectId)
          .eq("budget_code", code)
          .order("entry_date", { ascending: false }),
        supabase
          .from("payments")
          .select("id, source_type, source_id, payment_date, amount, method")
          .eq("project_id", projectId),
      ]);

      const ledgerRows = ((ledgerRes.data ?? []) as any[]).map((r) => ({
        key: `${r.source_type}:${r.source_id}:${r.entry_date}`,
        at: String(r.entry_date ?? ""),
        counterparty: (r.counterparty as string | null) ?? null,
        reference: (r.reference as string | null) ?? null,
        sourceType: String(r.source_type ?? ""),
        status: (r.status as string | null) ?? null,
        amount: Number(r.amount) || 0,
      }));

      // Paid: resolve each payment's budget code through its source row.
      const payRows = (payRes.data ?? []) as any[];
      const idsByTable = new Map<string, Set<string>>();
      for (const p of payRows) {
        const table = SOURCE_TABLE_BY_TYPE[String(p.source_type ?? "")];
        if (!table || !p.source_id) continue;
        let set = idsByTable.get(table);
        if (!set) idsByTable.set(table, (set = new Set()));
        set.add(p.source_id);
      }
      const codeBySourceId = new Map<string, string>();
      await Promise.all(
        [...idsByTable.entries()].map(async ([table, ids]) => {
          const { data } = await supabase
            .from(table as any)
            .select("id, budget_code")
            .in("id", [...ids]);
          for (const r of (data ?? []) as any[]) {
            codeBySourceId.set(r.id, String(r.budget_code ?? ""));
          }
        }),
      );

      if (cancelled) return;
      setIncurred(ledgerRows.filter((r) => ledgerKind(r) === "actual"));
      setCommitments(ledgerRows.filter((r) => ledgerKind(r) === "commitment"));
      setPayments(
        payRows
          .filter((p) => p.source_id && codeBySourceId.get(p.source_id) === code)
          .map((p) => ({
            id: p.id,
            date: (p.payment_date as string | null) ?? null,
            method: (p.method as string | null) ?? null,
            sourceType: String(p.source_type ?? ""),
            amount: Number(p.amount) || 0,
          }))
          .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [lineId, projectId]);

  const totals = useMemo(
    () => ({
      actual: incurred.reduce((s, r) => s + r.amount, 0),
      committed: commitments.reduce((s, r) => s + r.amount, 0),
      paid: payments.reduce((s, r) => s + r.amount, 0),
    }),
    [incurred, commitments, payments],
  );

  return (
    <Modal onClose={onClose} title={`${t("budgetlineactualsmodal.breakdown")} · ${lineLabel}`}>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {(
          [
            ["actual", totals.actual, "text-success"],
            ["committed", totals.committed, "text-warning"],
            ["paid", totals.paid, "text-info"],
          ] as const
        ).map(([key, value, tone]) => (
          <div
            key={key}
            className={`rounded-lg border p-3 ${
              focus === key ? "border-border bg-surface-2 ring-1 ring-brand/40" : "border-border"
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t(`budgetlineactualsmodal.${key}`)}
            </div>
            <div className={`text-lg font-semibold ${tone}`}>
              <SarAmount amount={value} />
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          {t("budgetlineactualsmodal.loading_breakdown")}
        </div>
      ) : (
        <div className="space-y-5 text-sm">
          <Section
            icon={<Receipt className="size-4" />}
            title={t("budgetlineactualsmodal.incurred_actuals")}
            total={totals.actual}
            empty={incurred.length === 0}
          >
            {incurred.map((r) => (
              <Row
                key={r.key}
                left={r.counterparty ?? r.reference ?? r.sourceType}
                sub={`${r.at.slice(0, 10)} · ${r.sourceType}${r.status ? ` · ${r.status}` : ""}`}
                amount={r.amount}
              />
            ))}
          </Section>

          <Section
            icon={<ShoppingCart className="size-4" />}
            title={t("budgetlineactualsmodal.open_commitments")}
            total={totals.committed}
            empty={commitments.length === 0}
          >
            {commitments.map((r) => (
              <Row
                key={r.key}
                left={r.counterparty ?? r.reference ?? r.sourceType}
                sub={`${r.at.slice(0, 10)} · ${r.reference ?? r.sourceType}${r.status ? ` · ${r.status}` : ""}`}
                amount={r.amount}
              />
            ))}
          </Section>

          <Section
            icon={<Wallet className="size-4" />}
            title={t("budgetlineactualsmodal.payments_made")}
            total={totals.paid}
            empty={payments.length === 0}
          >
            {payments.map((r) => (
              <Row
                key={r.id}
                left={r.method ?? r.sourceType}
                sub={`${r.date ?? "—"} · ${r.sourceType}`}
                amount={r.amount}
              />
            ))}
          </Section>

          {!incurred.length && !commitments.length && !payments.length && (
            <div className="text-center text-muted-foreground py-6">
              {t("budgetlineactualsmodal.no_ledger_entries_yet")}
              {mainCode ? ` (${mainCode})` : ""}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ledgerKind(r: { sourceType: string } & Record<string, unknown>): string {
  return String((r as any).entry_kind ?? "");
}

function Section({
  icon,
  title,
  total,
  empty,
  children,
}: {
  icon: ReactNode;
  title: string;
  total: number;
  empty: boolean;
  children: ReactNode;
}) {
  if (empty) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          {icon} {title}
        </div>
        <div className="text-xs font-semibold">
          <SarAmount amount={total} />
        </div>
      </div>
      <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function Row({ left, sub, amount }: { left: string; sub?: string; amount: number }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-surface/40">
      <div className="min-w-0">
        <div className="truncate font-medium">{left}</div>
        {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
      </div>
      <div className="tabular-nums font-semibold shrink-0">
        <SarAmount amount={amount} />
      </div>
    </div>
  );
}
