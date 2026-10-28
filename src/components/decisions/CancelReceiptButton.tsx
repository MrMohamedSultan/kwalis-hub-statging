// Recorded cancellation of an approved petty cash receipt (db/pending/201):
// approved receipts are locked and never deleted.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { ReasonDialog } from "@/components/decisions/ApprovalControls";

export function CancelReceiptButton({
  receiptId,
  onDone,
}: {
  receiptId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t("decisions.receipt.cancelHint")}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
      >
        <Ban className="size-3" />
        {t("decisions.approval.cancel")}
      </button>
      <ReasonDialog
        open={open}
        title={t("decisions.receipt.cancelTitle")}
        description={t("decisions.receipt.cancelHint")}
        confirmLabel={t("decisions.approval.cancel")}
        onClose={() => setOpen(false)}
        onConfirm={async (reason) => {
          const { error } = await (supabase.rpc as any)("cancel_petty_receipt", {
            p_receipt: z.string().uuid().parse(receiptId),
            p_reason: reason,
          });
          if (error) {
            toast.error(error.message);
            throw error;
          }
          toast.success(t("decisions.receipt.cancelled"));
          onDone();
        }}
      />
    </>
  );
}
