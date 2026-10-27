import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
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
import {
  useGlAccounts,
  GL_CATEGORIES,
  type GlAccount,
  type GlAccountType,
} from "@/lib/gl-accounts";

type Props = {
  value: string | null;
  onChange: (id: string | null) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Account types offered. Default: expense accounts only (cost documents). */
  accountTypes?: GlAccountType[];
};

/**
 * Searchable combobox for the GL accounts catalog. Mirrors the UI of
 * BudgetCodeSelector so invoice/PO/petty-cash forms share one selection UX.
 */
export function GlAccountSelector({
  value,
  onChange,
  allowEmpty = true,
  emptyLabel = "— None —",
  placeholder = "Search GL code or name…",
  disabled = false,
  className,
  accountTypes = ["expense"],
}: Props) {
  const [open, setOpen] = useState(false);
  const { rows, loading } = useGlAccounts();

  const typesKey = accountTypes.join(",");
  const active = useMemo(
    () => rows.filter((r) => r.isActive && accountTypes.includes(r.accountType)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, typesKey],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, GlAccount[]>();
    for (const g of active) {
      const arr = map.get(g.category) ?? [];
      arr.push(g);
      map.set(g.category, arr);
    }
    return GL_CATEGORIES.map((c) => ({
      key: c.key,
      label: c.label,
      items: (map.get(c.key) ?? []).sort((a, b) => a.code.localeCompare(b.code)),
    })).filter((g) => g.items.length > 0);
  }, [active]);

  const selected = useMemo(() => rows.find((r) => r.id === value) ?? null, [rows, value]);
  const buttonLabel = selected ? `${selected.code} · ${selected.name}` : emptyLabel;

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60",
              !value && "text-muted-foreground",
            )}
          >
            <span className="truncate text-start">{buttonLabel}</span>
            <ChevronsUpDown className="ms-2 h-4 w-4 flex-shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0"
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
                placeholder={placeholder}
                className="h-10 border-0 bg-transparent p-0 focus:ring-0"
              />
            </div>
            <CommandList className="max-h-[320px]">
              <CommandEmpty>
                {loading ? "Loading GL accounts…" : "No matching account."}
              </CommandEmpty>

              {allowEmpty && (
                <CommandGroup heading="—">
                  <CommandItem
                    value="__none__"
                    onSelect={() => {
                      onChange(null);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("me-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                    {emptyLabel}
                  </CommandItem>
                </CommandGroup>
              )}

              {grouped.map((group) => (
                <CommandGroup key={group.key} heading={group.label}>
                  {group.items.map((g) => (
                    <CommandItem
                      key={g.id}
                      value={`${g.code} ${g.name} ${g.description ?? ""}`}
                      onSelect={() => {
                        onChange(g.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn("me-2 h-4 w-4", value === g.id ? "opacity-100" : "opacity-0")}
                      />
                      <span className="font-mono text-xs tabular-nums text-muted-foreground me-2 w-16">
                        {g.code}
                      </span>
                      <span className="truncate">{g.name || "—"}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
