import { useTranslation } from "react-i18next";
import { fmt } from "./payables-utils";
import type { PayableRow } from "./payables-types";

/** Sticky totals footer: fixed columns + per-milestone paid totals. */
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
  const deal = rows.reduce((s, r) => s + r.contract_total, 0);
  const paid = rows.reduce((s, r) => s + r.total_paid, 0);
  const remaining = rows.reduce((s, r) => s + r.remaining, 0);

  const perMilestone = Array.from({ length: maxMilestones }, (_, i) =>
    rows.reduce((s, r) => {
      const m = r.milestones.find((x) => x.milestone_number === i + 1);
      return s + (m && m.milestone_status === "paid" ? m.milestone_amount : 0);
    }, 0),
  );

  return (
    <div className="sticky bottom-0 z-20 flex min-w-max border-t border-border bg-surface-2">
      <div className="sticky left-0 z-10 flex border-e border-border/50 bg-surface-2 shadow-[2px_0_8px_-2px_rgba(0,0,0,0.12)]">
        <div className="flex h-12 w-[260px] shrink-0 items-center px-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {t("payables.totals")}
        </div>
        <div className="h-12 w-[160px] shrink-0 px-3" />
        <div className="flex h-12 w-[110px] shrink-0 items-center justify-end px-3 text-end font-mono text-sm font-bold tabular-nums text-foreground">
          {fmt(deal)}
        </div>
        <div className="flex h-12 w-[100px] shrink-0 items-center justify-end px-3 text-end font-mono text-sm font-bold tabular-nums text-success">
          {fmt(paid)}
        </div>
        <div className="flex h-12 w-[100px] shrink-0 items-center justify-end px-3 text-end font-mono text-sm font-bold tabular-nums text-foreground">
          {fmt(remaining)}
        </div>
      </div>
      <div className="flex h-12 items-center">
        {perMilestone.map((v, i) => (
          <div
            key={i}
            className="shrink-0 px-2 text-center font-mono text-xs font-semibold tabular-nums text-muted-foreground"
            style={{ width: cellWidth }}
          >
            {fmt(v, true)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default PayableSummaryRow;
