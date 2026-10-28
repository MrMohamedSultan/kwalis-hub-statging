import { formatDate } from "@/lib/date-format";
import React from "react";
import { useTranslation } from "react-i18next";
import { STATUS_CONFIG, fmt, useStatusLabel } from "./payables-utils";
import type { PayableMilestone } from "./payables-types";

/** Due-date label in the platform format — always with the year (G05). */
function formatDue(due?: string): string | null {
  if (!due) return null;
  return formatDate(due) || null;
}

/** Unpaid milestone whose due date has already passed. */
function isOverdue(milestone: PayableMilestone): boolean {
  if (milestone.milestone_status === "paid" || !milestone.due_date) return false;
  const due = new Date(milestone.due_date);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

/**
 * A single milestone cell. Background derives solely from milestone_status,
 * so the colour updates the instant the status changes. Unpaid milestones
 * past their due date are flagged in the destructive colour.
 */
export const MilestoneCell = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & {
    milestone?: PayableMilestone;
    onMilestoneClick?: (m: PayableMilestone, e: React.MouseEvent<HTMLElement>) => void;
    width?: number;
    pulseKey?: string;
  }
>(function MilestoneCell(
  {
    milestone,
    onClick,
    onMilestoneClick,
    width = 110,
    pulseKey,
    className = "",
    style,
    ...buttonProps
  },
  ref,
) {
  const { t } = useTranslation();
  const statusLabel = useStatusLabel();
  if (!milestone) {
    return <div className="shrink-0 px-1.5 py-1" style={{ width }} />;
  }

  const config = STATUS_CONFIG[milestone.milestone_status];
  const overdue = isOverdue(milestone);
  const dueLabel = formatDue(milestone.due_date);
  // R14: the date under the amount says what it is — the payment date once
  // paid, otherwise the due date.
  const paidLabel = milestone.milestone_status === "paid" ? formatDue(milestone.paid_date) : null;
  const dateLine = paidLabel
    ? t("taxlive.pay.paidOn", { date: paidLabel })
    : dueLabel
      ? t("taxlive.pay.dueOn", { date: dueLabel })
      : null;

  return (
    <button
      key={pulseKey}
      ref={ref}
      type="button"
      onClick={(e) => {
        onMilestoneClick?.(milestone, e);
        onClick?.(e);
      }}
      title={[
        milestone.milestone_label ||
          t("payables.milestoneExtra.paymentN", { n: milestone.milestone_number }),
        dueLabel ? `${overdue ? t("payables.overdue") : t("payables.due")} ${dueLabel}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      className={`shrink-0 px-2.5 py-1.5 mx-1 rounded-lg border-l-[3px] text-start
                  cursor-pointer transition-all duration-150 payables-cell-pulse
                  hover:ring-2 hover:ring-primary/30 active:scale-[0.98]
                  ${config.bg} ${overdue ? "border-destructive" : config.border} ${className}`}
      style={{ width: width - 8, ...style }}
      {...buttonProps}
    >
      <div className={`text-sm font-mono font-semibold tabular-nums leading-tight ${config.text}`}>
        {config.icon && <span className="me-1">{config.icon}</span>}
        {fmt(milestone.milestone_amount, true)}
      </div>

      {dateLine && (
        <div
          className={`truncate text-[10px] tabular-nums leading-tight ${
            overdue ? "font-semibold text-destructive" : "text-muted-foreground"
          }`}
        >
          {dateLine}
        </div>
      )}

      <div
        className={`text-[9px] uppercase tracking-wider font-medium leading-tight ${
          overdue ? "text-destructive" : `opacity-70 ${config.text}`
        }`}
      >
        {overdue ? t("payables.overdue") : statusLabel(milestone.milestone_status)}
      </div>
    </button>
  );
});

export default MilestoneCell;
