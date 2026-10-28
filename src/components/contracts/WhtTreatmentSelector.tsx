import { useMemo } from "react";
import { formatAmount } from "@/lib/format-number";
import { Percent } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  computeWht,
  type WhtBreakdown,
  type WhtTreatment as Treatment,
} from "@/lib/contract-terms";

// ─── Types ───────────────────────────────────────────────
export type WhtTreatment = Treatment;
export type { WhtBreakdown };

/**
 * Pure math — kept under this name for existing callers.
 * inclusive: WHT deducted from the amount · exclusive: gross-up, net / (1 − rate).
 */
export function calculateWht(
  amount: number,
  treatment: WhtTreatment,
  ratePct = 5,
): WhtBreakdown & { netPayable: number; whtAmount: number; totalBudgetCost: number } {
  const b = computeWht(amount, ratePct, treatment);
  return { ...b, netPayable: b.net, whtAmount: b.wht, totalBudgetCost: b.gross };
}

function money(n: number, ccy: string): string {
  const s = formatAmount(Math.abs(Number.isFinite(n) ? n : 0), 2);
  return `${s} ${ccy}`;
}

// ─── Component ───────────────────────────────────────────
interface Props {
  /** Agreed amount typed on the contract, in the contract currency. */
  packageAmount: number;
  currency: string;
  ratePct: number;
  value: WhtTreatment;
  onChange: (t: WhtTreatment) => void;
  /** Optional base-currency figures shown under the breakdown. */
  base?: { currency: string; breakdown: WhtBreakdown } | null;
  children?: React.ReactNode;
}

export function WhtTreatmentSelector({
  packageAmount,
  currency,
  ratePct,
  value,
  onChange,
  base,
  children,
}: Props) {
  const { t } = useTranslation();
  const b = useMemo(
    () => computeWht(packageAmount, ratePct, value),
    [packageAmount, ratePct, value],
  );
  const rate = `${Number(ratePct.toFixed(2))}%`;

  const options: { id: WhtTreatment; title: string; subtitle: string }[] = [
    {
      id: "inclusive",
      title: t("contracts.wht.inclusive_title"),
      subtitle: t("contracts.wht.inclusive_hint"),
    },
    {
      id: "exclusive",
      title: t("contracts.wht.exclusive_title"),
      subtitle: t("contracts.wht.exclusive_hint"),
    },
  ];

  return (
    <div className="col-span-2 rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-warning/15 text-warning">
          <Percent className="size-3" />
        </span>
        <span className="text-sm font-semibold text-foreground">
          {t("contracts.wht.title", { rate })}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t("contracts.wht.applies_hint")}</p>

      {children}

      <div className="grid gap-2 sm:grid-cols-2">
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

      {packageAmount > 0 && (
        <div className="rounded-lg border border-border bg-card p-2.5 space-y-1 tabular-nums">
          <Row label={t("contracts.wht.gross")} value={money(b.gross, currency)} bold />
          <Row label={t("contracts.wht.wht", { rate })} value={`− ${money(b.wht, currency)}`} />
          <div className="my-1 border-t border-border" />
          <Row label={t("contracts.wht.net")} value={money(b.net, currency)} bold />
          {base && (
            <div className="pt-1 text-[11px] text-muted-foreground" dir="ltr">
              {money(base.breakdown.gross, base.currency)} ·{" "}
              {money(base.breakdown.wht, base.currency)} ·{" "}
              {money(base.breakdown.net, base.currency)}
            </div>
          )}
          <p className="pt-1 text-[11px] text-muted-foreground">
            {t("contracts.wht.instalments_on_net")}
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className={bold ? "font-semibold text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
      <span className={bold ? "font-semibold text-foreground" : "text-foreground"} dir="ltr">
        {value}
      </span>
    </div>
  );
}
