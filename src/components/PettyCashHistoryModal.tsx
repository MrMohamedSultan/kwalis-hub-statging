import { formatDateTime } from "@/lib/date-format";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { supabase } from "@/integrations/supabase/client";
import { History as HistoryIcon } from "lucide-react";

import { useTranslation } from "react-i18next";
type LogRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  summary: string;
  severity: string;
  entity: string | null;
  details: Record<string, unknown> | null;
};

const ACTION_LABEL: Record<string, string> = {
  float_issued: "Float issued",
  float_submitted_for_approval: "Submitted for approval",
  float_approved: "Approved",
  float_rejected: "Rejected",
  float_accepted: "Accepted by holder",
  float_closed: "Float closed",
  receipt_logged: "Receipt logged",
  approved: "Receipt approved",
  rejected: "Receipt rejected",
};

function badgeClass(action: string): string {
  if (action.includes("reject")) return "bg-destructive/15 text-destructive";
  if (action.includes("approve") || action.includes("accept")) return "bg-success/15 text-success";
  if (action.includes("closed")) return "bg-muted/20 text-foreground";
  if (action.includes("logged") || action.includes("issued") || action.includes("submitted"))
    return "bg-info/15 text-info";
  return "bg-surface-2 text-foreground/80";
}

export function PettyCashHistoryModal({
  floatId,
  floatLabel,
  receiptIds,
  onClose,
}: {
  floatId: string;
  floatLabel: string;
  receiptIds: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    const entities = [
      `cash_advance:${floatId}`,
      ...receiptIds.map((r) => `cash_advance_receipt:${r}`),
    ];
    (async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, created_at, actor_id, actor_email, action, summary, severity, entity, details")
        .in("entity", entities)
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancel) return;
      if (error) setError(error.message);
      else setRows((data ?? []) as unknown as LogRow[]);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [floatId, receiptIds.join(",")]);

  return (
    <Modal onClose={onClose} title={`Activity — ${floatLabel}`}>
      <div className="text-xs text-muted-foreground mb-3 inline-flex items-center gap-1.5">
        <HistoryIcon className="size-3.5" />
        {t("pettycashhistorymodal.timestamped_history_for_this_float_and_its_receipts")}
      </div>

      {loading && (
        <div className="text-sm text-muted-foreground py-6 text-center">Loading history…</div>
      )}
      {error && <div className="text-sm text-destructive py-6 text-center">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="text-sm text-muted-foreground py-6 text-center">
          {t("pettycashhistorymodal.no_audit_entries_yet_for_this_float")}
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <ul className="space-y-2 max-h-[60vh] overflow-auto pr-1">
          {rows.map((r) => {
            const isReceipt = r.entity?.startsWith("cash_advance_receipt:");
            const label = ACTION_LABEL[r.action] ?? r.action.replace(/_/g, " ");
            const actor = r.actor_email || (r.actor_id ? r.actor_id.slice(0, 8) : "system");
            return (
              <li key={r.id} className="rounded-lg border border-border bg-surface-2/60 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] uppercase tracking-wide ${badgeClass(
                          r.action,
                        )}`}
                      >
                        {label}
                      </span>
                      {isReceipt && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          receipt
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-foreground/90 break-words">{r.summary}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      by <span className="text-foreground/80">{actor}</span>
                    </div>
                  </div>
                  <time className="text-[11px] text-muted-foreground shrink-0" dir="ltr">
                    {formatDateTime(r.created_at)}
                  </time>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg border border-border hover:bg-muted text-sm"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
