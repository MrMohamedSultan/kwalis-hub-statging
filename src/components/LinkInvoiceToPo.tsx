// QA 29/10 (B05/B19): an invoice recorded without its purchase order counts
// twice on the Cost Report (the PO stays a commitment). This links an
// existing invoice — also an approved one — to its PO (db/pending/205
// link_invoice_to_po: same project, vendor, budget code, open amount).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Link2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatUSD, useStore, type Invoice } from "@/lib/store";
import { poOpenCommitment } from "@/lib/budget-position";
import { humanizeDbError } from "@/lib/db-errors";

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function LinkInvoiceToPo({ invoice }: { invoice: Invoice }) {
  const { t } = useTranslation();
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const invoices = useStore((s) => s.invoices);
  const [poId, setPoId] = useState("");
  const [busy, setBusy] = useState(false);

  const choices = useMemo(
    () =>
      purchaseOrders.filter((p) => {
        if (poOpenCommitment(p, invoices) + 0.005 < (Number(invoice.price) || 0)) return false;
        const vendorOk =
          p.vendorId && invoice.vendorId
            ? p.vendorId === invoice.vendorId
            : !norm(p.vendorName) || !norm(invoice.vendorName) || norm(p.vendorName) === norm(invoice.vendorName);
        const codeOk = !p.budgetCode || !invoice.budgetCode || p.budgetCode === invoice.budgetCode;
        return vendorOk && codeOk;
      }),
    [purchaseOrders, invoices, invoice],
  );

  if (invoice.purchaseOrderId || invoice.approvalStatus === "cancelled") return null;

  const link = async () => {
    if (!poId) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("link_invoice_to_po" as any, {
        p_invoice: invoice.id,
        p_po: poId,
      } as any);
      if (error) throw error;
      useStore.setState((s) => ({
        invoices: s.invoices.map((i) => (i.id === invoice.id ? { ...i, purchaseOrderId: poId } : i)),
      }));
      toast.success(t("ap.link_po_done"));
    } catch (e) {
      toast.error(humanizeDbError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col-span-2 rounded-xl border border-border bg-surface-2 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Link2 className="size-4" /> {t("ap.link_po_title")}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{t("ap.link_po_hint")}</p>
      {choices.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("ap.link_po_none")}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={poId}
            onChange={(e) => setPoId(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">{t("ap.no_purchase_order")}</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.poNumber} · {p.vendorName} ·{" "}
                {t("ap.po_open_amount", { amount: formatUSD(poOpenCommitment(p, invoices)) })}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!poId || busy}
            onClick={link}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("ap.link_po_button")}
          </button>
        </div>
      )}
    </div>
  );
}
