import { formatDate } from "@/lib/date-format";
import React, { useState, useMemo, useCallback } from "react";
import { fmt } from "@/components/payables/payables-utils";

// ─── Types ──────────────────────────────────────────────────────

export interface PayableMilestone {
  id: string;
  contract_id: string;
  beneficiary_id: string;
  beneficiary_name: string;
  beneficiary_role: string;
  department?: string;
  contract_total: number;
  currency: string;
  milestone_number: number;
  milestone_label?: string;
  milestone_amount: number;
  milestone_status: "pending" | "requested" | "approved" | "paid";
  paid_date?: string;
  payment_ref?: string;
  notes?: string;
}

export interface PayableRow {
  beneficiary_id: string;
  beneficiary_name: string;
  beneficiary_role: string;
  department?: string;
  contract_id: string;
  contract_total: number;
  currency: string;
  total_paid: number;
  remaining: number;
  milestones: PayableMilestone[];
}

export interface PayablesGridProps {
  category: "crew" | "cast" | "vendor";
  milestones: PayableMilestone[];
  isLoading?: boolean;
  onMilestoneUpdate: (milestoneId: string, updates: Partial<PayableMilestone>) => Promise<void>;
}

// ─── Category Config ────────────────────────────────────────────

const CATEGORY_CONFIG = {
  crew: { roleLabel: "Role / Position", icon: "👷", empty: "No crew payables found." },
  cast: { roleLabel: "Character / Role", icon: "🎬", empty: "No cast payables found." },
  vendor: { roleLabel: "Service / Category", icon: "🏢", empty: "No vendor payables found." },
};

// ─── Status Config ──────────────────────────────────────────────
// Colors use the project's semantic status tokens (destructive / warning /
// success) so both light and dark themes stay consistent.

const STATUS_CONFIG = {
  pending: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-transparent",
    label: "Pending",
    icon: "",
  },
  requested: {
    bg: "bg-destructive/15",
    text: "text-destructive",
    border: "border-l-destructive",
    label: "Requested",
    icon: "⚠",
  },
  approved: {
    bg: "bg-warning/15",
    text: "text-warning",
    border: "border-l-warning",
    label: "Approved",
    icon: "○",
  },
  paid: {
    bg: "bg-success/15",
    text: "text-success",
    border: "border-l-success",
    label: "Paid",
    icon: "✓",
  },
};

// ─── Data Pivot ─────────────────────────────────────────────────

function pivotByBeneficiary(milestones: PayableMilestone[]): PayableRow[] {
  const map = new Map<string, PayableRow>();

  for (const m of milestones) {
    const key = m.contract_id;
    if (!map.has(key)) {
      map.set(key, {
        beneficiary_id: m.beneficiary_id,
        beneficiary_name: m.beneficiary_name,
        beneficiary_role: m.beneficiary_role,
        department: m.department,
        contract_id: m.contract_id,
        contract_total: m.contract_total,
        currency: m.currency,
        total_paid: 0,
        remaining: m.contract_total,
        milestones: [],
      });
    }
    const row = map.get(key)!;
    row.milestones.push(m);
    if (m.milestone_status === "paid") {
      row.total_paid += m.milestone_amount;
    }
  }

  for (const row of map.values()) {
    row.milestones.sort((a, b) => a.milestone_number - b.milestone_number);
    row.remaining = row.contract_total - row.total_paid;
  }

  return Array.from(map.values());
}

// ─── Formatters ─────────────────────────────────────────────────

// `fmt` is shared with the payables exports — see @/components/payables/payables-utils.

// ─── Milestone Cell ─────────────────────────────────────────────

function MilestoneCell({
  milestone,
  onClick,
}: {
  milestone?: PayableMilestone;
  onClick?: (m: PayableMilestone, e: React.MouseEvent) => void;
}) {
  if (!milestone) {
    return <div className="w-[110px] shrink-0 px-1.5 py-1" />;
  }

  const config = STATUS_CONFIG[milestone.milestone_status];

  return (
    <button
      type="button"
      onClick={(e) => onClick?.(milestone, e)}
      className={`w-[110px] shrink-0 px-2.5 py-2 mx-1 rounded-lg border-l-[3px]
                  cursor-pointer transition-all duration-150
                  hover:ring-2 hover:ring-primary/30 hover:scale-[1.02]
                  active:scale-[0.98]
                  ${config.bg} ${config.border}`}
    >
      <div className={`text-sm font-mono font-semibold tabular-nums ${config.text}`}>
        {config.icon && <span className="me-1">{config.icon}</span>}
        {fmt(milestone.milestone_amount, true)}
      </div>
      <div
        className={`text-[9px] uppercase tracking-wider font-medium mt-0.5 ${config.text} opacity-70`}
      >
        {config.label}
      </div>
    </button>
  );
}

// ─── Popover ────────────────────────────────────────────────────

function MilestonePopover({
  milestone,
  onAction,
  onClose,
}: {
  milestone: PayableMilestone;
  onAction: (milestoneId: string, updates: Partial<PayableMilestone>) => Promise<void>;
  onClose: () => void;
}) {
  const [editAmount, setEditAmount] = useState(milestone.milestone_amount);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showUndo, setShowUndo] = useState(false);

  const config = STATUS_CONFIG[milestone.milestone_status];

  const doAction = async (updates: Partial<PayableMilestone>) => {
    setIsSubmitting(true);
    try {
      await onAction(milestone.id, updates);
      onClose();
    } catch {
      // error handling — toast/alert handled by the caller
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="bg-popover text-popover-foreground border border-border rounded-xl
                    shadow-xl p-4 w-[280px] space-y-3 z-50"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">
          {milestone.milestone_label || `Payment ${milestone.milestone_number}`}
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-lg leading-none cursor-pointer"
        >
          ×
        </button>
      </div>

      {/* Status badge */}
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs
                       font-medium ${config.bg} ${config.text}`}
      >
        {config.icon && <span>{config.icon}</span>}
        {config.label}
      </div>

      {/* Amount */}
      {isEditing ? (
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Amount ({milestone.currency})</label>
          <input
            type="number"
            value={editAmount}
            onChange={(e) => setEditAmount(Number(e.target.value))}
            className="w-full bg-input border border-border text-foreground rounded-lg
                       px-3 py-2 text-sm font-mono"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => doAction({ milestone_amount: editAmount })}
              disabled={isSubmitting}
              className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground
                         text-xs font-medium disabled:opacity-50 cursor-pointer"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="flex-1 px-3 py-1.5 rounded-lg border border-border
                         text-foreground text-xs font-medium cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="text-xs text-muted-foreground">Amount</div>
          <div className="text-lg font-mono font-bold text-foreground tabular-nums">
            {milestone.currency} {fmt(milestone.milestone_amount)}
          </div>
        </div>
      )}

      {/* Paid info */}
      {milestone.milestone_status === "paid" && milestone.paid_date && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div>Paid on: {formatDate(milestone.paid_date)}</div>
          {milestone.payment_ref && <div>Ref: {milestone.payment_ref}</div>}
        </div>
      )}

      {/* Actions based on status */}
      <div className="space-y-2 pt-1 border-t border-border">
        {milestone.milestone_status === "pending" && (
          <>
            <ActionButton
              label="Request Payment"
              variant="destructive"
              disabled={isSubmitting}
              onClick={() => doAction({ milestone_status: "requested" })}
            />
            <ActionButton
              label="Edit Amount"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setIsEditing(true)}
            />
          </>
        )}

        {milestone.milestone_status === "requested" && (
          <>
            <ActionButton
              label="Mark as Paid"
              variant="success"
              disabled={isSubmitting}
              onClick={() =>
                doAction({
                  milestone_status: "paid",
                  paid_date: new Date().toISOString(),
                })
              }
            />
            <ActionButton
              label="Cancel Request"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => doAction({ milestone_status: "pending" })}
            />
            <ActionButton
              label="Edit Amount"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setIsEditing(true)}
            />
          </>
        )}

        {milestone.milestone_status === "approved" && (
          <>
            <ActionButton
              label="Mark as Paid"
              variant="success"
              disabled={isSubmitting}
              onClick={() =>
                doAction({
                  milestone_status: "paid",
                  paid_date: new Date().toISOString(),
                })
              }
            />
            <ActionButton
              label="Edit Amount"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setIsEditing(true)}
            />
          </>
        )}

        {milestone.milestone_status === "paid" && (
          <>
            {!showUndo ? (
              <ActionButton
                label="Undo Payment"
                variant="ghost-destructive"
                disabled={isSubmitting}
                onClick={() => setShowUndo(true)}
              />
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-destructive font-medium">
                  Are you sure? This will revert the payment to pending.
                </p>
                <div className="flex gap-2">
                  <ActionButton
                    label="Yes, Undo"
                    variant="destructive"
                    disabled={isSubmitting}
                    onClick={() =>
                      doAction({
                        milestone_status: "pending",
                        paid_date: undefined,
                        payment_ref: undefined,
                      })
                    }
                  />
                  <ActionButton
                    label="Cancel"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={() => setShowUndo(false)}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  variant,
  disabled,
  onClick,
}: {
  label: string;
  variant: "destructive" | "success" | "outline" | "ghost-destructive";
  disabled?: boolean;
  onClick: () => void;
}) {
  const styles = {
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    success: "bg-success text-success-foreground hover:bg-success/90",
    outline: "border border-border text-foreground hover:bg-muted",
    "ghost-destructive": "text-destructive hover:bg-destructive/10",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full px-3 py-2 rounded-lg text-xs font-semibold
                  disabled:opacity-50 transition-colors cursor-pointer
                  ${styles[variant]}`}
    >
      {label}
    </button>
  );
}

// ─── Main Grid ──────────────────────────────────────────────────

export default function PayablesGrid({
  category,
  milestones,
  isLoading = false,
  onMilestoneUpdate,
}: PayablesGridProps) {
  const config = CATEGORY_CONFIG[category];
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activePopover, setActivePopover] = useState<PayableMilestone | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  // Pivot data
  const rows = useMemo(() => pivotByBeneficiary(milestones), [milestones]);

  // Max milestone columns
  const maxMilestones = useMemo(() => Math.max(0, ...rows.map((r) => r.milestones.length)), [rows]);

  // Milestone column headers
  const milestoneHeaders = useMemo(() => {
    const headers: string[] = [];
    for (let i = 1; i <= maxMilestones; i++) {
      const ms = milestones.find((m) => m.milestone_number === i && m.milestone_label);
      headers.push(ms?.milestone_label || `Payment ${i}`);
    }
    return headers;
  }, [maxMilestones, milestones]);

  // Filter
  const filteredRows = useMemo(() => {
    let result = rows;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.beneficiary_name.toLowerCase().includes(q) ||
          r.beneficiary_role.toLowerCase().includes(q),
      );
    }

    if (statusFilter !== "all") {
      result = result.filter((r) => {
        if (statusFilter === "has_requested")
          return r.milestones.some((m) => m.milestone_status === "requested");
        if (statusFilter === "has_pending")
          return r.milestones.some((m) => m.milestone_status === "pending");
        if (statusFilter === "fully_paid")
          return r.milestones.every((m) => m.milestone_status === "paid");
        return true;
      });
    }

    return result;
  }, [rows, search, statusFilter]);

  // Totals
  const totals = useMemo(() => {
    const t = { deal: 0, paid: 0, remaining: 0 };
    filteredRows.forEach((r) => {
      t.deal += r.contract_total;
      t.paid += r.total_paid;
      t.remaining += r.remaining;
    });
    return t;
  }, [filteredRows]);

  // Cell click handler
  const handleCellClick = useCallback((m: PayableMilestone, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopoverPos({ top: rect.bottom + 8, left: rect.left });
    setActivePopover(m);
  }, []);

  const handleAction = useCallback(
    async (milestoneId: string, updates: Partial<PayableMilestone>) => {
      await onMilestoneUpdate(milestoneId, updates);
      setActivePopover(null);
    },
    [onMilestoneUpdate],
  );

  // Loading
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  // Empty
  if (rows.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-3">{config.icon}</div>
        <p className="text-muted-foreground text-sm">{config.empty}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name..."
          className="bg-input border border-border text-foreground placeholder:text-muted-foreground
                     rounded-lg px-3 py-2 text-sm w-[220px]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-input border border-border text-foreground rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Statuses</option>
          <option value="has_requested">Has Requested</option>
          <option value="has_pending">Has Pending</option>
          <option value="fully_paid">Fully Paid</option>
        </select>
        <div className="ms-auto text-xs text-muted-foreground">
          {filteredRows.length} of {rows.length} beneficiaries
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <div className="overflow-x-auto">
          {/* Column Headers */}
          <div className="flex min-w-max">
            {/* Fixed columns */}
            <div className="sticky left-0 z-10 flex bg-card shadow-[2px_0_8px_-2px_rgba(0,0,0,0.12)]">
              <div
                className="w-[180px] shrink-0 px-3 py-2.5 text-[10px] font-semibold
                              uppercase tracking-wider text-muted-foreground"
              >
                Beneficiary
              </div>
              <div
                className="w-[140px] shrink-0 px-3 py-2.5 text-[10px] font-semibold
                              uppercase tracking-wider text-muted-foreground"
              >
                {config.roleLabel}
              </div>
              <div
                className="w-[110px] shrink-0 px-3 py-2.5 text-[10px] font-semibold
                              uppercase tracking-wider text-muted-foreground text-right"
              >
                Total Deal
              </div>
              <div
                className="w-[100px] shrink-0 px-3 py-2.5 text-[10px] font-semibold
                              uppercase tracking-wider text-muted-foreground text-right"
              >
                Paid
              </div>
              <div
                className="w-[100px] shrink-0 px-3 py-2.5 text-[10px] font-semibold
                              uppercase tracking-wider text-muted-foreground text-right"
              >
                Remaining
              </div>
            </div>

            {/* Dynamic milestone headers */}
            <div className="flex">
              {milestoneHeaders.map((header, i) => (
                <div
                  key={i}
                  className="w-[110px] shrink-0 px-2 py-2.5 text-[10px] font-semibold
                             uppercase tracking-wider text-muted-foreground text-center"
                >
                  {header}
                </div>
              ))}
            </div>
          </div>

          {/* Separator */}
          <div className="border-b border-border" />

          {/* Data Rows */}
          {filteredRows.map((row) => (
            <div
              key={row.contract_id}
              className="flex min-w-max border-b border-border/50 hover:bg-muted/30 transition-colors"
            >
              {/* Fixed columns */}
              <div className="sticky left-0 z-10 flex bg-card shadow-[2px_0_8px_-2px_rgba(0,0,0,0.08)]">
                {/* Beneficiary */}
                <div className="w-[180px] shrink-0 px-3 py-3">
                  <div className="text-sm font-semibold text-foreground truncate">
                    {row.beneficiary_name}
                  </div>
                  {row.department && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      {row.department}
                    </div>
                  )}
                </div>

                {/* Role */}
                <div className="w-[140px] shrink-0 px-3 py-3">
                  <div className="text-xs text-muted-foreground truncate">
                    {row.beneficiary_role}
                  </div>
                </div>

                {/* Total Deal */}
                <div className="w-[110px] shrink-0 px-3 py-3 text-end">
                  <div className="text-sm font-mono font-semibold text-foreground tabular-nums">
                    {fmt(row.contract_total)}
                  </div>
                  <div className="text-[9px] text-muted-foreground">{row.currency}</div>
                </div>

                {/* Paid */}
                <div className="w-[100px] shrink-0 px-3 py-3 text-end">
                  <div className="text-sm font-mono text-success font-medium tabular-nums">
                    {fmt(row.total_paid)}
                  </div>
                </div>

                {/* Remaining */}
                <div className="w-[100px] shrink-0 px-3 py-3 text-end">
                  <div
                    className={`text-sm font-mono font-medium tabular-nums
                    ${row.remaining > 0 ? "text-foreground" : "text-success"}`}
                  >
                    {fmt(row.remaining)}
                  </div>
                </div>
              </div>

              {/* Milestone cells */}
              <div className="flex items-center py-1.5">
                {Array.from({ length: maxMilestones }, (_, i) => {
                  const ms = row.milestones.find((m) => m.milestone_number === i + 1);
                  return <MilestoneCell key={i} milestone={ms} onClick={handleCellClick} />;
                })}
              </div>
            </div>
          ))}

          {/* Summary Row */}
          <div className="flex min-w-max bg-muted/50 border-t-2 border-border">
            <div className="sticky left-0 z-10 flex bg-muted/50 shadow-[2px_0_8px_-2px_rgba(0,0,0,0.08)]">
              <div className="w-[180px] shrink-0 px-3 py-3">
                <div className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Totals
                </div>
              </div>
              <div className="w-[140px] shrink-0 px-3 py-3" />
              <div className="w-[110px] shrink-0 px-3 py-3 text-end">
                <div className="text-sm font-mono font-bold text-foreground tabular-nums">
                  {fmt(totals.deal)}
                </div>
              </div>
              <div className="w-[100px] shrink-0 px-3 py-3 text-end">
                <div className="text-sm font-mono font-bold text-success tabular-nums">
                  {fmt(totals.paid)}
                </div>
              </div>
              <div className="w-[100px] shrink-0 px-3 py-3 text-end">
                <div className="text-sm font-mono font-bold text-foreground tabular-nums">
                  {fmt(totals.remaining)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Floating Popover ── */}
      {activePopover && popoverPos && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setActivePopover(null)} />

          {/* Popover */}
          <div className="fixed z-50" style={{ top: popoverPos.top, left: popoverPos.left }}>
            <MilestonePopover
              milestone={activePopover}
              onAction={handleAction}
              onClose={() => setActivePopover(null)}
            />
          </div>
        </>
      )}
    </div>
  );
}
