import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDisplayCurrency } from "@/lib/display-currency";

/**
 * Lightweight project-level currency selector.
 *
 * Sits next to the project name in report headers. Changing it only changes
 * how figures are *presented* — stored amounts always stay in the project
 * base currency. Options come from the project/organization FX matrix.
 */
export function CurrencySelector({
  projectId,
  className = "",
}: {
  projectId?: string | null;
  className?: string;
}) {
  const fx = useDisplayCurrency(projectId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={
          fx.isBase
            ? `Figures shown in the project base currency (${fx.base})`
            : `Converted from ${fx.base} using the project FX rates`
        }
        className={`inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs font-semibold tabular-nums hover:bg-muted ${className}`}
      >
        {fx.code}
        {!fx.isBase && <span className="text-muted-foreground font-normal">≈</span>}
        <ChevronDown className="size-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        {fx.options.map((c) => (
          <DropdownMenuItem
            key={c}
            onSelect={() => fx.setCode(c)}
            className="flex items-center justify-between gap-4 text-xs"
          >
            <span className="font-semibold">{c}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {c === fx.base ? "base" : null}
              {c === fx.code ? <Check className="size-3.5 text-brand" /> : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
