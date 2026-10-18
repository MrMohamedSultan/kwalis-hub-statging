import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type SearchableOption = {
  value: string;
  /** Short leading code / badge shown in mono font. */
  code?: string;
  /** Human label shown next to the code. */
  label: string;
  /** Extra keywords to include in search matching. */
  keywords?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  emptyValueLabel?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
  /** id applied to the combobox trigger so a <label htmlFor> points at it. */
  id?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  /** Show a spinner while the option list is still being fetched. */
  loading?: boolean;
  /** Error text shown inside the list when the fetch failed. */
  errorLabel?: string;
};

/** Wraps every occurrence of the search term in a <mark> so matches stand out. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "ig"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-brand/25 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * Generic combobox using shadcn Command + Popover primitives. Filters
 * options client-side by code, label, and optional keywords so users can
 * type a code number or name to jump to a row instead of scrolling.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "— Select —",
  searchPlaceholder = "Search…",
  emptyLabel = "No matching option.",
  emptyValueLabel = "— Unassigned —",
  allowEmpty = true,
  disabled = false,
  className,
  id,
  ariaLabel,
  ariaDescribedBy,
  loading = false,
  errorLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  const buttonLabel = value
    ? selected
      ? selected.code
        ? `${selected.code} — ${selected.label}`
        : selected.label
      : value
    : loading
      ? "Loading budget accounts…"
      : placeholder;

  return (
    <div className={cn("relative", className)}>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-busy={loading}
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            title={value ? buttonLabel : undefined}
            disabled={disabled}
            className={cn(
              "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm leading-snug text-foreground outline-none transition-colors hover:border-border focus-visible:ring-2 focus-visible:ring-brand focus:ring-2 focus:ring-brand disabled:opacity-50",
              !value && "text-muted-foreground",
            )}
          >
            <span className="truncate text-start">{buttonLabel}</span>
            {loading ? (
              <Loader2 className="ms-auto h-4 w-4 flex-shrink-0 animate-spin opacity-70" />
            ) : (
              <ChevronsUpDown className="ms-auto h-4 w-4 flex-shrink-0 opacity-60" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(42rem,calc(100vw-2rem))] min-w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
          align="start"
        >
          <Command
            filter={(itemValue, search) => {
              const s = search.trim().toLowerCase();
              if (!s) return 1;
              return itemValue.toLowerCase().includes(s) ? 1 : 0;
            }}
          >
            <div className="flex items-center border-b border-border px-3">
              <Search className="me-2 h-4 w-4 opacity-60" />
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder={searchPlaceholder}
                className="h-10 border-0 bg-transparent p-0 focus:ring-0"
              />
            </div>
            <CommandList className="max-h-[320px]">
              {errorLabel ? (
                <div role="alert" className="px-3 py-4 text-sm text-destructive">
                  {errorLabel}
                </div>
              ) : loading ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading budget accounts…
                </div>
              ) : (
                <>
                  <CommandEmpty>{emptyLabel}</CommandEmpty>
                  <CommandGroup>
                    {allowEmpty && (
                      <CommandItem
                        value="__unassigned__"
                        className="items-start gap-0 px-2 py-2 text-sm leading-snug"
                        onSelect={() => {
                          onChange("");
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "me-2 h-4 w-4 shrink-0",
                            value === "" ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="text-muted-foreground">{emptyValueLabel}</span>
                      </CommandItem>
                    )}
                    {options.map((opt) => (
                      <CommandItem
                        key={opt.value}
                        className="items-start gap-0 px-2 py-2 text-sm leading-snug data-[selected=true]:bg-surface"
                        aria-selected={value === opt.value}
                        title={opt.code ? `${opt.code} — ${opt.label}` : opt.label}
                        value={`${opt.code ?? ""} ${opt.label} ${opt.keywords ?? ""}`}
                        onSelect={() => {
                          onChange(opt.value);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "me-2 mt-0.5 h-4 w-4 shrink-0 self-start",
                            value === opt.value ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {opt.code && (
                          <span className="me-2 min-w-14 shrink-0 self-start pt-px font-mono text-xs tabular-nums text-muted-foreground">
                            <Highlight text={opt.code} query={query} />
                          </span>
                        )}
                        <span className="min-w-0 whitespace-normal break-words">
                          <Highlight text={opt.label || "—"} query={query} />
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
