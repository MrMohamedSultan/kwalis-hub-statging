// Film Commission QPE (Qualified Production Expenditure) quick check for the
// Invoice form. The authoritative eligibility is computed in the database
// (public.rebate_transactions, db/pending/197) from the budget code's QPE
// mapping; this mirrors its invoice rules so the form shows the same answer.
// (File and export names keep "qfe" for compatibility; the term is QPE.)
//
// Rules:
//   A — Logistics/accommodation for a named person: the person must be Saudi
//       or have a Saudi mother.
//   B — General vendor spend: the vendor needs a commercial registration (CR)
//       on file; without one it NEEDS REVIEW and is not eligible (E06). A
//       vendor recorded as non-Saudi is not eligible.
//   C — Service rendered outside KSA: never eligible.

export type QfeRule = "A" | "B" | "C";

export type QfeExplain = {
  value: boolean;
  rule: QfeRule;
  reason: string;
  /** True when the answer is "not eligible until someone checks" (no CR, no nationality). */
  needsReview?: boolean;
};

const LOGISTICS_RE =
  /hotel|accommod|lodging|travel|per\s*diem|flight|airfare|air\s*ticket|transport|vehicle|car\s*rent|driver|shuttle|logist/i;

export const isSaudiNationality = (n?: string | null): boolean => {
  const t = (n ?? "").trim().toLowerCase();
  return (
    t === "saudi" ||
    t === "saudi arabia" ||
    t === "ksa" ||
    t === "sa" ||
    t === "سعودي" ||
    t === "السعودية" ||
    t === "المملكة العربية السعودية"
  );
};

export function explainAutoQfe(input: {
  serviceInsideKsa: boolean;
  description?: string;
  department?: string;
  budgetCode?: string;
  beneficiaryNationality?: string | null;
  /** people.mother_saudi of the beneficiary (172). */
  beneficiaryMotherSaudi?: boolean | null;
  vendorNationality?: string | null;
  /** The vendor's commercial registration number (vendors.cr_no). */
  vendorCrNo?: string | null;
  isNonSaudiVendor?: boolean;
}): QfeExplain {
  if (!input.serviceInsideKsa) {
    return {
      value: false,
      rule: "C",
      reason: "Rule C — Service rendered outside KSA is never QPE eligible.",
    };
  }
  const haystack = `${input.description ?? ""} ${input.department ?? ""} ${input.budgetCode ?? ""}`;
  const isLogistics = LOGISTICS_RE.test(haystack);
  if (isLogistics && input.beneficiaryNationality != null && input.beneficiaryNationality !== "") {
    const saudi = isSaudiNationality(input.beneficiaryNationality);
    const mother = !saudi && input.beneficiaryMotherSaudi === true;
    return {
      value: saudi || mother,
      rule: "A",
      reason: `Rule A — Logistics/accommodation for a person: eligible only for a Saudi or a resident with a Saudi mother (${input.beneficiaryNationality}${saudi ? " — Saudi, eligible" : mother ? " — Saudi mother, eligible" : " — not eligible"}).`,
    };
  }
  if (input.isNonSaudiVendor) {
    return {
      value: false,
      rule: "B",
      reason: "Rule B — Vendor is marked non-Saudi; general spend is not QPE eligible.",
    };
  }
  const nat = input.vendorNationality?.trim() ?? "";
  if (nat !== "" && !isSaudiNationality(nat)) {
    return {
      value: false,
      rule: "B",
      reason: `Rule B — Vendor nationality ${nat}: not a KSA vendor, not eligible.`,
    };
  }
  if (!input.vendorCrNo || input.vendorCrNo.trim() === "") {
    return {
      value: false,
      rule: "B",
      needsReview: true,
      reason:
        "Rule B — Needs review: the vendor has no commercial registration (CR) on file, so it is not eligible until the CR is confirmed.",
    };
  }
  return {
    value: true,
    rule: "B",
    reason: "Rule B — KSA vendor with a commercial registration on file: eligible.",
  };
}

export function computeAutoQfe(input: Parameters<typeof explainAutoQfe>[0]): boolean {
  return explainAutoQfe(input).value;
}

/** Human label for the "QPE Rule Applied" column in exports/filters. */
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
