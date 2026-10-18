import * as React from "react";
import { cn } from "@/lib/utils";
import { dmyToIso, isoToDMY, maskDMY } from "@/lib/date-format";

export interface DateInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> {
  /** ISO `YYYY-MM-DD` value stored in app state. */
  value: string;
  /** Called with a valid ISO `YYYY-MM-DD` string or "" while typing. */
  onChange: (iso: string) => void;
}

/**
 * Strict DD/MM/YYYY input.
 *
 * - Storage: parent keeps ISO `YYYY-MM-DD` in state (unchanged).
 * - Display / edit: shown as `DD/MM/YYYY` with a hard digit-only mask.
 * - Invalid partial typing never reaches parent state (onChange fires "").
 */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, className, placeholder = "DD/MM/YYYY", ...rest }, ref) => {
    const [text, setText] = React.useState<string>(() => isoToDMY(value));

    // Sync when parent value changes and the user isn't mid-edit on the same date.
    React.useEffect(() => {
      const iso = dmyToIso(text);
      if (iso !== value) setText(isoToDMY(value));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const masked = maskDMY(e.target.value);
      setText(masked);
      const iso = dmyToIso(masked);
      // Only propagate a valid full date or a cleared field to parent state.
      if (iso) onChange(iso);
      else if (masked === "") onChange("");
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      // On blur, clear any partial / invalid input so state stays clean.
      if (text && !dmyToIso(text)) {
        setText(isoToDMY(value));
      }
      rest.onBlur?.(e);
    };

    return (
      <input
        {...rest}
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        maxLength={10}
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        className={cn(className)}
      />
    );
  },
);
DateInput.displayName = "DateInput";
