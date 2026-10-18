import { useCurrency } from "@/contexts/CurrencyContext";
import { useCurrencyStore } from "@/stores/useCurrencyStore";

export function CurrencyToggle() {
  const { active, toggle } = useCurrency();
  const rateFound = useCurrencyStore((s) => s.rateFound);
  const isLoadingRate = useCurrencyStore((s) => s.isLoadingRate);

  // No configured rate at any level → conversion would be a guess.
  // Disable rather than convert with a fabricated number.
  const disabled = !rateFound && !isLoadingRate;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      className={`inline-flex items-center rounded-full border border-border bg-muted/40 p-0.5 text-xs font-medium ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
      aria-label={`Showing ${active}. Click to switch.`}
      title={
        disabled
          ? "No exchange rate configured for this project"
          : `Showing ${active}. Click to switch.`
      }
    >
      <span
        className={`rounded-full px-2.5 py-1 transition-all duration-150 ${
          active === "SAR" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
        }`}
      >
        SAR
      </span>
      <span
        className={`rounded-full px-2.5 py-1 transition-all duration-150 ${
          active === "USD" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
        }`}
      >
        USD
      </span>
    </button>
  );
}
