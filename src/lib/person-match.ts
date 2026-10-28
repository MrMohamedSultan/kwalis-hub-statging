// ═══════════════════════════════════════════════════════════════════
// Person look-alikes (E01). Pure functions — used by the contract form
// (warning while typing a name / ID number) and by the People profiles
// panel ("Possible duplicates" for the owner to merge).
//
// The database links contracts to a profile by EXACT ID number only; a
// similar name is never merged automatically, only shown.
// ═══════════════════════════════════════════════════════════════════

export type PersonLike = {
  id: string;
  fullName: string;
  idNumber?: string | null;
};

/** ID number as the database compares it: letters and digits, upper case. */
export function idNumberKey(raw: string | null | undefined): string | null {
  const k = String(raw ?? "")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase();
  return k || null;
}

const ARABIC_DIACRITICS = /[ً-ٰٟـ]/g;

/** Lower case, Arabic letter variants folded, punctuation dropped, spaces collapsed. */
export function normalizeName(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Consonant skeleton: vowels removed, repeated letters collapsed ("mohammed" → "mhmd"). */
function skeleton(name: string): string {
  return name
    .split(" ")
    .map((t) =>
      t
        .replace(/^(al|el)(?=\w{3,})/, "")
        .replace(/(?<=[aeiou])h$/, "")
        .replace(/[aeiouyw]/g, "")
        .replace(/(.)\1+/g, "$1"),
    )
    .filter(Boolean)
    .join(" ");
}

/** Optimal-string-alignment distance (Levenshtein + adjacent transposition). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array<number>(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** 0..1 — 1 = same name after normalization. Word order does not matter. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const sorted = (s: string) => s.split(" ").sort().join(" ");
  const direct = 1 - editDistance(na, nb) / Math.max(na.length, nb.length);
  const sa = sorted(na);
  const sb = sorted(nb);
  const reordered = 1 - editDistance(sa, sb) / Math.max(sa.length, sb.length);
  let score = Math.max(direct, reordered);
  const ka = skeleton(na);
  const kb = skeleton(nb);
  if (ka.replace(/ /g, "").length >= 4 && ka === kb) score = Math.max(score, 0.9);
  return score;
}

export const SIMILAR_NAME_THRESHOLD = 0.85;

export type PersonMatch<T extends PersonLike> = {
  person: T;
  reason: "same_id" | "similar_name";
  score: number;
};

/**
 * Profiles that look like the person being typed: the same ID number first,
 * then names at or above the similarity threshold. `excludeId` is the profile
 * already chosen (it is not its own duplicate).
 */
export function findSimilarPersons<T extends PersonLike>(
  input: { fullName?: string | null; idNumber?: string | null },
  persons: T[],
  excludeId?: string | null,
  limit = 5,
): PersonMatch<T>[] {
  const key = idNumberKey(input.idNumber);
  const name = input.fullName ?? "";
  const out: PersonMatch<T>[] = [];
  for (const p of persons) {
    if (excludeId && p.id === excludeId) continue;
    if (key && idNumberKey(p.idNumber) === key) {
      out.push({ person: p, reason: "same_id", score: 1 });
      continue;
    }
    if (normalizeName(name).length < 3) continue;
    const s = nameSimilarity(name, p.fullName);
    if (s >= SIMILAR_NAME_THRESHOLD) out.push({ person: p, reason: "similar_name", score: s });
  }
  return out
    .sort((a, b) => (a.reason !== b.reason ? (a.reason === "same_id" ? -1 : 1) : b.score - a.score))
    .slice(0, limit);
}

/**
 * Pairs of profiles that are probably the same person (for the owner to
 * review and merge). Pairs with two DIFFERENT ID numbers are left out —
 * they are two people even when the names are alike.
 */
export function findDuplicatePairs<T extends PersonLike>(
  persons: T[],
): { a: T; b: T; score: number }[] {
  const pairs: { a: T; b: T; score: number }[] = [];
  for (let i = 0; i < persons.length; i++) {
    for (let j = i + 1; j < persons.length; j++) {
      const a = persons[i];
      const b = persons[j];
      const ka = idNumberKey(a.idNumber);
      const kb = idNumberKey(b.idNumber);
      if (ka && kb && ka !== kb) continue;
      const s = nameSimilarity(a.fullName, b.fullName);
      if (s >= SIMILAR_NAME_THRESHOLD) pairs.push({ a, b, score: s });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}
