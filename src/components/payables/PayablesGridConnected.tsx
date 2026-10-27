import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useStore, type PayrollRow } from "@/lib/store";
import { useCan } from "@/lib/rbac";
import { useAuthRoles } from "@/lib/auth-roles";
import { useProjectLock } from "@/lib/project-lock";
import {
  cancelPaymentRequest,
  createPaymentRequest,
  executePaymentRequest,
  requestForMilestone,
  toRequestMethod,
  usePaymentRequests,
} from "@/lib/payment-requests";
import { PayablesGrid } from "./PayablesGrid";
import type { MilestoneUiStatus, PayableCategory, PayableMilestone } from "./payables-types";

/**
 * Store ↔ grid adapter.
 *
 * The grid is pure UI, so all database access lives here. Contract milestones
 * are stored on `payroll.payment_schedule`. Their status is driven by the
 * payment request that pays them (db/pending/176): requesting payment creates
 * a payment_requests row (Payment Approvals), approval / payment there moves
 * the instalment to Approved / Paid. The grid never sets those by hand.
 */
/** UI status of an instalment whose payment request is open or paid (the request wins). */
const fromRequestStatus = (s?: string): MilestoneUiStatus | null =>
  s === "waiting_approval"
    ? "requested"
    : s === "approved"
      ? "approved"
      : s === "paid"
        ? "paid"
        : null;

const splitId = (id: string) => {
  const idx = id.indexOf(":");
  return { rowId: id.slice(0, idx), milestoneId: id.slice(idx + 1) };
};

export function PayablesGridConnected({ category }: { category: PayableCategory }) {
  const { t } = useTranslation();
  const payroll = useStore((s) => s.payroll);
  const people = useStore((s) => s.people);
  const vendors = useStore((s) => s.vendors);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const orgId = projects.find((p) => p.id === activeProjectId)?.organizationId ?? null;
  const setMilestoneStatus = useStore((s) => s.setMilestoneStatus);
  const syncPayrollForContract = useStore((s) => s.syncPayrollForContract);
  const refreshPayrollRow = useStore((s) => s.refreshPayrollRow);
  const can = useCan();
  const { userId } = useAuthRoles();
  const { locked } = useProjectLock();
  const readOnly = !can("payroll.execute") || locked;

  const { rows: requests, refresh: refreshRequests } = usePaymentRequests(
    orgId && activeProjectId
      ? { organizationId: orgId, projectId: activeProjectId, sourceType: "payroll_row" }
      : undefined,
  );

  const milestones = useMemo<PayableMilestone[]>(() => {
    const personById = new Map(people.map((p) => [p.id, p as any]));
    const vendorById = new Map(vendors.map((v) => [v.id, v as any]));
    const out: PayableMilestone[] = [];

    for (const row of payroll as PayrollRow[]) {
      if (row.kind !== category) continue;
      const person = personById.get(row.refId);
      const vendor = vendorById.get(row.refId);
      const total = Number(row.netPayable ?? row.totalAmount) || 0;
      const schedule = Array.isArray(row.paymentSchedule) ? row.paymentSchedule : [];

      schedule.forEach((m, i) => {
        const amount =
          m.amount !== null && m.amount !== undefined
            ? Number(m.amount)
            : (total * Number(m.percent ?? 0)) / 100;
        const legacyPaid = row.payments?.[i] === "Paid";
        const req = requestForMilestone(requests, row.id, m.id);
        out.push({
          id: `${row.id}:${m.id}`,
          contract_id: row.id,
          beneficiary_id: row.refId || row.id,
          beneficiary_name: row.name,
          beneficiary_role:
            category === "vendor"
              ? (vendor?.category ?? "")
              : ((category === "cast" ? person?.character : person?.position) ??
                person?.position ??
                ""),
          department: person?.department ?? undefined,
          contract_total: total,
          currency: "SAR",
          milestone_number: i + 1,
          milestone_label: m.label || undefined,
          milestone_amount: amount,
          // The request wins. Hold / Approved set by hand before the approval
          // flow have no request behind them: they are requested again.
          milestone_status:
            fromRequestStatus(req?.status) ??
            (m.status === "Paid" || (!m.status && legacyPaid) ? "paid" : "pending"),
          due_date: m.dueDate || undefined,
          paid_date: m.paidDate ?? undefined,
          payment_ref: m.paidRef ?? undefined,
          payment_method: m.paymentMethod ?? undefined,
          source_account: m.sourceAccount ?? undefined,
          receipt_url: m.receiptUrl ?? undefined,
          notes: m.paidNotes ?? undefined,
          payment_request_id: req?.id,
          payment_request_status: req?.status,
          payment_request_reason: req?.rejection_reason ?? req?.cancellation_reason ?? undefined,
          requested_by_me: !!req && !!userId && req.requested_by === userId,
          // People contracts must be Active; vendors / payroll-run rows have no contract status.
          contract_approved: person ? person.contractStatus === "Active" : true,
        });
      });
    }
    return out;
  }, [payroll, people, vendors, category, requests, userId]);

  const onMilestoneUpdate = useCallback(
    async (milestoneId: string, updates: Partial<PayableMilestone>) => {
      if (readOnly) {
        const message = t("payables.toasts.noPermission");
        toast.error(message);
        throw new Error(message);
      }
      const { rowId, milestoneId: msId } = splitId(milestoneId);
      const row = (payroll as PayrollRow[]).find((r) => r.id === rowId);
      const ms = milestones.find((m) => m.id === milestoneId);
      if (!row || !ms) return;

      try {
        if (updates.milestone_amount !== undefined) {
          const schedule = (row.paymentSchedule ?? []).map((m) =>
            m.id === msId ? { ...m, amount: Number(updates.milestone_amount!.toFixed(2)) } : m,
          );
          await syncPayrollForContract(row.refId, { paymentSchedule: schedule });
          toast.success(t("payables.toasts.amountUpdated"));
          return;
        }

        const next = updates.milestone_status;
        if (!next) return;

        // Request payment → a real payment request on Payment Approvals.
        if (next === "requested") {
          if (ms.contract_approved === false)
            throw new Error(t("approvals.payables.contractNotApproved"));
          if (!orgId || !activeProjectId) throw new Error(t("approvals.pickProject"));
          const committed = milestones
            .filter(
              (m) =>
                m.contract_id === row.id &&
                m.payment_request_status &&
                ["waiting_approval", "approved", "paid"].includes(m.payment_request_status),
            )
            .reduce((a, m) => a + m.milestone_amount, 0);
          await createPaymentRequest({
            organizationId: orgId,
            projectId: activeProjectId,
            sourceType: "payroll_row",
            sourceId: row.id,
            sourceLabel: `${row.name} · ${ms.milestone_label || t("approvals.payables.instalmentN", { n: ms.milestone_number })}`,
            totalAmount: ms.contract_total,
            previouslyPaid: committed,
            requestedAmount: Number(ms.milestone_amount.toFixed(2)),
            currency: "SAR",
            submitImmediately: true,
            payrollMilestoneId: msId,
          });
          toast.success(t("payables.toasts.requested"));
        } else if (next === "pending" && ms.milestone_status === "requested") {
          // Withdraw: the request is cancelled (recorded), the instalment returns to Pending.
          if (!ms.payment_request_id) return;
          await cancelPaymentRequest(ms.payment_request_id, t("approvals.payables.withdrawReason"));
          toast.success(t("payables.toasts.reset"));
        } else if (next === "paid") {
          if (!ms.payment_request_id || ms.payment_request_status !== "approved") {
            throw new Error(t("approvals.payables.approveFirst"));
          }
          if (!can("payments.execute")) throw new Error(t("payables.toasts.noPermission"));
          await executePaymentRequest({
            id: ms.payment_request_id,
            paymentDate: updates.paid_date ?? new Date().toISOString().slice(0, 10),
            method: toRequestMethod(updates.payment_method),
            notes: updates.payment_ref ? `Ref ${updates.payment_ref}` : null,
          });
          // Execution details the request has no column for; the status itself
          // is already Paid (set by the database from the request).
          await setMilestoneStatus(rowId, msId, "Paid", {
            paidDate: updates.paid_date ?? new Date().toISOString().slice(0, 10),
            paidRef: updates.payment_ref ?? undefined,
            paymentMethod: updates.payment_method ?? undefined,
            sourceAccount: updates.source_account ?? undefined,
            receiptUrl: updates.receipt_url ?? undefined,
            paidNotes: updates.notes ?? undefined,
          });
          toast.success(t("payables.toasts.paid"));
        } else if (next === "pending" && ms.milestone_status === "paid") {
          // Legacy instalment paid before the approval flow (no request): undo stays possible.
          await setMilestoneStatus(rowId, msId, "Pending");
          toast.success(t("payables.toasts.reset"));
        }
        await Promise.all([refreshRequests(), refreshPayrollRow(rowId)]);
      } catch (e: any) {
        toast.error(e?.message ?? t("payables.toasts.failed"));
        throw e;
      }
    },
    [
      payroll,
      milestones,
      readOnly,
      orgId,
      activeProjectId,
      can,
      setMilestoneStatus,
      syncPayrollForContract,
      refreshRequests,
      refreshPayrollRow,
      t,
    ],
  );

  return (
    <PayablesGrid
      category={category}
      milestones={milestones}
      onMilestoneUpdate={onMilestoneUpdate}
      readOnly={readOnly}
    />
  );
}

export default PayablesGridConnected;
