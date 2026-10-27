/** Shared types for the flat, Excel-like Payables grid. */

export type MilestoneUiStatus = "pending" | "requested" | "approved" | "paid";

export type PayableCategory = "crew" | "cast" | "vendor";

/** One payment milestone as returned by the data layer (flat row). */
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
  milestone_status: MilestoneUiStatus;
  /** Scheduled due date (ISO yyyy-mm-dd) used for overdue highlighting. */
  due_date?: string;
  paid_date?: string;
  payment_ref?: string;
  /** GL: how the payment was executed. */
  payment_method?: string;
  /** GL: funding account the payment came from. */
  source_account?: string;
  /** External proof-of-payment link. */
  receipt_url?: string;
  notes?: string;
  /** Payment request paying this instalment (db/pending/176), when there is one. */
  payment_request_id?: string;
  payment_request_status?:
    "draft" | "waiting_approval" | "approved" | "paid" | "rejected" | "cancelled";
  /** Rejection / cancellation reason of the latest request. */
  payment_request_reason?: string;
  /** The current user raised the open request. */
  requested_by_me?: boolean;
  /** Contract approved (Active) — payment can be requested only then. */
  contract_approved?: boolean;
  /** A04: contract cancelled (cancel_payroll_contract). */
  contract_cancelled?: boolean;
  /** Reason sent with an un-approve / withdraw action (not stored on the row). */
  action_reason?: string;
  /** Stored instalment status without a payment request behind it (legacy hand-set). */
  legacy_status?: boolean;
}

/** Frontend-only pivot: one row per contract / beneficiary. */
export interface PayableRow {
  beneficiary_id: string;
  beneficiary_name: string;
  beneficiary_role: string;
  department?: string;
  contract_id: string;
  contract_total: number;
  currency: string;
  total_paid: number;
  /** Approved, not paid (glossary: Payable). */
  payable: number;
  /** Not approved yet (glossary: Commitment); 0 once the contract is cancelled. */
  commitment: number;
  /** payable + commitment — still to pay on the contract. */
  remaining: number;
  contract_cancelled: boolean;
  milestones: PayableMilestone[];
}

export type StatusFilter = "all" | "has_pending" | "has_requested" | "fully_paid";
export type SortKey = "name" | "remaining" | "deal";

export interface PayablesGridProps {
  category: PayableCategory;
  milestones: PayableMilestone[];
  isLoading?: boolean;
  onMilestoneUpdate: (milestoneId: string, updates: Partial<PayableMilestone>) => Promise<void>;
}
