import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useStore, type MilestoneStatus, type PayrollRow } from "@/lib/store";
import { useCan } from "@/lib/rbac";
import { useProjectLock } from "@/lib/project-lock";
import { PayablesGrid } from "./PayablesGrid";
import type { MilestoneUiStatus, PayableCategory, PayableMilestone } from "./payables-types";

/**
 * Store ↔ grid adapter.
 *
 * The grid is pure UI, so all database access lives here. Contract milestones
 * are stored on `payroll.payment_schedule`; the grid's four UI states map onto
 * the four persisted milestone states.
 */
const toUiStatus = (s?: MilestoneStatus): MilestoneUiStatus =>
  s === "Paid" ? "paid" : s === "Approved" ? "approved" : s === "Hold" ? "requested" : "pending";

const toStoreStatus = (s: MilestoneUiStatus): MilestoneStatus =>
  s === "paid" ? "Paid" : s === "approved" ? "Approved" : s === "requested" ? "Hold" : "Pending";

const splitId = (id: string) => {
  const idx = id.indexOf(":");
  return { rowId: id.slice(0, idx), milestoneId: id.slice(idx + 1) };
};

export function PayablesGridConnected({ category }: { category: PayableCategory }) {
  const { t } = useTranslation();
  const payroll = useStore((s) => s.payroll);
  const people = useStore((s) => s.people);
  const vendors = useStore((s) => s.vendors);
  const setMilestoneStatus = useStore((s) => s.setMilestoneStatus);
  const syncPayrollForContract = useStore((s) => s.syncPayrollForContract);
  const can = useCan();
  const { locked } = useProjectLock();
  const readOnly = !can("payroll.execute") || locked;

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
          milestone_status: m.status ? toUiStatus(m.status) : legacyPaid ? "paid" : "pending",
          due_date: m.dueDate || undefined,
          paid_date: m.paidDate ?? undefined,
          payment_ref: m.paidRef ?? undefined,
          payment_method: m.paymentMethod ?? undefined,
          source_account: m.sourceAccount ?? undefined,
          receipt_url: m.receiptUrl ?? undefined,
          notes: m.paidNotes ?? undefined,
        });
      });
    }
    return out;
  }, [payroll, people, vendors, category]);

  const onMilestoneUpdate = useCallback(
    async (milestoneId: string, updates: Partial<PayableMilestone>) => {
      if (readOnly) {
        const message = t("payables.toasts.noPermission");
        toast.error(message);
        throw new Error(message);
      }
      const { rowId, milestoneId: msId } = splitId(milestoneId);
      const row = (payroll as PayrollRow[]).find((r) => r.id === rowId);
      if (!row) return;

      try {
        if (updates.milestone_amount !== undefined) {
          const schedule = (row.paymentSchedule ?? []).map((m) =>
            m.id === msId ? { ...m, amount: Number(updates.milestone_amount!.toFixed(2)) } : m,
          );
          await syncPayrollForContract(row.refId, { paymentSchedule: schedule });
          toast.success(t("payables.toasts.amountUpdated"));
          return;
        }

        if (updates.milestone_status) {
          const next = toStoreStatus(updates.milestone_status);
          await setMilestoneStatus(
            rowId,
            msId,
            next,
            next === "Paid"
              ? {
                  paidDate: updates.paid_date ?? new Date().toISOString().slice(0, 10),
                  paidRef: updates.payment_ref ?? undefined,
                  paymentMethod: updates.payment_method ?? undefined,
                  sourceAccount: updates.source_account ?? undefined,
                  receiptUrl: updates.receipt_url ?? undefined,
                  paidNotes: updates.notes ?? undefined,
                }
              : undefined,
          );
          toast.success(
            next === "Paid"
              ? t("payables.toasts.paid")
              : next === "Hold"
                ? t("payables.toasts.requested")
                : next === "Approved"
                  ? t("payables.toasts.approved")
                  : t("payables.toasts.reset"),
          );
        }
      } catch (e: any) {
        toast.error(e?.message ?? t("payables.toasts.failed"));
        throw e;
      }
    },
    [payroll, readOnly, setMilestoneStatus, syncPayrollForContract, t],
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
