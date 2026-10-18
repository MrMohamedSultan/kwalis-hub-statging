import { useEffect, useMemo, useState } from "react";
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
import { useStore } from "@/lib/store";
import {
  disambiguatedLineLabel,
  fetchProjectBudgetLines,
  headerLabelForBudgetLine,
  hierarchyLabelForBudgetLine,
  lineNameForBudgetLine,
  type ProjectBudgetLine,
} from "@/lib/project-budget-lines";

type Props = {
  value: string;
  onChange: (code: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Optional restriction to a subset of budget codes (e.g. project lines). */
  restrictToCodes?: string[];
  /** Explicit project scope. Defaults to the currently active project. */
  projectId?: string | null;
  /** Exact selected budget_lines.id, used when a project has duplicate budget codes. */
  selectedLineId?: string | null;
  /** Receives the exact project budget row selected from budget_lines. */
  onSelectLine?: (line: ProjectBudgetLine | null) => void;
  /** Optional label rendered instead of the raw code when the value matches an unknown row. */
  fallbackLabel?: (code: string) => string;
};

/**
 * Searchable combobox for the active project's uploaded budget_lines. This
 * intentionally does not read the static master catalog: every project can have
 * unique uploaded descriptions, duplicate codes, and custom hierarchy labels.
 */
export function BudgetCodeSelector({
  value,
  onChange,
  allowEmpty = true,
  emptyLabel = "— Unassigned —",
  placeholder = "Search uploaded project budget…",
  disabled = false,
  required = false,
  className,
  restrictToCodes,
  projectId,
  selectedLineId,
  onSelectLine,
  fallbackLabel,
}: Props) {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const scopedProjectId = projectId ?? activeProjectId;
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ProjectBudgetLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!scopedProjectId) {
      setLines([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchProjectBudgetLines(scopedProjectId)
      .then((rows) => {
        if (!cancelled) setLines(rows);
      })
      .catch(() => {
        if (!cancelled) setLines([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scopedProjectId]);

  const filteredLines = useMemo(() => {
    if (!restrictToCodes || restrictToCodes.length === 0) return lines;
    const allowed = new Set(restrictToCodes);
    return lines.filter((line) => allowed.has(line.mainCode));
  }, [lines, restrictToCodes]);

  /** Results grouped by budget code so duplicate codes sit side by side. */
  const byCode = useMemo(() => {
    const groups = new Map<string, ProjectBudgetLine[]>();
    for (const row of filteredLines) {
      const code = row.mainCode || "__other__";
      const existing = groups.get(code) ?? [];
      existing.push(row);
      groups.set(code, existing);
    }
    for (const items of groups.values()) {
      items.sort((a, b) => lineNameForBudgetLine(a).localeCompare(lineNameForBudgetLine(b)));
    }
    return Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [filteredLines]);

  const selected = useMemo(() => {
    if (selectedLineId) {
      const exact = lines.find((line) => line.id === selectedLineId);
      if (exact) return exact;
    }
    return lines.find((line) => line.mainCode === value) ?? null;
  }, [lines, selectedLineId, value]);

  const buttonLabel = value
    ? selected
      ? hierarchyLabelForBudgetLine(selected, lines)
      : fallbackLabel
        ? fallbackLabel(value)
        : value
    : emptyLabel;

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-required={required}
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
                {loading ? "Loading project budget…" : "No matching project budget line."}
              </CommandEmpty>

              {allowEmpty && (
                <CommandGroup heading="—">
                  <CommandItem
                    value="__unassigned__"
                    onSelect={() => {
                      onChange("");
                      onSelectLine?.(null);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn("me-2 h-4 w-4", value === "" ? "opacity-100" : "opacity-0")}
                    />
                    {emptyLabel}
                  </CommandItem>
                </CommandGroup>
              )}

              {byCode.map(([code, items]) => {
                const duplicates = items.length;
                const heading =
                  code === "__other__"
                    ? "Other"
                    : `${code} · ${headerLabelForBudgetLine(items[0].headerCode, lines)}${
                        duplicates > 1 ? ` · ${duplicates} lines` : ""
                      }`;
                return (
                  <CommandGroup key={code} heading={heading}>
                    {items.map((row) => {
                      const shortId = row.id.slice(0, 8);
                      return (
                        <CommandItem
                          key={row.id}
                          value={`${row.mainCode} ${lineNameForBudgetLine(row)} ${row.name} ${row.description} ${hierarchyLabelForBudgetLine(row, lines)} ${row.group} ${row.id}`}
                          onSelect={() => {
                            onChange(row.mainCode);
                            onSelectLine?.(row);
                            setOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "me-2 h-4 w-4 flex-shrink-0",
                              (selectedLineId ? selectedLineId === row.id : value === row.mainCode)
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          <span className="font-mono text-xs tabular-nums text-muted-foreground me-2 w-14 flex-shrink-0">
                            {row.mainCode}
                          </span>
                          <span className="truncate">
                            {duplicates > 1
                              ? disambiguatedLineLabel(row, lines).replace(`${row.mainCode} `, "")
                              : lineNameForBudgetLine(row) || "—"}
                          </span>
                          <span
                            className="ms-auto ps-2 font-mono text-[10px] uppercase text-muted-foreground/70 flex-shrink-0"
                            title={row.id}
                          >
                            {shortId}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
