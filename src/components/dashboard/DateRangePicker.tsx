// =====================================================================
// DateRangePicker — shadcn Popover + Calendar (range mode) used by the
// dashboard header to filter the dataset by date. Value is stored as
// ISO "yyyy-MM-dd" strings so it survives persistence.
// =====================================================================
import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { useI18n } from "@/lib/i18n/useI18n";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateRangePickerProps {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
}

const toDate = (iso: string | null): Date | undefined =>
  iso ? new Date(`${iso}T00:00:00`) : undefined;

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const selected: DateRange | undefined =
    from || to ? { from: toDate(from), to: toDate(to) } : undefined;

  const fromDate = toDate(from);
  const toDateValue = toDate(to);
  const label = fromDate
    ? toDateValue
      ? `${format(fromDate, "LLL dd, y")} – ${format(toDateValue, "LLL dd, y")}`
      : format(fromDate, "LLL dd, y")
    : t("dash.pickDateRange");

  return (
    <div className="inline-flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("dash.dateRange")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-secondary outline-none transition-colors duration-150 hover:bg-surface-2 hover:text-ink-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CalendarIcon className="size-3.5" aria-hidden="true" />
            {label}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            selected={selected}
            onSelect={(r) =>
              onChange(
                r?.from ? format(r.from, "yyyy-MM-dd") : null,
                r?.to ? format(r.to, "yyyy-MM-dd") : null,
              )
            }
            numberOfMonths={2}
            initialFocus
            className="p-3 pointer-events-auto"
          />
          <div className="flex justify-end border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => {
                onChange(null, null);
                setOpen(false);
              }}
              className="text-xs font-medium text-ink-muted transition-colors duration-150 hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("dash.clearRange")}
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {from && (
        <button
          type="button"
          onClick={() => onChange(null, null)}
          aria-label={t("dash.clearRange")}
          className="inline-flex items-center rounded-lg border border-border bg-surface p-1.5 text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
