import { useTranslation } from "react-i18next";
import { suggestTaxResidency } from "@/lib/contract-terms";
import type { Invoice, Vendor } from "@/lib/store";

/**
 * E05 — what the vendor profile holds for tax and the Film Commission:
 * tax residency (suggested from country + bank country, confirmed by the
 * user) and the related-party flag. CR, VAT, country and bank are the
 * existing vendor fields.
 */
export function VendorTaxFields({
  vendor,
  onChange,
  inputCls,
}: {
  vendor: Vendor;
  onChange: (patch: Partial<Vendor>) => void;
  inputCls: string;
}) {
  const { t } = useTranslation();
  // undefined: db/pending/190 not applied — nothing to store yet
  if (vendor.taxResidency === undefined && vendor.relatedParty === undefined) return null;
  const suggested = suggestTaxResidency({
    nationality: vendor.companyNationality,
    bankCountry: vendor.bankCountry,
  });
  return (
    <>
      <label className="block text-sm">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("people.vendor.tax_residency")}
        </span>
        <select
          value={vendor.taxResidency ?? ""}
          onChange={(e) =>
            onChange({ taxResidency: (e.target.value || null) as Vendor["taxResidency"] })
          }
          className={`mt-1 ${inputCls}`}
        >
          <option value="">{t("people.vendor.not_confirmed")}</option>
          <option value="resident">{t("people.vendor.resident")}</option>
          <option value="non_resident">{t("people.vendor.non_resident")}</option>
        </select>
        {!vendor.taxResidency && (
          <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            {t("people.vendor.suggested", { value: t(`people.vendor.${suggested}`) })}
            <button
              type="button"
              onClick={() => onChange({ taxResidency: suggested })}
              className="underline hover:text-foreground"
            >
              {t("people.vendor.use_suggestion")}
            </button>
          </span>
        )}
      </label>
      <div className="text-sm">
        <label className="flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={!!vendor.relatedParty}
            onChange={(e) => onChange({ relatedParty: e.target.checked })}
            className="size-4 accent-[var(--brand)]"
          />
          <span>{t("people.vendor.related_party")}</span>
        </label>
        {vendor.relatedParty && (
          <input
            value={vendor.relatedPartyNote ?? ""}
            maxLength={1000}
            onChange={(e) => onChange({ relatedPartyNote: e.target.value })}
            placeholder={t("people.vendor.related_party_note")}
            className={`mt-2 ${inputCls}`}
          />
        )}
      </div>
    </>
  );
}

/** Values a new invoice takes from the picked vendor (E05). */
export function invoicePatchFromVendor(v: Vendor | undefined) {
  if (!v) {
    return {
      vendorId: null,
      vendorCrNo: null,
      vendorVatNo: null,
      vendorCountry: null,
      vendorTaxResidency: null,
      vendorBankCountry: null,
      vendorBankName: null,
    };
  }
  const residency =
    v.taxResidency ??
    suggestTaxResidency({ nationality: v.companyNationality, bankCountry: v.bankCountry });
  return {
    vendorId: v.id,
    vendorCrNo: v.crNo?.trim() || null,
    vendorVatNo: v.vatNo?.trim() || null,
    vendorCountry: v.companyNationality?.trim() || null,
    vendorTaxResidency: v.taxResidency === undefined ? undefined : residency,
    vendorBankCountry: v.bankCountry?.trim() || null,
    vendorBankName: v.bankName?.trim() || null,
    /** WHT applies to a non-resident vendor (decision 13). */
    isNonSaudiVendor: residency === "non_resident",
    isRelatedParty: !!v.relatedParty,
    relatedPartyNote: v.relatedParty ? (v.relatedPartyNote ?? null) : null,
  };
}

const VENDOR_SNAPSHOT_190 = [
  "vendorId",
  "vendorCrNo",
  "vendorVatNo",
  "vendorCountry",
  "vendorTaxResidency",
  "vendorBankCountry",
  "vendorBankName",
] as const;

/**
 * Editing an invoice and picking another vendor: the invoice takes the new
 * vendor's profile again, like on create (E05). The WHT flag is NOT changed
 * here because the saved WHT / net amounts were computed with the old one;
 * `whtDiffers` tells the form to warn instead. `has190` = the invoices table
 * has the vendor snapshot columns (db/pending/190).
 */
export function invoiceVendorChangePatch(
  invoice: Pick<Invoice, "vendorName" | "isNonSaudiVendor">,
  vendor: Vendor | undefined,
  has190: boolean,
): { patch: Partial<Invoice>; whtDiffers: boolean } {
  const { isNonSaudiVendor, ...rest } = invoicePatchFromVendor(vendor) as Partial<Invoice>;
  const patch: Partial<Invoice> = {
    vendorName: vendor?.name ?? invoice.vendorName,
    ...rest,
  };
  if (!vendor) {
    delete patch.isRelatedParty;
    delete patch.relatedPartyNote;
  }
  if (patch.vendorTaxResidency === undefined) delete patch.vendorTaxResidency;
  if (!has190) for (const k of VENDOR_SNAPSHOT_190) delete patch[k];
  const whtDiffers =
    !!vendor && isNonSaudiVendor !== undefined && !!isNonSaudiVendor !== !!invoice.isNonSaudiVendor;
  return { patch, whtDiffers };
}

/** Read-only box on the invoice: what came from the vendor profile. */
export function VendorInheritedSummary({ vendor }: { vendor: Vendor | undefined }) {
  const { t } = useTranslation();
  if (!vendor) return null;
  const residency =
    vendor.taxResidency ??
    suggestTaxResidency({
      nationality: vendor.companyNationality,
      bankCountry: vendor.bankCountry,
    });
  const items: [string, string][] = [
    [t("people.vendor.cr"), vendor.crNo || "—"],
    [t("people.vendor.vat"), vendor.vatNo || "—"],
    [t("people.vendor.country"), vendor.companyNationality || "—"],
    [
      t("people.vendor.tax_residency"),
      t(`people.vendor.${residency}`) +
        (vendor.taxResidency ? "" : ` (${t("people.vendor.suggested_short")})`),
    ],
    [t("people.vendor.bank_country"), vendor.bankCountry || "—"],
    [t("people.vendor.bank_name"), vendor.bankName || "—"],
  ];
  return (
    <div className="col-span-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-[12px]">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
        {t("people.vendor.from_profile")}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
        {items.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="truncate font-medium">
              <bdi>{v}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      {vendor.relatedParty && (
        <div className="mt-1 text-warning">{t("people.vendor.related_party_inherited")}</div>
      )}
    </div>
  );
}
