// E08 invoice details as a compact sub-line for list / report rows.
import { useTranslation } from "react-i18next";
import { invoiceE08View, type InvoiceE08Input } from "@/lib/invoice-e08";

export function InvoiceE08Details({
  invoice,
  baseCurrency = "SAR",
  className = "",
}: {
  invoice: InvoiceE08Input;
  baseCurrency?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const v = invoiceE08View(invoice, baseCurrency);
  const parts: React.ReactNode[] = [];
  if (v.fx)
    parts.push(
      <span key="fx" className="font-mono">
        {v.fx}
        {v.fxSource &&
          ` · ${t(`people.fx.source_${v.fxSource}`, { defaultValue: v.fxSource })}${v.fxDate ? ` ${v.fxDate}` : ""}`}
      </span>,
    );
  if (v.servicePeriod)
    parts.push(
      <span key="sp">
        {t("polish.e08.service_period")}: {v.servicePeriod}
      </span>,
    );
  if (v.serviceReceived)
    parts.push(
      <span key="sr">
        {t("polish.e08.received")}: {v.serviceReceived}
      </span>,
    );
  if (v.relatedParty)
    parts.push(
      <span
        key="rp"
        className="rounded-full border border-warning/40 bg-warning/15 px-1.5 text-warning"
        title={v.relatedPartyNote ?? undefined}
      >
        {t("ap.related_party")}
      </span>,
    );
  if (parts.length === 0) return null;
  return (
    <div
      className={`mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground ${className}`}
    >
      {parts}
    </div>
  );
}
