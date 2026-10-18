// Bridge between the app's `budget_status_enum` values and the simple
// draft / submitted / approved / rejected vocabulary used by the Board portal.

export type BoardBudgetStatus = "draft" | "submitted" | "approved" | "rejected";

export const DB_BUDGET_STATUS = {
  draft: "Draft",
  submitted: "Pending Approval",
  approved: "Locked/Approved",
  rejected: "Revision Requested",
} as const;

export function toBoardStatus(dbStatus: string | null | undefined): BoardBudgetStatus {
  switch (dbStatus) {
    case "Pending Approval":
      return "submitted";
    case "Locked/Approved":
      return "approved";
    case "Revision Requested":
      return "rejected";
    default:
      return "draft";
  }
}
