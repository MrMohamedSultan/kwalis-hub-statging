import * as React from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { datePlaceholder, formatDate, maskDate, parseDate, useDateFormat } from "@/lib/date-format";

export interface DateInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "min" | "max"
> {
  /** ISO `YYYY-MM-DD` value stored in app state. */
  value: string;
  /** Called with a valid ISO `YYYY-MM-DD` string or "" while typing / when cleared. */
  onChange: (iso: string) => void;
  /** Earliest / latest allowed ISO dates (inclusive). */
  min?: string;
  max?: string;
  /** Hide the calendar button (plain masked text field). */
  noPicker?: boolean;
  /** Class for the wrapper (defaults to full width when the input is full width). */
  containerClassName?: string;
}

function isoToLocalDate(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").slice(0, 10));
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function localDateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Date field in the PLATFORM date format (G05 / B28 / B29).
 *
 * - Storage: parent keeps ISO `YYYY-MM-DD` in state (unchanged).
 * - Display / edit: the company's format (default DD/MM/YYYY) with a
 *   digit-only mask, plus a calendar picker.
 * - Invalid partial typing never reaches parent state (onChange fires "").
 */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (
    {
      value,
      onChange,
      className,
      placeholder,
      min,
      max,
      noPicker,
      containerClassName,
      disabled,
      ...rest
    },
    ref,
  ) => {
    const { t } = useTranslation();
    const fmt = useDateFormat();
    const [text, setText] = React.useState<string>(() => formatDate(value, fmt));
    const [open, setOpen] = React.useState(false);

    const inRange = React.useCallback(
      (iso: string) => (!min || iso >= min) && (!max || iso <= max),
      [min, max],
    );

    // Sync when the parent value (or the platform format) changes.
    React.useEffect(() => {
      const iso = parseDate(text, fmt);
      if (iso !== value) setText(formatDate(value, fmt));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, fmt]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const masked = maskDate(e.target.value, fmt);
      setText(masked);
      const iso = parseDate(masked, fmt);
      // Only propagate a valid full date or a cleared field to parent state.
      if (iso && inRange(iso)) onChange(iso);
      else if (masked === "") onChange("");
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      // On blur, clear any partial / invalid input so state stays clean.
      const iso = parseDate(text, fmt);
      if (text && (!iso || !inRange(iso))) setText(formatDate(value, fmt));
      rest.onBlur?.(e);
    };

    const selected = isoToLocalDate(value);
    const full = /\bw-full\b/.test(className ?? "");

    return (
      <div className={cn("relative", full ? "block w-full" : "inline-block", containerClassName)}>
        <input
          {...rest}
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          disabled={disabled}
          placeholder={placeholder ?? datePlaceholder(fmt)}
          maxLength={10}
          value={text}
          onChange={handleChange}
          onBlur={handleBlur}
          className={cn(className, !noPicker && "pe-8", "tabular-nums")}
        />
        {!noPicker && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild disabled={disabled}>
              <button
                type="button"
                tabIndex={-1}
                aria-label={t("exports.pick_date")}
                className="absolute inset-y-0 end-1.5 my-auto flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <CalendarIcon className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selected}
                defaultMonth={selected}
                disabled={(d: Date) => !inRange(localDateToIso(d))}
                onSelect={(d) => {
                  const iso = d ? localDateToIso(d) : "";
                  onChange(iso);
                  setText(formatDate(iso, fmt));
                  setOpen(false);
                }}
                autoFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
    );
  },
);
DateInput.displayName = "DateInput";
