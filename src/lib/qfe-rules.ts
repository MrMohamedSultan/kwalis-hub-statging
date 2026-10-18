// Smart QFE (rebate) rules engine — shared between the Invoice UI, the QFE
// ledger, and export sheets so every surface labels the exact same rule.
//
// Rules:
//   A — Logistics/accommodation: follow beneficiary residency.
//   B — General vendor spend: follow vendor nationality.
//   C — Service rendered outside KSA: never eligible.

export type QfeRule = "A" | "B" | "C";

export type QfeExplain = {
  value: boolean;
  rule: QfeRule;
  reason: string;
};

const LOGISTICS_RE =
  /hotel|accommod|lodging|travel|per\s*diem|flight|airfare|air\s*ticket|transport|vehicle|car\s*rent|driver|shuttle|logist/i;

export const isSaudiNationality = (n?: string | null): boolean => {
  const t = (n ?? "").trim().toLowerCase();
  return t === "saudi" || t === "saudi arabia" || t === "ksa";
};

export function explainAutoQfe(input: {
  serviceInsideKsa: boolean;
  description?: string;
  department?: string;
  budgetCode?: string;
  beneficiaryNationality?: string | null;
  vendorNationality?: string | null;
  isNonSaudiVendor?: boolean;
}): QfeExplain {
  if (!input.serviceInsideKsa) {
    return {
      value: false,
      rule: "C",
      reason: "Rule C — Service rendered outside KSA is never QFE eligible.",
    };
  }
  const haystack = `${input.description ?? ""} ${input.department ?? ""} ${input.budgetCode ?? ""}`;
  const isLogistics = LOGISTICS_RE.test(haystack);
  if (isLogistics && input.beneficiaryNationality != null && input.beneficiaryNationality !== "") {
    const saudi = isSaudiNationality(input.beneficiaryNationality);
    return {
      value: saudi,
      rule: "A",
      reason: `Rule A — Logistics/accommodation follows beneficiary residency (${input.beneficiaryNationality}${saudi ? " — KSA resident, eligible" : " — non-KSA, not eligible"}).`,
    };
  }
  if (input.isNonSaudiVendor) {
    return {
      value: false,
      rule: "B",
      reason: "Rule B — Vendor is marked non-Saudi; general spend is not QFE eligible.",
    };
  }
  if (input.vendorNationality && input.vendorNationality.trim() !== "") {
    const saudi = isSaudiNationality(input.vendorNationality);
    return {
      value: saudi,
      rule: "B",
      reason: `Rule B — General vendor spend follows vendor nationality (${input.vendorNationality}${saudi ? " — KSA vendor, eligible" : " — non-KSA vendor, not eligible"}).`,
    };
  }
  return {
    value: true,
    rule: "B",
    reason:
      "Rule B — Vendor nationality unknown; assumed KSA-resident vendor, eligible by default.",
  };
}

export function computeAutoQfe(input: Parameters<typeof explainAutoQfe>[0]): boolean {
  return explainAutoQfe(input).value;
}

/** Human label for the "QFE Rule Applied" column in exports/filters. */
export type QfeRuleLabel = "Rule A" | "Rule B" | "Rule C" | "Manual Override";

export function qfeRuleLabel(
  rule: QfeRule | null | undefined,
  manualOverride: boolean,
): QfeRuleLabel {
  if (manualOverride) return "Manual Override";
  if (rule === "A") return "Rule A";
  if (rule === "C") return "Rule C";
  return "Rule B";
}
