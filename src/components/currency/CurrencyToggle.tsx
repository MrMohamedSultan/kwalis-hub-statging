import { cn } from "@/lib/utils";
import { useCurrencyStore } from "@/stores/useCurrencyStore";

/** Pill toggle for the 48px top bar: BASE | TARGET. */
export function CurrencyToggle({ className }: { className?: string }) {
  const { activeCurrency, projectFxRate, isLoadingRate, toggleCurrency } = useCurrencyStore();

  if (isLoadingRate) {
    return <div className="h-8 w-28 animate-pulse rounded-full bg-muted" />;
  }

  const sideClass = (active: boolean) =>
    cn(
      "px-3 py-1 text-xs font-semibold transition-colors",
      active ? "rounded-full bg-primary text-primary-foreground" : "text-muted-foreground",
    );

  return (
    <button
      type="button"
      onClick={toggleCurrency}
      aria-label="Toggle display currency"
      className={cn(
        "inline-flex h-8 items-center rounded-full border bg-background px-0.5",
        className,
      )}
    >
      <span className={sideClass(activeCurrency === "base")}>{projectFxRate.baseCurrency}</span>
      <span className={sideClass(activeCurrency === "target")}>{projectFxRate.targetCurrency}</span>
    </button>
  );
}

export default CurrencyToggle;
