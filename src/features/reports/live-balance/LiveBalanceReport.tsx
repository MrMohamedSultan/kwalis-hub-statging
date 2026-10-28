// =====================================================================
// Live Balance — accruals (N02 / D10 / D11, decisions 15–16): cost incurred
// to date by each contract's accrual method against what was paid.
// =====================================================================
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Panel } from "@/components/AppShell";
import { Input, inputBaseClass } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";
import { formatDate, riyadhToday } from "@/lib/date-format";
import { HEADER_ACCOUNTS } from "@/lib/data";
import { useCan } from "@/lib/rbac";
import { useProjectLock } from "@/lib/project-lock";
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
import {
  ACCRUAL_METHODS,
  computeLiveBalance,
  groupLiveBalance,
  paidOnValueBasis,
  serviceAccrualInputs,
  sumLiveBalance,
  type AccrualMethod,
  type LiveBalanceGrouping,
} from "./live-balance";
import { useLiveBalanceData, useSaveAccrualMethod } from "./live-balance-data";

const GROUPINGS: LiveBalanceGrouping[] = ["none", "line", "department", "vendor"];
const MONEY = ["value", "incurred", "paid", "accrued", "prepaid", "remainingCommitment"] as const;

export function LiveBalanceReport() {
  const { t } = useTranslation();
  const { projectId } = useActiveProject();
  const q = useLiveBalanceData(projectId);
  const saveMethod = useSaveAccrualMethod(projectId);
  const can = useCan();
  const { locked } = useProjectLock();
  const canEdit = can("crew.manage") && !locked;
  const [asOf, setAsOf] = useState(riyadhToday());
  const [grouping, setGrouping] = useState<LiveBalanceGrouping>("none");

  const rows = useMemo(() => {
    const d = q.data;
    if (!d) return [];
    const contracts = d.contracts.map((c) =>
      computeLiveBalance(
        {
          id: c.id,
          ref: c.ref,
          party: c.party,
          budgetCode: c.budgetCode,
          value: c.gross,
          method: c.method,
          methodSuggested: c.methodSuggested,
          start: c.start,
          end: c.end,
          cancelledAt: c.cancelledAt,
          paid: paidOnValueBasis(
            c.payments.filter((p) => p.date && p.date <= asOf).reduce((a, p) => a + p.amount, 0),
            c.gross,
            c.net,
          ),
        },
        asOf,
        { dates: d.shootDates, fallbackDays: c.shootingDays || d.projectShootDays },
        { weekend: d.weekend },
      ),
    );
    // N02: vendor invoices / POs with a service period, evenly over the period.
    const paidBy = (kind: "invoice" | "po", id: string) =>
      (d.docPayments.get(`${kind}:${id}`) ?? [])
        .filter((p) => p.date && p.date <= asOf)
        .reduce((a, p) => a + p.amount, 0);
    const services = serviceAccrualInputs(d.invoices, d.pos, paidBy).map((c) =>
      computeLiveBalance(c, asOf, { dates: null }, { weekend: d.weekend }),
    );
    return [...contracts, ...services];
  }, [q.data, asOf]);
  const personOf = useMemo(
    () => new Map((q.data?.contracts ?? []).map((c) => [c.id, c.personId])),
    [q.data],
  );
  const headerName = useMemo(() => new Map(HEADER_ACCOUNTS.map((h) => [h.code, h.name])), []);
  const groups = useMemo(
    () =>
      groupLiveBalance(rows, grouping, {
        none: t("taxlive.common.all"),
        unassigned: t("taxlive.common.unassigned"),
        department: (code) => `${code} ${headerName.get(code) ?? ""}`.trim(),
      }),
    [rows, grouping, t, headerName],
  );
  const totals = useMemo(() => sumLiveBalance(rows), [rows]);
  const methodLabel = (m: AccrualMethod) => t(`taxlive.live.method.${m}`);

  const head = {
    ref: t("taxlive.live.col.ref"),
    party: t("taxlive.live.col.party"),
    code: t("taxlive.live.col.code"),
    value: t("taxlive.live.col.value"),
    method: t("taxlive.live.col.method"),
    start: t("taxlive.live.col.start"),
    end: t("taxlive.live.col.end"),
    totalDays: t("taxlive.live.col.totalDays"),
    elapsedDays: t("taxlive.live.col.elapsedDays"),
    incurred: t("taxlive.live.col.incurred"),
    paid: t("taxlive.live.col.paid"),
    accrued: t("taxlive.live.col.accrued"),
    prepaid: t("taxlive.live.col.prepaid"),
    remainingCommitment: t("taxlive.live.col.remainingCommitment"),
  };

  useReportExport(() =>
    q.isLoading
      ? null
      : {
          doc: {
            report: "Live Balance",
            title: t("taxlive.live.title"),
            subtitle: `${t("taxlive.live.asOf")}: ${formatDate(asOf)} · ${t("exports.currency")}: SAR`,
            sections: groups.map((g) => ({
              title: grouping === "none" ? undefined : g.label,
              columns: [
                { header: head.ref },
                { header: head.party },
                { header: head.code },
                { header: head.value, type: "money" as const },
                { header: head.method },
                { header: head.start, type: "date" as const },
                { header: head.end, type: "date" as const },
                { header: head.totalDays, type: "integer" as const },
                { header: head.elapsedDays, type: "integer" as const },
                { header: head.incurred, type: "money" as const },
                { header: head.paid, type: "money" as const },
                { header: head.accrued, type: "money" as const },
                { header: head.prepaid, type: "money" as const },
                { header: head.remainingCommitment, type: "money" as const },
              ],
              rows: g.rows.map((r) => [
                r.ref,
                r.source && r.source !== "contract"
                  ? `${r.party} (${t(`leftovers.live.source_${r.source}`)})`
                  : r.party,
                r.budgetCode ?? "",
                r.value,
                methodLabel(r.method),
                r.start,
                r.end,
                r.totalDays,
                r.elapsedDays,
                r.incurred,
                r.paid,
                r.accrued,
                r.prepaid,
                r.remainingCommitment,
              ]),
              totals: [
                [
                  t("taxlive.common.total"),
                  "",
                  "",
                  g.value,
                  "",
                  null,
                  null,
                  null,
                  null,
                  g.incurred,
                  g.paid,
                  g.accrued,
                  g.prepaid,
                  g.remainingCommitment,
                ],
              ],
            })),
          },
        },
  );

  const onMethod = async (contractId: string, v: string) => {
    const personId = personOf.get(contractId);
    if (!personId) return;
    try {
      await saveMethod(personId, v === "" ? null : (v as AccrualMethod));
      toast.success(t("taxlive.live.methodSaved"));
    } catch (e: any) {
      toast.error(e?.message ?? t("taxlive.common.saveFailed"));
    }
  };

  const balance = totals.accrued - totals.prepaid;
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t("taxlive.live.title")}</h3>
          <p className="max-w-3xl text-xs text-muted-foreground">{t("taxlive.live.hint")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("taxlive.live.asOf")}
            <DateInput
              value={asOf}
              className={cn(inputBaseClass, "h-9 w-40")}
              onChange={(v) => setAsOf(v || riyadhToday())}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("taxlive.live.groupBy")}
            <select
              value={grouping}
              onChange={(e) => setGrouping(e.target.value as LiveBalanceGrouping)}
              className="h-9 rounded-md border border-border bg-input ps-2 pe-8 text-sm text-foreground"
            >
              {GROUPINGS.map((g) => (
                <option key={g} value={g}>
                  {t(`taxlive.live.group.${g}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(["incurred", "paid"] as const).map((k) => (
          <div key={k} className="rounded-xl border border-border bg-surface p-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{head[k]}</div>
            <div dir="ltr" className="mt-1 text-lg font-semibold tabular-nums">
              <Money v={totals[k]} />
            </div>
          </div>
        ))}
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("taxlive.live.balance")}
          </div>
          <div
            dir="ltr"
            className={`mt-1 text-lg font-semibold tabular-nums ${balance > 0 ? "text-warning" : balance < 0 ? "text-brand" : ""}`}
          >
            <Money v={balance} />
          </div>
          <div className="text-xs text-muted-foreground">
            {balance >= 0 ? t("taxlive.live.accruedHint") : t("taxlive.live.prepaidHint")}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {head.remainingCommitment}
          </div>
          <div dir="ltr" className="mt-1 text-lg font-semibold tabular-nums">
            <Money v={totals.remainingCommitment} />
          </div>
        </div>
      </div>

      {q.data && !q.data.shootDates && rows.some((r) => r.method === "shoot_days") && (
        <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {t("taxlive.live.noSchedule")}
        </p>
      )}

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
                <th className={thCls}>{head.ref}</th>
                <th className={thCls}>{head.party}</th>
                <th className={thCls}>{head.code}</th>
                <th className={thNumCls}>{head.value}</th>
                <th className={thCls}>{head.method}</th>
                <th className={thCls}>{head.start}</th>
                <th className={thCls}>{head.end}</th>
                <th className={thNumCls}>{head.totalDays}</th>
                <th className={thNumCls}>{head.elapsedDays}</th>
                <th className={thNumCls}>{head.incurred}</th>
                <th className={thNumCls}>{head.paid}</th>
                <th className={thNumCls}>{head.accrued}</th>
                <th className={thNumCls}>{head.prepaid}</th>
                <th className={thNumCls}>{head.remainingCommitment}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {grouping !== "none" && (
                    <tr className="bg-surface-2">
                      <td colSpan={14} className="px-3 py-1.5 text-xs font-semibold">
                        {g.label}
                      </td>
                    </tr>
                  )}
                  {g.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/50">
                      <td className={`${txtCls} font-mono text-xs`}>{r.ref}</td>
                      <td className={`${txtCls} font-medium`}>
                        {r.party}
                        {r.source && r.source !== "contract" && (
                          <span className="ms-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {t(`leftovers.live.source_${r.source}`)}
                          </span>
                        )}
                        {r.cancelledAt && (
                          <span className="ms-1.5 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
                            {t("glossary.contract.cancelled")}
                          </span>
                        )}
                      </td>
                      <td className={`${txtCls} font-mono text-xs`}>{r.budgetCode ?? "—"}</td>
                      <td className={numCls}>
                        <Money v={r.value} />
                      </td>
                      <td className={txtCls}>
                        {canEdit && personOf.get(r.id) ? (
                          <select
                            value={r.methodSuggested ? "" : r.method}
                            onChange={(e) => void onMethod(r.id, e.target.value)}
                            aria-label={t("taxlive.live.col.method")}
                            className="rounded border border-border bg-input px-1.5 py-1 text-xs text-foreground"
                          >
                            <option value="">
                              {t("taxlive.live.suggested", { method: methodLabel(r.method) })}
                            </option>
                            {ACCRUAL_METHODS.map((m) => (
                              <option key={m} value={m}>
                                {methodLabel(m)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          methodLabel(r.method)
                        )}
                        {r.estimated && (
                          <span
                            className="ms-1 text-[10px] text-warning"
                            title={t("taxlive.live.noSchedule")}
                          >
                            ≈
                          </span>
                        )}
                      </td>
                      <td className={txtCls}>{r.start ? formatDate(r.start) : "—"}</td>
                      <td className={txtCls}>{r.end ? formatDate(r.end) : "—"}</td>
                      <td className={numCls}>{r.missingDates ? "—" : r.totalDays}</td>
                      <td className={numCls}>{r.missingDates ? "—" : r.elapsedDays}</td>
                      <td className={`${numCls} font-semibold`}>
                        <Money v={r.incurred} />
                      </td>
                      <td className={numCls}>
                        <Money v={r.paid} />
                      </td>
                      <td className={`${numCls} ${r.accrued > 0 ? "text-warning" : ""}`}>
                        <Money v={r.accrued} blankZero />
                      </td>
                      <td className={`${numCls} ${r.prepaid > 0 ? "text-brand" : ""}`}>
                        <Money v={r.prepaid} blankZero />
                      </td>
                      <td className={numCls}>
                        <Money v={r.remainingCommitment} blankZero />
                      </td>
                    </tr>
                  ))}
                  {grouping !== "none" && (
                    <tr className="border-b border-border font-semibold">
                      <td colSpan={3} className="px-3 py-1.5 text-end text-xs">
                        {t("taxlive.common.subtotal")}
                      </td>
                      <td className={numCls}>
                        <Money v={g.value} />
                      </td>
                      <td colSpan={5} />
                      {MONEY.slice(1).map((k) => (
                        <td key={k} className={numCls}>
                          <Money v={g[k]} blankZero />
                        </td>
                      ))}
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td colSpan={3} className="px-3 py-2 text-end">
                  {t("taxlive.common.total")}
                </td>
                <td className={numCls}>
                  <Money v={totals.value} />
                </td>
                <td colSpan={5} />
                {MONEY.slice(1).map((k) => (
                  <td key={k} className={numCls}>
                    <Money v={totals[k]} />
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
          {rows.some((r) => r.missingDates) && (
            <p className="mt-2 text-xs text-muted-foreground">{t("taxlive.live.missingDates")}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{t("taxlive.live.paidNote")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("leftovers.live.services_note")}</p>
        </div>
      )}
    </Panel>
  );
}

export default LiveBalanceReport;
