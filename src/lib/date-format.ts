// Global date helpers — DD/MM/YYYY everywhere.
// Storage/state format stays ISO (YYYY-MM-DD). Display/edit is DD/MM/YYYY.

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Convert an ISO `YYYY-MM-DD` (or full ISO datetime) to `DD/MM/YYYY`. */
export function isoToDMY(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = String(iso).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Convert `DD/MM/YYYY` back to ISO `YYYY-MM-DD`. Returns "" when invalid. */
export function dmyToIso(dmy: string | null | undefined): string {
  if (!dmy) return "";
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dmy).trim());
  if (!m) return "";
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2999) return "";
  // Round-trip through Date to reject e.g. 31/02/2025.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return "";
  }
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** Format any Date / ISO string as DD/MM/YYYY for display. */
export function formatDateDMY(input: Date | string | null | undefined): string {
  if (!input) return "";
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Progressive DD/MM/YYYY input mask.
 * Accepts partial user typing (digits only) and injects the two `/` slashes
 * at positions 2 and 5. Rejects any non-digit character and caps length at 10.
 */
/**
 * Progressive DD/MM/YYYY input mask.
 * - Strips every non-digit character.
 * - Hard-caps at 8 digits total (DD + MM + YYYY): the year segment can never
 *   exceed 4 digits, even for paste / IME / drag-and-drop input.
 * - Injects `/` separators at positions 2 and 5.
 */
export function maskDMY(raw: string): string {
  const digits = String(raw).replace(/\D/g, "").slice(0, 8); // 2 + 2 + 4
  const d = digits.slice(0, 2);
  const m = digits.slice(2, 4);
  const y = digits.slice(4, 8);
  let out = d;
  if (digits.length >= 3) out += "/" + m;
  if (digits.length >= 5) out += "/" + y;
  return out;
}
