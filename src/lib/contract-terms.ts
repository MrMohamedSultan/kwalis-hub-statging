// =====================================================================
// Crew & Cast contract terms — pure helpers (no React, no Supabase).
//
//   · currency → project base currency conversion (budget commitment)
//   · withholding tax: inclusive (deduct) / exclusive (gross-up)
//   · package contracts: calendar days and the implied daily rate
//   · tax residency suggestion, ID / IBAN / SWIFT validation
//   · fixed crew position list
//
// Every figure that leaves these helpers is rounded to the cent.
// =====================================================================

export const round2 = (v: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const scaled = n * 100;
  return Math.round(scaled + (scaled >= 0 ? 1e-8 : -1e-8)) / 100;
};

// ---------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------

/** Platform convention: every stored figure is in the project base currency. */
export const DEFAULT_BASE_CURRENCY = "SAR";

/** Currencies a contract can be priced in (rates below are known for them). */
export const CONTRACT_CURRENCIES = ["SAR", "USD", "AED"] as const;

/** AED is pegged to the USD. */
const AED_PER_USD = 3.6725;

/**
 * Units of `ccy` per 1 USD. `sarPerUsd` is the project FX rate
 * (projects.fx_rate, e.g. 3.75). Returns null for a currency with no
 * configured rate — callers must refuse to convert rather than guess.
 */
export function unitsPerUsd(ccy: string | null | undefined, sarPerUsd: number): number | null {
  switch ((ccy ?? "").trim().toUpperCase()) {
    case "USD":
      return 1;
    case "SAR":
      return Number.isFinite(sarPerUsd) && sarPerUsd > 0 ? sarPerUsd : null;
    case "AED":
      return AED_PER_USD;
    default:
      return null;
  }
}

/**
 * Multiplier that turns an amount in `ccy` into the project base currency.
 * USD → SAR at 3.75 gives 3.75; SAR → SAR gives exactly 1 (never divided).
 */
export function rateToBase(
  ccy: string | null | undefined,
  base: string | null | undefined,
  sarPerUsd: number,
): number | null {
  const from = (ccy ?? "").trim().toUpperCase() || DEFAULT_BASE_CURRENCY;
  const to = (base ?? "").trim().toUpperCase() || DEFAULT_BASE_CURRENCY;
  if (from === to) return 1;
  const f = unitsPerUsd(from, sarPerUsd);
  const t = unitsPerUsd(to, sarPerUsd);
  if (f == null || t == null) return null;
  return t / f;
}

/** Amount in the base currency, rounded to the cent; null when unconvertible. */
export function toBase(
  amount: number,
  ccy: string | null | undefined,
  base: string | null | undefined,
  sarPerUsd: number,
): number | null {
  const r = rateToBase(ccy, base, sarPerUsd);
  if (r == null) return null;
  return round2((Number(amount) || 0) * r);
}

// ---------------------------------------------------------------------
// Withholding tax
// ---------------------------------------------------------------------

export type WhtTreatment = "inclusive" | "exclusive";
export const DEFAULT_WHT_RATE = 5;

export interface WhtBreakdown {
  /** Contract value — what the budget carries. */
  gross: number;
  /** Withholding tax remitted to ZATCA. */
  wht: number;
  /** What the payee receives; instalments are built on this. */
  net: number;
}

/**
 * `amount` is the agreed figure typed on the contract.
 *  · inclusive: the agreed figure is the gross; WHT is deducted from it.
 *      2,000 @5% → gross 2,000 · WHT 100 · net 1,900
 *  · exclusive (gross-up): the agreed figure is the net; gross = net / (1 − rate).
 *      2,000 @5% → gross 2,105.26 · WHT 105.26 · net 2,000
 * Net = Gross − WHT always holds to the cent.
 */
export function computeWht(amount: number, ratePct: number, treatment: WhtTreatment): WhtBreakdown {
  const a = round2(Math.max(0, Number(amount) || 0));
  const r = Math.min(Math.max(Number(ratePct) || 0, 0), 99.99) / 100;
  if (r === 0) return { gross: a, wht: 0, net: a };
  if (treatment === "exclusive") {
    const gross = round2(a / (1 - r));
    return { gross, wht: round2(gross - a), net: a };
  }
  const wht = round2(a * r);
  return { gross: a, wht, net: round2(a - wht) };
}

/** The same breakdown expressed in the base currency (cent-exact, Net = Gross − WHT). */
export function whtInBase(b: WhtBreakdown, rate: number): WhtBreakdown {
  const gross = round2(b.gross * rate);
  const net = round2(b.net * rate);
  return { gross, net, wht: round2(gross - net) };
}

export type WhtRateRule = { serviceType: string; ratePct: number; orgSpecific?: boolean };

/** Rate for a service type: an exact rule (organization first), else "default", else 5%. */
export function resolveWhtRate(
  rules: WhtRateRule[],
  serviceType: string | null | undefined,
): number {
  const st = (serviceType ?? "").trim().toLowerCase() || "default";
  const pick = (type: string) =>
    rules
      .filter((r) => r.serviceType === type)
      .sort((a, b) => Number(!!b.orgSpecific) - Number(!!a.orgSpecific))[0];
  const hit = pick(st) ?? pick("default");
  return hit && Number.isFinite(hit.ratePct) ? hit.ratePct : DEFAULT_WHT_RATE;
}

// ---------------------------------------------------------------------
// Tax residency
// ---------------------------------------------------------------------

export type TaxResidency = "resident" | "non_resident";
export const SAUDI_ARABIA = "Saudi Arabia";

const isSaudi = (country: string | null | undefined) =>
  (country ?? "").trim().toLowerCase() === SAUDI_ARABIA.toLowerCase();

/**
 * Suggestion only (client decision 13): non-Saudi nationality AND a bank
 * outside KSA → non-resident; anything else → resident. The user confirms it.
 */
export function suggestTaxResidency(input: {
  nationality?: string | null;
  bankCountry?: string | null;
}): TaxResidency {
  const nat = (input.nationality ?? "").trim();
  const bank = (input.bankCountry ?? "").trim();
  return nat && !isSaudi(nat) && bank && !isSaudi(bank) ? "non_resident" : "resident";
}

// ---------------------------------------------------------------------
// Package contracts
// ---------------------------------------------------------------------

/** Calendar days from start to end, both included (01/10 → 30/10 = 30). 0 when unusable. */
export function inclusiveDays(
  start: string | null | undefined,
  end: string | null | undefined,
): number {
  const re = /^(\d{4})-(\d{2})-(\d{2})/;
  const a = re.exec(start ?? "");
  const b = re.exec(end ?? "");
  if (!a || !b) return 0;
  const s = Date.UTC(+a[1], +a[2] - 1, +a[3]);
  const e = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  if (e < s) return 0;
  return Math.round((e - s) / 86_400_000) + 1;
}

/**
 * Days and daily rate shown for a contract. A package is stored as one unit
 * of its full amount (so every total stays exact); its days come from the
 * contract dates and its daily rate is total ÷ days.
 */
export function displayDaysAndRate(p: {
  dealType?: string | null;
  shootingDays: number;
  dailyRate: number;
  startDate?: string | null;
  endDate?: string | null;
}): { days: number; daily: number; total: number } {
  const total = round2((Number(p.shootingDays) || 0) * (Number(p.dailyRate) || 0));
  if (p.dealType === "package") {
    const days = inclusiveDays(p.startDate, p.endDate);
    if (days > 0) return { days, daily: round2(total / days), total };
  }
  return { days: Number(p.shootingDays) || 0, daily: Number(p.dailyRate) || 0, total };
}

// ---------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------

export type IdType = "national_id" | "iqama" | "passport";
export const ID_TYPES: IdType[] = ["national_id", "iqama", "passport"];

/** Error key (contracts.errors.*) or null when valid. */
export function validateIdNumber(
  type: IdType | null | undefined,
  raw: string | null | undefined,
): string | null {
  const v = (raw ?? "").trim();
  if (!v || /^0+$/.test(v)) return "id_required";
  if (!type) return "id_type_required";
  if (type === "national_id") return /^1\d{9}$/.test(v) ? null : "id_national_format";
  if (type === "iqama") return /^2\d{9}$/.test(v) ? null : "id_iqama_format";
  return /^[A-Za-z0-9][A-Za-z0-9 -]{2,29}$/.test(v) ? null : "id_passport_format";
}

/** Best guess for legacy rows / a fresh form. */
export function guessIdType(
  idNumber: string | null | undefined,
  nationality?: string | null,
): IdType | null {
  const v = (idNumber ?? "").trim();
  if (/^1\d{9}$/.test(v)) return "national_id";
  if (/^2\d{9}$/.test(v)) return "iqama";
  if (!v) return isSaudi(nationality) ? "national_id" : null;
  return null;
}

// ---------------------------------------------------------------------
// Bank: IBAN / SWIFT
// ---------------------------------------------------------------------

/** Countries that use IBAN, by the names in src/lib/countries.ts → [ISO code, length]. */
const IBAN_COUNTRIES: Record<string, [string, number]> = {
  "saudi arabia": ["SA", 24],
  "united arab emirates": ["AE", 23],
  bahrain: ["BH", 22],
  kuwait: ["KW", 30],
  qatar: ["QA", 29],
  jordan: ["JO", 30],
  lebanon: ["LB", 28],
  egypt: ["EG", 29],
  iraq: ["IQ", 23],
  palestine: ["PS", 29],
  tunisia: ["TN", 24],
  turkey: ["TR", 26],
  pakistan: ["PK", 24],
  "united kingdom": ["GB", 22],
  ireland: ["IE", 22],
  france: ["FR", 27],
  germany: ["DE", 22],
  italy: ["IT", 27],
  spain: ["ES", 24],
  portugal: ["PT", 25],
  netherlands: ["NL", 18],
  belgium: ["BE", 16],
  luxembourg: ["LU", 20],
  switzerland: ["CH", 21],
  austria: ["AT", 20],
  denmark: ["DK", 18],
  sweden: ["SE", 24],
  norway: ["NO", 15],
  finland: ["FI", 18],
  poland: ["PL", 28],
  greece: ["GR", 27],
  cyprus: ["CY", 28],
  malta: ["MT", 31],
};

export const normalizeIban = (raw: string | null | undefined) =>
  (raw ?? "").replace(/[\s-]/g, "").toUpperCase();

/** ISO 13616 mod-97 check (true when the remainder is 1). */
export function ibanChecksumOk(iban: string): boolean {
  const v = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(v)) return false;
  const moved = v.slice(4) + v.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/**
 * Error key (contracts.errors.*) or null. IBAN countries need a full IBAN
 * with that country's prefix, length and checksum (SA: 24 chars, mod-97).
 * Elsewhere a local account number (4–34 letters/digits) is accepted, and an
 * IBAN-looking value must still pass its checksum.
 */
export function validateIban(
  bankCountry: string | null | undefined,
  raw: string | null | undefined,
): string | null {
  const v = normalizeIban(raw);
  if (!v) return "iban_required";
  const spec = IBAN_COUNTRIES[(bankCountry ?? "").trim().toLowerCase()];
  if (spec) {
    const [code, len] = spec;
    if (!v.startsWith(code)) return "iban_prefix";
    if (v.length !== len) return "iban_length";
    return ibanChecksumOk(v) ? null : "iban_checksum";
  }
  if (!/^[A-Z0-9]{4,34}$/.test(v)) return "account_format";
  if (/^[A-Z]{2}\d{2}/.test(v) && v.length >= 15 && !ibanChecksumOk(v)) return "iban_checksum";
  return null;
}

export const ibanCountryCode = (bankCountry: string | null | undefined): string | null =>
  IBAN_COUNTRIES[(bankCountry ?? "").trim().toLowerCase()]?.[0] ?? null;

export const ibanLength = (bankCountry: string | null | undefined): number | null =>
  IBAN_COUNTRIES[(bankCountry ?? "").trim().toLowerCase()]?.[1] ?? null;

/** SWIFT/BIC is mandatory for a bank outside Saudi Arabia. Error key or null. */
export function validateSwift(
  bankCountry: string | null | undefined,
  raw: string | null | undefined,
): string | null {
  const v = (raw ?? "").replace(/\s/g, "").toUpperCase();
  const country = (bankCountry ?? "").trim();
  if (!v) return country && !isSaudi(country) ? "swift_required" : null;
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v) ? null : "swift_format";
}

// ---------------------------------------------------------------------
// Crew positions
// ---------------------------------------------------------------------

/** Stored in people.position as the English label; "other" keeps free text. */
export const CREW_POSITIONS = [
  "Director",
  "1st Assistant Director",
  "2nd Assistant Director",
  "Producer",
  "Executive Producer",
  "Line Producer",
  "Production Manager",
  "Production Coordinator",
  "Production Assistant",
  "Production Accountant",
  "Director of Photography",
  "Camera Operator",
  "1st Assistant Camera",
  "2nd Assistant Camera",
  "DIT",
  "Gaffer",
  "Electrician",
  "Key Grip",
  "Grip",
  "Production Designer",
  "Art Director",
  "Set Decorator",
  "Props Master",
  "Costume Designer",
  "Wardrobe Assistant",
  "Makeup Artist",
  "Hair Stylist",
  "Sound Mixer",
  "Boom Operator",
  "Script Supervisor",
  "Location Manager",
  "Casting Director",
  "Editor",
  "Colorist",
  "VFX Supervisor",
  "Stunt Coordinator",
  "Driver",
  "Writer",
] as const;

export const POSITION_OTHER = "__other__";

/** Which select value an existing free-text position maps to. */
export function positionSelectValue(position: string | null | undefined): string {
  const p = (position ?? "").trim();
  if (!p) return "";
  const hit = CREW_POSITIONS.find((x) => x.toLowerCase() === p.toLowerCase());
  return hit ?? POSITION_OTHER;
}
