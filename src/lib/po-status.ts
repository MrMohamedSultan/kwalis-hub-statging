// Purchase order status moves after approval (X08, db/pending/204). The
// database applies the rules; this mirrors them for the form.
export const PO_APPROVED_STATES = ["Approved", "Issued"] as const;
const isApprovedState = (s: string) => (PO_APPROVED_STATES as readonly string[]).includes(s);

/**
 * Moving an approved (or once approved) PO to Draft / Open / Rejected needs an
 * approver and a written reason. Closed needs it fully invoiced or paid (the
 * database checks); Cancelled goes through "Cancel PO" (its own reason).
 */
export function poStatusMoveNeedsReason(
  initial: { status: string; first_approved_at?: string | null } | null,
  next: string,
): boolean {
  if (!initial || next === initial.status) return false;
  if (!isApprovedState(initial.status) && !initial.first_approved_at) return false;
  if (next === "Closed" || next === "Cancelled" || isApprovedState(next)) return false;
  return next === "Draft" || next === "Rejected" || isApprovedState(initial.status);
}
