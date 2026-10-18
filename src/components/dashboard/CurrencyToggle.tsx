// =====================================================================
// CurrencyToggle — compact SAR / USD segmented control.
// Bound to the platform currency store, so every figure on both
// dashboards switches simultaneously and the choice persists.
// =====================================================================
import { useDashboardCurrency } from "@/lib/dashboard/currency";

export function CurrencyToggle() {
  const { code, base, target, set } = useDashboardCurrency();
  return (
    <div
      role="group"
      aria-label="Currency"
      className="inline-flex items-center rounded-lg border border-border bg-surface-2 p-0.5"
    >
      {[base, target].map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => set(c)}
          aria-pressed={code === c}
          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            code === c
              ? "bg-surface text-ink-primary shadow-sm"
              : "text-ink-muted hover:text-ink-secondary"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
