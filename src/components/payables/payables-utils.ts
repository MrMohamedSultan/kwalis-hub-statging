import type {
  MilestoneUiStatus,
  PayableCategory,
  PayableMilestone,
  PayableRow,
  SortKey,
  StatusFilter,
} from "./payables-types";
import { formatAmount } from "@/lib/format-number";

/** Column labels + empty states per category. Grid logic is identical. */
export const CATEGORY_CONFIG: Record<
  PayableCategory,
  { roleLabel: string; icon: string; emptyMessage: string; title: string }
> = {
  crew: {
    roleLabel: "Role / Position",
    icon: "👷",
    emptyMessage: "No crew payables found.",
    title: "Crew Payables",
  },
  cast: {
    roleLabel: "Character / Role",
    icon: "🎬",
    emptyMessage: "No cast payables found.",
    title: "Cast Payables",
  },
  vendor: {
    roleLabel: "Service / Category",
    icon: "🏢",
    emptyMessage: "No vendor payables found.",
    title: "Vendor Payables",
  },
};

/**
 * Cell palette. Status colours are the single sanctioned exception to the
 * semantic-token rule, so both light and dark variants are declared inline.
 */
export const STATUS_CONFIG: Record<
  MilestoneUiStatus,
  { bg: string; text: string; border: string; label: string; icon: string }
> = {
  pending: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-l-border",
    label: "Pending",
    icon: "",
  },
  requested: {
    bg: "bg-red-500/15 dark:bg-red-500/20",
    text: "text-red-700 dark:text-red-400",
    border: "border-l-red-500",
    label: "Requested",
    icon: "⚠",
  },
  approved: {
    bg: "bg-amber-500/15 dark:bg-amber-500/20",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-l-amber-500",
    label: "Approved",
    icon: "○",
  },
  paid: {
    bg: "bg-emerald-500/15 dark:bg-emerald-500/20",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-l-emerald-500",
    label: "Paid",
    icon: "✓",
  },
};

/** Frontend-only pivot — the backend is never modified. */
export function pivotByBeneficiary(milestones: PayableMilestone[]): PayableRow[] {
  const map = new Map<string, PayableRow>();

  for (const m of milestones) {
    const key = m.contract_id; // one person can hold multiple contracts
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
        payable: 0,
        commitment: 0,
        remaining: m.contract_total,
        contract_cancelled: !!m.contract_cancelled,
        milestones: [],
      });
    }
    const row = map.get(key)!;
    row.milestones.push(m);
    if (m.milestone_status === "paid") {
      row.total_paid += m.milestone_amount;
    } else if (m.milestone_status === "approved") {
      // Approved = Actual, not paid yet (glossary: Payable)
      row.payable += m.milestone_amount;
    }
  }

  for (const row of map.values()) {
    row.milestones.sort((a, b) => a.milestone_number - b.milestone_number);
    // Commitment = contract value − actual (approved + paid); none once cancelled (A04)
    row.commitment = row.contract_cancelled
      ? 0
      : Math.max(0, row.contract_total - row.total_paid - row.payable);
    row.remaining = row.payable + row.commitment;
  }

  return Array.from(map.values());
}

/**
 * Grouped amount. G16: money is never abbreviated ("1.8K" for 1,750) — the
 * `short` flag is kept for call-site compatibility but renders in full.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function fmt(n: number, short = false): string {
  return formatAmount(Number(n) || 0, 0);
}

export function milestoneHeaders(milestones: PayableMilestone[], maxMilestones: number): string[] {
  const headers: string[] = [];
  for (let i = 1; i <= maxMilestones; i++) {
    const ms = milestones.find((m) => m.milestone_number === i && m.milestone_label);
    headers.push(ms?.milestone_label || `Payment ${i}`);
  }
  return headers;
}

export function filterAndSortRows(
  rows: PayableRow[],
  opts: { search: string; status: StatusFilter; department: string; sort: SortKey },
): PayableRow[] {
  let result = rows;

  const q = opts.search.trim().toLowerCase();
  if (q) {
    result = result.filter(
      (r) =>
        r.beneficiary_name.toLowerCase().includes(q) ||
        r.beneficiary_role.toLowerCase().includes(q),
    );
  }

  if (opts.department !== "all") {
    result = result.filter((r) => (r.department ?? "") === opts.department);
  }

  if (opts.status !== "all") {
    result = result.filter((r) => {
      if (opts.status === "has_pending")
        return r.milestones.some((m) => m.milestone_status === "pending");
      if (opts.status === "has_requested")
        return r.milestones.some((m) => m.milestone_status === "requested");
      if (opts.status === "fully_paid")
        return r.milestones.length > 0 && r.milestones.every((m) => m.milestone_status === "paid");
      return true;
    });
  }

  const sorted = [...result];
  sorted.sort((a, b) => {
    if (opts.sort === "remaining") return b.remaining - a.remaining;
    if (opts.sort === "deal") return b.contract_total - a.contract_total;
    return a.beneficiary_name.localeCompare(b.beneficiary_name);
  });
  return sorted;
}

export function uniqueDepartments(rows: PayableRow[]): string[] {
  return Array.from(new Set(rows.map((r) => (r.department ?? "").trim()).filter(Boolean))).sort();
}

/* ── i18n presentation helpers (labels only — no logic changes) ───────── */

import { useTranslation } from "react-i18next";

export const STATUS_LABEL_KEY: Record<MilestoneUiStatus, string> = {
  // glossary words, same on every screen (A02)
  pending: "glossary.status.pending",
  requested: "glossary.status.requested",
  approved: "glossary.status.approved",
  paid: "glossary.status.paid",
};

/** Localized copy of CATEGORY_CONFIG. Icons stay identical. */
export function useCategoryConfig(): Record<
  PayableCategory,
  { roleLabel: string; icon: string; emptyMessage: string; title: string }
> {
  const { t } = useTranslation();
  return {
    crew: {
      roleLabel: t("payables.rolePosition"),
      icon: CATEGORY_CONFIG.crew.icon,
      emptyMessage: t("payables.noCrewPayables"),
      title: t("payables.crewPayables"),
    },
    cast: {
      roleLabel: t("payables.characterRole"),
      icon: CATEGORY_CONFIG.cast.icon,
      emptyMessage: t("payables.noCastPayables"),
      title: t("payables.castPayables"),
    },
    vendor: {
      roleLabel: t("payables.serviceCategory"),
      icon: CATEGORY_CONFIG.vendor.icon,
      emptyMessage: t("payables.noVendorPayables"),
      title: t("payables.vendorPayables"),
    },
  };
}

/** Localized milestone status label. */
export function useStatusLabel(): (status: MilestoneUiStatus) => string {
  const { t } = useTranslation();
  return (status) => t(STATUS_LABEL_KEY[status] ?? STATUS_LABEL_KEY.pending);
}
