// =====================================================================
// PendingApprovals — the operational approval queue.
// Clean list (not a heavy data table): type icon · title/vendor ·
// amount · age chip · hover-revealed Approve / Review (always present
// for keyboard focus). Overdue rows get a 2px critical bar on the START
// edge (logical property — flips in RTL) plus an icon and the word
// "Overdue". Never the bar alone.
// =====================================================================
import { Link } from "@tanstack/react-router";
import {
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  FileSignature,
  FileText,
  ReceiptText,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/useI18n";
import { useDashboardCurrency } from "@/lib/dashboard/currency";
import { formatCurrency } from "@/lib/format";
import type { ApprovalItem, ApprovalType } from "@/lib/dashboard/mock-data";
import { StatusChip, type StatusTone } from "@/components/dashboard/StatusChip";
import { EmptyState } from "@/components/dashboard/EmptyState";

const TYPE_ICONS: Record<ApprovalType, LucideIcon> = {
  invoice: ReceiptText,
  po: FileText,
  petty_cash: Wallet,
  contract: FileSignature,
};

function ageTone(days: number): StatusTone {
  if (days >= 14) return "critical";
  if (days >= 7) return "warning";
  return "neutral";
}

interface PendingApprovalsProps {
  items: ApprovalItem[];
  loading?: boolean;
  fetching?: boolean;
}

export function PendingApprovals({ items, loading, fetching }: PendingApprovalsProps) {
  const { t } = useI18n();
  const { code, convert } = useDashboardCurrency();

  return (
    <section
      className={`rounded-xl border border-border bg-surface p-6 lg:p-7 transition-opacity duration-150 ${
        fetching && !loading ? "opacity-60" : "opacity-100"
      }`}
    >
      <header className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-ink-primary">{t("dash.pendingApprovals")}</h3>
        {!loading && items.length > 0 && (
          <StatusChip tone="neutral" label={t("dash.pendingCount", { count: items.length })} />
        )}
      </header>

      {loading ? (
        <div className="space-y-2 pt-2" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={CheckCircle2} message={t("dash.allCaughtUp")} />
      ) : (
        <>
          <ul className="divide-y divide-border" aria-label={t("dash.pendingApprovals")}>
            {items.map((item) => {
              const Icon = TYPE_ICONS[item.type] ?? FileText;
              const overdue = item.ageDays >= 14;
              return (
                <li
                  key={item.id}
                  className={`group relative flex items-center gap-3 py-3.5 transition-colors duration-150 hover:bg-surface-2 ${
                    overdue ? "border-s-2 border-status-critical ps-3" : ""
                  }`}
                >
                  <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-secondary">
                    <Icon className="size-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink-primary">
                        {item.title}
                      </span>
                      {overdue && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-status-critical">
                          <AlertOctagon className="size-3.5" aria-hidden="true" />
                          {t("dash.overdue")}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-ink-muted">
                      {[item.vendor, item.submitter].filter(Boolean).join(" · ") ||
                        t(`dash.approvalType.${item.type}`)}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-ink-primary">
                    {formatCurrency(convert(item.amount), { currency: code })}
                  </span>
                  <StatusChip
                    tone={ageTone(item.ageDays)}
                    label={t("dash.ageDays", { count: item.ageDays })}
                  />
                  {/* Revealed on hover; always present for keyboard focus. */}
                  <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                    <Link
                      to="/payment-approvals"
                      className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t("dash.review")}
                    </Link>
                    <Link
                      to="/payment-approvals"
                      className="rounded-lg bg-ink-primary px-2.5 py-1 text-[11px] font-semibold text-surface transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t("dash.approve")}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          <footer className="border-t border-border pt-3">
            <Link
              to="/payment-approvals"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-secondary transition-colors duration-150 hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("dash.viewAllApprovals")}
              <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          </footer>
        </>
      )}
    </section>
  );
}
