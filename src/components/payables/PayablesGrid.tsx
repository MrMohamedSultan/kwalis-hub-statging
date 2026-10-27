import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "@/hooks/use-mobile";
import { MilestonePopoverCell } from "./MilestonePopover";
import { PayableSummaryRow } from "./PayableSummaryRow";
import { PayablesToolbar } from "./PayablesToolbar";
import {
  STATUS_CONFIG,
  useCategoryConfig,
  filterAndSortRows,
  fmt,
  milestoneHeaders as buildHeaders,
  pivotByBeneficiary,
  uniqueDepartments,
} from "./payables-utils";
import type { PayableRow, PayablesGridProps, SortKey, StatusFilter } from "./payables-types";

/**
 * Flat, Excel-like payables grid: ONE row per contract/beneficiary with the
 * payment milestones as inline columns. Pure UI — every mutation flows out
 * through `onMilestoneUpdate`; the component never touches the database.
 */
export function PayablesGrid({
  category,
  milestones,
  isLoading = false,
  onMilestoneUpdate,
  readOnly = false,
  onCancelContract,
}: PayablesGridProps & {
  readOnly?: boolean;
  /** A04: cancel the contract (org admin); omitted = no action shown. */
  onCancelContract?: (contractId: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const categoryConfig = useCategoryConfig();
  const config = categoryConfig[category];
  const isMobile = useIsMobile();
  const cellWidth = 110;

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [department, setDepartment] = useState("all");
  const [sort, setSort] = useState<SortKey>("name");

  const rows = useMemo(() => pivotByBeneficiary(milestones), [milestones]);
  const departments = useMemo(() => uniqueDepartments(rows), [rows]);
  const filteredRows = useMemo(
    () => filterAndSortRows(rows, { search, status, department, sort }),
    [rows, search, status, department, sort],
  );

  const maxMilestones = useMemo(
    () =>
      rows.reduce((max, r) => Math.max(max, ...r.milestones.map((m) => m.milestone_number), 0), 0),
    [rows],
  );
  const headers = useMemo(
    () => buildHeaders(milestones, maxMilestones),
    [milestones, maxMilestones],
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card py-16 text-center">
        <div className="mb-3 text-4xl">{config.icon}</div>
        <p className="text-sm text-muted-foreground">{config.emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PayablesToolbar
        search={search}
        onSearch={setSearch}
        status={status}
        onStatus={setStatus}
        department={department}
        onDepartment={setDepartment}
        departments={departments}
        sort={sort}
        onSort={setSort}
        showDepartment={category !== "vendor"}
        countLabel={t("payables.count", { shown: filteredRows.length, total: rows.length })}
      />

      {isMobile ? (
        <MobileCards
          rows={filteredRows}
          category={category}
          onMilestoneUpdate={onMilestoneUpdate}
          readOnly={readOnly}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="max-h-[70vh] overflow-auto">
            {/* Header */}
            <div className="sticky top-0 z-30 flex min-w-max border-b border-border bg-muted/30">
              <div className="sticky left-0 z-10 flex border-e border-border/50 bg-muted/30 shadow-sm">
                <HeadCell w={260}>{t("payables.beneficiary")}</HeadCell>
                <HeadCell w={160}>{config.roleLabel}</HeadCell>
                <HeadCell w={110} end>
                  {t("glossary.term.contractValue")}
                </HeadCell>
                <HeadCell w={100} end>
                  {t("glossary.term.paid")}
                </HeadCell>
                <HeadCell w={100} end>
                  {t("glossary.term.payable")}
                </HeadCell>
                <HeadCell w={100} end>
                  {t("glossary.term.commitment")}
                </HeadCell>
              </div>
              <div className="flex">
                {headers.map((h, i) => (
                  <div
                    key={i}
                    className="flex h-9 shrink-0 items-center justify-center truncate px-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                    style={{ width: cellWidth }}
                    title={h}
                  >
                    {h}
                  </div>
                ))}
              </div>
            </div>

            {/* Rows */}
            {filteredRows.map((row) => (
              <div
                key={row.contract_id}
                className="flex min-w-max border-b border-border/50 transition-colors hover:bg-muted/30"
              >
                <div className="sticky left-0 z-10 flex border-e border-border/50 bg-card shadow-sm">
                  <div className="flex h-14 w-[260px] shrink-0 flex-col justify-center px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {row.beneficiary_name}
                      </span>
                      {row.contract_cancelled && (
                        <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-destructive">
                          {t("glossary.contract.cancelled")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {row.department && (
                        <span className="truncate text-[10px] text-muted-foreground">
                          {row.department}
                        </span>
                      )}
                      {onCancelContract && !readOnly && !row.contract_cancelled && (
                        <button
                          type="button"
                          onClick={() => onCancelContract(row.contract_id, row.beneficiary_name)}
                          className="shrink-0 text-[10px] font-medium text-destructive hover:underline"
                        >
                          {t("glossary.contract.cancel")}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex h-14 w-[160px] shrink-0 items-center px-3 py-2">
                    <div className="truncate text-xs text-muted-foreground">
                      {row.beneficiary_role || "—"}
                    </div>
                  </div>
                  <div className="flex h-14 w-[110px] shrink-0 flex-col justify-center px-3 py-2 text-end">
                    <div className="font-mono text-sm font-semibold tabular-nums text-foreground">
                      {fmt(row.contract_total)}
                    </div>
                    <div className="text-[9px] text-muted-foreground">{row.currency}</div>
                  </div>
                  <div className="flex h-14 w-[100px] shrink-0 items-center justify-end px-3 py-2 text-end font-mono text-sm font-medium tabular-nums text-success">
                    {fmt(row.total_paid)}
                  </div>
                  <div
                    className={`flex h-14 w-[100px] shrink-0 items-center justify-end px-3 py-2 text-end font-mono text-sm font-medium tabular-nums ${
                      row.payable > 0 ? "text-warning" : "text-muted-foreground"
                    }`}
                  >
                    {fmt(row.payable)}
                  </div>
                  <div className="flex h-14 w-[100px] shrink-0 items-center justify-end px-3 py-2 text-end font-mono text-sm font-medium tabular-nums text-foreground">
                    {fmt(row.commitment)}
                  </div>
                </div>

                <div className="flex h-14 items-center">
                  {Array.from({ length: maxMilestones }, (_, i) => {
                    const ms = row.milestones.find((m) => m.milestone_number === i + 1);
                    return (
                      <MilestonePopoverCell
                        key={i}
                        milestone={ms}
                        width={cellWidth}
                        pulseKey={
                          ms ? `${ms.id}:${ms.milestone_status}:${ms.milestone_amount}` : undefined
                        }
                        onMilestoneUpdate={onMilestoneUpdate}
                        readOnly={readOnly}
                      />
                    );
                  })}
                </div>
              </div>
            ))}

            <PayableSummaryRow
              rows={filteredRows}
              maxMilestones={maxMilestones}
              cellWidth={cellWidth}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function HeadCell({ w, end, children }: { w: number; end?: boolean; children: ReactNode }) {
  return (
    <div
      className={`flex h-9 shrink-0 items-center px-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ${
        end ? "justify-end text-end" : ""
      }`}
      style={{ width: w }}
    >
      {children}
    </div>
  );
}

/** Mobile: one card per beneficiary, milestones as a strip of coloured pills. */
function MobileCards({
  rows,
  category,
  onMilestoneUpdate,
  readOnly,
}: {
  rows: PayableRow[];
  category: PayablesGridProps["category"];
  onMilestoneUpdate: PayablesGridProps["onMilestoneUpdate"];
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const categoryConfig = useCategoryConfig();
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.contract_id} className="rounded-xl border border-border bg-card p-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">
                {row.beneficiary_name}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {[row.beneficiary_role, row.department].filter(Boolean).join(" · ") ||
                  categoryConfig[category].roleLabel}
              </div>
            </div>
            <div className="shrink-0 text-end">
              <div className="font-mono text-sm font-semibold tabular-nums text-foreground">
                {fmt(row.contract_total)} {row.currency}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("glossary.term.paid")} {fmt(row.total_paid, true)} · {t("glossary.term.payable")}{" "}
                {fmt(row.payable, true)} · {t("glossary.term.commitment")}{" "}
                {fmt(row.commitment, true)}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {row.milestones.map((m) => {
              const cfg = STATUS_CONFIG[m.milestone_status];
              return (
                <MilestonePopoverCell
                  key={m.id}
                  milestone={m}
                  onMilestoneUpdate={onMilestoneUpdate}
                  readOnly={readOnly}
                >
                  <button
                    type="button"
                    className={`rounded-full border-l-[3px] px-3 py-1.5 text-xs font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}
                  >
                    {m.milestone_label || `P${m.milestone_number}`} ·{" "}
                    {fmt(m.milestone_amount, true)}
                  </button>
                </MilestonePopoverCell>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default PayablesGrid;
