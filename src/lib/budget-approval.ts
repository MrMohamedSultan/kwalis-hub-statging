// Pure rules of the board approval flow (db/pending/206). The database is
// the authority (submit_budget_for_approval / decide_budget_approval /
// publish_budget_version); these mirror it so the screen only offers what
// the server will accept.

export type BudgetStatusValue =
  "Draft" | "Pending Approval" | "Locked/Approved" | "Revision Requested";
export type ApprovalRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type ApprovalDecisionValue = "pending" | "approved" | "rejected";
export type VersionLite = { id: string; status: "draft" | "active" | "archived" };

/** Project roles that may send the budget (plus org admins / super admins). */
export const SUBMITTER_PROJECT_ROLES = ["owner", "admin", "producer"] as const;

export function canSubmitBudget(input: {
  isSuperAdmin: boolean;
  isOrgAdmin: boolean;
  projectRole: string | null;
  isExecutive: boolean;
}): boolean {
  if (input.isSuperAdmin) return true;
  if (input.isExecutive) return false;
  if (input.isOrgAdmin) return true;
  return (SUBMITTER_PROJECT_ROLES as readonly string[]).includes(input.projectRole ?? "");
}

/**
 * Versions that can be sent: every draft, plus the active version while the
 * budget is not yet approved. Nothing while a request is pending.
 */
export function submittableVersions<T extends VersionLite>(
  versions: T[],
  budgetStatus: BudgetStatusValue,
  hasPending: boolean,
): T[] {
  if (hasPending) return [];
  return versions.filter(
    (v) => v.status === "draft" || (v.status === "active" && budgetStatus !== "Locked/Approved"),
  );
}

export function decisionProgress(decisions: { decision: ApprovalDecisionValue }[]): {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
} {
  const approved = decisions.filter((d) => d.decision === "approved").length;
  const rejected = decisions.filter((d) => d.decision === "rejected").length;
  return {
    total: decisions.length,
    approved,
    rejected,
    pending: decisions.length - approved - rejected,
  };
}

/** May this user decide now (own pending row, not the sender, request pending)? */
export function canDecide(
  request: { status: ApprovalRequestStatus; submittedBy: string | null },
  decisions: { approverId: string; decision: ApprovalDecisionValue }[],
  userId: string | null,
): boolean {
  if (!userId || request.status !== "pending" || request.submittedBy === userId) return false;
  return decisions.some((d) => d.approverId === userId && d.decision === "pending");
}

/** A reject needs a reason (same rule as the database). */
export function rejectReasonError(reason: string): "required" | "too_long" | null {
  const r = reason.trim();
  if (!r) return "required";
  if (r.length > 1000) return "too_long";
  return null;
}
