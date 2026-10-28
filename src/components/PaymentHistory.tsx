import { useMemo, useState } from "react";
import { storageAudited } from "@/lib/storage-audit";
import { supabase } from "@/integrations/supabase/client";
import { useStore, formatUSD, type PaymentSource } from "@/lib/store";
import { Download, FileText, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { useTranslation } from "react-i18next";
export function PaymentHistory({
  sourceType,
  sourceId,
}: {
  sourceType: PaymentSource;
  sourceId: string;
}) {
  const { t } = useTranslation();

  const { payments } = useStore();
  const rows = useMemo(
    () =>
      payments
        .filter((p) => p.sourceType === sourceType && p.sourceId === sourceId)
        .sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : -1)),
    [payments, sourceType, sourceId],
  );

  const openReceipt = async (path: string) => {
    try {
      const { data, error } = await storageAudited.from("contracts").createSignedUrl(path, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open receipt.");
    }
  };

  if (rows.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic px-3 py-2">
        {t("paymenthistory.no_payments_recorded_yet")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="text-start px-3 py-1.5 font-medium uppercase tracking-wider">Date</th>
            <th className="text-end px-3 py-1.5 font-medium uppercase tracking-wider">Amount</th>
            <th className="text-start px-3 py-1.5 font-medium uppercase tracking-wider">Method</th>
            <th className="text-start px-3 py-1.5 font-medium uppercase tracking-wider">Notes</th>
            <th className="text-start px-3 py-1.5 font-medium uppercase tracking-wider">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-border">
              <td className="px-3 py-2 tabular-nums">{p.paymentDate}</td>
              <td className="px-3 py-2 text-end font-semibold tabular-nums">
                {formatUSD(Number(p.amount))}
              </td>
              <td className="px-3 py-2">{p.method}</td>
              <td
                className="px-3 py-2 text-muted-foreground truncate max-w-[220px]"
                title={p.notes ?? ""}
              >
                {p.notes || "—"}
              </td>
              <td className="px-3 py-2">
                {p.proofPath ? (
                  <button
                    type="button"
                    onClick={() => openReceipt(p.proofPath!)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-brand/15 text-brand hover:bg-brand/25 border border-brand/30"
                    title={t("paymenthistory.open_receipt")}
                  >
                    <FileText className="size-3" />
                    <Download className="size-3" />
                  </button>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaymentHistoryToggle({
  sourceType,
  sourceId,
  colSpan,
  initialOpen = false,
}: {
  sourceType: PaymentSource;
  sourceId: string;
  colSpan: number;
  initialOpen?: boolean;
}) {
  const { payments } = useStore();
  const [open, setOpen] = useState(initialOpen);
  const count = payments.filter(
    (p) => p.sourceType === sourceType && p.sourceId === sourceId,
  ).length;
  return (
    <>
      <tr className="border-b border-border bg-surface-2/40">
        <td colSpan={colSpan} className="px-3 py-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            Payment History{" "}
            {count > 0 && <span className="text-brand font-semibold">({count})</span>}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-surface-2/60">
          <td colSpan={colSpan} className="p-2">
            <PaymentHistory sourceType={sourceType} sourceId={sourceId} />
          </td>
        </tr>
      )}
    </>
  );
}
