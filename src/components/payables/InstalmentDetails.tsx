// R15: due date, requester, approvers and the history of one instalment.
// Data: public.get_instalment_history (db/pending/198) — payment requests
// (176), approval steps (payment_request_approvals), rejections,
// cancellations, reversals (180 accrual_reversals) and the payment.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { fmt } from "./payables-utils";
import type { PayableMilestone } from "./payables-types";

interface HistoryRow {
  at: string;
  event:
    "requested" | "approved_level" | "approved" | "rejected" | "cancelled" | "reversed" | "paid";
  actor_name: string | null;
  level_label: string | null;
  note: string | null;
  amount: number | null;
}

export function useInstalmentHistory(payrollId: string, milestoneId: string, enabled = true) {
  return useQuery({
    queryKey: ["instalment-history", payrollId, milestoneId],
    enabled: enabled && !!payrollId && !!milestoneId,
    staleTime: 15_000,
    queryFn: async (): Promise<HistoryRow[]> => {
      const { data, error } = await (supabase.rpc as any)("get_instalment_history", {
        p_payroll_id: payrollId,
        p_milestone_id: milestoneId,
      });
      if (error) throw error;
      return (data ?? []) as HistoryRow[];
    },
  });
}

export function InstalmentDetails({ milestone }: { milestone: PayableMilestone }) {
  const { t } = useTranslation();
  const msId = milestone.id.slice(milestone.contract_id.length + 1);
  const q = useInstalmentHistory(milestone.contract_id, msId);
  const rows = q.data ?? [];
  const lastRequest = [...rows].reverse().find((r) => r.event === "requested");
  const approvers = rows.filter((r) => r.event === "approved_level" || r.event === "approved");
  const approverNames = Array.from(
    new Set(approvers.map((r) => r.actor_name).filter((n): n is string => !!n)),
  );

  const line = (label: string, value: string | null | undefined) => (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-end text-xs font-medium text-foreground">{value || "—"}</span>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="space-y-1 rounded-lg border border-border p-3">
        {line(t("taxlive.pay.dueDate"), milestone.due_date ? formatDate(milestone.due_date) : null)}
        {line(t("taxlive.pay.requester"), lastRequest?.actor_name)}
        {line(t("taxlive.pay.approver"), approverNames.join(", "))}
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          {t("taxlive.pay.history")}
        </div>
        {q.isLoading ? (
          <p className="text-[11px] text-muted-foreground">{t("taxlive.common.loading")}</p>
        ) : q.error ? (
          <p className="text-[11px] text-destructive">{(q.error as Error).message}</p>
        ) : rows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t("taxlive.pay.noHistory")}</p>
        ) : (
          <ol className="space-y-1.5 border-s border-border ps-3">
            {rows.map((r, i) => (
              <li key={i} className="text-[11px] leading-snug">
                <div className="font-medium text-foreground">
                  {t(`taxlive.pay.event.${r.event}`)}
                  {r.level_label ? ` · ${r.level_label}` : ""}
                  {r.amount != null && r.event !== "approved_level" ? ` · ${fmt(r.amount)}` : ""}
                </div>
                <div className="text-muted-foreground">
                  {formatDateTime(r.at)}
                  {r.actor_name ? ` · ${r.actor_name}` : ""}
                </div>
                {r.note && <div className="text-muted-foreground">“{r.note}”</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export default InstalmentDetails;
