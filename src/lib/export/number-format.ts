// Number formatting for exported files (G04 / X17): thousands separators,
// fixed decimals, a plain minus sign for negatives, Latin digits always.

/** Round half away from zero to `decimals` places (avoids 0.1 + 0.2 noise). */
export function roundTo(value: number, decimals = 2): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** decimals;
  const r = Math.round((Math.abs(n) + Number.EPSILON) * f) / f;
  return n < 0 ? -r : r;
}

/** "5,084,801.48" / "-1,750.00" — the text form used in PDFs and CSVs. */
export function formatExportNumber(value: number, decimals = 2): string {
  const n = roundTo(value, decimals);
  const text = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return n < 0 && text !== (0).toFixed(decimals) ? `-${text}` : text;
}

/** Excel number format for money: grouping, 2 decimals, minus sign for negatives. */
export const EXCEL_MONEY_FORMAT = "#,##0.00;-#,##0.00";
export const EXCEL_INTEGER_FORMAT = "#,##0";
export const EXCEL_PERCENT_FORMAT = '0.00"%"';
