import { useMemo } from "react";
import { Percent } from "lucide-react";

// ─── Types ───────────────────────────────────────────────
export type WhtTreatment = "inclusive" | "exclusive";

export interface WhtBreakdown {
  netPayable: number; // What the freelancer receives
  whtAmount: number; // The 5% amount
  totalBudgetCost: number; // What hits the budget actuals
}

// ─── Pure math — no side effects, no DB writes ───────────
export function calculateWht(packageAmount: number, treatment: WhtTreatment): WhtBreakdown {
  const whtAmount = Math.round(packageAmount * 0.05 * 100) / 100;

  if (treatment === "inclusive") {
    // Deduct from net — freelancer gets less
    return {
      netPayable: packageAmount - whtAmount,
      whtAmount,
      totalBudgetCost: packageAmount,
    };
  }
  // Exclusive / gross-up — freelancer gets full amount, production pays extra
  return {
    netPayable: packageAmount,
    whtAmount,
    totalBudgetCost: packageAmount + whtAmount,
  };
}

// ─── Formatting helper (local to this component) ─────────
function money(n: number, ccy: string): string {
  const s = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return ccy === "USD" ? `$${s}` : `${ccy} ${s}`;
}

// ─── Component ───────────────────────────────────────────
interface Props {
  packageAmount: number;
  currency: string;
  value: WhtTreatment;
  onChange: (t: WhtTreatment) => void;
}

export function WhtTreatmentSelector({ packageAmount, currency, value, onChange }: Props) {
  const breakdown = useMemo(() => calculateWht(packageAmount, value), [packageAmount, value]);

  const options: { id: WhtTreatment; title: string; subtitle: string }[] = [
    {
      id: "inclusive",
      title: "Inclusive — Deduct from Net",
      subtitle: "WHT is deducted from the package. Freelancer receives less.",
    },
    {
      id: "exclusive",
      title: "Exclusive — Gross-up",
      subtitle: "Freelancer gets the full package. WHT added on top as production cost.",
    },
  ];

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-warning/15 text-warning">
          <Percent className="size-3" />
        </span>
        <span className="text-sm font-semibold text-foreground">Withholding Tax — 5%</span>
      </div>

      <p className="text-xs text-muted-foreground">
        Non-Saudi entity detected. Choose how to handle the 5% WHT:
      </p>

      {/* Radio options */}
      <div className="space-y-2">
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <label
              key={opt.id}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors ${
                selected ? "border-warning bg-warning/10" : "border-border hover:bg-muted"
              }`}
            >
              <input
                type="radio"
                name="wht-treatment"
                checked={selected}
                onChange={() => onChange(opt.id)}
                className="mt-0.5 size-4 accent-[color:var(--color-warning,currentColor)]"
              />
              <div>
                <p className="text-xs font-semibold text-foreground">{opt.title}</p>
                <p className="text-[11px] text-muted-foreground">{opt.subtitle}</p>
              </div>
            </label>
          );
        })}
      </div>

      {/* Live breakdown — only when there's a real amount */}
      {packageAmount > 0 && (
        <div className="rounded-lg border border-border bg-card p-2.5 space-y-1 tabular-nums">
          {value === "inclusive" ? (
            <>
              <Row label="Package amount" value={money(packageAmount, currency)} />
              <Row label="WHT (5%)" value={`- ${money(breakdown.whtAmount, currency)}`} />
              <div className="my-1 border-t border-border" />
              <Row label="Net payable" value={money(breakdown.netPayable, currency)} bold />
              <Row label="Total budget cost" value={money(breakdown.totalBudgetCost, currency)} />
            </>
          ) : (
            <>
              <Row label="Net payable" value={money(breakdown.netPayable, currency)} bold />
              <Row
                label="WHT (5%) — production cost"
                value={money(breakdown.whtAmount, currency)}
              />
              <div className="my-1 border-t border-border" />
              <Row
                label="Total budget cost"
                value={money(breakdown.totalBudgetCost, currency)}
                bold
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  className = "",
}: {
  label: string;
  value: string;
  bold?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between text-xs ${className}`}>
      <span className={bold ? "font-semibold text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
      <span className={bold ? "font-semibold text-foreground" : "text-foreground"} dir="ltr">
        {value}
      </span>
    </div>
  );
}
