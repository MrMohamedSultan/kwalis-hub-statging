// E08 invoice fields as report rows show them: currency / FX with its
// source, service period, service received date, related party, PO ref and
// due date. Pure — the component (components/ap/InvoiceE08Details.tsx) adds
// the labels.
import { formatDate } from "@/lib/date-format";
import { formatAmount } from "@/lib/format-number";

export type InvoiceE08Input = {
  currency?: string | null;
  fxRate?: number | null;
  amountOriginal?: number | null;
  fxRateSource?: string | null;
  fxRateDate?: string | null;
  servicePeriodFrom?: string | null;
  servicePeriodTo?: string | null;
  serviceReceivedDate?: string | null;
  isRelatedParty?: boolean | null;
  relatedPartyNote?: string | null;
};

export type InvoiceE08View = {
  /** "USD 1,000.00 × 3.75" — null for an invoice in the base currency. */
  fx: string | null;
  fxSource: string | null;
  fxDate: string | null;
  servicePeriod: string | null;
  serviceReceived: string | null;
  relatedParty: boolean;
  relatedPartyNote: string | null;
};

export function invoiceE08View(i: InvoiceE08Input, baseCurrency = "SAR"): InvoiceE08View {
  const ccy = String(i.currency ?? "")
    .trim()
    .toUpperCase();
  const foreign = !!ccy && ccy !== String(baseCurrency || "SAR").toUpperCase();
  const rate = Number(i.fxRate) || 0;
  const fx = foreign
    ? [
        i.amountOriginal != null ? `${ccy} ${formatAmount(Number(i.amountOriginal), 2)}` : ccy,
        rate > 0 ? `× ${formatAmount(rate, 4)}` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null;
  const from = formatDate(i.servicePeriodFrom);
  const to = formatDate(i.servicePeriodTo);
  return {
    fx,
    fxSource: foreign ? (i.fxRateSource ?? null) : null,
    fxDate: foreign ? formatDate(i.fxRateDate) || null : null,
    servicePeriod: from || to ? `${from || "…"} – ${to || "…"}` : null,
    serviceReceived: formatDate(i.serviceReceivedDate) || null,
    relatedParty: !!i.isRelatedParty,
    relatedPartyNote: i.isRelatedParty ? (i.relatedPartyNote ?? null) : null,
  };
}
