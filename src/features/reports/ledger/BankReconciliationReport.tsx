// =====================================================================
// Bank reconciliation (A13): statement balance, book balance (account 9100
// in the ledger), the difference and the unmatched items that explain it.
// Also records the bank movements that have no document of their own
// (A10 petty cash return, A11 WHT remittance, VAT recovery, bank charges).
// =====================================================================
import { formatDate } from "@/lib/date-format";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { z } from "zod";
import { Panel } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { formatAmount } from "@/lib/format-number";
import { reconciliationStatus } from "@/lib/ledger-calc";
import {
  addStatementLine,
  addTreasuryMovement,
  deleteStatementLine,
  loadFloats,
  matchStatementLine,
  TREASURY_KINDS,
  useActiveProject,
  useBankReconciliation,
  type FloatOption,
  type TreasuryKind,
} from "./ledger-data";
import { Money, numCls, StateLine, thCls, thNumCls, txtCls } from "./ledger-ui";

const today = () => new Date().toISOString().slice(0, 10);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const statementSchema = z.object({
  date: isoDate,
  amount: z
    .number()
    .finite()
    .refine((v) => v !== 0 && Math.abs(v) < 1e12),
  balance: z.number().finite().nullable(),
  reference: z.string().trim().max(200),
  narrative: z.string().trim().max(500),
});
const treasurySchema = z.object({
  kind: z.enum([
    "wht_remittance",
    "vat_payment",
    "vat_recovery",
    "petty_cash_return",
    "bank_charge",
  ]),
  date: isoDate,
  amount: z.number().finite().positive().max(1e12),
  cashAdvanceId: z.string().uuid().nullable(),
  budgetCode: z.string().trim().max(64),
  reference: z.string().trim().max(200),
});

const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";
const btnCls =
  "inline-flex h-9 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-brand-foreground disabled:opacity-50";

export function BankReconciliationReport() {
  const { t } = useTranslation();
  const { projectId, organizationId } = useActiveProject();
  const [asOf, setAsOf] = useState(today());
  const { data, loading, error, reload } = useBankReconciliation(projectId, asOf);
  const [busy, setBusy] = useState(false);

  // statement line form
  const [sDate, setSDate] = useState(today());
  const [sAmount, setSAmount] = useState("");
  const [sBalance, setSBalance] = useState("");
  const [sRef, setSRef] = useState("");
  const [sNarr, setSNarr] = useState("");
  // treasury form
  const [kind, setKind] = useState<TreasuryKind>("wht_remittance");
  const [tDate, setTDate] = useState(today());
  const [tAmount, setTAmount] = useState("");
  const [tFloat, setTFloat] = useState("");
  const [tCode, setTCode] = useState("");
  const [tRef, setTRef] = useState("");
  const [floats, setFloats] = useState<FloatOption[]>([]);

  useEffect(() => {
    if (!projectId) return;
    loadFloats(projectId)
      .then(setFloats)
      .catch(() => setFloats([]));
  }, [projectId]);

  const guard = async (fn: () => Promise<void>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onAddStatement = () => {
    const parsed = statementSchema.safeParse({
      date: sDate,
      amount: Number(sAmount),
      balance: sBalance.trim() === "" ? null : Number(sBalance),
      reference: sRef,
      narrative: sNarr,
    });
    if (!parsed.success || !projectId || !organizationId) {
      toast.error(t("journal.invalid_input"));
      return;
    }
    void guard(async () => {
      await addStatementLine({ projectId, organizationId, ...parsed.data });
      setSAmount("");
      setSBalance("");
      setSRef("");
      setSNarr("");
    }, t("journal.saved"));
  };

  const onAddTreasury = () => {
    const parsed = treasurySchema.safeParse({
      kind,
      date: tDate,
      amount: Number(tAmount),
      cashAdvanceId: kind === "petty_cash_return" && tFloat ? tFloat : null,
      budgetCode: tCode,
      reference: tRef,
    });
    if (
      !parsed.success ||
      !projectId ||
      !organizationId ||
      (kind === "petty_cash_return" && !parsed.data.cashAdvanceId)
    ) {
      toast.error(t("journal.invalid_input"));
      return;
    }
    void guard(async () => {
      await addTreasuryMovement({ projectId, organizationId, ...parsed.data });
      setTAmount("");
      setTRef("");
    }, t("journal.saved"));
  };

  const status = data ? reconciliationStatus(data.unexplained) : null;
  const statusCls =
    status === "ok" ? "text-success" : status === "rounding" ? "text-warning" : "text-destructive";

  return (
    <div className="space-y-4">
      <Panel>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{t("journal.bank_rec")}</h3>
            <p className="text-xs text-muted-foreground">{t("journal.bank_rec_hint")}</p>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("journal.as_of")}
            <Input
              type="date"
              value={asOf}
              className="h-9 w-40"
              onChange={(e) => setAsOf(e.target.value)}
            />
          </label>
        </div>
        <StateLine loading={loading} error={error} empty={false} />
        {data && !loading && (
          <div className="grid gap-3 sm:grid-cols-4">
            <Card label={t("journal.statement_balance")} v={data.statement_balance} />
            <Card label={t("journal.book_balance")} v={data.book_balance} />
            <Card label={t("journal.difference")} v={data.difference} />
            <div className="rounded-xl border border-border bg-background p-4">
              <div className="text-xs text-muted-foreground">{t("journal.unexplained")}</div>
              <div className={`mt-1 text-xl font-semibold tabular-nums ${statusCls}`}>
                {formatAmount(data.unexplained, 2)}
              </div>
              <div className={`text-xs ${statusCls}`}>{t(`journal.rec_status.${status}`)}</div>
            </div>
          </div>
        )}
      </Panel>

      {data && !loading && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <h4 className="mb-1 font-semibold">{t("journal.unmatched_book")}</h4>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("journal.total")}: {formatAmount(data.unmatched_book_total, 2)}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className={thCls}>{t("journal.col.date")}</th>
                    <th className={thCls}>{t("journal.col.description")}</th>
                    <th className={thNumCls}>{t("journal.col.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unmatched_book.map((b) => (
                    <tr key={b.event_key} className="border-b border-border/50">
                      <td className={txtCls}>{formatDate(b.entry_date)}</td>
                      <td className="px-3 py-2">{b.description}</td>
                      <td className={numCls}>
                        <Money v={b.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel>
            <h4 className="mb-1 font-semibold">{t("journal.unmatched_statement")}</h4>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("journal.total")}: {formatAmount(data.unmatched_statement_total, 2)}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className={thCls}>{t("journal.col.date")}</th>
                    <th className={thCls}>{t("journal.col.reference")}</th>
                    <th className={thNumCls}>{t("journal.col.amount")}</th>
                    <th className={thCls}>{t("journal.match_to")}</th>
                    <th className={thCls} />
                  </tr>
                </thead>
                <tbody>
                  {data.unmatched_statement.map((s) => (
                    <tr key={s.id} className="border-b border-border/50">
                      <td className={txtCls}>{formatDate(s.value_date)}</td>
                      <td className="px-3 py-2">
                        {[s.reference, s.narrative].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className={numCls}>
                        <Money v={s.amount} />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={`${selectCls} max-w-52`}
                          value=""
                          disabled={busy}
                          onChange={(e) =>
                            e.target.value &&
                            void guard(
                              () => matchStatementLine(s.id, e.target.value),
                              t("journal.matched"),
                            )
                          }
                        >
                          <option value="">{t("journal.choose_entry")}</option>
                          {data.unmatched_book.map((b) => (
                            <option key={b.event_key} value={b.event_key}>
                              {formatDate(b.entry_date)} · {formatAmount(b.amount, 2)} ·{" "}
                              {b.party ?? ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          aria-label={t("journal.delete")}
                          disabled={busy}
                          onClick={() =>
                            void guard(() => deleteStatementLine(s.id), t("journal.deleted"))
                          }
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h4 className="mb-3 font-semibold">{t("journal.add_statement_line")}</h4>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("journal.col.date")}>
              <Input
                type="date"
                value={sDate}
                className="h-9 w-40"
                onChange={(e) => setSDate(e.target.value)}
              />
            </Field>
            <Field label={t("journal.amount_signed")}>
              <Input
                type="number"
                step="0.01"
                value={sAmount}
                className="h-9 w-36"
                onChange={(e) => setSAmount(e.target.value)}
              />
            </Field>
            <Field label={t("journal.statement_balance_col")}>
              <Input
                type="number"
                step="0.01"
                value={sBalance}
                className="h-9 w-36"
                onChange={(e) => setSBalance(e.target.value)}
              />
            </Field>
            <Field label={t("journal.col.reference")}>
              <Input
                value={sRef}
                maxLength={200}
                className="h-9 w-36"
                onChange={(e) => setSRef(e.target.value)}
              />
            </Field>
            <Field label={t("journal.narrative")}>
              <Input
                value={sNarr}
                maxLength={500}
                className="h-9 w-48"
                onChange={(e) => setSNarr(e.target.value)}
              />
            </Field>
            <button type="button" className={btnCls} disabled={busy} onClick={onAddStatement}>
              {t("journal.add")}
            </button>
          </div>
        </Panel>
        <Panel>
          <h4 className="mb-1 font-semibold">{t("journal.record_movement")}</h4>
          <p className="mb-3 text-xs text-muted-foreground">{t("journal.record_movement_hint")}</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("journal.col.type")}>
              <select
                className={selectCls}
                value={kind}
                onChange={(e) => setKind(e.target.value as TreasuryKind)}
              >
                {TREASURY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`journal.event.${k}`, { defaultValue: t(`reconcile.event.${k}`) })}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("journal.col.date")}>
              <Input
                type="date"
                value={tDate}
                className="h-9 w-40"
                onChange={(e) => setTDate(e.target.value)}
              />
            </Field>
            <Field label={t("journal.col.amount")}>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={tAmount}
                className="h-9 w-36"
                onChange={(e) => setTAmount(e.target.value)}
              />
            </Field>
            {kind === "petty_cash_return" && (
              <Field label={t("journal.float")}>
                <select
                  className={selectCls}
                  value={tFloat}
                  onChange={(e) => setTFloat(e.target.value)}
                >
                  <option value="">{t("journal.choose_float")}</option>
                  {floats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.holder}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {kind === "bank_charge" && (
              <Field label={t("journal.col.budget_code")}>
                <Input
                  value={tCode}
                  maxLength={64}
                  className="h-9 w-28"
                  onChange={(e) => setTCode(e.target.value)}
                />
              </Field>
            )}
            <Field label={t("journal.col.reference")}>
              <Input
                value={tRef}
                maxLength={200}
                className="h-9 w-36"
                onChange={(e) => setTRef(e.target.value)}
              />
            </Field>
            <button type="button" className={btnCls} disabled={busy} onClick={onAddTreasury}>
              {t("journal.add")}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Card({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">
        <Money v={v} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
