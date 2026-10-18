import { useEffect, useRef, useState } from "react";
import { formatAmount } from "@/lib/format-number";

/**
 * Shared payment-schedule row inputs.
 *
 * Percent and Amount are both directly editable:
 *   percent typed  -> amount is derived (percent is authoritative)
 *   amount typed   -> the EXACT typed amount is preserved (amount is
 *                     authoritative) and the percent shown is derived for
 *                     reference only.
 *
 * The bug this guards against: rounding the reverse-calculated percent and
 * then re-deriving the amount from it destroys the user's flat input
 * (1200 -> 1199.76). When `amount` is provided (non-null) it is never
 * recomputed from the percent.
 *
 * Floating point splits (33.33 / 33.33 / 33.34) can never land exactly on 100,
 * so the total validation uses a small tolerance.
 */
export const SCHEDULE_PCT_TOLERANCE = 0.05;

export function isScheduleTotalValid(totalPct: number): boolean {
  return Math.abs((Number(totalPct) || 0) - 100) <= SCHEDULE_PCT_TOLERANCE;
}

/**
 * Strict 2-decimal (cents / halalas) rounding.
 *
 * Plain `Math.round(n * 100) / 100` mis-rounds binary-float edge cases
 * (1.005 * 100 === 100.49999999999999 → 1.00). Nudging by an epsilon in the
 * value's own magnitude keeps banking arithmetic exact for the amounts this
 * app deals with.
 */
const round2 = (n: number): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const scaled = v * 100;
  const cents = Math.round(scaled + (scaled >= 0 ? 1e-8 : -1e-8));
  return cents / 100;
};

/** True when a value already carries at most 2 decimal places. */
export function hasCentPrecision(n: number): boolean {
  const v = Number(n);
  return Number.isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
}

/** Public helper so callers can normalize money before persisting. */
export const toCents = round2;

/** Clamp a typed decimal string to at most 2 fractional digits. */
function clampDecimals(raw: string, max = 2): string {
  const dot = raw.indexOf(".");
  if (dot === -1) return raw;
  return (
    raw.slice(0, dot + 1) +
    raw
      .slice(dot + 1)
      .replace(/\./g, "")
      .slice(0, max)
  );
}

/** Effective amount for a row: explicit override wins over percent-derived. */
export function resolveSplitAmount(
  percent: number,
  total: number,
  amountOverride?: number | null,
): number {
  if (amountOverride !== null && amountOverride !== undefined && Number.isFinite(amountOverride)) {
    return round2(amountOverride);
  }
  return round2(((Number(total) || 0) * (Number(percent) || 0)) / 100);
}

function formatWithCommas(n: number): string {
  return formatAmount(n, 2);
}

/** Strip commas / spaces / currency glyphs so "1,234.56" parses cleanly. */
function parseLoose(raw: string): number {
  const cleaned = (raw ?? "").replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? round2(n) : 0;
}

type Props = {
  percent: number;
  /** Explicit flat amount typed by the user. `null` = derive from percent. */
  amount?: number | null;
  /** Base value the percentage applies to (net payable / invoice total). */
  total: number;
  onPercentChange: (percent: number) => void;
  /** Called with the exact typed amount, or `null` when percent takes over. */
  onAmountChange?: (amount: number | null) => void;
  /** Enter inside either field triggers a quick "add next row". */
  onQuickAdd?: () => void;
  percentClassName?: string;
  amountClassName?: string;
  amountWrapperClassName?: string;
  currencyLabel?: string;
  disabled?: boolean;
  percentAriaLabel?: string;
  amountAriaLabel?: string;
  /** Autofocus the percent field (used for freshly added rows). */
  autoFocusPercent?: boolean;
  /** Mark a field invalid (server-precision validation) for a11y wiring. */
  percentInvalid?: boolean;
  amountInvalid?: boolean;
  /** id of the element holding the field-level error message. */
  percentErrorId?: string;
  amountErrorId?: string;
};

export function PaymentSplitFields({
  percent,
  amount: amountOverride = null,
  total,
  onPercentChange,
  onAmountChange,
  onQuickAdd,
  percentClassName = "",
  amountClassName = "",
  amountWrapperClassName = "",
  currencyLabel,
  disabled = false,
  percentAriaLabel = "Percent",
  amountAriaLabel = "Amount",
  autoFocusPercent = false,
  percentInvalid = false,
  amountInvalid = false,
  percentErrorId,
  amountErrorId,
}: Props) {
  const base = Number(total) || 0;
  const pct = Number(percent) || 0;
  const amount = resolveSplitAmount(pct, base, amountOverride);

  const [pctDraft, setPctDraft] = useState<string>(pct ? String(round2(pct)) : "");
  const [amtDraft, setAmtDraft] = useState<string>(amount ? formatWithCommas(amount) : "");
  const pctFocused = useRef(false);
  const amtFocused = useRef(false);

  // Mirror external changes (row added, total changed, reset) into the drafts.
  useEffect(() => {
    if (!pctFocused.current) setPctDraft(pct ? String(round2(pct)) : "");
  }, [pct]);
  useEffect(() => {
    if (!amtFocused.current) setAmtDraft(amount ? formatWithCommas(amount) : "");
  }, [amount]);

  const quickAdd = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && onQuickAdd) {
      e.preventDefault();
      onQuickAdd();
    }
  };

  return (
    <>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          max={100}
          disabled={disabled}
          autoFocus={autoFocusPercent}
          aria-label={percentAriaLabel}
          aria-invalid={percentInvalid || undefined}
          aria-describedby={percentErrorId}
          value={pctDraft}
          onKeyDown={quickAdd}
          onFocus={() => {
            pctFocused.current = true;
          }}
          onBlur={() => {
            pctFocused.current = false;
            setPctDraft(pct ? String(round2(pct)) : "");
          }}
          onChange={(e) => {
            // Percent is also money-derived, so cap it at 2 decimals too.
            const raw = clampDecimals(e.target.value);
            setPctDraft(raw);
            const next = raw === "" ? 0 : Number(raw);
            if (Number.isFinite(next)) {
              // Percent becomes authoritative again — drop any flat override.
              onAmountChange?.(null);
              onPercentChange(round2(next));
            }
          }}

          placeholder="0"
          dir="ltr"
          className={percentClassName}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          %
        </span>
      </div>

      <div className={`relative ${amountWrapperClassName}`}>
        <input
          type="text"
          inputMode="decimal"
          disabled={disabled}
          aria-label={amountAriaLabel}
          aria-invalid={amountInvalid || undefined}
          aria-describedby={amountErrorId}
          value={amtDraft}
          onKeyDown={quickAdd}
          onFocus={() => {
            amtFocused.current = true;
            setAmtDraft(amount ? String(amount) : "");
          }}
          onBlur={() => {
            amtFocused.current = false;
            setAmtDraft(amount ? formatWithCommas(amount) : "");
          }}
          onChange={(e) => {
            const raw = e.target.value;
            // Live thousands separators while typing, preserving any partial
            // decimal tail the user is still entering ("1234." / "1234.5"),
            // hard-capped at 2 fractional digits (cents / halalas).
            const cleaned = clampDecimals(raw.replace(/[^\d.-]/g, ""));
            const nextAmount = parseLoose(cleaned);
            const [intPart, ...decParts] = cleaned.split(".");
            const intNum = Number(intPart);
            const grouped =
              Number.isFinite(intNum) && intPart !== "" && intPart !== "-"
                ? intNum.toLocaleString("en-US", { maximumFractionDigits: 0 })
                : intPart;
            const display = decParts.length
              ? `${grouped}.${decParts.join("").slice(0, 2)}`
              : grouped;
            setAmtDraft(display);
            // The typed amount is authoritative and stored verbatim (to the
            // cent); the percent is only refreshed so totals stay meaningful.
            if (onAmountChange) onAmountChange(cleaned === "" ? null : round2(nextAmount));
            if (base > 0) onPercentChange(round2((nextAmount / base) * 100));
          }}
          placeholder="0.00"

          dir="ltr"
          className={amountClassName}
        />
        {currencyLabel && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase text-muted-foreground">
            {currencyLabel}
          </span>
        )}
      </div>
    </>
  );
}

/** Inline "how much is left" helper text under a payment schedule. */
export function ScheduleRemainderHint({
  totalPct,
  total,
  allocatedAmount,
  currency,
  className = "",
}: {
  totalPct: number;
  total: number;
  /** Sum of the effective row amounts (honours flat overrides). */
  allocatedAmount: number;
  currency?: string;
  className?: string;
}) {
  const remainingPct = round2(100 - (Number(totalPct) || 0));
  const remainingAmt = round2((Number(total) || 0) - (Number(allocatedAmount) || 0));
  const balanced = isScheduleTotalValid(totalPct);
  const suffix = currency ? ` ${currency}` : "";

  return (
    <p
      aria-live="polite"
      className={`text-[11px] ${balanced ? "text-success dark:text-success" : remainingPct < 0 ? "text-destructive" : "text-warning dark:text-warning"} ${className}`}
    >
      {balanced
        ? "Schedule balanced — 100% allocated."
        : remainingPct < 0
          ? `Over-allocated by ${Math.abs(remainingPct).toFixed(2)}% (${formatWithCommas(Math.abs(remainingAmt))}${suffix}). Reduce a milestone.`
          : `${remainingPct.toFixed(2)}% remaining (${formatWithCommas(remainingAmt)}${suffix}) to reach 100%.`}
    </p>
  );
}
