// Labels of the WHT service types (wht_rate_rules, db/pending/201).
// The seeded Saudi table has translations under decisions.wht.service_types;
// rows added by an admin show their own label_en / label_ar, else the key.

export const SEEDED_WHT_SERVICE_TYPES = [
  "default",
  "management_fees",
  "royalties",
  "technical_consulting",
  "rent",
  "air_tickets_freight",
  "international_telecom",
  "insurance_reinsurance",
  "dividends",
  "loan_returns",
  "related_party_services",
  "other",
] as const;

export function whtServiceLabel(
  serviceType: string,
  lang: "en" | "ar",
  row: { label_en?: string | null; label_ar?: string | null } | null | undefined,
  t: (key: string) => string,
): string {
  if ((SEEDED_WHT_SERVICE_TYPES as readonly string[]).includes(serviceType)) {
    return t(`decisions.wht.service_types.${serviceType}`);
  }
  const own = lang === "ar" ? (row?.label_ar ?? row?.label_en) : (row?.label_en ?? row?.label_ar);
  return own?.trim() || serviceType;
}
