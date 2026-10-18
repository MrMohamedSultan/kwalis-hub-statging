import type { ReactNode } from "react";

export type TabItem<T extends string = string> = {
  key: T;
  label: ReactNode;
  icon?: ReactNode;
  hint?: string;
};

/**
 * Shared pill-tab strip — consistent typography, spacing, and active state
 * across Accounting, Budget, Funding, Payroll, Reports.
 */
export function TabStrip<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (t: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex flex-wrap gap-2 rounded-xl border border-border bg-surface-2/60 p-1.5 mb-4 ${className}`}
    >
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            title={t.hint}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              active
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground hover:bg-surface"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
