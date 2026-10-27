// ═══════════════════════════════════════════════════════════════════
// Platform date formatting — ONE format for every screen, input, filter
// and export (G05 / B28 / B29).
//
// - The format is a company setting (organizations.date_format), default
//   dd/MM/yyyy. The year is always shown.
// - Storage/state stays ISO `YYYY-MM-DD`. A date-only value is a calendar
//   day: it is formatted from its digits and is NEVER pushed through the
//   browser's timezone, so 2026-10-27 can never become 26/10/2026.
// - Timestamps (created_at, payment times…) are converted to Saudi time
//   (Asia/Riyadh) before the calendar day is taken — on screen and in exports.
// ═══════════════════════════════════════════════════════════════════
import { create } from "zustand";

export const PLATFORM_TIME_ZONE = "Asia/Riyadh";

export const DATE_FORMATS = [
  "dd/MM/yyyy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
  "dd-MM-yyyy",
  "dd.MM.yyyy",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const DEFAULT_DATE_FORMAT: DateFormat = "dd/MM/yyyy";

export function isDateFormat(v: unknown): v is DateFormat {
  return typeof v === "string" && (DATE_FORMATS as readonly string[]).includes(v);
}

const STORAGE_KEY = "kwalis.dateFormat";

function readCachedFormat(): DateFormat {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_DATE_FORMAT;
    const v = localStorage.getItem(STORAGE_KEY);
    return isDateFormat(v) ? v : DEFAULT_DATE_FORMAT;
  } catch {
    return DEFAULT_DATE_FORMAT;
  }
}

type DateFormatState = { format: DateFormat; setFormat: (f: DateFormat) => void };

/** Reactive store — components that call {@link useDateFormat} re-render on change. */
export const useDateFormatStore = create<DateFormatState>((set) => ({
  format: readCachedFormat(),
  setFormat: (format) => {
    try {
      localStorage.setItem(STORAGE_KEY, format);
    } catch {
      /* private mode — the org setting is still the source of truth */
    }
    set({ format });
  },
}));

export function getDateFormat(): DateFormat {
  return useDateFormatStore.getState().format;
}

export function setDateFormat(f: string | null | undefined): void {
  const next = isDateFormat(f) ? f : DEFAULT_DATE_FORMAT;
  if (next !== getDateFormat()) useDateFormatStore.getState().setFormat(next);
}

/** Hook: the active platform format (re-renders on change). */
export function useDateFormat(): DateFormat {
  return useDateFormatStore((s) => s.format);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export type CalendarDay = { y: number; m: number; d: number };

const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function riyadhParts(d: Date): CalendarDay & { hh: number; mi: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: PLATFORM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    hh: get("hour") % 24,
    mi: get("minute"),
  };
}

/**
 * Resolve any date-ish input to a calendar day.
 * - `YYYY-MM-DD` (a stored `date`) → taken literally, no timezone maths.
 * - Timestamps / Date objects → the day in Saudi time (Asia/Riyadh).
 */
export function toCalendarDay(input: Date | string | null | undefined): CalendarDay | null {
  if (input == null || input === "") return null;
  if (typeof input === "string") {
    const s = input.trim();
    const m = ISO_DATE_ONLY.exec(s);
    if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    // `YYYY-MM-DDT00:00:00` without an offset is also a plain calendar day.
    const local = /^(\d{4})-(\d{2})-(\d{2})[T ]00:00(:00(\.0+)?)?$/.exec(s);
    if (local) return { y: Number(local[1]), m: Number(local[2]), d: Number(local[3]) };
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return null;
    return riyadhParts(dt);
  }
  if (isNaN(input.getTime())) return null;
  return riyadhParts(input);
}

function renderDay(day: CalendarDay, fmt: DateFormat): string {
  const dd = pad2(day.d);
  const mm = pad2(day.m);
  const yyyy = String(day.y).padStart(4, "0");
  switch (fmt) {
    case "MM/dd/yyyy":
      return `${mm}/${dd}/${yyyy}`;
    case "yyyy-MM-dd":
      return `${yyyy}-${mm}-${dd}`;
    case "dd-MM-yyyy":
      return `${dd}-${mm}-${yyyy}`;
    case "dd.MM.yyyy":
      return `${dd}.${mm}.${yyyy}`;
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/** Format a date in the platform format ("" for empty / invalid input). */
export function formatDate(
  input: Date | string | null | undefined,
  fmt: DateFormat = getDateFormat(),
): string {
  const day = toCalendarDay(input);
  return day ? renderDay(day, fmt) : "";
}

/** Date + time (24h) in Saudi time, e.g. "27/10/2026 14:05". */
export function formatDateTime(
  input: Date | string | null | undefined,
  fmt: DateFormat = getDateFormat(),
): string {
  if (input == null || input === "") return "";
  const dt = input instanceof Date ? input : new Date(input);
  if (isNaN(dt.getTime())) return "";
  const p = riyadhParts(dt);
  return `${renderDay(p, fmt)} ${pad2(p.hh)}:${pad2(p.mi)}`;
}

/** ISO `YYYY-MM-DD` for any input (timestamps resolved in Saudi time). */
export function toIsoDate(input: Date | string | null | undefined): string {
  const day = toCalendarDay(input);
  return day ? `${day.y}-${pad2(day.m)}-${pad2(day.d)}` : "";
}

/** Today's date in Saudi time as ISO `YYYY-MM-DD`. */
export function riyadhToday(now: Date = new Date()): string {
  return toIsoDate(now);
}

/**
 * Excel cell value for a date: a JS Date at UTC midnight of the calendar
 * day. ExcelJS serialises dates from UTC, so the cell shows exactly the
 * stored day (no "one day early" shift).
 */
export function toExcelDate(input: Date | string | null | undefined): Date | null {
  const day = toCalendarDay(input);
  return day ? new Date(Date.UTC(day.y, day.m - 1, day.d)) : null;
}

/** Excel number format matching the platform format. */
export function excelDateFormat(fmt: DateFormat = getDateFormat()): string {
  return fmt.replace(/MM/g, "mm");
}

/** Input placeholder for the platform format, e.g. "DD/MM/YYYY". */
export function datePlaceholder(fmt: DateFormat = getDateFormat()): string {
  return fmt.toUpperCase();
}

function separatorOf(fmt: DateFormat): string {
  return fmt.includes("/") ? "/" : fmt.includes(".") ? "." : "-";
}

/**
 * Progressive input mask for the platform format: digits only, separators
 * injected automatically, hard cap of 8 digits (the year can never exceed
 * 4 digits, even on paste).
 */
export function maskDate(raw: string, fmt: DateFormat = getDateFormat()): string {
  const digits = String(raw).replace(/\D/g, "").slice(0, 8);
  const sep = separatorOf(fmt);
  const yearFirst = fmt.startsWith("yyyy");
  const cuts = yearFirst ? [4, 6] : [2, 4];
  let out = digits.slice(0, cuts[0]);
  if (digits.length > cuts[0]) out += sep + digits.slice(cuts[0], cuts[1]);
  if (digits.length > cuts[1]) out += sep + digits.slice(cuts[1]);
  return out;
}

/** Parse text typed in the platform format back to ISO. "" when invalid. */
export function parseDate(
  text: string | null | undefined,
  fmt: DateFormat = getDateFormat(),
): string {
  if (!text) return "";
  const s = String(text).trim();
  const sep = separatorOf(fmt).replace(".", "\\.");
  const order = fmt.split(/[/.-]/); // e.g. ["dd","MM","yyyy"]
  const re = new RegExp(
    `^${order.map((p) => (p === "yyyy" ? "(\\d{4})" : "(\\d{2})")).join(sep)}$`,
  );
  const m = re.exec(s);
  if (!m) return "";
  const val = (key: string) => Number(m[order.indexOf(key) + 1]);
  const d = val("dd");
  const mo = val("MM");
  const y = val("yyyy");
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2999) return "";
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return "";
  }
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

// ── Legacy DD/MM/YYYY helpers (kept for existing callers) ─────────────

/** Convert an ISO `YYYY-MM-DD` (or full ISO datetime) to `DD/MM/YYYY`. */
export function isoToDMY(iso: string | null | undefined): string {
  return formatDate(iso, "dd/MM/yyyy");
}

/** Convert `DD/MM/YYYY` back to ISO `YYYY-MM-DD`. Returns "" when invalid. */
export function dmyToIso(dmy: string | null | undefined): string {
  return parseDate(dmy, "dd/MM/yyyy");
}

/**
 * Format any Date / ISO string for display in the PLATFORM format.
 * (Historic name — it now follows the company's date-format setting.)
 */
export function formatDateDMY(input: Date | string | null | undefined): string {
  return formatDate(input);
}

/** Progressive DD/MM/YYYY input mask (legacy — see {@link maskDate}). */
export function maskDMY(raw: string): string {
  return maskDate(raw, "dd/MM/yyyy");
}
