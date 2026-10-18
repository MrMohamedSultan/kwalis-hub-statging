import * as React from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { isoToDMY } from "@/lib/date-format";

export interface DatePickerPillProps {
  /** ISO `YYYY-MM-DD` value stored in app state. */
  value: string;
  /** Called with ISO `YYYY-MM-DD` or "" when cleared. */
  onChange: (iso: string) => void;
  placeholder?: string;
  className?: string;
  align?: "start" | "center" | "end";
  disabled?: boolean;
  /** Text alignment inside the trigger. */
  textAlign?: "start" | "center" | "end";
}

/**
 * Pill-shaped date picker. Clicking anywhere on the trigger (text, icon,
 * or placeholder) opens the popover with the shadcn Calendar.
 */
export function DatePickerPill({
  value,
  onChange,
  placeholder = "DD/MM/YYYY",
  className,
  align = "end",
  disabled,
  textAlign = "end",
}: DatePickerPillProps) {
  const [open, setOpen] = React.useState(false);
  const selected = React.useMemo(() => {
    if (!value) return undefined;
    const s = String(value).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return undefined;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? undefined : d;
  }, [value]);

  const display = isoToDMY(value);

  const alignCls =
    textAlign === "center" ? "text-center" : textAlign === "start" ? "text-start" : "text-end";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "relative w-full flex items-center gap-2 rounded-full outline-none focus:ring-2 ring-brand disabled:opacity-60 disabled:cursor-not-allowed",
            className,
          )}
          aria-label={placeholder}
        >
          <span
            className={cn("flex-1 tabular-nums", alignCls, !display && "text-muted-foreground")}
          >
            {display || placeholder}
          </span>
          <CalendarIcon className="size-4 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (!d) {
              onChange("");
            } else {
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, "0");
              const day = String(d.getDate()).padStart(2, "0");
              onChange(`${y}-${m}-${day}`);
            }
            setOpen(false);
          }}
          // Focus the calendar grid on open so arrow keys move day-by-day
          // (PageUp/PageDown move by month) without reaching for the mouse.
          autoFocus
          defaultMonth={selected}
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
