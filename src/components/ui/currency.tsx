import { cn } from "@/lib/utils";

export type CurrencyCode = "USD" | "SAR" | "EUR" | "AED" | string;

/**
 * Inline currency label — always the ISO text code (SAR, USD, EUR…).
 * Localized glyphs ($, ﷼, €) are intentionally not used anywhere.
 */
export function CurrencySymbol({ code, className }: { code: CurrencyCode; className?: string }) {
  return <span className={cn(className)}>{code}</span>;
}

const nfUS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * Money display: `1,234.56 SAR`.
 * The ISO code always follows the number — no localized symbols anywhere.
 */
export function Money({
  amount,
  code = "USD",
  className,
  symbolClassName,
  suffix = false,
}: {
  amount: number;
  code?: CurrencyCode;
  className?: string;
  symbolClassName?: string;
  suffix?: boolean;
}) {
  const value = nfUS.format(Number(amount) || 0);
  return (
    <span
      dir="ltr"
      className={cn("inline-flex items-center gap-1 whitespace-nowrap tabular-nums", className)}
    >
      <span>{value}</span>
      <CurrencySymbol code={code} className={symbolClassName} />
    </span>
  );
}

/** Convenience: `1,234 SAR`. */
export function SarAmount({ amount, className }: { amount: number; className?: string }) {
  return <Money amount={amount} code="SAR" className={className} />;
}

/** Convenience: `1,234 USD`. */
export function UsdAmount({ amount, className }: { amount: number; className?: string }) {
  return <Money amount={amount} code="USD" className={className} />;
}
