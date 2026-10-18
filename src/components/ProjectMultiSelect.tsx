// ============================================================
// Searchable multi-select project picker.
//
// Shows the chosen projects as removable chips, filters the option
// list as you type, and surfaces a validation error when nothing is
// selected. Used by the create-user form so a new account can be
// bound to several projects in one pass.
// ============================================================
import { useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";

export type PickerProject = { id: string; name: string; code?: string | null };

export function ProjectMultiSelect({
  projects,
  value,
  onChange,
  disabled = false,
  invalid = false,
  emptyHint,
}: {
  projects: PickerProject[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  invalid?: boolean;
  emptyHint?: string;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.code ?? "").toLowerCase().includes(q),
    );
  }, [projects, query]);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div
      className={`rounded-lg border bg-surface ${invalid ? "border-destructive/60" : "border-border"} ${
        disabled ? "opacity-50 pointer-events-none" : ""
      }`}
    >
      {/* Chips + search */}
      <div
        className="flex flex-wrap items-center gap-1.5 p-2 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((id) => {
          const p = byId.get(id);
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand ring-1 ring-brand/30"
            >
              {p?.code ? <span className="opacity-70">{p.code}</span> : null}
              <span className="max-w-[10rem] truncate">{p?.name ?? id}</span>
              <button
                type="button"
                aria-label={`Remove ${p?.name ?? "project"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(id);
                }}
                className="rounded-full hover:bg-brand/25"
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}
        <span className="inline-flex flex-1 min-w-[8rem] items-center gap-1.5">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={value.length ? "Add another project…" : "Search projects…"}
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </span>
      </div>

      {/* Options */}
      <div className="max-h-40 overflow-y-auto border-t border-border p-1">
        {projects.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
            {emptyHint ?? "No projects available."}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
            No project matches “{query}”.
          </div>
        ) : (
          <div className="grid gap-0.5 sm:grid-cols-2">
            {filtered.map((p) => {
              const selected = value.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition ${
                    selected ? "bg-brand/10 text-foreground" : "hover:bg-muted"
                  }`}
                >
                  <span
                    className={`inline-flex size-3.5 items-center justify-center rounded border ${
                      selected ? "border-brand bg-brand text-brand-foreground" : "border-border"
                    }`}
                  >
                    {selected && <Check className="size-2.5" />}
                  </span>
                  {p.code ? (
                    <span className="rounded bg-surface-2 px-1 text-[10px] font-semibold">
                      {p.code}
                    </span>
                  ) : null}
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
