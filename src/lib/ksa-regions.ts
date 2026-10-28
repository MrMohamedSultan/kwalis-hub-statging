// KSA regions for the Film Commission budget by region (db/pending/201).
// Same list and aliases as public.ksa_region_list / ksa_region_normalize.

export const KSA_REGIONS = [
  "Riyadh",
  "Makkah",
  "Madinah",
  "Eastern Province",
  "Asir",
  "Tabuk",
  "Hail",
  "Northern Borders",
  "Jazan",
  "Najran",
  "Al Bahah",
  "Al Jawf",
  "Qassim",
] as const;
export type KsaRegion = (typeof KSA_REGIONS)[number];

/** i18n key suffix of a region: decisions.region.<slug>. */
export const regionSlug = (r: string) => r.toLowerCase().replace(/[^a-z]+/g, "_");

const ALIASES: Record<KsaRegion, string[]> = {
  Riyadh: [
    "riyadh",
    "ar riyadh",
    "al riyadh",
    "riyadh region",
    "الرياض",
    "منطقة الرياض",
    "diriyah",
    "الدرعية",
    "al kharj",
    "الخرج",
  ],
  Makkah: [
    "makkah",
    "mecca",
    "makkah al mukarramah",
    "makkah region",
    "مكة",
    "مكة المكرمة",
    "منطقة مكة المكرمة",
    "jeddah",
    "jiddah",
    "جدة",
    "taif",
    "al taif",
    "الطائف",
    "rabigh",
    "رابغ",
  ],
  Madinah: [
    "madinah",
    "medina",
    "al madinah",
    "madinah region",
    "المدينة",
    "المدينة المنورة",
    "منطقة المدينة المنورة",
    "alula",
    "al ula",
    "العلا",
    "yanbu",
    "ينبع",
  ],
  "Eastern Province": [
    "eastern province",
    "eastern",
    "eastern region",
    "ash sharqiyah",
    "الشرقية",
    "المنطقة الشرقية",
    "dammam",
    "الدمام",
    "khobar",
    "al khobar",
    "الخبر",
    "dhahran",
    "الظهران",
    "jubail",
    "الجبيل",
    "al ahsa",
    "al hasa",
    "hofuf",
    "الأحساء",
    "الاحساء",
    "qatif",
    "القطيف",
  ],
  Asir: [
    "asir",
    "aseer",
    "عسير",
    "منطقة عسير",
    "abha",
    "أبها",
    "ابها",
    "khamis mushait",
    "خميس مشيط",
  ],
  Tabuk: ["tabuk", "تبوك", "منطقة تبوك", "neom", "نيوم"],
  Hail: ["hail", "حائل", "منطقة حائل"],
  "Northern Borders": [
    "northern borders",
    "northern border",
    "al hudud ash shamaliyah",
    "الحدود الشمالية",
    "منطقة الحدود الشمالية",
    "arar",
    "عرعر",
  ],
  Jazan: ["jazan", "jizan", "gizan", "جازان", "جيزان", "منطقة جازان"],
  Najran: ["najran", "نجران", "منطقة نجران"],
  "Al Bahah": ["al bahah", "al baha", "bahah", "baha", "الباحة", "منطقة الباحة"],
  "Al Jawf": ["al jawf", "jawf", "al jouf", "jouf", "الجوف", "منطقة الجوف", "sakaka", "سكاكا"],
  Qassim: [
    "qassim",
    "al qassim",
    "al qasim",
    "القصيم",
    "منطقة القصيم",
    "buraydah",
    "buraidah",
    "بريدة",
    "unaizah",
    "عنيزة",
  ],
};

const LOOKUP = new Map<string, KsaRegion>();
for (const r of KSA_REGIONS) for (const a of ALIASES[r]) LOOKUP.set(a, r);

/** Region name or main city (English / Arabic) → the region; null when unknown or empty. */
export function normalizeKsaRegion(v: unknown): KsaRegion | null {
  const k = String(v ?? "")
    .replace(/[’'`]/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim()
    .toLowerCase();
  if (!k) return null;
  return LOOKUP.get(k) ?? null;
}
