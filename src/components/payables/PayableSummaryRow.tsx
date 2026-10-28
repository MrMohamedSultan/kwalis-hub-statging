import { useTranslation } from "react-i18next";
import { fmt, milestoneColumnTotals } from "./payables-utils";
import type { PayableRow } from "./payables-types";

/**
 * Sticky totals footer: fixed columns (Contract Value gross, WHT, Net, Paid,
 * Payable, Commitment) + per instalment column Due / Paid / Remaining (R13).
 */
export function PayableSummaryRow({
  rows,
  maxMilestones,
  cellWidth,
}: {
  rows: PayableRow[];
  maxMilestones: number;
  cellWidth: number;
}) {
  const { t } = useTranslation();
  const gross = rows.reduce((s, r) => s + r.contract_gross, 0);
  const wht = rows.reduce((s, r) => s + r.contract_wht, 0);
  const net = rows.reduce((s, r) => s + r.contract_total, 0);
  const paid = rows.reduce((s, r) => s + r.total_paid, 0);
  const payable = rows.reduce((s, r) => s + r.payable, 0);
  const commitment = rows.reduce((s, r) => s + r.commitment, 0);
  const perMilestone = milestoneColumnTotals(rows, maxMilestones);
  const num = "font-mono text-sm font-bold tabular-nums";

  return (
    <div className="sticky bottom-0 z-20 flex min-w-max border-t border-border bg-surface-2">
      <div className="sticky start-0 z-10 flex border-e border-border/50 bg-surface-2 shadow-sm">
        <div className="flex h-16 w-[260px] shrink-0 items-center px-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {t("payables.totals")}
        </div>
        <div className="flex h-16 w-[160px] shrink-0 flex-col justify-center px-3 text-end text-[9px] uppercase tracking-wider text-muted-foreground">
          <span>{t("taxlive.pay.colDue")}</span>
          <span className="text-success">{t("taxlive.pay.colPaid")}</span>
          <span>{t("taxlive.pay.colRemaining")}</span>
        </div>
        <div
          className={`flex h-16 w-[110px] shrink-0 items-center justify-end px-3 text-end ${num} text-foreground`}
        >
          {fmt(gross)}
        </div>
        <div
          className={`flex h-16 w-[90px] shrink-0 items-center justify-end px-3 text-end ${num} text-muted-foreground`}
        >
          {fmt(wht)}
        </div>
        <div
          className={`flex h-16 w-[100px] shrink-0 items-center justify-end px-3 text-end ${num} text-foreground`}
        >
          {fmt(net)}
        </div>
        <div
          className={`flex h-16 w-[100px] shrink-0 items-center justify-end px-3 text-end ${num} text-success`}
        >
          {fmt(paid)}
        </div>
        <div
          className={`flex h-16 w-[100px] shrink-0 items-center justify-end px-3 text-end ${num} text-foreground`}
        >
          {fmt(payable)}
        </div>
        <div
          className={`flex h-16 w-[100px] shrink-0 items-center justify-end px-3 text-end ${num} text-foreground`}
        >
          {fmt(commitment)}
        </div>
      </div>
      <div className="flex h-16 items-center">
        {perMilestone.map((v, i) => (
          <div
            key={i}
            className="flex shrink-0 flex-col px-2 text-center font-mono text-xs tabular-nums leading-tight"
            style={{ width: cellWidth }}
            title={`${t("taxlive.pay.colDue")} ${fmt(v.due)} · ${t("taxlive.pay.colPaid")} ${fmt(v.paid)} · ${t("taxlive.pay.colRemaining")} ${fmt(v.remaining)}`}
          >
            <span className="font-semibold text-foreground">{fmt(v.due)}</span>
            <span className="text-success">{fmt(v.paid)}</span>
            <span className={v.remaining > 0 ? "text-warning" : "text-muted-foreground"}>
              {fmt(v.remaining)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PayableSummaryRow;
