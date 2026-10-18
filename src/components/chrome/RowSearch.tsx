import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

/**
 * DOM-based row filter. Wraps a table/list container and hides rows whose text
 * content doesn't match the query. Zero refactor to underlying tables — the
 * container just needs `[data-row]` on the elements you want to filter.
 *
 * Add `data-row` to <tr> / <div> elements you want searchable.
 * Add `data-row-empty` to a "no results" row (optional) and it'll be shown
 * automatically when everything is filtered out.
 */
export function RowSearch({
  placeholder = "Search rows…",
  scopeRef,
  chips,
  activeChip,
  onChipChange,
  className = "",
}: {
  placeholder?: string;
  scopeRef: React.RefObject<HTMLElement | null>;
  chips?: { key: string; label: string }[];
  activeChip?: string;
  onChipChange?: (key: string) => void;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const root = scopeRef.current;
      if (!root) return;
      const query = q.trim().toLowerCase();
      const chipKey = activeChip && activeChip !== "all" ? activeChip.toLowerCase() : null;
      const rows = root.querySelectorAll<HTMLElement>(
        "[data-row], tbody > tr:not([data-row-skip]):not([data-row-empty])",
      );
      let visible = 0;
      rows.forEach((r) => {
        const text = (r.textContent ?? "").toLowerCase();
        const status = (r.getAttribute("data-status") ?? "").toLowerCase();
        const matchQ = !query || text.includes(query);
        const matchChip = !chipKey || status === chipKey;
        const show = matchQ && matchChip;
        r.style.display = show ? "" : "none";
        if (show) visible++;
      });
      root.querySelectorAll<HTMLElement>("[data-row-empty]").forEach((e) => {
        e.style.display = visible === 0 && (query || chipKey) ? "" : "none";
      });
    });
  }, [q, activeChip, scopeRef]);

  return (
    <div className={`flex flex-wrap items-center gap-2 mb-3 ${className}`}>
      <div className="relative flex-1 min-w-[220px] max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-surface-2 pl-8 pr-8 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-surface"
            aria-label="Clear search"
          >
            <X className="size-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
      {chips && chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const active = (activeChip ?? "all") === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onChipChange?.(c.key)}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold border transition ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border bg-surface-2 text-muted-foreground hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
