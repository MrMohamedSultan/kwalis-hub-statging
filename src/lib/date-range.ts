export type DateRange = { from?: string; to?: string };

export type PresetKey = "all" | "mtd" | "last30" | "qtd" | "ytd" | "custom";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "mtd", label: "Month to date" },
  { key: "last30", label: "Last 30 days" },
  { key: "qtd", label: "Quarter to date" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function presetRange(key: PresetKey): DateRange {
  const now = new Date();
  if (key === "all") return {};
  if (key === "mtd")
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  if (key === "last30") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return { from: iso(d), to: iso(now) };
  }
  if (key === "qtd") {
    const q = Math.floor(now.getMonth() / 3) * 3;
    return { from: iso(new Date(now.getFullYear(), q, 1)), to: iso(now) };
  }
  if (key === "ytd") return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
  return {};
}

/** Inclusive on both ends. Missing dates fail the filter unless the range is empty. */
export function inRange(date: string | null | undefined, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  if (!date) return false;
  const d = date.slice(0, 10);
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

export function labelFor(range: DateRange): string {
  if (!range.from && !range.to) return "All time";
  return `${range.from ?? "…"} → ${range.to ?? "…"}`;
}
